# apps/web-next

Next.js (App Router) rewrite of the site. `apps/web` (Astro) stays in production until this app reaches parity.

## Styling

- We use SASS (indented `.sass` syntax, matching `apps/web`).
- Global files in `src/styles/` (`globals.sass`, `typography.sass`, `variables.sass`) hold the design system: tokens, resets, and base typography. Add new design-system concerns as global files here.
- Components use React style modules (`Component.module.sass`), colocated with the component. Pull shared tokens in with `@use '@/styles/variables' as *`.

## Images

- Do not use `next/image` for remote event images. Event media goes through the Netlify Image CDN (`/.netlify/images`) with the allowlist in `netlify.toml`, same pipeline as `apps/web` (see `apps/web/src/lib/mediaDelivery.ts`). Next's `images.remotePatterns` caps at 50 entries; our allowlist is larger.
