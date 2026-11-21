-- Artiste marketplace schema v3.2
-- Additive / rerunnable migration. Existing Artiste paintings, Customers, orders and Artist records are retained.
-- Apply in Supabase SQL Editor. Back up before deploying any production database migration.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Customer profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
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
  pickup_address text not null default '',
  pickup_contact_name text not null default '',
  pickup_phone text not null default '',
  pickup_landmark text not null default '',
  pickup_locality text not null default '',
  pickup_pincode text not null default '',
  pickup_location text not null default 'Primary',
  is_approved boolean not null default false,
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
alter table public.artists add column if not exists pickup_address text not null default '';
alter table public.artists add column if not exists pickup_contact_name text not null default '';
alter table public.artists add column if not exists pickup_phone text not null default '';
alter table public.artists add column if not exists pickup_landmark text not null default '';
alter table public.artists add column if not exists pickup_locality text not null default '';
alter table public.artists add column if not exists pickup_pincode text not null default '';
alter table public.artists add column if not exists pickup_location text not null default 'Primary';
alter table public.artists add column if not exists is_approved boolean not null default false;
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
  artist_id uuid references public.artists(id) on delete set null,
  artist_name text not null default 'Artiste Studio',
  is_approved boolean not null default true,
  pickup_pincode text,
  pickup_location text not null default 'Primary',
  created_at timestamptz not null default now()
);
alter table public.paintings add column if not exists is_sold boolean not null default false;
alter table public.paintings add column if not exists artist_id uuid references public.artists(id) on delete set null;
alter table public.paintings add column if not exists artist_name text not null default 'Artiste Studio';
alter table public.paintings add column if not exists is_approved boolean not null default true;
alter table public.paintings add column if not exists pickup_pincode text;
alter table public.paintings add column if not exists pickup_location text not null default 'Primary';
alter table public.paintings add column if not exists created_at timestamptz not null default now();

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

insert into public.profiles(id, full_name)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', '')
from auth.users u
on conflict (id) do nothing;

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
  requested_count := cardinality(artwork_ids);
  perform id from public.paintings where id = any(artwork_ids) order by id for update;
  select count(*) into available_count from public.paintings where id = any(artwork_ids) and is_sold = false and is_approved = true;
  if available_count <> requested_count then
    update public.orders set status = 'Payment conflict', razorpay_payment_id = p_payment_id, shipment_status = 'Manual review', shipment_note = 'Payment captured but one or more artworks were unavailable. Refund review required.' where id = p_order_id;
    return 'conflict';
  end if;
  update public.paintings set is_sold = true where id = any(artwork_ids);
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
declare target_order uuid; updated_count integer;
begin
  if p_status not in ('Pending', 'Paid') then return false; end if;
  select order_id into target_order from public.artist_payouts where id = p_payout_id for update;
  if target_order is null then return false; end if;
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
create trigger on_auth_user_created_artiste after insert on auth.users for each row execute procedure public.handle_new_auth_user();

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
    if new.is_approved is distinct from old.is_approved then raise exception 'Only the Artiste owner can approve an Artist profile'; end if;
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

-- Reminder: configure a Supabase Auth email template that includes {{ .Token }}
-- to deliver a 6-digit OTP. The application validates the Supabase JWT and its
-- signed AMR claim before serving protected account / Artist endpoints.
