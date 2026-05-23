import { getStore } from "@netlify/blobs";
import { isDue, publishInstagramItem } from "../../.agents/skills/magellan-etsy-instagram/scripts/instagram_publish_lib.mjs";

const STORE_NAME = "magellan-instagram";
const QUEUE_KEY = "monthly-queue";
const HISTORY_KEY = "post-history";
const DEFAULT_LIMIT = 1;

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

export default async () => {
  const token = env("META_PAGE_ACCESS_TOKEN");
  const igUserId = env("META_INSTAGRAM_BUSINESS_ID");
  const limit = Number(env("MAGELLAN_IG_SCHEDULER_LIMIT") || DEFAULT_LIMIT);

  if (!token || !igUserId) {
    return jsonResponse({ ok: false, error: "Missing Meta Instagram environment variables" }, 500);
  }

  const store = getStore(STORE_NAME, { consistency: "strong" });
  const queue = await readJSON(store, QUEUE_KEY, []);
  if (!Array.isArray(queue) || queue.length === 0) {
    return jsonResponse({ ok: true, published: 0, skipped: "No queue in Netlify Blobs" });
  }

  const now = new Date();
  const dueItems = queue.filter((item) => isDue(item, now)).slice(0, limit);
  if (!dueItems.length) {
    return jsonResponse({ ok: true, published: 0, checkedAt: now.toISOString() });
  }

  const publishedItems = [];
  const failures = [];

  for (const item of dueItems) {
    try {
      await publishInstagramItem(item, { token, igUserId });
      publishedItems.push(item);
    } catch (error) {
      item.instagram_status = "failed";
      item.instagram_error = error.message;
      item.instagram_failed_at = new Date().toISOString();
      failures.push({ id: item.id, error: error.message });
    }
  }

  await store.setJSON(QUEUE_KEY, queue);
  await appendHistory(store, publishedItems);

  return jsonResponse({
    ok: failures.length === 0,
    published: publishedItems.length,
    failures,
    checkedAt: now.toISOString()
  }, failures.length ? 207 : 200);
};

export const config = {
  schedule: "@hourly"
};
