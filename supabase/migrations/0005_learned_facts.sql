-- Learned facts: durable things the text-chat agent picks up in conversation
-- and folds into recommendations. Structured as a list of {predicate, object,
-- source, confidence, updated_at} objects (see packages/shared/src/facts.ts).

alter table public.profiles
  add column if not exists learned_facts jsonb not null default '[]'::jsonb;
