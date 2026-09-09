# Supabase migration

This directory prepares the production PostgreSQL schema. For the Swift Logistics project at `https://lkxbkquzzzxfajyebxob.supabase.co`, run `schema.sql` in the Supabase SQL Editor.

Do not expose the Supabase service-role key in browser code. The current Node/SQLite server must be replaced with a Postgres/Supabase server adapter before deploying to Vercel; serverless Vercel storage is not persistent enough for SQLite.
