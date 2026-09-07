-- Rode este script no SQL Editor do seu projeto Supabase
-- (Project > SQL Editor > New query > cole e execute).

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  weekly_goal integer,
  monthly_goal integer,
  weight_goal_kg numeric,
  ai_suggestions jsonb,
  ai_suggestions_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists ai_suggestions jsonb;
alter table public.profiles add column if not exists ai_suggestions_at timestamptz;
alter table public.profiles add column if not exists monthly_goal integer;
alter table public.profiles add column if not exists weight_goal_kg numeric;

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

create table if not exists public.body_weight_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.body_weight_logs enable row level security;

drop policy if exists "Users manage their own weight logs" on public.body_weight_logs;
create policy "Users manage their own weight logs"
  on public.body_weight_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists body_weight_logs_user_date_idx on public.body_weight_logs (user_id, date);
