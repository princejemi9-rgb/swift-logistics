-- Run after 005_idempotent_shipment_booking.sql.
-- Staff-only, idempotent shipment creation for the operations console.

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
security definer set search_path = ''
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

  if p_shipment is null
    or coalesce(nullif(btrim(p_shipment->>'senderName'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'senderEmail'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'origin'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'recipientName'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'recipientPhone'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'destination'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'contents'), ''), '') = ''
    or coalesce(nullif(btrim(p_shipment->>'service'), ''), '') not in ('Economy', 'Priority', 'Express')
    or coalesce(nullif(btrim(p_shipment->>'initialStatus'), ''), '') not in ('Shipment created', 'Picked up', 'In transit', 'At delivery facility', 'Out for delivery', 'Delivered', 'Delivery exception')
    or not (p_shipment ? 'weight')
    or not (p_shipment ? 'initialProgress')
  then
    raise exception using errcode = '22023', message = 'Invalid shipment details.';
  end if;

  begin
    if (p_shipment->>'weight')::numeric < 0.01 or (p_shipment->>'weight')::numeric > 99999999.99
      or (p_shipment->>'initialProgress')::integer < 0 or (p_shipment->>'initialProgress')::integer > 100
    then
      raise exception using errcode = '22023', message = 'Invalid shipment weight or progress.';
    end if;
    initial_progress := (p_shipment->>'initialProgress')::integer;
    expected_date := nullif(btrim(p_shipment->>'expectedDelivery'), '')::date;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Invalid shipment weight, progress, or expected delivery date.';
  end;

  initial_status := btrim(p_shipment->>'initialStatus');
  normalized := jsonb_build_object(
    'ownerId', p_owner_id,
    'senderName', btrim(p_shipment->>'senderName'),
    'senderEmail', btrim(p_shipment->>'senderEmail'),
    'origin', btrim(p_shipment->>'origin'),
    'recipientName', btrim(p_shipment->>'recipientName'),
    'recipientPhone', btrim(p_shipment->>'recipientPhone'),
    'destination', btrim(p_shipment->>'destination'),
    'contents', btrim(p_shipment->>'contents'),
    'weight', (p_shipment->>'weight')::numeric,
    'service', btrim(p_shipment->>'service'),
    'initialStatus', initial_status,
    'initialProgress', initial_progress,
    'expectedDelivery', expected_date
  );

  insert into public.admin_booking_requests (created_by, idempotency_key, request_payload)
  values (caller_id, p_idempotency_key, normalized)
  on conflict (created_by, idempotency_key) do nothing;

  select * into saved from public.admin_booking_requests
  where created_by = caller_id and idempotency_key = p_idempotency_key
  for update;

  if saved.request_payload is distinct from normalized then
    raise exception using errcode = 'PT409', message = 'Idempotency key was already used with different shipment details.';
  end if;
  if saved.shipment_id is not null then
    select * into shipment_row from public.shipments where id = saved.shipment_id;
    if shipment_row.id is null then
      raise exception using errcode = 'PT409', message = 'Original shipment is no longer available.';
    end if;
    return jsonb_build_object(
      'replayed', true,
      'shipment', to_jsonb(shipment_row) || jsonb_build_object('shipment_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.shipment_events e where e.shipment_id = shipment_row.id), '[]'::jsonb))
    );
  end if;

  tracking_id := 'SWF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.shipments (
    id, owner_id, sender_name, sender_email, origin, recipient_name, recipient_phone,
    destination, contents, weight, service, status, created_at, progress, expected_delivery
  ) values (
    tracking_id, p_owner_id, normalized->>'senderName', normalized->>'senderEmail', normalized->>'origin',
    normalized->>'recipientName', normalized->>'recipientPhone', normalized->>'destination', normalized->>'contents',
    (normalized->>'weight')::numeric, normalized->>'service', initial_status, now_at, initial_progress, expected_date
  ) returning * into shipment_row;
  insert into public.shipment_events (shipment_id, title, detail, created_at)
  values (tracking_id, initial_status, 'Created in the operations console.', now_at);
  update public.admin_booking_requests set shipment_id = tracking_id
  where created_by = caller_id and idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'replayed', false,
    'shipment', to_jsonb(shipment_row) || jsonb_build_object('shipment_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.shipment_events e where e.shipment_id = shipment_row.id), '[]'::jsonb))
  );
end;
$$;

revoke all on function public.admin_book_shipment(uuid, uuid, jsonb) from public, anon;
grant execute on function public.admin_book_shipment(uuid, uuid, jsonb) to authenticated;
