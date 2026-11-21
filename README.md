# Artiste v4 — Original Indian Art Marketplace

Artiste v4 upgrades the existing Next.js App Router + JavaScript + Tailwind + Supabase + Shiprocket + Razorpay project while retaining the Artiste brand, A monogram, warm editorial gallery styling, existing API integrations, and the additive v3 database migration.

## V4 changes

- Added `lucide-react` icons throughout the public Gallery, Customer account, Artist Portal, onboarding pages, address forms and private Studio Vault.
- Public navigation contains Gallery, Our Story, For Cuṣtomers, For Artiṣte and Cart. No Admin / Host / Owner link is published.
- The owner dashboard moved to the unlinked `/studio-vault-owner` route. `/admin` redirects to `/`.
- Customer and Artist access pages now show two tabs: **Existing User — Log In** and **New User — Sign Up**.
- Returning users enter only their email and receive a Supabase magic sign-in link. New users enter only name, email and +91 mobile number; the verification email takes them to the dedicated onboarding page.
- New Customers complete `/account/onboarding` with shipping street address, landmark, PIN lookup, locality, city and State / UT.
- New Artists complete `/artist/onboarding` with biography, pickup address, PIN lookup, Shiprocket pickup-location name, IFSC-verified bank details and optional UPI ID. Profile photo remains optional.
- Incomplete Customer and Artist profiles are redirected to the relevant onboarding route. The Cart preserves a pending Add to Cart / Buy Now intent across the email-verification round trip.
- Existing V3 capabilities remain: public browsing, Artist attribution, customer-safe gallery, verified passwordless-email account APIs, artist-only commission calculator and earnings ledger, multi-Artist courier quotations, one Razorpay payment, order tracking, server-verified payment capture, encrypted Artist bank account numbers, and owner payout actions.


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

## 4. Supabase email links and Auth URLs

The V4 UI uses Supabase `signInWithOtp` with email magic-link redirects:

- Customer login: `https://YOUR_DOMAIN/account`
- Customer signup: `https://YOUR_DOMAIN/account/onboarding`
- Artist login: `https://YOUR_DOMAIN/artist`
- Artist signup: `https://YOUR_DOMAIN/artist/onboarding`

In Supabase Authentication settings:

1. Enable Email provider / passwordless email sign-in.
2. Set the Site URL to your production origin.
3. Add the four URLs above, plus the corresponding `http://localhost:3000/...` URLs, to Additional Redirect URLs.
4. Configure the Email / Magic Link template to use the Supabase confirmation URL, for example:

```html
<h2>Your Artiste sign-in link</h2>
<p>Use the secure link below to verify your email and continue.</p>
<p><a href="{{ .ConfirmationURL }}">Verify email and continue to Artiste</a></p>
<p>If you did not request this link, you can ignore this email.</p>
```

Use a trusted production email provider, configure Supabase email rate limits / CAPTCHA / abuse controls, and test expired or reused links. Supabase's callback handling is enabled by the browser client (`detectSessionInUrl: true`). The app accepts only a signed, verified passwordless Supabase session on protected Customer / Artist API routes.

## 5. Customer sign-in and checkout

- Gallery browsing, details, Artist attribution and Artist filtering are public.
- Add to Cart / Buy Now opens the Customer login / signup tabs when no valid session exists.
- The cart stores the pending artwork intent across the email verification redirect. Once the Customer profile is complete, the intent resumes in the Cart drawer.
- A Customer must have a verified email, +91 phone number, full street address, landmark, locality, city, State / UT and a six-digit delivery PIN before checkout.
- The free India Post lookup uses `https://api.postalpincode.in/pincode/{PIN}` to suggest post-office localities and populate District / State. If offline, users can enter the locality, city and State / UT manually.
- Shiprocket rate requests use each Artist's private pickup PIN and the Customer's delivery PIN. Mixed-Artist baskets are grouped by pickup studio and may create multiple parcels / tracking IDs, while Razorpay collects a single payment.

## 6. Artist onboarding and pickup locations

- Artist signup starts with Artist / Studio Name, email and +91 phone.
- After verification, `/artist/onboarding` collects the bio, studio street address, landmark, PIN / locality / city / State, registered Shiprocket pickup-location name, and payout details.
- IFSC format is validated and verified server-side against Razorpay's public IFSC directory before saving the bank name and branch.
- Bank account numbers must match their confirmation and are encrypted with AES-256-GCM before persistence. The Artist Portal displays a masked account number; the owner-only Studio Vault is the only UI that requests the decrypted bank number for legitimate payout administration.
- The optional UPI ID is saved with the payout account.
- Every Artist must have an exact pickup location registered in Shiprocket. The name saved in onboarding must match the location name configured in Shiprocket. A different registered pickup-location name should be used for each Artist studio where applicable.
- Artist profile approval remains controlled by Artiste. The public gallery only lists approved, available artworks.

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
- [ ] Configure magic-link redirects and test Customer / Artist sign-up and returning sign-in.
- [ ] Test onboarding redirects for incomplete and completed profiles.
- [ ] Test India Post PIN lookup, offline fallback, State / UT dropdown, phone and landmark validation.
- [ ] Verify IFSC success / invalid / unavailable scenarios and confirm bank account encryption key backup.
- [ ] Register and test every Artist pickup origin in Shiprocket.
- [ ] Test cart persistence across email-link redirects and multi-Artist combined payment.
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
- Hidden legacy route: `/admin` → redirects to `/`

## Main API routes

- `POST /api/shipping-rates`
- `POST /api/create-order`
- `POST /api/verify-payment`
- `POST /api/razorpay/webhook`
- `GET, PATCH /api/account`
- `GET, POST /api/artist/profile`
- `GET, POST /api/artist/paintings`
- `PATCH, DELETE /api/artist/paintings/:id`
- `GET /api/artist/verify-ifsc`
- `GET, POST /api/artist/payout-account`
- `/api/admin/*` — owner-session-protected endpoints (not linked publicly)
