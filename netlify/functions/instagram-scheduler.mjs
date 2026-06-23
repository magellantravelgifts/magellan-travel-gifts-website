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
const RUN_LOCK_KEY = "scheduler-run-lock";
const STALE_WORK_MS = 45 * 60 * 1000;
const META_REQUEST_TIMEOUT_MS = 8000;

const RECOVERABLE_STATUSES = new Set([
  "publishing",
  "container_creating",
  "container_checking"
]);

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name];
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

function statusCounts(queue) {
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

function recoverStaleItems(queue, now) {
  const recovered = [];
  for (const item of queue) {
    const status = item.instagram_status;
    if (!RECOVERABLE_STATUSES.has(status)) continue;
    if (!stale(item.instagram_work_started_at || item.instagram_publish_lock_at, now)) continue;

    if (item.instagram_container_id) {
      item.instagram_status = "container_created";
    } else {
      item.instagram_status = "scheduled";
    }
    item.instagram_recovered_at = now.toISOString();
    item.instagram_recovery_count = (Number(item.instagram_recovery_count) || 0) + 1;
    delete item.instagram_publish_lock;
    delete item.instagram_publish_lock_at;
    delete item.instagram_work_started_at;
    recovered.push(item.id);
  }
  return recovered;
}

async function acquireRunLock(store, now) {
  const current = await readJSON(store, RUN_LOCK_KEY, null);
  if (current?.started_at && !stale(current.started_at, now, 10 * 60 * 1000)) {
    return null;
  }
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

function firstByStatus(queue, status) {
  return queue.find((item) => item.instagram_status === status);
}

function firstDue(queue, now) {
  return queue.find((item) => isDue(item, now));
}

async function saveAndReturn(store, queue, body, status = 200) {
  await store.setJSON(QUEUE_KEY, queue);
  return jsonResponse(body, status);
}

async function createContainerStep(store, queue, item, token, igUserId, now) {
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
  return {
    action: "container_created",
    id: item.id,
    container_id: item.instagram_container_id
  };
}

async function checkContainerStep(store, queue, item, token, now) {
  item.instagram_status = "container_checking";
  item.instagram_work_started_at = now.toISOString();
  await store.setJSON(QUEUE_KEY, queue);

  const status = await getInstagramContainerStatus(item.instagram_container_id, {
    token,
    requestTimeoutMs: META_REQUEST_TIMEOUT_MS
  });

  item.instagram_container_checked_at = new Date().toISOString();
  delete item.instagram_work_started_at;

  if (status.status_code === "FINISHED") {
    item.instagram_status = "ready_to_publish";
    await store.setJSON(QUEUE_KEY, queue);
    return {
      action: "container_ready",
      id: item.id,
      container_id: item.instagram_container_id
    };
  }

  if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
    item.instagram_status = "failed";
    item.instagram_error = status.status || `Container ${status.status_code}`;
    item.instagram_failed_at = new Date().toISOString();
    await store.setJSON(QUEUE_KEY, queue);
    return {
      action: "container_failed",
      id: item.id,
      error: item.instagram_error
    };
  }

  item.instagram_status = "container_created";
  await store.setJSON(QUEUE_KEY, queue);
  return {
    action: "container_pending",
    id: item.id,
    container_id: item.instagram_container_id,
    status: status.status_code
  };
}

async function publishStep(store, queue, item, token, igUserId, now) {
  const duplicate = await findRecentInstagramDuplicate(item, {
    token,
    igUserId,
    limit: 50
  });
  if (duplicate) {
    item.instagram_status = "published";
    item.instagram_media_id = duplicate.id;
    item.instagram_permalink = duplicate.permalink;
    item.instagram_published_at = duplicate.timestamp || now.toISOString();
    item.instagram_duplicate_detected_at = now.toISOString();
    await store.setJSON(QUEUE_KEY, queue);
    await appendHistory(store, [item]);
    return {
      action: "already_published",
      id: item.id,
      media_id: item.instagram_media_id,
      permalink: item.instagram_permalink
    };
  }

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
  return {
    action: "published",
    id: item.id,
    media_id: item.instagram_media_id
  };
}

export default async () => {
  const token = env("META_PAGE_ACCESS_TOKEN");
  const igUserId = env("META_INSTAGRAM_BUSINESS_ID");
  const missing = [
    ["META_PAGE_ACCESS_TOKEN", token],
    ["META_INSTAGRAM_BUSINESS_ID", igUserId]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    return jsonResponse({ ok: false, error: "Missing Meta Instagram environment variables", missing }, 500);
  }

  const store = getStore(STORE_NAME, { consistency: "strong" });
  const now = new Date();
  const lock = await acquireRunLock(store, now);
  if (!lock) {
    return jsonResponse({ ok: true, action: "skipped", reason: "Scheduler run already active", checkedAt: now.toISOString() });
  }

  try {
    const queue = await readJSON(store, QUEUE_KEY, []);
    if (!Array.isArray(queue) || queue.length === 0) {
      return jsonResponse({ ok: true, action: "skipped", reason: "No queue in Netlify Blobs" });
    }

    const recovered = recoverStaleItems(queue, now);
    if (recovered.length) await store.setJSON(QUEUE_KEY, queue);

    const ready = firstByStatus(queue, "ready_to_publish");
    if (ready) {
      const result = await publishStep(store, queue, ready, token, igUserId, now);
      return jsonResponse({ ok: true, ...result, recovered, statuses: statusCounts(queue), checkedAt: new Date().toISOString() });
    }

    const publishRequested = firstByStatus(queue, "publish_requested");
    if (publishRequested) {
      const duplicate = await findRecentInstagramDuplicate(publishRequested, { token, igUserId, limit: 50 });
      if (duplicate) {
        publishRequested.instagram_status = "published";
        publishRequested.instagram_media_id = duplicate.id;
        publishRequested.instagram_permalink = duplicate.permalink;
        publishRequested.instagram_published_at = duplicate.timestamp || now.toISOString();
        publishRequested.instagram_duplicate_detected_at = now.toISOString();
        await store.setJSON(QUEUE_KEY, queue);
        await appendHistory(store, [publishRequested]);
        return jsonResponse({
          ok: true,
          action: "publish_confirmed",
          id: publishRequested.id,
          media_id: publishRequested.instagram_media_id,
          recovered,
          statuses: statusCounts(queue),
          checkedAt: new Date().toISOString()
        });
      }
      return jsonResponse({
        ok: true,
        action: "paused",
        reason: "A publish request may have reached Instagram but has not appeared in recent media yet.",
        id: publishRequested.id,
        recovered,
        statuses: statusCounts(queue),
        checkedAt: new Date().toISOString()
      });
    }

    const container = firstByStatus(queue, "container_created");
    if (container) {
      const result = await checkContainerStep(store, queue, container, token, now);
      return jsonResponse({ ok: true, ...result, recovered, statuses: statusCounts(queue), checkedAt: new Date().toISOString() });
    }

    const due = firstDue(queue, now);
    if (due) {
      const result = await createContainerStep(store, queue, due, token, igUserId, now);
      return jsonResponse({ ok: true, ...result, recovered, statuses: statusCounts(queue), checkedAt: new Date().toISOString() });
    }

    return jsonResponse({
      ok: true,
      action: "idle",
      recovered,
      statuses: statusCounts(queue),
      checkedAt: now.toISOString()
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      action: "error",
      error: error.message,
      checkedAt: new Date().toISOString()
    }, 500);
  } finally {
    await releaseRunLock(store, lock);
  }
};

export const config = {
  schedule: "@hourly"
};
