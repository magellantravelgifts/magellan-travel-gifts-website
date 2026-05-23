#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const IG_MIN_ASPECT = 4 / 5;
const IG_MAX_ASPECT = 1.91;
const IG_TARGET_ASPECT = 4 / 5;

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function compact(text, limit) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, limit).trim();
}

function captionCompact(text, limit) {
  return String(text ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit)
    .trim();
}

function productType(item) {
  const text = `${item.source_title || ""} ${item.title || ""} ${item.category || ""}`.toLowerCase();
  if (text.includes("passport")) return "passport cover";
  if (text.includes("shoulder bag")) return "shoulder bag";
  if (text.includes("weekender")) return "weekender bag";
  if (text.includes("tote")) return "travel tote";
  if (text.includes("poster") || text.includes("wall art") || text.includes("print")) return "travel print";
  if (text.includes("pouch")) return "travel pouch";
  if (text.includes("mug")) return "travel mug";
  return "travel piece";
}

function feelingLine(item) {
  const text = `${item.source_title || ""} ${item.category || ""}`.toLowerCase();
  if ((text.includes("poster") || text.includes("print") || text.includes("wall art")) && (text.includes("paris") || text.includes("eiffel"))) {
    return "A vivid Paris detail for adding color and a little city energy to a dorm room, apartment, or travel-inspired corner.";
  }
  if (text.includes("desert") && text.includes("passport")) {
    return "A small travel detail that keeps the desert palette close from check-in to boarding.";
  }
  if (text.includes("desert") && (text.includes("bag") || text.includes("tote"))) {
    return "Warm Southwest geometry for the days when errands, weekends, and travel plans all blur together.";
  }
  if (text.includes("desert")) return "Sun-washed color and clean geometry for a space or routine with a little Southwest mood.";
  if (text.includes("coastal")) return "Soft coastal energy for slow mornings, packed bags, and rooms that still feel close to the water.";
  if (text.includes("euro")) return "A light, sunlit detail for keeping that European summer feeling close after the trip.";
  if (text.includes("celestial")) return "Quiet night-sky detail for travelers who like their keepsakes a little more personal.";
  if (text.includes("poster") || text.includes("wall art")) return "For the room that keeps one eye on the next trip.";
  return "Made for the part of travel that lingers after the suitcase is unpacked.";
}

function productLine(item) {
  const type = productType(item);
  const text = `${item.source_title || ""} ${item.category || ""}`.toLowerCase();
  if (type === "shoulder bag") return "A geometric shoulder bag with warm desert tones and an easy travel shape.";
  if (type === "passport cover") return "A passport cover with Southwest-inspired patterning and a polished leather-style finish.";
  if (type === "travel print" && (text.includes("paris") || text.includes("eiffel"))) return "A Paris-inspired print with bright color and a clean travel-poster feel.";
  if (type === "travel print") return "A travel-inspired print made for a room with a little more elsewhere in it.";
  if (type === "travel tote" || type === "weekender bag") return "A carryall made for the small rituals of getting out the door.";
  return `A ${type} with a travel-inspired point of view.`;
}

function hashtagsFor(item) {
  const text = `${item.source_title || ""} ${item.category || ""}`.toLowerCase();
  if (text.includes("desert")) return ["TravelAccessories", "SouthwestStyle", "DesertAesthetic", "GiftsForTravelers", "WanderlustStyle"];
  if (text.includes("coastal")) return ["CoastalStyle", "TravelGifts", "BeachWeekend", "GiftsForTravelers", "SlowTravel"];
  if (text.includes("euro") || text.includes("paris") || text.includes("eiffel")) return ["TravelInspired", "ParisDecor", "EuropeanSummer", "WanderlustDecor", "ApartmentDecor"];
  if (text.includes("poster") || text.includes("wall art") || text.includes("print")) return ["TravelWallArt", "WanderlustDecor", "TravelInspired", "ApartmentDecor", "DormDecor"];
  if (text.includes("passport")) return ["PassportCover", "TravelAccessories", "GiftsForTravelers", "WanderlustStyle", "TravelEssentials"];
  return ["TravelGifts", "TravelInspired", "GiftsForTravelers", "WanderlustStyle", "TravelEssentials"];
}

function captionFor(item) {
  const link = item.link ? `Shop\n${item.link}` : "";
  const tags = hashtagsFor(item).slice(0, 5).map((tag) => `#${tag}`).join(" ");
  return captionCompact(`${productLine(item)}\n\n${feelingLine(item)}\n\n${link}\n\n${tags}`, 700);
}

