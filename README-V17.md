# Artiste Version 17

Version 17 applies the two-stage Founding Artist approval, dynamic commission tiers, private studio pricing planner, proof-backed payout settlement and owner accounting updates to the supplied Version 16.1 project.

## Included changes

- The Founding Artist application submit control stays disabled until all four consent checkboxes are accepted; the API independently enforces all four and records the accepted agreement text.
- The `/artist` portal keeps Artwork Listing and Studio / Payout Profile locked until host approval. Once approved, the application form is hidden and both studio sections unlock.
- The first ten approved Founding Artists are assigned an 80% Artist share / 20% Platform commission. Further approvals receive 75% Artist share / 25% Platform commission. The tier is assigned under a database transaction lock, and order snapshots retain each artwork's applied commission rate.
- The material, time, overhead, margin and packing calculator is available only in the authenticated Artist studio and the owner-only Studio Vault pricing desk; it is not added to gallery, cart or invoice data.
- The owner dashboard includes a pending approval queue, permanent approved-application archive and downloadable application PDF dossiers.
- The owner dashboard includes Host totals, payout proof modal, partial and full payment status, private receipt links, and the Accounts & Ledger module.
- Payment proof is mandatory for payout settlement. The receipt is stored in a private Supabase Storage bucket; paid amounts are accumulated and each transfer produces a balanced accounting journal entry.
- Accounting ledgers, vouchers and entries support custom ledgers, balanced manual vouchers, trial balance, P&L, balance sheet, print and statement / ledger CSV export. Confirmed orders post customer receipts, artist payable, platform commission, shipping recovery, and quoted Shiprocket courier expense / payable automatically.
- Historical payout commission snapshots are preserved; new defaults and approvals use the new commission tiers.

## Database deployment

1. Back up the Supabase project and review `database/schema.sql`.
2. Apply the complete schema to the same Supabase project before deploying the application. The V17 section adds application agreement snapshots and tier metadata, payout proof fields, approval and accounting RPCs, accounting tables, and the private `payout-proofs` bucket.
3. Keep the Supabase service-role key server-side only. Confirm the existing Supabase Storage buckets and SMTP configuration remain in place.
4. Keep existing Razorpay, Shiprocket, Rayna AI, invoice and session environment variables configured as before.

## Verification

Run `npm install` and `npm run build` with the deployment environment's production variables. Then test in staging: incomplete and complete consent submission; approval of artists 1–11; Artist portal lock/unlock; pricing calculator visibility; an order checkout and verified Razorpay capture; Shiprocket pickup; the 48-hour delivery hold; a partial payout with receipt; final settlement; both owner and Artist proof links; approval PDF; and trial balance / P&L / balance sheet exports.

Rayna AI, existing Shiprocket request handlers, Razorpay verification, serial Bill of Supply numbering and the existing ten-minute inactivity logout were not intentionally replaced.
