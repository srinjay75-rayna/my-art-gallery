-- Run this in Supabase SQL Editor.
-- If you already have a paintings table, keep its existing id type and ensure
-- the columns below exist. The app expects is_sold to be a boolean.

create extension if not exists pgcrypto;

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
  created_at timestamptz not null default now()
);

alter table public.paintings add column if not exists is_sold boolean not null default false;
alter table public.paintings add column if not exists created_at timestamptz not null default now();
create index if not exists paintings_available_idx on public.paintings (is_sold, created_at desc);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  merchant_order_ref text unique not null,
  painting_id text not null,
  painting_title text not null,
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

create index if not exists orders_painting_idx on public.orders (painting_id);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

-- Public visitors can read painting rows; all writes are performed by the
-- server with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
alter table public.paintings enable row level security;
drop policy if exists "Public can read paintings" on public.paintings;
create policy "Public can read paintings" on public.paintings for select to anon, authenticated using (true);
grant select on public.paintings to anon, authenticated;

-- No public policies are added to orders. Keep customer and payment data private.
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

-- Public bucket for painting photos. Upload/delete is performed server-side.
insert into storage.buckets (id, name, public)
values ('paintings', 'paintings', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can view painting images" on storage.objects;
create policy "Public can view painting images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'paintings');
