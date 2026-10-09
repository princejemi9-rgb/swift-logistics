-- Swift Logistics existing-database upgrade.
-- Apply only after reviewing 007_existing_database_preflight.sql output.
-- Forward-only: preserves profiles, shipments, shipment events, and tickets.
-- Run once as the trusted Supabase SQL Editor migration owner.

begin;

-- Stop before any authorization change if this is not the reviewed base schema.
do $$
declare
  required_table text;
  required_column text;
begin
  if current_user <> 'postgres' then
    raise exception 'Run this upgrade as the trusted Supabase SQL Editor migration owner (postgres)';
  end if;
  foreach required_table in array array['profiles','shipments','shipment_events','support_tickets'] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Missing required table public.%', required_table;
    end if;
  end loop;
  foreach required_column in array array['id','name','role','created_at'] loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name=required_column) then
      raise exception 'Missing required column public.profiles.% ', required_column;
    end if;
  end loop;
  foreach required_column in array array['id','owner_id','sender_name','sender_email','origin','recipient_name','recipient_phone','destination','contents','weight','service','status','created_at','current_country','current_state','current_city','progress','expected_delivery'] loop
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shipments' and column_name=required_column) then
      raise exception 'Missing required column public.shipments.% ', required_column;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='id' and udt_name='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role' and udt_name='text')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shipments' and column_name='owner_id' and udt_name='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shipments' and column_name='weight' and udt_name='numeric')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shipments' and column_name='progress' and udt_name='int4')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='shipments' and column_name='expected_delivery' and udt_name='date') then
    raise exception 'Existing column types do not match the reviewed Swift Logistics schema';
  end if;
  if to_regprocedure('public.create_shipment(jsonb)') is null then
    raise exception 'public.create_shipment(jsonb) is required before this upgrade';
  end if;
  if not exists (
    select 1 from pg_proc p where p.oid = to_regprocedure('public.create_shipment(jsonb)') and p.prorettype = 'jsonb'::regtype
  ) then
    raise exception 'public.create_shipment(jsonb) must return jsonb';
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.create_shipment(jsonb)')
      and pg_get_userbyid(p.proowner) = current_user
  ) then
    raise exception 'public.create_shipment(jsonb) is not owned by the trusted migration role';
  end if;
  if to_regprocedure('public.handle_new_user()') is null or to_regprocedure('public.track_shipment(text)') is null
     or exists (
       select 1 from pg_proc p
       where p.oid in (to_regprocedure('public.handle_new_user()'), to_regprocedure('public.track_shipment(text)'))
         and pg_get_userbyid(p.proowner) <> current_user
     ) then
    raise exception 'Existing SECURITY DEFINER Auth/tracking functions are not owned by the trusted migration role';
  end if;
  if exists (select 1 from public.profiles where role is null or role not in ('customer','staff')) then
    raise exception 'profiles contains an unsupported role; resolve it before upgrading';
  end if;
  if exists (select 1 from public.profiles p left join auth.users u on u.id=p.id where u.id is null) then
    raise exception 'profiles contains rows without auth.users records; resolve them before upgrading';
  end if;
  if exists (select 1 from public.shipments s left join public.profiles p on p.id=s.owner_id where s.owner_id is not null and p.id is null) then
    raise exception 'shipments contains assigned owners without profiles; resolve them before upgrading';
  end if;
  if exists (select 1 from public.shipment_events e left join public.shipments s on s.id=e.shipment_id where s.id is null) then
    raise exception 'shipment_events contains rows without shipments; resolve them before upgrading';
  end if;
  if exists (select 1 from public.shipments where progress is null or progress < 0 or progress > 100) then
    raise exception 'shipments contains progress outside 0..100; resolve it before upgrading';
  end if;
  if exists (select 1 from public.shipments where sender_name is null or sender_email is null or origin is null or recipient_name is null or recipient_phone is null or destination is null or contents is null or weight is null or service is null or status is null) then
    raise exception 'shipments contains missing required values; resolve them before upgrading';
  end if;
  if to_regclass('public.booking_requests') is not null or to_regclass('public.admin_booking_requests') is not null then
    raise exception 'An idempotency ledger already exists; do not run this one-time upgrade against an unknown partial upgrade';
  end if;
  -- The reviewed export has exactly these seven policies. Refuse to remove an
  -- unknown/custom policy or a changed baseline.
  if (select count(*) from pg_policies where schemaname='public' and tablename in ('profiles','shipments','shipment_events','support_tickets')) <> 7
     or exists (select 1 from pg_policies where schemaname='public' and tablename in ('profiles','shipments','shipment_events','support_tickets') and policyname not in ('users read own profile','users read own shipments','users read events for own shipments','users create tickets','staff manage shipments','staff manage events','staff manage tickets')) then
    raise exception 'Existing RLS policies differ from the reviewed seven-policy baseline; stop and re-run preflight';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='users read own profile' and cmd='SELECT' and regexp_replace(lower(coalesce(qual,'')), '\s+', '', 'g')='(auth.uid()=id)' and with_check is null)
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='shipments' and policyname='users read own shipments' and cmd='SELECT' and regexp_replace(lower(coalesce(qual,'')), '\s+', '', 'g')='(owner_id=auth.uid())' and with_check is null)
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='shipment_events' and policyname='users read events for own shipments' and cmd='SELECT' and regexp_replace(lower(coalesce(qual,'')), '\s+', '', 'g')='(exists(select1fromshipmentsswhere((s.id=shipment_events.shipment_id)and(s.owner_id=auth.uid()))))' and with_check is null)
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='support_tickets' and policyname='users create tickets' and cmd='INSERT' and qual is null and regexp_replace(lower(coalesce(with_check,'')), '\s+', '', 'g')='((user_idisnull)or(user_id=auth.uid()))')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='shipments' and policyname='staff manage shipments' and cmd='ALL' and with_check is null and regexp_replace(lower(coalesce(qual,'')), '\s+', '', 'g')='((selectprofiles.rolefromprofileswhere(profiles.id=auth.uid()))=''staff''::text)')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='shipment_events' and policyname='staff manage events' and cmd='ALL' and with_check is null and regexp_replace(lower(coalesce(qual,'')), '\s+', '', 'g')='((selectprofiles.rolefromprofileswhere(profiles.id=auth.uid()))=''staff''::text)')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='support_tickets' and policyname='staff manage tickets' and cmd='ALL' and with_check is null and regexp_replace(lower(coalesce(qual,'')), '\s+', '', 'g')='((selectprofiles.rolefromprofileswhere(profiles.id=auth.uid()))=''staff''::text)') then
    raise exception 'Existing RLS policy definitions differ from the reviewed baseline; stop and re-run preflight';
  end if;
