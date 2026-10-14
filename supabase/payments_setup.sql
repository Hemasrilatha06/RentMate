-- RentMate test-mode payment support. Run after handover_notifications_setup.sql.
-- Existing bookings and payment history are preserved; the guarded insert and
-- status-transition rules are updated to support pending payment securely.

begin;

-- Razorpay's public payment identifier and the time a verified payment was
-- recorded. No secret key or client-supplied payment data is stored here.
alter table public.bookings
  add column if not exists payment_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists razorpay_order_id text;
comment on column public.bookings.payment_id is 'Razorpay payment ID recorded only after server-side verification.';
comment on column public.bookings.paid_at is 'Timestamp recorded when the payment provider confirms a captured payment.';
comment on column public.bookings.razorpay_order_id is 'Razorpay order created server-side for this pending booking; reused for retries.';

-- New API bookings must explicitly begin pending_payment. Keep the existing
-- default unchanged for non-API database maintenance that omits status.
revoke insert on table public.bookings from authenticated;
revoke insert (status) on table public.bookings from anon, authenticated, public;
grant insert (item_id, start_date, end_date, pickup_time, return_time,
              meeting_spot, meeting_lat, meeting_lng, status)
  on table public.bookings to authenticated;

-- Replace only the known booking INSERT policies. The restrictive guard keeps
-- legacy permissive policies from allowing forged initial statuses.
drop policy if exists "Renters can create their own bookings" on public.bookings;
create policy "Renters can create their own bookings"
  on public.bookings for insert to authenticated
  with check (renter_id = (select auth.uid()) and status = 'pending_payment');

drop policy if exists "booking_insert_security_guard" on public.bookings;
create policy "booking_insert_security_guard"
  on public.bookings as restrictive for insert to public
  with check (
    auth.uid() is not null
    and renter_id = (select auth.uid())
    and status = 'pending_payment'
  );

-- Continue calculating price and validating ownership, availability, and dates
-- in the database. Client values for identity and price are not insertable.
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
  if new.status is distinct from 'pending_payment' then
    raise exception 'A new booking must start in pending_payment status.' using errcode = '22023';
  end if;
  if new.start_date is null or new.end_date is null or new.end_date < new.start_date then
    raise exception 'Choose a valid booking date range.' using errcode = '22023';
  end if;
  if new.start_date < current_date then
    raise exception 'The start date cannot be in the past.' using errcode = '22023';
  end if;
  if new.pickup_time is null or new.return_time is null then
    raise exception 'Choose both a pickup time and a return time.' using errcode = '22023';
  end if;
  if new.start_date = new.end_date and new.return_time <= new.pickup_time then
    raise exception 'For a same-day rental, return time must be after pickup time.' using errcode = '22023';
  end if;

  select i.owner_id, i.price_per_day, i.available_from, i.available_to, i.is_active
    into item_owner, item_price, item_available_from, item_available_to, item_is_active
    from public.items as i where i.id = new.item_id;
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
  new.payment_id := null;
  new.paid_at := null;
  return new;
end;
$$;

