-- Artiste marketplace schema v4.0 with in-page email OTP authentication
-- Additive / rerunnable migration. Existing Artiste paintings, Customers, orders and Artist records are retained.
-- Apply in Supabase SQL Editor. Back up before deploying any production database migration.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Customer profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  address text,
  landmark text not null default '',
  locality text not null default '',
  city text,
  state text,
  pincode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists landmark text not null default '';
alter table public.profiles add column if not exists locality text not null default '';
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists state text;
alter table public.profiles add column if not exists pincode text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- Artist public identity + private pickup address. Bank details live separately.
-- -----------------------------------------------------------------------------
create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  artist_name text not null,
  bio text not null default '',
  city text not null default '',
  state text not null default '',
  profile_photo_url text not null default '',
  avatar_url text not null default '',
  creator_role text not null default 'Painter' check (creator_role in ('Painter', 'Photographer')),
  pickup_address text not null default '',
  pickup_contact_name text not null default '',
  pickup_phone text not null default '',
  pickup_landmark text not null default '',
  pickup_locality text not null default '',
  pickup_pincode text not null default '',
  pickup_location text not null default 'Primary',
  is_approved boolean not null default false,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.artists add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.artists add column if not exists email text not null default '';
alter table public.artists add column if not exists artist_name text;
alter table public.artists add column if not exists bio text not null default '';
alter table public.artists add column if not exists city text not null default '';
alter table public.artists add column if not exists state text not null default '';
alter table public.artists add column if not exists profile_photo_url text not null default '';
alter table public.artists add column if not exists avatar_url text not null default '';
alter table public.artists add column if not exists creator_role text;
update public.artists set creator_role = 'Painter' where creator_role is null or creator_role not in ('Painter', 'Photographer');
alter table public.artists alter column creator_role set default 'Painter';
alter table public.artists alter column creator_role set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'artists_creator_role_check') then
    alter table public.artists add constraint artists_creator_role_check check (creator_role in ('Painter', 'Photographer'));
  end if;
end $$;
alter table public.artists add column if not exists pickup_address text not null default '';
alter table public.artists add column if not exists pickup_contact_name text not null default '';
alter table public.artists add column if not exists pickup_phone text not null default '';
alter table public.artists add column if not exists pickup_landmark text not null default '';
alter table public.artists add column if not exists pickup_locality text not null default '';
alter table public.artists add column if not exists pickup_pincode text not null default '';
alter table public.artists add column if not exists pickup_location text not null default 'Primary';
alter table public.artists add column if not exists is_approved boolean not null default false;
alter table public.artists add column if not exists is_suspended boolean not null default false;
alter table public.artists add column if not exists created_at timestamptz not null default now();
alter table public.artists add column if not exists updated_at timestamptz not null default now();
update public.artists set pickup_contact_name = coalesce(nullif(pickup_contact_name, ''), artist_name) where pickup_contact_name = '';
drop index if exists public.artists_user_id_uidx;
create unique index if not exists artists_user_id_uidx on public.artists(user_id);

-- -----------------------------------------------------------------------------
-- Gallery paintings. Publicly visible columns are safe; all studio origins are
-- migrated to painting_shipping_origins below before the legacy columns are
-- scrubbed from the public painting rows.
-- -----------------------------------------------------------------------------
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
  stock_quantity integer not null default 1 check (stock_quantity >= 0),
  edition_details text not null default '',
  print_details text not null default '',
  artist_id uuid references public.artists(id) on delete set null,
  artist_name text not null default 'Artiste Studio',
  avatar_url text not null default '',
  category text not null default 'Painting',
  is_approved boolean not null default true,
  pickup_pincode text,
  pickup_location text not null default 'Primary',
  created_at timestamptz not null default now()
);
alter table public.paintings add column if not exists is_sold boolean not null default false;
alter table public.paintings add column if not exists artist_id uuid references public.artists(id) on delete set null;
alter table public.paintings add column if not exists artist_name text not null default 'Artiste Studio';
alter table public.paintings add column if not exists avatar_url text not null default '';
-- V7: Paintings remain the default art form; new listings may also be Fine-Art Photography.
alter table public.paintings add column if not exists category text not null default 'Painting';
update public.paintings set category = 'Painting' where category is null or btrim(category) = '';
alter table public.paintings add column if not exists is_approved boolean not null default true;
alter table public.paintings add column if not exists pickup_pincode text;
alter table public.paintings add column if not exists pickup_location text not null default 'Primary';
alter table public.paintings add column if not exists created_at timestamptz not null default now();
-- V9 inventory migration is placed before the payment RPC definitions so even
-- older databases have stock columns before any payment function is executed.
alter table public.paintings add column if not exists stock_quantity integer;
update public.paintings set stock_quantity = case when is_sold then 0 else 1 end where stock_quantity is null;
alter table public.paintings alter column stock_quantity set default 1;
alter table public.paintings alter column stock_quantity set not null;
alter table public.paintings add column if not exists edition_details text not null default '';
alter table public.paintings add column if not exists print_details text not null default '';
-- Preserve any legacy SOLD OUT marker during migration; stock quantity takes
-- over as the source of truth after the initial backfill.
update public.paintings set stock_quantity = 0 where is_sold = true and stock_quantity > 0;
update public.paintings set is_sold = (stock_quantity <= 0);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'paintings_stock_quantity_nonnegative') then
    alter table public.paintings add constraint paintings_stock_quantity_nonnegative check (stock_quantity >= 0);
  end if;
end $$;

-- Artist avatars are safe public attribution fields; studio pickup and payout
-- information remains in the private Artist / dispatch tables.
update public.artists
set avatar_url = coalesce(nullif(avatar_url, ''), nullif(profile_photo_url, ''), '')
where coalesce(avatar_url, '') = '' and coalesce(profile_photo_url, '') <> '';
update public.paintings p
set avatar_url = coalesce(nullif(a.avatar_url, ''), nullif(a.profile_photo_url, ''), '')
from public.artists a
where p.artist_id = a.id and coalesce(p.avatar_url, '') = '';

