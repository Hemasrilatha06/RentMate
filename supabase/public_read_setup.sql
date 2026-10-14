-- Public RentMate browsing access. Run after the existing item, booking,
-- location, and handover setup migrations. Safe to rerun; no rows are changed.

-- Anonymous visitors may read only public listing fields; exact coordinates
-- and the pickup address are private columns. Existing authenticated read and
-- owner write policies remain unchanged. Column grants keep reruns from
-- restoring broad access after mapbox_location_setup.sql is applied.
revoke select on table public.items from anon, public;
grant select (id, owner_id, title, description, category, price_per_day, location,
              image_url, available_from, available_to, is_active, created_at)
  on table public.items to anon;
drop policy if exists "Anonymous users can read active items" on public.items;
create policy "Anonymous users can read active items"
  on public.items for select to anon
  using (is_active is true);

-- The function returns only booked date ranges for one item; it does not expose
-- renter identities or other booking details. Regrant after later migrations,
-- since those setup scripts may revoke anonymous execution.
grant execute on function public.get_booked_ranges(uuid) to anon;

-- Return marketplace totals without making booking rows or personal details
-- publicly readable. Counts include all booking statuses because this is a
-- total of bookings made, not an availability calculation.
create or replace function public.get_public_marketplace_stats()
returns table (items_listed bigint, categories_count bigint, bookings_made bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.items as i where i.is_active is true),
    (select count(distinct i.category) from public.items as i where i.is_active is true),
    (select count(*) from public.bookings);
$$;

comment on function public.get_public_marketplace_stats() is
  'Returns aggregate marketplace totals only; exposes no individual item or booking rows.';

revoke all on function public.get_public_marketplace_stats() from public, anon, authenticated;
grant execute on function public.get_public_marketplace_stats() to anon, authenticated;
