import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const env = Object.fromEntries(
  (await readFile(resolve(process.cwd(), 'apps/crawler/.env'), 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
);
const city = getArg('city', 'unknown');
const webhookUrl = env.CRAWL_ALERT_WEBHOOK_URL;

if (!webhookUrl) {
  console.warn(`Crawler failed for ${city}; CRAWL_ALERT_WEBHOOK_URL is not configured`);
  process.exit(0);
}

const response = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    status: 'systemd_failed',
    city,
    unit: `kyo-no-kyoto-crawl@${city}.service`,
    timestamp: new Date().toISOString(),
  }),
});

if (!response.ok) throw new Error(`Crawler failure webhook failed (${response.status})`);
