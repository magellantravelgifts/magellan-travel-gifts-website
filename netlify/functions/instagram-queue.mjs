import { getStore } from "@netlify/blobs";

const STORE_NAME = "magellan-instagram";
const QUEUE_KEY = "monthly-queue";
const HISTORY_KEY = "post-history";

function env(name) {
  return globalThis.Netlify?.env?.get(name) ?? process.env[name];
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function authorized(req) {
  const expected = env("MAGELLAN_QUEUE_ADMIN_TOKEN");
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

async function readJSON(store, key, fallback) {
  const value = await store.get(key, { type: "json" });
  return value ?? fallback;
}

function queueCounts(queue) {
  return queue.reduce((memo, item) => {
    const status = item.instagram_status || "queued";
    memo[status] = (memo[status] || 0) + 1;
    return memo;
  }, {});
}

export default async (req) => {
  if (!authorized(req)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const store = getStore(STORE_NAME, { consistency: "strong" });

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("history") === "1") {
      return jsonResponse(await readJSON(store, HISTORY_KEY, { posts: [] }));
    }
    const queue = await readJSON(store, QUEUE_KEY, []);
    return jsonResponse({ ok: true, total: queue.length, counts: queueCounts(queue), queue });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const queue = await req.json();
    if (!Array.isArray(queue)) {
      return jsonResponse({ ok: false, error: "Expected a JSON array queue" }, 400);
    }
    await store.setJSON(QUEUE_KEY, queue);
    return jsonResponse({ ok: true, uploaded: queue.length, counts: queueCounts(queue) });
  }

  return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/instagram-queue"
};
