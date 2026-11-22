# Artiste v8 — Original Paintings & Fine-Art Photography Marketplace

Artiste v8 upgrades the existing Next.js App Router + JavaScript + Tailwind + Supabase + Shiprocket + Razorpay project while retaining the Artiste brand, A monogram, warm editorial gallery styling, existing API integrations, and the additive v3 database migration.


## Version 7 — creator showcase & fine-art photography

- Homepage and `/artists` now show every approved, non-suspended Artist, including creators who have not yet published a work. Circular `avatar_url` portraits retain an elegant monogram fallback.
- `/artists/[id]` displays each active creator’s public biography and complete approved collection, including paintings and photographs.
- Added the `category` field to `paintings`, with a safe `Painting` default for existing records. Artist listings can select **Original Painting** or **Fine-Art Photography**.
- Added homepage art-form filter pills, a curated photography highlight strip, and a dedicated `/photography` gallery that shares the existing customer authentication, cart, checkout and delivery quotation flow.
- Paintings remain the primary gallery focus; Fine-Art Photography is presented as a curated secondary collection.
- The public brand tagline is now: “Artiste — Original Paintings & Fine-Art Photography, Delivered With Love From Independent Indian Studios to Your Home.”

Run the updated `database/schema.sql` in Supabase before deploying V7 so the additive `paintings.category` column is available. Existing paintings automatically receive the `Painting` default.

## Version 8 — conversational Concierge, creator roles, stock and accounting

- Added a server-side `/api/chat` Gemini integration using native `fetch` only. `GEMINI_API_KEY` stays server-side; when it is missing or Gemini is unavailable, a contextual support fallback remains available. The floating Concierge includes quick topics and WhatsApp / email escalation.
- Added Painter and Photographer creator roles in onboarding and profile editing. Public titles distinguish **Artist · Artist Studio** from **Photographer · Photography Studio**. Commission schedules are private: Painters 2% / 98% payout; Photographers 5% / 95% payout.
- Expanded the Photography Wing with creator portraits, edition / print metadata and direct customer-cart actions.
- Added stock quantity controls, restocking and listing deletion in the Creator Portal. A secure payment-confirmation RPC decrements stock atomically only after payment confirmation and marks listings sold out at zero.
- Added sequential `BOS-AR-YYYY-#######` Bill of Supply numbers, print-ready `/invoice/[orderId]` documents and prominent invoice access in My Orders.
- Added a private **ACCOUNTS & LEDGER** tab to `/studio-vault-owner`, including sale, shipping, commission, net payout, status controls and CSV export.
- No additional npm packages were introduced. Gemini requests use the platform's built-in `fetch`; Gemini API usage is subject to Google's free-tier model availability and rate limits.

Before deploying V8, run the complete updated `database/schema.sql` in the Supabase SQL Editor. Set `GEMINI_API_KEY` on the server to enable Gemini; leave it unset to use the fallback Concierge. Also configure the existing Supabase, SMTP, Razorpay, Shiprocket and `ADMIN_PASSWORD` environment variables described below.

## V4 changes

- Added `lucide-react` icons throughout the public Gallery, Customer account, Artist Portal, onboarding pages, address forms and private Studio Vault.
- Public navigation contains Gallery, Our Story, For Cuṣtomers, For Artiṣte and Cart. No Admin / Host / Owner link is published.
- The owner dashboard moved to the unlinked `/studio-vault-owner` route. `/admin` redirects to `/`.
- Customer and Artist access pages now show two tabs: **Existing User — Log In** and **New User — Sign Up**.
- Returning Customers and Artists can log in with Email + Password or Email + 6-Digit OTP. New users enter their name, email, +91 phone and a password, then verify a numeric code directly on the same page.
- New Customers complete `/account/onboarding` with shipping street address, landmark, PIN lookup, locality, city and State / UT.
- New Artists complete `/artist/onboarding` with biography, pickup address, PIN lookup, Shiprocket pickup-location name, IFSC-verified bank details and optional UPI ID. Profile photo remains optional.
- After successful in-page code verification, new users continue in the same browser tab to the relevant onboarding route. Incomplete profiles are redirected to onboarding. The Cart preserves a pending Add to Cart / Buy Now intent across account sign-in.
- Added Artiste-managed 6-digit email OTP endpoints backed by SMTP, hashed OTP records in `email_otps`, 10-minute expiry, atomic single-use verification, attempt limits and send-rate limiting. No verification email contains a sign-in link or redirect URL.
- Existing V3 capabilities remain: public browsing, Artist attribution, customer-safe gallery, authenticated account APIs, artist-only commission calculator and earnings ledger, multi-Artist courier quotations, one Razorpay payment, order tracking, server-verified payment capture, encrypted Artist bank account numbers, and owner payout actions.


