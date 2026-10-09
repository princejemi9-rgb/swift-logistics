-- Apply after 004 as the trusted migration/table owner. Do not apply remotely
-- without a separate reviewed release. The original migration is unchanged.
begin;
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

-- Prevent API clients from bypassing required idempotency through the old RPC.
-- The trusted owner of the new definer function can still call it internally.
revoke all on function public.create_shipment(jsonb) from public, anon, authenticated;

create function public.book_shipment(p_idempotency_key uuid, p_shipment jsonb)
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

  -- The unique index arbitrates concurrent claims, waiting for the winner's
  -- transaction to commit/roll back. No shipment is inserted before this claim.
  insert into public.booking_requests(owner_id,idempotency_key,request_payload)
  values(caller,p_idempotency_key,normalized)
  on conflict (owner_id,idempotency_key) do nothing;
  claimed := found;
  select * into saved from public.booking_requests
    where owner_id=caller and idempotency_key=p_idempotency_key for update;
  if not found then
    -- A stricter isolation level/conflicting transaction must fail, never book twice.
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
  -- Any failure rolls back the claim, shipment and initial event together.
end;
$$;
revoke all on function public.book_shipment(uuid,jsonb) from public, anon;
grant execute on function public.book_shipment(uuid,jsonb) to authenticated;
commit;
