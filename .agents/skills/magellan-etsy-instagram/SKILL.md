---
name: magellan-etsy-instagram
description: Build, review, schedule, and upload Magellan Travel Gifts static Instagram feed automations from the approved Google Sheets product catalog, with exact collection filtering, Etsy or Shopify destinations, image and caption QA, a single batch-approval gate, and Netlify Blob scheduling. Use when Codex needs to prepare a complete Instagram posting queue, refresh a monthly queue, preview posts, or upload an approved queue for automated publishing.
---

# Magellan Instagram Automation

Build a complete static-feed automation in one invocation, but never upload or publish it without one explicit batch approval. Keep Instagram operationally separate from Pinterest.

## Fixed account and scheduler

- Instagram username: `magellantravelgifts`
- Instagram Business Account ID: `17841447449196210`
- Facebook Page ID: `104486471856540`
- Netlify Blob store: `magellan-instagram`
- Queue key: `monthly-queue`
- Scheduled Function cadence: four fixed publishing windows plus one recovery window
- Default posting windows: `09:30`, `12:30`, `15:30`, and `18:30` in `America/Los_Angeles`
- Netlify execution windows for August and September (PDT): `09:25`, `12:25`, `15:25`, and `18:25` Pacific
- Netlify recovery window for August and September (PDT): `18:40` Pacific
- Netlify UTC cron for August and September (PDT): `25 1,16,19,22 * * *`
- Netlify UTC recovery cron for August and September (PDT): `40 1 * * *`

The cron runs at 01:25, 16:25, 19:25, and 22:25 UTC. In August and September
these correspond to 18:25 on the prior UTC date, then 09:25, 12:25, and 15:25
Pacific. Each run may select one post scheduled within the next five minutes,
so the public posting targets remain 09:30, 12:30, 15:30, and 18:30 while
absorbing normal platform invocation delay. Netlify cron is UTC-only; after the daylight-saving transition these
windows occur one hour earlier in Pacific time unless the cron is deliberately
updated in a reviewed production deployment.

The separate `18:40` Pacific recovery invocation is the fifth and final daily
request. It processes only overdue or recoverable work left by the `18:25`
invocation; otherwise it exits immediately. This prevents a transient function
timeout or lock collision from delaying the post until the next morning. If
that final recovery invocation is still blocked by an active run, it observes
the queue for 20 seconds. It submits the failure form only when overdue work
still remains after that observation period, avoiding both silent misses and
duplicate-invocation false alarms.

Keep secrets in the project `.env` and never commit it:

```bash
META_APP_ID=1753417952316133
META_FACEBOOK_PAGE_ID=104486471856540
META_INSTAGRAM_BUSINESS_ID=17841447449196210
META_PAGE_ACCESS_TOKEN=...
MAGELLAN_QUEUE_ADMIN_TOKEN=...
MAGELLAN_IG_SCHEDULER_ENABLED=false
MAGELLAN_IG_ALERT_WEBHOOK_URL=...
# Optional when the alert endpoint requires bearer authentication:
MAGELLAN_IG_ALERT_WEBHOOK_BEARER_TOKEN=...
```

Keep `MAGELLAN_IG_SCHEDULER_ENABLED=false` while no approved queue is active.
Set it to `true` only when an approved batch is ready to publish. Enabling the
scheduler or resetting its circuit breaker can cause due posts to publish and
therefore requires explicit user approval.

## Predictable scheduling and cost controls

- Use one to four fixed daily times; never randomize posting times.
- Default to the four Pacific windows above. Use fewer windows only when the
  user requests a lower cadence.
- Schedule at most one post in each window.
- The scheduler makes at most five scheduled runs per day: four primary checks
  and one final recovery check.
- A run processes at most one post and uses bounded Meta request timeouts.
- A recoverable failure gets exactly one guarded retry inside the same scheduled
  invocation, so normal usage remains four job requests per day. A post stops
  after two failed attempts. Ambiguous publish responses go directly to
  `manual_review` so the scheduler cannot create a duplicate post.
