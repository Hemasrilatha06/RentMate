-- RentMate Mapbox addresses, private booking locations, and agreed pickup spots.
-- Run after location_timing_setup.sql, handover_notifications_setup.sql,
-- payments_setup.sql, and public_read_setup.sql. Reapply this last if earlier
-- setup scripts are rerun in the future.
-- This migration adds nullable columns and replaces only the booking guard function;
-- it does not delete or rewrite existing booking, item, or profile data.

begin;

-- Fail with an actionable message if the prerequisite payment/notification and
-- booking-timing migrations have not been applied in this Supabase project.
do $$ begin
  if pg_catalog.to_regclass('public.notifications') is null then
    raise exception 'Run handover_notifications_setup.sql before mapbox_location_setup.sql.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.bookings'::regclass and attname='razorpay_order_id' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.bookings'::regclass and attname='payment_id' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid='public.bookings'::regclass and attname='pickup_time' and not attisdropped) then
    raise exception 'Run location_timing_setup.sql and payments_setup.sql before mapbox_location_setup.sql.';
  end if;
end $$;

alter table public.items add column if not exists address text;
comment on column public.items.address is 'Owner-entered pickup address or nearby landmark; private except to the owner and confirmed booking participants.';

alter table public.profiles
  add column if not exists address text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
comment on column public.profiles.address is 'A user private default location used to prefill future bookings.';
comment on column public.profiles.latitude is 'Private saved default location latitude.';
comment on column public.profiles.longitude is 'Private saved default location longitude.';

alter table public.bookings
  add column if not exists renter_address text,
  add column if not exists renter_lat double precision,
  add column if not exists renter_lng double precision,
  add column if not exists distance_km numeric,
  add column if not exists drive_minutes integer,
  add column if not exists meeting_spot_proposed_by uuid references auth.users(id),
  add column if not exists meeting_spot_confirmed boolean not null default false;
comment on column public.bookings.renter_address is 'Private renter address snapshot for this booking.';
comment on column public.bookings.renter_lat is 'Private renter latitude snapshot visible only to booking participants.';
comment on column public.bookings.renter_lng is 'Private renter longitude snapshot visible only to booking participants.';
comment on column public.bookings.distance_km is 'Route distance at booking creation (straight-line fallback if Directions is unavailable).';
comment on column public.bookings.drive_minutes is 'Mapbox driving duration in minutes; NULL when no route duration was available.';
comment on column public.bookings.meeting_spot_proposed_by is 'Participant who most recently proposed the meeting spot.';
comment on column public.bookings.meeting_spot_confirmed is 'True only after the non-proposing participant agrees to the current meeting spot.';

