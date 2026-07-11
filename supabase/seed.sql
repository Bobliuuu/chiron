-- Optional seed data for a fresh Supabase instance.
-- Mirrors the in-memory seeds used in mock mode (src/lib/supabase/mock-store.ts).

insert into public.events
  (title, summary, description, category, start_time, end_time,
   is_online, location_name, address, city, is_free, cost_note,
   audience, accessibility, transportation, registration_url,
   registration_instructions, host_organization, tags, internal_tags)
values
  ('Markham Community Food Bank — Evening Distribution',
   'Free groceries and fresh produce, no appointment needed.',
   'Weekly evening food bank distribution. Bring a bag; volunteers help carry.',
   'food_bank', now() + interval '3 days' + interval '17 hours',
   now() + interval '3 days' + interval '20 hours',
   false, 'Markham Community Centre', '3201 Bur Oak Ave', 'Markham',
   true, null, 'families, individuals', '{wheelchair}', 'On the 5 bus route',
   null, 'Walk in during distribution hours.', 'Markham Food Network',
   '{food,free,in_person,drop_in,recurring,families,adults,wheelchair}',
   '{evening_only,bring_your_own_bag,volunteers_assist}'),

  ('Feed the Neighbourhood Charity Fundraiser',
   'An evening gala to raise funds for local food security programs.',
   'Dinner, silent auction, and live music supporting food banks across York Region.',
   'fundraiser', now() + interval '10 days' + interval '18 hours',
   now() + interval '10 days' + interval '22 hours',
   false, 'The Cherry Street Hall', '15 Cherry St', 'Toronto',
   false, '$75 per ticket', 'adults', '{wheelchair,asl}', 'Streetcar 504 to Cherry St',
   'https://example.org/feed-the-neighbourhood',
   'Purchase tickets online in advance.', 'Toronto Cares Foundation',
   '{volunteering,adults,in_person,registration_needed,wheelchair,asl}',
   '{evening_only,formal_attire,loud_music,food_provided}'),

  ('Youth Coding Club — Saturday Session',
   'Free drop-in coding club for teens, all skill levels welcome.',
   'Learn the basics of web development with mentors from local tech companies.',
   'youth', now() + interval '5 days' + interval '10 hours',
   now() + interval '5 days' + interval '12 hours',
   false, 'Scarborough Public Library', '1076 Ellesmere Rd', 'Toronto',
   true, null, 'teens 13-18', '{}', null,
   'https://example.org/youth-coding',
   'Register online, spots limited.', 'Code Forward',
   '{teens,education,free,in_person,registration_needed,recurring}',
   '{beginner_friendly,mentors_present,limited_spots}'),

  ('Senior Wellness Morning',
   'Gentle exercise, health screening, and coffee for seniors.',
   'A relaxed morning of chair yoga, blood-pressure checks, and social time.',
   'seniors', now() + interval '7 days' + interval '9 hours',
   now() + interval '7 days' + interval '11 hours',
   false, 'Markham Seniors Centre', '8100 Warden Ave', 'Markham',
   true, null, 'seniors 55+', '{wheelchair,large_print}', 'Parking and transit available',
   null, 'Just show up, or call ahead.', 'York Region Health Collective',
   '{seniors,health,sports,free,in_person,drop_in,wheelchair,large_print,quiet_space}',
   '{morning_only,gentle_pace,refreshments_provided}');
