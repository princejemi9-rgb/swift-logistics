-- READ ONLY: run after 008_upgrade_existing_database.sql reports COMMIT.
-- One CSV-exportable result set. No schema or data is changed.

with report as (
  select 'table_rls'::text as category, n.nspname || '.' || c.relname as object_name,
         jsonb_build_object('rls_enabled', c.relrowsecurity, 'owner', pg_get_userbyid(c.relowner))::text as details
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'
    and c.relname in ('profiles','shipments','shipment_events','support_tickets','booking_requests','admin_booking_requests')

  union all

  select 'function'::text,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         jsonb_build_object('returns', pg_get_function_result(p.oid), 'security_definer', p.prosecdef, 'settings', p.proconfig)::text
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in ('is_staff','create_shipment','book_shipment','admin_book_shipment','handle_new_user','track_shipment')

  union all

  select 'function_permission'::text, 'public.track_shipment(text)',
         jsonb_build_object(
           'anon_execute', has_function_privilege('anon','public.track_shipment(text)','EXECUTE'),
           'authenticated_execute', has_function_privilege('authenticated','public.track_shipment(text)','EXECUTE')
         )::text
  union all
  select 'function_permission', 'public.create_shipment(jsonb)',
         jsonb_build_object('anon_execute', has_function_privilege('anon','public.create_shipment(jsonb)','EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated','public.create_shipment(jsonb)','EXECUTE'))::text
  union all
  select 'function_permission', 'public.book_shipment(uuid,jsonb)',
         jsonb_build_object('anon_execute', has_function_privilege('anon','public.book_shipment(uuid,jsonb)','EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated','public.book_shipment(uuid,jsonb)','EXECUTE'))::text
  union all
  select 'function_permission', 'public.admin_book_shipment(uuid,uuid,jsonb)',
         jsonb_build_object('anon_execute', has_function_privilege('anon','public.admin_book_shipment(uuid,uuid,jsonb)','EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated','public.admin_book_shipment(uuid,uuid,jsonb)','EXECUTE'))::text

  union all

  select 'policy'::text, schemaname || '.' || tablename || '.' || policyname,
         jsonb_build_object('command', cmd, 'roles', roles, 'using_expression', qual, 'with_check_expression', with_check)::text
  from pg_policies
  where schemaname='public'
    and tablename in ('profiles','shipments','shipment_events','support_tickets')

  union all

  select 'expected_policy_count'::text, 'application_tables', jsonb_build_object('count', count(*), 'expected', 8)::text
  from pg_policies
  where schemaname='public'
    and tablename in ('profiles','shipments','shipment_events','support_tickets')

  union all

  select 'record_count'::text, 'public.profiles', jsonb_build_object('count', count(*))::text from public.profiles
  union all select 'record_count', 'public.shipments', jsonb_build_object('count', count(*))::text from public.shipments
  union all select 'record_count', 'public.shipment_events', jsonb_build_object('count', count(*))::text from public.shipment_events
  union all select 'record_count', 'public.support_tickets', jsonb_build_object('count', count(*))::text from public.support_tickets
  union all select 'record_count', 'public.booking_requests', jsonb_build_object('count', count(*))::text from public.booking_requests
  union all select 'record_count', 'public.admin_booking_requests', jsonb_build_object('count', count(*))::text from public.admin_booking_requests
)
select category, object_name, details
from report
order by category, object_name;
