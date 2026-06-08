create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  occasion text not null,
  status text not null default 'open',
  max_photos_per_member int not null default 5,
  music_genre text,
  created_by_token text not null,
  created_at timestamptz default now()
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  name text not null,
  session_token text unique not null,
  session_token_expires_at timestamptz not null,
  photos_uploaded int not null default 0,
  joined_at timestamptz default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  storage_path text not null,
  display_order int not null,
  uploaded_at timestamptz default now()
);

create table if not exists reels (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade unique,
  render_id text,
  mp4_url text,
  status text not null default 'pending',
  created_at timestamptz default now()
);

alter table rooms add column if not exists code text;
alter table rooms add column if not exists name text;
alter table rooms add column if not exists occasion text;
alter table rooms add column if not exists status text not null default 'open';
alter table rooms add column if not exists max_photos_per_member int not null default 5;
alter table rooms add column if not exists music_genre text;
alter table rooms add column if not exists created_by_token text;
alter table rooms add column if not exists created_at timestamptz default now();

alter table members add column if not exists room_id uuid references rooms(id) on delete cascade;
alter table members add column if not exists name text;
alter table members add column if not exists session_token text;
alter table members add column if not exists session_token_expires_at timestamptz;
alter table members add column if not exists photos_uploaded int not null default 0;
alter table members add column if not exists joined_at timestamptz default now();

alter table photos add column if not exists room_id uuid references rooms(id) on delete cascade;
alter table photos add column if not exists member_id uuid references members(id) on delete cascade;
alter table photos add column if not exists storage_path text;
alter table photos add column if not exists display_order int;
alter table photos add column if not exists uploaded_at timestamptz default now();

alter table reels add column if not exists room_id uuid references rooms(id) on delete cascade;
alter table reels add column if not exists render_id text;
alter table reels add column if not exists mp4_url text;
alter table reels add column if not exists status text not null default 'pending';
alter table reels add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_code_key'
  ) then
    alter table rooms add constraint rooms_code_key unique (code);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'members_session_token_key'
  ) then
    alter table members add constraint members_session_token_key unique (session_token);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'reels_room_id_key'
  ) then
    alter table reels add constraint reels_room_id_key unique (room_id);
  end if;
end $$;

-- Enable Realtime on rooms and members tables
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'members'
  ) then
    alter publication supabase_realtime add table members;
  end if;
end $$;
