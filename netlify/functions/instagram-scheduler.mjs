import { getStore } from "@netlify/blobs";
import {
  isDue,
  publishInstagramItem
} from "../../.agents/skills/magellan-etsy-instagram/scripts/instagram_publish_lib.mjs";

const STORE_NAME = "magellan-instagram";
const QUEUE_KEY = "monthly-queue";
const HISTORY_KEY = "post-history";
const DEFAULT_LIMIT = 1;
const LOCK_SETTLE_MS = 750;
const STALE_LOCK_MS = 20 * 60 * 1000;

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

async function appendHistory(store, publishedItems) {
  if (!publishedItems.length) return;
  const history = await readJSON(store, HISTORY_KEY, { posts: [] });
  const seen = new Set(history.posts.map((post) => post.instagram_media_id));
  for (const item of publishedItems) {
    if (seen.has(item.instagram_media_id)) continue;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function claimDueItems(store, queue, now, limit) {
  const dueItems = queue.filter((item) => isDue(item, now)).slice(0, limit);
  if (!dueItems.length) return [];

  const claimed = [];
  const lockAt = new Date().toISOString();
  for (const item of dueItems) {
    item.instagram_status = "publishing";
    item.instagram_publish_lock = runToken();
    item.instagram_publish_lock_at = lockAt;
    claimed.push({ id: item.id, token: item.instagram_publish_lock });
  }

  await store.setJSON(QUEUE_KEY, queue);
  await sleep(LOCK_SETTLE_MS);

  const latestQueue = await readJSON(store, QUEUE_KEY, []);
  const owned = [];
  for (const claim of claimed) {
    const item = latestQueue.find((candidate) => candidate.id === claim.id);
    if (item?.instagram_status === "publishing" && item.instagram_publish_lock === claim.token) {
      owned.push(item);
    }
  }

  return { latestQueue, owned };
}

function clearStalePublishLocks(queue, now) {
  let cleared = 0;
  for (const item of queue) {
    if (item.instagram_status !== "publishing") continue;
    const lockedAt = new Date(item.instagram_publish_lock_at || 0).getTime();
    const stale = !Number.isFinite(lockedAt) || now.getTime() - lockedAt > STALE_LOCK_MS;
    if (!stale) continue;
    item.instagram_status = "scheduled";
    item.instagram_lock_cleared_at = now.toISOString();
    delete item.instagram_publish_lock;
    delete item.instagram_publish_lock_at;
    cleared += 1;
  }
  return cleared;
}

export default async () => {
  const token = env("META_PAGE_ACCESS_TOKEN");
  const igUserId = env("META_INSTAGRAM_BUSINESS_ID");
  const limit = Number(env("MAGELLAN_IG_SCHEDULER_LIMIT") || DEFAULT_LIMIT);

  const missing = [
    ["META_PAGE_ACCESS_TOKEN", token],
    ["META_INSTAGRAM_BUSINESS_ID", igUserId]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    return jsonResponse({
      ok: false,
      error: "Missing Meta Instagram environment variables",
      missing,
      hasNetlifyEnv: Boolean(globalThis.Netlify?.env),
      hasProcessEnv: Boolean(process.env)
    }, 500);
  }

  const store = getStore(STORE_NAME, { consistency: "strong" });
  const queue = await readJSON(store, QUEUE_KEY, []);
  if (!Array.isArray(queue) || queue.length === 0) {
    return jsonResponse({ ok: true, published: 0, skipped: "No queue in Netlify Blobs" });
  }

  const now = new Date();
  const clearedLocks = clearStalePublishLocks(queue, now);
  if (clearedLocks) await store.setJSON(QUEUE_KEY, queue);

  const dueItems = queue.filter((item) => isDue(item, now)).slice(0, limit);
  if (!dueItems.length) {
    return jsonResponse({
      ok: true,
      published: 0,
      total: queue.length,
      statuses: queue.reduce((memo, item) => {
        const status = item.instagram_status || "queued";
        memo[status] = (memo[status] || 0) + 1;
        return memo;
      }, {}),
      clearedLocks,
      checkedAt: now.toISOString()
    });
  }

  const claim = await claimDueItems(store, queue, now, limit);
  if (!claim.owned.length) {
    return jsonResponse({
      ok: true,
      published: 0,
      skipped: "Due item was claimed by another scheduler run",
      checkedAt: new Date().toISOString()
    });
  }

  const workingQueue = claim.latestQueue;
  const publishedItems = [];
  const failures = [];

  for (const item of claim.owned) {
    try {
      await publishInstagramItem(item, { token, igUserId });
      delete item.instagram_publish_lock;
      delete item.instagram_publish_lock_at;
      publishedItems.push(item);
    } catch (error) {
      item.instagram_status = "failed";
      item.instagram_error = error.message;
      item.instagram_failed_at = new Date().toISOString();
      delete item.instagram_publish_lock;
      delete item.instagram_publish_lock_at;
      failures.push({ id: item.id, error: error.message });
    }
  }

  await store.setJSON(QUEUE_KEY, workingQueue);
  await appendHistory(store, publishedItems);

  return jsonResponse({
    ok: failures.length === 0,
    published: publishedItems.length,
    clearedLocks,
    failures,
    checkedAt: now.toISOString()
  }, failures.length ? 207 : 200);
};

export const config = {
  schedule: "@hourly"
};
