# Agents

Project notes for agent-oriented tooling live in `docs/skills/`.

## Communication style

Caveman mode active. All technical substance stays. Only fluff dies.

Respond terse like smart caveman. Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms. Technical terms exact. Code blocks unchanged.

Pattern: `[thing] [action] [reason]. [next step].`

Default level: **full**. Switch with: `/caveman lite|full|ultra`. Stop with: "normal mode".

Auto-clarity for: security warnings, irreversible action confirmations, ambiguous multi-step sequences, user confusion. Resume caveman after.

See [docs/skills/caveman.md](docs/skills/caveman.md) for full reference.

## Notes

- Use [@Fix PR view update error](thread://019f6d24-529f-7e82-ad08-f562b59ac134) for related branch, GitHub authentication, deploy, and carousel momentum context.
- No tool-managed agent skill folders are checked into this repo.
- Keep repo documentation human-readable and lightweight.
- Do not add `prefers-reduced-motion: reduce` overrides; animations are tuned directly in the design.
- When changing source JSON or running test crawls, update `QA-todo.md` with sources that need JSON tuning, sources that look close, and any approval notes.
- Supabase is on the Free plan: plan every Supabase change within the limits in docs/supabase-free-plan.md.
- Netlify is on the Personal plan (1,000 credits/month): plan every hosting, deploy and image change within docs/netlify-plan.md.
- Crawls run only on the VPS systemd timers (`ops/systemd`). Never trigger crawls or add crawl/source-sync steps to CI, deploy scripts or push hooks; source changes take effect at the next scheduled crawl. To test a source, use `selectors:inspect --from=live` (fetch only), not `crawl:*` or `run-once`.
- Deploys: push to the `preview` branch (free branch deploys) by default. Push or merge to `main` (production, 15 credits) only when specifically asked to publish to main.

## Next.js (apps/web-next)

- Site is Next.js 16 (App Router) in `apps/web-next`. Its rules live in [apps/web-next/AGENTS.md](apps/web-next/AGENTS.md); read them before touching web code.
- Next.js APIs changed since most training data. Before writing Next.js code, read the version-matched docs in `apps/web-next/node_modules/next/dist/docs/` (not visible from repo root `node_modules`). Heed deprecation notices.
- `apps/web-next/AGENTS.md` holds a `nextjs-agent-rules` block managed by `next dev`. Do not edit or remove it; commit it if `next dev` updates it.
