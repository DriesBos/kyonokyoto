-- Disposable empty database only. Run after schema.sql and the temple event migration.
-- Fixtures and assertions roll back as one transaction.
begin;

insert into public.sources (id, slug, city, name, source_type, base_url, source_kind, beta, source_priority)
values
  ('91000000-0000-0000-0000-000000000001', 'temple-test-trusted', 'kyoto', 'Trusted temple feed', 'museum', 'https://trusted.example', 'aggregator', true, 10),
  ('91000000-0000-0000-0000-000000000002', 'temple-test-secondary', 'kyoto', 'Secondary temple feed', 'museum', 'https://secondary.example', 'aggregator', true, 50),
  ('91000000-0000-0000-0000-000000000003', 'temple-test-review', 'kyoto', 'Review temple feed', 'museum', 'https://review.example', 'aggregator', true, 30),
  ('91000000-0000-0000-0000-000000000004', 'temple-test-null', 'kyoto', 'Unmatched temple feed', 'museum', 'https://null.example', 'aggregator', true, 20),
  ('91000000-0000-0000-0000-000000000005', 'temple-test-other-beta', 'kyoto', 'Other beta cohort', 'museum', 'https://other-beta.example', 'aggregator', false, 1),
  ('91000000-0000-0000-0000-000000000006', 'temple-test-invalid', 'kyoto', 'Invalid fixture feed', 'museum', 'https://invalid.example', 'aggregator', true, 5);

create temporary table temple_test_state (key text primary key, value uuid not null) on commit drop;

-- The vanilla PostgreSQL test image lacks Supabase's default service-role grants.
-- Recreate only the grants this SECURITY INVOKER function needs.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.sources, public.events, public.event_schedule_segments to service_role;
grant select, insert, update, delete on public.event_translations to service_role;
grant all on temple_test_state to service_role;
alter role service_role bypassrls;
set local role service_role;

do $$
declare
  result jsonb;
  canonical_event_id uuid;
  canonical_revision timestamptz;
  observation_count integer;
  trusted_title text;