## Final polish included in this archive

- `lib/siteConfig.js` is the single editable source for the public phone number, WhatsApp number, support email, Instagram URL and founders credit. Add a co-founder by extending `foundersCredit` in that file.
- A slim Call Us / WhatsApp Support contact bar appears at the top of every page.
- A consistent editorial footer appears at the bottom of every page with support email, phone, WhatsApp, Instagram, customer / artist links, Shipping & Returns and the founders credit.
- `/shipping-returns` explains Pan-India Shiprocket dispatch (generally within 2–4 business days), insured courier handling subject to carrier terms, protective packaging, live tracking, 48-hour continuous-unboxing-video transit-damage reporting and the final-sale policy for original artworks.
- The floating Artiste Concierge is available throughout the site. Its quick topics and keyword replies cover delivery, packaging / transit damage, Razorpay payment methods, Artist applications and order tracking. Unresolved questions can be handed off to WhatsApp or email support.

To update public business details, edit only `lib/siteConfig.js`; no page or component edits are required. The founders credit is currently `Concept & Vision by Srinjay R Bhattacharjee`. For example, append ` & Co-Founder Name` when ready.

## Requirements

- Node.js 20.9 or newer
- A Supabase project
- A Shiprocket account with each Artist pickup location configured
- Razorpay credentials (test keys for initial testing)

## 1. Install

Extract the archive and run:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## 2. Environment variables

Fill `.env.local` with the values below. Never commit `.env.local` or expose server secrets with a `NEXT_PUBLIC_` prefix.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged key for database and Storage operations |
| `ADMIN_PASSWORD` | Long, unique owner password for `/studio-vault-owner` |
| `PAYOUT_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256-GCM key for Artist bank account numbers |
| `SHIPROCKET_EMAIL` | Shiprocket API email |
| `SHIPROCKET_PASSWORD` | Shiprocket API password |
| `PICKUP_PINCODE` | Owner-curated Artiste Studio fallback PIN |
| `SHIPROCKET_PICKUP_LOCATION` | Default Shiprocket pickup-location name (for example `Primary`) |
| `RAZORPAY_KEY_ID` | Razorpay Key ID |
| `RAZORPAY_KEY_SECRET` | Server-only Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | Separate secret configured for Razorpay webhook signature validation |
| `SMTP_HOST` | SMTP hostname used by Artiste to deliver numeric verification codes |
| `SMTP_PORT` | SMTP port (usually 587 for STARTTLS or 465 for implicit TLS) |
| `SMTP_USER` | SMTP username and default sender identity |
| `SMTP_PASS` | SMTP password / app password |
| `SMTP_FROM` | Optional sender label/address; defaults to `SMTP_USER` |
| `OTP_HASH_SECRET` | Optional dedicated secret used to HMAC OTPs and hashed IP rate-limit keys; falls back to the service-role key if omitted | 

Generate the encryption key once and keep a secure backup:

```bash
openssl rand -base64 32
```

Do not regenerate this key after Artist bank accounts have been encrypted. Losing it makes existing encrypted account numbers undecryptable.

## 3. Supabase database and Storage

1. Back up the Supabase database before applying schema changes.
2. Open Supabase SQL Editor and run `database/schema.sql`.
3. The schema is additive / rerunnable for the current V3 data model. It uses `create table if not exists` and `alter table ... add column if not exists` where applicable, preserves existing paintings and orders, keeps legacy order columns for compatibility, and moves private pickup-origin data into the restricted shipping-origin table.
4. Ensure public Storage buckets `paintings` and `artist-profiles` exist. The SQL creates them if missing. Public reads apply only to artwork/profile images; file writes are performed by server-side APIs.
5. Keep the Supabase service-role key on the server only. Never use it in browser code.

The RLS policies intentionally do not provide direct browser access to Customer orders, shipment records, payout records or private Artist pickup origins. Protected server API routes verify the Supabase JWT and use the service-role key for elevated operations. `GRANT ALL` does not override RLS.

## 4. In-page numeric email OTP and SMTP configuration

Artiste now sends its own six-digit numeric email codes through Nodemailer and your SMTP provider. Customers and Artists do not receive Supabase magic links, confirmation URLs, or cross-device redirects. The code is typed into the current `/account` or `/artist` page; successful verification creates a Supabase Auth session and routes the browser tab directly to the dashboard or onboarding page.

1. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASS` to your deployment secrets. `SMTP_PORT=587` uses STARTTLS; `SMTP_PORT=465` uses implicit TLS. Set `SMTP_FROM` only if your provider authorizes a separate sender identity.
2. Set a stable random `OTP_HASH_SECRET` (recommended) using `openssl rand -hex 32`. If omitted, the server falls back to `SUPABASE_SERVICE_ROLE_KEY` for HMAC hashing. Do not expose any of these variables to the browser.
3. Run the updated `database/schema.sql`. It creates the private `email_otps` table and the atomic `consume_email_otp` function. Only `service_role` can access these records or execute the consume function.
4. Ensure your SMTP account is authorized to send from the address configured in `SMTP_USER` / `SMTP_FROM`, and test delivery to Gmail, Outlook and other common providers.
5. Codes are numeric, expire after 10 minutes, are single-use, and are limited to five failed attempts. Email resend has a cooldown and hourly limits per email and originating connection.