-- Private origin table. This keeps old pickup data intact while removing it from
-- public gallery rows (table-wide GRANTs below must not expose origin PINs).
create table if not exists public.painting_shipping_origins (
  painting_id uuid primary key references public.paintings(id) on delete cascade,
  artist_id uuid references public.artists(id) on delete set null,
  pickup_pincode text not null,
  pickup_location text not null default 'Primary',
  migrated_at timestamptz not null default now()
);
insert into public.painting_shipping_origins (painting_id, artist_id, pickup_pincode, pickup_location)
select id, artist_id, pickup_pincode, coalesce(nullif(pickup_location, ''), 'Primary')
from public.paintings
where pickup_pincode is not null and trim(pickup_pincode) <> ''
on conflict (painting_id) do nothing;
update public.paintings set pickup_pincode = null, pickup_location = 'Primary' where pickup_pincode is not null;
create index if not exists paintings_available_idx on public.paintings(is_approved, is_sold, created_at desc);
create index if not exists paintings_artist_idx on public.paintings(artist_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Customer orders. The existing columns remain for compatibility with legacy
-- Artiste orders; the customer_* fields are the canonical v3 values.
-- -----------------------------------------------------------------------------
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
  artwork_price numeric(12,2) not null default 0,
  shipping_price numeric(12,2) not null default 0,
  amount_paise bigint not null default 0,
  currency text not null default 'INR',
  courier_id integer not null default 0,
  courier_name text not null default '',
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
  shipment_claimed_at timestamptz,
  status text not null default 'Pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
-- Backward-compatible columns needed by new checkouts when upgrading an older orders table.
alter table public.orders add column if not exists id uuid default gen_random_uuid();
alter table public.orders add column if not exists merchant_order_ref text;
alter table public.orders add column if not exists painting_id text not null default '';
alter table public.orders add column if not exists painting_title text not null default '';
alter table public.orders add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists buyer_name text not null default '';
alter table public.orders add column if not exists buyer_email text not null default '';
alter table public.orders add column if not exists buyer_phone text not null default '';
alter table public.orders add column if not exists buyer_address text not null default '';
alter table public.orders add column if not exists buyer_city text not null default '';
alter table public.orders add column if not exists buyer_state text not null default '';
alter table public.orders add column if not exists buyer_pincode text not null default '';
alter table public.orders add column if not exists artwork_price numeric(12,2) not null default 0;
alter table public.orders add column if not exists shipping_price numeric(12,2) not null default 0;
alter table public.orders add column if not exists amount_paise bigint not null default 0;
alter table public.orders add column if not exists currency text not null default 'INR';
alter table public.orders add column if not exists courier_id integer not null default 0;
alter table public.orders add column if not exists courier_name text not null default '';
alter table public.orders add column if not exists razorpay_order_id text;
alter table public.orders add column if not exists razorpay_payment_id text;
alter table public.orders add column if not exists shiprocket_order_id text;
alter table public.orders add column if not exists shiprocket_shipment_id text;
alter table public.orders add column if not exists shiprocket_awb_code text;
alter table public.orders add column if not exists shipment_note text;
alter table public.orders add column if not exists shipment_claimed_at timestamptz;
alter table public.orders add column if not exists status text not null default 'Pending';
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists package_weight_kg numeric(9,3);
alter table public.orders add column if not exists package_length_cm numeric(9,2);
alter table public.orders add column if not exists package_breadth_cm numeric(9,2);
alter table public.orders add column if not exists package_height_cm numeric(9,2);
alter table public.orders add column if not exists customer_email text not null default '';
alter table public.orders add column if not exists customer_name text not null default '';
alter table public.orders add column if not exists customer_phone text not null default '';
alter table public.orders add column if not exists shipping_address text not null default '';
alter table public.orders add column if not exists landmark text not null default '';
alter table public.orders add column if not exists locality text not null default '';
alter table public.orders add column if not exists city text not null default '';
alter table public.orders add column if not exists state text not null default '';
alter table public.orders add column if not exists pincode text not null default '';
alter table public.orders add column if not exists platform_fee numeric(12,2) not null default 0;
alter table public.orders add column if not exists artist_payout numeric(12,2) not null default 0;
alter table public.orders add column if not exists shipping_amount numeric(12,2) not null default 0;
alter table public.orders add column if not exists total_amount numeric(12,2) not null default 0;
alter table public.orders add column if not exists payout_status text not null default 'Pending';
alter table public.orders add column if not exists courier_cost numeric(12,2) not null default 0;
alter table public.orders add column if not exists shipping_included boolean not null default false;
alter table public.orders add column if not exists shipment_status text not null default 'Pending';
alter table public.orders add column if not exists pickup_pincode text not null default '';
alter table public.orders add column if not exists pickup_location text not null default 'Primary';
alter table public.orders add column if not exists shipping_breakdown jsonb not null default '[]'::jsonb;
update public.orders set
  merchant_order_ref = coalesce(nullif(merchant_order_ref, ''), 'LEGACY-' || replace(id::text, '-', '')),
  customer_email = coalesce(nullif(customer_email, ''), buyer_email),
  customer_name = coalesce(nullif(customer_name, ''), buyer_name),
  customer_phone = coalesce(nullif(customer_phone, ''), buyer_phone),
  shipping_address = coalesce(nullif(shipping_address, ''), buyer_address),
  city = coalesce(nullif(city, ''), buyer_city),
  state = coalesce(nullif(state, ''), buyer_state),
  pincode = coalesce(nullif(pincode, ''), buyer_pincode),
  shipping_amount = case when shipping_amount = 0 then coalesce(shipping_price, 0) else shipping_amount end,
  total_amount = case when total_amount = 0 then coalesce(amount_paise, 0)::numeric / 100 else total_amount end,
  shipment_status = case when shiprocket_shipment_id is not null then 'Shipment created' else shipment_status end;
update public.orders set status = 'Paid' where lower(status) in ('paid', 'shipment_created');
alter table public.orders alter column merchant_order_ref set not null;
create unique index if not exists orders_razorpay_order_id_uidx on public.orders(razorpay_order_id) where razorpay_order_id is not null;
create unique index if not exists orders_merchant_ref_uidx on public.orders(merchant_order_ref) where merchant_order_ref is not null;
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);
create index if not exists orders_customer_email_idx on public.orders(lower(customer_email), created_at desc);
create index if not exists orders_status_idx on public.orders(status, created_at desc);

-- Attach legacy email-matched orders to an existing verified Customer Auth user;
-- Customer account APIs still retain the email fallback for older unmatched rows.
update public.orders o
set user_id = u.id
from auth.users u
where o.user_id is null
  and lower(coalesce(nullif(o.customer_email, ''), o.buyer_email, '')) = lower(coalesce(u.email, ''));

insert into public.profiles(id, full_name, email, phone)
select u.id,
       coalesce(u.raw_user_meta_data->>'full_name', ''),
       lower(coalesce(u.email, '')),
       coalesce(u.raw_user_meta_data->>'phone', '')
from auth.users u
on conflict (id) do update
  set email = case when coalesce(excluded.email, '') <> '' then excluded.email else profiles.email end,
      full_name = case when coalesce(profiles.full_name, '') = '' then excluded.full_name else profiles.full_name end,
      phone = case when coalesce(profiles.phone, '') = '' then excluded.phone else profiles.phone end;
create unique index if not exists profiles_email_lower_uidx
  on public.profiles(lower(email)) where coalesce(email, '') <> '';

update public.artists a
set email = lower(u.email)
from auth.users u
where a.user_id = u.id and coalesce(a.email, '') = '';

update public.paintings p
set artist_name = a.artist_name
from public.artists a
where p.artist_id = a.id and coalesce(p.artist_name, '') in ('', 'Artiste Studio');

