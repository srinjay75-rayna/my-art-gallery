-- Artiste v2 complete Supabase schema.
-- Run in Supabase SQL Editor. This script is designed to be re-runnable.
create extension if not exists pgcrypto;

-- Customer profile is keyed to Supabase Auth user UUID.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  address text,
  city text,
  state text,
  pincode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists state text;
alter table public.profiles add column if not exists pincode text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Artist accounts are attached to a Supabase Auth user.
create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  artist_name text not null,
  bio text not null default '',
  city text not null,
  profile_photo_url text not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.artists add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.artists add column if not exists artist_name text;
alter table public.artists add column if not exists bio text not null default '';
alter table public.artists add column if not exists city text;
alter table public.artists add column if not exists profile_photo_url text;
alter table public.artists add column if not exists is_approved boolean not null default false;
alter table public.artists add column if not exists created_at timestamptz not null default now();
alter table public.artists add column if not exists updated_at timestamptz not null default now();
create unique index if not exists artists_user_id_uidx on public.artists(user_id) where user_id is not null;

-- One-off artworks. artist_id is null for owner-added Artiste Studio works.
create table if not exists public.paintings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  medium text not null,
  dimensions text not null,
  price numeric(12,2) not null check (price > 0),
  weight_kg numeric(9,3) not null check (weight_kg > 0),
  length_cm numeric(9,2) not null check (length_cm > 0),
  breadth_cm numeric(9,2) not null check (breadth_cm > 0),
  height_cm numeric(9,2) not null check (height_cm > 0),
  image_url text not null,
  is_sold boolean not null default false,
  artist_id uuid references public.artists(id) on delete set null,
  artist_name text not null default 'Artiste Studio',
  is_approved boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.paintings add column if not exists is_sold boolean not null default false;
alter table public.paintings add column if not exists artist_id uuid references public.artists(id) on delete set null;
alter table public.paintings add column if not exists artist_name text not null default 'Artiste Studio';
alter table public.paintings add column if not exists is_approved boolean not null default true;
alter table public.paintings add column if not exists created_at timestamptz not null default now();
create index if not exists paintings_available_idx on public.paintings(is_approved, is_sold, created_at desc);
create index if not exists paintings_artist_idx on public.paintings(artist_id, created_at desc);

-- Orders retain legacy single-painting columns for compatibility, and items stores full cart line data.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  merchant_order_ref text unique not null,
  painting_id text not null,
  painting_title text not null,
  items jsonb not null default '[]'::jsonb,
  user_id uuid references auth.users(id) on delete set null,
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  buyer_address text not null,
  buyer_city text not null,
  buyer_state text not null,
  buyer_pincode text not null,
  artwork_price numeric(12,2) not null,
  shipping_price numeric(12,2) not null,
  amount_paise bigint not null,
  currency text not null default 'INR',
  courier_id integer not null,
  courier_name text not null,
  package_weight_kg numeric(9,3),
  package_length_cm numeric(9,2),
  package_breadth_cm numeric(9,2),
  package_height_cm numeric(9,2),
  razorpay_order_id text unique not null,
  razorpay_payment_id text,
  shiprocket_order_id text,
  shiprocket_shipment_id text,
  shiprocket_awb_code text,
  shipment_note text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.orders add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists package_weight_kg numeric(9,3);
alter table public.orders add column if not exists package_length_cm numeric(9,2);
alter table public.orders add column if not exists package_breadth_cm numeric(9,2);
alter table public.orders add column if not exists package_height_cm numeric(9,2);
alter table public.orders add column if not exists shiprocket_awb_code text;
alter table public.orders add column if not exists shipment_note text;
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);
create index if not exists orders_painting_idx on public.orders(painting_id);
create index if not exists orders_status_idx on public.orders(status, created_at desc);

-- Atomic reservation prevents two paid checkouts from selling the same unique work.
create or replace function public.reserve_paintings_for_order(p_ids uuid[])
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  available_count integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return false; end if;
  perform id from public.paintings where id = any(p_ids) order by id for update;
  select count(*) into available_count from public.paintings where id = any(p_ids) and is_sold = false and is_approved = true;
  if available_count <> cardinality(p_ids) then return false; end if;
  update public.paintings set is_sold = true where id = any(p_ids);
  return true;
end;
$$;
revoke all on function public.reserve_paintings_for_order(uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_paintings_for_order(uuid[]) to service_role;

-- Create customer profile automatically whenever a user signs up.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_artiste on auth.users;
create trigger on_auth_user_created_artiste after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- RLS: public can browse approved catalogue rows; private tables are server API-only.
alter table public.paintings enable row level security;
drop policy if exists "Public can read paintings" on public.paintings;
drop policy if exists "Public can read approved paintings" on public.paintings;
create policy "Public can read approved paintings" on public.paintings for select to anon, authenticated using (is_approved = true and is_sold = false);
grant select on public.paintings to anon, authenticated;

alter table public.profiles enable row level security;
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
grant select, update on public.profiles to authenticated;

alter table public.artists enable row level security;
drop policy if exists "Public can read approved artist profiles" on public.artists;
create policy "Public can read approved artist profiles" on public.artists for select to anon, authenticated using (is_approved = true);
grant select on public.artists to anon, authenticated;

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

-- Public images; uploads and mutations run through authenticated server API routes with the service role.
insert into storage.buckets(id, name, public) values ('paintings','paintings',true)
on conflict (id) do update set public = true;
insert into storage.buckets(id, name, public) values ('artist-profiles','artist-profiles',true)
on conflict (id) do update set public = true;
drop policy if exists "Public can view painting images" on storage.objects;
create policy "Public can view painting images" on storage.objects for select to anon, authenticated using (bucket_id = 'paintings');
drop policy if exists "Public can view artist profile images" on storage.objects;
create policy "Public can view artist profile images" on storage.objects for select to anon, authenticated using (bucket_id = 'artist-profiles');
