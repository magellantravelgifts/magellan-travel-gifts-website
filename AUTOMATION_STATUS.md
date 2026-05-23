# Magellan Automation Status

Last updated: 2026-05-23

## Pinterest

Status: paused.

Reason: waiting for Pinterest developer app approval before live OAuth/publishing can proceed.

Current state:
- Pinterest skill exists at `.agents/skills/magellan-etsy-pinterest/SKILL.md`.
- It can generate daily or weekly preview queues from Etsy/product data.
- It supports image preference overrides, board matching, fallback `travel-gifts`, special Etsy shop links, and weekly schedule metadata.
- Live publishing is not active until Pinterest grants developer/API access.

Next steps after approval:
- Complete Pinterest OAuth.
- Fill board IDs/board map.
- Run dry-run publisher.
- Confirm whether Pinterest accepts API scheduling via `publish_date`.
- If accepted, upload/schedule weekly batches. If not, use the same due-post scheduler pattern as Instagram.

## Instagram

Status: active.

Current state:
- Instagram skill exists at `.agents/skills/magellan-etsy-instagram/SKILL.md`.
- Meta app/page/IG connection has been verified.
- Instagram Business Account ID: `17841447449196210`.
- Facebook Page ID: `104486471856540`.
- Local prep script generates reviewed IG captions, hashtags, image selection, and preview HTML.
- Publisher has been tested live through Meta Graph API.

Posting rules:
- Captions should not copy Etsy titles.
- Captions include product-aware description, feeling-led line, `Shop` on its own line, product link, and exactly 5 relevant hashtags.
- Avoid low-utility branded hashtags such as `#MagellanTravelGifts`.
- Images are checked for Instagram-safe dimensions and should not crop out the product.

## Netlify Scheduler

Status: deployed and active.

Current state:
- Netlify site: `magellan-travel-gifts`.
- Netlify site ID: `449cf72e-df51-4cfc-84f6-37f78900d393`.
- Scheduler function: `netlify/functions/instagram-scheduler.mjs`.
- Queue admin function: `netlify/functions/instagram-queue.mjs`.
- Queue storage: Netlify Blobs store `magellan-instagram`, key `monthly-queue`.
- Schedule: hourly.

How it works:
- Approved queues are uploaded to the protected queue endpoint.
- Netlify Scheduled Function checks hourly for due posts.
- It publishes only due, approved, not-yet-published posts.
- It writes posted media IDs, timestamps, failures, and history back to Netlify Blobs.
- Instagram does not natively schedule these posts; Netlify is the scheduler.

Current test queue:
- 3 approved posts uploaded.
- 2 already published.
- 1 scheduled for 2026-05-23 14:55 PDT to verify the 15:00 hourly scheduler run.

Monthly workflow:
- Generate and approve one monthly queue before upload.
- Netlify posts from the approved queue throughout the month.
- Monthly prep automation runs on the 28th of each month at 09:00 to prepare the next calendar month for approval.
- The automation must stop for approval before uploading to Netlify Blobs.

Useful commands:

```bash
node .agents/skills/magellan-etsy-instagram/scripts/prepare_instagram_posts.mjs \
  --queue outputs/pinterest/YYYY-MM-DD/daily-pins.json \
  --output-dir outputs/instagram/YYYY-MM

node .agents/skills/magellan-etsy-instagram/scripts/schedule_instagram_posts.mjs \
  --queue outputs/instagram/YYYY-MM/instagram-posts.json \
  --times 09:30,14:00,18:30 \
  --start-date YYYY-MM-DD \
  --days 30

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --upload outputs/instagram/YYYY-MM/instagram-posts.json \
  --remote

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --status \
  --remote
```

Required local/Netlify secrets:
- `META_PAGE_ACCESS_TOKEN`
- `META_INSTAGRAM_BUSINESS_ID`
- `META_FACEBOOK_PAGE_ID`
- `META_APP_ID`
- `MAGELLAN_QUEUE_ADMIN_TOKEN`

