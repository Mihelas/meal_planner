-- --------------------------------------------------------------------------
-- Letting the members list say who somebody is.
--
-- `members()` in src/household.js wants the seats and the names in one request.
-- PostgREST will embed one table in another only along a foreign key it can
-- see, and there is no such key between these two: `household_members.user_id`
-- points at `auth.users`, `profiles.id` points at `auth.users`, and PostgREST
-- will not infer a join through a third table -- least of all one in a schema it
-- is not allowed to expose. Asking for `profiles(display_name)` today answers
-- PGRST200, "Could not find a relationship".
--
-- The alternative is two requests and a join in JavaScript, which is three
-- extra states to get wrong (one arrives, the other fails, the ids disagree) in
-- exchange for nothing. So declare the relationship that is already true.
--
-- It is true: every account has a profile. `handle_new_user()` in 0001 is an
-- `after insert` trigger on `auth.users`, so the profile row exists before that
-- account can get a token, let alone join a household. Nothing can be a member
-- without being in `profiles`, which is exactly what the constraint says.
--
-- Two foreign keys on the same column is legal, cheap, and deliberate. The one
-- to `auth.users` is what makes `user_id` an account; this one is what makes it
-- a person with a name. Dropping either would lose something.
-- --------------------------------------------------------------------------

-- Backfilled first. The constraint is validated against existing rows, and an
-- account made before 0001 ran -- the two test accounts, for instance, if they
-- were created in the dashboard before the first migration -- has no profile.
-- `display_name` defaults to '', which `members()` already falls back from.
insert into public.profiles (id)
select u.id
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

alter table public.household_members
  drop constraint if exists household_members_profile_fkey;

-- `on delete cascade` to match the existing key to `auth.users`. The two agree
-- about what a deleted account means, so neither can block the other: 0005 took
-- some care to make account deletion work, and a second key with `no action`
-- would have quietly undone it.
alter table public.household_members
  add constraint household_members_profile_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- PostgREST caches the relationships it can see. Without this it keeps
-- answering PGRST200 until the next time the API restarts for its own reasons,
-- which is a confusing half hour for anyone testing the members list.
notify pgrst, 'reload schema';
