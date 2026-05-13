import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const csvPath = "/Users/sara/Downloads/EtsyListingsDownload.csv";
const shopUrl = "https://www.etsy.com/shop/MagellanTravelGifts";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function cleanTitle(title) {
  return title.replace(/\s+/g, " ").trim();
}

function productType(title, tags) {
  const text = `${title} ${tags}`.toLowerCase();
  const checks = [
    ["passport", "Passport Cover"],
    ["weekender", "Weekender Bag"],
    ["shoulder bag", "Shoulder Bag"],
    ["tote", "Tote Bag"],
    ["pouch", "Accessory Pouch"],
    ["toiletry", "Toiletry Bag"],
    ["laptop", "Laptop Sleeve"],
    ["scarf", "Scarf"],
    ["pillow", "Pillow"],
    ["notebook", "Notebook"],
    ["journal", "Journal"],
    ["tank", "Tank Top"],
    ["tee", "T-Shirt"],
    ["t-shirt", "T-Shirt"],
    ["poster", "Poster"],
    ["print", "Art Print"],
    ["digital", "Digital Download"],
    ["mug", "Mug"],
    ["ornament", "Ornament"],
    ["shoes", "Shoes"]
  ];
  return checks.find(([needle]) => text.includes(needle))?.[1] ?? "Product";
}

function etsyCategory(type, title, tags) {
  const text = `${type} ${title} ${tags}`.toLowerCase();
  if (/poster|print|digital|wall art/.test(text)) return "Art Prints";
  if (/pillow|home|decor/.test(text)) return "Home Decor";
  if (/bag|tote|weekender|shoulder/.test(text)) return "Bags";
  if (/pouch|toiletry|passport|laptop|scarf/.test(text)) return "Travel Accessories";
  if (/tee|t-shirt|tank|shirt|shoes/.test(text)) return "Clothing";
  if (/notebook|journal|office/.test(text)) return "Office";
  if (/mug|kitchen/.test(text)) return "Kitchen";
  if (/ornament|holiday/.test(text)) return "Holiday";
  return "Other";
}

function guideCandidates(title, tags) {
  const text = `${title} ${tags}`.toLowerCase();
  const candidates = [];
  const add = (guide) => {
    if (!candidates.includes(guide)) candidates.push(guide);
  };

  if (/coastal|beach|surf|island|palm|pacifica|pescadero|bodega|big sur|santa cruz|point lobos|point reyes|cypress|dawn patrol/.test(text)) add("Coastal Travel Gifts");
  if (/euro|europe|summer|mediterranean|lisbon|portugal|calligraphy|italy|italian|france|french|greece|greek|spain|spanish/.test(text)) add("Euro Summer");
  if (/desert|southwest|boho|dubai/.test(text)) add("Desert Travel Gifts");
  if (/celestial|stargazer|moon|constellation|sunburst|stars/.test(text)) add("Celestial Travel Gifts");
  if (/poster|print|wall art|digital download|london|new york|zanzibar|california|mountain|forest|smoky|park/.test(text)) add("Travel Wall Art");
  if (/passport|pouch|toiletry|laptop|scarf|weekender|bag|tote/.test(text)) add("Travel Accessories for Her");

  return candidates.length ? candidates : ["Needs Review"];
}

function priority(guide, title, tags) {
  const text = `${title} ${tags}`.toLowerCase();
  if (guide === "Needs Review") return "Review";
  if (/featured|weekender|shoulder bag|passport|laptop|pillow|poster|print|scarf|pouch/.test(text)) return "High";
  return "Medium";
}

function slugSearchUrl(title) {
  return `${shopUrl}?search_query=${encodeURIComponent(title.split("|")[0].trim())}`;
}

function firstSentence(description) {
  const compact = description.replace(/\s+/g, " ").trim();
  const sentence = compact.match(/^(.{30,220}?[.!?])\s/);
  return sentence ? sentence[1] : compact.slice(0, 220);
}

const sourceText = await fs.readFile(csvPath, "utf8");
const sourceRows = parseCsv(sourceText);

const products = sourceRows.map((row, index) => {
  const title = cleanTitle(row.TITLE);
  const tags = row.TAGS ?? "";
  const type = productType(title, tags);
  const category = etsyCategory(type, title, tags);
  const candidates = guideCandidates(title, tags);
  const guide = candidates[0];
  const additionalGuides = candidates.slice(1).join("; ");
  return [
    index + 1,
    title,
    guide,
    additionalGuides,
    category,
    type,
    Number(row.PRICE || 0),
    row.CURRENCY_CODE || "USD",
    Number(row.QUANTITY || 0),
    priority(guide, title, tags),
    row.IMAGE1 || "",
    "",
    slugSearchUrl(title),
    tags,
    firstSentence(row.DESCRIPTION || ""),
    row.SKU || "",
    "From Etsy CSV export; review guide/image/listing URL"
  ];
});

