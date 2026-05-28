---
name: magellan-etsy-instagram
description: Automate Magellan Travel Gifts Instagram publishing from reviewed Etsy product queues, image URLs, or product metadata using the Meta Instagram Graph API.
---

# Magellan Etsy Instagram

## Overview

Use this skill to prepare, preview, and publish Magellan Travel Gifts Instagram posts from approved product metadata. Instagram is separate from Pinterest: it uses Meta app credentials, an Instagram Business Account ID, and media container publishing.

Brand direction: clean, warm, aspirational, travel-inspired, and product-aware without sounding like an ad. Keep the language closer to boutique travel goods, considered gifting, memory-based travel, elevated accessories, coastal/desert/European mood, and accessible luxury than to hard selling.

Confirmed account IDs:

- Facebook Page ID: `104486471856540`
- Instagram Business Account ID: `17841447449196210`
- Instagram username: `magellantravelgifts`

## Credentials

Keep credentials in the project `.env` file:

```bash
META_APP_ID=1753417952316133
META_FACEBOOK_PAGE_ID=104486471856540
META_INSTAGRAM_BUSINESS_ID=17841447449196210
META_PAGE_ACCESS_TOKEN=...
```

Never commit `.env`.

## Workflow

Prepare Instagram-specific posts first:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/prepare_instagram_posts.mjs \
  --queue outputs/pinterest/YYYY-MM-DD/daily-pins.json \
  --output-dir outputs/instagram/YYYY-MM-DD
```

Review:

```bash
open outputs/instagram/YYYY-MM-DD/preview.html
```

Dry-run the publisher:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/publish_instagram_api.mjs \
  --queue outputs/instagram/YYYY-MM-DD/instagram-posts.json \
  --dry-run \
  --include-future \
  --limit 1
```

Publish one approved due item:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/publish_instagram_api.mjs \
  --queue outputs/instagram/YYYY-MM-DD/instagram-posts.json \
  --publish \
  --limit 1
```

Set local due times on the prepared queue:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/schedule_instagram_posts.mjs \
  --queue outputs/instagram/YYYY-MM-DD/instagram-posts.json \
  --times 09:30,14:00,18:30 \
  --start-date YYYY-MM-DD \
  --days 30
```

Upload approved/scheduled posts to Netlify Blobs for the hourly scheduler:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --upload outputs/instagram/YYYY-MM/instagram-posts.json \
  --remote
```

Check remote queue status:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --status \
  --remote
```

## Queue Rules

- Treat Pinterest queue files as shared product metadata only, not a Pinterest dependency.
- Use `instagram_image_url`, `generated_image_url`, `selected_image_url`, or `image_url`, in that order.
- Use `instagram_caption` when present; otherwise build a caption from the product description/title/link.
- Do not publish future scheduled items unless explicitly passed `--include-future`.
- Do not publish items marked `instagram_ready: false` unless explicitly passed `--allow-not-ready`.
- Use `--dry-run` before any live post.
- Netlify production scheduling reads and writes the approved queue from the `magellan-instagram` Blob store under key `monthly-queue`.
- The Netlify Scheduled Function runs hourly and publishes only due posts.
- The protected `/api/instagram-queue` function uploads/checks the queue using `MAGELLAN_QUEUE_ADMIN_TOKEN`.

## Caption Rules

Every Instagram caption must include:

- A concrete description of the posted product, written naturally and not copied from the Etsy title.
- A succinct feeling-led line that clearly relates to the specific destination, product, image, or use case.
- The Etsy product link.
- Exactly 5 recent/relevant hashtags.

Do not start captions with Etsy listing titles or SEO-style product names. Instagram posts do not need titles; the preview should label items as internal post numbers, not public-facing titles.

Caption language must vary by product. Avoid generic repeatable lines such as "travel-inspired print" or "room with a little more elsewhere in it" unless the item truly has no better signal. Use the item title, tags, category keywords, and description to identify concrete hooks such as Paris, New York, Sydney, coastal California, Lisbon, the Southwest, beach weekends, dorm decor, Euro summer, summer travel, or summer solstice.

Approval batches must not repeat the same caption body across multiple posts. Similar products can share a broad mood, but each post needs distinct wording based on its color, destination, pattern, product type, image cue, or use case.

Hashtag strategy:

- Use 2 niche/category tags, 1 aesthetic or trend tag, 1 audience/use-case tag, and 1 contextual travel/decor tag.
- Prefer specific tags such as `#TravelAccessories`, `#TravelWallArt`, `#SouthwestStyle`, `#CoastalStyle`, `#EuropeanSummer`, `#WanderlustDecor`, and `#GiftsForTravelers`.
- Avoid broad filler tags like `#love`, `#instagood`, `#shopnow`, long generic stacks, or low-utility branded tags such as `#MagellanTravelGifts`.

## Image Rules

- Instagram feed images should be safe within the 4:5 to 1.91:1 aspect-ratio range.
- Prefer 4:5 portrait images for product posts.
- Probe all Etsy image candidates before publishing when available.
- Select an Etsy image that already fits Instagram framing; do not use an image that would crop the product awkwardly.
- Product image quality matters more than aspect-ratio perfection. Prefer the primary/catalog product image and early Etsy product-photo candidates over late listing images.
- Never choose Etsy download-instruction, size-chart, policy, or informational images as publishable Instagram images.
- Avoid all-white-background product photos for approval batches unless there is no styled alternative; mark for review instead of silently using an ugly image.
- If no Etsy candidate is Instagram-safe, mark the item not ready and require a reviewed 4:5 crop/upload before publishing.

## Seasonal Selection Rules

- For May/June and other summer batches, avoid winter, Christmas, pine-tree holiday wrap, Halloween, sugar skull, fall-only, dark academia, witchcraft, and heavy cold-weather products.
- Prefer summer travel, coastal, Euro summer, beach weekend, dorm/apartment decor, summer solstice, passport, carryall, pouch, wallet, scarf, mug, candle, and travel wall-art products.
- Use the generated Etsy product URL from the Google Sheet catalog, such as `https://magellantravelgifts.etsy.com/listing/...`, as the product link source. Do not fall back to broad Etsy shop search URLs for approval batches unless explicitly accepted for that run.

## Scripts

- `scripts/prepare_instagram_posts.mjs`: turns reviewed product queue items into Instagram-specific post objects, generates captions/hashtags, checks Etsy image dimensions, selects an Instagram-safe image, and writes a preview.
- `scripts/schedule_instagram_posts.mjs`: adds `instagram_scheduled_publish_time` values to approved queue items so the publisher only posts when items are due.
- `scripts/publish_instagram_api.mjs`: creates an Instagram media container, publishes it, updates the queue item with Instagram IDs, and appends `outputs/instagram/post-history.json`.
- `scripts/netlify_blob_queue.mjs`: uploads/downloads/checks the approved queue in Netlify Blobs for production scheduling.
