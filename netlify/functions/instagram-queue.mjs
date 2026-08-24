import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const STORE_NAME = "magellan-instagram";
const QUEUE_KEY = "monthly-queue";
const HISTORY_KEY = "post-history";
const ALERTS_KEY = "scheduler-alerts";
const CIRCUIT_KEY = "scheduler-circuit";
const RUN_STATUS_KEY = "scheduler-run-status";
const ADMIN_TOKEN_SHA256 = "100f3eb427999df69ae3181eb5ad9d79a74ec6fb8774d0e6afc2704fb87d45ac";

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
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const digest = createHash("sha256").update(token).digest("hex");
  return timingSafeEqual(Buffer.from(digest), Buffer.from(ADMIN_TOKEN_SHA256));
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
    if (url.searchParams.get("alerts") === "1") {
      return jsonResponse(await readJSON(store, ALERTS_KEY, { alerts: [] }));
    }
    if (url.searchParams.get("health") === "1") {
      const [queue, alerts, circuit, lastRun] = await Promise.all([
        readJSON(store, QUEUE_KEY, []),
        readJSON(store, ALERTS_KEY, { alerts: [] }),
        readJSON(store, CIRCUIT_KEY, { status: "closed", consecutive_failures: 0 }),
        readJSON(store, RUN_STATUS_KEY, null)
      ]);
      return jsonResponse({
        ok: circuit.status !== "open",
        circuit,
        total: queue.length,
        counts: queueCounts(queue),
        latest_alert: alerts.alerts?.[0] || null,
        last_run: lastRun
      });
    }
    const queue = await readJSON(store, QUEUE_KEY, []);
    return jsonResponse({ ok: true, total: queue.length, counts: queueCounts(queue), queue });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const url = new URL(req.url);
    if (req.method === "POST" && url.searchParams.get("circuit") === "reset") {
      const circuit = {
        status: "closed",
        consecutive_failures: 0,
        reset_at: new Date().toISOString(),
        reset_source: "admin-api"
      };
      await store.setJSON(CIRCUIT_KEY, circuit);
      return jsonResponse({ ok: true, circuit });
    }
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
