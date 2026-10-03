-- Shelf Oracle schema — run in Supabase SQL editor.
-- Access pattern: organizers via SSR session + org_members checks in code;
-- all data access through the service-role key in route handlers / server
-- components. RLS stays enabled as defence-in-depth.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  primary key (org_id, user_id)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  slug text not null unique,
  name text not null,
  location text,
  status text not null default 'setup'
    check (status in ('setup','intake','locked','voting','revealed','closed')),
  draft jsonb,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  settings_version integer not null default 0,
  products_version integer not null default 0,
  reveal jsonb,
  locked_at timestamptz,
  lock_hash text,
  created_at timestamptz not null default now()
);
create index if not exists events_org_idx on events(org_id);
alter table events add column if not exists settings jsonb not null default '{}'::jsonb;
alter table events add column if not exists settings_version integer not null default 0;
alter table events add column if not exists products_version integer not null default 0;

create table if not exists shelf_images (
  id bigint generated always as identity primary key,
  event_id uuid not null references events(id) on delete cascade,
  image text not null,
  detected_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shelf_images_event_idx on shelf_images(event_id);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shelf-oracle-shelves', 'shelf-oracle-shelves', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  brand text not null,
  name text not null,
  category text,
  format text,
  price text,
  claims text[] not null default '{}',
  attributes jsonb not null default '{}',
  box jsonb,
  thumb text,
  source_image_id bigint references shelf_images(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists products_event_idx on products(event_id);

create table if not exists predictions (
  event_id uuid primary key references events(id) on delete cascade,
  locked_at timestamptz not null,
  hash text not null,
  payload jsonb not null
);

create table if not exists human_predictions (
  id bigint generated always as identity primary key,
  event_id uuid not null references events(id) on delete cascade,
  voter_id text not null,
  display_name text not null check (char_length(display_name) <= 30),
  top5 uuid[] not null check (array_length(top5,1) = 5),
  created_at timestamptz not null default now(),
  unique (event_id, voter_id)
);
create index if not exists human_predictions_event_idx on human_predictions(event_id);

create table if not exists votes (
  id bigint generated always as identity primary key,
  event_id uuid not null references events(id) on delete cascade,
  voter_id text not null,
  product_id uuid not null references products(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 280),
  created_at timestamptz not null default now(),
  unique (event_id, voter_id, product_id)
);
create index if not exists votes_event_idx on votes(event_id);
create index if not exists votes_product_idx on votes(product_id);

-- RLS: enabled everywhere; service role bypasses it, anon gets nothing
-- (anon attendees write via service-role route handlers, never directly).
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table events enable row level security;
alter table shelf_images enable row level security;
alter table products enable row level security;
alter table predictions enable row level security;
alter table human_predictions enable row level security;
alter table votes enable row level security;

create or replace function is_member_of(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.org_members m
    where m.org_id = org and m.user_id = auth.uid())
$$;

drop policy if exists "members read own orgs" on orgs;
drop policy if exists "members read own org rows" on org_members;
drop policy if exists "members read own events" on events;
drop policy if exists "members read own shelf images" on shelf_images;
drop policy if exists "members read own products" on products;
drop policy if exists "members read own predictions" on predictions;
drop policy if exists "members read own guesses" on human_predictions;
drop policy if exists "members read own votes" on votes;
create policy "members read own orgs" on orgs for select using (is_member_of(id));
create policy "members read own org rows" on org_members for select using (is_member_of(org_id));
create policy "members read own events" on events for select using (is_member_of(org_id));
create policy "members read own shelf images" on shelf_images for select using
  (exists(select 1 from events e where e.id = event_id and is_member_of(e.org_id)));
create policy "members read own products" on products for select using
  (exists(select 1 from events e where e.id = event_id and is_member_of(e.org_id)));
create policy "members read own predictions" on predictions for select using
  (exists(select 1 from events e where e.id = event_id and is_member_of(e.org_id)));
create policy "members read own guesses" on human_predictions for select using
  (exists(select 1 from events e where e.id = event_id and is_member_of(e.org_id)));
create policy "members read own votes" on votes for select using
  (exists(select 1 from events e where e.id = event_id and is_member_of(e.org_id)));

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function lock_event_prediction(
  p_event_id uuid, p_expected_draft jsonb, p_payload jsonb,
  p_canonical text, p_hash text
) returns jsonb language plpgsql set search_path = public, extensions as $$
declare
  current_event events%rowtype;
  time_locked timestamptz;
begin
  select * into current_event from events where id = p_event_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if current_event.status not in ('setup', 'intake') or current_event.lock_hash is not null
     or exists(select 1 from predictions where event_id = p_event_id) then
    return jsonb_build_object('outcome', 'already_locked');
  end if;
  if current_event.draft is null or current_event.draft <> p_expected_draft then
    return jsonb_build_object('outcome', 'draft_changed');
  end if;
  if jsonb_typeof(current_event.draft->'items') is distinct from 'array' then
    return jsonb_build_object('outcome', 'products_changed');
  end if;
  if jsonb_array_length(current_event.draft->'items') = 0 or
     jsonb_array_length(current_event.draft->'items') <> (select count(*) from products where event_id = p_event_id) or
     exists(select 1 from products p where p.event_id = p_event_id and not exists (
       select 1 from jsonb_array_elements(current_event.draft->'items') item
       where item->>'productId' = p.id::text and item->>'brand' = p.brand and item->>'name' = p.name
     )) then
    return jsonb_build_object('outcome', 'products_changed');
  end if;
  if p_payload - 'lockedAt' <> current_event.draft
     or not (p_payload ? 'lockedAt')
     or p_canonical::jsonb <> p_payload
     or p_hash <> encode(digest(convert_to(p_canonical, 'UTF8'), 'sha256'), 'hex') then
    return jsonb_build_object('outcome', 'invalid_payload');
  end if;
  time_locked := (p_payload->>'lockedAt')::timestamptz;
  insert into predictions(event_id, locked_at, hash, payload)
    values (p_event_id, time_locked, p_hash, p_payload);
  update events set status = 'voting', locked_at = time_locked, lock_hash = p_hash
    where id = p_event_id;
  return jsonb_build_object('outcome', 'locked', 'lockedAt', p_payload->>'lockedAt', 'hash', p_hash);
end;
$$;
revoke all on function lock_event_prediction(uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function lock_event_prediction(uuid, jsonb, jsonb, text, text) to service_role;

create or replace function guard_event_lifecycle() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.settings is distinct from old.settings then
    if new.settings_version <> old.settings_version + 1 or new.draft is not null then
      raise exception 'Rubric change must invalidate the draft';
    end if;
  elsif new.settings_version is distinct from old.settings_version then
    raise exception 'Invalid rubric version';
  end if;
  if old.lock_hash is not null then
    if new.lock_hash is distinct from old.lock_hash or new.locked_at is distinct from old.locked_at
       or new.draft is distinct from old.draft or new.settings is distinct from old.settings
       or new.products_version is distinct from old.products_version then
      raise exception 'Locked prediction is immutable';
    end if;
    if new.status is distinct from old.status and not (
      (old.status = 'voting' and new.status = 'locked') or
      (old.status = 'locked' and new.status = 'revealed' and new.reveal is not null) or
      (old.status = 'revealed' and new.status = 'closed')
    ) then raise exception 'Invalid event status transition'; end if;
    if old.reveal is not null and new.reveal is distinct from old.reveal then
      raise exception 'Published or cached reveal is immutable';
    end if;
    if old.reveal is null and new.reveal is not null and new.status <> 'locked' then
      raise exception 'Freeze voting before building reveal';
    end if;
  else
    if new.status not in ('setup', 'intake', 'voting') or
       (old.status = 'intake' and new.status = 'setup') or
       (new.status = 'voting' and (new.lock_hash is null or new.locked_at is null or
         not exists(select 1 from predictions p where p.event_id = new.id and p.hash = new.lock_hash
           and p.locked_at = new.locked_at and p.payload - 'lockedAt' = new.draft))) or
       (new.lock_hash is not null and new.status <> 'voting') or new.reveal is not null then
      raise exception 'Invalid event status transition';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists event_lifecycle_guard on events;
create trigger event_lifecycle_guard before update on events
  for each row execute function guard_event_lifecycle();

create or replace function guard_prediction_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Locked prediction is immutable';
end;
$$;
drop trigger if exists prediction_immutable on predictions;
create trigger prediction_immutable before update or delete on predictions
  for each row execute function guard_prediction_immutable();

create or replace function guard_voting_phase() returns trigger
language plpgsql set search_path = public as $$
declare
  event_status text;
begin
  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then raise exception 'Cannot move a vote or guess'; end if;
    if tg_table_name = 'votes' then
      if new.product_id is distinct from old.product_id then raise exception 'Cannot move a vote'; end if;
    else
      raise exception 'Guesses are insert-only';
    end if;
  end if;
  select status into event_status from events where id = new.event_id for share;
  if event_status is distinct from 'voting' then raise exception 'Voting is closed'; end if;
  if tg_table_name = 'votes' then
    if not exists (select 1 from products where id = new.product_id and event_id = new.event_id)
      then raise exception 'Product does not belong to event'; end if;
  else
    if array_length(new.top5, 1) <> 5 or
       (select count(distinct pid) from unnest(new.top5) as pid) <> 5 or
       exists(select 1 from unnest(new.top5) as pid
         where not exists(select 1 from products where id = pid and event_id = new.event_id))
      then raise exception 'Guess must contain five distinct event products'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists voting_phase_guard on votes;
create trigger voting_phase_guard before insert or update on votes
  for each row execute function guard_voting_phase();
drop trigger if exists guess_phase_guard on human_predictions;
create trigger guess_phase_guard before insert or update on human_predictions
  for each row execute function guard_voting_phase();

create or replace function guard_product_intake() returns trigger
language plpgsql set search_path = public as $$
declare
  event_status text;
begin
  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception 'Cannot move a product between events';
  end if;
  select status into event_status from events
    where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end for update;
  if event_status not in ('setup', 'intake') then raise exception 'Intake is closed'; end if;
  update events set draft = null, products_version = products_version + 1
    where id = case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists product_intake_guard on products;
create trigger product_intake_guard before insert or update or delete on products
  for each row execute function guard_product_intake();
drop trigger if exists shelf_intake_guard on shelf_images;
create trigger shelf_intake_guard before insert or update or delete on shelf_images
  for each row execute function guard_product_intake();