- Three consecutive scheduler failures open the circuit breaker. An open
  circuit blocks all further Meta calls until the user reviews the alert and
  explicitly approves a reset.
- Completed or future-only queues exit before acquiring a run lock.

## Failure alerts

Every scheduler error, stale-work recovery, delayed container, and circuit-breaker
event is retained in the `scheduler-alerts` Netlify Blob (latest 100 records)
and written to the function log. When `MAGELLAN_IG_ALERT_WEBHOOK_URL` is set,
the same alert is sent once to that webhook with a two-second timeout.

Final job failures also submit the hidden Netlify form
`instagram-scheduler-failure`. Configure a form-submission email notification
for that exact form in Netlify. This uses no extra scheduled-function request;
it creates one form submission only after both safe publishing attempts fail.
Do not claim email alerting is active until the form notification is configured
and a test submission is received.

Before enabling a campaign:

1. Configure and test the `instagram-scheduler-failure` Netlify Forms email
   notification; configure the optional webhook separately when wanted.
2. Confirm `--health --remote` reports a closed circuit.
3. Confirm the approved queue has no `failed` or `manual_review` items.
4. Set `MAGELLAN_IG_SCHEDULER_ENABLED=true` only with explicit approval.

Resetting the circuit is a publish-enabling action. Show the latest alert and
affected queue item first, then obtain explicit approval for:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --reset-circuit \
  --remote
```

## Source-of-truth order

Read both workbooks live before every build. Treat them as read-only unless the user separately asks for spreadsheet edits.

1. Automation catalog: [Magellan Product Tracker - Collections Updated](https://docs.google.com/spreadsheets/d/1cFNSrO9m9-ivRTqhO5r4bphVCITH6ORjepzyyeAxtew/edit?gid=675421768#gid=675421768), exact tab `Products`, `sheetId=675421768`.
   - Required fields: `Product Name`, `Primary Image URL`, `Etsy Listing URL / Search Link`, `Tags`, `Short Description Draft`, `SKU`, `Magellan Listing URL`, `Collection`, all three `Instagram 4:5` options, and `Social Post Description (Folder Source)`.
2. Readiness tracker: [Magellan Product & Collection Status Tracker](https://docs.google.com/spreadsheets/d/1PSa1_8wcAOXTzLAZjwufb2Fgf_GNkTYZsNDmlBdVTyE/edit?gid=944366256#gid=944366256), exact tab `Product Tracker`, `sheetId=944366256`.
   - Require `6 Product on Etsy=Yes`, `7 Product on Magellan Site=Yes`, both exact listing URLs, and a matching collection-constrained product row.
   - Preserve all user-maintained status fields.

If the workbooks conflict, exclude the row and report it. Do not guess a URL, cross-match another collection, or substitute a generic Etsy search link.

## Default Euro Summer scope

When the user requests the approved Euro Summer focus, include only:

- `Positano Citrus`
- `Santorini Blue`
- `Capri Club`
- `Riviera Cabana` as the catalog name for French Riviera
- `Costa Brava Market`
- `Saint Tropez Sunset`
- `Euro Summer Word Tees`, restricted to `Amour Tee`, `Ciao Script Tee`, and `Ciao Bella Script Tee`

Exclude every other row merely tagged `Euro Summer`, every other Euro Summer folder, and every non-listed word tee. Apply the collection allowlist before product selection, scheduling, or randomization.

## One-invocation build

Given a date range, cadence, theme, and destination policy, complete these phases without asking the user to run intermediate commands:

1. Read spreadsheet metadata, then bounded source rows from both workbooks.
2. Normalize only eligible products into a local source queue.
3. Apply the exact collection and word-tee allowlists.
4. Prefer the catalog's `Instagram 4:5` options in listed order; fall back to `Primary Image URL` only when it is visually suitable.
5. Assign products across the requested dates while avoiding recent products in `outputs/instagram/post-history.json`.
6. Generate distinct captions, exactly five hashtags, one destination link, and a scheduled local publish time for every item.
7. Write the JSON queue, review CSV, preview HTML, and a concise build summary.
8. Dry-run at least one queue item and validate every row.
9. Stop with `APPROVAL_REQUIRED`. Present the preview path, item count, collection counts, excluded rows, storefront-link counts, and any not-ready items.
10. After the user explicitly approves the named batch, mark the items approved and upload that exact queue to Netlify Blobs. Do not rebuild between approval and upload.

A request to build or preview is not approval to upload. Uploading the queue authorizes the scheduler to publish all due approved items, so approval must name the batch or output path.

## Destination policy

Support:

- `etsy`: use the exact Etsy listing URL.
- `shopify`: use the exact `Magellan Listing URL`.
- `balanced`: alternate storefront destinations within each collection and keep totals as even as possible.

Record `destination_storefront`, `etsy_url`, `shopify_url`, and the selected `link` on every queue item. The creative and caption body may stay the same across storefront variants; only the final shop line and URL may change. Do not put both purchase URLs in one caption.

For the current storewide promotion, mention `20% off storewide` and `STUDYEUROPE20` only when the user confirms that the code is active for the scheduled date. Do not state a product price when the catalog price is blank.

## Caption contract

Every caption must contain:

- a concrete description of the shown product;
- a feeling-led line tied to the exact destination, pattern, product, or use case;
- one `Shop` line and the selected exact listing URL;
- exactly five relevant hashtags.

Keep the voice clean, warm, aspirational, travel-inspired, product-aware, and lightly promotional. Do not start with an Etsy title. Do not repeat caption bodies in an approval batch. Avoid generic filler, emojis, broad hashtag stacks, and `#MagellanTravelGifts`.

