-- RentMate item listing schema and Storage setup.
-- Run this file in the Supabase SQL Editor for the project used by the app.
-- Safe to rerun: tables are preserved, the bucket is upserted, and only the
-- named RentMate policies are replaced. No listing or image data is deleted.

-- Items belong to the authenticated owner who creates them.
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  description text,
  category text not null,
  price_per_day numeric not null check (price_per_day > 0),
  location text,
  image_url text,
  available_from date not null,
  available_to date not null,
  is_active boolean default true,
  created_at timestamptz default now(),
  constraint items_available_dates_check check (available_to >= available_from)
);

-- Row Level Security: signed-in users can browse listings; owners manage their own rows.
alter table public.items enable row level security;

drop policy if exists "Authenticated users can read items" on public.items;
create policy "Authenticated users can read items"
  on public.items for select to authenticated
  using (true);

drop policy if exists "Owners can insert their items" on public.items;
create policy "Owners can insert their items"
  on public.items for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Owners can update their items" on public.items;
create policy "Owners can update their items"
  on public.items for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Owners can delete their items" on public.items;
create policy "Owners can delete their items"
  on public.items for delete to authenticated
  using (owner_id = auth.uid());

-- Create the public item-images bucket. ON CONFLICT updates only this bucket's
-- public flag, so rerunning the script does not recreate or clear the bucket.
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do update set public = true;

-- Anyone can read images from item-images. The bucket_id condition keeps this
-- public-read policy from granting access to files in any other bucket.
drop policy if exists "Anyone can read item images" on storage.objects;
create policy "Anyone can read item images"
  on storage.objects for select to public
  using (bucket_id = 'item-images');

-- Authenticated users may upload only when the first folder in the object path
-- is their own auth user ID (for example: <user-id>/<timestamp>-<filename>).
drop policy if exists "Users can upload images to their folder" on storage.objects;
create policy "Users can upload images to their folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Users may update only objects in their own first-level user-ID folder inside
-- item-images. Both USING and WITH CHECK protect existing and resulting paths.
drop policy if exists "Users can update their item images" on storage.objects;
create policy "Users can update their item images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Users may delete only objects in their own first-level user-ID folder inside
-- item-images.
drop policy if exists "Users can delete their item images" on storage.objects;
create policy "Users can delete their item images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'item-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
