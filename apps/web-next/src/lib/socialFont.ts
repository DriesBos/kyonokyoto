import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create } from 'fontkit';

// GT Walsheim for the Instagram post renderer (packages/shared/social-post.mjs draws text as
// glyph paths). The URL form lets Next trace the file into the server bundle; the cwd path is the
// fallback for next dev.
let fontPromise: Promise<unknown> | null = null;

export const socialFont = () =>
  (fontPromise ??= (async () => {
    const bytes = await readFile(
      new URL('../app/fonts/GT-Walsheim-Regular.woff2', import.meta.url),
    ).catch(() => readFile(join(process.cwd(), 'src/app/fonts/GT-Walsheim-Regular.woff2')));
    return create(bytes);
  })());
