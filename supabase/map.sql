-- ============================================================================
-- watabish.com/map: neighbourhood cat map
-- Run this once in Supabase → SQL Editor (same project as /play).
-- It only creates new map_* tables, functions and a storage bucket; it does not
-- touch game_saves or anything else /play uses. Safe to re-run.
--
-- Design:
--  * Tables are closed to the browser. Every read and write goes through the
--    map_* functions below, so exact locations and user ids never leave the DB.
--  * Each cat has a private exact location and a public, offset one:
--      spotted cats move 30–80 m, needs-help and maybe-lost cats 120–260 m.
--  * Posting cats and photos needs a real (email) account. Comments can be
--    made from an anonymous session (Supabase "anonymous sign-ins").
--  * Light spam limits, and anything reported by 3 different people is hidden
--    until you un-hide it in the Table Editor (set hidden = false).
--  * Cats can be spotted, need help or be maybe lost. Dogs can only be posted
--    as maybe lost. Lost animals can be marked "back home", which takes them
--    off the map.
--  * "Found deceased" reports (cats or dogs, e.g. road kill) never use a photo
--    as their pin and drop off the map after 30 days.
--  * Spotted and maybe-lost animals can be ticked "shelter called".
-- ============================================================================

-- ---------- tables ----------------------------------------------------------

create table if not exists public.map_cats (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default 'Unnamed cat' check (char_length(name) between 1 and 40),
  status          text not null check (status in ('spotted', 'help', 'lost')),
  description     text not null default '' check (char_length(description) <= 500),
  needs           text[] not null default '{}'
                  check (needs <@ array['shelter','food','vet','tnr','injured']::text[]),
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  public_lat      double precision not null default 0,
  public_lng      double precision not null default 0,
  created_by      uuid references auth.users (id) on delete set null,
  caretaker_id    uuid references auth.users (id) on delete set null,
  caretaker_name  text check (char_length(caretaker_name) <= 40),
  cover_photo     text,
  sighting_count  integer not null default 0,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  hidden          boolean not null default false
);
create index if not exists map_cats_public_pos on public.map_cats (public_lat, public_lng);

create table if not exists public.map_sightings (
  id            uuid primary key default gen_random_uuid(),
  cat_id        uuid not null references public.map_cats (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  photo_path    text,
  note          text not null default '' check (char_length(note) <= 500),
  lat           double precision,
  lng           double precision,
  display_name  text check (char_length(display_name) <= 40),
  created_at    timestamptz not null default now(),
  hidden        boolean not null default false
);
create index if not exists map_sightings_cat on public.map_sightings (cat_id, created_at desc);
create index if not exists map_sightings_user on public.map_sightings (user_id, created_at desc);

create table if not exists public.map_comments (
  id            uuid primary key default gen_random_uuid(),
  cat_id        uuid not null references public.map_cats (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 1000),
  display_name  text check (char_length(display_name) <= 40),
  is_caretaker  boolean not null default false,
  created_at    timestamptz not null default now(),
  hidden        boolean not null default false
);
create index if not exists map_comments_cat on public.map_comments (cat_id, created_at desc);
create index if not exists map_comments_user on public.map_comments (user_id, created_at desc);

create table if not exists public.map_help_offers (
  id            uuid primary key default gen_random_uuid(),
  cat_id        uuid not null references public.map_cats (id) on delete cascade,
  need          text not null check (need in ('shelter','food','vet','tnr','injured')),
  user_id       uuid not null references auth.users (id) on delete cascade,
  display_name  text check (char_length(display_name) <= 40),
  created_at    timestamptz not null default now(),
  unique (cat_id, need, user_id)
);

create table if not exists public.map_reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('cat', 'comment', 'sighting')),
  target_id    uuid not null,
  reason       text not null default '' check (char_length(reason) <= 300),
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (target_type, target_id, user_id)
);

