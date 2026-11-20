# Rangrekha — Indian Art Store

A Next.js App Router (JavaScript) storefront with Tailwind CSS, Supabase, Shiprocket live courier quotes, Razorpay Checkout, and a password-protected admin studio.

## What is included

- Public gallery at `/`, showing only paintings where `is_sold = false`.
- Buyer checkout form for name, email, phone, address, city, state, and PIN code.
- Live courier options from Shiprocket, with rates rechecked on the server before payment-order creation.
- Razorpay order creation, HMAC signature verification, server-side payment status verification, and capture of authorised payments.
- Conditional sold-state update to reduce the risk of selling the same one-off painting twice.
- Shiprocket adhoc order creation after payment capture, followed by a best-effort AWB assignment using the selected courier.
- Admin studio at `/admin` for image upload, artwork details, sold/available toggling, and deletion.
- Supabase SQL setup in `database/schema.sql`.

## 1. Requirements

- Node.js 20.9 or newer.
- A Supabase project.
- A Shiprocket account with an API user created under **Settings → API**.
- A Razorpay account. Start with Razorpay Test Mode credentials.

## 2. Configure Supabase

1. Open the Supabase SQL Editor and run `database/schema.sql`.
2. Ensure the `paintings` table has the columns used by the app: `id`, `title`, `medium`, `dimensions`, `price`, `weight_kg`, `length_cm`, `breadth_cm`, `height_cm`, `image_url`, `is_sold`, and `created_at`.
3. The SQL creates a public `paintings` Storage bucket. Keep it public so public gallery image URLs can load.
4. Copy the project URL, anon key, and **service role** key from Project Settings → API.

**Important:** `SUPABASE_SERVICE_ROLE_KEY` is strongly required for the secure admin, order, and payment routes. It bypasses Row Level Security and must remain server-only. Do not rename it with a `NEXT_PUBLIC_` prefix. The SQL deliberately does not permit anonymous writes to the paintings table or access to the orders table.

If you already have a `paintings` table, do not drop it. Adapt the create-table section of the SQL to your existing `id` type and run the missing-column statements. The app treats `painting_id` as text in the private `orders` table so it can store UUID or numeric painting IDs.

## 3. Configure Shiprocket

1. In Shiprocket, create an API user under **Settings → API**. Use that API user's email and password, not your regular panel password unless Shiprocket specifically says they are the API credentials.
2. Configure a pickup address in the Shiprocket panel. The value of `SHIPROCKET_PICKUP_LOCATION` must match its pickup-location name exactly (the default in this project is `Primary`).
3. Set `PICKUP_PINCODE` to the pickup address's six-digit PIN code.
4. Confirm that the account is enabled for courier serviceability and order creation.

The app obtains and caches a Shiprocket bearer token in server memory, refreshing before its documented 10-day expiry. Serverless deployments may create multiple instances, so each instance can authenticate independently.

## 4. Configure Razorpay

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from Razorpay Dashboard → Account & Settings → API Keys. Use Test Mode first. Make sure payment capture is enabled in the Razorpay account; the verification route also attempts to capture an `authorized` payment before marking an artwork sold.

The browser uses Razorpay's official Standard Checkout script: `https://checkout.razorpay.com/v1/checkout.js`.

## 5. Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for admin/order/storage operations (**required for secure full functionality**) |
| `ADMIN_PASSWORD` | Server-only admin password (recommended) |
| `NEXT_PUBLIC_ADMIN_PASSWORD` | Compatibility fallback only; avoid using it because public-prefixed values are not secrets |
| `SHIPROCKET_EMAIL` | Shiprocket API user email |
| `SHIPROCKET_PASSWORD` | Shiprocket API user password |
| `PICKUP_PINCODE` | Six-digit pickup PIN code |
| `SHIPROCKET_PICKUP_LOCATION` | Optional exact pickup-location name; defaults to `Primary` |
| `RAZORPAY_KEY_ID` | Razorpay key ID |
| `RAZORPAY_KEY_SECRET` | Server-only Razorpay secret |

Do not commit `.env.local` or put secret keys in client-side code.

### Admin password note

The requested `NEXT_PUBLIC_ADMIN_PASSWORD` variable is supported as a fallback so the project can be configured with the exact variable list. However, the `NEXT_PUBLIC_` prefix indicates a value intended for browser exposure. For a real deployment, set `ADMIN_PASSWORD` on the server and leave `NEXT_PUBLIC_ADMIN_PASSWORD` empty. The admin password is checked by a server route and the browser receives only a short-lived HttpOnly signed session cookie.

## 6. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the gallery and `http://localhost:3000/admin` for the admin studio.

For a production build:

```bash
npm run build
npm run start
```

Deploy to a Node-compatible Next.js host and set all environment variables in the host's server environment. Keep service-role and Razorpay/Shiprocket secrets private.

## 7. End-to-end purchase flow

1. The gallery reads available paintings from Supabase.
2. The buyer submits delivery details. `/api/shipping-rates` asks Shiprocket for live courier options using the painting's packed dimensions and weight.
3. The buyer chooses a courier. `/api/create-order` fetches the painting again, obtains fresh courier rates, validates the selected courier, recomputes the payable amount, creates a Razorpay order, and stores a pending private order row.
4. Razorpay Checkout opens in the browser.
5. `/api/verify-payment` verifies the Razorpay HMAC, fetches the payment from Razorpay, captures it if authorised, and checks it is captured.
6. The app marks the painting sold using a conditional update and creates a Shiprocket adhoc order. It then attempts AWB assignment.

If Razorpay confirms payment but Shiprocket is temporarily unavailable, the order remains paid and the painting remains sold; `shipment_note` stores the fulfilment error for manual follow-up. A shipment can then be created from the Shiprocket panel after investigating the error.

## Production checklist

- Use `ADMIN_PASSWORD`, not `NEXT_PUBLIC_ADMIN_PASSWORD`.
- Add `SUPABASE_SERVICE_ROLE_KEY` as a server-only deployment secret.
- Keep the `orders` table private with RLS enabled and no anon/authenticated policies.
- Use HTTPS in production.
- Test courier rates, pickup-location name, address formats, Razorpay capture, and Shiprocket order creation in the relevant test/sandbox environment before accepting live orders.
- Configure Razorpay webhooks (`payment.captured` and `order.paid`) for additional resilience if a buyer closes the page before the Checkout handler returns. This starter project verifies payment on the Checkout callback but does not include a webhook endpoint.
- Add an operational refund process for the rare race where a payment is captured after the unique artwork was sold in another concurrent checkout. The verification route detects this and returns a manual-refund message rather than creating a second shipment.
- Confirm tax, invoicing, consumer-protection, shipping, and privacy requirements applicable to your business before going live.

## API routes

- `POST /api/shipping-rates`
- `POST /api/create-order`
- `POST /api/verify-payment`
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET, POST /api/admin/paintings`
- `PATCH, DELETE /api/admin/paintings/:id`
