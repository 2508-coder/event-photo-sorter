# 🧠 AI Photo Sorter — React + Supabase (in-browser AI)

A web app where each **cameraman signs in** and captures photos on a phone
(live camera **or** gallery upload) that land instantly in their private space,
where AI automatically **searches, categorizes, groups people, reads document
text (OCR), and flags duplicates / blurry shots**.

- **Frontend:** React + Vite
- **Backend:** Supabase (**Auth** + Storage + Postgres/**pgvector** — realtime)
- **AI:** runs **100% in the browser** (free, no server, no paid API)
  - CLIP via `@xenova/transformers` → semantic search + zero-shot categories
  - `@vladmandic/face-api` (TensorFlow.js) → face detection + grouping
  - `tesseract.js` → OCR on documents/screenshots → searchable text
  - Canvas math → blur score (Laplacian) + duplicate hash (dHash)

### Tabs
**Search · Categories · People · Documents · Duplicates · Quality · All**

- **Search** is *hybrid*: exact OCR-text matches first, then visual semantic
  similarity. Semantic ranking runs **server-side via pgvector** (`match_photos`
  RPC); if that isn't available it automatically falls back to in-browser cosine.
- **Documents** lists every photo with extracted text and shows the full OCR.

> **Architecture for your report:** all backend access is isolated in
> `src/supabase.js`, `src/lib/store.js`, and `src/lib/auth.js`. CLIP embeddings are
> stored both as JSON (client fallback) and as a Postgres `vector(512)` column
> (kept in sync by a trigger) so search can run in the database with an HNSW index.

## How it works

1. A photo is captured/uploaded → saved to Supabase **Storage**, with a Postgres
   row `{ uid, url, processed: false, ... }`.
2. Every open gallery listens via **Supabase Realtime**. When it sees an
   unprocessed photo, it runs the AI pipeline in-browser and updates the row with
   `embedding`, `category`, `faces`, `blur_score`, `phash`, and `ocr_text`
   (OCR runs only on Documents/Screenshots to save time). A DB trigger mirrors
   `embedding` into a `vector(512)` column for pgvector search.
3. **Search** embeds your query with CLIP, calls the `match_photos` pgvector RPC,
   and merges in any OCR text matches.

## Setup

### 1. Create a Supabase project (free tier)
- Go to <https://supabase.com> → **New project** (pick a region + DB password).
- **Project Settings → API** → copy the **Project URL** and **anon public key**.

### 2. Create the database + storage (one SQL script)
- Open **SQL Editor** → paste **`supabase/schema.sql`** → **Run**.
  This creates the `photos` table, RLS policies, realtime, the public `photos`
  storage bucket, storage policies, **and the pgvector column + `match_photos`**.
- *Already ran an older `schema.sql`?* Just run **`supabase/pgvector.sql`** to add
  the vector column, trigger, index, and search function (it also backfills
  existing rows).

### 3. Turn off email confirmation (so sign-up logs you in immediately)
- **Authentication → Providers → Email** → disable **Confirm email** (demo only;
  re-enable for production). Email/Password is on by default.

### 4. Configure the app
```bash
cd webapp
cp .env.example .env      # Windows: copy .env.example .env
```
Paste your **Project URL** and **anon key** into `.env`.

### 5. Install + run
```bash
npm install
npm run dev
```
Open the printed URL (e.g. `http://localhost:5173`).
The **first** photo triggers a one-time CLIP model download (~250 MB, then cached).

## Using it as the cameraman (phone)

`npm run dev` prints a **Network** URL (e.g. `http://192.168.1.20:5173`). Open that
on your phone (same Wi-Fi) → sign in → **Camera** tab → Start camera → Capture.

> ⚠️ Browsers only allow camera access over **HTTPS or localhost**. For phone
> testing use a tunnel that gives HTTPS (`npx localtunnel --port 5173` or
> `ngrok http 5173`), or deploy (below) and open the live HTTPS URL.

## Deploy (optional, free, gives HTTPS for the phone camera)
```bash
npm run build
# then drag the `dist/` folder into Netlify/Vercel, or:
npx vercel        # or: npx netlify deploy
```
Add the two `VITE_SUPABASE_*` variables in the host's environment settings.

## Project structure
```
webapp/
├─ index.html
├─ vite.config.js
├─ .env.example
├─ supabase/
│  ├─ schema.sql           # full setup (run once)
│  └─ pgvector.sql         # add-on if you already ran an older schema.sql
└─ src/
   ├─ main.jsx, App.jsx, styles.css
   ├─ supabase.js          # Supabase client init
   ├─ lib/
   │  ├─ store.js          # upload + realtime + save AI + semanticSearch (pgvector)
   │  ├─ auth.js           # sign in / up / out
   │  └─ processor.js      # runs the AI pipeline on one photo
   ├─ ai/
   │  ├─ clip.js           # CLIP: search + zero-shot categories
   │  ├─ faces.js          # face detection + clustering
   │  ├─ quality.js        # blur + duplicate hashing
   │  └─ ocr.js            # Tesseract OCR
   └─ components/
      ├─ CameraCapture.jsx # live phone camera
      ├─ Uploader.jsx      # gallery file upload
      └─ Login.jsx         # email/password auth screen
```

## Ideas to extend (good for grading)
- **Auto-albums** from EXIF time+location, captioned by an LLM.
- **Accuracy evaluation:** report category precision/recall and face-cluster purity.
- **Storage saver:** show MB reclaimable from duplicates + blurry photos.
- **Private images:** switch the bucket to private + signed URLs.

## Notes / limits
- In-browser CLIP is slower than a GPU server but free and private. Fine for a
  demo of hundreds–thousands of photos.
- The `photos` bucket is **public-read** so images load by URL; row-level security
  still keeps each user's *metadata* private.
- `embedding_vec` is `vector(512)` for CLIP ViT-B-32 — change the dimension if you
  swap the model.
- Firebase and Python/FastAPI versions of this app exist in the repo history /
  parent folder as references.
