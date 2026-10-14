-- RentMate booking handover lifecycle and private notifications.
-- Run after bookings_setup.sql, booking_security_hardening.sql, and
-- location_timing_setup.sql. This migration preserves existing booking rows.
-- The initial booking remains confirmed; pending_payment is reserved for a
-- future payment flow and cannot be set directly through the current API.

begin;

-- Require the existing secure booking setup before replacing its transition
-- trigger. Location columns are needed by the protected-field comparison.
do $$
begin
  if to_regclass('public.bookings') is null or to_regclass('public.items') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Run profiles_setup.sql, items_setup.sql, and bookings_setup.sql before this migration.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.bookings'::regclass and attname = 'pickup_time' and not attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.bookings'::regclass and attname = 'meeting_lng' and not attisdropped
  ) then
    raise exception 'Run location_timing_setup.sql before this migration.';
  end if;

  -- These guards and triggers are security prerequisites, not just ordering
  -- hints. Fail closed if the database has drifted since the setup migrations.
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_insert_security_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'Renters can create their own bookings' and permissive = 'PERMISSIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_update_security_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_update_authenticated' and permissive = 'PERMISSIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_select_security_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'bookings'
      and policyname = 'booking_timing_update_guard' and permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'validate_and_price_booking_before_insert'
      and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'require_booking_times_before_insert'
      and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'enforce_booking_status_transition_before_update'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'Run and verify booking_security_hardening.sql and location_timing_setup.sql before this migration.';
  end if;
end;
$$;

-- Replace the original three-value status check with the handover lifecycle.
-- Existing confirmed, returned, and cancelled rows remain valid and untouched.
alter table public.bookings
  drop constraint if exists bookings_status_check,
  drop constraint if exists bookings_status_lifecycle_check;
alter table public.bookings
  add constraint bookings_status_lifecycle_check
  check (status in (
    'pending_payment', 'confirmed', 'picked_up',
    'return_requested', 'returned', 'cancelled'
  ));
alter table public.bookings alter column status set default 'confirmed';

-- Reserve dates during payment, confirmed rental, handover, and return review.
-- Cancelled and returned bookings no longer block those dates. daterange(...,'[]')
-- retains inclusive end-date semantics and remains concurrency-safe.
alter table public.bookings
  drop constraint if exists bookings_no_confirmed_overlap;
