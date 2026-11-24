# Artiste Version 16

Version 16 is built on the supplied Version 15 project.

## Included updates
- Incomplete Artist profiles stay in the inline profile editor on `/artist`.
- Customer portal sessions can add gallery and artwork-modal items directly to the cart; the navbar displays cart quantity events.
- Restored the private Material + Hours pricing calculator with editable 2.5x default margin and private payout preview.
- Pickup street address, PIN, locality, city/district and State/UT are mandatory; landmark is optional.
- Creator profiles require studio name, WhatsApp number, verified email and bio; profile discipline is no longer locked in the editor. Artwork category controls the per-artwork photo limit (4 paintings / 2 photography).
- Founding Artist application now requests the streamlined profile, 3–5 portfolio photos and four agreements. The owner dashboard includes a pending queue, portfolio previews, approval and decline actions.

## Deployment notes
1. Review the updated `database/schema.sql` and apply it to the Supabase project before deploying.
2. Confirm the `artist_applications` table and `paintings` storage bucket are present and the service-role key is configured server-side.
3. Run `npm install` and `npm run build` in the deployment environment with the project's production environment variables.
4. Verify Customer login/cart/checkout, Artist profile save, both artwork categories, Shiprocket pickup, Razorpay payment verification, invoice generation, and the 10-minute inactivity logout in staging before production rollout.

Existing Rayna AI, Shiprocket, Razorpay, invoice/Bill of Supply, and session modules were not intentionally rewritten.
