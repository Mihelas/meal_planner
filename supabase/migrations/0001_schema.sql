-- The tables. No policies here -- 0002_rls.sql does that, and until it has run
-- every one of these is readable by anybody holding the publishable key.
--
-- The week itself stays a JSON document (A2): nothing queries it relationally,
-- and normalising it would touch all ten modules to buy nothing. Membership is
-- the opposite -- RLS policies are SQL, and membership is the whole security
-- model, so it has to be relational.

-- An account's public face. Kept separate from auth.users because that table is
-- Supabase's, cannot carry RLS policies of ours, and holds the email.
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Home',
  -- Provenance only -- ownership is household_members.role = 'owner', and no
  -- policy reads this column. `set null` so deleting the creator's account
  -- leaves the household standing for whoever else is in it; if nobody is, the
  -- reaping trigger in 0004 takes it. (This said `restrict` until 0005, which
  -- forbade deleting the account altogether. See that file.)
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- Who is in which household, and which person inside the plan they are.
--
-- person_id is the join between an account and a seat in the document ('nick',
-- 'partner', whatever a household names its people). Free text rather than an
-- enum because every household names its own, and unique per household so two
-- accounts cannot both claim the same seat and then both be served the same
-- lunch while neither is served the other's.
create table if not exists public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  person_id    text not null check (length(person_id) between 1 and 40),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (household_id, person_id)
);

-- Every policy in 0002 looks a household up by the caller, so this index is
-- load-bearing rather than a nicety: without it each policy check is a seq scan.
create index if not exists household_members_user_idx on public.household_members (user_id);

create table if not exists public.household_invites (
  code         text primary key,
  household_id uuid not null references public.households on delete cascade,
  person_id    text not null,
  created_by   uuid not null references auth.users on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  redeemed_by  uuid references auth.users on delete set null,
  redeemed_at  timestamptz
);

create index if not exists household_invites_household_idx on public.household_invites (household_id);

-- The week. One row per household, replaced wholesale on every push.
create table if not exists public.household_state (
  household_id uuid primary key references public.households on delete cascade,
  doc          jsonb not null default '{}'::jsonb,
  rev          integer not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users on delete set null
);

-- --------------------------------------------------------------------------
-- A profile for every account, made by the database rather than by the client.
--
-- The client cannot be trusted to do this: it would have to happen after signup
-- but before the first write, and a user who closes the tab in between would
-- exist in auth.users with no profile for ever.
-- --------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
-- Empty search_path, everything schema-qualified: this runs as the owner, so a
-- caller who can create a table called `profiles` in a schema that would
-- otherwise be searched first could redirect the insert.
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------------------------
-- rev advances by exactly one, enforced here rather than hoped for.
--
-- A4 puts optimistic concurrency on rev: a push sends the rev it last saw and
-- is refused if the server has moved. That guard is only as good as the number
-- the client picks, and a client that picks wrong defeats its own protection
-- silently -- the write succeeds and the other phone's edit is gone with no
-- error anywhere. Four lines here make that impossible instead.
-- --------------------------------------------------------------------------

create or replace function public.enforce_rev()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only a push is subject to the rule. updated_by is a foreign key onto
  -- auth.users with `on delete set null`, so deleting an account issues an
  -- update here with doc and rev untouched; enforcing the rule on that refuses
  -- the account deletion outright. See 0006, which is where this was found.
  if new.doc is not distinct from old.doc and new.rev = old.rev then
    if auth.uid() is not null then
      raise exception 'that update changes nothing; a push must advance rev'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.rev <> old.rev + 1 then
    raise exception 'rev must advance by exactly one (% -> %)', old.rev, new.rev
      using errcode = 'check_violation';
  end if;
  -- Stamped here so the client cannot backdate a write and cannot blame
  -- somebody else for one.
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists household_state_rev on public.household_state;
create trigger household_state_rev
  before update on public.household_state
  for each row execute function public.enforce_rev();
