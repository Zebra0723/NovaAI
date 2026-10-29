-- The consumer Galaxy's account data. Every row belongs to one account (user_id), and
-- row-level security means an account can only ever see or change its own rows.

create table if not exists public.memories (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  text text not null,
  source text not null default 'user',
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, id)
);

-- Anything else an account keeps: each member's training ("training"), settings.
create table if not exists public.documents (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.memories enable row level security;
alter table public.documents enable row level security;

create policy "own memories" on public.memories for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own documents" on public.documents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
