import 'server-only';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type LandingBlocklist = { images: string[]; events: string[] };

// data/landing-blocklist.json in the repo; next dev runs from apps/web-next.
const blocklistPath = () => resolve(process.cwd(), '../../data/landing-blocklist.json');

export const readLandingBlocklist = async (): Promise<LandingBlocklist> => {
  const parsed = JSON.parse(await readFile(blocklistPath(), 'utf8'));
  return { images: parsed.images ?? [], events: parsed.events ?? [] };
};

export const setLandingBlocked = async (
  kind: 'images' | 'events',
  value: string,
  blocked: boolean,
) => {
  const blocklist = await readLandingBlocklist();
  const values = new Set(blocklist[kind]);
  if (blocked) values.add(value);
  else values.delete(value);
  const next = { ...blocklist, [kind]: [...values].sort() };
  await writeFile(blocklistPath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
};
