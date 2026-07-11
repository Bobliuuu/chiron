-- Chiron database schema — THE single source of truth.
--
-- How to apply: paste the whole file into the Supabase SQL editor and run it.
-- Maintain THIS file when the schema changes, then re-run it.
--
-- ⚠ DESTRUCTIVE: running this drops and recreates every Chiron table, so all
-- event/profile/registration data is wiped. Fine while prototyping (re-seed
-- with seed.sql or the pipelines). Before production, freeze this file and
-- switch to incremental migrations.

-- --- Reset ---------------------------------------------------------------------

drop table if exists public.event_registrations;
drop table if exists public.event_registration_forms;
drop table if exists public.events;
drop table if exists public.profiles;
drop type if exists event_category;
drop type if exists ui_mode;

create extension if not exists "pgcrypto";

-- --- Types ----------------------------------------------------------------------

-- Cause / category the event serves. Keep in sync with EventCategory in
-- packages/shared/src/events.ts.
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

-- Presentation format, derived from the onboarding quiz. Keep in sync with
-- UiMode in packages/shared/src/profile.ts.
create type ui_mode as enum ('quick', 'elaborate');

-- --- updated_at helper -----------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- --- Events -----------------------------------------------------------------------

create table public.events (
  id                        uuid primary key default gen_random_uuid(),

  -- Core listing
  title                     text        not null,
  summary                   text        not null,          -- plain-language one-liner
  description               text,

  category                  event_category not null default 'other',

  -- Tags (the primary discovery mechanism):
  -- `tags` is the user-facing static vocabulary (see TAG_FACETS in
  -- packages/shared/src/tags.ts), applied by the tagging pipeline per its rubric.
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

  -- Who is hosting / who published
  host_organization         text,
  created_by                uuid,       -- auth.users id; null = channel-service/legacy
  image_url                 text,       -- public URL in the event-images bucket

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index events_start_time_idx    on public.events (start_time);
create index events_city_idx          on public.events (lower(city));
create index events_category_idx      on public.events (category);
create index events_tags_idx          on public.events using gin (tags);
create index events_internal_tags_idx on public.events using gin (internal_tags);
create index events_created_by_idx    on public.events (created_by);

-- Full-text search across the human-facing fields.
create index events_search_idx on public.events using gin (
  to_tsvector(
    'english',
    coalesce(title, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(host_organization, '')
  )
);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- --- Profiles ------------------------------------------------------------------

-- One row per community member, created by the onboarding quiz.
-- id = the Supabase auth.users id.
create table public.profiles (
  id                  uuid primary key,

  -- 'quick' = short sentences, fewer choices, icons — derived from the quiz,
  -- user can change it any time (Preferences tab).
  ui_mode             ui_mode not null default 'elaborate',

  -- Both columns use the same static vocabulary as events.tags, so matching
  -- is a plain array-overlap (&&) against events.
  accessibility_needs text[] not null default '{}',
  preferred_tags      text[] not null default '{}',

  city                text,
  free_only           boolean not null default false,

  -- Raw quiz answers ({question_id: boolean}) so preferences can be
  -- re-derived if the mapping changes, and edited in the Preferences tab.
  quiz_answers        jsonb   not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- --- Per-event registration form schema --------------------------------------------

create table public.event_registration_forms (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null unique references public.events (id) on delete cascade,
  schema     jsonb not null default '{"fields": []}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger event_registration_forms_set_updated_at
  before update on public.event_registration_forms
  for each row execute function public.set_updated_at();

-- --- Registrations ---------------------------------------------------------------

create table public.event_registrations (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events (id) on delete cascade,
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  registration_form_id   uuid references public.event_registration_forms (id) on delete set null,
  status                 text not null default 'interested'
                         check (status in ('interested', 'registered')),
  attendee_name          text,
  contact_email          text,
  contact_phone          text,
  accessibility_requests text,
  notes                  text,
  form_response          jsonb not null default '{}'::jsonb,
  event_snapshot         jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (event_id, profile_id)  -- one registration per user per event (upsert target)
);

create index event_registrations_profile_idx on public.event_registrations (profile_id);
create index event_registrations_event_idx   on public.event_registrations (event_id);

create trigger event_registrations_set_updated_at
  before update on public.event_registrations
  for each row execute function public.set_updated_at();

-- --- Storage: event card images -----------------------------------------------------

insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

drop policy if exists "event images service write" on storage.objects;
create policy "event images service write" on storage.objects
  for insert to service_role
  with check (bucket_id = 'event-images');

-- --- Row Level Security ---------------------------------------------------------------
-- The backend talks to Postgres with the service role (bypasses RLS). Anon
-- policies exist only where public reads are safe. Registrations and profiles
-- carry PII: no anon policies at all.

alter table public.events enable row level security;

create policy "events read" on public.events
  for select using (true);

alter table public.profiles enable row level security;
alter table public.event_registration_forms enable row level security;
alter table public.event_registrations enable row level security;
