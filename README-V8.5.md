# Artiste V8.5 — Visual & UX Upgrade

This is a drop-in UI upgrade for the existing Artiste V8 project.

## Included
- Complete updated `app/` folder, including all existing V8 API routes and the new `/api/cultural-feed` route.
- Complete updated `components/` folder, including the global profile-aware navbar, botanical logo crest and Journal feed.
- Updated `tailwind.config.js` design tokens for the warm ivory / sand / botanical / terracotta / antique-gold palette.

## Apply to the existing V8 project
1. Keep your existing V8 `lib/`, `database/`, `.env*`, `package.json`, and other root configuration files.
2. Extract this ZIP into the V8 project root and allow the included `app/`, `components/`, and `tailwind.config.js` to replace the existing versions.
3. No database migration, new environment variable, or additional npm dependency is required for V8.5.

## V8 backend preservation
Existing OTP/password auth, Gemini `/api/chat`, creator approval, role-based commissions, stock/restock/delete, Shiprocket, invoices/Bills of Supply, `lib/siteConfig.js`, and the owner-only `/studio-vault-owner` implementation are retained. The only new API endpoint is `/api/cultural-feed`, which fetches Google News RSS with caching and an Artiste-curated fallback.

## Validation
- 50 JavaScript/JSX files parsed successfully with the installed TypeScript parser.
- No syntax diagnostics found.
- Local `@/` imports checked: no missing project-local imports.
- `GalleryClient` continues to receive the `artists` prop and uses `artistOptions` for its filter; no conflicting `const artists` declaration remains.
- A complete Next.js production build was not run because this source package does not contain `node_modules` and dependency installation was not performed in this environment.