-- -----------------------------------------------------------------------------
-- Per-Artist payout ledger (one record per Artist per successfully paid order).
-- -----------------------------------------------------------------------------
create table if not exists public.artist_payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_ref text not null default '',
  artist_id uuid not null references public.artists(id) on delete restrict,
  artist_name text not null,
  gross_amount numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0,
  artist_payout numeric(12,2) not null default 0,
  creator_role text not null default 'Painter',
  commission_rate numeric(5,4) not null default 0.2500,
  payout_status text not null default 'Pending' check (payout_status in ('Pending', 'Paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id, artist_id)
);
alter table public.artist_payouts add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.artist_payouts add column if not exists order_ref text not null default '';
alter table public.artist_payouts add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.artist_payouts add column if not exists artist_name text not null default '';
alter table public.artist_payouts add column if not exists gross_amount numeric(12,2) not null default 0;
alter table public.artist_payouts add column if not exists platform_fee numeric(12,2) not null default 0;
alter table public.artist_payouts add column if not exists artist_payout numeric(12,2) not null default 0;
alter table public.artist_payouts add column if not exists creator_role text not null default 'Painter';
alter table public.artist_payouts add column if not exists commission_rate numeric(5,4) not null default 0.2500;
alter table public.artist_payouts add column if not exists payout_status text not null default 'Pending';
alter table public.artist_payouts add column if not exists paid_at timestamptz;
alter table public.artist_payouts add column if not exists created_at timestamptz not null default now();
create unique index if not exists artist_payouts_order_artist_uidx on public.artist_payouts(order_id, artist_id);
create index if not exists artist_payouts_artist_idx on public.artist_payouts(artist_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Private, verified Artist bank / UPI payout details. Account number is
-- application-encrypted (AES-256-GCM) and the readable value is always masked.
-- -----------------------------------------------------------------------------
create table if not exists public.artist_payout_accounts (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_holder_name text not null,
  bank_account_number_encrypted text not null,
  bank_account_number_masked text not null,
  ifsc_code text not null,
  bank_name text not null,
  branch_name text not null,
  bank_address text not null default '',
  bank_city text not null default '',
  bank_state text not null default '',
  upi_id text,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.artist_payout_accounts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.artist_payout_accounts add column if not exists account_holder_name text not null default '';
alter table public.artist_payout_accounts add column if not exists bank_account_number_encrypted text not null default '';
alter table public.artist_payout_accounts add column if not exists bank_account_number_masked text not null default '';
alter table public.artist_payout_accounts add column if not exists ifsc_code text not null default '';
alter table public.artist_payout_accounts add column if not exists bank_name text not null default '';
alter table public.artist_payout_accounts add column if not exists branch_name text not null default '';
alter table public.artist_payout_accounts add column if not exists bank_address text not null default '';
alter table public.artist_payout_accounts add column if not exists bank_city text not null default '';
alter table public.artist_payout_accounts add column if not exists bank_state text not null default '';
alter table public.artist_payout_accounts add column if not exists upi_id text;
alter table public.artist_payout_accounts add column if not exists verified_at timestamptz;
alter table public.artist_payout_accounts add column if not exists created_at timestamptz not null default now();
alter table public.artist_payout_accounts add column if not exists updated_at timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- Per-origin Shiprocket records. One parent Razorpay checkout can have many
-- shipment rows, one per Artist pickup location.
-- -----------------------------------------------------------------------------
create table if not exists public.order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  group_key text not null,
  group_index integer not null default 1,
  artist_id uuid references public.artists(id) on delete set null,
  artist_name text not null default 'Artiste Studio',
  pickup_contact_name text not null default '',
  pickup_phone text not null default '',
  pickup_address text not null default '',
  pickup_landmark text not null default '',
  pickup_locality text not null default '',
  pickup_city text not null default '',
  pickup_state text not null default '',
  pickup_pincode text not null,
  pickup_location text not null default 'Primary',
  payout_info jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  package_weight_kg numeric(9,3) not null,
  package_length_cm numeric(9,2) not null,
  package_breadth_cm numeric(9,2) not null,
  package_height_cm numeric(9,2) not null,
  courier_id integer not null,
  courier_name text not null,
  shipping_amount numeric(12,2) not null default 0,
  shiprocket_reference text,
  shiprocket_order_id text,
  shiprocket_shipment_id text,
  awb_code text,
  shipment_status text not null default 'Pending',
  shipment_note text,
  shipment_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, group_key)
);
alter table public.order_shipments add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.order_shipments add column if not exists group_key text not null default '';
alter table public.order_shipments add column if not exists group_index integer not null default 1;
alter table public.order_shipments add column if not exists artist_id uuid references public.artists(id) on delete set null;
alter table public.order_shipments add column if not exists artist_name text not null default 'Artiste Studio';
alter table public.order_shipments add column if not exists pickup_contact_name text not null default '';
alter table public.order_shipments add column if not exists pickup_phone text not null default '';
alter table public.order_shipments add column if not exists pickup_address text not null default '';
alter table public.order_shipments add column if not exists pickup_landmark text not null default '';
alter table public.order_shipments add column if not exists pickup_locality text not null default '';
alter table public.order_shipments add column if not exists pickup_city text not null default '';
alter table public.order_shipments add column if not exists pickup_state text not null default '';
alter table public.order_shipments add column if not exists pickup_pincode text not null default '';
alter table public.order_shipments add column if not exists pickup_location text not null default 'Primary';
alter table public.order_shipments add column if not exists payout_info jsonb not null default '{}'::jsonb;
alter table public.order_shipments add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.order_shipments add column if not exists package_weight_kg numeric(9,3) not null default 0;
alter table public.order_shipments add column if not exists package_length_cm numeric(9,2) not null default 0;
alter table public.order_shipments add column if not exists package_breadth_cm numeric(9,2) not null default 0;
alter table public.order_shipments add column if not exists package_height_cm numeric(9,2) not null default 0;
alter table public.order_shipments add column if not exists courier_id integer not null default 0;
alter table public.order_shipments add column if not exists courier_name text not null default '';
alter table public.order_shipments add column if not exists shipping_amount numeric(12,2) not null default 0;
alter table public.order_shipments add column if not exists shiprocket_reference text;
alter table public.order_shipments add column if not exists shiprocket_order_id text;
alter table public.order_shipments add column if not exists shiprocket_shipment_id text;
alter table public.order_shipments add column if not exists awb_code text;
alter table public.order_shipments add column if not exists shipment_status text not null default 'Pending';
alter table public.order_shipments add column if not exists shipment_note text;
alter table public.order_shipments add column if not exists shipment_claimed_at timestamptz;
alter table public.order_shipments add column if not exists created_at timestamptz not null default now();
alter table public.order_shipments add column if not exists updated_at timestamptz not null default now();
create unique index if not exists order_shipments_order_group_uidx on public.order_shipments(order_id, group_key);
create index if not exists order_shipments_order_idx on public.order_shipments(order_id, group_index);
create index if not exists order_shipments_artist_idx on public.order_shipments(artist_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Payment and shipment RPCs. These SECURITY DEFINER functions are callable only
-- by service_role; all order mutations happen after a server-verified payment.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_artiste_payment(p_order_id uuid, p_payment_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders%rowtype;
  artwork_ids uuid[];
  requested_count integer;
  available_count integer;
begin
  select * into current_order from public.orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if current_order.status = 'Paid' then
    if current_order.razorpay_payment_id is not null and current_order.razorpay_payment_id <> p_payment_id then return 'payment_mismatch'; end if;
    update public.orders set razorpay_payment_id = coalesce(razorpay_payment_id, p_payment_id), paid_at = coalesce(paid_at, now()) where id = p_order_id;
    return 'already_paid';
  end if;
  if current_order.status <> 'Pending' then return 'conflict'; end if;

  select array_agg((item->>'id')::uuid) into artwork_ids
  from jsonb_array_elements(coalesce(current_order.items, '[]'::jsonb)) as x(item)
  where coalesce(x.item->>'id', '') <> '';
  if artwork_ids is null or cardinality(artwork_ids) = 0 then
    begin artwork_ids := array[current_order.painting_id::uuid];
    exception when others then return 'conflict'; end;
  end if;

  -- Lock all requested stock rows in a stable order so concurrent captures
  -- cannot sell more copies than the creator has actually listed.
  perform id from public.paintings where id = any(artwork_ids) order by id for update;
  select count(*) into requested_count from (select distinct unnest(artwork_ids) as id) requested;
  select count(*) into available_count
  from public.paintings p
  where p.id = any(artwork_ids)
    and p.is_approved = true
    and p.stock_quantity >= (
      select count(*) from unnest(artwork_ids) requested_id where requested_id = p.id
    );
  if available_count <> requested_count then
    update public.orders set status = 'Payment conflict', razorpay_payment_id = p_payment_id, shipment_status = 'Manual review', shipment_note = 'Payment captured but one or more artworks had insufficient stock or were unavailable. Refund review required.' where id = p_order_id;
    return 'conflict';
  end if;

  update public.paintings p
  set stock_quantity = greatest(0, p.stock_quantity - requested.quantity),
      is_sold = (p.stock_quantity - requested.quantity) <= 0
  from (
    select requested_id as id, count(*)::integer as quantity
    from unnest(artwork_ids) requested_id
    group by requested_id
  ) requested
  where p.id = requested.id;

  update public.orders set status = 'Paid', razorpay_payment_id = p_payment_id, paid_at = coalesce(paid_at, now()), shipment_status = 'Dispatch processing' where id = p_order_id;
  return 'paid';
end;
$$;
revoke all on function public.confirm_artiste_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_artiste_payment(uuid, text) to service_role;

create or replace function public.claim_artiste_order_shipment(p_shipment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed_count integer;
begin
  update public.order_shipments s
  set shipment_claimed_at = now(), shipment_status = 'Creating', updated_at = now()
  where s.id = p_shipment_id
    and s.shiprocket_order_id is null
    and s.shiprocket_shipment_id is null
    and (s.shipment_claimed_at is null or s.shipment_claimed_at < now() - interval '15 minutes')
    and exists (select 1 from public.orders o where o.id = s.order_id and o.status = 'Paid');
  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;
revoke all on function public.claim_artiste_order_shipment(uuid) from public, anon, authenticated;
grant execute on function public.claim_artiste_order_shipment(uuid) to service_role;

create or replace function public.set_artiste_payout_status(p_payout_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target_order uuid; updated_count integer; eligible_at timestamptz;
begin
  if p_status not in ('Pending', 'Paid') then return false; end if;
  select order_id, payout_available_at into target_order, eligible_at from public.artist_payouts where id = p_payout_id for update;
  if target_order is null then return false; end if;
  if p_status = 'Paid' and (eligible_at is null or eligible_at > now()) then
    raise exception 'Artist payout becomes eligible 48 hours after the shipment is marked Delivered.';
  end if;
  update public.artist_payouts set payout_status = p_status, paid_at = case when p_status = 'Paid' then coalesce(paid_at, now()) else null end where id = p_payout_id;
  select count(*) into updated_count from public.artist_payouts where order_id = target_order and payout_status <> 'Paid';
  update public.orders set payout_status = case when updated_count = 0 then 'Paid' else 'Pending' end where id = target_order;
  return true;
end;
$$;
revoke all on function public.set_artiste_payout_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_artiste_payout_status(uuid, text) to service_role;

-- A Customer's verified Auth identity gets a private profile automatically.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', '')) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_artiste on auth.users;
create trigger on_auth_user_created_artiste
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Helper for ownership checks in RLS. No Artist private row is exposed to callers.
create or replace function public.current_user_owns_artist(p_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.artists a where a.id = p_artist_id and a.user_id = auth.uid());
$$;
revoke all on function public.current_user_owns_artist(uuid) from public, anon;
grant execute on function public.current_user_owns_artist(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guard columns that Artists must never self-approve or reassign. Server routes
-- use service_role after validating the Supabase JWT and are exempt from these
-- auth.uid()-based client protections.
-- -----------------------------------------------------------------------------
create or replace function public.guard_artiste_artist_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.user_id <> auth.uid() then raise exception 'Artist profile ownership mismatch'; end if;
    new.is_approved := false;
  else
    if old.user_id <> auth.uid() or new.user_id <> old.user_id then raise exception 'Artists can only update their own profile'; end if;
    if new.is_approved is distinct from old.is_approved then raise exception 'Only the Artiste owner can activate an Artist profile'; end if;
    if new.is_suspended is distinct from old.is_suspended then raise exception 'Only the Artiste owner can suspend an Artist account'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_artiste_artist_write_trigger on public.artists;
create trigger guard_artiste_artist_write_trigger before insert or update on public.artists for each row execute function public.guard_artiste_artist_write();

create or replace function public.guard_artiste_painting_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare owner_name text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    select artist_name into owner_name from public.artists where id = new.artist_id and user_id = auth.uid();
    if owner_name is null then raise exception 'Artists can only list artworks under their own Artist profile'; end if;
    new.artist_name := owner_name;
    new.is_sold := false;
    new.is_approved := false;
    new.pickup_pincode := null;
    new.pickup_location := 'Primary';
  else
    if not public.current_user_owns_artist(old.artist_id) then raise exception 'Artists can only update their own artworks'; end if;
    if new.artist_id is distinct from old.artist_id then raise exception 'Artwork ownership cannot be changed'; end if;
    if new.is_approved is distinct from old.is_approved then raise exception 'Only the Artiste owner can approve artwork'; end if;
    if old.is_sold and not new.is_sold then raise exception 'Sold artwork cannot be made available by an Artist'; end if;
    new.artist_name := old.artist_name;
    new.pickup_pincode := null;
    new.pickup_location := 'Primary';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_artiste_painting_write_trigger on public.paintings;
create trigger guard_artiste_painting_write_trigger before insert or update on public.paintings for each row execute function public.guard_artiste_painting_write();

-- -----------------------------------------------------------------------------
-- Strict Row Level Security. Table grants are broad per the project deployment
-- contract; the policies below decide which rows each role can actually access.
-- Sensitive Artist pickup and payout data are kept off the public paintings row.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.artists enable row level security;
alter table public.paintings enable row level security;
alter table public.orders enable row level security;
alter table public.artist_payouts enable row level security;
alter table public.artist_payout_accounts enable row level security;
alter table public.painting_shipping_origins enable row level security;
alter table public.order_shipments enable row level security;

-- Remove every prior policy on these tables. This is deliberately name-agnostic so
-- an old, permissive policy cannot survive a version upgrade and broaden access.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'artists', 'paintings', 'orders',
                        'artist_payouts', 'artist_payout_accounts',
                        'painting_shipping_origins', 'order_shipments')
  loop
    execute format('drop policy if exists %I on %I.%I',
                   policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

-- Public Artist showcase and portfolio pages need read access to Artist records.
-- The public pages select only the public profile projection; private payout and
-- pickup details remain in separate restricted tables / server-only endpoints.
drop policy if exists "Public can view artists" on public.artists;
create policy "Public can view artists" on public.artists for select using (true);

-- Remove policies from earlier deployments that were broader than current privacy requirements.
drop policy if exists "Public can read approved artist profiles" on public.artists;
drop policy if exists "artists_read_approved_or_own" on public.artists;
drop policy if exists "artists_read_own" on public.artists;
drop policy if exists "artists_insert_own" on public.artists;
drop policy if exists "artists_update_own" on public.artists;
drop policy if exists "artists_delete_own" on public.artists;
drop policy if exists artists_select_own on public.artists;
drop policy if exists artists_insert_own on public.artists;
drop policy if exists artists_update_own on public.artists;
drop policy if exists artists_delete_own on public.artists;
create policy artists_select_own on public.artists for select to authenticated using (auth.uid() = user_id);
create policy artists_insert_own on public.artists for insert to authenticated with check (auth.uid() = user_id);
create policy artists_update_own on public.artists for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy artists_delete_own on public.artists for delete to authenticated using (auth.uid() = user_id and is_approved = false);

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "paintings_public_read_available" on public.paintings;
drop policy if exists "paintings_artist_read_own" on public.paintings;
drop policy if exists "paintings_artist_insert_own" on public.paintings;
drop policy if exists "paintings_artist_update_own" on public.paintings;
drop policy if exists "paintings_artist_delete_own_unsold" on public.paintings;
drop policy if exists paintings_public_read_available on public.paintings;
drop policy if exists paintings_artist_read_own on public.paintings;
drop policy if exists paintings_artist_insert_own on public.paintings;
drop policy if exists paintings_artist_update_own on public.paintings;
drop policy if exists paintings_artist_delete_own_unsold on public.paintings;
create policy paintings_public_read_available on public.paintings for select to anon, authenticated using (is_approved = true and is_sold = false);
create policy paintings_artist_read_own on public.paintings for select to authenticated using (public.current_user_owns_artist(artist_id));
create policy paintings_artist_insert_own on public.paintings for insert to authenticated with check (public.current_user_owns_artist(artist_id));
create policy paintings_artist_update_own on public.paintings for update to authenticated using (public.current_user_owns_artist(artist_id)) with check (public.current_user_owns_artist(artist_id));
create policy paintings_artist_delete_own_unsold on public.paintings for delete to authenticated using (is_sold = false and public.current_user_owns_artist(artist_id));

drop policy if exists orders_customer_read_own on public.orders;
drop policy if exists orders_select_own on public.orders;
drop policy if exists orders_read_own on public.orders;
-- No browser SELECT policy on orders: /api/account validates OTP identity and
-- returns an explicit Customer-safe projection without private commission fields.
-- Server-side order/payment/admin routes use service_role and bypass RLS.

drop policy if exists artist_payouts_artist_read_own on public.artist_payouts;
create policy artist_payouts_artist_read_own on public.artist_payouts for select to authenticated using (public.current_user_owns_artist(artist_id));

drop policy if exists artist_payout_accounts_select_own on public.artist_payout_accounts;
create policy artist_payout_accounts_select_own on public.artist_payout_accounts for select to authenticated using (auth.uid() = user_id and public.current_user_owns_artist(artist_id));
-- No anon/authenticated policies exist on painting_shipping_origins or order_shipments.
-- Server-side APIs only access them through SUPABASE_SERVICE_ROLE_KEY.

-- Required table grants. RLS remains enabled and mandatory; no Customer receives
-- another Customer's rows, no Artist receives another Artist's records, and the
-- private dispatch / account tables have no browser-readable policies.
grant all privileges on table public.paintings, public.orders, public.artists, public.profiles to anon, authenticated, service_role;
-- Artist rows contain private email and studio pickup/contact fields. Keep the
-- requested public SELECT RLS policy, but let browser roles read only public
-- profile columns. Server routes using service_role retain full access.
revoke select on table public.artists from anon, authenticated;
revoke select (user_id, email, profile_photo_url, pickup_address, pickup_contact_name, pickup_phone, pickup_landmark, pickup_locality, pickup_pincode, pickup_location) on table public.artists from anon, authenticated;
grant select (id, artist_name, bio, city, state, avatar_url, creator_role, is_approved, is_suspended, created_at, updated_at) on table public.artists to anon, authenticated;
-- TRUNCATE bypasses row-level security. Keep CRUD grants as requested, but never
-- expose table-wide destructive / trigger privileges to browser roles.
revoke truncate, references, trigger on table public.paintings, public.orders, public.artists, public.profiles from anon, authenticated;
grant all privileges on table public.artist_payouts, public.artist_payout_accounts to authenticated, service_role;
grant all privileges on table public.painting_shipping_origins, public.order_shipments to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Public image delivery only. All storage uploads/removals are routed through
-- JWT-validated server endpoints using the service-role key.
insert into storage.buckets(id, name, public) values ('paintings', 'paintings', true) on conflict (id) do update set public = true;
insert into storage.buckets(id, name, public) values ('artist-profiles', 'artist-profiles', true) on conflict (id) do update set public = true;
drop policy if exists "Public can view painting images" on storage.objects;
create policy "Public can view painting images" on storage.objects for select to anon, authenticated using (bucket_id = 'paintings');
drop policy if exists "Public can view artist profile images" on storage.objects;
create policy "Public can view artist profile images" on storage.objects for select to anon, authenticated using (bucket_id = 'artist-profiles');

-- V4 signup metadata is written when a new verified Supabase Auth identity is created.
-- Existing populated profile fields are never overwritten by this trigger.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do update
    set email = case when coalesce(excluded.email, '') <> '' then excluded.email else profiles.email end,
        full_name = case when coalesce(profiles.full_name, '') = '' then excluded.full_name else profiles.full_name end,
        phone = case when coalesce(profiles.phone, '') = '' then excluded.phone else profiles.phone end;
  return new;
end;
$$;

-- Customer / Artist email verification is performed by Artiste's SMTP-backed
-- numeric OTP routes. No Supabase email confirmation template or redirect URL
-- is required for the in-page signup/login flow.

-- -----------------------------------------------------------------------------
-- Artiste in-page email OTPs (no customer-facing magic links or redirects)
-- -----------------------------------------------------------------------------
create table if not exists public.email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  account_type text not null check (account_type in ('customer', 'artist')),
  purpose text not null check (purpose in ('login', 'signup')),
  otp_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  ip_hash text,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table public.email_otps add column if not exists email text;
alter table public.email_otps add column if not exists account_type text;
alter table public.email_otps add column if not exists purpose text;
alter table public.email_otps add column if not exists otp_hash text;
alter table public.email_otps add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.email_otps add column if not exists expires_at timestamptz;
alter table public.email_otps add column if not exists attempts integer not null default 0;
alter table public.email_otps add column if not exists ip_hash text;
alter table public.email_otps add column if not exists created_at timestamptz not null default now();
alter table public.email_otps add column if not exists used_at timestamptz;

create index if not exists email_otps_email_flow_created_idx
  on public.email_otps (lower(email), account_type, purpose, created_at desc);
create index if not exists email_otps_ip_created_idx
  on public.email_otps (ip_hash, created_at desc);
create index if not exists email_otps_expiry_idx
  on public.email_otps (expires_at);

alter table public.email_otps enable row level security;
drop policy if exists email_otps_no_browser_access on public.email_otps;
-- Deliberately create no anon/authenticated policy. Only server API routes using
-- SUPABASE_SERVICE_ROLE_KEY can read or mutate OTP records.
revoke all privileges on table public.email_otps from public, anon, authenticated;
grant all privileges on table public.email_otps to service_role;

-- Consume a code atomically, under a row lock, so simultaneous requests cannot
-- verify the same code twice. Five wrong attempts burn the issued code.
create or replace function public.consume_email_otp(
  p_email text,
  p_account_type text,
  p_purpose text,
  p_otp_hash text
)
returns table(is_valid boolean, payload jsonb, attempts_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_otp public.email_otps%rowtype;
  v_attempts_left integer;
begin
  select * into v_otp
  from public.email_otps e
  where lower(e.email) = lower(p_email)
    and e.account_type = p_account_type
    and e.purpose = p_purpose
    and e.used_at is null
    and e.expires_at > now()
  order by e.created_at desc
  limit 1
  for update;

  if not found then
    return query select false, '{}'::jsonb, 0;
    return;
  end if;

  if v_otp.attempts >= 5 then
    update public.email_otps set used_at = now() where id = v_otp.id;
    return query select false, '{}'::jsonb, 0;
    return;
  end if;

  if v_otp.otp_hash <> p_otp_hash then
    update public.email_otps
      set attempts = attempts + 1,
          used_at = case when attempts + 1 >= 5 then now() else used_at end
      where id = v_otp.id;
    v_attempts_left := greatest(4 - v_otp.attempts, 0);
    return query select false, '{}'::jsonb, v_attempts_left;
    return;
  end if;

  update public.email_otps set used_at = now() where id = v_otp.id;
  return query select true, coalesce(v_otp.metadata, '{}'::jsonb), greatest(5 - v_otp.attempts, 0);
end;
$$;

revoke all on function public.consume_email_otp(text, text, text, text) from public, anon, authenticated;
grant execute on function public.consume_email_otp(text, text, text, text) to service_role;

-- OTP rows are temporary. The send endpoint opportunistically prunes expired
-- records older than one day using service_role; no scheduled job is required.

-- Version 5 delivery-mode convention (no schema change required):
-- order_shipments.courier_id = -101 means Artiste same-zone local economy delivery;
-- order_shipments.courier_id = -102 means free Artist studio collection.
-- These reserved negative values are handled by the application and are never
-- submitted to Shiprocket as real courier-company IDs.
comment on column public.order_shipments.courier_id is
  'Shiprocket courier ID; reserved -101 = Artiste local economy, -102 = free studio collection.';
comment on column public.orders.courier_id is
  'Primary courier ID or Artiste reserved synthetic local delivery / studio pickup ID.';


-- =============================================================================
-- Artiste V8: creator roles, role-based commission, finite stock and bill IDs.
-- Additive and safe to re-run. Existing paintings remain Painter / Painting by
-- default; existing sold works migrate to zero stock and can be restocked later.
-- =============================================================================

alter table public.artists add column if not exists creator_role text;
update public.artists set creator_role = 'Painter' where creator_role is null or creator_role not in ('Painter', 'Photographer');
alter table public.artists alter column creator_role set default 'Painter';
alter table public.artists alter column creator_role set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'artists_creator_role_check') then
    alter table public.artists add constraint artists_creator_role_check check (creator_role in ('Painter', 'Photographer'));
  end if;
end $$;

alter table public.paintings add column if not exists stock_quantity integer;
update public.paintings set stock_quantity = case when is_sold then 0 else 1 end where stock_quantity is null;
alter table public.paintings alter column stock_quantity set default 1;
alter table public.paintings alter column stock_quantity set not null;
alter table public.paintings add column if not exists edition_details text not null default '';
alter table public.paintings add column if not exists print_details text not null default '';
-- Preserve any legacy SOLD OUT marker during migration; stock quantity takes
-- over as the source of truth after the initial backfill.
update public.paintings set stock_quantity = 0 where is_sold = true and stock_quantity > 0;
update public.paintings set is_sold = (stock_quantity <= 0);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'paintings_stock_quantity_nonnegative') then
    alter table public.paintings add constraint paintings_stock_quantity_nonnegative check (stock_quantity >= 0);
  end if;
end $$;
create index if not exists paintings_stock_available_idx on public.paintings(is_approved, stock_quantity, created_at desc);

alter table public.artist_payouts add column if not exists creator_role text not null default 'Painter';
alter table public.artist_payouts add column if not exists commission_rate numeric(5,4) not null default 0.2500;
update public.artist_payouts ap set
  creator_role = coalesce(a.creator_role, 'Painter')
from public.artists a where ap.artist_id = a.id;

-- Store a stable Bill of Supply number on the paid order itself. The sequence is
-- private implementation state; no user-facing table grant is added for it.
create sequence if not exists public.artiste_bill_number_seq;
alter table public.orders add column if not exists bill_number text;
with missing as (
  select id, created_at, nextval('public.artiste_bill_number_seq') as seq_no
  from public.orders where bill_number is null order by created_at asc, id asc
)
update public.orders o
set bill_number = 'BOS-AR-' || to_char(o.created_at at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(missing.seq_no::text, 7, '0')
from missing where o.id = missing.id;
create unique index if not exists orders_bill_number_uidx on public.orders(bill_number) where bill_number is not null;
create or replace function public.assign_artiste_bill_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.bill_number is null or btrim(new.bill_number) = '' then
    new.bill_number := 'BOS-AR-' || to_char(coalesce(new.created_at, now()) at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.artiste_bill_number_seq')::text, 7, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists assign_artiste_bill_number_trigger on public.orders;
create trigger assign_artiste_bill_number_trigger before insert on public.orders for each row execute function public.assign_artiste_bill_number();
revoke all on function public.assign_artiste_bill_number() from public, anon, authenticated;
grant usage, select on sequence public.artiste_bill_number_seq to service_role;

-- Recreate the payment RPC with atomic quantity deduction (one unit per line
-- item in this cart implementation) and idempotent paid-order handling.
create or replace function public.confirm_artiste_payment(p_order_id uuid, p_payment_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders%rowtype;
  artwork_ids uuid[];
  requested_count integer;
  available_count integer;
begin
  select * into current_order from public.orders where id = p_order_id for update;
  if not found then return 'not_found'; end if;
  if current_order.status = 'Paid' then
    if current_order.razorpay_payment_id is not null and current_order.razorpay_payment_id <> p_payment_id then return 'payment_mismatch'; end if;
    update public.orders set razorpay_payment_id = coalesce(razorpay_payment_id, p_payment_id), paid_at = coalesce(paid_at, now()) where id = p_order_id;
    return 'already_paid';
  end if;
  if current_order.status <> 'Pending' then return 'conflict'; end if;

  select array_agg((item->>'id')::uuid) into artwork_ids
  from jsonb_array_elements(coalesce(current_order.items, '[]'::jsonb)) as x(item)
  where coalesce(x.item->>'id', '') <> '';
  if artwork_ids is null or cardinality(artwork_ids) = 0 then
    begin artwork_ids := array[current_order.painting_id::uuid];
    exception when others then return 'conflict'; end;
  end if;

  -- Lock all requested stock rows in a stable order so concurrent captures
  -- cannot sell more copies than the creator has actually listed.
  perform id from public.paintings where id = any(artwork_ids) order by id for update;
  select count(*) into requested_count from (select distinct unnest(artwork_ids) as id) requested;
  select count(*) into available_count
  from public.paintings p
  where p.id = any(artwork_ids)
    and p.is_approved = true
    and p.stock_quantity >= (
      select count(*) from unnest(artwork_ids) requested_id where requested_id = p.id
    );
  if available_count <> requested_count then
    update public.orders set status = 'Payment conflict', razorpay_payment_id = p_payment_id, shipment_status = 'Manual review', shipment_note = 'Payment captured but one or more artworks had insufficient stock or were unavailable. Refund review required.' where id = p_order_id;
    return 'conflict';
  end if;

  update public.paintings p
  set stock_quantity = greatest(0, p.stock_quantity - requested.quantity),
      is_sold = (p.stock_quantity - requested.quantity) <= 0
  from (
    select requested_id as id, count(*)::integer as quantity
    from unnest(artwork_ids) requested_id
    group by requested_id
  ) requested
  where p.id = requested.id;

  update public.orders set status = 'Paid', razorpay_payment_id = p_payment_id, paid_at = coalesce(paid_at, now()), shipment_status = 'Dispatch processing' where id = p_order_id;
  return 'paid';
end;
$$;

revoke all on function public.confirm_artiste_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_artiste_payment(uuid, text) to service_role;

-- =============================================================================
-- V9: atomic, shared API rate-limits for multi-instance/serverless deployments.
-- The identifier stored here is an HMAC of scope + client address, not a raw IP.
-- =============================================================================
create table if not exists public.api_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.api_rate_limits add column if not exists key_hash text;
alter table public.api_rate_limits add column if not exists window_started_at timestamptz not null default now();
alter table public.api_rate_limits add column if not exists request_count integer not null default 0;
alter table public.api_rate_limits add column if not exists updated_at timestamptz not null default now();
create index if not exists api_rate_limits_updated_idx on public.api_rate_limits(updated_at);

alter table public.api_rate_limits enable row level security;
drop policy if exists api_rate_limits_no_browser_access on public.api_rate_limits;
revoke all privileges on table public.api_rate_limits from public, anon, authenticated;
grant all privileges on table public.api_rate_limits to service_role;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started_at timestamptz;
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 10000));
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 60), 86400));
begin
  if p_key_hash is null or length(p_key_hash) <> 64 or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key.';
  end if;

  insert into public.api_rate_limits as existing (key_hash, window_started_at, request_count, updated_at)
  values (p_key_hash, v_now, 1, v_now)
  on conflict (key_hash) do update
  set window_started_at = case
        when existing.window_started_at <= v_now - make_interval(secs => v_window) then v_now
        else existing.window_started_at
      end,
      request_count = case
        when existing.window_started_at <= v_now - make_interval(secs => v_window) then 1
        else existing.request_count + 1
      end,
      updated_at = v_now
  returning existing.window_started_at, existing.request_count
  into v_started_at, v_count;

  -- Keep this table bounded without a scheduled job.
  if random() < 0.002 then
    delete from public.api_rate_limits where updated_at < v_now - interval '2 days';
  end if;

  return query select
    v_count <= v_limit,
    greatest(1, ceil(extract(epoch from (v_started_at + make_interval(secs => v_window) - v_now)))::integer),
    greatest(0, v_limit - v_count);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;


-- -----------------------------------------------------------------------------
-- Artiste V15: founder status, optional payout onboarding, applications,
-- multi-image artworks, presentation metadata and delivery-based payout dates.
-- This section is additive and safe to re-run.
-- -----------------------------------------------------------------------------

-- Optional artist profile fields may be left blank during registration.
alter table public.artists alter column email drop not null;
alter table public.artists alter column email set default '';
alter table public.artists alter column profile_photo_url drop not null;
alter table public.artists alter column profile_photo_url set default '';
alter table public.artists alter column avatar_url drop not null;
alter table public.artists alter column avatar_url set default '';
alter table public.artists alter column bio drop not null;
alter table public.artists alter column bio set default '';
alter table public.artists alter column city drop not null;
alter table public.artists alter column city set default '';
alter table public.artists alter column state drop not null;
alter table public.artists alter column state set default '';
alter table public.artists alter column pickup_address drop not null;
alter table public.artists alter column pickup_address set default '';
alter table public.artists alter column pickup_contact_name drop not null;
alter table public.artists alter column pickup_contact_name set default '';
alter table public.artists alter column pickup_phone drop not null;
alter table public.artists alter column pickup_phone set default '';
alter table public.artists alter column pickup_landmark drop not null;
alter table public.artists alter column pickup_landmark set default '';
alter table public.artists alter column pickup_locality drop not null;
alter table public.artists alter column pickup_locality set default '';
alter table public.artists alter column pickup_pincode drop not null;
alter table public.artists alter column pickup_pincode set default '';
alter table public.artists alter column pickup_location drop not null;
alter table public.artists alter column pickup_location set default 'Primary';

alter table public.artists add column if not exists approved boolean not null default false;
alter table public.artists add column if not exists phone text default '';
alter table public.artists alter column phone drop not null;
alter table public.artists alter column phone set default '';
alter table public.artists add column if not exists is_founding_artist boolean not null default false;
alter table public.artists add column if not exists instagram_handle text default '';
alter table public.artists add column if not exists whatsapp_number text default '';
alter table public.artists add column if not exists latest_application_id uuid;

-- Founding Artist status is now granted only through an explicit Host / Owner
-- approval. Preserve existing designations, but never auto-designate new accounts.
drop trigger if exists artiste_initial_founding_artist on public.artists;
drop function if exists public.artiste_assign_initial_founding_artist();

alter table public.paintings add column if not exists gallery_images jsonb default '[]'::jsonb;
alter table public.paintings add column if not exists framed_status text default 'Unframed';
alter table public.paintings add column if not exists dimensions text default '';
alter table public.paintings add column if not exists certificate_id text default '';
alter table public.paintings add column if not exists description text default '';
update public.paintings set gallery_images = jsonb_build_array(image_url)
where (gallery_images is null or gallery_images = '[]'::jsonb) and coalesce(image_url, '') <> '';
update public.paintings set framed_status = 'Unframed' where coalesce(framed_status, '') = '';
update public.paintings set certificate_id = 'ART-COA-' || upper(substr(replace(id::text, '-', ''), 1, 12))
where coalesce(certificate_id, '') = '';

create table if not exists public.artist_applications (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null,
  studio_name text not null,
  whatsapp_number text not null,
  instagram_handle text not null default '',
  city text not null,
  pincode text not null,
  art_style_bio text not null,
  artwork_title text,
  artwork_medium text,
  artwork_dimensions text,
  framed_status text default 'Unframed',
  desired_artist_payout numeric(12,2),
  artwork_photos jsonb not null default '[]'::jsonb,
  agreements jsonb not null,
  application_status text not null default 'Pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.artist_applications add column if not exists email text not null default '';
alter table public.artist_applications alter column artwork_title drop not null;
alter table public.artist_applications alter column artwork_medium drop not null;
alter table public.artist_applications alter column artwork_dimensions drop not null;
alter table public.artist_applications alter column desired_artist_payout drop not null;
alter table public.artist_applications alter column application_status set default 'Pending';
create index if not exists artist_applications_artist_idx
  on public.artist_applications(artist_id, created_at desc);
create index if not exists artist_applications_user_idx
  on public.artist_applications(user_id, created_at desc);

alter table public.order_shipments add column if not exists delivered_at timestamptz;
alter table public.artist_payouts add column if not exists delivered_at timestamptz;
alter table public.artist_payouts add column if not exists payout_available_at timestamptz;

alter table public.artist_applications enable row level security;
revoke all on public.artist_applications from anon, authenticated;
grant all on public.artist_applications to service_role;

-- Payouts become eligible 48 hours after a verified courier Delivered event.
-- Transfer remains a manual owner action, never an automatic bank debit/credit.
create or replace function public.artiste_mark_shipment_delivered(p_shipment_id uuid, p_delivered_at timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
  target_artist uuid;
  delivered_time timestamptz;
begin
  delivered_time := coalesce(p_delivered_at, now());
  update public.order_shipments
    set delivered_at = coalesce(delivered_at, delivered_time),
        shipment_status = 'Delivered',
        updated_at = now()
    where id = p_shipment_id
    returning order_id, artist_id, delivered_at into target_order, target_artist, delivered_time;
  if target_order is null then return false; end if;
  update public.artist_payouts
    set delivered_at = coalesce(delivered_at, delivered_time),
        payout_available_at = coalesce(payout_available_at, delivered_time + interval '48 hours')
    where order_id = target_order
      and (target_artist is null or artist_id = target_artist);
  return true;
end;
$$;
revoke all on function public.artiste_mark_shipment_delivered(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.artiste_mark_shipment_delivered(uuid, timestamptz) to service_role;


-- V15 account identity: one authenticated user may own separate Painter and
-- Photographer studios, matching the API's user_id + creator_role upsert key.
drop index if exists public.artists_user_id_uidx;
create unique index if not exists artists_user_id_creator_role_uidx
  on public.artists(user_id, creator_role);

-- Completed order commission snapshots are historical accounting records and must not be recalculated.

-- -----------------------------------------------------------------------------
-- V17: dynamic commission tiers, verifiable payout receipts, and double-entry GL
-- This migration is additive and preserves historical payout snapshots.
-- -----------------------------------------------------------------------------

alter table public.artists add column if not exists commission_rate numeric(5,4) not null default 0.2500;
update public.artists set commission_rate = case when is_founding_artist then 0.2000 else 0.2500 end;

alter table public.artist_applications add column if not exists agreement_texts jsonb not null default '{}'::jsonb;
alter table public.artist_applications add column if not exists approval_tier text;
alter table public.artist_applications add column if not exists approved_at timestamptz;
alter table public.artist_applications add column if not exists commission_rate numeric(5,4);
update public.artist_applications a
set approval_tier = case when coalesce(ar.is_founding_artist, false) then '80/20' else '75/25' end,
    commission_rate = case when coalesce(ar.is_founding_artist, false) then 0.2000 else 0.2500 end,
    approved_at = coalesce(a.approved_at, a.updated_at, a.created_at)
from public.artists ar
where ar.id = a.artist_id
  and lower(coalesce(a.application_status, '')) = 'approved'
  and (a.approval_tier is null or a.commission_rate is null or a.approved_at is null);

alter table public.artist_payouts add column if not exists payout_paid_amount numeric(12,2) not null default 0;
alter table public.artist_payouts add column if not exists payout_utr text not null default '';
alter table public.artist_payouts add column if not exists payout_proof_url text;
alter table public.artist_payouts add column if not exists payout_paid_at timestamptz;
alter table public.artist_payouts alter column payout_status set default 'pending';
do $$
begin
  alter table public.artist_payouts drop constraint if exists artist_payouts_payout_status_check;
  if not exists (select 1 from pg_constraint where conname = 'artist_payouts_payout_status_v17_check') then
    alter table public.artist_payouts add constraint artist_payouts_payout_status_v17_check
      check (payout_status in ('pending', 'part_paid', 'paid', 'Pending', 'Paid'));
  end if;
end $$;

-- The application approval itself assigns the tier under an advisory transaction lock.
-- Existing founder flags count toward the original ten reserved slots.
create or replace function public.artiste_approve_founding_application(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.artist_applications%rowtype;
  approved_founders integer;
  next_rate numeric(5,4);
  next_tier text;
  approval_time timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('artiste_v17_founding_artist_tier_allocation'));
  select * into target from public.artist_applications where id = p_application_id for update;
  if target.id is null then raise exception 'Founding Artist application not found.'; end if;
  if lower(coalesce(target.application_status, '')) not in ('pending', 'submitted') then
    raise exception 'This application has already been reviewed.';
  end if;

  select count(*)::integer into approved_founders from public.artists where is_founding_artist = true;
  if approved_founders < 10 then
    next_rate := 0.2000;
    next_tier := '80/20';
  else
    next_rate := 0.2500;
    next_tier := '75/25';
  end if;

  update public.artist_applications
    set application_status = 'approved',
        approval_tier = next_tier,
        commission_rate = next_rate,
        approved_at = approval_time,
        updated_at = approval_time
    where id = p_application_id;

  update public.artists
    set is_founding_artist = (next_tier = '80/20'),
        commission_rate = next_rate,
        approved = true,
        is_approved = true,
        is_suspended = false,
        updated_at = approval_time
    where id = target.artist_id;
  if not found then raise exception 'The Artist profile linked to this application no longer exists.'; end if;

  return jsonb_build_object(
    'application_id', p_application_id,
    'artist_id', target.artist_id,
    'approval_tier', next_tier,
    'commission_rate', next_rate,
    'approved_at', approval_time,
    'founding_slots_filled', case when next_tier = '80/20' then approved_founders + 1 else least(approved_founders, 10) end
  );
end;
$$;
revoke all on function public.artiste_approve_founding_application(uuid) from public, anon, authenticated;
grant execute on function public.artiste_approve_founding_application(uuid) to service_role;

create table if not exists public.accounting_ledgers (
  id uuid primary key default gen_random_uuid(),
  ledger_code text not null unique,
  ledger_name text not null,
  ledger_type text not null check (ledger_type in ('asset', 'liability', 'equity', 'income', 'expense')),
  description text not null default '',
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.accounting_voucher_no_seq;

create table if not exists public.accounting_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null default ('VCH-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.accounting_voucher_no_seq')::text, 6, '0')),
  voucher_date date not null default current_date,
  voucher_type text not null default 'journal',
  description text not null,
  reference text not null default '',
  posting_key text unique,
  created_at timestamptz not null default now()
);

alter table public.accounting_vouchers add column if not exists voucher_no text;
with numbered_vouchers as (
  select id, voucher_date, row_number() over (partition by extract(year from voucher_date) order by created_at, id) as row_number
  from public.accounting_vouchers
  where voucher_no is null
)
update public.accounting_vouchers as voucher
set voucher_no = 'VCH-' || to_char(numbered_vouchers.voucher_date, 'YYYY') || '-' || lpad(numbered_vouchers.row_number::text, 6, '0')
from numbered_vouchers
where voucher.id = numbered_vouchers.id;

select setval(
  'public.accounting_voucher_no_seq',
  greatest(coalesce((select max(substring(voucher_no from '([0-9]+)$')::bigint) from public.accounting_vouchers), 0) + 1, 1),
  false
);

alter table public.accounting_vouchers alter column voucher_no set not null;
alter table public.accounting_vouchers alter column voucher_no set default ('VCH-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.accounting_voucher_no_seq')::text, 6, '0'));
create unique index if not exists accounting_vouchers_voucher_no_uidx on public.accounting_vouchers(voucher_no);