function uniqueUrls(item) {
  return [
    item.instagram_image_url,
    item.generated_image_url,
    item.selected_image_url,
    item.image_url,
    ...(item.etsy_image_candidates || [])
  ].filter(Boolean).filter((url, index, urls) => urls.indexOf(url) === index);
}

function readJpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function imageDimensions(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return readJpegDimensions(buffer);
  return null;
}

async function probeImage(url) {
  const response = await fetch(url, { headers: { Range: "bytes=0-65535" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const dimensions = imageDimensions(buffer);
  if (!dimensions) throw new Error("Unsupported image format");
  const aspect = dimensions.width / dimensions.height;
  return { url, ...dimensions, aspect, ig_safe: aspect >= IG_MIN_ASPECT && aspect <= IG_MAX_ASPECT };
}

async function selectInstagramImage(item) {
  const candidates = [];
  for (const url of uniqueUrls(item)) {
    try {
      const probed = await probeImage(url);
      const index = uniqueUrls(item).indexOf(url);
      const score = (probed.ig_safe ? 0 : 10) + Math.abs(probed.aspect - IG_TARGET_ASPECT) + index * 0.03;
      candidates.push({ ...probed, score });
    } catch (error) {
      candidates.push({ url, error: error.message, ig_safe: false, score: 99 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const selected = candidates.find((candidate) => candidate.ig_safe) || candidates[0];
  return {
    selected_image: selected,
    image_candidates: candidates.map(({ score, ...candidate }) => candidate)
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

async function writePreview(items, outputDir) {
  const cards = items.map((item, index) => `
    <article>
      <div class="frame"><img src="${item.instagram_image_url}" alt=""></div>
      <h2>Post ${index + 1}</h2>
      <pre>${item.instagram_caption}</pre>
      <p>${item.instagram_image_note}</p>
    </article>
  `).join("\n");
  await fs.writeFile(path.join(outputDir, "preview.html"), `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Magellan Instagram Preview</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; background: #f7f5ef; color: #151515; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 28px; }
    article { background: #fff; border: 1px solid #ddd8cc; padding: 16px; }
    .frame { aspect-ratio: 4 / 5; background: #eee8dc; display: grid; place-items: center; overflow: hidden; }
    img { width: 100%; height: 100%; object-fit: contain; }
    h1 { font-size: 24px; }
    h2 { font-size: 15px; line-height: 1.3; }
    pre { white-space: pre-wrap; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    p { color: #676157; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Instagram Preview</h1>
  <main>${cards}</main>
</body>
</html>
`);
}

const queuePath = arg("queue");
const outputDir = arg("output-dir", `outputs/instagram/${new Date().toISOString().slice(0, 10)}`);
const probeImages = !flag("no-probe");

if (!queuePath) {
  console.error("Missing --queue path/to/product-queue.json");
  process.exit(2);
}

const sourceItems = JSON.parse(await fs.readFile(queuePath, "utf8"));
const items = [];

for (const item of sourceItems) {
  const prepared = { ...item };
  const imageResult = probeImages ? await selectInstagramImage(item) : {
    selected_image: { url: item.instagram_image_url || item.selected_image_url || item.image_url, ig_safe: true },
    image_candidates: []
  };

  prepared.instagram_caption = captionFor(item);
  prepared.instagram_hashtags = hashtagsFor(item).slice(0, 5);
  prepared.instagram_image_url = imageResult.selected_image.url;
  prepared.instagram_image_candidates = imageResult.image_candidates;
  prepared.instagram_image_note = imageResult.selected_image.ig_safe
    ? `Selected IG-safe image at ${imageResult.selected_image.width}x${imageResult.selected_image.height}. Preview uses 4:5 contain framing so the product is not cut off.`
    : "No IG-safe Etsy image found. Review or crop/upload a 4:5 image before publishing.";
  prepared.instagram_ready = Boolean(imageResult.selected_image.ig_safe);
  items.push(prepared);
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "instagram-posts.json"), `${JSON.stringify(items, null, 2)}\n`);
await fs.writeFile(path.join(outputDir, "instagram-posts.csv"), [
  ["id", "source_title", "instagram_ready", "instagram_image_url", "instagram_caption", "link"].join(","),
  ...items.map((item) => [
    item.id,
    item.source_title,
    item.instagram_ready,
    item.instagram_image_url,
    item.instagram_caption,
    item.link
  ].map(csvEscape).join(","))
].join("\n"));
await writePreview(items, outputDir);

console.log(`Wrote ${items.length} Instagram posts to ${outputDir}`);
