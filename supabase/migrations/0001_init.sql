-- Chiron: initial schema (events + profiles)
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

-- Presentation format, derived from the onboarding quiz. Keep in sync with
-- UiMode in src/lib/types/profile.ts.
do $$ begin
  create type ui_mode as enum ('quick', 'elaborate');
exception
  when duplicate_object then null;
end $$;

-- --- Events -----------------------------------------------------------------

create table if not exists public.events (
  id                        uuid primary key default gen_random_uuid(),

  -- Core listing
  title                     text        not null,
  summary                   text        not null,          -- plain-language one-liner
  description               text,

  category                  event_category not null default 'other',

  -- Tags (the primary discovery mechanism):
  -- `tags` is the user-facing static vocabulary (see TAG_FACETS in
  -- src/lib/tags.ts), applied by the tagging pipeline per its rubric.
  -- `internal_tags` are agent-generated free-form ranking hints; backend-only,
  -- never returned to the client (stripped via toPublicEvent).
  tags                      text[]      not null default '{}',
  internal_tags             text[]      not null default '{}',

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
create index if not exists events_tags_idx        on public.events using gin (tags);
create index if not exists events_internal_tags_idx on public.events using gin (internal_tags);

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

-- --- Profiles ---------------------------------------------------------------
-- One row per community member, created by the onboarding quiz. The prototype
-- has no auth: the id is a client-generated UUID kept in localStorage. When
-- Supabase Auth lands, add a user_id column referencing auth.users.

create table if not exists public.profiles (
  id                  uuid primary key,

  -- 'quick' = short sentences, fewer choices, icons — derived from the quiz,
  -- user can change it any time.
  ui_mode             ui_mode not null default 'elaborate',

  -- Both columns use the same static vocabulary as events.tags, so matching
  -- is a plain array-overlap (&&) against events.
  accessibility_needs text[] not null default '{}',
  preferred_tags      text[] not null default '{}',

  city                text,
  free_only           boolean not null default false,

  -- Raw quiz answers ({question_id: boolean}) so preferences can be
  -- re-derived if the mapping changes.
  quiz_answers        jsonb   not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- --- updated_at trigger -------------------------------------------------------

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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- --- Row Level Security -------------------------------------------------------
-- For the prototype we allow public read/insert (nonprofit self-serve, no
-- auth). Tighten before production.

alter table public.events enable row level security;

drop policy if exists "events read" on public.events;
create policy "events read" on public.events
  for select using (true);

drop policy if exists "events insert" on public.events;
create policy "events insert" on public.events
  for insert with check (true);

alter table public.profiles enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using (true);

drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert" on public.profiles
  for insert with check (true);

drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles
  for update using (true);