-- added after the first version: species (dogs only as lost) and "back home"
alter table public.map_cats add column if not exists species text not null default 'cat';
alter table public.map_cats add column if not exists home_at timestamptz;
alter table public.map_cats add column if not exists shelter_called_at timestamptz;
alter table public.map_cats add column if not exists shelter_called_by uuid references auth.users (id) on delete set null;
alter table public.map_cats add column if not exists shelter_called_name text check (char_length(shelter_called_name) <= 40);
alter table public.map_cats drop constraint if exists map_cats_status_check;
alter table public.map_cats add constraint map_cats_status_check
  check (status in ('spotted', 'help', 'lost', 'deceased'));
alter table public.map_cats drop constraint if exists map_cats_species_ok;
alter table public.map_cats add constraint map_cats_species_ok
  check (species in ('cat', 'dog') and (species = 'cat' or status in ('lost', 'deceased')));

-- Closed to the browser: no policies means no direct access even if a grant slips in.
alter table public.map_cats        enable row level security;
alter table public.map_sightings   enable row level security;
alter table public.map_comments    enable row level security;
alter table public.map_help_offers enable row level security;
alter table public.map_reports     enable row level security;
revoke all on public.map_cats, public.map_sightings, public.map_comments,
              public.map_help_offers, public.map_reports from anon, authenticated;

-- ---------- helpers ---------------------------------------------------------

-- true for a signed-in email account, false for anonymous sessions and guests
create or replace function public.map_is_full_user()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- move a point a random distance (metres) in a random direction
create or replace function public.map_jitter(p_lat double precision, p_lng double precision,
                                             min_m double precision, max_m double precision)
returns double precision[] language plpgsql volatile set search_path = '' as $$
declare d double precision := min_m + random() * (max_m - min_m);
        b double precision := random() * 2 * pi();
begin
  return array[
    p_lat + (d * cos(b)) / 111320.0,
    p_lng + (d * sin(b)) / (111320.0 * greatest(cos(radians(p_lat)), 0.01))
  ];
end $$;

-- keep the public point offset; only re-roll it when the location or privacy level changes,
-- so repeated edits can't be averaged back to the real spot
create or replace function public.map_cats_place()
returns trigger language plpgsql set search_path = '' as $$
declare j double precision[];
begin
  if tg_op = 'INSERT'
     or new.lat is distinct from old.lat or new.lng is distinct from old.lng
     or (new.status in ('spotted', 'deceased')) is distinct from (old.status in ('spotted', 'deceased')) then
    if new.status in ('spotted', 'deceased') then j := public.map_jitter(new.lat, new.lng, 30, 80);
    else j := public.map_jitter(new.lat, new.lng, 120, 260);
    end if;
    new.public_lat := j[1];
    new.public_lng := j[2];
  end if;
  -- a caretaker who deleted their account leaves no name behind
  if new.caretaker_id is null then new.caretaker_name := null; end if;
  -- a photo of an animal that died is never shown as its pin or cover
  if new.status = 'deceased' then new.cover_photo := null; end if;
  -- "shelter called" only applies to spotted and maybe-lost animals
  if new.status not in ('spotted', 'lost') then
    new.shelter_called_at := null; new.shelter_called_by := null; new.shelter_called_name := null;
  end if;
  return new;
end $$;
drop trigger if exists map_cats_place on public.map_cats;
create trigger map_cats_place before insert or update on public.map_cats
  for each row execute function public.map_cats_place();

-- when a sighting goes (e.g. its author deletes their account), keep the cat's count and cover photo honest
create or replace function public.map_sightings_gone()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.map_cats c
     set sighting_count = greatest(c.sighting_count - 1, 0),
         cover_photo = case when c.status = 'deceased' then null
           when c.cover_photo is not distinct from old.photo_path then
           (select s.photo_path from public.map_sightings s
             where s.cat_id = c.id and s.photo_path is not null and not s.hidden
             order by s.created_at limit 1)
           else c.cover_photo end
   where c.id = old.cat_id;
  return null;
