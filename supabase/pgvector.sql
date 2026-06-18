-- ============================================================
-- pgvector add-on: server-side semantic search.
-- Run this ONCE in Supabase SQL Editor.
-- (If you are setting up fresh, schema.sql already includes all of this.)
-- ============================================================

-- 1) Vector extension + column (CLIP ViT-B-32 projection = 512 dims)
create extension if not exists vector;
alter table public.photos add column if not exists embedding_vec vector(512);

-- 2) Keep embedding_vec in sync with the jsonb `embedding` automatically,
--    so the app code never has to change.
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

-- 3) Approximate-nearest-neighbour index (optional but fast)
create index if not exists photos_embedding_vec_idx
  on public.photos using hnsw (embedding_vec vector_cosine_ops);

-- 4) Backfill any rows that were processed before this migration
update public.photos set embedding = embedding where embedding is not null;

-- 5) Search RPC: returns the caller's photos ranked by cosine similarity
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
