import { getStore } from "@netlify/blobs";
import {
  createInstagramContainer,
  findRecentInstagramDuplicate,
  getInstagramContainerStatus,
  isDue,
  publishInstagramContainer
} from "../../.agents/skills/magellan-etsy-instagram/scripts/instagram_publish_lib.mjs";

const STORE_NAME = "magellan-instagram";
const QUEUE_KEY = "monthly-queue";
const HISTORY_KEY = "post-history";
const ALERTS_KEY = "scheduler-alerts";
const CIRCUIT_KEY = "scheduler-circuit";
const RUN_LOCK_KEY = "scheduler-run-lock";

const STALE_WORK_MS = 45 * 60 * 1000;
const META_REQUEST_TIMEOUT_MS = 5000;
const ALERT_REQUEST_TIMEOUT_MS = 2000;
const CONTAINER_CHECK_ATTEMPTS = 2;
const CONTAINER_CHECK_DELAY_MS = 1500;
const MAX_ITEM_FAILURES = 3;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_ALERTS = 100;

const RECOVERABLE_STATUSES = new Set([
  "publishing",
  "container_creating",
  "container_checking"
]);

const IN_PROGRESS_STATUSES = new Set([
  "container_created",
  "ready_to_publish",
  "publish_requested",
  ...RECOVERABLE_STATUSES
]);

class SchedulerError extends Error {
  constructor(message, { terminal = false, manualReview = false } = {}) {
    super(message);
    this.name = "SchedulerError";
    this.terminal = terminal;
    this.manualReview = manualReview;
  }
}

