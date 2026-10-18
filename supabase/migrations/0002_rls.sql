-- Row Level Security. This file is the entire security model.
--
-- The client ships a publishable key in a public HTML file, which is what that
-- key is for (A5). Nothing below trusts the client about who it is: every policy
-- resolves auth.uid() from the signed JWT, which the client cannot forge.
--
-- Read these as a whole. A table with RLS enabled and no policy for an operation
-- denies that operation outright, and several tables below rely on exactly that:
-- households, household_members and household_state have no INSERT policy at
-- all, because the only correct way to create them is the functions in 0003,
-- which do it atomically.

alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.household_state   enable row level security;

-- --------------------------------------------------------------------------
-- The two helpers that make the rest possible.
--
-- The obvious policy on household_members -- "you may read rows for households
-- you belong to" -- has to read household_members to decide whether you may read
-- household_members. Postgres either raises `infinite recursion detected in
-- policy` or, worse in a different arrangement, quietly returns nothing and the
-- app looks merely broken rather than misconfigured.
--
-- These break the cycle: security definer, so they run as the owner and are not
-- themselves filtered by the policies below. They are the only place in the
-- schema that reads membership unfiltered, which is why they are two lines each
-- and take no arguments -- there is no parameter here for a caller to abuse.
-- --------------------------------------------------------------------------

create or replace function public.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;

-- The accounts sharing a household with the caller, the caller included. Used
-- only so the app can put a name next to a meal.
create or replace function public.my_household_peers()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
    from public.household_members m
   where m.household_id in (
     select household_id from public.household_members where user_id = auth.uid()
   );
$$;

revoke execute on function public.my_household_ids() from public;
revoke execute on function public.my_household_peers() from public;
grant execute on function public.my_household_ids() to authenticated;
grant execute on function public.my_household_peers() to authenticated;

-- --------------------------------------------------------------------------
-- Clear the slate before rewriting the policies.
--
-- `create policy` has no `or replace`, so a run of this file that stops
-- partway cannot simply be run again -- and a stop partway leaves tables with
-- RLS enabled and no policy at all, which is locked shut rather than hanging
-- open, but equally broken and far from obvious. This makes the file safe to
-- re-run from the top at any point.
-- --------------------------------------------------------------------------

do $$
declare p record;
begin
  for p in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles', 'households', 'household_members',
                         'household_invites', 'household_state')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------

create policy "read own profile and household-mates"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or id in (select public.my_household_peers()));

create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy: handle_new_user() makes the row. No delete policy: deleting
-- the account cascades.

-- --------------------------------------------------------------------------
-- households
-- --------------------------------------------------------------------------

create policy "read households you belong to"
  on public.households for select
  to authenticated
  using (id in (select public.my_household_ids()));

create policy "owners rename their household"
  on public.households for update
  to authenticated
  using (id in (
    select household_id from public.household_members
     where user_id = auth.uid() and role = 'owner'
  ))
  with check (id in (
    select household_id from public.household_members
     where user_id = auth.uid() and role = 'owner'
  ));

-- No insert policy: create_household() does it, together with the owner row and
-- the state row, in one transaction. A client-side insert would be able to leave
-- a household with no members, which nothing could then read or delete.

-- --------------------------------------------------------------------------
-- household_members
-- --------------------------------------------------------------------------

create policy "read your own membership and your household-mates"
  on public.household_members for select
  to authenticated
  using (user_id = auth.uid() or household_id in (select public.my_household_ids()));

-- Leaving is allowed; removing somebody else is not. Deliberately asymmetric:
-- two people sharing a meal plan do not need the power to evict each other, and
-- a household that has lost its last member is cleaned up by the cascade.
create policy "leave a household"
  on public.household_members for delete
  to authenticated
  using (user_id = auth.uid());

-- No insert policy: redeem_invite() and create_household() are the only ways in.
-- This is the single most important omission in the file. With an insert policy
-- here, anybody could add themselves to any household whose id they could guess
-- and read the lot.

-- --------------------------------------------------------------------------
-- household_invites
-- --------------------------------------------------------------------------

-- Note what this does *not* allow: finding an invite by its code. A joining user
-- is not yet a member, so they cannot read the row -- which is why redeeming has
-- to be a function rather than a select followed by an insert.
create policy "read invites for your households"
  on public.household_invites for select
  to authenticated
  using (household_id in (select public.my_household_ids()));

create policy "members invite into their own household"
  on public.household_invites for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and household_id in (select public.my_household_ids())
  );

create policy "revoke an invite into your household"
  on public.household_invites for delete
  to authenticated
  using (household_id in (select public.my_household_ids()));

-- --------------------------------------------------------------------------
-- household_state -- the week itself
-- --------------------------------------------------------------------------

create policy "read your household's plan"
  on public.household_state for select
  to authenticated
  using (household_id in (select public.my_household_ids()));

create policy "write your household's plan"
  on public.household_state for update
  to authenticated
  using (household_id in (select public.my_household_ids()))
  with check (household_id in (select public.my_household_ids()));

-- No insert policy: create_household() makes the row. No delete policy: the plan
-- dies with the household.
