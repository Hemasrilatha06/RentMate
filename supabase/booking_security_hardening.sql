-- RentMate booking security hardening.
-- Apply after bookings_setup.sql. This migration does not delete booking rows,
-- disable RLS, or change the existing overlap exclusion constraint.
--
-- Before applying, review the NOTICE output for existing booking policies and
-- triggers. The restrictive policies below ensure that any leftover
-- permissive policies cannot widen authenticated access to booking rows.

begin;

-- Show the policies and non-internal triggers currently installed on bookings.
do $$
declare
  entry record;
begin
  for entry in
    select policyname, cmd, permissive, roles
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
    order by policyname
  loop
    raise notice 'Existing bookings policy: name=%, command=%, permissive=%, roles=%',
      entry.policyname, entry.cmd, entry.permissive, entry.roles;
  end loop;

  for entry in
    select t.tgname as trigger_name,
           pg_catalog.pg_get_triggerdef(t.oid, true) as trigger_definition
    from pg_catalog.pg_trigger as t
    where t.tgrelid = 'public.bookings'::regclass
      and not t.tgisinternal
    order by t.tgname
  loop
    raise notice 'Existing bookings trigger: name=%, definition=%',
      entry.trigger_name, entry.trigger_definition;
  end loop;
end;
$$;

-- Fail rather than silently proceeding if the database is missing the
-- concurrency-safe, confirmed-only overlap constraint from bookings_setup.sql.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as c
    where c.conrelid = 'public.bookings'::regclass
      and c.conname = 'bookings_no_confirmed_overlap'
      and c.contype = 'x'
      and c.convalidated
  ) then
    raise exception 'Required bookings_no_confirmed_overlap exclusion constraint is missing or not validated. Apply and review bookings_setup.sql before this migration.';
  end if;
end;
$$;

-- Revoke broad API writes. Renters may submit only the three booking inputs;
-- price, renter identity, status, ID, and timestamp remain database controlled.
revoke select, insert, update, delete on table public.bookings from anon, public;
revoke insert on table public.bookings from authenticated;
revoke insert (id, item_id, renter_id, start_date, end_date, total_price, status, created_at)
  on table public.bookings from anon, authenticated, public;
revoke update on table public.bookings from anon, authenticated, public;
revoke update (id, item_id, renter_id, start_date, end_date, total_price, status, created_at)
  on table public.bookings from anon, authenticated, public;
revoke delete on table public.bookings from anon, authenticated, public;
grant select on table public.bookings to authenticated;
grant insert (item_id, start_date, end_date) on table public.bookings to authenticated;
grant update (status) on table public.bookings to authenticated;

-- Keep the existing booking form's three-column INSERT initialized securely:
-- PostgreSQL supplies the authenticated renter and confirmed initial status.
-- total_price has no default; the BEFORE INSERT trigger below always computes it.
alter table public.bookings
  alter column renter_id set default auth.uid(),
  alter column status set default 'confirmed';

-- Rebuild the known renter INSERT policy and add a restrictive guard. The
-- restrictive guard is ANDed with every permissive INSERT policy, including
-- any legacy policy that this migration does not own.
drop policy if exists "Renters can create their own bookings" on public.bookings;
create policy "Renters can create their own bookings"
  on public.bookings for insert to authenticated
  with check (
    renter_id = (select auth.uid())
    and status = 'confirmed'
  );

drop policy if exists "booking_insert_security_guard" on public.bookings;
create policy "booking_insert_security_guard"
  on public.bookings as restrictive for insert to public
  with check (
    auth.uid() is not null
    and renter_id = (select auth.uid())
    and status = 'confirmed'
  );

-- Rebuild the known SELECT policy. This restrictive scope prevents a leftover
-- permissive SELECT policy from exposing another renter's booking details.
drop policy if exists "Renters and owners can read bookings" on public.bookings;
create policy "Renters and owners can read bookings"
  on public.bookings for select to authenticated
  using (
    renter_id = (select auth.uid())
    or exists (
      select 1 from public.items as i
      where i.id = bookings.item_id
        and i.owner_id = (select auth.uid())
    )
  );

drop policy if exists "booking_select_security_guard" on public.bookings;
create policy "booking_select_security_guard"
  on public.bookings as restrictive for select to public
  using (
    auth.uid() is not null
    and (
      renter_id = (select auth.uid())
      or exists (
        select 1 from public.items as i
        where i.id = bookings.item_id
          and i.owner_id = (select auth.uid())
      )
    )
  );