function env(name) {
  return globalThis.Netlify?.env?.get(name) ?? process.env[name];
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function readJSON(store, key, fallback) {
  const value = await store.get(key, { type: "json" });
  return value ?? fallback;
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function statusCounts(queue) {
  return queue.reduce((memo, item) => {
    const status = item.instagram_status || "queued";
    memo[status] = (memo[status] || 0) + 1;
    return memo;
  }, {});
}

function stale(timestamp, now, maxAgeMs = STALE_WORK_MS) {
  const value = new Date(timestamp || 0).getTime();
  return !Number.isFinite(value) || now.getTime() - value > maxAgeMs;
}

export function queueNeedsWork(queue, now = new Date()) {
  return queue.some((item) => IN_PROGRESS_STATUSES.has(item.instagram_status) || isDue(item, now));
}

function alertText(alert) {
  const itemPart = alert.item_id ? ` Post: ${alert.item_id}.` : "";
  return `[Magellan Instagram] ${alert.severity.toUpperCase()}: ${alert.message}.${itemPart}`;
}

async function deliverAlertWebhook(alert) {
  const url = env("MAGELLAN_IG_ALERT_WEBHOOK_URL");
  if (!url) return { status: "not_configured" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ALERT_REQUEST_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    const bearerToken = env("MAGELLAN_IG_ALERT_WEBHOOK_BEARER_TOKEN");
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        text: alertText(alert),
        source: "magellan-instagram-scheduler",
        alert
      })
    });
    if (!response.ok) return { status: "failed", error: `Webhook HTTP ${response.status}` };
    return { status: "delivered", delivered_at: new Date().toISOString() };
  } catch (error) {
    const message = error.name === "AbortError" ? "Webhook timed out after 2 seconds" : error.message;
    return { status: "failed", error: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function recordAlert(store, details) {
  const alert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    created_at: new Date().toISOString(),
    severity: details.severity || "error",
    event: details.event || "scheduler_failure",
    message: details.message,
    item_id: details.item_id || null,
    status: details.status || null,
    failure_count: details.failure_count ?? null,
    circuit_status: details.circuit_status || null
  };
  const current = await readJSON(store, ALERTS_KEY, { alerts: [] });
  const alerts = Array.isArray(current.alerts) ? current.alerts : [];
  alert.delivery = { status: "pending" };
  alerts.unshift(alert);
  await store.setJSON(ALERTS_KEY, { alerts: alerts.slice(0, MAX_ALERTS) });

  alert.delivery = await deliverAlertWebhook(alert);
  await store.setJSON(ALERTS_KEY, { alerts: alerts.slice(0, MAX_ALERTS) });
  console.error(JSON.stringify({ instagram_scheduler_alert: alert }));
  return alert;
}

async function readCircuit(store) {
  return readJSON(store, CIRCUIT_KEY, {
    status: "closed",
    consecutive_failures: 0
  });
}

async function registerCircuitFailure(store, error, now) {
  const circuit = await readCircuit(store);
  circuit.consecutive_failures = (Number(circuit.consecutive_failures) || 0) + 1;
  circuit.last_failure_at = now.toISOString();
  circuit.last_error = error.message;
  if (circuit.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
    circuit.status = "open";
    circuit.opened_at = now.toISOString();
    circuit.reason = `Paused after ${circuit.consecutive_failures} consecutive scheduler failures.`;
  }
  await store.setJSON(CIRCUIT_KEY, circuit);
  return circuit;
}

async function registerCircuitSuccess(store, now) {
  const circuit = await readCircuit(store);
  if (circuit.status === "closed" && !circuit.consecutive_failures) return circuit;
  const reset = {
    status: "closed",
    consecutive_failures: 0,
    last_success_at: now.toISOString(),
    previous_opened_at: circuit.opened_at || null
  };
  await store.setJSON(CIRCUIT_KEY, reset);
  return reset;
}

async function appendHistory(store, publishedItems) {
  if (!publishedItems.length) return;
  const history = await readJSON(store, HISTORY_KEY, { posts: [] });
  const seen = new Set(history.posts.map((post) => post.instagram_media_id));
  for (const item of publishedItems) {
    if (!item.instagram_media_id || seen.has(item.instagram_media_id)) continue;
    history.posts.push({
      id: item.id,
      source_id: item.source_id,
      source_title: item.source_title,
      instagram_media_id: item.instagram_media_id,
      instagram_container_id: item.instagram_container_id,
      published_at: item.instagram_published_at,
      scheduled_for: item.instagram_scheduled_publish_time || item.scheduled_publish_time || item.date
    });
  }
  await store.setJSON(HISTORY_KEY, history);
}

export function recoverStaleItems(queue, now) {
  const recovered = [];
  const failed = [];
  for (const item of queue) {
    if (!RECOVERABLE_STATUSES.has(item.instagram_status)) continue;
    if (!stale(item.instagram_work_started_at || item.instagram_publish_lock_at, now)) continue;

    item.instagram_recovery_count = (Number(item.instagram_recovery_count) || 0) + 1;
    item.instagram_recovered_at = now.toISOString();
    delete item.instagram_publish_lock;
    delete item.instagram_publish_lock_at;
    delete item.instagram_work_started_at;

    if (item.instagram_recovery_count >= MAX_ITEM_FAILURES) {
      item.instagram_status = "failed";
      item.instagram_error = "Stopped after repeated stale scheduler work. Manual review required.";
      item.instagram_failed_at = now.toISOString();
      failed.push(item.id);
      continue;
    }

    item.instagram_status = item.instagram_container_id ? "container_created" : "scheduled";
    recovered.push(item.id);
  }
  return { recovered, failed };
}

async function acquireRunLock(store, now) {
  const current = await readJSON(store, RUN_LOCK_KEY, null);
  if (current?.started_at && !stale(current.started_at, now, 10 * 60 * 1000)) return null;

  const lock = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    started_at: now.toISOString()
  };
  await store.setJSON(RUN_LOCK_KEY, lock);
  const latest = await readJSON(store, RUN_LOCK_KEY, null);
  return latest?.id === lock.id ? lock : null;
}

async function releaseRunLock(store, lock) {
  const current = await readJSON(store, RUN_LOCK_KEY, null);
  if (current?.id === lock.id) {
    await store.setJSON(RUN_LOCK_KEY, { released_at: new Date().toISOString() });
  }
}

function nextItem(queue, now) {
  return queue.find((item) => item.instagram_status === "publish_requested")
    || queue.find((item) => item.instagram_status === "ready_to_publish")
    || queue.find((item) => item.instagram_status === "container_created")
    || queue.find((item) => isDue(item, now));
}

async function markDuplicatePublished(store, queue, item, duplicate, now) {
  item.instagram_status = "published";
  item.instagram_media_id = duplicate.id;
  item.instagram_permalink = duplicate.permalink;
  item.instagram_published_at = duplicate.timestamp || now.toISOString();
  item.instagram_duplicate_detected_at = now.toISOString();
  delete item.instagram_error;
  await store.setJSON(QUEUE_KEY, queue);
  await appendHistory(store, [item]);
  return { action: "already_published", id: item.id, media_id: item.instagram_media_id };
}

