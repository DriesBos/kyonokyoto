-- Disposable empty database only: this check deletes raw-page fixtures and uses a tiny budget.
-- Every change rolls back when all assertions pass.
begin;

insert into public.sources (
  id,
  slug,
  city,
  name,
  source_type,
  base_url
)
values (
  '10000000-0000-0000-0000-000000000001',
  'storage-retention-regression',
  'kyoto',
  'Storage retention regression',
  'museum',
  'https://retention.example'
);

insert into public.crawl_runs (
  id,
  source_id,
  status,
  logs,
  created_at
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'success',
    '[{"old": true}]',
    now() - interval '31 days'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'success',
    '[{"recent": true}]',
    now()
  );

insert into public.raw_pages (
  id,
  source_id,
  url,
  raw_html,
  extracted_text,
  content_hash,
  fetched_at
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/versioned',
    repeat('a', 50),
    repeat('a', 5),
    'version-1',
    now() - interval '2 days'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/versioned',
    repeat('b', 50),
    repeat('b', 5),
    'version-2',
    now() - interval '1 day'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/versioned',
    repeat('c', 100),
    repeat('c', 20),
    'version-3',
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/expired-referenced',
    repeat('d', 80),
    repeat('d', 10),
    'expired-referenced',
    now() - interval '8 days'
  ),
  (
    '30000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/expired-unreferenced',
    repeat('e', 80),
    repeat('e', 10),
    'expired-unreferenced',
    now() - interval '8 days'
  ),
  (
    '30000000-0000-0000-0000-000000000009',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/old-omitted',
    null,
    null,
    'old-omitted',
    now() - interval '8 days'
  );

update public.raw_pages
set metadata = '{"raw_html_omitted": "crawler_limit"}'::jsonb
where id = '30000000-0000-0000-0000-000000000009';

insert into public.events (
  id,
  source_id,
  raw_page_id,
  dedupe_key,
  title,
  institution_name,
  date_text,
  source_url
)
values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'storage-retention-versioned',
    'Versioned event',
    'Retention Museum',
    'September 2026',
    'https://retention.example/versioned'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000004',
    'storage-retention-expired',
    'Expired event',
    'Retention Museum',
    'September 2026',
    'https://retention.example/expired-referenced'
  );

insert into public.raw_pages (
  source_id,
  url,
  raw_html,
  extracted_text,
  content_hash,
  fetched_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  'https://retention.example/versioned',
  repeat('c', 100),
  repeat('c', 20),
  'version-3',
  now()
)
on conflict (source_id, url, content_hash)
do update set
  raw_html = excluded.raw_html,
  extracted_text = excluded.extracted_text,
  fetched_at = excluded.fetched_at;

do $$
begin
  if (
    select octet_length(coalesce(raw_html, '')) + octet_length(coalesce(extracted_text, ''))
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000003'
  ) <> 120 then
    raise exception 'upsert incorrectly counted replacement payload twice';
  end if;
end;
$$;

insert into public.raw_pages (
  id,
  source_id,
  url,
  raw_html,
  extracted_text,
  content_hash,
  fetched_at
)
values (
  '30000000-0000-0000-0000-000000000006',
  '10000000-0000-0000-0000-000000000001',
  'https://retention.example/oversized',
  repeat('é', 500001),
  'should also be cleared',
  'oversized',
  now()
);

do $$
begin
  if exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000006'
      and (raw_html is not null or extracted_text is not null)
  ) then
    raise exception 'oversized incoming payload was stored';
  end if;

  if (
    select metadata -> '_storage_retention' ->> 'reason'
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000006'
  ) <> 'raw_html_over_1mb' then
    raise exception 'oversized incoming payload lacks retention reason';
  end if;
end;
$$;

select public.prune_raw_pages(
  p_older_than => interval '7 days',
  p_limit => 100
);

do $$
begin
  if (
    select count(*)
    from public.raw_pages
    where source_id = '10000000-0000-0000-0000-000000000001'
      and url = 'https://retention.example/versioned'
      and (raw_html is not null or extracted_text is not null)
  ) <> 1 then
    raise exception 'version retention did not keep exactly one payload';
  end if;

  if not exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000001'
      and raw_html is null
      and extracted_text is null
  ) then
    raise exception 'event-linked superseded row was not preserved as metadata';
  end if;

  if not exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000004'
      and raw_html is null
      and extracted_text is null
  ) then
    raise exception 'event-linked expired row was not preserved as metadata';
  end if;

  if exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000005'
  ) then
    raise exception 'unreferenced expired row was not deleted';
  end if;

  if exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000009'
  ) then
    raise exception 'old crawler-omitted empty row was not deleted';
  end if;

  if not exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000006'
      and raw_html is null
      and extracted_text is null
  ) then
    raise exception 'recent empty stub was deleted before event ingestion could reference it';
  end if;

  if (select logs from public.crawl_runs where id = '20000000-0000-0000-0000-000000000001') <> '[]'::jsonb then
    raise exception 'old crawl logs were not cleared';
  end if;

  if (select logs from public.crawl_runs where id = '20000000-0000-0000-0000-000000000002') = '[]'::jsonb then
    raise exception 'recent crawl logs were cleared';
  end if;
