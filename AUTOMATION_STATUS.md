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

Status: separate prepare, publish, and final recovery windows are implemented.
Final failures submit the Netlify form notification described below.

Current state:
- Netlify site: `magellan-travel-gifts`.
- Netlify site ID: `449cf72e-df51-4cfc-84f6-37f78900d393`.
- Scheduler function: `netlify/functions/instagram-scheduler.mjs`.
- Queue admin function: `netlify/functions/instagram-queue.mjs`.
- Queue storage: Netlify Blobs store `magellan-instagram`, key `monthly-queue`.
- Posting target: 18:30 America/Los_Angeles.
- Prepare window: 18:15 Pacific for August/September, using UTC cron `15 1 * * *`.
- Publish window: 18:25 Pacific for August/September, using UTC cron `25 1 * * *`.
- Final recovery window: 18:40 Pacific for August/September, using UTC cron
  `40 1 * * *`.

How it works:
- Approved queues are uploaded to the protected queue endpoint.
- The scheduler makes three requests per day: container preparation, publication,
  and final recovery.
- It publishes only due, approved, not-yet-published posts.
- It skips the expensive recent-feed lookup for normal queued posts and uses
  that duplicate guard only after an ambiguous publish response.
- It writes posted media IDs, timestamps, failures, and history back to Netlify Blobs.
- It retries one recoverable publishing failure inside the same invocation,
  stops after two failed attempts, sends ambiguous publishes to manual review,
  and opens a circuit breaker after three consecutive failed jobs.
- Alerts are retained in Netlify Blobs and sent to
  `MAGELLAN_IG_ALERT_WEBHOOK_URL` when configured.
- Final failures submit the detected Netlify form
  `instagram-scheduler-failure`. A blocked final recovery run waits 20 seconds,
  then submits the same failure form if overdue work still remains.
- Instagram does not natively schedule these posts; Netlify is the scheduler.

Current remote queue as checked 2026-08-23:
- 2 posts total.
- 2 published.
- No current failed or duplicate-media items.

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
  --times 09:30,12:30,15:30,18:30 \
  --time-zone America/Los_Angeles \
  --start-date YYYY-MM-DD \
  --days 30

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --upload outputs/instagram/YYYY-MM/instagram-posts.json \
  --remote

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --status \
  --remote

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --health \
  --remote

node .agents/skills/magellan-etsy-instagram/scripts/netlify_blob_queue.mjs \
  --alerts \
  --remote
```

Required local/Netlify secrets:
- `META_PAGE_ACCESS_TOKEN`
- `META_INSTAGRAM_BUSINESS_ID`
- `META_FACEBOOK_PAGE_ID`
- `META_APP_ID`
- `MAGELLAN_QUEUE_ADMIN_TOKEN`
- `MAGELLAN_IG_SCHEDULER_ENABLED`
- `MAGELLAN_IG_ALERT_WEBHOOK_URL`
- `MAGELLAN_IG_ALERT_WEBHOOK_BEARER_TOKEN` (optional)

## Hosting And Domain Context

Current decision:
- Stay on Netlify for now.
- Use Netlify Scheduled Functions for Instagram automation.
- Consider buying `magellantravelgifts.com` separately for brand trust, Pinterest/Meta developer approval, and cleaner public URLs.

Important distinction:
- A custom domain is only the public address, for example `magellantravelgifts.com`.
- Netlify, Cloudflare Pages, or GitHub Pages host the site.
- Netlify Scheduled Functions, Cloudflare Workers, or GitHub Actions run automations.
- Buying a domain does not itself run scheduled social posting.

Netlify read:
- Best short-term path because the site is already deployed and connected to GitHub.
- Scheduler cost should be tiny for 1-3 posts/day.
- Free plan has 300 credits/month; production deploys cost credits, so batch static site changes when practical.
- Current static site has minimal build complexity: repo root is published, no build command.

Cloudflare read:
- Strong long-term option if wanting one technical stack for domain/DNS, static hosting, and scheduler.
- Cloudflare Pages could host the static site.
- Cloudflare Workers/Cron could run the scheduler.
- More migration/setup than Netlify, but likely clean and low-cost after a domain purchase.

GitHub Pages/Actions read:
- Lowest-change alternative if leaving Netlify.
- GitHub Pages can host the static site with a custom domain.
- GitHub Actions can run scheduled posting.
- Less polished as a hosting/product UI than Netlify or Cloudflare, but enough for a simple static site and scheduler.

Domain recommendation:
- If `magellantravelgifts.com` is reasonably priced, buying it is recommended.
- It helps with Pinterest/Meta approval, domain verification, privacy policy legitimacy, and brand trust.
- It does not require leaving Netlify immediately.
- Clean near-term setup: `magellantravelgifts.com` points to the existing Netlify site; Netlify continues hosting and running the scheduler.
