-- Chiron: self-hosted password auth (replaces Supabase Auth).
-- Users authenticate against app_users with a salted scrypt hash; a bearer
-- token in auth_sessions identifies the caller on every request. The server
-- uses the service-role key, so these tables are reached with RLS bypassed.
--
-- profiles.id continues to be the user id: on signup the app_users.id (a uuid)
-- becomes the profile id created by the onboarding quiz.

create extension if not exists "pgcrypto";

create table if not exists public.app_users (
  id             uuid primary key default gen_random_uuid(),
  email          text        not null unique,
  -- Format: "<salt-hex>:<scrypt-hash-hex>". No plaintext is ever stored.
  password_hash  text        not null,
  created_at     timestamptz not null default now()
);

-- Match emails case-insensitively (login normalizes to lower-case).
create unique index if not exists app_users_email_lower_idx
  on public.app_users (lower(email));

create table if not exists public.auth_sessions (
  token       text        primary key,
  user_id     uuid        not null references public.app_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists auth_sessions_user_idx
  on public.auth_sessions (user_id);

-- Server-only tables: lock them down and rely on the service-role key.
alter table public.app_users enable row level security;
alter table public.auth_sessions enable row level security;
