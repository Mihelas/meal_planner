-- Making an account deletable.
--
-- 0001 declared households.created_by as `on delete restrict`, reasoning that
-- deleting the account which made a household must not silently take the
-- household and everyone else's plan with it. The reasoning was right and the
-- mechanism was wrong: restrict does not protect the household, it forbids the
-- account delete outright. Supabase reports that as "Database error deleting
-- user", with no indication of which constraint objected.
--
-- created_by is provenance, nothing more. Ownership lives in
-- household_members.role = 'owner', and no policy in 0002 reads created_by on
-- this table -- checked, the only policy that mentions created_by is the one on
-- household_invites. So the column can go null without weakening anything.
--
-- `set null` gets the behaviour restrict was reaching for, and gets it properly:
--
--   * the leaving account's household_members row cascades;
--   * the reaping trigger from 0004 fires on that delete, and bins the household
--     only if nobody is left in it;
--   * a household that still has members survives, with created_by null -- which
--     is the case restrict existed to defend, now defended without also holding
--     the account hostage.
--
-- 0001 has been corrected to match, so a database built from scratch never has
-- the restrict. This file is what brings an already-applied one into line.

do $$
declare c record;
begin
  -- By name rather than by assuming the generated one: 0001 declared the
  -- constraint inline, so its name is whatever Postgres chose.
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.households'::regclass
       and con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.households drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.households alter column created_by drop not null;

alter table public.households
  add constraint households_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

notify pgrst, 'reload schema';
