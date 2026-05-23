#!/usr/bin/env node
import fs from "node:fs/promises";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "magellan-instagram";
const QUEUE_KEY = "monthly-queue";
const HISTORY_KEY = "post-history";

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function loadEnv(filePath = ".env") {
  try {
    const text = await fs.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.NETLIFY_PROJECT_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteID || !token) {
    throw new Error("Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN before using the Blob queue script.");
  }
  return getStore(STORE_NAME, { siteID, token, consistency: "strong" });
}

function remoteEndpoint() {
  const explicit = process.env.MAGELLAN_QUEUE_ENDPOINT;
  const siteUrl = process.env.NETLIFY_SITE_URL || process.env.URL || "https://magellan-travel-gifts.netlify.app";
  return explicit || `${siteUrl.replace(/\/$/, "")}/api/instagram-queue`;
}

async function remoteRequest(method, body, query = "") {
  const token = process.env.MAGELLAN_QUEUE_ADMIN_TOKEN;
  if (!token) throw new Error("Set MAGELLAN_QUEUE_ADMIN_TOKEN to use the remote queue API.");
  const response = await fetch(`${remoteEndpoint()}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

await loadEnv(arg("env", ".env"));

const uploadPath = arg("upload");
const downloadPath = arg("download");
const showStatus = flag("status");
const showHistory = flag("history");
const useRemote = flag("remote");

if (!uploadPath && !downloadPath && !showStatus && !showHistory) {
  console.error("Usage: node netlify_blob_queue.mjs --upload outputs/instagram/YYYY-MM/instagram-posts.json");
  console.error("   or: node netlify_blob_queue.mjs --download outputs/instagram/YYYY-MM/instagram-posts.remote.json");
  console.error("   or: node netlify_blob_queue.mjs --status");
  process.exit(2);
}

const store = useRemote ? null : getBlobStore();

if (uploadPath) {
  const queue = JSON.parse(await fs.readFile(uploadPath, "utf8"));
  if (!Array.isArray(queue)) throw new Error("Queue must be a JSON array.");
  if (useRemote) {
    const result = await remoteRequest("PUT", queue);
    console.log(JSON.stringify(result, null, 2));
  } else {
    await store.setJSON(QUEUE_KEY, queue);
    console.log(`Uploaded ${queue.length} posts to Netlify Blobs: ${STORE_NAME}/${QUEUE_KEY}`);
  }
}

if (downloadPath) {
  const queue = useRemote
    ? (await remoteRequest("GET")).queue
    : await store.get(QUEUE_KEY, { type: "json" });
  if (!queue) throw new Error("No monthly queue found in Netlify Blobs.");
  await fs.writeFile(downloadPath, `${JSON.stringify(queue, null, 2)}\n`);
  console.log(`Downloaded ${queue.length} posts to ${downloadPath}`);
}

if (showStatus) {
  if (useRemote) {
    const { queue, ...status } = await remoteRequest("GET");
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  }
  const queue = await store.get(QUEUE_KEY, { type: "json" });
  if (!queue) {
    console.log("No monthly queue found in Netlify Blobs.");
  } else {
    const counts = queue.reduce((memo, item) => {
      const status = item.instagram_status || "queued";
      memo[status] = (memo[status] || 0) + 1;
      return memo;
    }, {});
    console.log(JSON.stringify({ total: queue.length, counts }, null, 2));
  }
}

if (showHistory) {
  const history = useRemote
    ? await remoteRequest("GET", null, "?history=1")
    : await store.get(HISTORY_KEY, { type: "json" });
  console.log(JSON.stringify(history ?? { posts: [] }, null, 2));
}
