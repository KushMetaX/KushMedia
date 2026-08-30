-- Run in Supabase → SQL Editor. Dex rows; passwords stay in Supabase Auth only.

create table if not exists public.dogidex_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dog_number integer not null check (dog_number >= 1 and dog_number <= 10000),
  indexed_at bigint not null,
  unique (user_id, dog_number)
);

alter table public.dogidex_entries enable row level security;

drop policy if exists dogidex_entries_select_own on public.dogidex_entries;
create policy dogidex_entries_select_own
  on public.dogidex_entries for select
  using (auth.uid() = user_id);

drop policy if exists dogidex_entries_insert_own on public.dogidex_entries;
create policy dogidex_entries_insert_own
  on public.dogidex_entries for insert
  with check (auth.uid() = user_id);

-- Optional: updates not used by DD evaluator UI
drop policy if exists dogidex_entries_update_own on public.dogidex_entries;
create policy dogidex_entries_update_own
  on public.dogidex_entries for update
  using (auth.uid() = user_id);

drop policy if exists dogidex_entries_delete_own on public.dogidex_entries;
create policy dogidex_entries_delete_own
  on public.dogidex_entries for delete
  using (auth.uid() = user_id);