begin
  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000001', null, 'trusted-event-2026',
    'match:daikakuji:autumn:2026:oct-1-31', 'review:daikakuji:autumn:2026',
    '{"title":"Trusted autumn viewing","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月1日〜10月31日","start_date":"2026-10-01","end_date":"2026-10-31","schedule_type":"range","source_url":"https://trusted.example/event/1"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-10-01","end_date":"2026-10-31","timezone":"Asia/Tokyo"}]'::jsonb
  );
  canonical_event_id := (result #>> '{event,id}')::uuid;
  canonical_revision := (result #>> '{event,updated_at}')::timestamptz;
  insert into temple_test_state values ('canonical', canonical_event_id);

  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000002', null, 'secondary-event-26',
    'match:daikakuji:autumn:2026:oct-1-31', 'review:daikakuji:autumn:2026',
    '{"title":"Lower priority title","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月1日〜10月31日","start_date":"2026-10-01","end_date":"2026-10-31","schedule_type":"range","source_url":"https://secondary.example/event/1"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-10-01","end_date":"2026-10-31","timezone":"Asia/Tokyo"}]'::jsonb
  );
  if (result #>> '{event,id}')::uuid <> canonical_event_id then
    raise exception 'exact identity from second source did not reuse canonical event';
  end if;
  if coalesce((result ->> 'canonical_updated')::boolean, true) then
    raise exception 'lower-priority source updated canonical event facts';
  end if;
  if (result #>> '{event,updated_at}')::timestamptz is distinct from canonical_revision then
    raise exception 'lower-priority observation changed canonical revision';
  end if;
  select count(*) into observation_count from public.event_sources as observation where observation.event_id = canonical_event_id;
  if observation_count <> 2 then raise exception 'expected two source observations, got %', observation_count; end if;
  select title into trusted_title from public.events where id = canonical_event_id;
  if trusted_title <> 'Trusted autumn viewing' then raise exception 'lower priority facts replaced preferred title'; end if;
  if not exists (
    select 1 from public.event_schedule_segments
    where event_id = canonical_event_id and ordinal = 0
      and start_date = '2026-10-01'::date and end_date = '2026-10-31'::date
  ) or (select count(*) from public.event_schedule_segments where event_id = canonical_event_id) <> 1 then
    raise exception 'canonical schedule segment differs after lower-priority observation';
  end if;

  update public.events set status = 'hidden' where id = canonical_event_id;
  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000001', null, 'trusted-event-2026',
    'match:corrected-identity', 'review:daikakuji:autumn:2026',
    '{"title":"Trusted corrected dates","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月2日〜11月1日","start_date":"2026-10-02","end_date":"2026-11-01","schedule_type":"range","source_url":"https://trusted.example/event/1"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-10-02","end_date":"2026-11-01","timezone":"Asia/Tokyo"}]'::jsonb
  );
  if (result #>> '{event,id}')::uuid <> canonical_event_id then raise exception 'known source-key correction changed event ID'; end if;
  if not coalesce((result ->> 'canonical_updated')::boolean, false) then raise exception 'preferred-source correction did not update canonical event'; end if;
  if (select count(*) from public.event_sources where source_id = '91000000-0000-0000-0000-000000000001' and source_event_key = 'trusted-event-2026') <> 1 then
    raise exception 'known source-key correction created duplicate observation';
  end if;
  if (select status from public.events where id = canonical_event_id) <> 'hidden' then raise exception 'ingestion changed hidden editorial status'; end if;
  if not exists (
    select 1 from public.event_schedule_segments
    where event_id = canonical_event_id and ordinal = 0
      and start_date = '2026-10-02'::date and end_date = '2026-11-01'::date
  ) or (select count(*) from public.event_schedule_segments where event_id = canonical_event_id) <> 1 then
    raise exception 'source-key correction failed to replace canonical schedule segment';
  end if;
  update temple_test_state set value = canonical_event_id where key = 'canonical';
end;
$$;

do $$
declare
  result jsonb;
  canonical_id uuid;
  review_event uuid;
begin
  select value into canonical_id from temple_test_state where key = 'canonical';
  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000003', null, 'review-event',
    'match:daikakuji:other-artwork:2026', 'review:daikakuji:autumn:2026',
    '{"title":"Separate artwork exhibition","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月5日〜10月12日","start_date":"2026-10-05","end_date":"2026-10-12","schedule_type":"range","source_url":"https://review.example/event/2"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-10-05","end_date":"2026-10-12","timezone":"Asia/Tokyo"}]'::jsonb
  );
  review_event := (result #>> '{event,id}')::uuid;
  if review_event = canonical_id then raise exception 'different match identity merged automatically'; end if;
  if not exists (
    select 1 from public.event_duplicate_candidates
    where event_id = least(canonical_id, review_event) and other_event_id = greatest(canonical_id, review_event) and status = 'pending'
  ) then raise exception 'same review key did not create pending review candidate'; end if;

  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000004', null, 'null-match-event',
    null, 'review:daikakuji:autumn:2026',
    '{"title":"Unmatched independent event","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月1日〜10月31日","start_date":"2026-10-01","end_date":"2026-10-31","schedule_type":"range","source_url":"https://null.example/event/3"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-10-01","end_date":"2026-10-31","timezone":"Asia/Tokyo"}]'::jsonb
  );
  if (result #>> '{event,id}')::uuid = canonical_id then raise exception 'null match key merged events'; end if;

  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000005', null, 'other-beta-event',
    'match:daikakuji:autumn:2026:oct-1-31', 'review:daikakuji:autumn:2026',
    '{"title":"Other beta cohort event","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月1日〜10月31日","start_date":"2026-10-01","end_date":"2026-10-31","schedule_type":"range","source_url":"https://other-beta.example/event/4"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-10-01","end_date":"2026-10-31","timezone":"Asia/Tokyo"}]'::jsonb
  );
  if (result #>> '{event,id}')::uuid = canonical_id then raise exception 'different beta cohort merged events'; end if;
end;
$$;

do $$
declare
  failed boolean := false;
  canonical_id uuid;
begin
  select value into canonical_id from temple_test_state where key = 'canonical';
  begin
    perform public.ingest_temple_event(
      '91000000-0000-0000-0000-000000000006', null, 'invalid-event',
      'match:invalid', 'review:invalid',
      '{"title":"Invalid no venue","categories":["collection:temples-gardens"],"institution_name":"","venue_name":"","address_text":"","date_text":"2026年10月1日","start_date":"2026-10-01","end_date":"2026-10-01","source_url":"https://invalid.example/event"}'::jsonb,
      '[{"is_all_day":true,"start_date":"2026-10-01","end_date":"2026-10-01","timezone":"Asia/Tokyo"}]'::jsonb
    );
  exception when others then failed := true;
  end;
  if not failed then raise exception 'invalid input unexpectedly succeeded'; end if;
  if exists (select 1 from public.event_sources where source_id = '91000000-0000-0000-0000-000000000006' and source_event_key = 'invalid-event') then
    raise exception 'invalid input left an observation behind';
  end if;
  if (select count(*) from public.events where source_id = '91000000-0000-0000-0000-000000000006') <> 0 then
    raise exception 'invalid input left an event behind';
  end if;

  failed := false;
  begin
    perform public.ingest_temple_event(
      '91000000-0000-0000-0000-000000000006', null, 'invalid-segments-event',
      'match:invalid-segments', 'review:invalid-segments',
      '{"title":"Invalid segment fixture","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年10月1日","start_date":"2026-10-01","end_date":"2026-10-01","source_url":"https://invalid.example/segments"}'::jsonb,
      '[{"is_all_day":true,"start_date":"not-a-date","end_date":"2026-10-01","timezone":"Asia/Tokyo"}]'::jsonb
    );
  exception when others then failed := true;
  end;
  if not failed then raise exception 'invalid schedule segments unexpectedly succeeded'; end if;
  if exists (select 1 from public.event_sources where source_id = '91000000-0000-0000-0000-000000000006' and source_event_key = 'invalid-segments-event') then
    raise exception 'invalid segments left an observation behind';
  end if;
  if (select count(*) from public.events where source_id = '91000000-0000-0000-0000-000000000006') <> 0 then
    raise exception 'invalid segments left an event behind';
  end if;
  if exists (select 1 from public.event_schedule_segments where event_id in (select id from public.events where source_id = '91000000-0000-0000-0000-000000000006')) then
    raise exception 'invalid segments left schedule rows behind';
  end if;

  perform public.finish_temple_source_scan('91000000-0000-0000-0000-000000000002', '{}'::text[]);
  if (select is_active from public.event_sources where source_id = '91000000-0000-0000-0000-000000000002' and source_event_key = 'secondary-event-26') then
    raise exception 'finish scan failed to deactivate missing source evidence';
  end if;
  if not (select is_active from public.event_sources where source_id = '91000000-0000-0000-0000-000000000001' and source_event_key = 'trusted-event-2026') then
    raise exception 'finish scan deactivated another publisher evidence';
  end if;
  if (select status from public.events where id = canonical_id) = 'archived' then
    raise exception 'finish scan archived canonical event';
  end if;
end;
$$;

-- Exercise the revision-gated finalizer on separate fixtures after ingestion assertions.
do $$
declare
  result jsonb;
  finalizer_event_id uuid;
  revision timestamptz;
  current_revision timestamptz;
  translations jsonb := jsonb_build_array(
    jsonb_build_object('locale', 'ja', 'title', 'Native temple event', 'description', 'Japanese detail', 'source_content_hash', repeat('a', 64)),
    jsonb_build_object('locale', 'en', 'title', 'Translated temple event', 'description', 'English detail', 'source_content_hash', repeat('b', 64))
  );
begin
  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000003', null, 'finalizer-event', null, null,
    '{"title":"Native temple event","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年11月1日〜11月5日","start_date":"2026-11-01","end_date":"2026-11-05","schedule_type":"range","source_url":"https://review.example/finalizer-event"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-11-01","end_date":"2026-11-05","timezone":"Asia/Tokyo"}]'::jsonb
  );
  finalizer_event_id := (result #>> '{event,id}')::uuid;
  revision := (result #>> '{event,updated_at}')::timestamptz;
  if (result #>> '{event,status}') <> 'draft' then raise exception 'new finalizer fixture did not start as draft'; end if;
  if not public.finalize_temple_event(finalizer_event_id, '91000000-0000-0000-0000-000000000003', revision, translations) then
    raise exception 'finalizer rejected current primary source revision';
  end if;
  if (select status from public.events where id = finalizer_event_id) <> 'published' then raise exception 'valid finalizer did not publish event'; end if;
  if (select count(*) from public.event_translations where event_id = finalizer_event_id) <> 2 then raise exception 'valid finalizer did not write both translations'; end if;
  if not exists (select 1 from public.event_translations where event_id = finalizer_event_id and locale = 'ja' and title = 'Native temple event' and source_content_hash = repeat('a', 64))
     or not exists (select 1 from public.event_translations where event_id = finalizer_event_id and locale = 'en' and title = 'Translated temple event' and source_content_hash = repeat('b', 64)) then
    raise exception 'finalizer translation contents differ from supplied native/translated rows';
  end if;

  if public.finalize_temple_event(
    finalizer_event_id, '91000000-0000-0000-0000-000000000003', revision - interval '1 second',
    jsonb_build_array(jsonb_build_object('locale', 'en', 'title', 'Stale overwrite', 'description', 'stale', 'source_content_hash', repeat('c', 64)))
  ) then raise exception 'finalizer accepted stale event revision'; end if;
  select updated_at into current_revision from public.events where id = finalizer_event_id;
  if public.finalize_temple_event(
    finalizer_event_id, '91000000-0000-0000-0000-000000000002', current_revision,
    jsonb_build_array(jsonb_build_object('locale', 'en', 'title', 'Wrong source overwrite', 'description', 'stale', 'source_content_hash', repeat('d', 64)))
  ) then raise exception 'finalizer accepted non-primary source'; end if;
  if (select count(*) from public.event_translations where event_id = finalizer_event_id) <> 2
     or exists (select 1 from public.event_translations where event_id = finalizer_event_id and title in ('Stale overwrite', 'Wrong source overwrite')) then
    raise exception 'rejected finalization overwrote canonical translations';
  end if;

  result := public.ingest_temple_event(
    '91000000-0000-0000-0000-000000000003', null, 'finalizer-stale-draft', null, null,
    '{"title":"Stale finalizer draft","categories":["collection:temples-gardens"],"institution_name":"大覚寺","venue_name":"大覚寺","address_text":"京都府京都市右京区嵯峨大沢町","date_text":"2026年11月10日","start_date":"2026-11-10","end_date":"2026-11-10","schedule_type":"single","source_url":"https://review.example/finalizer-draft"}'::jsonb,
    '[{"is_all_day":true,"start_date":"2026-11-10","end_date":"2026-11-10","timezone":"Asia/Tokyo"}]'::jsonb
  );
  finalizer_event_id := (result #>> '{event,id}')::uuid;
  revision := (result #>> '{event,updated_at}')::timestamptz;
  if public.finalize_temple_event(finalizer_event_id, '91000000-0000-0000-0000-000000000003', revision - interval '1 second', translations) then
    raise exception 'finalizer accepted stale revision for draft event';
  end if;
  if public.finalize_temple_event(finalizer_event_id, '91000000-0000-0000-0000-000000000002', revision, translations) then
    raise exception 'finalizer accepted wrong source for draft event';
  end if;
  if (select status from public.events where id = finalizer_event_id) <> 'draft'
     or exists (select 1 from public.event_translations where event_id = finalizer_event_id) then
    raise exception 'rejected source finalized draft event or wrote translations';
  end if;

  select updated_at into current_revision from public.events where id = (select value from temple_test_state where key = 'canonical');
  if public.finalize_temple_event(
    (select value from temple_test_state where key = 'canonical'),
    '91000000-0000-0000-0000-000000000001', current_revision, translations
  ) then raise exception 'finalizer accepted hidden event'; end if;
  if (select status from public.events where id = (select value from temple_test_state where key = 'canonical')) <> 'hidden' then
    raise exception 'finalizer changed hidden event status';
  end if;
end;
$$;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.event_sources'::regclass) then
    raise exception 'event_sources RLS is not enabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.event_duplicate_candidates'::regclass) then
    raise exception 'event_duplicate_candidates RLS is not enabled';
  end if;
  if has_table_privilege('anon', 'public.event_sources', 'SELECT')
     or has_table_privilege('authenticated', 'public.event_sources', 'SELECT')
     or has_table_privilege('anon', 'public.event_duplicate_candidates', 'SELECT')
     or has_table_privilege('authenticated', 'public.event_duplicate_candidates', 'SELECT') then
    raise exception 'anonymous/authenticated roles can read internal event source tables';
  end if;
  if has_function_privilege('anon', 'public.ingest_temple_event(uuid,uuid,text,text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ingest_temple_event(uuid,uuid,text,text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finish_temple_source_scan(uuid,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finish_temple_source_scan(uuid,text[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_temple_event(uuid,uuid,timestamptz,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_temple_event(uuid,uuid,timestamptz,jsonb)', 'EXECUTE') then
    raise exception 'anonymous/authenticated role can execute crawler-only functions';
  end if;
  if not has_function_privilege('service_role', 'public.ingest_temple_event(uuid,uuid,text,text,text,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finish_temple_source_scan(uuid,text[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finalize_temple_event(uuid,uuid,timestamptz,jsonb)', 'EXECUTE') then
    raise exception 'service_role cannot execute temple ingestion functions';
  end if;
end;
$$;

rollback;
