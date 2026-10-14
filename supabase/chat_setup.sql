-- RentMate private owner-renter chat.
-- Run after profiles_setup.sql, items_setup.sql, and bookings_setup.sql.
-- This script preserves existing item and booking data and is safe to rerun.

begin;

-- One conversation per item and renter. Participant IDs are fixed when the
-- conversation is created and reference valid authenticated accounts.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  renter_id uuid not null references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversations_item_renter_unique unique (item_id, renter_id),
  constraint conversations_participants_distinct check (renter_id <> owner_id)
);

comment on table public.conversations is 'Private direct conversations between an item owner and a renter.';
comment on column public.conversations.owner_id is 'Owner of item_id when the conversation was started.';

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

comment on table public.messages is 'Private messages in RentMate owner-renter conversations.';
comment on column public.messages.sender_id is 'Authenticated user who sent this message.';

create index if not exists conversations_renter_created_idx
  on public.conversations (renter_id, created_at desc);
create index if not exists conversations_owner_created_idx
  on public.conversations (owner_id, created_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at asc);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Participants can read only conversations they belong to. Restrictive guards
-- keep leftover permissive policies from widening access on reruns or drift.
drop policy if exists "Conversation participants can read conversations" on public.conversations;
create policy "Conversation participants can read conversations"
  on public.conversations for select to authenticated
  using (renter_id = (select auth.uid()) or owner_id = (select auth.uid()));
drop policy if exists "conversation_select_security_guard" on public.conversations;
create policy "conversation_select_security_guard"
  on public.conversations as restrictive for select to public
  using (auth.uid() is not null and (renter_id = (select auth.uid()) or owner_id = (select auth.uid())));

drop policy if exists "Conversation participants can read messages" on public.messages;
create policy "Conversation participants can read messages"
  on public.messages for select to authenticated
  using (exists (
    select 1 from public.conversations as c
    where c.id = messages.conversation_id
      and (c.renter_id = (select auth.uid()) or c.owner_id = (select auth.uid()))
  ));
drop policy if exists "message_select_security_guard" on public.messages;
create policy "message_select_security_guard"
  on public.messages as restrictive for select to public
  using (auth.uid() is not null and exists (
    select 1 from public.conversations as c
    where c.id = messages.conversation_id
      and (c.renter_id = (select auth.uid()) or c.owner_id = (select auth.uid()))
  ));

-- A message can be inserted only as the signed-in sender into a conversation
-- where that sender is the stored renter or owner. No message update/delete API
-- permissions are granted.
drop policy if exists "Participants can send their own messages" on public.messages;
create policy "Participants can send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations as c
      where c.id = messages.conversation_id
        and (c.renter_id = (select auth.uid()) or c.owner_id = (select auth.uid()))
    )
  );
drop policy if exists "message_insert_security_guard" on public.messages;
create policy "message_insert_security_guard"
  on public.messages as restrictive for insert to public
  with check (
    auth.uid() is not null
    and sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations as c
      where c.id = messages.conversation_id
        and (c.renter_id = (select auth.uid()) or c.owner_id = (select auth.uid()))
    )
  );

-- Conversation rows are created only through the scoped RPCs below. Messages
-- accept only the conversation/body input; sender identity comes from auth.uid().
revoke all on table public.conversations from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
grant select on table public.conversations to authenticated;
grant select on table public.messages to authenticated;
grant insert (conversation_id, body) on table public.messages to authenticated;

-- Start or return the single conversation between the signed-in renter and an
-- item's owner. The item owner cannot start a renter conversation from a listing.
create or replace function public.start_conversation(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  item_owner_id uuid;
  conversation_uuid uuid;
begin
  if caller_id is null then
    raise exception 'Sign in before starting a conversation.' using errcode = '42501';
  end if;

  select i.owner_id into item_owner_id
  from public.items as i
  where i.id = p_item_id;
  if not found then
    raise exception 'This item is no longer available.' using errcode = 'P0002';
  end if;
  if item_owner_id = caller_id then
    raise exception 'You cannot message yourself about your own item.' using errcode = '42501';
  end if;

  insert into public.conversations (item_id, renter_id, owner_id)
  values (p_item_id, caller_id, item_owner_id)
  on conflict (item_id, renter_id) do nothing;

  select c.id into conversation_uuid
  from public.conversations as c
  where c.item_id = p_item_id and c.renter_id = caller_id;
  return conversation_uuid;
end;
$$;
revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- Booking participants can open or create the same item/renter conversation.
-- This lets an owner use Chat on a booking even before the renter has messaged.
create or replace function public.start_booking_conversation(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  booking_item_id uuid;
  booking_renter_id uuid;
  item_owner_id uuid;
  conversation_uuid uuid;
begin
  if caller_id is null then
    raise exception 'Sign in before opening a conversation.' using errcode = '42501';
  end if;

  select b.item_id, b.renter_id, i.owner_id
    into booking_item_id, booking_renter_id, item_owner_id
  from public.bookings as b
  join public.items as i on i.id = b.item_id
  where b.id = p_booking_id;
  if not found then
    raise exception 'This booking is no longer available.' using errcode = 'P0002';
  end if;
  if caller_id is distinct from booking_renter_id
     and caller_id is distinct from item_owner_id then
    raise exception 'Only this booking''s renter or item owner can open its conversation.' using errcode = '42501';
  end if;

  insert into public.conversations (item_id, renter_id, owner_id)
  values (booking_item_id, booking_renter_id, item_owner_id)
  on conflict (item_id, renter_id) do nothing;

  select c.id into conversation_uuid
  from public.conversations as c
  where c.item_id = booking_item_id and c.renter_id = booking_renter_id;
  return conversation_uuid;
end;
$$;
revoke all on function public.start_booking_conversation(uuid) from public, anon;
grant execute on function public.start_booking_conversation(uuid) to authenticated;

-- Enable idempotent Realtime publication for conversations and messages. The
-- conversations stream updates the owner's list when a renter starts a chat.
do $$
declare
  publication_is_all_tables boolean;
  table_name text;
begin
  select p.puballtables into publication_is_all_tables
  from pg_catalog.pg_publication as p
  where p.pubname = 'supabase_realtime';
  if not found then
    raise exception 'The supabase_realtime publication does not exist. Enable Supabase Realtime before applying chat_setup.sql.';
  end if;
  if publication_is_all_tables then
    return;
  end if;

  foreach table_name in array array['conversations', 'messages'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables as pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