end;
$$;

create extension if not exists pgcrypto;

-- A non-recursive, security-definer role predicate for all staff policies/RPCs.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff');
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Preserve the existing Auth registration behavior while ensuring its function
-- and named trigger are exactly the expected, non-privilege-escalating version.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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

-- The current API's public /api/shipments/:tracking lookup contract.
-- CREATE OR REPLACE is safe here because the preflight confirmed this signature.
create or replace function public.track_shipment(tracking_number text)
returns table (
  id text, origin text, destination text, service text, status text,
  current_country text, current_state text, current_city text, progress integer,
  expected_delivery date, created_at timestamptz, events jsonb
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.origin, s.destination, s.service, s.status,
    s.current_country, s.current_state, s.current_city, s.progress,
    s.expected_delivery, s.created_at,
    coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'detail', e.detail, 'time', e.created_at) order by e.created_at desc) filter (where e.id is not null), '[]'::jsonb)
  from public.shipments s
  left join public.shipment_events e on e.shipment_id = s.id
  where s.id = upper(tracking_number)
  group by s.id;
$$;
revoke all on function public.track_shipment(text) from public;
grant execute on function public.track_shipment(text) to anon, authenticated;

-- Replace only application-table policies in one transaction. The preflight
-- confirmed these tables have no other policies to preserve. Direct profile
-- lookups are replaced with is_staff() to avoid recursive RLS evaluation.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','shipments','shipment_events','support_tickets')
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.support_tickets enable row level security;

create policy "users read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "staff read profiles" on public.profiles
  for select using (public.is_staff());

create policy "users read own shipments" on public.shipments
  for select using (owner_id = auth.uid());
create policy "users read events for own shipments" on public.shipment_events
  for select using (exists (
    select 1 from public.shipments s where s.id = shipment_id and s.owner_id = auth.uid()
  ));
create policy "users create tickets" on public.support_tickets
  for insert with check (user_id is null or user_id = auth.uid());

create policy "staff manage shipments" on public.shipments
  for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage events" on public.shipment_events
  for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage tickets" on public.support_tickets
  for all using (public.is_staff()) with check (public.is_staff());

-- Narrow PostgREST table access to the current frontend/API requirements.
-- RLS remains the authorization boundary; no shipment INSERT grant is given.
revoke all on table public.profiles, public.shipments, public.shipment_events, public.support_tickets from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, update on table public.shipments to authenticated;
grant select, insert on table public.shipment_events to authenticated;
grant insert on table public.support_tickets to anon, authenticated;
grant select, update on table public.support_tickets to authenticated;
do $$
declare event_sequence text := pg_get_serial_sequence('public.shipment_events', 'id');
begin
  if event_sequence is null then
    raise exception 'Could not locate the sequence backing public.shipment_events.id';
  end if;
  execute format('grant usage on sequence %s to authenticated', event_sequence);
