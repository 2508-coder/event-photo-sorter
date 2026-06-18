-- ============================================================
-- AI Photo Sorter — COMPLETE setup (safe to re-run / idempotent)
-- Run once in Supabase dashboard -> SQL Editor.
-- ============================================================

-- 1) Photos table -------------------------------------------------
create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  uid           uuid not null references auth.users(id) on delete cascade,
  url           text,
  storage_path  text,
  source        text,
  uploader      text,
  processed     boolean default false,
  category      text,
  embedding     jsonb,
  faces         jsonb,
  face_count    int,
  blur_score    double precision,
  is_blurry     boolean,
  brightness    double precision,
  phash         text,
  ocr_text      text,
  emotion       text,
  sensitive     boolean,
  caption       text,
  process_error text,
  created_at    timestamptz default now()
);

-- 2) Row Level Security on photos --------------------------------
alter table public.photos enable row level security;
drop policy if exists "photos_select_own" on public.photos;
drop policy if exists "photos_insert_own" on public.photos;
drop policy if exists "photos_update_own" on public.photos;
drop policy if exists "photos_delete_own" on public.photos;
create policy "photos_select_own" on public.photos for select using (auth.uid() = uid);
create policy "photos_insert_own" on public.photos for insert with check (auth.uid() = uid);
create policy "photos_update_own" on public.photos for update using (auth.uid() = uid);
create policy "photos_delete_own" on public.photos for delete using (auth.uid() = uid);

-- 3) Realtime (ignore error if already added) --------------------
do $$ begin
  alter publication supabase_realtime add table public.photos;
exception when duplicate_object then null; end $$;

-- 4) Storage bucket (public read) --------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_obj_insert" on storage.objects;
drop policy if exists "photos_obj_update" on storage.objects;
drop policy if exists "photos_obj_delete" on storage.objects;
create policy "photos_obj_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_obj_update" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_obj_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 5) pgvector semantic search ------------------------------------
create extension if not exists vector;
alter table public.photos add column if not exists embedding_vec vector(512);

create or replace function public.photos_set_embedding_vec()
returns trigger language plpgsql as $$
begin
  if new.embedding is not null then
    new.embedding_vec := (replace(new.embedding::text, ' ', ''))::vector;
  else
    new.embedding_vec := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_photos_embedding_vec on public.photos;
create trigger trg_photos_embedding_vec
  before insert or update of embedding on public.photos
  for each row execute function public.photos_set_embedding_vec();

create index if not exists photos_embedding_vec_idx
  on public.photos using hnsw (embedding_vec vector_cosine_ops);

create or replace function public.match_photos(
  query_embedding vector(512),
  match_count int default 60
)
returns table (
  id uuid, url text, category text, ocr_text text,
  is_blurry boolean, similarity float
)
language sql stable as $$
  select p.id, p.url, p.category, p.ocr_text, p.is_blurry,
         1 - (p.embedding_vec <=> query_embedding) as similarity
  from public.photos p
  where p.uid = auth.uid() and p.embedding_vec is not null
  order by p.embedding_vec <=> query_embedding
  limit match_count;
$$;

-- 6) People (named face clusters) --------------------------------
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null references auth.users(id) on delete cascade,
  name text not null,
  centroid jsonb not null,
  created_at timestamptz default now()
);
alter table public.people enable row level security;
drop policy if exists "people_all_own" on public.people;
create policy "people_all_own" on public.people
  for all using (auth.uid() = uid) with check (auth.uid() = uid);

-- 7) Smart albums (saved searches) -------------------------------
create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null references auth.users(id) on delete cascade,
  name text not null,
  query text not null,
  created_at timestamptz default now()
);
alter table public.albums enable row level security;
drop policy if exists "albums_all_own" on public.albums;
create policy "albums_all_own" on public.albums
  for all using (auth.uid() = uid) with check (auth.uid() = uid);
