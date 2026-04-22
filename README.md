# kyo-no-kyoto

Kyoto cultural events app.

The goal is to crawl museums, galleries, festival pages, and venue sites in Kyoto, normalize that data, store it in Supabase, and publish it through an Astro frontend.

## Structure

- `apps/web` - Astro frontend
- `apps/crawler` - crawler runtime env and future crawler code
- `packages/shared` - shared types and utilities
- `supabase` - database schema and migrations
- `docs` - project notes and skill references

## Requirements

- Node `>= 22.12.0`
- npm
- Supabase project

## Environment

Root:
- `.env` for shared local infra values
- `.env.example` as the template

App-specific:
- `apps/web/.env`
- `apps/crawler/.env`

Do not commit real secrets. Commit only `*.env.example`.

## Web Setup

Install dependencies:

```bash
cd apps/web
npm install
```

Run the Astro dev server:

```bash
npm run dev
```

Current public env vars used by the web app:

```env
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Crawler Setup

Crawler env lives in:

```bash
apps/crawler/.env
```

Current crawler config expects:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
CRAWLER_TIMEZONE=Asia/Tokyo
CRAWLER_SCHEDULE=0 */6 * * *
```

Crawler implementation is not scaffolded yet. The next steps are source batching, schema design, and local crawl testing.

## Git

This project uses one root repository for both apps.

Recommended future deployment split:
- one workflow for `apps/web`
- one workflow for `apps/crawler`

## Current Status

Done:
- Supabase project initialized
- Astro app scaffolded
- web Supabase client dependency installed
- root git repo initialized

Next:
- define source batch
- define event schema
- scaffold crawler code
- connect data flow from crawler to Supabase to Astro
