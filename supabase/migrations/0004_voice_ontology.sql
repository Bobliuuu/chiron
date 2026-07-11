-- Voice ontology: learned preferences from outbound check-in calls.

alter table public.profiles
  add column if not exists contact_phone text,
  add column if not exists voice_ontology jsonb not null default '{"calls":[],"event_goals":[],"motivations":[]}'::jsonb;

update public.profiles
set contact_phone = '+14165550101'
where full_name = 'Maria Chen' and contact_phone is null;
