-- Disposable-local Supabase verification for migrations through 005 only.
-- Run as the migration owner on a NEW local database, never production:
-- psql -X -v ON_ERROR_STOP=1 -v allow_local_booking_tests=1 -f tests/booking-rls.sql
\set ON_ERROR_STOP on
\if :{?allow_local_booking_tests}
\else
  \echo 'Refusing to run without allow_local_booking_tests on a disposable local database.'
  \quit
\endif

begin;
set local plpgsql.check_asserts = on;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  if inet_server_addr() is not null and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception 'Tests require a local connection';
  end if;
  if exists(select 1 from public.profiles) or exists(select 1 from public.shipments) then
    raise exception 'Tests require an empty disposable application database';
  end if;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000001','a@example.test','{"name":"Customer A"}'),
 ('00000000-0000-4000-8000-000000000002','b@example.test','{"name":"Customer B"}');
select set_config('test.payload','{"senderName":"Customer A","senderEmail":"a@example.test","origin":"Lagos","recipientName":"Recipient","recipientPhone":"08000000000","destination":"Abuja","contents":"Clothing","weight":2,"service":"Priority"}',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare first jsonb; replay jsonb; changed jsonb; count_before bigint; begin
  first := public.book_shipment('11111111-1111-4111-8111-111111111111',current_setting('test.payload')::jsonb);
  assert first->>'replayed' = 'false', 'first response must be new';
  assert jsonb_array_length(first->'shipment'->'shipment_events') = 1, 'new booking needs one initial event';
  assert (select count(*) from public.shipments) = 1;
  assert (select count(*) from public.shipment_events) = 1;
  replay := public.book_shipment('11111111-1111-4111-8111-111111111111',current_setting('test.payload')::jsonb);
  assert replay->>'replayed' = 'true' and replay->'shipment'->>'id' = first->'shipment'->>'id', 'retry must replay';
  assert (select count(*) from public.shipments) = 1 and (select count(*) from public.shipment_events) = 1, 'retry must not write again';
  select count(*) into count_before from public.shipments;
  begin
    changed := public.book_shipment('11111111-1111-4111-8111-111111111111',current_setting('test.payload')::jsonb || '{"destination":"Kano"}'::jsonb);
    raise exception 'payload mismatch unexpectedly returned %', changed;
  exception when sqlstate 'PT409' then null; end;
  assert (select count(*) from public.shipments) = count_before, 'mismatch created a shipment';
  perform public.book_shipment('22222222-2222-4222-8222-222222222222',current_setting('test.payload')::jsonb);
  assert (select count(*) from public.shipments) = 2 and (select count(*) from public.shipment_events) = 2, 'different key must create once';
  begin perform public.create_shipment(current_setting('test.payload')::jsonb); raise exception 'old RPC was callable'; exception when insufficient_privilege then null; end;
  begin insert into public.shipments(id,owner_id,sender_name,sender_email,origin,recipient_name,recipient_phone,destination,contents,weight,service,status) values('SWF-FORGED',auth.uid(),'A','a@example.test','A','B','0','B','X',1,'Priority','Delivered'); raise exception 'direct insert was callable'; exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin
  assert (select count(*) from public.shipments) = 0, 'cross-account shipment disclosure';
  begin perform 1 from public.booking_requests; raise exception 'booking ledger disclosure'; exception when insufficient_privilege then null; end;
  perform public.book_shipment('11111111-1111-4111-8111-111111111111',current_setting('test.payload')::jsonb);
  assert (select count(*) from public.shipments) = 1, 'owner-scoped key did not create for second account';
end $$;

select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform public.book_shipment('33333333-3333-4333-8333-333333333333',current_setting('test.payload')::jsonb); raise exception 'missing identity accepted'; exception when invalid_authorization_specification then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.book_shipment('44444444-4444-4444-8444-444444444444',current_setting('test.payload')::jsonb); raise exception 'anonymous booking accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'PASS (when run locally): idempotency, authorization, ownership and rollback fixture cleanup.'
