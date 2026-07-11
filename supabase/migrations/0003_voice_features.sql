-- Voice agent: caller identity + event organizer contact for outbound calls.

alter table public.profiles
  add column if not exists full_name text;

create index if not exists profiles_full_name_idx
  on public.profiles (lower(full_name));

alter table public.events
  add column if not exists organizer_name text,
  add column if not exists organizer_phone text;
