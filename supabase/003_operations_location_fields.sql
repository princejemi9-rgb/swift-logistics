-- Run after 002_auth_profile_and_public_tracking.sql.
alter table public.shipments add column if not exists current_country text;
alter table public.shipments add column if not exists current_state text;
alter table public.shipments add column if not exists current_city text;
alter table public.shipments add column if not exists progress integer not null default 0 check (progress between 0 and 100);
alter table public.shipments add column if not exists expected_delivery date;

create or replace function public.track_shipment(tracking_number text)
returns table (id text, origin text, destination text, service text, status text, current_country text, current_state text, current_city text, progress integer, expected_delivery date, created_at timestamptz, events jsonb)
language sql security definer set search_path = public as $$
  select s.id,s.origin,s.destination,s.service,s.status,s.current_country,s.current_state,s.current_city,s.progress,s.expected_delivery,s.created_at,coalesce(jsonb_agg(jsonb_build_object('title',e.title,'detail',e.detail,'time',e.created_at) order by e.created_at desc) filter(where e.id is not null),'[]'::jsonb)
  from public.shipments s left join public.shipment_events e on e.shipment_id=s.id where s.id=upper(tracking_number) group by s.id;
$$;
