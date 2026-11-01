-- Kush: review and run this in the Supabase SQL editor. Do not apply it from the app.
-- It enables row level security. It does not drop tables or columns.
--
-- Before running, list public tables:
--   select tablename from pg_tables where schemaname = 'public' order by 1;
--
-- dogidex_entries is the table the browser reads with the anon key.
-- Community lore is a JSON file on the Node server, not a Supabase table.
-- The block at the bottom is only for a future public.community_lore table.

alter table if exists public.dogidex_entries enable row level security;

drop policy if exists dogidex_entries_select_own on public.dogidex_entries;
create policy dogidex_entries_select_own
  on public.dogidex_entries for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists dogidex_entries_insert_own on public.dogidex_entries;
create policy dogidex_entries_insert_own
  on public.dogidex_entries for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists dogidex_entries_update_own on public.dogidex_entries;
create policy dogidex_entries_update_own
  on public.dogidex_entries for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists dogidex_entries_delete_own on public.dogidex_entries;
create policy dogidex_entries_delete_own
  on public.dogidex_entries for delete
  to authenticated
  using (auth.uid() = user_id);

-- Lock every other public table to the table owner / service role until you
-- add an explicit policy. Confirm the list above first. Service role bypasses RLS.
do $$
declare r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename <> 'dogidex_entries'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- Auth dashboard (not SQL): Authentication → URL configuration
-- Site URL: https://kushmedia.xyz
-- Redirect URLs: https://kushmedia.xyz/*
-- Remove every other redirect URL.

-- Future only, if lore moves into Supabase. Do not run unless that table exists.
-- alter table public.community_lore enable row level security;
-- create policy community_lore_public_read
--   on public.community_lore for select
--   to anon, authenticated
--   using (status = 'approved');
-- create policy community_lore_owner_write
--   on public.community_lore for all
--   to authenticated
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