-- Only the authenticated payment-verification backend can confirm a pending
-- booking. It sets payment_id and paid_at in the same atomic transition.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_owner uuid;
  is_expiry boolean := coalesce(pg_catalog.current_setting('rentmate.expire_pending_bookings', true) = 'true', false);
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
    if old.status = 'pending_payment' and auth.role() = 'service_role'
       and old.razorpay_order_id is null and new.razorpay_order_id is not null
       and (to_jsonb(new) - 'razorpay_order_id') is not distinct from (to_jsonb(old) - 'razorpay_order_id') then
      return new;
    end if;
    if old.status <> 'confirmed' then
      raise exception 'Only confirmed bookings can have their meeting details edited.' using errcode = '22023';
    end if;
    select i.owner_id into item_owner from public.items as i where i.id = old.item_id;
    if auth.uid() is null or (old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid()) then
      raise exception 'Only the renter or item owner can edit this booking.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - array['pickup_time', 'return_time', 'meeting_spot', 'meeting_lat', 'meeting_lng'])
       is distinct from (to_jsonb(old) - array['pickup_time', 'return_time', 'meeting_spot', 'meeting_lat', 'meeting_lng']) then
      raise exception 'Only pickup, return, and meeting details may change without a status transition.' using errcode = '42501';
    end if;
    if new.pickup_time is null or new.return_time is null then
      raise exception 'Choose both a pickup time and a return time.' using errcode = '22023';
    end if;
    if new.start_date = new.end_date and new.return_time <= new.pickup_time then
      raise exception 'For a same-day rental, return time must be after pickup time.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- Payment fields may change only as part of the verified pending -> confirmed
  -- transition; all other status transitions must leave them untouched.
  if (to_jsonb(new) - array['status', 'payment_id', 'paid_at'])
     is distinct from (to_jsonb(old) - array['status', 'payment_id', 'paid_at']) then
    raise exception 'Update payment or meeting details separately from booking status.' using errcode = '22023';
  end if;

  if old.status = 'pending_payment' and new.status = 'confirmed' then
    if auth.role() is distinct from 'service_role' then
      raise exception 'Only verified payment processing can confirm this booking.' using errcode = '42501';
    end if;
    if new.payment_id is null or btrim(new.payment_id) = '' or new.paid_at is null
       or old.payment_id is not null or old.paid_at is not null then
      raise exception 'Verified payment ID and paid time are required to confirm this booking.' using errcode = '22023';
    end if;
    return new;
  end if;

  if old.status = 'pending_payment' and new.status = 'cancelled' then
    if old.renter_id is distinct from auth.uid() and not is_expiry then
      raise exception 'Only the renter can cancel this pending payment.' using errcode = '42501';
    end if;
    return new;
  end if;

  select i.owner_id into item_owner from public.items as i where i.id = old.item_id;
  if auth.uid() is null then
    raise exception 'A signed-in participant must make this booking change.' using errcode = '42501';
  end if;
  if old.status = 'confirmed' and new.status = 'picked_up' then
    if item_owner is distinct from auth.uid() then
      raise exception 'Only the item owner can mark this booking as handed over.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'picked_up' and new.status = 'return_requested' then
    if old.renter_id is distinct from auth.uid() then
      raise exception 'Only the renter can request a return confirmation.' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status = 'return_requested' and new.status = 'returned' then
    if item_owner is distinct from auth.uid() then
      raise exception 'Only the item owner can confirm this return.' using errcode = '42501';
    end if;
    if old.end_date >= current_date then
      raise exception 'The owner can confirm the return after the rental end date.' using errcode = '22023';
    end if;
    return new;
  end if;
  if old.status = 'confirmed' and new.status = 'cancelled' then
    if old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid() then
      raise exception 'Only the renter or item owner can cancel this booking.' using errcode = '42501';
    end if;
    if old.start_date <= current_date then
      raise exception 'A confirmed booking can only be cancelled before its start date.' using errcode = '22023';
    end if;
    return new;
  end if;
  raise exception 'That booking status transition is not allowed.' using errcode = '22023';
end;
$$;

revoke all on function public.enforce_booking_status_transition() from public, anon, authenticated;
drop trigger if exists enforce_booking_status_transition_before_update on public.bookings;
create trigger enforce_booking_status_transition_before_update
  before update on public.bookings
  for each row execute function public.enforce_booking_status_transition();

