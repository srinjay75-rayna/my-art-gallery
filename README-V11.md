# Artiste V11 patch package

This archive contains the complete updated `app/` and `components/` folders for Artiste V11. It is intended as a code replacement over the existing V10 project, not as a stand-alone Next.js project.

## V11 changes

- Rayna's chat drawer is constrained to `78vh`, has a sticky header with a visible close control, and can be opened/minimised by clicking the Rayna portrait. Goodbye messages are still sent to Gemini and the drawer closes 1.5 seconds after Rayna replies. A deliberate portrait click cancels a pending close.
- Rayna sends up to 16 user/assistant turns to `/api/chat` on each request. With `GEMINI_API_KEY` configured, normal messages are routed to Gemini after live catalogue/creator context and any single referenced order are fetched. The keyword-based reply helper is only a fallback when Gemini is not configured or returns an error.
- Order lookup is reference-triggered and limited to one order. The query selects only order identifiers, artwork title, payment status, courier/AWB/shipping status and dates; it does not fetch the `items` JSON or customer PII.
- OTP verification now explicitly writes a submitted password and confirms the email through Supabase Auth Admin for signup and password-reset OTP flows.
- Added `/api/auth/select-portal` to verify real Customer/Artist membership before password login or restored sessions enter the selected portal.
- A single email can own both a Customer profile and an Artist profile. Existing V10 Customer sign-ups that had not completed onboarding are migrated to a minimal `public.profiles` row on their next verified login.
- The OTP UI displays a live 30-second resend countdown. The send endpoint enforces the matching per-email server-side cooldown and returns `Retry-After` when the user needs to wait.
- No new npm packages are required.

## Important account model limitation

Supabase Auth enforces one Auth user per email address. V11 therefore reuses one verified Auth identity for both portal memberships: Customer details live in `public.profiles` and creator details live in `public.artists`. The Customer and Artist portal records and access checks remain separate, but **the email has one shared Supabase password across both portals**. Adding the second portal with the same email, or resetting the password, updates that shared password. This package does not create separate independent passwords for the same email.

The current Artiste schema uses `public.profiles` for Customers (not `public.customers`), matching the existing `/api/account` implementation. V11 preserves that schema rather than adding a parallel customer table.

## Deployment

1. Replace your existing `app/` and `components/` directories with the two directories in this archive.
2. Keep the existing V10 `lib/`, `database/`, `public/`, `package.json`, lockfile, Tailwind/Next configuration and environment files. In particular, retain `lib/siteConfig.js`, `lib/supabase.js`, `lib/supabase-browser.js`, `lib/auth-server.js`, `lib/client-auth.js` and `lib/request-guard.js`.
3. Keep `public/rayna-avatar.png`; the widget loads it directly with a native image element.
4. Keep server-only `SUPABASE_SERVICE_ROLE_KEY`, `OTP_HASH_SECRET`, SMTP credentials and `GEMINI_API_KEY` in the hosting provider's server environment. Never prefix these secrets with `NEXT_PUBLIC_`.
5. The OTP resend limiter depends on the existing database-backed `consume_api_rate_limit` function and `api_rate_limits` table from the Artiste V9/V10 schema. The OTP verifier also depends on the existing `email_otps` table and `consume_email_otp` RPC. No new V11 SQL migration is introduced.
6. Run `npm run build`, then test Customer signup/login, Artist signup/login for both disciplines, adding the second portal to one email, password reset, OTP resend, Rayna Gemini responses, a specific order lookup and the checkout/invoice flows before production rollout.

## Validation in this environment

All 52 JavaScript/JSX sources in `app/` and `components/` passed static syntax parsing. No duplicate declaration diagnostics or missing package-internal `@/components` imports were found. The changed server routes also passed `node --check`.

A full Next.js production build and live Supabase Auth, SMTP, Gemini, Shiprocket and Razorpay tests were not run: the supplied V10 archive contains only `app/`, `components/` and its README, not the original `package.json`, dependencies, `lib/`, database dump or public assets. Static validation is not production certification.