create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.accounting_vouchers(id) on delete cascade,
  ledger_id uuid not null references public.accounting_ledgers(id) on delete restrict,
  description text not null default '',
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),
  constraint accounting_entries_one_side_check check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index if not exists accounting_entries_voucher_idx on public.accounting_entries(voucher_id);
create index if not exists accounting_entries_ledger_idx on public.accounting_entries(ledger_id, created_at desc);

insert into public.accounting_ledgers (ledger_code, ledger_name, ledger_type, description, is_system)
values
  ('1000', 'Razorpay Clearing', 'asset', 'Captured customer payments awaiting settlement', true),
  ('1010', 'Bank / UPI', 'asset', 'Manual bank and UPI payout account', true),
  ('2000', 'Artist Payable', 'liability', 'Artist earnings due for settlement', true),
  ('2010', 'Shiprocket Payable', 'liability', 'Quoted courier charges accrued and awaiting provider settlement', true),
  ('3000', 'Owner Capital', 'equity', 'Owner capital and opening balances', true),
  ('4000', 'Platform Commission Revenue', 'income', 'Artiste platform commission earned on artwork sales', true),
  ('4100', 'Shipping Recovery', 'income', 'Shipping amount collected from customers', true),
  ('5000', 'Courier Expense', 'expense', 'Courier and fulfilment costs', true)
