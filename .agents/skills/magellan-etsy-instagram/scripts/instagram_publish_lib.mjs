export function captionCompact(text, limit) {
  return String(text ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit)
    .trim();
}

function compact(text, limit) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, limit).trim();
}

export function captionFor(item) {
  if (item.instagram_caption) return captionCompact(item.instagram_caption, 2200);
  const base = compact(item.description || item.title || item.source_title, 1900);
  const link = compact(item.link || "", 240);
  const tags = [
    "TravelGifts",
    "GiftsForTravelers",
    item.category === "travel-posters" ? "TravelWallArt" : "",
    item.category === "travel-accessories" ? "TravelAccessories" : "",
    item.category === "coastal" ? "CoastalStyle" : "",
    item.category === "desert" ? "DesertAesthetic" : "",
    item.category === "euro-summer" ? "EuropeanSummer" : ""
  ].filter(Boolean);
  const hashtagText = tags.slice(0, 5).map((tag) => `#${tag}`).join(" ");
  return captionCompact([base, link ? `Shop\n${link}` : "", hashtagText].filter(Boolean).join("\n\n"), 2200);
}

export function captionBodyKey(caption) {
  return captionCompact(caption, 2200)
    .replace(/\n\nShop\n[\s\S]*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function imageUrlFor(item) {
  return item.instagram_image_url || item.generated_image_url || item.selected_image_url || item.image_url;
}

export function isDue(item, now = new Date()) {
  const status = item.instagram_status || "queued";
  if (status === "published") return false;
  if (status === "failed" || status === "blocked" || status === "manual_review") return false;
  if (item.instagram_next_retry_at) {
    const retryAt = new Date(item.instagram_next_retry_at).getTime();
    if (Number.isFinite(retryAt) && retryAt > now.getTime()) return false;
  }
  if (status === "publishing") {
    const lockedAt = new Date(item.instagram_publish_lock_at || 0).getTime();
    const stale = Number.isFinite(lockedAt) && now.getTime() - lockedAt > 2 * 60 * 60 * 1000;
    if (!stale) return false;
  }
  if (item.instagram_ready === false) return false;
  const scheduled = item.instagram_scheduled_publish_time || item.scheduled_publish_time || item.date;
  if (!scheduled) return true;
  const timestamp = new Date(scheduled).getTime();
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

async function graphRequest(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Meta request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function graphPost(endpoint, params, token, options = {}) {
  const body = new URLSearchParams(params);
  body.set("access_token", token);

  const response = await graphRequest(`https://graph.facebook.com/v25.0/${endpoint}`, {
    method: "POST",
    body
  }, options.requestTimeoutMs);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function graphGet(endpoint, params, token, options = {}) {
  const query = new URLSearchParams(params);
  query.set("access_token", token);
  const response = await graphRequest(
    `https://graph.facebook.com/v25.0/${endpoint}?${query.toString()}`,
    {},
    options.requestTimeoutMs
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return json;
}

export async function findRecentInstagramDuplicate(item, { token, igUserId, limit = 50 }) {
  if (!token) throw new Error("Missing META_PAGE_ACCESS_TOKEN");
  if (!igUserId) throw new Error("Missing META_INSTAGRAM_BUSINESS_ID");
  const targetKey = captionBodyKey(captionFor(item));
  if (!targetKey) return null;
  const response = await graphGet(
    `${igUserId}/media`,
    { fields: "id,caption,timestamp,permalink", limit: String(limit) },
    token
  );
  const posts = response.data || [];
  return posts.find((post) => captionBodyKey(post.caption || "") === targetKey) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getInstagramContainerStatus(containerId, { token, requestTimeoutMs = 10000 } = {}) {
  if (!token) throw new Error("Missing META_PAGE_ACCESS_TOKEN");
  if (!containerId) throw new Error("Missing Instagram container ID");
  return graphGet(containerId, { fields: "status_code,status" }, token, { requestTimeoutMs });
}

async function waitForContainer(containerId, token, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getInstagramContainerStatus(containerId, { token });
    if (status.status_code === "FINISHED") return status;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(status.status || `Container ${status.status_code}`);
    }
    await sleep(3000);
  }
  throw new Error("Instagram media container was not ready in time");
}

export async function createInstagramContainer(item, { token, igUserId, requestTimeoutMs = 10000 } = {}) {
  if (!token) throw new Error("Missing META_PAGE_ACCESS_TOKEN");
  if (!igUserId) throw new Error("Missing META_INSTAGRAM_BUSINESS_ID");
  if (item.instagram_ready === false) throw new Error("Image was not marked Instagram-ready");

  const imageUrl = imageUrlFor(item);
  if (!imageUrl) throw new Error("Missing Instagram image URL");

  const caption = captionFor(item);
  const container = await graphPost(
    `${igUserId}/media`,
    { image_url: imageUrl, caption },
    token,
    { requestTimeoutMs }
  );
  item.instagram_container_id = container.id;
  item.instagram_status = "container_created";
  item.instagram_container_created_at = new Date().toISOString();
  delete item.instagram_error;
  return { item, container };
}

export async function publishInstagramContainer(item, { token, igUserId, requestTimeoutMs = 10000 } = {}) {
  if (!token) throw new Error("Missing META_PAGE_ACCESS_TOKEN");
  if (!igUserId) throw new Error("Missing META_INSTAGRAM_BUSINESS_ID");
  if (!item.instagram_container_id) throw new Error("Missing Instagram container ID");

  const published = await graphPost(
    `${igUserId}/media_publish`,
    { creation_id: item.instagram_container_id },
    token,
    { requestTimeoutMs }
  );
  item.instagram_status = "published";
  item.instagram_media_id = published.id;
  item.instagram_published_at = new Date().toISOString();
  delete item.instagram_error;
  return { item, published };
}

export async function publishInstagramItem(item, { token, igUserId, containerAttempts = 6, requestTimeoutMs = 10000 } = {}) {
  if (!token) throw new Error("Missing META_PAGE_ACCESS_TOKEN");
  if (!igUserId) throw new Error("Missing META_INSTAGRAM_BUSINESS_ID");
  if (item.instagram_ready === false) throw new Error("Image was not marked Instagram-ready");

  const imageUrl = imageUrlFor(item);
  if (!imageUrl) throw new Error("Missing Instagram image URL");

  const { container } = await createInstagramContainer(item, { token, igUserId, requestTimeoutMs });
  await waitForContainer(container.id, token, containerAttempts);
  return publishInstagramContainer(item, { token, igUserId, requestTimeoutMs });
}
