# Artiste V20 — The Indian Art House

This is the complete Artiste V20 Next.js + Supabase marketplace project. See [`README-V20.md`](README-V20.md) for the V20 feature overview, database migration order, environment configuration and validation notes.

Before deployment, back up the production database, apply and validate the additive migration in `database/schema.sql` on staging, configure the server and public environment variables from `.env.example`, and test both the new V20 photography / creative-entry workflows and all existing Painter, checkout, shipping, accounting and owner workflows.

The archive does not include production secrets or live service credentials. Static source validation does not guarantee a bug-free production deployment.
