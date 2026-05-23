#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { captionFor, imageUrlFor, publishInstagramItem } from "./instagram_publish_lib.mjs";

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

function shouldSkipFuture(item, includeFuture) {
  if (includeFuture) return false;
  const scheduled = item.instagram_scheduled_publish_time || item.scheduled_publish_time || item.date;
  if (!scheduled) return false;
  return new Date(scheduled).getTime() > Date.now();
}

await loadEnv(arg("env", ".env"));

const queuePath = arg("queue");
const historyPath = arg("history", "outputs/instagram/post-history.json");
const dryRun = flag("dry-run") || !flag("publish");
const includeFuture = flag("include-future");
const allowNotReady = flag("allow-not-ready");
const limit = Number(arg("limit", "0"));
const igUserId = arg("ig-user-id", process.env.META_INSTAGRAM_BUSINESS_ID);
const token = process.env.META_PAGE_ACCESS_TOKEN;

if (!queuePath) {
  console.error("Missing --queue path/to/product-queue.json");
  process.exit(2);
}

if (!igUserId) {
  console.error("Missing META_INSTAGRAM_BUSINESS_ID in .env or --ig-user-id");
  process.exit(2);
}

if (!dryRun && !token) {
  console.error("Missing META_PAGE_ACCESS_TOKEN in .env");
  process.exit(2);
}

const queue = JSON.parse(await fs.readFile(queuePath, "utf8"));
const items = Array.isArray(queue) ? queue : [queue];
let processed = 0;

for (const item of items) {
  if (item.instagram_status === "published") continue;
  if (shouldSkipFuture(item, includeFuture)) continue;
  if (limit && processed >= limit) break;
  if (item.instagram_ready === false && !allowNotReady) {
    item.instagram_status = "blocked";
    item.instagram_error = "Image was not marked Instagram-ready. Review/crop first or pass --allow-not-ready.";
    continue;
  }

  const imageUrl = imageUrlFor(item);
  if (!imageUrl) {
    item.instagram_status = "blocked";
    item.instagram_error = "Missing instagram_image_url, generated_image_url, selected_image_url, or image_url";
    continue;
  }

  const caption = captionFor(item);

  if (dryRun) {
    console.log(JSON.stringify({
      instagram_user_id: igUserId,
      create_container_endpoint: `${igUserId}/media`,
      publish_endpoint: `${igUserId}/media_publish`,
      image_url: imageUrl,
      caption
    }, null, 2));
    processed += 1;
    continue;
  }

  try {
    await publishInstagramItem(item, { token, igUserId });
    processed += 1;
  } catch (error) {
    item.instagram_status = "failed";
    item.instagram_error = error.message;
    processed += 1;
  }
}

if (!dryRun) {
  await fs.writeFile(queuePath, `${JSON.stringify(items, null, 2)}\n`);

  const publishedItems = items.filter((item) => item.instagram_status === "published");
  if (publishedItems.length) {
    let history = { posts: [] };
    try {
      history = JSON.parse(await fs.readFile(historyPath, "utf8"));
    } catch {
      // First publish creates the history file.
    }
    const seen = new Set(history.posts.map((post) => post.instagram_media_id));
    for (const item of publishedItems) {
      if (seen.has(item.instagram_media_id)) continue;
      history.posts.push({
        source_id: item.source_id,
        source_title: item.source_title,
        instagram_media_id: item.instagram_media_id,
        published_at: item.instagram_published_at
      });
    }
    await fs.mkdir(path.dirname(historyPath), { recursive: true });
    await fs.writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
  }
}

if (!processed) {
  console.error(includeFuture ? "No publishable Instagram items found." : "No due Instagram items found. Use --include-future to preview future scheduled items.");
}