Use two niche/category hashtags, one aesthetic or trend tag, one audience/use-case tag, and one contextual travel or decor tag.

## Static-image contract

- Publish static feed images only unless the user separately asks to extend the workflow.
- Prefer 4:5 portrait, within Instagram's supported 4:5 to 1.91:1 range.
- Keep the product readable and uncropped.
- Reject policy slides, size charts, download instructions, informational images, and awkward all-white mockups.
- If no acceptable image exists, set `instagram_ready=false`; never silently publish a weak substitute.
- Probe remote image dimensions when practical and visually inspect campaign-sensitive selections.

## Queue validation

Before approval, verify:

- every row is inside the requested allowlist;
- both source workbooks support the product and URLs;
- every selected destination matches `destination_storefront`;
- every item has an image, unique caption body, exactly five hashtags, and a scheduled time;
- every sale reference is valid for the scheduled date;
- no item is already published;
- no future item was prematurely posted;
- not-ready items cannot pass the upload gate.

## Commands

Prepare Instagram posts from the normalized source queue:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/prepare_instagram_posts.mjs \
  --queue outputs/instagram/YYYY-MM/source-products.json \
  --output-dir outputs/instagram/YYYY-MM
```

Schedule the reviewed queue when a uniform daily schedule is appropriate:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/schedule_instagram_posts.mjs \
  --queue outputs/instagram/YYYY-MM/instagram-posts.json \
  --start-date YYYY-MM-DD \
  --days 30 \
  --times 09:30,12:30,15:30,18:30 \
  --time-zone America/Los_Angeles
```

The times and time zone shown above are the defaults and are written as explicit
UTC-offset timestamps. For five posts per week, assign the exact five dates per
week in the queue instead of using a command that creates seven daily slots.
Never place two posts in the same daily window.

Dry-run before approval:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/publish_instagram_api.mjs \
  --queue outputs/instagram/YYYY-MM/instagram-posts.json \
  --dry-run \
  --include-future \
  --limit 1
```

Upload only after explicit approval:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --upload outputs/instagram/YYYY-MM/instagram-posts.json \
  --remote
```

Verify the remote queue after upload:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --status \
  --remote
```

Check scheduler health and recent alerts without changing remote state:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --health \
  --remote

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --alerts \
  --remote
```

## Handoff

Report the source ranges, output paths, scheduled count, posting targets and
five-minute-early execution windows,
collection counts, Etsy/Shopify link split, excluded or blocked rows, approval
state, circuit status, alert-delivery status, and remote verification result
when uploaded. Never describe a merely built queue as scheduled live.