end $$;
drop trigger if exists map_sightings_gone on public.map_sightings;
create trigger map_sightings_gone after delete on public.map_sightings
  for each row execute function public.map_sightings_gone();

-- ---------- reads (open to everyone, including guests) ---------------------

drop function if exists public.map_cats_in(double precision, double precision, double precision, double precision);
create function public.map_cats_in(min_lat double precision, min_lng double precision,
                                   max_lat double precision, max_lng double precision)
returns table (id uuid, species text, name text, status text, description text, needs text[],
               lat double precision, lng double precision, caretaker_name text,
               cover_photo text, sighting_count integer, last_seen_at timestamptz,
               created_at timestamptz, shelter_called boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.species, c.name, c.status, c.description, c.needs,
         c.public_lat, c.public_lng, c.caretaker_name,
         c.cover_photo, c.sighting_count, c.last_seen_at, c.created_at,
         c.shelter_called_at is not null
  from public.map_cats c
  where not c.hidden and c.home_at is null
    and not (c.status = 'deceased' and c.created_at < now() - interval '30 days')
    and c.public_lat between min_lat and max_lat
    and c.public_lng between min_lng and max_lng
  order by c.last_seen_at desc
  limit 400
$$;

create or replace function public.map_cat_detail(p_cat uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when c.id is null then null else jsonb_build_object(
    'cat', jsonb_build_object(
      'id', c.id, 'species', c.species, 'name', c.name, 'status', c.status, 'description', c.description,
      'home_at', c.home_at,
      'shelter_called_at', c.shelter_called_at, 'shelter_called_name', c.shelter_called_name,
      'can_unshelter', (auth.uid() is not null and auth.uid() in (c.shelter_called_by, c.created_by, c.caretaker_id)),
      'needs', to_jsonb(c.needs), 'lat', c.public_lat, 'lng', c.public_lng,
      'caretaker_name', c.caretaker_name, 'cover_photo', c.cover_photo,
      'sighting_count', c.sighting_count, 'last_seen_at', c.last_seen_at,
      'created_at', c.created_at,
      'i_care', (c.caretaker_id is not null and c.caretaker_id = auth.uid()),
      'can_edit', (auth.uid() is not null and auth.uid() in (c.created_by, c.caretaker_id))),
    'sightings', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'photo', s.photo_path, 'note', s.note,
               'name', s.display_name, 'at', s.created_at) order by s.created_at desc)
      from (select * from public.map_sightings
            where cat_id = c.id and not hidden order by created_at desc limit 60) s), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'name', m.display_name,
               'caretaker', m.is_caretaker, 'at', m.created_at,
               'mine', coalesce(m.user_id = auth.uid(), false)) order by m.created_at desc)
      from (select * from public.map_comments
            where cat_id = c.id and not hidden order by created_at desc limit 100) m), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object('need', o.need, 'name', o.display_name,
               'mine', coalesce(o.user_id = auth.uid(), false)) order by o.created_at)
      from public.map_help_offers o where o.cat_id = c.id), '[]'::jsonb)
  ) end
  from (select * from public.map_cats where id = p_cat and not hidden) c
$$;

-- ---------- writes ----------------------------------------------------------

