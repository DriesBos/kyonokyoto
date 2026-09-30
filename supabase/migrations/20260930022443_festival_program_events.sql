begin;

alter table public.events
  add column event_kind text not null default 'event',
  add column festival_id uuid references public.events(id) on delete restrict,
  add column festival_slug text;

alter table public.events
  alter column institution_name drop not null,
  alter column date_text drop not null,
  alter column source_url drop not null;

alter table public.events
  add constraint events_event_kind_check
    check (event_kind in ('event', 'festival', 'festival_program')),
  add constraint events_festival_shape_check check (
    (event_kind = 'event' and festival_id is null and festival_slug is null)
    or (event_kind = 'festival' and festival_id is null and festival_slug is not null)
    or (event_kind = 'festival_program' and festival_id is not null and festival_slug is null)
  ),
  add constraint events_festival_slug_format_check check (
    festival_slug is null or festival_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  add constraint events_required_details_check check (
    event_kind = 'festival_program'
    or (institution_name is not null and date_text is not null and source_url is not null)
  );

alter table public.events drop constraint events_date_presence_check;
alter table public.events
  add constraint events_date_presence_check check (
    status <> 'published'
    or event_kind = 'festival_program'
    or start_date is not null
    or calendar_starts_at is not null
    or jsonb_array_length(occurrence_dates) > 0
  );

create index events_festival_id_idx on public.events (festival_id)
  where festival_id is not null;
create unique index events_festival_city_slug_idx
  on public.events (city, festival_slug)
  where event_kind = 'festival';

create function public.check_festival_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.event_kind = 'festival_program' and not exists (
    select 1 from public.events as parent
    where parent.id = new.festival_id
      and parent.event_kind = 'festival'
      and parent.city = new.city
  ) then
    raise exception 'Festival program requires a festival edition in the same city';
  end if;

  if tg_op = 'UPDATE' then
    if old.event_kind = 'festival' and
      (new.event_kind <> 'festival' or new.city <> old.city) and exists (
        select 1 from public.events as child where child.festival_id = old.id
      ) then
      raise exception 'Cannot change a festival edition with linked program items';
    end if;
  end if;

  return new;
end;
$$;

create trigger check_events_festival_parent
before insert or update of event_kind, festival_id, city on public.events
for each row execute function public.check_festival_parent();

commit;
