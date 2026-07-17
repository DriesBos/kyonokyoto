begin;

alter table public.events drop constraint if exists events_schedule_type_check;

alter table public.events
  add constraint events_schedule_type_check
  check (schedule_type in ('single', 'range', 'occurrence_set', 'open_ended', 'unknown'));

commit;
