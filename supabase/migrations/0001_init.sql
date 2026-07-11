-- Chiron: events schema
-- Run with the Supabase SQL editor, or `supabase db push` after `supabase link`.

create extension if not exists "pgcrypto";

-- Cause / category the event serves. Keep in sync with EventCategory in
-- src/lib/types/events.ts.
do $$ begin
  create type event_category as enum (
    'food_bank',
    'fundraiser',
    'health',
    'education',
    'youth',
    'seniors',
    'community',
    'arts',
    'employment',
    'housing',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.events (
  id                        uuid primary key default gen_random_uuid(),

  -- Core listing
  title                     text        not null,
  summary                   text        not null,          -- plain-language one-liner
  description               text,

  category                  event_category not null default 'other',

  -- When
  start_time                timestamptz not null,
  end_time                  timestamptz,

  -- Where
  is_online                 boolean     not null default false,
  online_url                text,
  location_name             text,
  address                   text,
  city                      text,

  -- Cost
  is_free                   boolean     not null default true,
  cost_note                 text,                           -- e.g. "$10 suggested donation"

  -- Who it's for / accessibility
  audience                  text,                           -- e.g. "families", "seniors 55+"
  accessibility             text[]      not null default '{}',  -- e.g. {wheelchair, asl}
  transportation            text,

  -- How to register
  registration_url          text,
  registration_instructions text,

  -- Who is hosting
  host_organization         text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Helpful indexes for the common discovery queries.
create index if not exists events_start_time_idx on public.events (start_time);
create index if not exists events_city_idx        on public.events (lower(city));
create index if not exists events_category_idx    on public.events (category);

-- Full-text search across the human-facing fields.
create index if not exists events_search_idx on public.events using gin (
  to_tsvector(
    'english',
    coalesce(title, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(host_organization, '')
  )
);

-- Keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- Row Level Security. For the prototype we allow public read of published
-- events and public insert (nonprofit self-serve). Tighten before production.
alter table public.events enable row level security;

drop policy if exists "events read" on public.events;
create policy "events read" on public.events
  for select using (true);

drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events
  for insert with check (true);