end;
$$;

-- Customer booking ledger. It is never readable or writable directly by API
-- roles; the security-definer RPC below is the only supported access path.
create table public.booking_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  shipment_id text references public.shipments(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key)
);
alter table public.booking_requests enable row level security;
revoke all on table public.booking_requests from public, anon, authenticated;

-- Existing direct create_shipment remains callable only from the definer RPC.
revoke all on function public.create_shipment(jsonb) from public, anon, authenticated;

create or replace function public.book_shipment(p_idempotency_key uuid, p_shipment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized jsonb := '{}'::jsonb;
  field text;
  parcel_weight numeric;
  saved public.booking_requests%rowtype;
  persisted jsonb;
  claimed boolean;
begin
  if caller is null then
    raise exception using errcode='28000', message='Sign in to create a shipment.';
  end if;
  if not exists(select 1 from public.profiles where id=caller) then
    raise exception using errcode='42501', message='A customer profile is required.';
  end if;
  if p_idempotency_key is null or p_shipment is null or pg_catalog.jsonb_typeof(p_shipment)<>'object' then
    raise exception using errcode='22023', message='A booking key and shipment details are required.';
  end if;
  foreach field in array array['senderName','senderEmail','origin','recipientName','recipientPhone','destination','contents','service'] loop
    if pg_catalog.jsonb_typeof(p_shipment->field) is distinct from 'string' or pg_catalog.btrim(p_shipment->>field)='' then
      raise exception using errcode='22023', message='Complete all shipment fields.';
    end if;
    normalized := normalized || pg_catalog.jsonb_build_object(field,pg_catalog.btrim(p_shipment->>field));
  end loop;
  begin
    parcel_weight := (p_shipment->>'weight')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023', message='Invalid package weight.';
  end;
  if parcel_weight is null or parcel_weight::text in ('NaN','Infinity','-Infinity') or parcel_weight<0.01 or parcel_weight>99999999.99
     or normalized->>'service' not in ('Economy','Priority','Express') then
    raise exception using errcode='22023', message='Invalid weight or service.';
  end if;
  normalized := normalized || pg_catalog.jsonb_build_object('weight',parcel_weight);

  insert into public.booking_requests(owner_id,idempotency_key,request_payload)
  values(caller,p_idempotency_key,normalized)
  on conflict (owner_id,idempotency_key) do nothing;
  claimed := found;
  select * into saved from public.booking_requests
    where owner_id=caller and idempotency_key=p_idempotency_key for update;
  if not found then
    raise exception using errcode='40001', message='Retry this booking with the same key.';
  end if;
  if saved.request_payload <> normalized then
    raise exception using errcode='PT409', message='Booking key is already associated with different details.';
  end if;
  if not claimed then
    select pg_catalog.to_jsonb(s) || pg_catalog.jsonb_build_object('shipment_events',
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.created_at desc,e.id desc)
        from public.shipment_events e where e.shipment_id=s.id),'[]'::jsonb))
    into persisted from public.shipments s where s.id=saved.shipment_id and s.owner_id=caller;
    if persisted is null then
      raise exception using errcode='PT409', message='The original booking is no longer available.';
    end if;
    return pg_catalog.jsonb_build_object('shipment',persisted,'replayed',true);
  end if;
  persisted := public.create_shipment(normalized);
  update public.booking_requests set shipment_id=persisted->>'id'
    where owner_id=caller and idempotency_key=p_idempotency_key;
  return pg_catalog.jsonb_build_object('shipment',persisted,'replayed',false);
end;
$$;
revoke all on function public.book_shipment(uuid,jsonb) from public, anon;
grant execute on function public.book_shipment(uuid,jsonb) to authenticated;

