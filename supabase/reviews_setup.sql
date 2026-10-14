-- RentMate ratings and reviews. Run after profiles_setup.sql, items_setup.sql,
-- and bookings_setup.sql. This script is safe to rerun and preserves review data.

-- One review per returned booking; deleting a booking or item removes its reviews.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users (id),
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

-- Keep row access behind RLS; authenticated users may read published reviews.
alter table public.reviews enable row level security;
drop policy if exists "Authenticated users can read reviews" on public.reviews;
create policy "Authenticated users can read reviews"
  on public.reviews for select to authenticated
  using (true);

-- A renter may review only their own returned booking and its associated item.
drop policy if exists "Renters can review their returned bookings" on public.reviews;
create policy "Renters can review their returned bookings"
  on public.reviews for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and exists (
      select 1
      from public.bookings as b
      where b.id = reviews.booking_id
        and b.renter_id = (select auth.uid())
        and b.status = 'returned'
        and b.item_id = reviews.item_id
    )
  );

-- Review authors can edit or remove only their own reviews.
drop policy if exists "Reviewers can update their own reviews" on public.reviews;
create policy "Reviewers can update their own reviews"
  on public.reviews for update to authenticated
  using (reviewer_id = (select auth.uid()))
  with check (reviewer_id = (select auth.uid()));
drop policy if exists "Reviewers can delete their own reviews" on public.reviews;
create policy "Reviewers can delete their own reviews"
  on public.reviews for delete to authenticated
  using (reviewer_id = (select auth.uid()));

-- Grant only the table operations used by the authenticated review UI; RLS
-- still limits which rows each user may read or change.
grant select, insert, update, delete on public.reviews to authenticated;

-- Summarize ratings for item cards and item detail pages. Security invoker
-- keeps the view subject to the caller's review-table RLS policy.
create or replace view public.item_rating_summary
with (security_invoker = true)
as
  select item_id,
         round(avg(rating)::numeric, 1) as average_rating,
         count(*)::integer as review_count
  from public.reviews
  group by item_id;
grant select on public.item_rating_summary to authenticated;
