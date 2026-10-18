-- The three things a client cannot do for itself.
--
-- Each is `security definer`, which means it runs as its owner and the policies
-- in 0002 do not apply to it. That is the point -- and it is also why every one
-- of them re-checks membership by hand, with an empty search_path and every name
-- schema-qualified. A security definer function that forgets its own check is a
-- hole straight through the security model.

-- --------------------------------------------------------------------------
-- Invite codes.
--
-- Ten characters from a 31-letter alphabet with no O, I or L to mistype: a shade
-- under 50 bits. Drawn from gen_random_uuid(), which is a CSPRNG in Postgres 13
-- and up -- random() is not, and a guessable invite is a door into somebody
-- else's household. (256 does not divide by 31, so the draw is very slightly
-- biased; at 50 bits that costs nothing worth another dependency.)
-- --------------------------------------------------------------------------

create or replace function public.new_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (b % 31), 1), '')
    from (
      select get_byte(
               decode(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 'hex'), i
             ) as b
        from generate_series(0, 9) as i
    ) as bytes;
$$;

-- Typed off a phone screen by somebody reading it aloud, so be forgiving about
-- case, spaces and the dashes people add to break up a long code.
create or replace function public.normalise_invite_code(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- --------------------------------------------------------------------------
-- Starting a household.
--
-- Three inserts that must all happen or none: a household with no members is
-- invisible to every policy in 0002, so nobody -- not even the person who made
-- it -- could read it, write it, or delete it again.
-- --------------------------------------------------------------------------

create or replace function public.create_household(household_name text, seat text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  insert into public.households (name, created_by)
  values (coalesce(nullif(btrim(household_name), ''), 'Home'), auth.uid())
  returning id into hid;

  insert into public.household_members (household_id, user_id, role, person_id)
  values (hid, auth.uid(), 'owner', coalesce(nullif(btrim(seat), ''), 'me'));

  insert into public.household_state (household_id, doc, rev, updated_by)
  values (hid, '{}'::jsonb, 0, auth.uid());

  return hid;
end;
$$;

-- --------------------------------------------------------------------------
-- Inviting somebody into it.
-- --------------------------------------------------------------------------

create or replace function public.create_invite(
  target_household uuid,
  seat             text,
  valid_days       integer default 7
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite text;
begin
  -- The insert policy in 0002 would have done this, and does not apply here.
  if not exists (
    select 1 from public.household_members
     where household_id = target_household and user_id = auth.uid()
  ) then
    raise exception 'not a member of that household' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.household_members
     where household_id = target_household and person_id = btrim(seat)
  ) then
    raise exception 'somebody is already in that seat' using errcode = '23505';
  end if;

  invite := public.new_invite_code();

  insert into public.household_invites (code, household_id, person_id, created_by, expires_at)
  values (
    invite,
    target_household,
    btrim(seat),
    auth.uid(),
    -- Clamped: an invite that never expires is a password nobody can change.
    now() + make_interval(days => greatest(1, least(coalesce(valid_days, 7), 30)))
  );

  return invite;
end;
$$;

-- --------------------------------------------------------------------------
-- Redeeming one.
--
-- This cannot be done client-side at all: the joining account is not yet a
-- member, so no policy in 0002 lets it read the invite row to find out which
-- household the code belongs to.
-- --------------------------------------------------------------------------

create or replace function public.redeem_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid  uuid;
  seat text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Claimed by the same statement that validates it. Two phones racing one code:
  -- the first sets redeemed_by, the second matches no row. Reading first and
  -- updating after would let both pass the check and both join.
  update public.household_invites
     set redeemed_by = auth.uid(),
         redeemed_at = now()
   where code = public.normalise_invite_code(invite_code)
     and redeemed_by is null
     and expires_at > now()
  returning household_id, person_id into hid, seat;

  if hid is null then
    -- One message for wrong, expired and already-used alike. Distinguishing them
    -- would turn this function into an oracle for guessing codes.
    raise exception 'that invite is not valid' using errcode = 'P0002';
  end if;

  insert into public.household_members (household_id, user_id, role, person_id)
  values (hid, auth.uid(), 'member', seat)
  -- Redeeming twice from the same account is a double-tap, not an error.
  on conflict (household_id, user_id) do nothing;

  return hid;

exception
  -- The seat was free when the invite was written and taken by the time it was
  -- redeemed. Catching it here rolls the whole function back, invite included,
  -- so the code stays usable once the collision is sorted out.
  when unique_violation then
    raise exception 'somebody has taken that seat since the invite was made'
      using errcode = '42501';
end;
$$;

-- --------------------------------------------------------------------------
-- Who may call them. anon may call none of them: every one starts by resolving
-- auth.uid(), and a signed-out caller has none.
-- --------------------------------------------------------------------------

revoke execute on function public.new_invite_code()            from public;
revoke execute on function public.normalise_invite_code(text)  from public;
revoke execute on function public.create_household(text, text) from public;
revoke execute on function public.create_invite(uuid, text, integer) from public;
revoke execute on function public.redeem_invite(text)          from public;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.create_invite(uuid, text, integer) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;

-- new_invite_code and normalise_invite_code stay unreachable from outside: they
-- are implementation details of the two above, which call them as the owner.
