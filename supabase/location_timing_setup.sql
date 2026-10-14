-- RentMate item locations and booking pickup/return details.
-- Run after items_setup.sql, bookings_setup.sql, and booking_security_hardening.sql.
-- This migration requires the hardening guards because it extends the guarded
-- booking transition to permit confirmed booking-detail edits. It adds columns
-- and constraints without deleting existing items, bookings, or photos.

begin;

-- Fail closed unless booking hardening policies and triggers are active. The
-- base setup alone does not prevent forged statuses or protect private booking details.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_insert_security_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_update_security_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_select_security_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'validate_and_price_booking_before_insert'
      and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'enforce_booking_status_transition_before_update'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'Apply booking_security_hardening.sql before location_timing_setup.sql.';
  end if;
end;
$$;

-- Listing pins are nullable so existing items remain valid and can be updated later.
alter table public.items
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
comment on column public.items.latitude is 'Optional latitude pin for the item location.';
comment on column public.items.longitude is 'Optional longitude pin for the item location.';

-- Do not expose exact owner pins through ordinary item SELECT queries. Grant
-- the application-used public columns explicitly; rounded coordinates are
-- provided by a restricted RPC below, and exact coordinates by an owner-only RPC.
revoke select on table public.items from anon, public, authenticated;
revoke select (latitude, longitude) on table public.items from anon, public, authenticated;
grant select (id, owner_id, title, description, category, price_per_day, location,
              image_url, available_from, available_to, is_active, created_at)
  on table public.items to authenticated;

-- Authenticated item viewers receive coordinates rounded to 2 decimal places
-- (roughly a neighborhood-scale area), never the exact stored item pin.
create or replace function public.get_item_approximate_locations(p_item_ids uuid[])
returns table (item_id uuid, latitude double precision, longitude double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         round(i.latitude::numeric, 2)::double precision,
         round(i.longitude::numeric, 2)::double precision
  from public.items as i
  where auth.uid() is not null
    and i.id = any(p_item_ids)
    and i.latitude is not null
    and i.longitude is not null;
$$;
revoke all on function public.get_item_approximate_locations(uuid[]) from public, anon;
grant execute on function public.get_item_approximate_locations(uuid[]) to authenticated;

-- Exact pins are available only to the authenticated owner editing that item.
create or replace function public.get_owned_item_location(p_item_id uuid)
returns table (latitude double precision, longitude double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select i.latitude, i.longitude
  from public.items as i
  where i.id = p_item_id
    and i.owner_id = auth.uid();
$$;
revoke all on function public.get_owned_item_location(uuid) from public, anon;
grant execute on function public.get_owned_item_location(uuid) to authenticated;

-- Reject incomplete or out-of-range listing coordinate pairs while keeping
-- them nullable for existing items.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.items'::regclass
      and conname = 'items_location_coordinates_check'
  ) then
    alter table public.items add constraint items_location_coordinates_check
      check ((latitude is null and longitude is null)
        or (latitude is not null and longitude is not null
          and latitude between -90 and 90 and longitude between -180 and 180));
  end if;
end;
$$;

-- Rental timing and an optional rendezvous point are nullable for old bookings.
alter table public.bookings
  add column if not exists pickup_time time,
  add column if not exists return_time time,
  add column if not exists meeting_spot text,
  add column if not exists meeting_lat double precision,
  add column if not exists meeting_lng double precision;
comment on column public.bookings.pickup_time is 'Optional pickup time on start_date.';
comment on column public.bookings.return_time is 'Optional return time on end_date.';
comment on column public.bookings.meeting_spot is 'Optional text description of the agreed meeting spot.';
comment on column public.bookings.meeting_lat is 'Optional latitude for the agreed meeting spot.';
comment on column public.bookings.meeting_lng is 'Optional longitude for the agreed meeting spot.';

-- Now that the meeting coordinate columns exist, reject incomplete or
-- out-of-range coordinate pairs while preserving NULLs on historical bookings.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_meeting_coordinates_check'
  ) then
    alter table public.bookings add constraint bookings_meeting_coordinates_check
      check ((meeting_lat is null and meeting_lng is null)
        or (meeting_lat is not null and meeting_lng is not null
          and meeting_lat between -90 and 90 and meeting_lng between -180 and 180));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.bookings'::regclass
      and conname = 'bookings_same_day_time_order'
  ) then
    alter table public.bookings
      add constraint bookings_same_day_time_order
      check ((pickup_time is null and return_time is null)
        or (pickup_time is not null and return_time is not null
          and (start_date <> end_date or return_time > pickup_time)));
  end if;
end;
$$;

