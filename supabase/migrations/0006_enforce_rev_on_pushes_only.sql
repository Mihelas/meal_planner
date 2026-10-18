-- enforce_rev() was firing on updates that are not pushes.
--
-- household_state.updated_by is a foreign key onto auth.users with
-- `on delete set null`, so deleting an account makes Postgres issue
--
--   update household_state set updated_by = null where updated_by = <that id>
--
-- which is an UPDATE, which fires this trigger, with doc and rev both untouched
-- because an FK action has no reason to touch them. The rev rule then refuses
-- it, and the refusal propagates: the account cannot be deleted at all. Supabase
-- surfaces that as "Database error deleting user" and names nothing -- the
-- constraint, the trigger and the statement are only visible by running the
-- delete in a transaction and reading the error before rolling back.
--
-- The rule itself is right, it was just scoped to "every update" instead of
-- "every push". A push is an update that changes the document or the revision;
-- nothing else on this table is the client's business to write.
--
-- Telling the two apart needs auth.uid(): an FK action during an account delete
-- runs with no JWT, so there is no caller to attribute it to. That is also what
-- keeps updated_by honest -- a member cannot hand-write it, because an update
-- that does not advance rev is refused, and one that does gets the stamp
-- overwritten below.

create or replace function public.enforce_rev()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.doc is not distinct from old.doc and new.rev = old.rev then
    if auth.uid() is not null then
      -- Refused rather than ignored: the client has no business updating this
      -- row without pushing something, and a silent no-op would look to it
      -- exactly like a successful save.
      raise exception 'that update changes nothing; a push must advance rev'
        using errcode = 'check_violation';
    end if;
    -- No caller, so not a push: an FK action or dashboard housekeeping. Let it
    -- through untouched, which is what lets the set-null above do its job.
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

notify pgrst, 'reload schema';
