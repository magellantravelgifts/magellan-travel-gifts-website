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

function seedNumber(text) {
  let hash = 2166136261;
  for (const char of String(text ?? "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(options, seed) {
  return options[Math.abs(seed) % options.length];
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
  if (text.includes("wrapping paper") || text.includes("gift wrap")) return "gift wrap";
  if (text.includes("passport")) return "passport cover";
  if (text.includes("wallet") || text.includes("wrist purse") || text.includes("clutch")) return "travel wallet";
  if (text.includes("shoulder bag")) return "shoulder bag";
  if (text.includes("weekender")) return "weekender bag";
  if (text.includes("tote")) return "travel tote";
  if (text.includes("scarf")) return "travel scarf";
  if (text.includes("pillow")) return "accent pillow";
  if (text.includes("laptop sleeve")) return "laptop sleeve";
  if (text.includes("candle")) return "travel-inspired candle";
  if (text.includes("journal") || text.includes("notebook")) return "travel journal";
  if (text.includes("shirt") || text.includes("tee") || text.includes("tank")) return "travel tee";
  if (text.includes("flip flop") || text.includes("sandal")) return "beach sandals";
  if (text.includes("beach towel") || text.includes("towel")) return "beach towel";
  if (text.includes("desk mat")) return "desk mat";
  if (text.includes("poster") || text.includes("wall art") || text.includes("print")) return "travel print";
  if (text.includes("pouch")) return "travel pouch";
  if (text.includes("mug")) return "travel mug";
  return "travel piece";
}

function textFor(item) {
  return `${item.source_title || ""} ${item.title || ""} ${item.description || ""} ${item.category || ""} ${(item.category_keywords || []).join(" ")}`.toLowerCase();
}

function placeFor(item) {
  const text = textFor(item);
  const places = [
    ["paris|eiffel|french|amour", "Paris"],
    ["italy|italian|ciao", "Italy"],
    ["new york|nyc|empire state", "New York"],
    ["sydney|opera house|australia", "Sydney"],
    ["santa cruz|boardwalk", "Santa Cruz"],
    ["bodega bay", "Bodega Bay"],
    ["point lobos", "Point Lobos"],
    ["point reyes", "Point Reyes"],
    ["pescadero", "Pescadero"],
    ["big sur", "Big Sur"],
    ["japandi|japanese|sakura|moonlit landscape", "Japandi"],
    ["arabian|arabesque|arab nights|brown square", "Arabian desert"],
    ["lisbon|portugal|azulejo", "Lisbon"],
    ["dubai|arabian", "Dubai"],
    ["zanzibar", "Zanzibar"],
    ["african|africa", "Africa"],
    ["smoky|smokey|national park", "the Smokies"],
    ["mountain|lake|cabin", "the mountains"],
    ["celestial|stargazer|moon|constellation|sunburst|sun and moon", "the night sky"],
    ["desert|southwest|desert rose", "the Southwest"],
    ["coastal|beach|surf|island|palm", "the coast"],
    ["california|redwood", "California"]
  ];
  return places.find(([pattern]) => new RegExp(pattern).test(text))?.[1] || "";
}

function detailFor(item) {
  const text = textFor(item);
  const details = [
    ["ciao bella", "Italian script"],
    ["ciao|italian|italy", "Italian summer ease"],
    ["amour|french love|parisian", "Parisian script"],
    ["arabian|arabesque|arab nights|brown square", "brown Arabian tile texture"],
    ["sakura|japanese|japandi|moonlit landscape", "moonlit Japandi calm"],
    ["patina blue|azulejo|portugal", "blue-tile color"],
    ["turquoise", "turquoise color"],
    ["navy", "navy contrast"],
    ["maroon", "deep maroon color"],
    ["bright pink|hot pink", "bright pink energy"],
    ["sunset", "sunset color"],
    ["sunrise", "early-morning surf energy"],
    ["dawn patrol", "that early surf-morning feeling"],
    ["cypress|tree tunnel", "cypress shade"],
    ["bixby|bridge", "the bridge-and-coast view"],
    ["boardwalk", "boardwalk nostalgia"],
    ["opera house", "architectural color"],
    ["empire state|cityscape", "city lights"],
    ["eiffel|paris", "Paris color"],
    ["palm", "palm-leaf pattern"],
    ["pineapple", "pineapple brightness"],
    ["mediterranean|calligraphy", "Mediterranean linework"],
    ["sakura|japanese|japandi", "moonlit sakura mood"],
    ["mountain|lake", "mountain-lake quiet"],
    ["moon|sun|celestial|stargazer", "celestial detail"],
    ["desert rose", "desert rose geometry"],
    ["southwest|desert", "Southwest geometry"],
    ["coastal|beach|surf|island", "coastal ease"],
    ["makeup|toiletry|cosmetic", "organized travel-bag energy"],
    ["dorm|apartment", "dorm-room color"],
    ["wallet|clutch", "small-bag polish"],
    ["scarf", "lightweight layering"],
    ["mug", "slow-morning ritual"],
    ["candle", "soft evening atmosphere"],
    ["notebook|journal", "notes-and-plans energy"],
    ["pillow", "room-softening texture"],
    ["tee|shirt|tank", "summer outfit ease"]
  ];
  return details.find(([pattern]) => new RegExp(pattern).test(text))?.[1] || "travel-minded detail";
}

function productLine(item) {
  const type = productType(item);
  const text = textFor(item);
  const place = placeFor(item);
  const detail = detailFor(item);
  const seed = seedNumber(`${item.source_id || ""}${item.source_title || ""}${item.date || ""}`);
  if (type === "travel print" && place) {
    const adjective = place.startsWith("the ") ? place.slice(4) : place;
    return pick([
      `A ${adjective}-inspired art print with ${detail} and a clean travel-poster point of view.`,
      `A destination print built around ${detail}, made to give a room a stronger sense of place.`,
      `A travel-poster style print that brings ${adjective} into the room through ${detail}.`,
      `A graphic wall-art moment with ${detail}, tuned for a room that wants more place and less filler.`
    ], seed);
  }
  if (type === "travel print") return pick([
    `A landscape-minded art print with ${detail} and enough atmosphere to change the feel of a room.`,
    `A wall-art piece built around ${detail}, made for rooms that keep travel close.`,
    `A print with ${detail}, made to make an apartment or dorm feel more collected.`
  ], seed);
  if (type === "shoulder bag") return pick([
    `A structured shoulder bag with ${detail} and enough polish for airport days or city errands.`,
    `A polished shoulder bag that turns ${detail} into an everyday travel accessory.`,
    `A carry-everywhere shoulder bag with ${detail} and a warm, destination-led feel.`
  ], seed);
  if (type === "travel tote" || type === "weekender bag") return pick([
    `A roomy carryall with ${detail} built into the pattern, not pasted on top.`,
    `A travel-ready bag with ${detail}, sized for errands, weekends, and the in-between.`,
    `A carryall that brings ${detail} to the practical side of getting out the door.`
  ], seed);
  if (type === "passport cover") return pick([
    `A passport cover with ${detail}, made to make the smallest part of the trip feel considered.`,
    `A travel-document cover that gives check-in and boarding a more personal detail.`,
    `A passport cover that keeps ${detail} close from the first airport line.`
  ], seed);
  if (type === "travel wallet") return pick([
    `A compact travel wallet with ${place ? `${place} ` : ""}${detail} and an easy grab-and-go shape.`,
    `A small travel clutch that turns ${detail} into something useful and polished.`,
    `A wallet-sized travel piece with ${detail}, made for the things you actually reach for.`
  ], seed);
  if (type === "travel pouch") return pick([
    `A small travel pouch with ${detail} for the things that usually disappear at the bottom of a bag.`,
    `A zip pouch that makes ${detail} feel useful: makeup, cables, receipts, and tiny trip essentials.`,
    `A travel pouch with ${detail}, made for beach bags, carry-ons, and everyday spillover.`
  ], seed);
  if (type === "travel scarf") return pick([
    `A light travel scarf with ${detail} to dress up the basics in a suitcase.`,
    `A packable scarf that brings ${detail} into simple warm-weather outfits.`,
    `A soft scarf with ${detail}, made for the part of travel that still wants polish.`
  ], seed);
  if (type === "accent pillow") return pick([
    `An accent pillow with ${detail}, bringing a destination mood into the room without making it feel themed.`,
    `A room-softening pillow that uses ${detail} as the travel cue.`,
    `A decorative pillow with ${detail}, made for a sofa, bed, or reading corner that wants more place.`
  ], seed);
  if (type === "travel mug") return pick([
    `A ceramic mug with ${detail} for the version of a morning that still feels a little elsewhere.`,
    `A travel-minded mug that turns ${detail} into a small morning ritual.`,
    `A mug with ${detail}, made for coffee, daydreaming, and a little Paris-at-home energy.`
  ], seed);
  if (type === "travel-inspired candle") return pick([
    `A candle with ${detail}: quiet, atmospheric, and made for slow evenings.`,
    `A scent-led travel mood with ${detail}, built for reading corners and soft light.`,
    `A candle that makes ${detail} feel like part of the room, not just the label.`
  ], seed);
  if (type === "travel journal") return pick([
    `A journal with ${detail} for trip notes, packing lists, and the details you think you will remember later.`,
    `A spiral notebook with ${detail}, made for plans, class notes, and the next place on the list.`,
    `A travel-minded journal where ${detail} gives everyday notes a little more place.`
  ], seed);
  if (type === "travel tee") return pick([
    `A casual travel tee with ${detail} and an easy beach-day or city-break mood.`,
    `A warm-weather tee that brings ${detail} into an easy summer outfit.`,
    `A relaxed tee with ${detail}, made for beach walks, coffee runs, and carry-on packing.`
  ], seed);
  if (type === "laptop sleeve") return pick([
    `A laptop sleeve with ${detail}, made to keep everyday tech from feeling purely practical.`,
    `A padded computer sleeve that turns ${detail} into something useful for work, school, and travel days.`,
    `A slim laptop sleeve with ${detail}, made for the part of travel that happens between tabs, gates, and desks.`
  ], seed);
  if (type === "beach towel") return `A beach towel with ${detail} and a clear summer-weekend point of view.`;
  if (type === "beach sandals") return pick([
    `Beach sandals with ${detail}, made for warm sidewalks, pool decks, and overpacked weekend bags.`,
    `Easy sandals that turn ${detail} into a small vacation cue.`,
    `A beach-day pair with ${detail}, light enough for the suitcase and bright enough for summer.`
  ], seed);
  if (type === "desk mat") return `A desk mat with ${detail}, bringing a little vacation color into the everyday workspace.`;
  if (text.includes("summer")) return "A warm-weather travel piece with a light, vacation-ready feel.";
  return `A ${type} with a specific travel mood and a polished everyday use case.`;
}

function feelingLine(item) {
  const text = textFor(item);
  const place = placeFor(item);
  const detail = detailFor(item);
  const seed = seedNumber(`${item.source_title || ""}${item.link || ""}`);
  if (place === "Paris") return pick([
    `That feeling of remembering Paris in color: ${detail}, small rooms, and the version of yourself that stayed a little longer.`,
    `Paris as a daily cue: a little romance, a little color, and the feeling that the trip is not fully over.`,
    `For the Paris mood that belongs in the everyday: coffee, windows, color, and a room with more story.`
  ], seed);
  if (place === "Italy") return pick([
    `For the Euro summer mood that starts with one word: ciao, sun-warmed streets, and a suitcase that stays light.`,
    `A little Italy energy for easy summer outfits: simple, warm, and ready for late dinners outside.`,
    `For the part of travel that feels like espresso, linen, and saying yes to one more walk.`
  ], seed);
  if (place === "New York") return pick([
    `A little New York energy for the room: ${detail}, vertical, nostalgic, and still moving after the trip is over.`,
    `For bringing New York back into the apartment without making it feel like a souvenir wall.`,
    `That city-after-dark feeling: bright color, tall buildings, and a room with more momentum.`
  ], seed);
  if (place === "Sydney") return pick([
    `For the part of summer travel that feels bright, architectural, and just far enough away.`,
    `Sydney in color: iconic lines, warm light, and the feeling of planning a trip bigger than the calendar.`,
    `A small reminder of harbors, long-haul flights, and the kind of summer that feels wide open.`
  ], seed);
  if (place === "Santa Cruz") return "Boardwalk color, beach air, and the kind of coastal nostalgia that makes a dorm or apartment feel less temporary.";
  if (place === "Bodega Bay") return "A quieter California coast mood: pale light, ocean air, and a room that still remembers the drive north.";
  if (place === "Point Lobos") return "A little Central Coast drama for the wall: cypress, sea air, and the kind of view that makes summer feel bigger.";
  if (place === "Point Reyes") return "A quieter Northern California summer mood: cypress shade, coastal fog, and the road-trip feeling that stays with you.";
  if (place === "Pescadero") return "That half-hidden stretch of California coast: beach grass, soft fog, and a summer room with a little more air in it.";
  if (place === "Big Sur") return "For the Bixby Bridge kind of summer: cliffs, salt air, and a wall that remembers the road trip.";
  if (place === "California") return "A California coast reminder for the room: sun, sea air, and the kind of view that makes summer feel less far away.";
  if (place === "Lisbon") return "For keeping that European summer feeling close: tile color, warm evenings, and a little more texture in the everyday.";
  if (place === "Dubai") return "Desert geometry and warm-night color for the travel mood that feels polished, sunlit, and far from ordinary.";
  if (place === "Arabian desert") return "Brown tile texture, warm desert rooms, and the kind of pattern that feels collected rather than themed.";
  if (place === "Zanzibar") return "Island color for the small pieces you reach for on summer weekends and longer escapes.";
  if (place === "Africa") return "For notes, plans, and desk days that could use more pattern, movement, and faraway color.";
  if (place === "Japandi") return "Moonlit sakura, soft contrast, and a quieter celestial mood for a room that wants calm instead of noise.";
  if (place === "the Southwest") return pick([
    `Sun-baked color and ${detail} for the days when travel plans start to feel close again.`,
    `For the desert mood that works past vacation: warm color, clean geometry, and a little more intention.`,
    `A small Southwest cue for airport days, summer errands, and rooms that like warmer color.`
  ], seed);
  if (place === "the coast") return pick([
    `Made for beach weekends, open windows, and the easy rhythm of packing light.`,
    `For summer days that start with sunscreen, extra room in the bag, and nowhere too formal to be.`,
    `A coastal cue for the everyday: salt air, soft color, and the feeling of leaving early.`
  ], seed);
  if (place === "the mountains") return "A reminder of lake air, quiet mornings, and the kind of room that makes space for getting away.";
  if (place === "the night sky") return pick([
    `For travelers who keep one eye on the window seat and one eye on the stars.`,
    `A quieter celestial mood for rooms, desks, and travel days that feel better with a little night-sky detail.`,
    `For the part of travel that feels reflective: moonlight, notes, and the pull of somewhere beyond the usual route.`
  ], seed);
  if (/tropical|pineapple|island/.test(text)) return pick([
    `For pool bags, beach weekends, and the small burst of color that makes summer packing more fun.`,
    `A little island color for the days when the errand bag and beach bag become the same thing.`,
    `For the version of summer that likes bright pattern, light packing, and plans after lunch.`
  ], seed);
  if (/euro|europe|mediterranean|italy|greece|spain/.test(text)) return "For the Euro summer mood: sun on stone, linen in a suitcase, and plans that start with a map.";
  if (/summer solstice|sun|moon/.test(text)) return "A small nod to the long-light days of June and the kind of rooms that feel better with a little glow.";
  return "For the part of travel that turns into a room, a routine, or a small object you keep reaching for.";
}

function hashtagsFor(item) {
  const text = textFor(item);
  if (text.includes("italy") || text.includes("italian") || text.includes("ciao")) return ["EuropeanSummer", "ItalyTravel", "TravelOutfit", "SummerStyle", "EuroSummer"];
  if (text.includes("amour") || text.includes("french love")) return ["EuropeanSummer", "ParisianStyle", "TravelOutfit", "FrenchStyle", "EuroSummer"];
  if (text.includes("japandi") || text.includes("japanese") || text.includes("sakura") || text.includes("moonlit landscape")) return ["JapandiDecor", "CelestialDecor", "JapaneseWallArt", "MoonArt", "ApartmentDecor"];
  if (text.includes("arabian") || text.includes("arabesque") || text.includes("brown square")) return ["DesertDecor", "ArabianNights", "TexturedHome", "BohoInterior", "TravelInspired"];
  if (text.includes("moon") || text.includes("sun") || text.includes("celestial") || text.includes("stargazer")) return ["CelestialDecor", "MoonAndStars", "TravelInspired", "WanderlustStyle", "GiftsForTravelers"];
  if (text.includes("mountain") || text.includes("lake") || text.includes("boho")) return ["BohoDecor", "MountainWallArt", "TravelWallArt", "ApartmentDecor", "WanderlustDecor"];
  if (text.includes("new york") || text.includes("empire state") || text.includes("nyc")) return ["TravelWallArt", "NewYorkDecor", "CityApartment", "DormDecor", "WanderlustDecor"];
  if (text.includes("sydney") || text.includes("australia")) return ["TravelWallArt", "AustraliaTravel", "SummerDecor", "ApartmentDecor", "WanderlustDecor"];
  if (text.includes("desert")) return ["TravelAccessories", "SouthwestStyle", "DesertAesthetic", "GiftsForTravelers", "WanderlustStyle"];
  if (text.includes("coastal") || text.includes("beach") || text.includes("surf")) return ["CoastalStyle", "TravelGifts", "BeachWeekend", "GiftsForTravelers", "SlowTravel"];
  if (text.includes("euro") || text.includes("paris") || text.includes("eiffel") || text.includes("lisbon")) return ["TravelInspired", "ParisDecor", "EuropeanSummer", "WanderlustDecor", "ApartmentDecor"];
  if (text.includes("poster") || text.includes("wall art") || text.includes("print")) return ["TravelWallArt", "WanderlustDecor", "TravelInspired", "ApartmentDecor", "DormDecor"];
  if (text.includes("passport")) return ["PassportCover", "TravelAccessories", "GiftsForTravelers", "WanderlustStyle", "TravelEssentials"];
  return ["TravelGifts", "TravelInspired", "GiftsForTravelers", "WanderlustStyle", "TravelEssentials"];
}

function uniquenessLine(item, collisionIndex) {
  const type = productType(item);
  const detail = detailFor(item);
  const place = placeFor(item);
  const options = [
    `This version leans into ${detail}, so it reads less like a generic travel piece and more like a specific summer cue.`,
    place ? `The ${place} reference gives it a clearer sense of place without turning the caption into a product title.` : `The ${detail} is the useful hook here: specific enough to feel styled, but still easy to live with.`,
    type === "travel tee" ? `It is the kind of piece that works best on the casual side of travel: beach mornings, coffee runs, and warm evenings.` : `It is meant to feel considered in use, not just attractive in a listing photo.`,
    type === "travel pouch" ? `The useful part is the scale: small enough for a carry-on, visible enough to make packing feel less chaotic.` : `The detail keeps the mood grounded in the actual product instead of floating into generic wanderlust copy.`,
    type === "accent pillow" ? `For a room, the point is texture and atmosphere: enough travel mood to notice, not so much that it takes over.` : `The strongest click cue is the feeling it suggests around the product, not a louder sales pitch.`
  ];
  return pick(options, seedNumber(`${item.source_title || ""}${item.id || ""}${collisionIndex}`));
}

function captionBodyFor(item, collisionIndex = 0) {
  const extra = collisionIndex > 0 ? `\n\n${uniquenessLine(item, collisionIndex)}` : "";
  return captionCompact(`${productLine(item)}\n\n${feelingLine(item)}${extra}`, 520);
}

function captionFor(item, collisionIndex = 0) {
  const link = item.link ? `Shop\n${item.link}` : "";
  const tags = hashtagsFor(item).slice(0, 5).map((tag) => `#${tag}`).join(" ");
  return captionCompact(`${captionBodyFor(item, collisionIndex)}\n\n${link}\n\n${tags}`, 700);
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
  const urls = uniqueUrls(item);
  const candidates = [];
  for (const [index, url] of urls.entries()) {
    try {
      const probed = await probeImage(url);
      const latePenalty = index >= 5 ? 8 : 0;
      const score = (probed.ig_safe ? 0 : 100) + index * 2 + latePenalty + Math.abs(probed.aspect - IG_TARGET_ASPECT) * 0.2;
      candidates.push({ ...probed, original_index: index, score });
    } catch (error) {
      candidates.push({ url, original_index: index, error: error.message, ig_safe: false, score: 999 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const selected = candidates.find((candidate) => candidate.ig_safe && candidate.original_index < 5) || candidates.find((candidate) => candidate.ig_safe) || candidates[0];
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
const usedCaptionBodies = new Set();

for (const item of sourceItems) {
  const prepared = { ...item };
  const imageResult = probeImages ? await selectInstagramImage(item) : {
    selected_image: { url: item.instagram_image_url || item.selected_image_url || item.image_url, ig_safe: true },
    image_candidates: []
  };

  let collisionIndex = 0;
  let caption = captionFor(item, collisionIndex);
  while (usedCaptionBodies.has(caption.replace(/\n\nShop\n[\s\S]*/, "").trim())) {
    collisionIndex += 1;
    caption = captionFor(item, collisionIndex);
  }
  usedCaptionBodies.add(caption.replace(/\n\nShop\n[\s\S]*/, "").trim());
  prepared.instagram_caption = caption;
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
