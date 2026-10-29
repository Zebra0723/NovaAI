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

-- One per signed-in Mac: what its members use to reach Claude through the proxy.
-- Only a hash is kept; the key itself is only ever on that Mac.
create table if not exists public.device_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  key_hash text not null unique,
  name text not null default 'Mac',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);

-- Claude use per account per day, for the daily allowance.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  requests integer not null default 0,
  primary key (user_id, day)
);

alter table public.memories enable row level security;
alter table public.documents enable row level security;
alter table public.device_keys enable row level security;
alter table public.ai_usage enable row level security;

create policy "own memories" on public.memories for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own documents" on public.documents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Keys and usage are read-only to their owner; only the functions (service role) write them.
create policy "own keys" on public.device_keys for select using (user_id = auth.uid());
create policy "own usage" on public.ai_usage for select using (user_id = auth.uid());

-- Called by the proxy (service role only) after each Claude call.
create or replace function public.add_ai_usage(p_user uuid, p_in bigint, p_out bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage (user_id, day, input_tokens, output_tokens, requests)
  values (p_user, (now() at time zone 'utc')::date, p_in, p_out, 1)
  on conflict (user_id, day) do update set
    input_tokens = ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = ai_usage.output_tokens + excluded.output_tokens,
    requests = ai_usage.requests + 1;
$$;
revoke all on function public.add_ai_usage(uuid, bigint, bigint) from public, anon, authenticated;