The API endpoints are `POST /api/auth/send-otp` and `POST /api/auth/verify-otp`. The server hashes codes with HMAC-SHA256 and never stores a plaintext OTP. Supabase's Auth Admin `generateLink` result is used internally only after the independently generated SMTP OTP has been consumed; no action link is emailed, exposed to the browser or opened by the Customer / Artist. The resulting Supabase JWT is returned over HTTPS and installed in the same browser session using `auth.setSession`.

## 5. Customer sign-in and checkout

- Gallery browsing, details, Artist attribution and Artist filtering are public.
- Add to Cart / Buy Now opens the Customer login / signup tabs when no valid session exists.
- The cart stores the pending artwork intent across in-page sign-in. Once the Customer profile is complete, the intent resumes in the Cart drawer.
- A Customer must have a verified email, +91 phone number, full street address, landmark, locality, city, State / UT and a six-digit delivery PIN before checkout.
- The free India Post lookup uses `https://api.postalpincode.in/pincode/{PIN}` to suggest post-office localities and populate District / State. If offline, users can enter the locality, city and State / UT manually.
- Shiprocket rate requests use each Artist's private pickup PIN and the Customer's delivery PIN. Mixed-Artist baskets are grouped by pickup studio and may create multiple parcels / tracking IDs, while Razorpay collects a single payment.

## 6. Artist onboarding and pickup locations

- Artist signup starts with Artist / Studio Name, email, +91 phone and a password, then verifies a six-digit code on the same page.
- After verification, `/artist/onboarding` collects the bio, studio street address, landmark, PIN / locality / city / State, registered Shiprocket pickup-location name, and payout details.
- IFSC format is validated and verified server-side against Razorpay's public IFSC directory before saving the bank name and branch.
- Bank account numbers must match their confirmation and are encrypted with AES-256-GCM before persistence. The Artist Portal displays a masked account number; the owner-only Studio Vault is the only UI that requests the decrypted bank number for legitimate payout administration.
- The optional UPI ID is saved with the payout account.
- Every Artist must have an exact pickup location registered in Shiprocket. The name saved in onboarding must match the location name configured in Shiprocket. A different registered pickup-location name should be used for each Artist studio where applicable.
- Artist profiles activate automatically after the required profile, pickup-address and verified payout details are completed. The Owner can still suspend an account; the public gallery only lists approved, available, non-suspended artworks.

IFSC lookup confirms bank / branch metadata; it does not independently prove that the bank account belongs to the Artist. Account ownership or penny-drop validation requires a separate regulated verification provider.

