# Artiste V10 — UI & Rayna Gallery Host Upgrade

This archive contains the complete updated `app/` and `components/` folders from the supplied Artiste V9 project.

## Included changes
- Refined shared Artiste logo lockup: botanical crest and serif wordmark above `THE INDIAN ART HOUSE · MY ART GALLERY`.
- The homepage hero now has one CTA, `Explore the collection`, which smoothly scrolls to `#collection`. The legacy `#gallery` anchor remains available for existing links.
- The gallery artist dropdown is derived from the active category. The Painting tab only lists Painter creators who have painting works; the Photography tab only lists Photographer creators who have photography works. Switching tabs resets the selected creator to `All`.
- Added `components/ChatWidget.js` and mounted it from `app/layout.js` as Rayna — Artiste Gallery Host.
- Rayna has a one-time, softly animated welcome bubble that fades after five seconds, a compact floating avatar, a clean greeting, three optional starter prompts, free-text chat, and WhatsApp / email escalation.
- Rebuilt `/api/chat` to fetch current public available works and approved creators from Supabase on every message, preferring `SUPABASE_SERVICE_ROLE_KEY` via the existing server helper and falling back to the anon client when not configured.
- Added server-side order/Bill Number detection and safe order status lookup, including artwork title, payment status, courier, AWB, shipping status and order date. Customer phone, email and delivery/street address are not selected or included in the AI context.
- Gemini requests use `gemini-2.5-flash`, `thinkingBudget: 0`, and `maxOutputTokens: 220`; the local conversational fallback remains available when Gemini is not configured or fails.
- No new npm packages and no database migration were added.

## Apply
Copy the included `app/` and `components/` folders over the matching folders in your existing Artiste V9 project. Keep your existing `lib/`, `database/`, configuration files and environment variables.

For Rayna's live catalogue and order lookup, configure `SUPABASE_SERVICE_ROLE_KEY` only in the server environment (never expose it with a `NEXT_PUBLIC_` prefix). Configure `GEMINI_API_KEY` for Gemini responses. Without the Gemini key, Rayna uses the built-in conversational fallback.

## Validation performed
- All 51 JavaScript files passed TypeScript's JS/JSX transpile syntax check.
- No duplicate declaration diagnostics were found.
- All local `@/components/...` imports resolve within the included folders.
- ZIP archive integrity was checked.

A full Next.js production build and live Supabase / Gemini / order-tracking tests were not run in this environment.