on conflict (ledger_code) do update set ledger_name = excluded.ledger_name, ledger_type = excluded.ledger_type, is_system = true;

alter table public.accounting_ledgers enable row level security;
alter table public.accounting_vouchers enable row level security;
alter table public.accounting_entries enable row level security;
revoke all on public.accounting_ledgers, public.accounting_vouchers, public.accounting_entries from anon, authenticated;
grant all on public.accounting_ledgers, public.accounting_vouchers, public.accounting_entries to service_role;
grant usage, select on sequence public.accounting_voucher_no_seq to service_role;

create or replace function public.artiste_post_accounting_voucher(
  p_description text,
  p_voucher_date date,
  p_voucher_type text,
  p_reference text,
  p_posting_key text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  voucher_id uuid;
  debit_total numeric(14,2);
  credit_total numeric(14,2);
  line_count integer;
begin
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Voucher entries must be an array.'; end if;
  select count(*), coalesce(sum((value->>'debit')::numeric), 0), coalesce(sum((value->>'credit')::numeric), 0)
    into line_count, debit_total, credit_total
    from jsonb_array_elements(p_lines);
  if line_count < 2 then raise exception 'A balanced voucher needs at least two ledger entries.'; end if;
  if debit_total <= 0 or round(debit_total, 2) <> round(credit_total, 2) then
    raise exception 'Voucher is not balanced: total debit must equal total credit.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    left join public.accounting_ledgers l on l.id = (line->>'ledger_id')::uuid and l.active = true
    where l.id is null
       or coalesce((line->>'debit')::numeric, 0) < 0
       or coalesce((line->>'credit')::numeric, 0) < 0
       or ((coalesce((line->>'debit')::numeric, 0) > 0) = (coalesce((line->>'credit')::numeric, 0) > 0))
  ) then raise exception 'Each voucher line must reference an active ledger and contain either a debit or a credit.'; end if;

  if p_posting_key is not null and p_posting_key <> '' then
    select id into voucher_id from public.accounting_vouchers where posting_key = p_posting_key;
    if voucher_id is not null then return voucher_id; end if;
  end if;

  insert into public.accounting_vouchers (voucher_date, voucher_type, description, reference, posting_key)
  values (coalesce(p_voucher_date, current_date), coalesce(nullif(p_voucher_type, ''), 'journal'), p_description, coalesce(p_reference, ''), nullif(p_posting_key, ''))
  returning id into voucher_id;

  insert into public.accounting_entries (voucher_id, ledger_id, description, debit, credit)
  select voucher_id, (line->>'ledger_id')::uuid, coalesce(line->>'description', p_description),
         coalesce((line->>'debit')::numeric, 0), coalesce((line->>'credit')::numeric, 0)
  from jsonb_array_elements(p_lines) line;
  return voucher_id;
