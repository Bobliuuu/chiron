-- Event images: a public storage bucket + a URL column on events.
-- Run after 0001_init.sql (which is already applied to the live project —
-- from here on, schema changes are new migration files, never edits to 0001).

alter table public.events
  add column if not exists image_url text;

-- Public bucket for event card images. Uploads go through the backend
-- (service role); reads are public URLs.
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

-- Only the service role may write; anyone may read (the bucket is public).
drop policy if exists "event images service write" on storage.objects;
create policy "event images service write" on storage.objects
  for insert to service_role
  with check (bucket_id = 'event-images');