-- Existing bookings may keep both times NULL. New API inserts must provide
-- both times; this trigger also enforces same-day ordering independently of UI.
create or replace function public.require_booking_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pickup_time is null or new.return_time is null then
    raise exception 'Choose both a pickup time and a return time.' using errcode = '22023';
  end if;
  if new.start_date = new.end_date and new.return_time <= new.pickup_time then
    raise exception 'For a same-day rental, return time must be after pickup time.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists require_booking_times_before_insert on public.bookings;
create trigger require_booking_times_before_insert
  before insert on public.bookings
  for each row execute function public.require_booking_times();

-- Limit API INSERT to the booking form's chosen item, dates, and new meeting
-- details. renter_id, status, price, ID, and created_at stay database controlled.
revoke insert on table public.bookings from anon, public, authenticated;
revoke insert (id, item_id, renter_id, start_date, end_date, total_price, status, created_at,
               pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng)
  on table public.bookings from anon, public, authenticated;
grant insert (item_id, start_date, end_date, pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng)
  on table public.bookings to authenticated;

-- Keep booking updates to the status-transition field and scheduling fields.
-- The trigger below validates actor, status, and immutable booking fields.
revoke update on table public.bookings from anon, public, authenticated;
revoke update (id, item_id, renter_id, start_date, end_date, total_price, status, created_at,
               pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng)
  on table public.bookings from anon, public, authenticated;
grant update (status, pickup_time, return_time, meeting_spot, meeting_lat, meeting_lng)
  on table public.bookings to authenticated;

-- Restrict UPDATE row access even if a legacy permissive policy remains. This
-- restrictive policy is combined with existing permissive renter/owner policies.
alter table public.bookings enable row level security;
drop policy if exists "booking_timing_update_guard" on public.bookings;
create policy "booking_timing_update_guard"
  on public.bookings as restrictive for update to public
  using (
    auth.uid() is not null
    and (
      renter_id = (select auth.uid())
      or exists (
        select 1 from public.items as i
        where i.id = bookings.item_id and i.owner_id = (select auth.uid())
      )
    )
  )
  with check (
    auth.uid() is not null
    and (
      renter_id = (select auth.uid())
      or exists (
        select 1 from public.items as i
        where i.id = bookings.item_id and i.owner_id = (select auth.uid())
      )
    )
  );

-- Keep booking identity, dates, financial fields, and creation time immutable.
-- While confirmed, either party may edit only the meeting/timing details. Valid
-- renter cancellation and post-rental owner return transitions are preserved.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_owner uuid;
begin
  if new.id is distinct from old.id
     or new.item_id is distinct from old.item_id
     or new.renter_id is distinct from old.renter_id
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.total_price is distinct from old.total_price
     or new.created_at is distinct from old.created_at then
    raise exception 'Booking details and price cannot be changed after creation.' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    if old.status <> 'confirmed' then
      raise exception 'Only confirmed bookings can have their meeting details edited.' using errcode = '22023';
    end if;
    select i.owner_id into item_owner
      from public.items as i where i.id = old.item_id;
    if auth.uid() is null or (old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid()) then
      raise exception 'Only the renter or item owner can edit this booking.' using errcode = '42501';
    end if;
    if new.pickup_time is null or new.return_time is null then
      raise exception 'Choose both a pickup time and a return time.' using errcode = '22023';
    end if;
    if new.start_date = new.end_date and new.return_time <= new.pickup_time then
      raise exception 'For a same-day rental, return time must be after pickup time.' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.pickup_time is distinct from old.pickup_time
     or new.return_time is distinct from old.return_time
     or new.meeting_spot is distinct from old.meeting_spot
     or new.meeting_lat is distinct from old.meeting_lat
     or new.meeting_lng is distinct from old.meeting_lng then
    raise exception 'Update meeting details separately from booking status.' using errcode = '22023';
  end if;

  if old.status <> 'confirmed' then
    raise exception 'Only a confirmed booking can be cancelled or returned.' using errcode = '22023';
  end if;

  if new.status = 'cancelled' then
    if old.renter_id is distinct from auth.uid() then
      raise exception 'Only the renter can cancel this booking.' using errcode = '42501';
    end if;
    if old.start_date <= current_date then
      raise exception 'A booking can only be cancelled before its start date.' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.status = 'returned' then
    select i.owner_id into item_owner
      from public.items as i where i.id = old.item_id;
    if not found or item_owner is distinct from auth.uid() then
      raise exception 'Only the item owner can mark this booking as returned.' using errcode = '42501';
    end if;
    if old.end_date >= current_date then
      raise exception 'A booking can only be marked returned after its end date.' using errcode = '22023';
    end if;
    return new;
  end if;

  raise exception 'That booking status transition is not allowed.' using errcode = '22023';
end;
$$;

drop trigger if exists enforce_booking_status_transition_before_update on public.bookings;
create trigger enforce_booking_status_transition_before_update
  before update on public.bookings
  for each row execute function public.enforce_booking_status_transition();

commit;
