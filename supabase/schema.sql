-- Rode este script no SQL Editor do seu projeto Supabase
-- (Project > SQL Editor > New query > cole e execute).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  weekly_goal integer,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users manage their own profile" on public.profiles;
create policy "Users manage their own profile"
  on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.workouts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  muscle_group text not null,
  exercise text not null,
  sets jsonb not null default '[]'::jsonb,
  note text default '',
  feeling text,
  created_at timestamptz not null default now()
);

alter table public.workouts enable row level security;

drop policy if exists "Users manage their own workouts" on public.workouts;
create policy "Users manage their own workouts"
  on public.workouts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists workouts_user_date_idx on public.workouts (user_id, date);
