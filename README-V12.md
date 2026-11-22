# Artiste V12 — drop-in replacements for V11

Copy these files over the matching paths in your V11 project (keep `lib/`, `database/`, `public/`, `package.json`):

- app/api/chat/route.js — Rayna backend (Gemini fallback chain, live catalogue, zero-leak order lookup)
- components/ChatWidget.js — Rayna UI
- app/api/auth/verify-otp/route.js — explicit password + email_confirm, dual Customer/Artist identity
- app/api/auth/send-otp/route.js — no SMTP/DB error leakage to the browser (small patch)
- components/EmailOtpAuth.js — shared sign-in UI used by /account and /artist; holds the 30s resend countdown
- app/account/page.js, app/artist/page.js — portal session handling

No new npm packages. Server env: GEMINI_API_KEY (required for AI replies), optional GEMINI_MODEL to
pick the first model tried. verify-otp also reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
(already present for supabase-browser).
