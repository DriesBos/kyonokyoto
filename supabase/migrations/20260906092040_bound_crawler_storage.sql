begin;

create or replace function public.lock_crawler_storage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('public.raw_pages storage retention', 0)
  );
  return null;
end;
$$;

drop trigger if exists lock_crawler_storage on public.raw_pages;
create trigger lock_crawler_storage
before insert or update or delete or truncate on public.raw_pages
for each statement
execute function public.lock_crawler_storage();

create or replace function public.bound_raw_page_payload()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_payload_bytes bigint := 0;
  incoming_payload_bytes bigint;
  payload_bytes bigint;
  retention_reason text;
begin
  if current_setting('app.maintaining_crawler_storage', true) = 'on' then
    return new;
  end if;

  incoming_payload_bytes :=
    octet_length(coalesce(new.raw_html, ''))::bigint
    + octet_length(coalesce(new.extracted_text, ''))::bigint;

  if tg_op = 'UPDATE' then
    existing_payload_bytes :=
      octet_length(coalesce(old.raw_html, ''))::bigint
      + octet_length(coalesce(old.extracted_text, ''))::bigint;
  elsif new.content_hash is not null then
    select
      octet_length(coalesce(raw_page.raw_html, ''))::bigint
        + octet_length(coalesce(raw_page.extracted_text, ''))::bigint
    into existing_payload_bytes
    from public.raw_pages as raw_page
    where raw_page.source_id = new.source_id
      and raw_page.url = new.url
      and raw_page.content_hash = new.content_hash
    limit 1;

    existing_payload_bytes := coalesce(existing_payload_bytes, 0);
  end if;

  -- ponytail: O(n) sum avoids a mutable counter; add one only if writes become slow.
  select coalesce(sum(
    octet_length(coalesce(raw_page.raw_html, ''))::bigint
      + octet_length(coalesce(raw_page.extracted_text, ''))::bigint
  ), 0)
  into payload_bytes
  from public.raw_pages as raw_page;

  if octet_length(coalesce(new.raw_html, '')) > 1000000 then
    retention_reason := 'raw_html_over_1mb';
  elsif pg_database_size(current_database()) >= 400000000 then
    retention_reason := 'database_at_warning_threshold';
  elsif payload_bytes - existing_payload_bytes + incoming_payload_bytes > 150000000 then
    retention_reason := 'raw_payload_budget';
  end if;

  if retention_reason is not null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      '_storage_retention',
      jsonb_build_object(
        'reason', retention_reason,
        'raw_html_bytes', octet_length(coalesce(new.raw_html, '')),
        'payload_bytes', incoming_payload_bytes,
        'cleared_at', clock_timestamp()
      )
    );
    new.raw_html := null;
    new.extracted_text := null;
  else
    new.metadata := coalesce(new.metadata, '{}'::jsonb) - '_storage_retention';
  end if;

  return new;
end;
$$;

drop trigger if exists bound_raw_page_payload on public.raw_pages;
create trigger bound_raw_page_payload
before insert or update of raw_html, extracted_text on public.raw_pages
for each row
execute function public.bound_raw_page_payload();