async function publishStep(store, queue, item, token, igUserId, now) {
  const duplicate = await findRecentInstagramDuplicate(item, { token, igUserId, limit: 50 });
  if (duplicate) return markDuplicatePublished(store, queue, item, duplicate, now);

  item.instagram_status = "publish_requested";
  item.instagram_publish_requested_at = now.toISOString();
  await store.setJSON(QUEUE_KEY, queue);

  await publishInstagramContainer(item, {
    token,
    igUserId,
    requestTimeoutMs: META_REQUEST_TIMEOUT_MS
  });
  await store.setJSON(QUEUE_KEY, queue);
  await appendHistory(store, [item]);
  return { action: "published", id: item.id, media_id: item.instagram_media_id };
}

async function checkContainerUntilReady(store, queue, item, token) {
  for (let attempt = 1; attempt <= CONTAINER_CHECK_ATTEMPTS; attempt += 1) {
    item.instagram_status = "container_checking";
    item.instagram_work_started_at = new Date().toISOString();
    await store.setJSON(QUEUE_KEY, queue);

    const status = await getInstagramContainerStatus(item.instagram_container_id, {
      token,
      requestTimeoutMs: META_REQUEST_TIMEOUT_MS
    });
    item.instagram_container_checked_at = new Date().toISOString();
    delete item.instagram_work_started_at;

    if (status.status_code === "FINISHED") {
      item.instagram_status = "ready_to_publish";
      item.instagram_container_pending_runs = 0;
      await store.setJSON(QUEUE_KEY, queue);
      return true;
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new SchedulerError(status.status || `Container ${status.status_code}`, { terminal: true });
    }
    if (attempt < CONTAINER_CHECK_ATTEMPTS) await delay(CONTAINER_CHECK_DELAY_MS);
  }

  item.instagram_status = "container_created";
  item.instagram_container_pending_runs = (Number(item.instagram_container_pending_runs) || 0) + 1;
  await store.setJSON(QUEUE_KEY, queue);
  if (item.instagram_container_pending_runs >= 2) {
    throw new SchedulerError("Instagram container remained pending across two scheduler windows.", { terminal: true });
  }
  return false;
}

async function processItem(store, queue, item, token, igUserId, now) {
  if (item.instagram_status === "publish_requested") {
    const duplicate = await findRecentInstagramDuplicate(item, { token, igUserId, limit: 50 });
    if (duplicate) return markDuplicatePublished(store, queue, item, duplicate, now);
    throw new SchedulerError(
      "A publish request may have reached Instagram but no matching post was found. Automatic republishing is paused.",
      { terminal: true, manualReview: true }
    );
  }

  if (item.instagram_status === "ready_to_publish") {
    return publishStep(store, queue, item, token, igUserId, now);
  }

  if (item.instagram_status !== "container_created") {
    item.instagram_status = "container_creating";
    item.instagram_work_started_at = now.toISOString();
    delete item.instagram_error;
    await store.setJSON(QUEUE_KEY, queue);
    await createInstagramContainer(item, {
      token,
      igUserId,
      requestTimeoutMs: META_REQUEST_TIMEOUT_MS
    });
    delete item.instagram_work_started_at;
    await store.setJSON(QUEUE_KEY, queue);
  }

  const ready = await checkContainerUntilReady(store, queue, item, token);
  if (!ready) return { action: "container_pending", id: item.id };
  return publishStep(store, queue, item, token, igUserId, now);
}

export function applyItemFailure(item, error, now) {
  item.instagram_failure_count = (Number(item.instagram_failure_count) || 0) + 1;
  item.instagram_error = error.message;
  item.instagram_last_failed_at = now.toISOString();
  delete item.instagram_work_started_at;

  if (error.manualReview || item.instagram_status === "publish_requested") {
    item.instagram_status = "manual_review";
    item.instagram_failed_at = now.toISOString();
  } else if (error.terminal || item.instagram_failure_count >= MAX_ITEM_FAILURES) {
    item.instagram_status = "failed";
    item.instagram_failed_at = now.toISOString();
  } else {
    item.instagram_status = item.instagram_container_id ? "container_created" : "scheduled";
  }
  return item.instagram_status;
}

