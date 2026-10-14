-- Repair the saved-default-location RPC without changing profile data or RLS.
-- Run this after mapbox_location_setup.sql if PostgREST cannot find the RPC.
-- The drop is limited to this exact signature so input argument names can be
-- corrected safely; the transaction makes replacement atomic for API callers.

begin;

-- Require the private profile-location columns added by the existing Mapbox
-- migration; fail clearly instead of installing a function that cannot run.
do $$
declare
  profile_table regclass;
begin
  profile_table := pg_catalog.to_regclass('public.profiles');
  if profile_table is null then
    raise exception 'Run mapbox_location_setup.sql first; profiles must have address, latitude, and longitude columns.';
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute where attrelid = profile_table and attname = 'address' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = profile_table and attname = 'latitude' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = profile_table and attname = 'longitude' and not attisdropped) then
    raise exception 'Run mapbox_location_setup.sql first; profiles must have address, latitude, and longitude columns.';
  end if;
end;
$$;

drop function if exists public.save_my_location(text, double precision, double precision);

-- Save only the authenticated caller's private profile location. Keep the
-- argument names and types aligned with supabase.rpc() in the booking form.
create function public.save_my_location(
  p_address text,
  p_latitude double precision,
  p_longitude double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to save your default location.' using errcode = '42501';
  end if;

  if p_address is null
     or pg_catalog.btrim(p_address) = ''
     or pg_catalog.length(pg_catalog.btrim(p_address)) > 500
     or p_latitude is null
     or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'Provide a valid address and map pin.' using errcode = '22023';
  end if;

  update public.profiles
  set address = pg_catalog.btrim(p_address),
      latitude = p_latitude,
      longitude = p_longitude
  where id = auth.uid();

  if not found then
    raise exception 'Your profile is not ready yet. Please try again.';
  end if;
end;
$$;

comment on function public.save_my_location(text, double precision, double precision)
  is 'Updates only the authenticated user’s private saved default address and coordinates.';

-- Do not expose this SECURITY DEFINER function to anonymous or PUBLIC callers.
revoke all on function public.save_my_location(text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.save_my_location(text, double precision, double precision)
  to authenticated;

-- PostgREST caches RPC signatures; reload its schema cache after replacement.
notify pgrst, 'reload schema';

commit;