create or replace function public.maintain_crawler_storage(
  p_raw_ttl interval default interval '7 days',
  p_log_ttl interval default interval '30 days',
  p_payload_budget_bytes bigint default 150000000,
  p_delete_limit integer default 1000
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  budget_cleared_count integer := 0;
  cleared_count integer := 0;
  cleared_log_count integer := 0;
  database_bytes bigint;
  deleted_count integer := 0;
  excess_bytes bigint;
  payload_bytes bigint;
  previous_maintenance_flag text;
begin
  if p_raw_ttl is null or p_raw_ttl < interval '1 day' then
    raise exception 'p_raw_ttl must be at least one day';
  end if;

  if p_log_ttl is null or p_log_ttl < interval '1 day' then
    raise exception 'p_log_ttl must be at least one day';
  end if;

  if p_payload_budget_bytes is null or p_payload_budget_bytes < 1 then
    raise exception 'p_payload_budget_bytes must be positive';
  end if;

  if p_delete_limit is null or p_delete_limit < 1 or p_delete_limit > 10000 then
    raise exception 'p_delete_limit must be between 1 and 10000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public.raw_pages storage retention', 0)
  );
  previous_maintenance_flag := current_setting('app.maintaining_crawler_storage', true);
  perform set_config('app.maintaining_crawler_storage', 'on', true);

  with ranked as materialized (
    select
      raw_page.id,
      raw_page.fetched_at,
      row_number() over (
        partition by raw_page.source_id, raw_page.url
        order by raw_page.fetched_at desc, raw_page.id desc
      ) as retention_rank
    from public.raw_pages as raw_page
  ), cleared as (
    update public.raw_pages as raw_page
    set
      raw_html = null,
      extracted_text = null,
      metadata = coalesce(raw_page.metadata, '{}'::jsonb) || jsonb_build_object(
        '_storage_retention',
        jsonb_build_object(
          'reason', case
            when octet_length(coalesce(raw_page.raw_html, '')) > 1000000
              then 'raw_html_over_1mb'
            when ranked.fetched_at < now() - p_raw_ttl then 'expired'
            else 'superseded'
          end,
          'payload_bytes',
            octet_length(coalesce(raw_page.raw_html, ''))::bigint
              + octet_length(coalesce(raw_page.extracted_text, ''))::bigint,
          'cleared_at', clock_timestamp()
        )
      )
    from ranked
    where raw_page.id = ranked.id
      and (raw_page.raw_html is not null or raw_page.extracted_text is not null)
      and (
        ranked.retention_rank > 1
        or ranked.fetched_at < now() - p_raw_ttl
        or octet_length(coalesce(raw_page.raw_html, '')) > 1000000
      )
    returning raw_page.id
  )
  select count(*) into cleared_count from cleared;

  select coalesce(sum(
    octet_length(coalesce(raw_page.raw_html, ''))::bigint
      + octet_length(coalesce(raw_page.extracted_text, ''))::bigint
  ), 0)
  into payload_bytes
  from public.raw_pages as raw_page;

  excess_bytes := greatest(payload_bytes - p_payload_budget_bytes, 0);

  if excess_bytes > 0 then
    with payloads as materialized (
      select
        raw_page.id,
        raw_page.fetched_at,
        octet_length(coalesce(raw_page.raw_html, ''))::bigint
          + octet_length(coalesce(raw_page.extracted_text, ''))::bigint
          as payload_bytes
      from public.raw_pages as raw_page
      where raw_page.raw_html is not null or raw_page.extracted_text is not null
    ), oldest_first as (
      select
        payload.id,
        payload.payload_bytes,
        coalesce(
          sum(payload.payload_bytes) over (
            order by payload.fetched_at, payload.id
            rows between unbounded preceding and 1 preceding
          ),
          0
        ) as bytes_before
      from payloads as payload
    ), cleared as (
      update public.raw_pages as raw_page
      set
        raw_html = null,
        extracted_text = null,
        metadata = coalesce(raw_page.metadata, '{}'::jsonb) || jsonb_build_object(
          '_storage_retention',
          jsonb_build_object(
            'reason', 'raw_payload_budget',
            'payload_bytes', oldest.payload_bytes,
            'cleared_at', clock_timestamp()
          )
        )
      from oldest_first as oldest
      where raw_page.id = oldest.id
        and oldest.bytes_before < excess_bytes
      returning raw_page.id
    )
    select count(*) into budget_cleared_count from cleared;

    cleared_count := cleared_count + budget_cleared_count;
  end if;

  with candidates as (
    select raw_page.id
    from public.raw_pages as raw_page
    where raw_page.raw_html is null
      and raw_page.extracted_text is null
      and raw_page.fetched_at < now() - p_raw_ttl
      and not exists (
        select 1
        from public.events as event
        where event.raw_page_id = raw_page.id
      )
    order by raw_page.fetched_at, raw_page.id
    limit p_delete_limit
  ), deleted as (
    delete from public.raw_pages as raw_page
    using candidates
    where raw_page.id = candidates.id
    returning raw_page.id
  )
  select count(*) into deleted_count from deleted;

  update public.crawl_runs as crawl_run
  set logs = '[]'::jsonb
  where crawl_run.created_at < now() - p_log_ttl
    and crawl_run.logs <> '[]'::jsonb;
  get diagnostics cleared_log_count = row_count;

  select coalesce(sum(
    octet_length(coalesce(raw_page.raw_html, ''))::bigint
      + octet_length(coalesce(raw_page.extracted_text, ''))::bigint
  ), 0)
  into payload_bytes
  from public.raw_pages as raw_page;

  database_bytes := pg_database_size(current_database());
  perform set_config(
    'app.maintaining_crawler_storage',
    coalesce(nullif(previous_maintenance_flag, ''), 'off'),
    true
  );

  return jsonb_build_object(
    'cleared_pages', cleared_count,
    'deleted_pages', deleted_count,
    'cleared_logs', cleared_log_count,
    'raw_payload_bytes', payload_bytes,
    'database_bytes', database_bytes,
    'warning', database_bytes >= 400000000
  );
end;
$$;

create or replace function public.prune_raw_pages(
  p_older_than interval default interval '7 days',
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := public.maintain_crawler_storage(
    p_raw_ttl => p_older_than,
    p_delete_limit => p_limit
  );
  return (result ->> 'deleted_pages')::integer;
end;
$$;

revoke execute on function public.lock_crawler_storage()
  from public, anon, authenticated;
revoke execute on function public.bound_raw_page_payload()
  from public, anon, authenticated;
revoke execute on function public.maintain_crawler_storage(interval, interval, bigint, integer)
  from public, anon, authenticated;
revoke execute on function public.prune_raw_pages(interval, integer)
  from public, anon, authenticated;

grant execute on function public.maintain_crawler_storage(interval, interval, bigint, integer)
  to service_role;
grant execute on function public.prune_raw_pages(interval, integer) to service_role;

commit;
