-- Swift Logistics production database schema for Supabase/PostgreSQL.
-- Run in the Supabase SQL Editor after creating a project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null default 'customer' check (role in ('customer', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id text primary key,
  owner_id uuid references public.profiles(id) on delete set null,
  sender_name text not null,
  sender_email text not null,
  origin text not null,
  recipient_name text not null,
  recipient_phone text not null,
  destination text not null,
  contents text not null,
  weight numeric(10,2) not null check (weight > 0),
  service text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  shipment_id text not null references public.shipments(id) on delete cascade,
  title text not null,
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id text primary key,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text not null,
  topic text not null,
  message text not null,
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Resolved')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.support_tickets enable row level security;

-- Keeps staff role checks out of profile RLS policies themselves, avoiding
-- recursive policy evaluation. It exposes only a boolean for the caller.
create function public.is_staff()
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

create policy "users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "staff read profiles" on public.profiles for select using (public.is_staff());
create policy "users read own shipments" on public.shipments for select using (owner_id = auth.uid());
create policy "users create own shipments" on public.shipments for insert with check (owner_id = auth.uid());
create policy "users read events for own shipments" on public.shipment_events for select using (exists (select 1 from public.shipments s where s.id = shipment_id and s.owner_id = auth.uid()));
create policy "users create tickets" on public.support_tickets for insert with check (user_id is null or user_id = auth.uid());

-- Add staff policies only after assigning role='staff' to trusted profiles.
create policy "staff manage shipments" on public.shipments for all using (public.is_staff());
create policy "staff manage events" on public.shipment_events for all using (public.is_staff());
create policy "staff manage tickets" on public.support_tickets for all using (public.is_staff());
