# Artiste — Indian Art Marketplace

A Next.js App Router marketplace with the Artiste brand identity, warm editorial gallery styling, Supabase Email OTP accounts, Customer checkout, independent Artist onboarding, private payout details, Indian PIN-code address assistance, Shiprocket live courier rates, Razorpay payment collection, and an owner-only operational dashboard.

## Included pages

- `/` — public gallery for browsing artworks without login, Artist attribution and filtering, artwork details, cart and Buy Now. A creator invitation links to `/artist`; the public site does **not** disclose platform fees or Artist payout percentages.
- `/account` — Customer six-digit Email OTP authentication, saved +91 mobile and shipping details, My Orders and per-origin courier / AWB tracking.
- `/artist` — Artist six-digit Email OTP authentication, profile and portfolio photo, complete studio pickup address, IFSC-verified bank / optional UPI details, own artwork management, private 98% / 2% earnings calculator, and payout ledger.
- `/admin` — server-password-protected owner dashboard. The server validates the HttpOnly admin cookie before it renders the dashboard bundle; all Artists, approval and artwork moderation, Customer orders, dispatch origins, verified payout details, and Mark Payout Paid actions stay behind that gate.
- `database/schema.sql` — additive, re-runnable migration designed to preserve the existing Artiste paintings, profiles, Artists and orders while adding private dispatch origins, verified payout accounts, shipment groups, payout ledger rows, RLS and helper RPCs.

## Stack and runtime

- Node.js 20.9 or newer
- Next.js App Router, JavaScript and Tailwind CSS
- Supabase Auth, Postgres and Storage
- Shiprocket API user credentials and registered pickup location(s)
- Razorpay API keys and a webhook configured for `payment.captured`

Use Razorpay Test Mode until you have tested the complete payment, order, dispatch, cancellation and refund paths. No source-code project can guarantee production readiness without running against your own live service accounts and validating your operational policies.

## 1. Supabase setup

1. Back up your Supabase project before changing its schema.
2. Open Supabase → SQL Editor and run the complete `database/schema.sql` file. It uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; it does not drop existing paintings, Artists, profiles or orders. Existing legacy painting pickup PINs are copied into the private `painting_shipping_origins` table before the public painting rows are scrubbed.
3. Copy the Project URL, anon key and service-role key from Supabase Project Settings → API.
4. Confirm the public Storage buckets `paintings` and `artist-profiles` exist. The SQL creates them and allows public image reads. Upload and deletion operations run through JWT-validated server routes with the service-role key.
5. In Authentication → Providers → Email, enable Email authentication.
6. In Authentication → Email Templates, configure the email template to show the numeric OTP token, for example:

   ```html
   <h2>Your Artiste verification code</h2>
   <p>Enter this six-digit code to verify your email:</p>
   <h1>{{ .Token }}</h1>
   <p>This code is for your Artiste account. Do not share it.</p>
   ```

7. Set the Supabase Site URL and allowed redirect URLs for local and production domains. Configure email delivery, CAPTCHA / abuse protections and OTP rate limits appropriate to your launch.

## 2. Environment variables

Copy `.env.example` to `.env.local` and set every secret server-side.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only privileged key for database and Storage operations |
| `ADMIN_PASSWORD` | Owner / super-admin password; server only |
| `PAYOUT_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256-GCM key used to encrypt Artist bank account numbers |
| `SHIPROCKET_EMAIL` | Shiprocket API user email |
| `SHIPROCKET_PASSWORD` | Shiprocket API user password |
| `PICKUP_PINCODE` | Six-digit fallback PIN for owner-curated Artiste Studio works and old records |
| `SHIPROCKET_PICKUP_LOCATION` | Exact registered Shiprocket pickup-location name; defaults to `Primary` |
| `RAZORPAY_KEY_ID` | Razorpay Key ID |
| `RAZORPAY_KEY_SECRET` | Server-only Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | Separate server-only secret configured for webhook signature verification |

Generate `PAYOUT_ENCRYPTION_KEY` once with:

```bash
openssl rand -base64 32
```

Keep this key stable and backed up securely. Changing or losing it makes previously encrypted Artist bank account numbers undecryptable. Do not commit `.env.local` to source control. Do not prefix any server secret with `NEXT_PUBLIC_`.

## 3. Indian address assistance and IFSC verification

Customer shipping and Artist pickup forms query the free India Post PIN directory at `https://api.postalpincode.in/pincode/{PIN}` after six digits are entered. Returned post office names populate the locality / area dropdown; District and State are prefilled. When the service is unavailable or the PIN cannot be found, the form falls back to manual locality, city and State / UT entry. The form contains all 28 Indian States and 8 Union Territories, plus a required landmark, full street address and +91 mobile number.

Artist payout setup validates the 11-character IFSC format and checks the code server-side against the public Razorpay IFSC directory at `https://ifsc.razorpay.com/{IFSC}`. Bank name and branch are displayed only after the IFSC response is matched to the requested code. IFSC lookup does not independently verify ownership of the bank account; account ownership / penny-drop validation must be performed separately through an appropriate regulated provider if required for your business.

## 4. Artist pickup origins and multi-Artist Shiprocket orders

Each Artist profile stores its pickup contact, phone, full studio address, landmark, locality, city, State, PIN and exact registered Shiprocket pickup-location name. Individual artwork rows keep the public pickup PIN blank. Private pickup data is read only by server-side service-role routes.