alter table public.bookings
  add constraint bookings_no_confirmed_overlap
  exclude using gist (
    item_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending_payment', 'confirmed', 'picked_up', 'return_requested'));

-- Match the availability RPC to the exclusion constraint's blocking statuses.
create or replace function public.get_booked_ranges(p_item_id uuid)
returns table (start_date date, end_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select b.start_date, b.end_date
  from public.bookings as b
  where auth.uid() is not null
    and b.item_id = p_item_id
    and b.status in ('pending_payment', 'confirmed', 'picked_up', 'return_requested')
  order by b.start_date;
$$;
revoke all on function public.get_booked_ranges(uuid) from public, anon;
grant execute on function public.get_booked_ranges(uuid) to authenticated;

-- Enforce participant-only scheduling edits and the explicit handover state
-- machine. API column grants and RLS policies from booking_security_hardening
-- remain in force; the trigger also rejects protected-field changes directly.
create or replace function public.enforce_booking_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_owner uuid;
  allowed_meeting_fields text[] := array[
    'pickup_time', 'return_time', 'meeting_spot', 'meeting_lat', 'meeting_lng'
  ];
begin
  select i.owner_id into item_owner
    from public.items as i where i.id = old.item_id;

  if new.status is not distinct from old.status then
    if old.status <> 'confirmed' then
      raise exception 'Only confirmed bookings can be edited.' using errcode = '22023';
    end if;
    if auth.uid() is null
       or (old.renter_id is distinct from auth.uid() and item_owner is distinct from auth.uid()) then
      raise exception 'Only the renter or item owner can edit this booking.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - allowed_meeting_fields)
       is distinct from (to_jsonb(old) - allowed_meeting_fields) then
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

  -- Status transitions may alter only status; they cannot smuggle meeting edits.
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Update booking status separately from meeting details.' using errcode = '22023';
  end if;
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

  -- pending_payment is a valid blocking status for a future trusted payment
  -- flow, but no client transition into or out of it is permitted today.
  raise exception 'That booking status transition is not allowed.' using errcode = '22023';
end;
$$;
-- The trigger invokes this function; API roles must not be able to call it
-- directly. SECURITY DEFINER lets the trigger safely read the item's owner
-- even when the caller's item SELECT policy hides an inactive listing.
revoke all on function public.enforce_booking_status_transition() from public, anon, authenticated;

-- Persist notifications separately from booking state. User-facing rows are
-- private to their recipient; booking deletion cascades only its notifications.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.notifications is 'Private RentMate booking notifications, one row per recipient and event.';
comment on column public.notifications.user_id is 'The authenticated user who receives this notification.';
comment on column public.notifications.booking_id is 'Booking related to this notification; deleting the booking removes its notifications.';

alter table public.notifications enable row level security;
drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
-- Restrictive guards ensure leftover permissive policies cannot widen access.
drop policy if exists "notifications_select_security_guard" on public.notifications;
create policy "notifications_select_security_guard"
  on public.notifications as restrictive for select to public
  using (auth.uid() is not null and user_id = (select auth.uid()));

drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "notifications_update_security_guard" on public.notifications;
create policy "notifications_update_security_guard"
  on public.notifications as restrictive for update to public
  using (auth.uid() is not null and user_id = (select auth.uid()))
  with check (auth.uid() is not null and user_id = (select auth.uid()));

-- Notification writes and deletes are trigger-only. These restrictive guards
-- also block any legacy permissive policy if table privileges are later widened.
drop policy if exists "notifications_insert_security_guard" on public.notifications;
create policy "notifications_insert_security_guard"
  on public.notifications as restrictive for insert to public
  with check (false);
drop policy if exists "notifications_delete_security_guard" on public.notifications;
create policy "notifications_delete_security_guard"
  on public.notifications as restrictive for delete to public
  using (false);

-- Restrict client writes to is_read only. Notification contents and recipients
-- are created exclusively by the booking trigger below.
revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (is_read) on table public.notifications to authenticated;

-- Create a notification for each booking event. This SECURITY DEFINER trigger
-- uses a fixed search_path and derives both recipient and message from the
-- booking, item, profile, and authenticated actor rather than client input.
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
  select i.owner_id, i.title
    into owner_id, item_title
    from public.items as i
    where i.id = new.item_id;
  if not found then
    return new;
  end if;

  select coalesce(nullif(p.full_name, ''), 'The renter')
    into renter_name
    from public.profiles as p
    where p.id = new.renter_id;
  renter_name := coalesce(renter_name, 'The renter');
  item_title := coalesce(item_title, 'your item');

  if tg_op = 'INSERT' then
    recipient_id := owner_id;
    notification_type := 'new_booking';
    notification_title := 'New booking';
    notification_body := renter_name || ' booked ' || item_title || '.';
  elsif new.status is distinct from old.status then
    if new.status = 'picked_up' then
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
      recipient_id := case when auth.uid() = new.renter_id then owner_id else new.renter_id end;
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
drop trigger if exists create_booking_notification_after_change on public.bookings;
create trigger create_booking_notification_after_change
  after insert or update of status on public.bookings
  for each row execute function public.create_booking_notification();

-- Enable private notification INSERT events for Supabase Realtime. Keep this
-- idempotent so rerunning the migration does not try to add the table twice.
do $$
declare
  publication_is_all_tables boolean;
begin
  select puballtables into publication_is_all_tables
  from pg_catalog.pg_publication
  where pubname = 'supabase_realtime';

  if not found then
    raise exception 'The supabase_realtime publication does not exist. Enable Supabase Realtime before applying this migration.';
  end if;

  if publication_is_all_tables then
    return;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

commit;
