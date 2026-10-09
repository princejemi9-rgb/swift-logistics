-- Apply after 003. Run as the trusted migration owner, never as an API client.
-- Customers book through this one operation, not through direct table inserts.
begin;

drop policy if exists "users create own shipments" on public.shipments;

create function public.create_shipment(p_shipment jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  field text;
  parcel_weight numeric;
  shipment public.shipments%rowtype;
  event public.shipment_events%rowtype;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'Sign in to create a shipment.';
  end if;
  if not exists (select 1 from public.profiles where id = caller) then
    raise exception using errcode = '42501', message = 'A customer profile is required.';
  end if;
  if p_shipment is null or pg_catalog.jsonb_typeof(p_shipment) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid shipment details.';
  end if;
  foreach field in array array['senderName','senderEmail','origin','recipientName','recipientPhone','destination','contents','service'] loop
    if pg_catalog.jsonb_typeof(p_shipment -> field) is distinct from 'string'
       or pg_catalog.btrim(p_shipment ->> field) = '' then
      raise exception using errcode = '22023', message = 'Complete all shipment fields.';
    end if;
  end loop;
  begin
    parcel_weight := (p_shipment ->> 'weight')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Invalid package weight.';
  end;
  if parcel_weight is null or parcel_weight::text in ('NaN','Infinity','-Infinity')
     or parcel_weight < 0.01 or parcel_weight > 99999999.99 then
    raise exception using errcode = '22023', message = 'Invalid package weight.';
  end if;
  if pg_catalog.btrim(p_shipment ->> 'service') not in ('Economy','Priority','Express') then
    raise exception using errcode = '22023', message = 'Invalid shipping service.';
  end if;

  -- Ownership, tracking ID and operational fields are not client-controlled.
  insert into public.shipments (
    id, owner_id, sender_name, sender_email, origin, recipient_name,
    recipient_phone, destination, contents, weight, service, status
  ) values (
    'SWF-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8)),
    caller, pg_catalog.btrim(p_shipment ->> 'senderName'),
    pg_catalog.btrim(p_shipment ->> 'senderEmail'), pg_catalog.btrim(p_shipment ->> 'origin'),
    pg_catalog.btrim(p_shipment ->> 'recipientName'), pg_catalog.btrim(p_shipment ->> 'recipientPhone'),
    pg_catalog.btrim(p_shipment ->> 'destination'), pg_catalog.btrim(p_shipment ->> 'contents'),
    parcel_weight, pg_catalog.btrim(p_shipment ->> 'service'), 'Shipment created'
  ) returning * into shipment;

  insert into public.shipment_events (shipment_id, title, detail)
  values (shipment.id, 'Shipment created', 'Collection scheduled in ' || shipment.origin)
  returning * into event;

  -- Any write/return error propagates: PostgreSQL rolls back the whole call.
  return pg_catalog.to_jsonb(shipment) || pg_catalog.jsonb_build_object(
    'shipment_events', pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(event))
  );
end;
$$;

revoke all on function public.create_shipment(jsonb) from public, anon;
grant execute on function public.create_shipment(jsonb) to authenticated;

-- No new customer event-write policies; existing staff policies remain intact.
commit;
