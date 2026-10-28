-- A household that loses its owner.
--
-- 0002 lets anybody delete their own membership row -- `leave a household`,
-- `using (user_id = auth.uid())` -- and that is right: two people sharing a meal
-- plan should be able to walk away from it without asking permission. But the
-- policy does not care *which* member is leaving, so an owner can walk out while
-- somebody else is still in the household, and what is left behind has members
-- and no owner.
--
-- Nothing about that looks broken from inside the app. The plan still syncs,
-- invites still work, every policy in 0002 that keys off membership still
-- matches. What is gone is everything that keys off `role = 'owner'`:
--
--   * `owners rename their household` (0002) matches nobody
--   * `delete_household` (0004) refuses everybody, the people in it included
--   * `reap_empty_household` (0004) only fires once the *last* member goes
--
-- So the household becomes permanently unmanageable, and the only way out is for
-- everyone to leave one at a time until the reaper takes it -- which also takes
-- the week with it.
--
-- Promote rather than refuse. Refusing the owner's own exit sounds safer and is
-- worse: it strands the household the moment that person simply stops using the
-- app, and escaping *that* needs an ownership hand-over UI which two people
-- sharing a dinner plan should not have to learn. Promotion has no dead end --
-- somebody is always in charge, and in a household of two the person left behind
-- is the only candidate there was.

create or replace function public.promote_on_owner_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only when the household has just lost its last owner. A plain member
  -- leaving, or an owner leaving while another owner remains, is nothing to do.
  if exists (
    select 1 from public.household_members
     where household_id = old.household_id and role = 'owner'
  ) then
    return old;
  end if;

  -- Longest-standing first. `user_id` is the tie-break rather than decoration:
  -- two people redeeming invites in the same transaction can share a joined_at,
  -- and without a total order the winner would be whichever row the planner
  -- happened to return -- a trigger that behaves differently on Tuesday.
  update public.household_members m
     set role = 'owner'
   where m.household_id = old.household_id
     and m.user_id = (
       select user_id
         from public.household_members
        where household_id = old.household_id
        order by joined_at, user_id
        limit 1
     );

  -- No rows, and nothing to do, when that was the last member: the subquery
  -- finds nobody and `reap_empty_household` takes the household a moment later.
  return old;
end;
$$;

-- Independent of the reaping trigger on the same event, not ordered against it:
-- this one is a no-op on an empty household and that one is a no-op on a
-- populated one, so they can never both act on the same delete.
drop trigger if exists household_members_promote on public.household_members;
create trigger household_members_promote
  after delete on public.household_members
  for each row execute function public.promote_on_owner_exit();

-- Deliberately `after delete` on the row rather than something the client calls:
-- it fires for a cascade too, so an owner's account disappearing takes the same
-- path as an owner pressing Leave.
