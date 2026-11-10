// fontkit ships no types; the Instagram post renderer (lib/socialFont.ts) only needs create().
declare module 'fontkit' {
  export function create(buffer: Uint8Array): unknown;
}
