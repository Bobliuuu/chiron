-- Chiron initial schema
-- Postgres / Supabase. Assumes Supabase Auth owns credentials (auth.users);
-- public.users is the app profile keyed to the same id.

create extension if not exists postgis;   -- geo radius lookups ("how far can you travel?")
create extension if not exists vector;    -- pgvector, event embeddings for AI matching

-- Enums ----------------------------------------------------------------

create type user_role as enum ('community_member', 'host_staff', 'admin');

-- Set during onboarding; drives quick vs elaborate UI format.
create type ui_mode as enum ('quick', 'elaborate');

create type event_status as enum ('draft', 'published', 'cancelled', 'archived');

create type delivery_channel as enum ('web', 'email', 'whatsapp');

-- Users -----------------------------------------------------------------

create table users (
  id             uuid primary key references auth.users (id) on delete cascade,
  role           user_role   not null default 'community_member',
  display_name   text,
  email          text,
  phone          text,                         -- E.164, doubles as WhatsApp number

  -- Onboarding / accessibility profile
  ui_mode        ui_mode     not null default 'elaborate',
  onboarded_at   timestamptz,                  -- null = onboarding not finished
  accessibility_needs text[] not null default '{}',  -- e.g. {wheelchair, quiet_space, plain_language, asl}
  interests      text[]      not null default '{}',  -- free-form tags from conversation

  -- Location + travel radius, for proximity matching
  city           text,
  postal_code    text,
  location       geography(point, 4326),
  max_travel_km  numeric(5,1),

  -- Boardy-like recommendation layer
  channels       delivery_channel[] not null default '{web}',
  digest_opt_in  boolean     not null default false,
  profile_note   text,                         -- raw "who I am / what I want" blurb from intake

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index users_location_idx on users using gist (location);
create index users_interests_idx on users using gin (interests);

-- Event hosts (nonprofit organizations) ----------------------------------

create table event_hosts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  description   text,
  website_url   text,
  logo_url      text,
  contact_email text,
  contact_phone text,
  city          text,
  address       text,
  verified      boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Staff membership: which users can publish for which org.
create table host_members (
  host_id    uuid not null references event_hosts (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  is_owner   boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (host_id, user_id)
);

create index host_members_user_idx on host_members (user_id);

-- Events ------------------------------------------------------------------

create table events (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references event_hosts (id) on delete cascade,
  created_by    uuid references users (id) on delete set null,

  status        event_status not null default 'draft',
  title         text not null,
  summary_plain text,                          -- plain-language summary shown to users
  description   text,
  category      text,                          -- single coarse bucket, e.g. 'sports', 'arts'
  tags          text[] not null default '{}',

  -- When
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  recurrence_rule text,                        -- RFC 5545 RRULE for recurring events
  timezone      text not null default 'America/Toronto',

  -- Where
  is_online     boolean not null default false,
  online_url    text,
  venue_name    text,
  address       text,
  city          text,
  location      geography(point, 4326),

  -- Cost
  is_free       boolean not null default true,
  cost_cents    integer,                       -- null when free or unknown
  cost_note     text,                          -- "pay what you can", "$5 suggested"

  -- Audience
  age_min       integer,
  age_max       integer,
  audience_tags text[] not null default '{}',  -- e.g. {teens, families, seniors, newcomers}

  -- Accessibility + logistics
  accessibility_features text[] not null default '{}', -- matches users.accessibility_needs vocab
  transportation_note    text,

  -- Registration stays on the nonprofit's own system
  registration_required boolean not null default false,
  registration_url      text,
  registration_note     text,

  -- Provenance (flyer upload, manual entry, import)
  source        text,
  source_url    text,

  -- AI matching
  embedding     vector(1536),                  -- embedding of title + summary + tags

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint events_time_order check (ends_at is null or ends_at >= starts_at),
  constraint events_online_url check (not is_online or online_url is not null)
);

-- Lookup paths the agent tools will hit:
create index events_upcoming_idx on events (status, starts_at);   -- "published, soonest first"
create index events_host_idx     on events (host_id);
create index events_city_idx     on events (city);
create index events_location_idx on events using gist (location); -- radius search
create index events_tags_idx     on events using gin (tags);
create index events_audience_idx on events using gin (audience_tags);
create index events_access_idx   on events using gin (accessibility_features);
create index events_free_idx     on events (is_free) where is_free;
create index events_embedding_idx on events
  using hnsw (embedding vector_cosine_ops);

-- Engagement signals for nonprofits (views, saves, recommendation clicks) --

create table event_saves (
  user_id    uuid not null references users (id) on delete cascade,
  event_id   uuid not null references events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index event_saves_event_idx on event_saves (event_id);

-- updated_at trigger -------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_updated_at       before update on users       for each row execute function set_updated_at();
create trigger event_hosts_updated_at before update on event_hosts for each row execute function set_updated_at();
create trigger events_updated_at     before update on events      for each row execute function set_updated_at();