## 7. Artist commission privacy

The public homepage and Customer screens do not expose platform-fee or Artist-payout percentages. Only an authenticated Artist sees the private earnings calculator and ledger in `/artist`. The owner sees the complete financial and payout ledger in `/studio-vault-owner`.

The existing V3 accounting model uses 2% of artwork sale value as the Artiste fee and 98% as the Artist payout; shipping is separate. Payout status is an accounting record only. The app does not transfer funds automatically. Mark a payout Paid only after the transfer has actually been completed outside the app.

## 8. Private owner Studio Vault

Visit `/studio-vault-owner` directly and enter the server-side `ADMIN_PASSWORD`. The route is deliberately not linked from the public website and is marked `noindex`. `/admin` redirects to the public homepage. All owner API endpoints continue to enforce the signed HttpOnly owner session cookie.

Protect the owner password, Supabase service-role key, Razorpay secret, webhook secret and encryption key in the deployment host's secret manager. Use a unique password and rotate it if it may have been exposed.

## 9. Razorpay and Shiprocket

1. Begin with Razorpay Test Mode keys.
2. Configure Razorpay webhook URL as `https://YOUR_DOMAIN/api/razorpay/webhook`.
3. Subscribe to `payment.captured` and set the matching `RAZORPAY_WEBHOOK_SECRET`.
4. Test verified payments, callback retries, duplicate webhook delivery, mismatched amount/order IDs, and sold-out artwork conflicts.
5. Check that each Artist pickup location is registered and serviceable in Shiprocket. Test same-Artist and multi-Artist baskets, courier selection per pickup group and shipment retry / manual attention paths.
6. Switch to live Razorpay keys only after end-to-end Test Mode validation.

A captured payment that cannot be fulfilled because a work became unavailable requires manual refund / reconciliation. Shipment failures do not silently reverse the recorded payment.

## 10. Owner launch checklist

- [ ] Back up database and Storage before migration.
- [ ] Run `database/schema.sql` and verify old artworks and orders remain.
- [ ] Configure SMTP and test Customer / Artist password sign-in, OTP sign-in, OTP signup, expiry, resend cooldown and single-use verification.
- [ ] Test onboarding redirects for incomplete and completed profiles.
- [ ] Test India Post PIN lookup, offline fallback, State / UT dropdown, phone and landmark validation.
- [ ] Verify IFSC success / invalid / unavailable scenarios and confirm bank account encryption key backup.
- [ ] Register and test every Artist pickup origin in Shiprocket.
- [ ] Test cart persistence across in-page sign-in and multi-Artist combined payment.
- [ ] Test Razorpay webhook signature, duplicate notifications, payment capture and order persistence.
- [ ] Test `/account` My Orders and `/studio-vault-owner` owner orders / payouts.
- [ ] Review privacy notice, Terms, refunds, invoices, taxes, dispatch SLA, payouts, shipping liability and customer support before public launch.

## Main routes

- Public Gallery: `/`
- Customer Portal: `/account`
- Customer Onboarding: `/account/onboarding`
- Artist Portal: `/artist`
- Artist Onboarding: `/artist/onboarding`
- Private Owner Studio Vault: `/studio-vault-owner`
- Official Bill of Supply: `/invoice/[orderId]` (paid orders only)
- Artist Dispatch Packing Slip: `/packing-slip/[orderId]`
- Hidden legacy route: `/admin` → redirects to `/`

## Main API routes

- `POST /api/shipping-rates`
- `GET /api/order-documents/:orderId` — authenticated, paid-order invoice / packing-slip data
- `POST /api/create-order`
- `POST /api/verify-payment`
- `POST /api/razorpay/webhook`
- `GET, PATCH /api/account`
- `GET, POST /api/artist/profile`
- `GET, POST /api/artist/paintings`
- `PATCH, DELETE /api/artist/paintings/:id`
- `GET /api/artist/verify-ifsc`
- `GET, POST /api/artist/payout-account`
- `POST /api/auth/send-otp` — sends a six-digit numeric email code via SMTP
- `POST /api/auth/verify-otp` — atomically consumes the code and returns an active Supabase session
- `/api/admin/*` — owner-session-protected endpoints (not linked publicly)


