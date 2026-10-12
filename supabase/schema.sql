-- Stemmenstudio: database voor accounts. Plak dit in Supabase: SQL Editor > New query > Run.
-- Elke gebruiker ziet en wijzigt alleen zijn eigen rijen (Row Level Security).

create table if not exists public.ss_clips (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create table if not exists public.ss_takes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.ss_clips enable row level security;
alter table public.ss_takes enable row level security;

drop policy if exists "eigen clips" on public.ss_clips;
create policy "eigen clips" on public.ss_clips for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "eigen takes" on public.ss_takes;
create policy "eigen takes" on public.ss_takes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Opslag voor de stemopnames: privé, alleen in je eigen map (<user-id>/<take-id>).
insert into storage.buckets (id, name, public) values ('takes', 'takes', false)
  on conflict (id) do nothing;

drop policy if exists "ss eigen opnames lezen" on storage.objects;
create policy "ss eigen opnames lezen" on storage.objects for select
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ss eigen opnames toevoegen" on storage.objects;
create policy "ss eigen opnames toevoegen" on storage.objects for insert
  with check (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ss eigen opnames wijzigen" on storage.objects;
create policy "ss eigen opnames wijzigen" on storage.objects for update
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "ss eigen opnames verwijderen" on storage.objects;
create policy "ss eigen opnames verwijderen" on storage.objects for delete
  using (bucket_id = 'takes' and (storage.foldername(name))[1] = auth.uid()::text);
