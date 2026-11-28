# Artiste V20 — The Indian Art House

V20 builds on the complete V19 project and preserves its existing Painter approvals, Painter commission tiers and studio workflow, Ganesh Packers and Movers dispatch, 72-hour Shiprocket pickup buffer, Razorpay order verification, manual payout proof workflow, double-entry accounting, Rayna AI and serial Bill of Supply numbering.

## V20 additions

- A simplified Photographer listing workflow with Grade I artist fee input and proportional Grade I–IV Collector Edition pricing.
- Four capped photography editions with atomic edition reservations, edition numbers and printable Gold-Sealed Certificates of Authenticity.
- Print Lab fulfilment notifications and optional authenticated webhook, with Shiprocket pickup originating from the configured Print Lab PIN.
- Artist achievements, exhibitions and award photos for Painters and Photographers.
- A homepage open creative call with Host review tools in the owner vault.

## Database and environment setup

1. Back up the production Supabase database. Apply the additive V20 section at the end of `database/schema.sql` to a staging database first, verify the existing V19 data and workflows, and then apply it to production.
2. Configure the variables documented in `.env.example`. In particular set `PRINT_LAB_PICKUP_PIN` to a valid six-digit PIN matching a pickup location configured in Shiprocket. Set `PRINT_LAB_EMAIL` for production instructions. `PRINT_LAB_API_URL` and `PRINT_LAB_API_KEY` are optional and must be configured together to enable the optional webhook.
3. Set the four `NEXT_PUBLIC_PRINT_GRADE_*_LAB_COST` variables to the current print and framing rates. Defaults are provided in `.env.example`; a new Vercel deployment is required for updated public environment values to take effect.
4. Configure SMTP variables for Print Lab, concierge and Host notification emails.
5. Test Photographer and Painter uploads, cart edition selection, live courier quoting, Razorpay test payments, edition counters, COA access, creative-entry review, achievements and all existing V19 workflows in staging before release.

## Validation note

The JavaScript / JSX / MJS source files were syntax-parsed and local import paths were checked. A full Next.js production build could not be run in this environment because dependency installation did not complete. Production credentials and live Shiprocket, Razorpay, Supabase and SMTP services are not included in this archive; end-to-end verification must be performed in the configured staging environment.
