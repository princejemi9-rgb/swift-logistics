-- Run after schema.sql. Creates a profile automatically for each Supabase Auth user
-- and exposes only safe tracking data through an RPC function.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.track_shipment(tracking_number text)
returns table (
  id text, origin text, destination text, service text, status text,
  created_at timestamptz, events jsonb
)
language sql
security definer set search_path = public
as $$
  select s.id, s.origin, s.destination, s.service, s.status, s.created_at,
    coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'detail', e.detail, 'time', e.created_at) order by e.created_at desc) filter (where e.id is not null), '[]'::jsonb)
  from public.shipments s
  left join public.shipment_events e on e.shipment_id = s.id
  where s.id = upper(tracking_number)
  group by s.id;
$$;

grant execute on function public.track_shipment(text) to anon, authenticated;
