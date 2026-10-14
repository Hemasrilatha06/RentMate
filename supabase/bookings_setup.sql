-- RentMate booking setup. Run this in the Supabase SQL Editor after items_setup.sql.
-- Safe to rerun: existing booking rows are preserved, and named policies/triggers
-- and the exclusion constraint are created or replaced without dropping data.

-- UUID equality in a GiST exclusion constraint is supplied by btree_gist.
create extension if not exists btree_gist;

-- Store each rental range and the price calculated by the database trigger.
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  renter_id uuid not null default auth.uid() references auth.users (id),
  start_date date not null,
  end_date date not null,
  total_price numeric not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'returned', 'cancelled')),
  created_at timestamptz default now(),
  constraint bookings_dates_check check (end_date >= start_date)
);

-- Prevent overlapping confirmed bookings for the same item, including dates
-- that touch at either endpoint. The database enforces this under concurrency.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_no_confirmed_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_no_confirmed_overlap
      exclude using gist (
        item_id with =,
        daterange(start_date, end_date, '[]') with &&
      ) where (status = 'confirmed');
  end if;
end;
$$;

-- Enable row-level security before adding renter and item-owner access rules.
alter table public.bookings enable row level security;

-- The trigger checks item availability and renter eligibility, and computes
-- total_price from the inclusive number of days and the current item daily rate.
create or replace function public.validate_and_price_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_owner uuid;
  item_price numeric;
  item_available_from date;
  item_available_to date;
begin
  if new.end_date < new.start_date then
    raise exception 'The end date must be on or after the start date.' using errcode = '22023';
  end if;

  if new.start_date < current_date then
    raise exception 'The start date cannot be in the past.' using errcode = '22023';
  end if;

  select i.owner_id, i.price_per_day, i.available_from, i.available_to
    into item_owner, item_price, item_available_from, item_available_to
    from public.items as i
    where i.id = new.item_id;

  if not found then
    raise exception 'This item is no longer available.' using errcode = '23503';
  end if;

  if new.start_date < item_available_from or new.end_date > item_available_to then
    raise exception 'Choose dates within this item''s availability window.' using errcode = '22023';
  end if;

  if new.renter_id = item_owner then
    raise exception 'You cannot book your own item.' using errcode = '22023';
  end if;

  new.total_price := ((new.end_date - new.start_date) + 1) * item_price;
  return new;
end;
$$;

-- Run validation and server-side price calculation before every new booking.
drop trigger if exists validate_and_price_booking_before_insert on public.bookings;
create trigger validate_and_price_booking_before_insert
  before insert on public.bookings
  for each row execute function public.validate_and_price_booking();

-- Renters may insert only for themselves. The trigger also rejects owner self-booking.
drop policy if exists "Renters can create their own bookings" on public.bookings;
create policy "Renters can create their own bookings"
  on public.bookings for insert to authenticated
  with check (renter_id = (select auth.uid()));

-- A renter can read their bookings; an item's owner can read bookings for that item.
drop policy if exists "Renters and owners can read bookings" on public.bookings;
create policy "Renters and owners can read bookings"
  on public.bookings for select to authenticated
  using (
    renter_id = (select auth.uid())
    or exists (
      select 1
      from public.items as i
      where i.id = bookings.item_id
        and i.owner_id = (select auth.uid())
    )
  );

-- Renters can update their own booking rows while keeping themselves as renter.
drop policy if exists "Renters can update their own bookings" on public.bookings;
create policy "Renters can update their own bookings"
  on public.bookings for update to authenticated
  using (renter_id = (select auth.uid()))
  with check (renter_id = (select auth.uid()));

-- Item owners can update booking rows for their listings.
drop policy if exists "Owners can update bookings for their items" on public.bookings;
create policy "Owners can update bookings for their items"
  on public.bookings for update to authenticated
  using (
    exists (
      select 1
      from public.items as i
      where i.id = bookings.item_id
        and i.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.items as i
      where i.id = bookings.item_id
        and i.owner_id = (select auth.uid())
    )
  );

-- Expose only confirmed date ranges to authenticated users; renter identity and
-- all other booking details remain protected by the bookings table's RLS.
create or replace function public.get_booked_ranges(p_item_id uuid)
returns table (start_date date, end_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select b.start_date, b.end_date
  from public.bookings as b
  where b.item_id = p_item_id
    and b.status = 'confirmed'
  order by b.start_date;
$$;

-- Only authenticated clients may call the limited date-range function.
revoke all on function public.get_booked_ranges(uuid) from public;
grant execute on function public.get_booked_ranges(uuid) to authenticated;
