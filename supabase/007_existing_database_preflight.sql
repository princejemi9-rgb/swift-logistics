-- READ ONLY: existing Swift Logistics Supabase upgrade preflight.
-- This is one SELECT statement and returns one exportable result set.
-- The details column is JSON text so full definitions survive CSV export.

with report as (
  -- Required tables and their RLS state.
  select 'table'::text as category,
         n.nspname || '.' || c.relname as object_name,
         jsonb_build_object(
           'rls_enabled', c.relrowsecurity,
           'force_rls', c.relforcerowsecurity,
           'owner', pg_get_userbyid(c.relowner)
         )::text as details
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in ('profiles','shipments','shipment_events','support_tickets','booking_requests','admin_booking_requests')

  union all

  -- Exact column shape, defaults, and identity metadata.
  select 'column', table_schema || '.' || table_name || '.' || column_name,
         jsonb_build_object(
           'ordinal_position', ordinal_position,
           'data_type', data_type,
           'udt_schema', udt_schema,
           'udt_name', udt_name,
           'nullable', is_nullable,
           'default', column_default,
           'identity', is_identity
         )::text
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('profiles','shipments','shipment_events','support_tickets','booking_requests','admin_booking_requests')

  union all

  -- Constraints. Foreign keys have their own category for easy CSV filtering.
  select case when con.contype = 'f' then 'foreign_key' else 'constraint' end,
         con.conrelid::regclass::text || '.' || con.conname,
         jsonb_build_object(
           'type', con.contype,
           'definition', pg_get_constraintdef(con.oid, true)
         )::text
  from pg_catalog.pg_constraint con
  where con.connamespace = 'public'::regnamespace
    and con.conrelid = any (array[
      to_regclass('public.profiles'), to_regclass('public.shipments'),
      to_regclass('public.shipment_events'), to_regclass('public.support_tickets'),
      to_regclass('public.booking_requests'), to_regclass('public.admin_booking_requests')
    ]::regclass[])

  union all

  -- All policies and their complete USING / WITH CHECK expressions.
  select 'rls_policy', schemaname || '.' || tablename || '.' || policyname,
         jsonb_build_object(
           'permissive', permissive,
           'roles', roles,
           'command', cmd,
           'using_expression', qual,
           'with_check_expression', with_check
         )::text
  from pg_policies
  where schemaname = 'public'
    and tablename in ('profiles','shipments','shipment_events','support_tickets')

  union all

  -- Full function definitions, signatures, return types, and security settings.
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         jsonb_build_object(
           'returns', pg_get_function_result(p.oid),
           'security_definer', p.prosecdef,
           'settings', p.proconfig,
           'definition', pg_get_functiondef(p.oid)
         )::text
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_staff','create_shipment','book_shipment','admin_book_shipment','handle_new_user','track_shipment','rls_auto_enable')

  union all

  -- Auth triggers, including the complete trigger definition.
  select 'trigger', 'auth.users.' || t.tgname,
         jsonb_build_object(
           'function', pn.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           'definition', pg_get_triggerdef(t.oid, true)
         )::text
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where t.tgrelid = 'auth.users'::regclass
    and not t.tgisinternal

  union all

  -- Required extension.
  select 'extension', extname,
         jsonb_build_object('version', extversion)::text
  from pg_catalog.pg_extension
  where extname = 'pgcrypto'

  union all

  -- Effective table grants relevant to browser/API roles.
  select 'table_grant', table_schema || '.' || table_name || ':' || grantee || ':' || privilege_type,
         jsonb_build_object('grantee', grantee, 'privilege', privilege_type)::text
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('profiles','shipments','shipment_events','support_tickets','booking_requests','admin_booking_requests')
    and grantee in ('anon','authenticated','PUBLIC')

  union all

  -- Effective function grants relevant to browser/API roles.
  select 'function_grant', routine_schema || '.' || routine_name || '(' || specific_name || '):' || grantee || ':' || privilege_type,
         jsonb_build_object('grantee', grantee, 'privilege', privilege_type)::text
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('is_staff','create_shipment','book_shipment','admin_book_shipment','track_shipment')
    and grantee in ('anon','authenticated','PUBLIC')

  union all

  -- Existing role values must be understood before staff policy replacement.
  select 'profile_role_value', coalesce(role, '<NULL>'),
         jsonb_build_object('count', count(*))::text
  from public.profiles
  group by role

  union all

  -- Record counts are included so the exported report proves history scope.
  select 'record_count', 'public.profiles', jsonb_build_object('count', count(*))::text from public.profiles
  union all select 'record_count', 'public.shipments', jsonb_build_object('count', count(*))::text from public.shipments
  union all select 'record_count', 'public.shipment_events', jsonb_build_object('count', count(*))::text from public.shipment_events
  union all select 'record_count', 'public.support_tickets', jsonb_build_object('count', count(*))::text from public.support_tickets

  union all

  -- Orphan/incompatible-data checks. A non-zero count blocks an automatic upgrade.
  select 'data_check', 'profiles_without_auth_user', jsonb_build_object('count', count(*))::text
  from public.profiles p left join auth.users u on u.id = p.id where u.id is null
  union all
  select 'data_check', 'shipment_owners_without_profile', jsonb_build_object('count', count(*))::text
  from public.shipments s left join public.profiles p on p.id = s.owner_id
  where s.owner_id is not null and p.id is null
  union all
  select 'data_check', 'events_without_shipment', jsonb_build_object('count', count(*))::text
  from public.shipment_events e left join public.shipments s on s.id = e.shipment_id
  where s.id is null
  union all
  select 'data_check', 'invalid_progress', jsonb_build_object('count', count(*))::text
  from public.shipments where progress is null or progress < 0 or progress > 100
  union all
  select 'data_check', 'shipments_missing_required_values', jsonb_build_object('count', count(*))::text
  from public.shipments
  where id is null or sender_name is null or sender_email is null or origin is null
     or recipient_name is null or recipient_phone is null or destination is null
     or contents is null or weight is null or service is null or status is null
  union all
  select 'data_check', 'duplicate_tracking_ids', jsonb_build_object('count', count(*))::text
  from (select id from public.shipments group by id having count(*) > 1) duplicates
)
select category, object_name, details
from report
order by category, object_name;