-- This narrowly scoped RPC is called by the Edge Function after it validates
-- the Razorpay signature and fetches the captured order/payment from Razorpay.
create or replace function public.finalize_booking_payment(p_booking_id uuid, p_order_id text, p_payment_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Only the trusted payment service may finalize a booking.' using errcode = '42501';
  end if;
  if p_payment_id is null or btrim(p_payment_id) = '' then
    raise exception 'A verified payment ID is required.' using errcode = '22023';
  end if;
  if p_order_id is null or btrim(p_order_id) = '' then
    raise exception 'A verified Razorpay order ID is required.' using errcode = '22023';
  end if;
  update public.bookings
    set status = 'confirmed', payment_id = p_payment_id, paid_at = pg_catalog.now()
    where id = p_booking_id and status = 'pending_payment'
      and razorpay_order_id = p_order_id and payment_id is null and paid_at is null
      and created_at >= pg_catalog.now() - interval '15 minutes';
  return found;
end;
$$;
revoke all on function public.finalize_booking_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finalize_booking_payment(uuid, text, text) to service_role;

-- Expire stale holds from the authenticated booking panel. The transaction
-- flag lets the status guard and notification trigger recognize system expiry.
create or replace function public.expire_pending_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  perform pg_catalog.set_config('rentmate.expire_pending_bookings', 'true', true);
  update public.bookings
    set status = 'cancelled'
    where status = 'pending_payment'
      and created_at < pg_catalog.now() - interval '15 minutes';
  get diagnostics expired_count = row_count;
  perform pg_catalog.set_config('rentmate.expire_pending_bookings', 'false', true);
  return expired_count;
end;
$$;
revoke all on function public.expire_pending_bookings() from public, anon;
grant execute on function public.expire_pending_bookings() to authenticated;

-- Keep system expiry notifications addressed to the renter whose unpaid hold
-- expired; ordinary cancellation notifications still go to the other party.
create or replace function public.create_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  recipient_id uuid;
  renter_name text;
  item_title text;
  notification_type text;
  notification_title text;
  notification_body text;
begin
  select i.owner_id, i.title into owner_id, item_title from public.items as i where i.id = new.item_id;
  if not found then return new; end if;
  select coalesce(nullif(p.full_name, ''), 'The renter') into renter_name from public.profiles as p where p.id = new.renter_id;
  renter_name := coalesce(renter_name, 'The renter');
  item_title := coalesce(item_title, 'your item');
  if tg_op = 'INSERT' then
    -- Pending payment holds are not bookings the owner should act on yet.
    if new.status <> 'pending_payment' then
      recipient_id := owner_id;
      notification_type := 'new_booking';
      notification_title := 'New booking';
      notification_body := renter_name || ' booked ' || item_title || '.';
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'confirmed' and old.status = 'pending_payment' then
      recipient_id := owner_id;
      notification_type := 'booking_paid';
      notification_title := 'Booking payment received';
      notification_body := renter_name || ' paid for ' || item_title || '.';
    elsif new.status = 'picked_up' then
      recipient_id := new.renter_id;
      notification_type := 'booking_picked_up';
      notification_title := 'Your rental has been handed over';
      notification_body := item_title || ' has been marked as handed over.';
    elsif new.status = 'return_requested' then
      recipient_id := owner_id;
      notification_type := 'return_requested';
      notification_title := 'Return confirmation needed: ' || item_title;
      notification_body := renter_name || ' says ' || item_title || ' has been returned, please confirm.';
    elsif new.status = 'returned' then
      recipient_id := new.renter_id;
      notification_type := 'booking_returned';
      notification_title := 'Return confirmed';
      notification_body := 'The owner confirmed the return of ' || item_title || '.';
    elsif new.status = 'cancelled' then
      recipient_id := case
        when pg_catalog.current_setting('rentmate.expire_pending_bookings', true) = 'true' then new.renter_id
        when auth.uid() = new.renter_id then owner_id
        else new.renter_id
      end;
      notification_type := 'booking_cancelled';
      notification_title := 'Booking cancelled';
      notification_body := item_title || ' booking was cancelled.';
    end if;
  end if;
  if recipient_id is not null and notification_type is not null then
    insert into public.notifications (user_id, type, title, body, booking_id)
    values (recipient_id, notification_type, notification_title, notification_body, new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.create_booking_notification() from public, anon, authenticated;

commit;
