# Artiste V13 — V12 upgrade package

This is a drop-in upgrade package assembled from the supplied V11 base archive and the supplied V12 patch archive, then updated for V13. It contains the complete `app/`, `components/`, and `database/` trees requested for this release.

## V13 changes

### 1. Sequential customer Bills of Supply
- Adds the idempotent PostgreSQL sequence `public.artiste_bill_seq`, `next_artiste_bill_number()`, a paid-order trigger, and the service-role `ensure_artiste_bill_number(uuid)` RPC.
- Produces serial bill numbers in the form `ART-YYYY-00001`, based on Kolkata calendar year and a global, monotonic serial sequence.
- Backfills legacy paid orders to the new serial format without rewinding the sequence on subsequent migrations.
- Payment verification calls the RPC as a safety net after captured-payment processing. The database trigger also assigns a bill if any payment handler transitions an order to `Paid`.
- Customer My Orders now links every paid order to its invoice page, even while the bill serial is being assigned. The invoice endpoint retries the idempotent RPC before displaying the document.
- The print-ready non-GST Bill of Supply uses `lib/siteConfig.js`, customer/order details, line items, artist names, HSN/SAC 9701 / 4911, shipment and shipping breakdown, and the serial bill number.

### 2. Artist registration and portal separation
- Adds missing profile / creator fields, including `phone`, `creator_role`, `password_hash`, and `approved`, with safe defaults.
- Keeps the existing customer schema in `public.profiles`; the supplied V12 codebase does not use a `public.customers` table.
- Supports Customer, Painter, and Photographer portal profiles on one verified email.
- Stores a separate salted scrypt password hash per `(email, portal_role)` in the service-role-only `public.portal_credentials` table. The Supabase Auth account is reused as the session issuer; its single password is not used for V13 portal password checks.
- Adds `/api/auth/login-password` and role-aware membership validation. Forgot Password / OTP reset updates only the selected portal's password.
- Preserves the 30-second OTP resend countdown and the matching server-side per-email cooldown.
- Public discipline selection shows only Painter / Photographer. Role payout percentages appear in private studio views, not in public sign-up.

### 3. Creator commissions and pricing calculator
- Painters: 85% creator payout / 15% Artiste fee.
- Photographers: 90% creator payout / 10% Artiste fee.
- Applies role-specific calculations in order snapshots, private creator earnings, the creator calculator, customer Bills of Supply, and owner Accounts & Ledger.
- Adds the optional private upload calculator: production cost + hours × editable hourly rate (Painter default ₹350/hr; Photographer default ₹400/hr), one-click suggested price, custom listing price, and live payout / platform-fee preview.

### 4. Rayna
- Sends up to 16 recent user / assistant turns to Gemini.
- Uses `gemini-2.5-flash-lite` first, then `gemini-2.5-flash`, with `gemini-3.5-flash-lite` as a compatibility fallback for projects that cannot access the restricted 2.5 models.
- Applies a 16-second total Gemini generation budget using per-attempt `AbortController` deadlines, with a 1,024-token output limit and no thinking configuration.
- Injects live available artworks and approved public creator data, including for greetings; prompt instructions prevent unrequested product lists on simple greetings.
- Performs a single-order lookup only when the latest user message includes a supported order / bill reference (including `ART-YYYY-XXXXX`). Only safe order status fields are provided to Gemini; customer PII, creator payout/bank data, and owner data are not selected.
- Keeps the viewport-locked chat drawer, sticky header and close button, three-dot typing indicator, Rayna portrait, and goodbye auto-close behavior.

## Database deployment

1. Back up the Supabase database.
2. Run the complete `database/schema.sql` in Supabase SQL Editor before deploying the updated application.
3. Confirm the migration completed successfully. It is additive and designed to be re-runnable; it creates the role-credential table and the bill sequence / trigger / RPC.
4. Verify the `service_role` key is available only to server routes. Never expose it via a `NEXT_PUBLIC_` variable.

The migration expects the existing Artiste V12 base tables (`profiles`, `artists`, `paintings`, `orders`, and `email_otps`) and related V12 order / shipment tables to exist.

## Overlay instructions

The supplied upload set consisted of `artiste-v11(1).zip` plus `artiste-v12-patch.zip`; no standalone V12 archive, `lib/`, `public/`, `package.json`, or lockfile was included. Overlay the package's `app/`, `components/`, and `database/` onto the complete V12 project. Keep the existing:
- `lib/` (including `siteConfig.js`, `supabase.js`, `auth-server.js`, `request-guard.js`, `order-processing.js`, and other V12 helpers);
- `public/` (especially `public/rayna-avatar.png`);
- `package.json`, lockfile, Next.js / Tailwind configuration, and environment files.

No additional npm package is introduced by this V13 package. The supporting project files listed above were not in the supplied ZIPs, so this is not a standalone Next.js project.

## Environment variables

Keep the V12 server configuration in place. The current application source references:
- Supabase: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- OTP / email: `OTP_HASH_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optional `SMTP_FROM`;
- Payments / shipping: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SHIPROCKET_PICKUP_LOCATION`, and optional `PICKUP_PINCODE`;
- Rayna: `GEMINI_API_KEY`.

Also retain your existing `ADMIN_PASSWORD` and any other V12 deployment secrets used by the omitted supporting `lib/` files.

## Validation performed

- 53 JavaScript / JSX source files were parsed with the TypeScript JavaScript/JSX parser: zero syntax errors.
- Duplicate declaration diagnostics: zero.
- Relative and `@/components/` imports within the packaged `app/` and `components/` trees: zero unresolved imports.
- ZIP archive integrity is checked during packaging.

A full Next.js production build and live Supabase, SMTP, Gemini, Razorpay, and Shiprocket tests were not possible because the supplied uploads did not contain `package.json`, installed dependencies, the `lib/` directory, or the deployment environment. Static parsing is not production certification. Test the complete V12 project with `npm run build` and exercise signup, each portal password, payment + bill assignment, invoice access, Rayna, inventory, and checkout in a staging environment before production rollout.

## V13 file change checklist

The following application and database paths differ from the reconstructed V12 baseline:

### App routes and pages
- `app/account/page.js`
- `app/api/account/route.js`
- `app/api/admin/artists/[id]/route.js`
- `app/api/artist/paintings/[id]/route.js`
- `app/api/artist/paintings/route.js`
- `app/api/artist/payout-account/route.js`
- `app/api/artist/profile/route.js`
- `app/api/auth/login-password/route.js` *(new)*
- `app/api/auth/select-portal/route.js`
- `app/api/auth/verify-otp/route.js`
- `app/api/chat/route.js`
- `app/api/create-order/route.js`
- `app/api/order-documents/[orderId]/route.js`
- `app/api/verify-payment/route.js`
- `app/artist/onboarding/page.js`
- `app/artist/page.js`

### Components
- `components/AdminDashboard.js`
- `components/ArtistPrivateEarnings.js`
- `components/ChatWidget.js`
- `components/EarningsCalculator.js`
- `components/EmailOtpAuth.js`
- `components/OrderDocument.js`

### Database
- `database/schema.sql` *(new, additive/idempotent migration)*

`app/api/auth/send-otp/route.js` was not modified because the supplied V12 patch already contains its 30-second OTP cooldown and abuse controls.
