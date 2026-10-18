-- Closing the gap 0002 left: nothing could delete a household.
--
-- Leaving was allowed and evicting was not, deliberately -- two people sharing a
-- meal plan do not need the power to throw each other out. But that left the
-- other end open: a household whose last member walked out kept its row, its
-- invites and its plan, and no policy in 0002 could reach any of it again. Rows
-- nobody can read, write or remove.
--
-- Two halves, because there are two ways a household ends. Somebody deliberately
-- bins it, or the last person drifts out of it.

-- --------------------------------------------------------------------------
-- The deliberate way.
--
-- Owner only, and not while anybody else is still in it: the owner of a shared
-- plan should not be able to delete the week out from under the person they
-- share it with. They leave first, then it can go.
-- --------------------------------------------------------------------------

create or replace function public.delete_household(target_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  others integer;
begin
  if not exists (
    select 1 from public.household_members
     where household_id = target_household
       and user_id = auth.uid()
       and role = 'owner'
  ) then
    -- Same message whether they are a plain member or not in it at all: there is
    -- no reason to confirm to a stranger that a given household id exists.
    raise exception 'only an owner can delete a household' using errcode = '42501';
  end if;

  select count(*) into others
    from public.household_members
   where household_id = target_household
     and user_id <> auth.uid();

  if others > 0 then
    raise exception 'ask the other % member(s) to leave first', others
      using errcode = '42501';
  end if;

  -- members, invites and state all cascade from here.
  delete from public.households where id = target_household;
end;
$$;

revoke execute on function public.delete_household(uuid) from public;
grant execute on function public.delete_household(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- The drifting-out way.
--
-- A trigger rather than something the client remembers to call, because the
-- client that should call it is the one that has just removed its own last
-- reason to care. `after delete` on the membership row: if that was the last
-- one, the household goes with it.
--
-- Note this runs as the deleting user, not as an owner, and needs no permission
-- check -- it only ever fires on a row that user was already allowed to delete,
-- and only when the household it pointed at has nobody left in it.
-- --------------------------------------------------------------------------

create or replace function public.reap_empty_household()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.household_members where household_id = old.household_id
  ) then
    delete from public.households where id = old.household_id;
  end if;
  return old;
end;
$$;

drop trigger if exists household_members_reap on public.household_members;
create trigger household_members_reap
  after delete on public.household_members
  for each row execute function public.reap_empty_household();

notify pgrst, 'reload schema';