end;
$$;
revoke all on function public.artiste_post_accounting_voucher(text, date, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.artiste_post_accounting_voucher(text, date, text, text, text, jsonb) to service_role;

create or replace function public.artiste_record_payout_payment(
  p_payout_id uuid,
  p_amount numeric,
  p_utr text,
  p_proof_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.artist_payouts%rowtype;
  already_paid numeric(12,2);
  due_amount numeric(12,2);
  cumulative_paid numeric(12,2);
  next_status text;
  payable_ledger uuid;
  bank_ledger uuid;
  voucher_key text;
  updated public.artist_payouts%rowtype;
  pending_rows integer;
begin
  select * into target from public.artist_payouts where id = p_payout_id for update;
  if target.id is null then raise exception 'Artist payout ledger entry not found.'; end if;
  already_paid := coalesce(target.payout_paid_amount, 0);
  if already_paid = 0 and lower(coalesce(target.payout_status, '')) = 'paid' then already_paid := target.artist_payout; end if;
  due_amount := greatest(0, target.artist_payout - already_paid);
  if p_amount is null or p_amount <= 0 or p_amount > due_amount then raise exception 'Enter an amount greater than zero and no more than the remaining artist payout.'; end if;
  if coalesce(p_proof_path, '') = '' then raise exception 'A payment proof file is mandatory.'; end if;
  cumulative_paid := round(already_paid + p_amount, 2);
  next_status := case when cumulative_paid >= target.artist_payout then 'paid' else 'part_paid' end;
  update public.artist_payouts
    set payout_paid_amount = cumulative_paid,
        payout_utr = coalesce(nullif(p_utr, ''), payout_utr, ''),
        payout_proof_url = p_proof_path,
        payout_paid_at = now(),
        paid_at = case when next_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
        payout_status = next_status
    where id = p_payout_id
    returning * into updated;

  select id into payable_ledger from public.accounting_ledgers where ledger_code = '2000' and active = true;
  select id into bank_ledger from public.accounting_ledgers where ledger_code = '1010' and active = true;
  if payable_ledger is null or bank_ledger is null then raise exception 'Default Artist Payable and Bank / UPI ledgers are missing. Run database/schema.sql.'; end if;
  voucher_key := 'payout-payment:' || p_payout_id::text || ':' || updated.payout_paid_amount::text || ':' || md5(p_proof_path);
  perform public.artiste_post_accounting_voucher(
    'Artist payout payment · ' || target.artist_name,
    current_date,
    'payout',
    target.order_ref,
    voucher_key,
    jsonb_build_array(
      jsonb_build_object('ledger_id', payable_ledger, 'debit', p_amount, 'credit', 0, 'description', 'Settle Artist payable'),
      jsonb_build_object('ledger_id', bank_ledger, 'debit', 0, 'credit', p_amount, 'description', 'Bank / UPI payout made')
    )
  );

  select count(*) into pending_rows from public.artist_payouts
    where order_id = target.order_id
      and coalesce(payout_paid_amount, 0) < artist_payout
      and lower(coalesce(payout_status, '')) <> 'paid';
  update public.orders set payout_status = case when pending_rows = 0 then 'Paid' else 'Part-Paid' end where id = target.order_id;
  return jsonb_build_object('payout', to_jsonb(updated), 'remaining_pending', greatest(0, updated.artist_payout - updated.payout_paid_amount));
end;
$$;
revoke all on function public.artiste_record_payout_payment(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.artiste_record_payout_payment(uuid, numeric, text, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payout-proofs', 'payout-proofs', false, 10485760, array['image/jpeg','image/png','image/webp','image/avif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

