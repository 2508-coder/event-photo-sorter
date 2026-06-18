# Face model upgrade (face-api → Human / ArcFace)

The app now supports two face engines, switchable with one word. It currently
runs on the original **face-api** (nothing changed for you yet). The new
**Human** engine uses stronger ArcFace-style fingerprints = fewer wrong matches.

## Why testing is required
The two engines produce **incompatible** fingerprints. So switching means every
photo must be re-processed, and the match cutoff must be confirmed by testing.
Do this on a quiet day, NOT during the event.

## Switch + test (10 min)

1. Open `src/ai/faces.js`. Change the top line:
   ```js
   export const ENGINE = "faceapi";
   ```
   to:
   ```js
   export const ENGINE = "human";
   ```

2. Rebuild + redeploy:
   ```
   npm run build
   copy dist\index.html dist\200.html
   surge dist omkar-event.surge.sh
   ```

3. Re-process all photos so they get new fingerprints. In Supabase SQL editor:
   ```sql
   update public.photos set processed = false;
   ```
   Then open the site as **admin** and leave the gallery open — the AI
   re-processes every photo (this takes a while; the Human models are bigger).
   Wait until photos stop showing the "…" processing state.

4. Test the guest scan:
   - Scan yourself → you should match your photos.
   - Have someone NOT in any photo scan → they should get few/none.

## Tuning (if needed)
In `src/ai/faces.js`, the `human` line controls strictness:
```js
human: { MATCH: 0.9, CLUSTER: 0.95 },
```
- Too many WRONG matches → lower `MATCH` (e.g. 0.8, then 0.75).
- Missing REAL matches → raise `MATCH` (e.g. 1.0).
Rebuild + redeploy after each change (no reprocess needed for threshold-only changes).

## Revert instantly
If anything misbehaves, set `ENGINE = "faceapi"` again, rebuild/redeploy, and
run `update public.photos set processed=false;` once more. You're back to the
known-good model.

## Notes
- Human downloads larger models on first use, so the first scan/processing is
  slower — especially on phones. The 3D hero + Human together are heavy on
  low-end devices.
- The guest multi-scan + quality gating already added works with BOTH engines.