do $$ begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.items'::regclass and conname='items_address_coordinates_check') then
    alter table public.items add constraint items_address_coordinates_check check (
      (latitude is null and longitude is null) or
      (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
    );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_saved_location_coordinates_check') then
    alter table public.profiles add constraint profiles_saved_location_coordinates_check check (
      (latitude is null and longitude is null) or
      (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180)
    );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.bookings'::regclass and conname='bookings_renter_location_coordinates_check') then
    alter table public.bookings add constraint bookings_renter_location_coordinates_check check (
      (renter_lat is null and renter_lng is null) or
      (renter_lat is not null and renter_lng is not null and renter_lat between -90 and 90 and renter_lng between -180 and 180)
    );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.bookings'::regclass and conname='bookings_distance_values_check') then
    alter table public.bookings add constraint bookings_distance_values_check check (
      (distance_km is null or distance_km >= 0) and (drive_minutes is null or drive_minutes >= 0)
    );
  end if;
end $$;

-- Do not expose exact item coordinates or addresses through normal table
-- SELECT, even if an earlier deployment had broad table grants. Regrant only
-- the listing columns used by public Browse and authenticated app pages; row
-- visibility remains controlled by the existing active-item/owner RLS rules.
revoke select on table public.items from anon, public, authenticated;
revoke select (address, latitude, longitude) on table public.items from anon, public, authenticated;
grant select (id, owner_id, title, description, category, price_per_day, location,
              image_url, available_from, available_to, is_active, created_at)
  on table public.items to anon, authenticated;
-- Profile names stay readable to signed-in users, while exact saved locations
-- are available only through get_my_saved_location().
revoke select on public.profiles from anon, public, authenticated;
grant select (id, full_name, created_at) on public.profiles to authenticated;
grant update (address, latitude, longitude) on public.profiles to authenticated;

-- Public Browse can receive only rounded coordinates for active listings. The
-- exact item pin remains available through owner/booking-authorized RPCs only.
create or replace function public.get_item_approximate_locations(p_item_ids uuid[])
returns table (item_id uuid, latitude double precision, longitude double precision)
language sql stable security definer set search_path = '' as $$
  select i.id, round(i.latitude::numeric, 2)::double precision, round(i.longitude::numeric, 2)::double precision
  from public.items i
  where i.id = any(p_item_ids) and i.latitude is not null and i.longitude is not null
    and (auth.uid() is not null or i.is_active is true);
$$;
revoke all on function public.get_item_approximate_locations(uuid[]) from public;
grant execute on function public.get_item_approximate_locations(uuid[]) to anon, authenticated;

-- Owner-only item address and exact pin for Add/Edit screens.
create or replace function public.get_owned_item_address(p_item_id uuid)
returns table (address text, latitude double precision, longitude double precision)
language sql stable security definer set search_path = '' as $$
  select i.address, i.latitude, i.longitude from public.items i
  where i.id = p_item_id and i.owner_id = auth.uid() and auth.uid() is not null;
$$;
revoke all on function public.get_owned_item_address(uuid) from public, anon;
grant execute on function public.get_owned_item_address(uuid) to authenticated;

-- An item owner, or its renter after payment is confirmed, may view the exact
-- pickup address. Browse and pre-booking details continue to use rounded pins.
create or replace function public.get_item_private_address(p_item_id uuid)
returns table (address text, latitude double precision, longitude double precision)
language sql stable security definer set search_path = '' as $$
  select i.address, i.latitude, i.longitude from public.items i
  where i.id=p_item_id and auth.uid() is not null and (
    i.owner_id=auth.uid() or exists (
      select 1 from public.bookings b where b.item_id=i.id and b.renter_id=auth.uid()
        and b.status in ('confirmed','picked_up','return_requested','returned')
    )
  );
$$;
revoke all on function public.get_item_private_address(uuid) from public, anon;
grant execute on function public.get_item_private_address(uuid) to authenticated;

-- Private profile location read/write is scoped to the caller, despite the
-- profiles table remaining readable for public member names.
create or replace function public.get_my_saved_location()
returns table (address text, latitude double precision, longitude double precision)
language sql stable security definer set search_path = '' as $$
  select p.address, p.latitude, p.longitude from public.profiles p where p.id = auth.uid() and auth.uid() is not null;
$$;
revoke all on function public.get_my_saved_location() from public, anon;
grant execute on function public.get_my_saved_location() to authenticated;

create or replace function public.save_my_location(p_address text, p_latitude double precision, p_longitude double precision)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to save your default location.' using errcode = '42501'; end if;
  if p_address is null or btrim(p_address) = '' or p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Provide a valid address and map pin.' using errcode = '22023';
  end if;
  update public.profiles set address=btrim(p_address), latitude=p_latitude, longitude=p_longitude where id=auth.uid();
  if not found then raise exception 'Your profile is not ready yet. Please try again.'; end if;
end $$;
revoke all on function public.save_my_location(text,double precision,double precision) from public, anon;
grant execute on function public.save_my_location(text,double precision,double precision) to authenticated;

-- Exact item and renter locations are returned only to a participant in a
-- paid/confirmed booking. Pending payment holds do not reveal either address.
create or replace function public.get_booking_private_locations(p_booking_id uuid)
returns table (item_address text, item_lat double precision, item_lng double precision,
               renter_address text, renter_lat double precision, renter_lng double precision)
language sql stable security definer set search_path = '' as $$
  select i.address, i.latitude, i.longitude, b.renter_address, b.renter_lat, b.renter_lng
  from public.bookings b join public.items i on i.id=b.item_id
  where b.id=p_booking_id and b.status in ('confirmed','picked_up','return_requested','returned')
    and auth.uid() is not null and (b.renter_id=auth.uid() or i.owner_id=auth.uid());
$$;
revoke all on function public.get_booking_private_locations(uuid) from public, anon;
grant execute on function public.get_booking_private_locations(uuid) to authenticated;

-- New booking submissions must include the renter's chosen address and pin.
-- Historical rows remain valid because this check runs only on INSERT.
create or replace function public.require_booking_renter_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.renter_address is null or btrim(new.renter_address)='' or new.renter_lat is null or new.renter_lng is null then
    raise exception 'Add your address and map pin before booking.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists require_booking_renter_location_before_insert on public.bookings;
create trigger require_booking_renter_location_before_insert before insert on public.bookings
for each row execute function public.require_booking_renter_location();

-- Preserve the payment/handover transition guard. Renter/item identity, dates,
-- price and payment data are still protected; meeting proposals are editable
-- only on an unchanged, confirmed booking by one of its two participants.
create or replace function public.enforce_booking_status_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item_owner uuid;
  is_expiry boolean := coalesce(pg_catalog.current_setting('rentmate.expire_pending_bookings', true) = 'true', false);
begin
  if new.id is distinct from old.id or new.item_id is distinct from old.item_id
     or new.renter_id is distinct from old.renter_id or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date or new.total_price is distinct from old.total_price
     or new.created_at is distinct from old.created_at or new.renter_address is distinct from old.renter_address
     or new.renter_lat is distinct from old.renter_lat or new.renter_lng is distinct from old.renter_lng
     or new.distance_km is distinct from old.distance_km or new.drive_minutes is distinct from old.drive_minutes then
    raise exception 'Booking identity, location snapshot, dates and price cannot be changed after creation.' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    if old.status='pending_payment' and auth.role()='service_role' and old.razorpay_order_id is null
       and new.razorpay_order_id is not null
       and (to_jsonb(new)-'razorpay_order_id') is not distinct from (to_jsonb(old)-'razorpay_order_id') then return new; end if;
    if old.status <> 'confirmed' then raise exception 'Only confirmed bookings can have meeting details edited.' using errcode='22023'; end if;
    select i.owner_id into item_owner from public.items i where i.id=old.item_id;
    if auth.uid() is null or (old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid()) then
      raise exception 'Only the renter or item owner can edit this booking.' using errcode='42501';
    end if;
    if (to_jsonb(new)-array['pickup_time','return_time','meeting_spot','meeting_lat','meeting_lng','meeting_spot_proposed_by','meeting_spot_confirmed'])
       is distinct from (to_jsonb(old)-array['pickup_time','return_time','meeting_spot','meeting_lat','meeting_lng','meeting_spot_proposed_by','meeting_spot_confirmed']) then
      raise exception 'Only timing and meeting-spot details may change without a status transition.' using errcode='42501';
    end if;
    if (new.pickup_time is null) <> (new.return_time is null) then raise exception 'Choose both pickup and return times.' using errcode='22023'; end if;
    if new.pickup_time is not null and new.start_date=new.end_date and new.return_time<=new.pickup_time then
      raise exception 'For a same-day rental, return time must be after pickup time.' using errcode='22023';
    end if;
    return new;
  end if;

  if (to_jsonb(new)-array['status','payment_id','paid_at']) is distinct from (to_jsonb(old)-array['status','payment_id','paid_at']) then
    raise exception 'Update payment or meeting details separately from booking status.' using errcode='22023';
  end if;
  if old.status='pending_payment' and new.status='confirmed' then
    if auth.role() is distinct from 'service_role' then raise exception 'Only verified payment processing can confirm this booking.' using errcode='42501'; end if;
    if new.payment_id is null or btrim(new.payment_id)='' or new.paid_at is null or old.payment_id is not null or old.paid_at is not null then
      raise exception 'Verified payment ID and paid time are required to confirm this booking.' using errcode='22023'; end if;
    return new;
  end if;
  if old.status='pending_payment' and new.status='cancelled' then
    if old.renter_id is distinct from auth.uid() and not is_expiry then raise exception 'Only the renter can cancel this pending payment.' using errcode='42501'; end if;
    return new;
  end if;
  select i.owner_id into item_owner from public.items i where i.id=old.item_id;
  if auth.uid() is null then raise exception 'A signed-in participant must make this booking change.' using errcode='42501'; end if;
  if old.status='confirmed' and new.status='picked_up' then
    if item_owner is distinct from auth.uid() then raise exception 'Only the item owner can mark this booking as handed over.' using errcode='42501'; end if; return new;
  end if;
  if old.status='picked_up' and new.status='return_requested' then
    if old.renter_id is distinct from auth.uid() then raise exception 'Only the renter can request a return confirmation.' using errcode='42501'; end if; return new;
  end if;
  if old.status='return_requested' and new.status='returned' then
    if item_owner is distinct from auth.uid() then raise exception 'Only the item owner can confirm this return.' using errcode='42501'; end if;
    if old.end_date>=current_date then raise exception 'The owner can confirm the return after the rental end date.' using errcode='22023'; end if; return new;
  end if;
  if old.status='confirmed' and new.status='cancelled' then
    if old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid() then raise exception 'Only the renter or item owner can cancel this booking.' using errcode='42501'; end if;
    if old.start_date<=current_date then raise exception 'A confirmed booking can only be cancelled before its start date.' using errcode='22023'; end if; return new;
  end if;
  raise exception 'That booking status transition is not allowed.' using errcode='22023';
end $$;
revoke all on function public.enforce_booking_status_transition() from public, anon, authenticated;

-- Guard proposals and reset agreement in the same transaction. Agreement is
-- performed through the RPC below, which permits only the other participant.
create or replace function public.guard_meeting_spot_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item_owner uuid; agreeing boolean := coalesce(pg_catalog.current_setting('rentmate.meeting_spot_agreement', true)='true',false);
begin
  select i.owner_id into item_owner from public.items i where i.id=old.item_id;
  if new.meeting_spot is distinct from old.meeting_spot or new.meeting_lat is distinct from old.meeting_lat or new.meeting_lng is distinct from old.meeting_lng then
    if old.status <> 'confirmed' or new.status is distinct from old.status then raise exception 'The pickup spot can be changed only before handover.' using errcode='22023'; end if;
    if auth.uid() is null or (auth.uid()<>old.renter_id and auth.uid()<>item_owner) then raise exception 'Only booking participants can propose a pickup spot.' using errcode='42501'; end if;
    new.meeting_spot_proposed_by := auth.uid();
    new.meeting_spot_confirmed := false;
  elsif new.meeting_spot_proposed_by is distinct from old.meeting_spot_proposed_by or new.meeting_spot_confirmed is distinct from old.meeting_spot_confirmed then
    if not agreeing or old.status <> 'confirmed' or new.status is distinct from old.status
       or new.meeting_spot_proposed_by is distinct from old.meeting_spot_proposed_by
       or new.meeting_spot_confirmed is not true or old.meeting_spot_proposed_by is null
       or auth.uid() is null or auth.uid()=old.meeting_spot_proposed_by
       or (auth.uid()<>old.renter_id and auth.uid()<>item_owner) then
      raise exception 'Only the other booking participant can agree to the proposed pickup spot.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_meeting_spot_change() from public, anon, authenticated;
drop trigger if exists booking_location_meeting_guard_before_update on public.bookings;
create trigger booking_location_meeting_guard_before_update before update on public.bookings
for each row execute function public.guard_meeting_spot_change();

create or replace function public.agree_booking_meeting_spot(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare booking_row public.bookings%rowtype; owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to agree to a pickup spot.' using errcode='42501'; end if;
  select b.* into booking_row from public.bookings b where b.id=p_booking_id for update;
  if not found or booking_row.status<>'confirmed' or booking_row.meeting_spot_proposed_by is null then raise exception 'There is no active pickup spot proposal.' using errcode='22023'; end if;
  select i.owner_id into owner_id from public.items i where i.id=booking_row.item_id;
  if (auth.uid()<>booking_row.renter_id and auth.uid()<>owner_id) or auth.uid()=booking_row.meeting_spot_proposed_by then
    raise exception 'Only the other booking participant can agree to this pickup spot.' using errcode='42501';
  end if;
  perform pg_catalog.set_config('rentmate.meeting_spot_agreement','true',true);
  update public.bookings set meeting_spot_confirmed=true where id=p_booking_id;
end $$;
revoke all on function public.agree_booking_meeting_spot(uuid) from public, anon;
grant execute on function public.agree_booking_meeting_spot(uuid) to authenticated;

-- Notify the participant who did not propose the changed meeting spot. This is
-- separate from booking-status notifications and fires once per real change.
create or replace function public.notify_meeting_spot_proposal()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; recipient uuid; actor_name text; item_title text;
begin
  if new.meeting_spot is not distinct from old.meeting_spot and new.meeting_lat is not distinct from old.meeting_lat and new.meeting_lng is not distinct from old.meeting_lng then return new; end if;
  select i.owner_id, i.title into owner_id,item_title from public.items i where i.id=new.item_id;
  recipient := case when auth.uid()=new.renter_id then owner_id else new.renter_id end;
  select coalesce(nullif(p.full_name,''),'A booking participant') into actor_name from public.profiles p where p.id=auth.uid();
  insert into public.notifications(user_id,type,title,body,booking_id)
  values(recipient,'meeting_spot_proposed','Pickup spot proposed',coalesce(actor_name,'A booking participant') || ' proposed a pickup spot for ' || coalesce(item_title,'your booking') || '.',new.id);
  return new;
end $$;
revoke all on function public.notify_meeting_spot_proposal() from public, anon, authenticated;
drop trigger if exists notify_meeting_spot_proposal_after_update on public.bookings;
create trigger notify_meeting_spot_proposal_after_update after update of meeting_spot,meeting_lat,meeting_lng on public.bookings
for each row when (old.meeting_spot is distinct from new.meeting_spot or old.meeting_lat is distinct from new.meeting_lat or old.meeting_lng is distinct from new.meeting_lng)
execute function public.notify_meeting_spot_proposal();

-- Booking SELECT remains protected by the existing restrictive participant
-- policies; the added columns are visible only through those booking rows.
revoke insert on public.bookings from anon, public, authenticated;
revoke insert (renter_address,renter_lat,renter_lng,distance_km,drive_minutes) on public.bookings from anon, public, authenticated;
grant insert (item_id,start_date,end_date,pickup_time,return_time,meeting_spot,meeting_lat,meeting_lng,status,renter_address,renter_lat,renter_lng,distance_km,drive_minutes) on public.bookings to authenticated;
grant update (pickup_time,return_time,meeting_spot,meeting_lat,meeting_lng) on public.bookings to authenticated;

commit;
