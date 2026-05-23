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
