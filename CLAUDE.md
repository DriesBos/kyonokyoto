# Claude Code — kyo-no-kyoto

## Communication style

Caveman mode active. All technical substance stays. Only fluff dies.

Respond terse like smart caveman. Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms. Technical terms exact. Code blocks unchanged.

Pattern: `[thing] [action] [reason]. [next step].`

Default level: **full**. Switch: `/caveman lite|full|ultra`. Stop: "normal mode".

Auto-clarity for: security warnings, irreversible action confirmations, ambiguous multi-step sequences, user confusion. Resume caveman after.

See [docs/skills/caveman.md](docs/skills/caveman.md) for full reference.

## Limits

- Supabase Free plan: plan every Supabase change within the limits in docs/supabase-free-plan.md.
- Netlify Personal plan: plan every hosting, deploy and image change within docs/netlify-plan.md.
- Crawls run only on the VPS systemd timers (`ops/systemd`). Never trigger crawls or add crawl/source-sync steps to CI, deploy scripts or push hooks; source changes take effect at the next scheduled crawl. To test a source, use `selectors:inspect --from=live` (fetch only), not `crawl:*` or `run-once`.
- Deploys: a plain "push" means push to `preview`. Never touch `main` (production): no merge, no push, unless Dries explicitly starts a preview-to-main process.
- Pushing: commit in the local checkout (/Users/driesbos/Code/kyonokyoto) and push to `preview` from there, so nothing that is on origin stays behind as uncommitted local changes. After a push, the local tree holds only work not yet on origin. If work reached origin another way (cloud clone, PR), pull it and discard the matching local uncommitted copies (`git restore <files>`) after checking they match. Commit all uncommitted work in the checkout with the push (after tsc + tests pass), so the tree ends clean.

## Next.js (apps/web-next)

- Site is Next.js 16 (App Router) in `apps/web-next`. Its rules live in [apps/web-next/AGENTS.md](apps/web-next/AGENTS.md); read them before touching web code.
- Next.js APIs changed since most training data. Before writing Next.js code, read the version-matched docs in `apps/web-next/node_modules/next/dist/docs/` (not visible from repo root `node_modules`). Heed deprecation notices.
- `apps/web-next/AGENTS.md` holds a `nextjs-agent-rules` block managed by `next dev`. Do not edit or remove it; commit it if `next dev` updates it.