At checkout the server groups the basket by Artist / studio pickup origin. For each origin it sums packed weights, uses the largest length, breadth and height across the group, and requests live Shiprocket courier options using that origin PIN and the Customer delivery PIN. The Customer selects one courier for each origin group. Razorpay collects one combined payment; after capture Artiste creates one Shiprocket order for each pickup origin. This means a mixed-Artist basket may arrive in multiple parcels and may have separate tracking IDs.

Every Artist pickup location must already exist in the Shiprocket account, and the pickup-location name entered in the Artist portal must exactly match the name registered there. The owner-curated Artiste Studio fallback uses `PICKUP_PINCODE` and `SHIPROCKET_PICKUP_LOCATION`. Newly uploaded owner artworks require a valid fallback PIN.

## 5. Private Artist fee and payout accounting

The public homepage and Customer screens do not display platform commission or Artist payout percentages. After verified sign-in, the Artist Portal shows the private earnings calculator and ledger. The accounting model applies the 2% platform fee to artwork sale value only; shipping is collected separately and is not included in the fee base. The 98% Artist payout is grouped per Artist per order in `artist_payouts`; the parent order stores combined totals.

Artist bank account numbers are encrypted using AES-256-GCM before persistence and masked on the Artist side. Only the owner-authenticated Admin API can decrypt the stored account number for dispatch / payout operations. The owner dashboard also shows bank name, branch, verified IFSC and optional UPI. Marking a payout Paid only updates the ledger after the owner confirms that a real bank / UPI transfer has been completed; this project does not automatically move funds to bank accounts.

## 6. Authentication, privacy and payment flow

- Artists and Customers use `signInWithOtp` and `verifyOtp` with a six-digit email code. Protected APIs validate the Supabase JWT and its signed Auth Methods Reference; password-only or unverified sessions are rejected.
- Public browsing and Artist attribution are open. Adding an artwork to the cart or buying it prompts for Customer OTP login and a complete saved shipping address.
- Customer profile fields and order rows are protected by Row Level Security. Artists can read / manage only their own Artist profile, artworks, payout account summary and payout ledger. Sensitive pickup-origin, shipment, and bank records have no browser-readable RLS policies and are accessed through server routes only.
- All writes that require elevated privileges run on the server after validating the caller's Auth identity. The service-role key is never sent to the browser. Customer-facing APIs return explicit safe projections and never return commission or Artist payout fields; payment gateway metadata also omits those private amounts.
- Razorpay payment signatures are verified server-side, then the payment is checked against the Razorpay API for order ID, INR currency, exact amount and captured status. The `payment.captured` webhook validates the raw-body HMAC signature and can complete the order if the Customer closes the Checkout page.
- A database function atomically confirms payment, reserves each painting and marks the parent order `Paid`. The server then upserts one Artist ledger row per Artist and processes each Shiprocket shipment group. A payment remains Paid when fulfilment needs manual attention; shipment status and notes are tracked separately. Captured payments with a stock conflict require a refund / manual reconciliation workflow.
- The owner dashboard is protected by the server-only `ADMIN_PASSWORD` and an HttpOnly, SameSite-protected session cookie.

## 7. Run locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

Production build / run:

```bash
npm run build
npm run start
```

Deploy on a Node.js-compatible Next.js host. Configure all environment variables in the host's secret manager, including `PAYOUT_ENCRYPTION_KEY` and `RAZORPAY_WEBHOOK_SECRET`.

## 8. Launch verification checklist

1. Take a backup; run `database/schema.sql` in Supabase; confirm the pre-existing artworks and orders still exist and the legacy pickup PINs were migrated to `painting_shipping_origins`.
2. Configure the Supabase OTP email template using `{{ .Token }}`. Test Customer and Artist signup, sign-in, expired codes, refresh, sign-out and ownership boundaries.
3. Test PIN suggestions, manual fallback, all State / UT options, landmark, full street address and +91 phone validation.
4. Generate and back up the payout encryption key. Test IFSC success / invalid code / service outage. Confirm Artist screens show only a masked account number and owner-only pages show the decrypted value.
5. Register each Artist's Shiprocket pickup location with the exact saved name. Test same-origin and mixed-origin baskets, one selected courier per origin, live rate changes, package aggregation and multiple tracking references.
6. Test Razorpay in Test Mode: success, declined payment, callback retry, webhook capture when the checkout tab closes, duplicate webhook delivery, exact amount mismatch, and a sold-out stock conflict with a refund review.
7. Configure the Razorpay webhook URL `https://YOUR_DOMAIN/api/razorpay/webhook`, a separate webhook secret and the `payment.captured` event. Test the endpoint using Razorpay's webhook test facility.
8. Test `/account` order lookup by `user_id` and legacy email, shipment status, and privacy boundaries. Test the owner payout action with an actual controlled transfer before marking an Artist paid.
9. Finalize Artist agreements, refund and cancellation rules, privacy notice, Terms, invoices, tax treatment, payout timelines, shipping liability and customer support processes before launch.

## API routes

- `POST /api/shipping-rates`
- `POST /api/create-order`
- `POST /api/verify-payment`
- `POST /api/razorpay/webhook` (`payment.captured`)
- `GET, PATCH /api/account`
- `GET, POST /api/artist/profile`
- `GET, POST /api/artist/paintings`
- `PATCH, DELETE /api/artist/paintings/:id`
- `GET /api/artist/verify-ifsc`
- `GET, POST /api/artist/payout-account`
- `POST /api/admin/login`, `POST /api/admin/logout`
- `GET /api/admin/paintings`, `POST /api/admin/paintings`, `PATCH, DELETE /api/admin/paintings/:id`
- `GET /api/admin/overview`, `PATCH, DELETE /api/admin/artists/:id`, `PATCH /api/admin/payouts/:id`
