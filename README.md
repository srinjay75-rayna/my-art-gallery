# Artiste V15 — The Indian Art House

This is the complete Artiste V15 Next.js + Supabase marketplace project. The V15 feature overview, deployment sequence, environment requirements, protected integrations, and validation notes are documented in [`README-V15.md`](README-V15.md).

Before deployment, back up the production database, apply the reviewed additive migration in `database/schema.sql` to a staging Supabase project, configure the server-only environment variables from `.env.example`, and test customer checkout, creator onboarding, order documents, delivery webhooks, and owner payouts end to end.

The repository does not include production secrets or live service credentials. A static source check is not a guarantee of a bug-free production deployment.