const headers = [
  "CSV Row",
  "Product Name",
  "Primary Gift Guide",
  "Additional Gift Guide Candidates",
  "Etsy Category",
  "Product Type",
  "Price",
  "Currency",
  "Quantity",
  "Landing Page Priority",
  "Primary Image URL",
  "Preferred Image Override",
  "Etsy Listing URL / Search Link",
  "Tags",
  "Short Description Draft",
  "SKU",
  "Notes"
];

const guideNames = [
  "Coastal Travel Gifts",
  "Euro Summer",
  "Desert Travel Gifts",
  "Celestial Travel Gifts",
  "Travel Wall Art",
  "Travel Accessories for Her",
  "Needs Review"
];

const guideSummary = guideNames.map((guide) => {
  const guideRows = products.filter((row) => row[2] === guide || String(row[3]).includes(guide));
  return [
    guide,
    guideRows.length,
    guideRows.filter((row) => row[9] === "High").length,
    guideRows.slice(0, 5).map((row) => row[1]).join("; "),
    guide === "Needs Review" ? "Assign to a guide or remove from landing page pool" : "Choose 6-12 final products and confirm image/listing URLs"
  ];
});

const workbook = Workbook.create();
const productSheet = workbook.worksheets.add("Products");
productSheet.getRange(`A1:Q${products.length + 1}`).values = [headers, ...products];

const guideSheet = workbook.worksheets.add("Guide Summary");
guideSheet.getRange("A1:E8").values = [
  ["Gift Guide", "Draft Product Count", "High Priority Count", "Example Products", "Next Step"],
  ...guideSummary
];

const instructions = workbook.worksheets.add("How to Use");
instructions.getRange("A1:B11").values = [
  ["Purpose", "Working product tracker for Magellan landing pages and gift guides."],
  ["Source", "Built from EtsyListingsDownload.csv, cross-referenced with the first visible Etsy shop page."],
  ["Primary Image URL", "Imported from the Etsy CSV. Replace with a stronger Imgur/local image in Preferred Image Override if desired."],
  ["Etsy Listing URL / Search Link", "CSV export does not include listing IDs, so this column starts as a shop search link. Replace with exact listing URLs."],
  ["Primary Gift Guide", "Best first home for the product. Use this for the main page placement."],
  ["Additional Gift Guide Candidates", "Use semicolon-separated guide names when a product belongs in multiple places, for example: Coastal Travel Gifts; Travel Accessories for Her."],
  ["Landing Page Priority", "High = likely guide/homepage candidate; Medium = supporting slot; Review = needs a decision."],
  ["Guide goal", "Pick 6-12 final products per guide."],
  ["Duplicates", "Some products may be variants or older items. Keep the best listing/card for the guide."],
  ["Next site step", "Once a guide has final images and exact Etsy links, we can populate its page."],
  ["Checkout", "The landing pages stay browse-only; purchases happen on Etsy."]
];

for (const sheet of [productSheet, guideSheet, instructions]) {
  sheet.getRange("A1:Z1").format = {
    font: { bold: true, color: "#f5f5e9" },
    fill: { color: "#040a18" }
  };
}

productSheet.getRange("A:Q").format = { wrapText: true, verticalAlignment: "top" };
guideSheet.getRange("A:E").format = { wrapText: true, verticalAlignment: "top" };
instructions.getRange("A:B").format = { wrapText: true, verticalAlignment: "top" };

productSheet.getRange("A:A").columnWidthPx = 70;
productSheet.getRange("B:B").columnWidthPx = 340;
productSheet.getRange("C:D").columnWidthPx = 220;
productSheet.getRange("E:F").columnWidthPx = 175;
productSheet.getRange("G:I").columnWidthPx = 85;
productSheet.getRange("J:J").columnWidthPx = 145;
productSheet.getRange("K:M").columnWidthPx = 260;
productSheet.getRange("N:N").columnWidthPx = 300;
productSheet.getRange("O:O").columnWidthPx = 340;
productSheet.getRange("P:P").columnWidthPx = 160;
productSheet.getRange("Q:Q").columnWidthPx = 250;
guideSheet.getRange("A:A").columnWidthPx = 230;
guideSheet.getRange("B:C").columnWidthPx = 145;
guideSheet.getRange("D:D").columnWidthPx = 520;
guideSheet.getRange("E:E").columnWidthPx = 310;
instructions.getRange("A:A").columnWidthPx = 170;
instructions.getRange("B:B").columnWidthPx = 720;

const outputDir = "outputs/product-sheet";
await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/magellan-product-tracker.xlsx`);
