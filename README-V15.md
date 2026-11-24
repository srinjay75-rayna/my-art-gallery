# Artiste V15 — creator-first marketplace upgrade

This package upgrades the supplied `artiste-v14.1` project to the V15 feature set. It leaves the protected inactivity session monitor, Rayna AI route, Shiprocket client helper, payment verification route and serial Bill of Supply generation logic untouched.

## V15 changes

### Creator economics and private pricing
- Standard creators receive 70% of eligible artwork revenue; the platform share is 30%.
- Founding Artists receive 80%; the platform share is 20%. The first ten artist profiles are designated at migration time for an existing installation, and a database trigger allocates founding status to the first ten registrations on a fresh installation. The owner can grant or revoke status in Studio Vault.
- The public `/artist` pitch uses the Art Manager / aligned-success message. Commission math and the zero-capital price calculator are rendered only inside the authenticated Creator Studio.
- The private calculator adds the packaging and insured-courier buffer after calculating the creator-price component, and its payout preview shows creator payout and platform share without exposing this information to collectors.
- Buyer-facing order documents no longer expose creator commission or payout amounts.

### Founding Artist application
- The logged-in Creator Studio includes an eight-question application with contact and studio details, art-style bio, 3–5 artwork photographs, artwork specifications, desired payout, and four mandatory agreements.
- Applications are saved in `public.artist_applications` and the latest application reference / profile fields are synchronized to `public.artists`.
- An optional external Google Form URL is configurable through `foundingArtistGoogleFormUrl` in `lib/siteConfig.js`.

### Registration, studio profile and artwork management
- Bank / payout details are optional at artist sign-up and artwork publication. Creators can add or update payout information later from Studio Profile.
- Optional artist profile fields default safely and accept null values. The migration adds `phone`, Instagram / WhatsApp fields and founder status.
- Creators can edit profile details, pickup address and PIN code, socials and payout details.
- Artwork editing supports title, story, medium, dimensions, framed status, price, and photo gallery keep/remove/add operations. Painters can keep up to four photos per artwork; Photographers up to two. Studio thumbnails and collector detail thumbnails switch the displayed image.
- Stock changes are optimistic in the Creator Studio, with rollback if the server rejects the update. Restock, save stock, withdraw/delist and delete actions are available.

### Delivery and payout eligibility
- A Shiprocket webhook endpoint at `/api/courier-status` accepts authenticated delivery updates using `SHIPROCKET_WEBHOOK_SECRET`.
- Once a shipment is marked `Delivered`, the database sets `payout_available_at` to 48 hours after the courier delivery timestamp.
- Both the admin API and database payout RPC refuse to mark a creator payout Paid before that eligibility time. Actual payout transfer remains a manual owner action.

### Collector experience and account routing
- Artwork details display authenticity, original-work, insured delivery and Razorpay checkout cues; the dimensions and framed status; a living-room wall preview; and a Made-to-Order Archival Print request.
- The archival-print request is recorded in order item snapshots / account order data. Insured courier costs are retained as internal fulfilment costs; collectors pay only the artwork price because the creator calculator adds a packaging / courier buffer to the website price.
- `/account` opens Customer Profile by default, and the logged-in profile menu exposes the current role's direct profile, edit, orders or studio links.

## Deployment sequence

1. Back up the production Supabase database and test this release against a staging copy first.
2. Review the full `database/schema.sql` migration against your current database version, then run it in Supabase SQL Editor. It is designed to be re-runnable for the supplied V14.1 schema, but no migration should be run on production without a backup and a staging test.
3. Deploy the full project archive, not just the files that changed.
4. Add `SHIPROCKET_WEBHOOK_SECRET` to the server environment and configure the Shiprocket webhook to call `POST /api/courier-status` with the matching Shiprocket security token in the `x-api-key` header. Without this configuration, the automatic Delivered + 48-hour payout clock cannot be populated from courier events.
5. Optionally set `foundingArtistGoogleFormUrl` in `lib/siteConfig.js` if a parallel external application link is desired.
6. Run the project's production build and test the full user journeys in staging before promoting the deployment.

## Required environment

Keep all existing V14.1 environment values. V15 additionally reads:

- `SHIPROCKET_WEBHOOK_SECRET` — required to authenticate the new Delivered webhook.

Existing services still require the app's Supabase, OTP / SMTP, Razorpay, Shiprocket API, Gemini, and owner/admin configuration. Keep service-role keys and all server secrets out of browser-exposed `NEXT_PUBLIC_` variables.

## Validation and limits

This archive is checked for protected-file integrity, source syntax, import / route consistency, and ZIP integrity after packaging. A full `next build`, live Supabase migration, live authentication, payment capture, Rayna, and Shiprocket delivery integration test require the production dependencies and deployment secrets that are not included in the source ZIP. A code review and static checks cannot certify a system as entirely bug-free. Run these end-to-end checks in staging before production rollout.

**Protected-code compatibility note:** the requested protected Rayna route was not modified. Its existing prompt text still contains legacy creator-share guidance; it must be reconciled in a separately approved Rayna change if Rayna is expected to describe V15 creator shares. The runtime creator pricing, order snapshots, creator ledger and admin dashboard use the V15 70% / 80% creator shares.

**Bill-number compatibility note:** the original sequential Bill of Supply generator was left untouched. Inspection of this V14.1 base shows that it currently generates `BOS-AR-YYYY-#######` values, while the Rayna prompt also gives an `ART-2026-XXXXX` example. V15 does not silently change that protected sequence; reconcile the desired serial format in a separately tested database migration before production if `ART-2026-XXXXX` is a hard requirement.