export default async () => {
  const store = getStore(STORE_NAME, { consistency: "strong" });
  const now = new Date();

  // One-off approved Euro Summer test for 2026-08-23 at 19:00/19:05 PDT.
  // Restore the fail-closed default immediately after verifying this batch.
  if (String(env("MAGELLAN_IG_SCHEDULER_ENABLED") || "true").toLowerCase() !== "true") {
    return jsonResponse({ ok: true, action: "disabled", checkedAt: now.toISOString() });
  }

  const circuit = await readCircuit(store);
  if (circuit.status === "open") {
    return jsonResponse({
      ok: false,
      action: "circuit_open",
      reason: circuit.reason,
      checkedAt: now.toISOString()
    }, 503);
  }

  const token = env("META_PAGE_ACCESS_TOKEN");
  const igUserId = env("META_INSTAGRAM_BUSINESS_ID");
  const missing = [
    ["META_PAGE_ACCESS_TOKEN", token],
    ["META_INSTAGRAM_BUSINESS_ID", igUserId]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const configurationCircuit = {
      status: "open",
      consecutive_failures: MAX_CONSECUTIVE_FAILURES,
      opened_at: now.toISOString(),
      last_failure_at: now.toISOString(),
      last_error: `Missing Meta Instagram environment variables: ${missing.join(", ")}`,
      reason: "Paused because required Meta credentials are missing."
    };
    await store.setJSON(CIRCUIT_KEY, configurationCircuit);
    await recordAlert(store, {
      event: "configuration_error",
      message: configurationCircuit.last_error,
      circuit_status: "open"
    });
    return jsonResponse({ ok: false, action: "configuration_error", missing }, 500);
  }

  const queue = await readJSON(store, QUEUE_KEY, []);
  if (!Array.isArray(queue) || queue.length === 0) {
    return jsonResponse({ ok: true, action: "idle", reason: "No queue in Netlify Blobs" });
  }

  const recovery = recoverStaleItems(queue, now);
  if (recovery.recovered.length || recovery.failed.length) {
    await store.setJSON(QUEUE_KEY, queue);
    await recordAlert(store, {
      severity: recovery.failed.length ? "error" : "warning",
      event: "stale_work_recovered",
      message: `Recovered ${recovery.recovered.length} stale item(s); stopped ${recovery.failed.length} item(s).`
    });
  }

  if (!queueNeedsWork(queue, now)) {
    return jsonResponse({ ok: true, action: "idle", statuses: statusCounts(queue), checkedAt: now.toISOString() });
  }

  const lock = await acquireRunLock(store, now);
  if (!lock) {
    return jsonResponse({ ok: true, action: "skipped", reason: "Scheduler run already active", checkedAt: now.toISOString() });
  }

  let item = null;
  try {
    item = nextItem(queue, now);
    if (!item) {
      return jsonResponse({ ok: true, action: "idle", statuses: statusCounts(queue), checkedAt: now.toISOString() });
    }

    const result = await processItem(store, queue, item, token, igUserId, now);
    if (result.action === "container_pending") {
      await recordAlert(store, {
        severity: "warning",
        event: "post_delayed",
        message: "The Instagram container is still processing; it will be checked at the next fixed window",
        item_id: item.id,
        status: item.instagram_status
      });
    } else {
      await registerCircuitSuccess(store, new Date());
    }
    return jsonResponse({
      ok: true,
      ...result,
      recovery,
      statuses: statusCounts(queue),
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    if (item) {
      applyItemFailure(item, error, new Date());
      await store.setJSON(QUEUE_KEY, queue);
    }
    const updatedCircuit = await registerCircuitFailure(store, error, new Date());
    await recordAlert(store, {
      severity: "error",
      event: updatedCircuit.status === "open" ? "circuit_opened" : "scheduler_failure",
      message: error.message,
      item_id: item?.id,
      status: item?.instagram_status,
      failure_count: item?.instagram_failure_count,
      circuit_status: updatedCircuit.status
    });
    return jsonResponse({
      ok: false,
      action: "error",
      error: error.message,
      item: item?.id || null,
      itemStatus: item?.instagram_status || null,
      circuit: updatedCircuit,
      statuses: statusCounts(queue),
      checkedAt: new Date().toISOString()
    }, 500);
  } finally {
    await releaseRunLock(store, lock);
  }
};

export const config = {
  // One-off approved test: 19:00 and 19:05 PDT on 2026-08-23 are
  // 02:00 and 02:05 UTC on 2026-08-24.
  schedule: "0,5 2 24 8 *"
};
