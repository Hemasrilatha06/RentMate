-- Extend the existing limited availability RPC with return_time so Browse and
-- Item Details can show when an active booking ends. Run after bookings_setup.sql,
-- location_timing_setup.sql, and handover_notifications_setup.sql.
-- This still exposes only blocking dates and return times to signed-in users;
-- renter identity, price, meeting details, and other booking fields stay private.

begin;

do $$
begin
  if to_regclass('public.bookings') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'bookings' and column_name = 'return_time'
     ) then
    raise exception 'Run location_timing_setup.sql before booking_availability_return_time.sql.';
  end if;
end;
$$;

-- PostgreSQL cannot change a table-returning function's row type in place.
drop function if exists public.get_booked_ranges(uuid);

create function public.get_booked_ranges(p_item_id uuid)
returns table (start_date date, end_date date, return_time time without time zone)
language sql
stable
security definer
set search_path = ''
as $$
  select b.start_date, b.end_date, b.return_time
  from public.bookings as b
  where auth.uid() is not null
    and b.item_id = p_item_id
    and b.status in ('pending_payment', 'confirmed', 'picked_up', 'return_requested')
  order by b.start_date;
$$;

comment on function public.get_booked_ranges(uuid) is
  'Returns only blocking booking dates and return times to authenticated users for availability display.';

revoke all on function public.get_booked_ranges(uuid) from public, anon;
grant execute on function public.get_booked_ranges(uuid) to authenticated;

commit;