end;
$$;

insert into public.raw_pages (
  id,
  source_id,
  url,
  raw_html,
  extracted_text,
  content_hash,
  fetched_at
)
values
  (
    '30000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/budget-old',
    repeat('f', 140),
    repeat('f', 10),
    'budget-old',
    now() - interval '2 hours'
  ),
  (
    '30000000-0000-0000-0000-000000000008',
    '10000000-0000-0000-0000-000000000001',
    'https://retention.example/budget-new',
    repeat('g', 140),
    repeat('g', 10),
    'budget-new',
    now() - interval '1 hour'
  );

insert into public.events (
  id,
  source_id,
  raw_page_id,
  dedupe_key,
  title,
  institution_name,
  date_text,
  source_url
)
values (
  '40000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000007',
  'storage-retention-budget',
  'Budget event',
  'Retention Museum',
  'September 2026',
  'https://retention.example/budget-old'
);

do $$
declare
  result jsonb;
begin
  result := public.maintain_crawler_storage(
    p_payload_budget_bytes => 270,
    p_delete_limit => 100
  );

  if (result ->> 'raw_payload_bytes')::bigint <> 270 then
    raise exception 'payload budget result was %, expected 270', result ->> 'raw_payload_bytes';
  end if;

  if (result ->> 'cleared_pages')::integer <> 1 then
    raise exception 'budget should clear exactly one oldest payload';
  end if;

  if not result ?& array[
    'cleared_pages',
    'deleted_pages',
    'cleared_logs',
    'raw_payload_bytes',
    'database_bytes',
    'warning'
  ] then
    raise exception 'maintenance result is missing metrics';
  end if;

  if not exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000007'
      and raw_html is null
      and extracted_text is null
  ) then
    raise exception 'budget did not clear oldest event-linked payload';
  end if;

  if not exists (
    select 1
    from public.raw_pages
    where id = '30000000-0000-0000-0000-000000000008'
      and raw_html is not null
      and extracted_text is not null
  ) then
    raise exception 'budget cleared newer payload unnecessarily';
  end if;

  if has_function_privilege(
    'anon',
    'public.maintain_crawler_storage(interval,interval,bigint,integer)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute storage maintenance';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.maintain_crawler_storage(interval,interval,bigint,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute storage maintenance';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.maintain_crawler_storage(interval,interval,bigint,integer)',
    'EXECUTE'
  ) then
    raise exception 'service role cannot execute storage maintenance';
  end if;
end;
$$;

delete from public.raw_pages;

insert into public.raw_pages (
  source_id,
  url,
  raw_html,
  extracted_text,
  content_hash,
  fetched_at
)
select
  '10000000-0000-0000-0000-000000000001',
  'https://retention.example/cap-' || sequence,
  repeat('x', 1000000),
  null,
  'cap-' || sequence,
  now()
from generate_series(1, 151) as sequence;

do $$
begin
  if (
    select coalesce(sum(
      octet_length(coalesce(raw_html, ''))::bigint
        + octet_length(coalesce(extracted_text, ''))::bigint
    ), 0)
    from public.raw_pages
  ) <> 150000000 then
    raise exception 'multi-row insert exceeded the 150 MB incoming payload cap';
  end if;

  if (
    select count(*)
    from public.raw_pages
    where raw_html is not null
  ) <> 150 then
    raise exception 'incoming payload cap should retain exactly 150 one MB rows';
  end if;

  if not exists (
    select 1
    from public.raw_pages
    where url = 'https://retention.example/cap-151'
      and raw_html is null
      and metadata -> '_storage_retention' ->> 'reason' = 'raw_payload_budget'
  ) then
    raise exception 'incoming payload cap did not clear final multi-row insert';
  end if;
end;
$$;

insert into public.raw_pages (
  source_id,
  url,
  raw_html,
  extracted_text,
  content_hash,
  fetched_at
)
values (
  '10000000-0000-0000-0000-000000000001',
  'https://retention.example/cap-1',
  repeat('x', 1000000),
  null,
  'cap-1',
  now()
)
on conflict (source_id, url, content_hash)
do update set
  raw_html = excluded.raw_html,
  extracted_text = excluded.extracted_text,
  fetched_at = excluded.fetched_at;

do $$
begin
  if (
    select octet_length(coalesce(raw_html, ''))
    from public.raw_pages
    where url = 'https://retention.example/cap-1'
  ) <> 1000000 then
    raise exception 'upsert counted replacement payload twice at the cap';
  end if;

  if (
    select coalesce(sum(
      octet_length(coalesce(raw_html, ''))::bigint
        + octet_length(coalesce(extracted_text, ''))::bigint
    ), 0)
    from public.raw_pages
  ) <> 150000000 then
    raise exception 'upsert changed payload total at the cap';
  end if;
end;
$$;

rollback;