-- Post a photo/sighting. p_cat = an existing cat (a match) or null for a new cat.
-- Returns the cat id.
drop function if exists public.map_post(uuid, uuid, text, text, text[], text, text, text, double precision, double precision, text);
drop function if exists public.map_post(uuid, uuid, text, text, text[], text, text, text, double precision, double precision, text, text);
create or replace function public.map_post(
  p_cat uuid, p_new_id uuid, p_name text, p_status text, p_needs text[], p_description text,
  p_photo text, p_note text, p_lat double precision, p_lng double precision, p_display text,
  p_species text default 'cat', p_shelter boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cat uuid; v_status text; v_species text := coalesce(p_species, 'cat');
begin
  if v_species not in ('cat', 'dog') then
    raise exception 'Cats and dogs only, for now.' using errcode = '22023';
  end if;
  if v_species = 'dog' and p_status is distinct from 'deceased' then p_status := 'lost'; p_needs := '{}'; end if;
  if p_status = 'deceased' and p_cat is not null then
    raise exception 'Reports of an animal that died are always posted on their own.' using errcode = '22023';
  end if;
  if not public.map_is_full_user() then
    raise exception 'Sign in with your email to post.' using errcode = '42501';
  end if;
  if p_photo is not null and (p_photo not like auth.uid()::text || '/%' or p_photo like '%..%') then
    raise exception 'Bad photo path.' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'A location is needed.' using errcode = '22023';
  end if;
  if (select count(*) from public.map_sightings
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'That''s a lot of cats for one day. Try again tomorrow.' using errcode = '54000';
  end if;

  if p_cat is not null then
    select id, status into v_cat, v_status from public.map_cats
     where id = p_cat and not hidden and species = v_species;
    if v_cat is null then raise exception 'That animal isn''t on the map anymore.' using errcode = '22023'; end if;
    -- a new sighting of an animal marked "back home" puts it back on the map
    update public.map_cats set home_at = null where id = v_cat and home_at is not null;
    -- anyone can raise the alarm on a cat; only its poster or Guardian can stand it down
    if p_status in ('help', 'lost') and v_status = 'spotted' then
      update public.map_cats set status = p_status,
             needs = (select coalesce(array_agg(distinct n), '{}') from unnest(needs || coalesce(p_needs, '{}')) n)
       where id = v_cat;
    elsif p_status = 'help' and v_status = 'help' and coalesce(array_length(p_needs, 1), 0) > 0 then
      update public.map_cats
         set needs = (select coalesce(array_agg(distinct n), '{}') from unnest(needs || p_needs) n)
       where id = v_cat;
    end if;
  else
    if (select count(*) from public.map_cats
        where created_by = auth.uid() and created_at > now() - interval '1 day') >= 10 then
      raise exception 'You''ve added 10 new cats today. Impressive. Try again tomorrow.' using errcode = '54000';
    end if;
    insert into public.map_cats (id, species, name, status, description, needs, lat, lng, created_by)
    values (coalesce(p_new_id, gen_random_uuid()), v_species,
            coalesce(nullif(btrim(p_name), ''), case when v_species = 'dog' then 'Unnamed dog' else 'Unnamed cat' end),
            coalesce(p_status, 'spotted'),
            left(coalesce(p_description, ''), 500),
            case when p_status = 'help' then coalesce(p_needs, '{}') else '{}' end,
            p_lat, p_lng, auth.uid())
    returning id into v_cat;
  end if;

  insert into public.map_sightings (cat_id, user_id, photo_path, note, lat, lng, display_name)
  values (v_cat, auth.uid(), p_photo, left(coalesce(p_note, ''), 500), p_lat, p_lng,
          nullif(left(btrim(coalesce(p_display, '')), 40), ''));

  update public.map_cats
     set sighting_count = sighting_count + 1, last_seen_at = now(),
         cover_photo = coalesce(cover_photo, p_photo)
   where id = v_cat;
  if coalesce(p_shelter, false) then
    update public.map_cats
       set shelter_called_at = now(), shelter_called_by = auth.uid(),
           shelter_called_name = coalesce(nullif(left(btrim(coalesce(p_display, '')), 40), ''), 'a neighbour')
     where id = v_cat and status in ('spotted', 'lost') and shelter_called_at is null;
  end if;
  return v_cat;
end $$;

create or replace function public.map_comment(p_cat uuid, p_body text, p_display text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_anon boolean := not public.map_is_full_user(); v_limit int;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Say something first.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.map_cats where id = p_cat and not hidden) then
    raise exception 'That cat is gone.' using errcode = '22023';
  end if;
  v_limit := case when v_anon then 3 else 8 end;
  if (select count(*) from public.map_comments
      where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= v_limit then
    raise exception 'Slow down a little. Try again in a few minutes.' using errcode = '54000';
  end if;
  insert into public.map_comments (cat_id, user_id, body, display_name, is_caretaker)
  values (p_cat, auth.uid(), left(btrim(p_body), 1000),
          case when v_anon then null else nullif(left(btrim(coalesce(p_display, '')), 40), '') end,
          exists (select 1 from public.map_cats where id = p_cat and caretaker_id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.map_delete_comment(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.map_comments where id = p_id and user_id = auth.uid()
$$;

-- toggle "I can help with <need>"; returns true when the offer is now on
create or replace function public.map_help_toggle(p_cat uuid, p_need text, p_display text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.map_is_full_user() then
    raise exception 'Sign in with your email so the Guardian can reach you.' using errcode = '42501';
  end if;
  delete from public.map_help_offers where cat_id = p_cat and need = p_need and user_id = auth.uid();
  if found then return false; end if;
  if (select count(*) from public.map_help_offers
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Generous! But that''s enough offers for today.' using errcode = '54000';
  end if;
  insert into public.map_help_offers (cat_id, need, user_id, display_name)
  values (p_cat, p_need, auth.uid(), nullif(left(btrim(coalesce(p_display, '')), 40), ''));
  return true;
end $$;

create or replace function public.map_update_cat(p_cat uuid, p_name text, p_status text,
                                                 p_description text, p_needs text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status is not null and p_status not in ('lost', 'deceased')
     and exists (select 1 from public.map_cats where id = p_cat and species = 'dog') then
    raise exception 'Dogs can only be listed as maybe lost (or found deceased).' using errcode = '22023';
  end if;
  update public.map_cats
     set name = coalesce(nullif(btrim(p_name), ''), name),
         status = coalesce(p_status, status),
         description = left(coalesce(p_description, description), 500),
         needs = case when coalesce(p_status, status) = 'help' then coalesce(p_needs, needs) else '{}' end
   where id = p_cat and auth.uid() is not null and auth.uid() in (created_by, caretaker_id);
  if not found then raise exception 'Only the person who posted this or its Guardian can edit it.' using errcode = '42501'; end if;
end $$;

create or replace function public.map_claim(p_cat uuid, p_display text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.map_is_full_user() then
    raise exception 'Sign in with your email to become a Guardian.' using errcode = '42501';
  end if;
  if exists (select 1 from public.map_cats where id = p_cat and species = 'dog') then
    raise exception 'Guardians are for neighbourhood cats. A lost dog needs its owner!' using errcode = '22023';
  end if;
  update public.map_cats
     set caretaker_id = auth.uid(),
         caretaker_name = coalesce(nullif(left(btrim(coalesce(p_display, '')), 40), ''), 'a neighbour')
   where id = p_cat and caretaker_id is null and not hidden and species = 'cat';
  if not found then raise exception 'This cat already has a Guardian.' using errcode = '23505'; end if;
end $$;

create or replace function public.map_release(p_cat uuid)
returns void language sql security definer set search_path = '' as $$
  update public.map_cats set caretaker_id = null, caretaker_name = null
   where id = p_cat and caretaker_id = auth.uid()
$$;

-- "shelter called": any signed-in neighbour can tick it; the person who ticked it,
-- the poster or the Guardian can untick it
create or replace function public.map_mark_shelter(p_cat uuid, p_on boolean, p_display text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.map_is_full_user() then
    raise exception 'Sign in with your email to tick this.' using errcode = '42501';
  end if;
  if p_on then
    update public.map_cats
       set shelter_called_at = now(), shelter_called_by = auth.uid(),
           shelter_called_name = coalesce(nullif(left(btrim(coalesce(p_display, '')), 40), ''), 'a neighbour')
     where id = p_cat and not hidden and status in ('spotted', 'lost') and shelter_called_at is null;
    if not found and not exists (select 1 from public.map_cats where id = p_cat and status in ('spotted', 'lost') and shelter_called_at is not null) then
      raise exception 'This only applies to spotted or maybe-lost animals.' using errcode = '22023';
    end if;
  else
    update public.map_cats set shelter_called_at = null, shelter_called_by = null, shelter_called_name = null
     where id = p_cat and auth.uid() in (shelter_called_by, created_by, caretaker_id);
    if not found then raise exception 'Only whoever ticked it, the poster or the Guardian can undo this.' using errcode = '42501'; end if;
  end if;
end $$;

-- a lost animal is back home (or not): its poster or Guardian can say so
create or replace function public.map_mark_home(p_cat uuid, p_home boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.map_cats set home_at = case when p_home then now() else null end
   where id = p_cat and auth.uid() is not null and auth.uid() in (created_by, caretaker_id);
  if not found then raise exception 'Only the person who posted this or its Guardian can do that.' using errcode = '42501'; end if;
end $$;

-- report something; 3 different people hides it until you review it
create or replace function public.map_report(p_type text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Not signed in.' using errcode = '42501'; end if;
  insert into public.map_reports (target_type, target_id, reason, user_id)
  values (p_type, p_id, left(coalesce(p_reason, ''), 300), auth.uid())
  on conflict do nothing;
  select count(*) into n from public.map_reports where target_type = p_type and target_id = p_id;
  if n >= 3 then
    if p_type = 'cat' then update public.map_cats set hidden = true where id = p_id;
    elsif p_type = 'comment' then update public.map_comments set hidden = true where id = p_id;
    elsif p_type = 'sighting' then update public.map_sightings set hidden = true where id = p_id;
    end if;
  end if;
end $$;

-- ---------- who can call what ----------------------------------------------

revoke execute on function public.map_jitter(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.map_cats_place() from public, anon, authenticated;
revoke execute on function public.map_sightings_gone() from public, anon, authenticated;

grant execute on function public.map_cats_in(double precision, double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.map_cat_detail(uuid) to anon, authenticated;

revoke execute on function public.map_post(uuid, uuid, text, text, text[], text, text, text, double precision, double precision, text, text, boolean) from public, anon;
revoke execute on function public.map_mark_shelter(uuid, boolean, text) from public, anon;
revoke execute on function public.map_mark_home(uuid, boolean) from public, anon;
revoke execute on function public.map_comment(uuid, text, text) from public, anon;
revoke execute on function public.map_delete_comment(uuid) from public, anon;
revoke execute on function public.map_help_toggle(uuid, text, text) from public, anon;
revoke execute on function public.map_update_cat(uuid, text, text, text, text[]) from public, anon;
revoke execute on function public.map_claim(uuid, text) from public, anon;
revoke execute on function public.map_release(uuid) from public, anon;
revoke execute on function public.map_report(text, uuid, text) from public, anon;
grant execute on function public.map_post(uuid, uuid, text, text, text[], text, text, text, double precision, double precision, text, text, boolean) to authenticated;
grant execute on function public.map_mark_shelter(uuid, boolean, text) to authenticated;
grant execute on function public.map_mark_home(uuid, boolean) to authenticated;
grant execute on function public.map_comment(uuid, text, text) to authenticated;
grant execute on function public.map_delete_comment(uuid) to authenticated;
grant execute on function public.map_help_toggle(uuid, text, text) to authenticated;
grant execute on function public.map_update_cat(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.map_claim(uuid, text) to authenticated;
grant execute on function public.map_release(uuid) to authenticated;
grant execute on function public.map_report(text, uuid, text) to authenticated;

-- ---------- photo storage ---------------------------------------------------
-- Photos are resized to ~1280 px and re-encoded in the browser, which also strips
-- their GPS metadata, before they get here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cat-photos', 'cat-photos', true, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/webp'];

drop policy if exists "cat photos: upload own" on storage.objects;
create policy "cat photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'cat-photos'
              and public.map_is_full_user()
              and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cat photos: delete own" on storage.objects;
create policy "cat photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'cat-photos' and (storage.foldername(name))[1] = auth.uid()::text);
