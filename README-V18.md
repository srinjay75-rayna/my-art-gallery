# Artiste V18 — presentation format, partner packing and 72-hour dispatch

Apply the complete `database/schema.sql` to the target Supabase project before deploying this version. The migration adds presentation format and packing choice fields to artworks, a separate insured studio packing amount to orders, a payable ledger for Ganesh Packers and Movers, pickup-window tracking and a private packer notification log.

Configure these server-side Vercel environment variables to enable partner dispatch notifications: `PACKER_EMAIL`, `PACKER_WHATSAPP`, `WHATSAPP_API_URL`, and `WHATSAPP_API_TOKEN`. The WhatsApp adapter sends an authenticated JSON POST with `{ "to": "<PACKER_WHATSAPP>", "message": "<dispatch summary>" }` and a Bearer token; configure the URL for a provider endpoint that accepts that contract. SMTP uses the existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` settings. Do not prefix the private variables with `NEXT_PUBLIC_`.

Partner packing charges are calculated server-side and stored independently from artwork value, Artist commission and Artist payout. Self-packed works carry no partner packing charge and are excluded from Ganesh notifications.

The 72-hour packing-completion threshold is stored as the exact order-confirmation timestamp plus 72 hours. Shiprocket's pickup-generation endpoint accepts a calendar date (`pickup_date`, formatted `YYYY-MM-DD`) rather than a time of day. To avoid a courier being requested for any part of the threshold date before the 72-hour timestamp, Artiste requests the next India-time calendar date after the threshold date. This deliberately adds a safety buffer beyond 72 hours.