-- Staff-owned idempotency ledger and staff-only account assignment workflow.
create table public.admin_booking_requests (
  created_by uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  shipment_id text references public.shipments(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (created_by, idempotency_key)
);
alter table public.admin_booking_requests enable row level security;
revoke all on table public.admin_booking_requests from public, anon, authenticated;

create or replace function public.admin_book_shipment(
  p_idempotency_key uuid,
  p_owner_id uuid,
  p_shipment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized jsonb;
  saved public.admin_booking_requests%rowtype;
  shipment_row public.shipments%rowtype;
  tracking_id text;
  now_at timestamptz := now();
  initial_status text;
  initial_progress integer;
  expected_date date;
  parcel_weight numeric;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;
  if not public.is_staff() then
    raise exception using errcode = '42501', message = 'Staff access is required.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;
  if p_owner_id is not null and not exists (
    select 1 from public.profiles where id = p_owner_id and role = 'customer'
  ) then
    raise exception using errcode = '22023', message = 'Assigned owner must be an existing customer.';
  end if;
  if p_shipment is null or pg_catalog.jsonb_typeof(p_shipment) <> 'object'
    or coalesce(nullif(btrim(p_shipment->>'senderName'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'senderEmail'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'origin'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'recipientName'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'recipientPhone'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'destination'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'contents'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'service'), ''), '') not in ('Economy', 'Priority', 'Express')
    or coalesce(nullif(btrim(p_shipment->>'initialStatus'), ''), '') not in ('Shipment created', 'Picked up', 'In transit', 'At delivery facility', 'Out for delivery', 'Delivered', 'Delivery exception')
    or not (p_shipment ? 'weight') or not (p_shipment ? 'initialProgress')
  then
    raise exception using errcode = '22023', message = 'Invalid shipment details.';
  end if;
  begin
    if pg_catalog.lower(pg_catalog.btrim(p_shipment->>'weight')) in ('nan','infinity','+infinity','-infinity','inf','+inf','-inf') then
      raise exception using errcode = '22023', message = 'Invalid shipment weight.';
    end if;
    parcel_weight := (p_shipment->>'weight')::numeric;
    if parcel_weight is null or parcel_weight::text in ('NaN','Infinity','-Infinity')
      or parcel_weight < 0.01 or parcel_weight > 99999999.99
      or (p_shipment->>'initialProgress')::integer < 0 or (p_shipment->>'initialProgress')::integer > 100 then
      raise exception using errcode = '22023', message = 'Invalid shipment weight or progress.';
    end if;
    initial_progress := (p_shipment->>'initialProgress')::integer;
    expected_date := nullif(btrim(p_shipment->>'expectedDelivery'), '')::date;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Invalid shipment weight, progress, or expected delivery date.';
  end;
  initial_status := btrim(p_shipment->>'initialStatus');
  normalized := jsonb_build_object(
    'ownerId', p_owner_id, 'senderName', btrim(p_shipment->>'senderName'),
    'senderEmail', btrim(p_shipment->>'senderEmail'), 'origin', btrim(p_shipment->>'origin'),
    'recipientName', btrim(p_shipment->>'recipientName'), 'recipientPhone', btrim(p_shipment->>'recipientPhone'),
    'destination', btrim(p_shipment->>'destination'), 'contents', btrim(p_shipment->>'contents'),
    'weight', parcel_weight, 'service', btrim(p_shipment->>'service'),
    'initialStatus', initial_status, 'initialProgress', initial_progress, 'expectedDelivery', expected_date
  );
  insert into public.admin_booking_requests (created_by, idempotency_key, request_payload)
  values (caller_id, p_idempotency_key, normalized)
  on conflict (created_by, idempotency_key) do nothing;
  select * into saved from public.admin_booking_requests
  where created_by = caller_id and idempotency_key = p_idempotency_key for update;
  if saved.request_payload is distinct from normalized then
    raise exception using errcode = 'PT409', message = 'Idempotency key was already used with different shipment details.';
  end if;
  if saved.shipment_id is not null then
    select * into shipment_row from public.shipments where id = saved.shipment_id;
    if shipment_row.id is null then
      raise exception using errcode = 'PT409', message = 'Original shipment is no longer available.';
    end if;
    return jsonb_build_object('replayed', true, 'shipment', to_jsonb(shipment_row) || jsonb_build_object(
      'shipment_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id desc) from public.shipment_events e where e.shipment_id = shipment_row.id), '[]'::jsonb)
    ));
  end if;
  tracking_id := 'SWF-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.shipments (
    id, owner_id, sender_name, sender_email, origin, recipient_name, recipient_phone,
    destination, contents, weight, service, status, created_at, progress, expected_delivery
  ) values (
    tracking_id, p_owner_id, normalized->>'senderName', normalized->>'senderEmail', normalized->>'origin',
    normalized->>'recipientName', normalized->>'recipientPhone', normalized->>'destination', normalized->>'contents',
    parcel_weight, normalized->>'service', initial_status, now_at, initial_progress, expected_date
  ) returning * into shipment_row;
  insert into public.shipment_events (shipment_id, title, detail, created_at)
  values (tracking_id, initial_status, 'Created in the operations console.', now_at);
  update public.admin_booking_requests set shipment_id = tracking_id
  where created_by = caller_id and idempotency_key = p_idempotency_key;
  return jsonb_build_object('replayed', false, 'shipment', to_jsonb(shipment_row) || jsonb_build_object(
    'shipment_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id desc) from public.shipment_events e where e.shipment_id = shipment_row.id), '[]'::jsonb)
  ));
end;
$$;
revoke all on function public.admin_book_shipment(uuid,uuid,jsonb) from public, anon;
grant execute on function public.admin_book_shipment(uuid,uuid,jsonb) to authenticated;

commit;
