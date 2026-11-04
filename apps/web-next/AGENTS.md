# apps/web-next

Next.js (App Router) site, in production. Replaced the retired Astro app (`apps/web`, removed).

## Styling

- We use SASS (indented `.sass` syntax).
- Global files in `src/styles/` (`globals.sass`, `typography.sass`, `variables.sass`) hold the design system: tokens, resets, and base typography. Add new design-system concerns as global files here.
- City colours, dark mode backgrounds and contrast checks: see `docs/color-palettes.md`.
- Components use React style modules (`Component.module.sass`), colocated with the component. Pull shared tokens in with `@use '@/styles/variables' as *`.

## Images

- Do not use `next/image` for remote event images. Event media goes through the Netlify Image CDN (`/.netlify/images`) with the allowlist in `netlify.toml`, (see `src/lib/mediaDelivery.ts`, which also serves self-hosted `/venues/` photos and proxies Yutaka Kikutake images). Next's `images.remotePatterns` caps at 50 entries; our allowlist is larger.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
