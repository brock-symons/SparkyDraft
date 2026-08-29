# Sparky Draft

Sparky Draft is a mobile-first web app for drafting electrical switchboard and floor plan layouts. It supports quotes, elevations, floor plans, grid layouts, and circuit/comms rack assignment, with projects synced through Supabase and shared across organization members.

## Getting started

Open `index.html` in a browser — it's a self-contained single-page app with no build step.

## Database

The `supabase-*.sql` files set up the Supabase schema and RPC functions used for authentication, organizations, projects, and member lookups. Run them against your Supabase project in the following order:

1. `supabase-schema.sql`
2. `supabase-organizations.sql`
3. `supabase-organization-projects.sql`
4. `supabase-org-member-lookup.sql`
5. `supabase-add-user-name-column.sql`