## V4 polish update (automatic Artist activation, non-blocking sessions and avatars)

This update keeps the in-page six-digit email OTP + password flow intact and adds:

- Artist studios activate automatically once the Artist profile, pickup address and IFSC-verified payout details are saved. New artworks publish immediately.
- The owner can still suspend/reactivate an Artist from `/studio-vault-owner`; suspensions are stored in `artists.is_suspended` and hide the Artist's unsold works until reactivated.
- `/artist` and `/account` no longer show a full-screen re-buffer when Supabase refreshes a session token or reports a same-user sign-in event. Account data loading is keyed to the user ID.
- Saved Customer shipping details and Artist studio / bank details are presented as summary cards and open for editing only on request.
- Artist profile photos are stored in the `artist-profiles` Supabase Storage bucket. The public-safe `avatar_url` is copied onto painting rows so the gallery can render a circular Artist avatar without making private Artist profile or pickup fields publicly readable.

### Database migration

Run the updated `database/schema.sql` in the Supabase SQL Editor before deploying this build. It uses additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for `artists.avatar_url`, `artists.is_suspended`, and `paintings.avatar_url`, and backfills existing painting cards with the corresponding Artist avatar. Existing artwork, Customer orders and Artist payout history are retained.

## Version 5 additions

- `lib/siteConfig.js` now centralises the Artiste company name, editable Ganguly Bagan head-office address, GST status, support email and phone. The same values are used on every generated Bill of Supply.
- Paid orders have a print-ready `/invoice/[orderId]` Bill of Supply with the order / payment reference, customer delivery details, artwork rows, shipping, zero GST and amount-in-words. Customers, involved Artists and the authenticated owner can open it from their order ledger. Use the browser print dialog and choose **Save as PDF**.
- Artists can enter packed weights from **0.2 kg**; new artwork forms default to **0.5 kg**.
- Delivery choices are sorted lowest price first. In addition to live Shiprocket quotes, matching first-three-digit PIN zones are shown a flat local economy option (₹45 up to 1 kg; ₹75 above 1 kg) and free studio collection. These two local methods are manually coordinated by the Artist / Artiste and are not direct Porter / Borzo API integrations. The first three PIN digits are only a postal-zone hint, not a guarantee of municipal city boundaries.
- Artist earnings rows link to both the official Bill of Supply and a printable Artist dispatch packing slip.

The local economy / studio pickup choices do not incur a paid API subscription. Shiprocket rates still require your existing Shiprocket account. Configure the exact company support and contact details in `lib/siteConfig.js` before issuing customer documents.


## Version 7 database and portfolio query fixes

- Public Server Components prefer `SUPABASE_SERVICE_ROLE_KEY` for public Artist/profile reads and fall back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` when the service-role key is not configured.
- `database/schema.sql` recreates the public Artist SELECT policy so public Artist directory and portfolio requests are not blocked by RLS. Browser roles receive SELECT access only to public profile columns; private email, account and pickup/contact columns remain restricted.
- Individual Artist portfolios merge approved works linked through either `artist_id` or an exact case-insensitive `artist_name` match, with duplicate rows removed.
- New listings carry the current Artist ID from the portal; the server independently resolves the signed-in Artist and writes the trusted `artist_id`, `artist_name` and `avatar_url` to each painting/photograph row.

## Version 6 updates

- Shiprocket checkout now displays only live Shiprocket point-to-point courier serviceability quotes. Manual local-economy and studio-pickup pseudo-couriers have been removed.
- Missing, null, or empty painting `weight_kg` values default to exactly 0.5 kg for rate calculation; positive stored weights are used as recorded. Courier options are sorted by ascending live Shiprocket price.
- Added public `/artists` directory and `/artists/[id]` Artist portfolio pages, including circular `avatar_url` portraits, monogram fallbacks, biographies, studio location, available works with normal cart/checkout, and a sold-work archive.
- Added the “Meet Our Artists” homepage showcase and “Our Artists” navigation link.
- Added the Artiste soul / human-connection tagline to the homepage hero, Our Story, footer, and invoice footer.

No database migration is required for these Version 6 changes. The public Artist pages use the existing `artists` and `paintings` tables and their existing approval fields.