-- Only a renter or the owner of the booked item may update a booking row. The
-- restrictive guard prevents legacy permissive UPDATE policies from widening
-- that row scope; column grants and the trigger below restrict the mutation.
drop policy if exists "Renters can update their own bookings" on public.bookings;
drop policy if exists "Owners can update bookings for their items" on public.bookings;
drop policy if exists "booking_update_authenticated" on public.bookings;
create policy "booking_update_authenticated"
  on public.bookings for update to authenticated
  using (
    renter_id = (select auth.uid())
    or exists (
      select 1 from public.items as i
      where i.id = bookings.item_id
        and i.owner_id = (select auth.uid())
    )
  )
  with check (
    renter_id = (select auth.uid())
    or exists (
      select 1 from public.items as i
      where i.id = bookings.item_id
        and i.owner_id = (select auth.uid())
    )
  );

drop policy if exists "booking_update_security_guard" on public.bookings;
create policy "booking_update_security_guard"
  on public.bookings as restrictive for update to public
  using (
    auth.uid() is not null
    and (
      renter_id = (select auth.uid())
      or exists (
        select 1 from public.items as i
        where i.id = bookings.item_id
          and i.owner_id = (select auth.uid())
      )
    )
  )
  with check (
    auth.uid() is not null
    and (
      renter_id = (select auth.uid())
      or exists (
        select 1 from public.items as i
        where i.id = bookings.item_id
          and i.owner_id = (select auth.uid())
      )
    )
  );

-- The existing INSERT trigger is replaced in place: it still validates dates,
-- rejects self-booking, and calculates price, while also requiring a confirmed
-- initial state and an active item.
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
  item_is_active boolean;
begin
  if auth.uid() is null or new.renter_id is distinct from auth.uid() then
    raise exception 'Bookings can only be created for the signed-in renter.' using errcode = '42501';
  end if;

  if new.status is distinct from 'confirmed' then
    raise exception 'A new booking must start in confirmed status.' using errcode = '22023';
  end if;

  if new.end_date < new.start_date then
    raise exception 'The end date must be on or after the start date.' using errcode = '22023';
  end if;

  if new.start_date < current_date then
    raise exception 'The start date cannot be in the past.' using errcode = '22023';
  end if;

  select i.owner_id, i.price_per_day, i.available_from, i.available_to, i.is_active
    into item_owner, item_price, item_available_from, item_available_to, item_is_active
    from public.items as i
    where i.id = new.item_id;

  if not found then
    raise exception 'This item is no longer available.' using errcode = '23503';
  end if;

  if item_is_active is not true then
    raise exception 'This item is inactive and cannot be booked.' using errcode = '22023';
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

-- Preserve the existing trigger name and event; bookings_setup.sql created it.
drop trigger if exists validate_and_price_booking_before_insert on public.bookings;
create trigger validate_and_price_booking_before_insert
  before insert on public.bookings
  for each row execute function public.validate_and_price_booking();

-- Permit confirmed booking meeting-detail edits by either participant when
-- the optional timing columns exist. JSON comparisons keep this function valid
-- both before and after location_timing_setup.sql adds those columns. Status
-- transitions still require the meeting fields to remain unchanged.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_owner uuid;
  allowed_meeting_fields text[] := array[
    'pickup_time', 'return_time', 'meeting_spot', 'meeting_lat', 'meeting_lng'
  ];
begin
  if new.status is not distinct from old.status then
    if old.status <> 'confirmed' then
      raise exception 'Only confirmed bookings can have their meeting details edited.' using errcode = '22023';
    end if;

    select i.owner_id into item_owner
      from public.items as i
      where i.id = old.item_id;
    if auth.uid() is null
       or (old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid()) then
      raise exception 'Only the renter or item owner can edit this booking.' using errcode = '42501';
    end if;

    if (to_jsonb(new) - allowed_meeting_fields)
       is distinct from (to_jsonb(old) - allowed_meeting_fields) then
      raise exception 'Only meeting details may be changed without a status transition.' using errcode = '42501';
    end if;

    -- Historical bookings can retain NULL times until someone edits them.
    -- Once timing columns exist, any same-status edit must provide both times;
    -- the location migration's CHECK enforces same-day ordering as well.
    if to_jsonb(new) ? 'pickup_time'
       and ((to_jsonb(new) ->> 'pickup_time') is null
         or (to_jsonb(new) ->> 'return_time') is null) then
      raise exception 'Choose both a pickup time and a return time.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- Do not combine cancellation/return with edits to any other booking field.
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
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
      from public.items as i
      where i.id = old.item_id;
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

-- Booking deletion is not part of RentMate's history flow; prevent API roles
-- from deleting rows and retain the existing item/booking cascade behavior.
revoke delete on table public.bookings from anon, authenticated, public;

commit;
