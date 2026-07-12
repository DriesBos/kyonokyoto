import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { serializeInlineJson } from '../../../packages/shared/inline-json.mjs';

test('inline JSON cannot close its script element', () => {
  const serialized = serializeInlineJson({ name: '</script><script>alert(1)</script>' });

  assert.equal(serialized.includes('<'), false);
  assert.deepEqual(JSON.parse(serialized), { name: '</script><script>alert(1)</script>' });
});

test('internal Supabase tables enable RLS without public policies', async () => {
  const schema = await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');

  for (const table of ['sources', 'crawl_runs', 'raw_pages']) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.doesNotMatch(schema, new RegExp(`create policy[^;]+on public\\.${table}`, 'is'));
  }
});

test('published events require a machine-verifiable start date', async () => {
  const schema = await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  const constraint = schema.match(
    /add constraint events_date_presence_check check \((?<body>[\s\S]*?)\) not valid;/,
  )?.groups?.body;

  assert.match(constraint ?? '', /status <> 'published'/);
  assert.match(constraint ?? '', /start_date is not null/);
  assert.match(constraint ?? '', /calendar_starts_at is not null/);
  assert.match(constraint ?? '', /jsonb_array_length\(occurrence_dates\) > 0/);
});

test('Netlify and SSR responses carry baseline security headers', async () => {
  const [netlifyConfig, middleware] = await Promise.all([
    readFile(new URL('../../../netlify.toml', import.meta.url), 'utf8'),
    readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8'),
  ]);

  for (const header of [
    'Content-Security-Policy',
    'Permissions-Policy',
    'Referrer-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ]) {
    assert.match(netlifyConfig, new RegExp(header));
    assert.match(middleware, new RegExp(header));
  }

  assert.match(middleware, /'nonce-\$\{nonce\}'/);
  assert.doesNotMatch(middleware, /script-src[^;]*'unsafe-inline'/);
});
