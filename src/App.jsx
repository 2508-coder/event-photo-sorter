import { useEffect, useMemo, useRef, useState } from "react";
import Uploader from "./components/Uploader.jsx";
import Login from "./components/Login.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import { downloadPhoto } from "./lib/admin.js";
import HeroFX from "./components/HeroFX.jsx";
import FindMe from "./components/FindMe.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";
import MapView from "./components/MapView.jsx";
import { showToast } from "./lib/toast.js";
import {
  subscribePhotos, savePhotoAI, semanticSearch,
  getPeople, savePerson, getAlbums, saveAlbum, deleteAlbum, deletePhoto,
  upsertProfile, getMyRole, subscribeAllPhotos, getCameramen, getHeavyData,
} from "./lib/store.js";
import { watchAuth, logOut } from "./lib/auth.js";
import { processPhoto } from "./lib/processor.js";
import { embedText, cosine } from "./ai/clip.js";
import { clusterDescriptors, meanDescriptor, descriptorDistance, MATCH_THRESHOLD } from "./ai/faces.js";
import { hammingHex, DUP_HAMMING } from "./ai/quality.js";
import { motion, AnimatePresence } from "framer-motion";

const TABS = ["Search", "Albums", "Categories", "People", "Find Me", "Emotions", "Events", "Highlights", "Documents", "Duplicates", "Quality", "Map", "All", "Admin"];

const EMOJI = { happy: "😄", sad: "😢", angry: "😠", surprised: "😮", fearful: "😨", disgusted: "🤢", neutral: "😐" };
function emojiFor(e) { return EMOJI[e] || "🙂"; }

// Small WebP thumbnail via a free image proxy — avoids downloading multi-MB
// originals for the grid (massive win at thousands of photos). Falls back to
// the original URL if the proxy ever fails.
function thumb(url, w = 400) {
  if (!url) return url;
  return `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&w=${w}&output=webp&q=72`;
}

function PhotoCard({ p, score, blurred, onReveal, best, onDownload, onDelete }) {
  const snippet = p.ocrText ? p.ocrText.replace(/\s+/g, " ").slice(0, 90) : "";
  return (
    <motion.div className={"card" + (blurred ? " sensitive" : "")} whileHover={{ y: -5 }} whileTap={{ scale: 0.99 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
      {best ? <span className="badge best">★ best</span> : null}
      {p.isBlurry ? <span className="badge warn">blurry</span> : null}
      {p.emotion && p.emotion !== "neutral" ? <span className="badge emo">{emojiFor(p.emotion)}</span> : null}
      <img
        src={thumb(p.url)}
        loading="lazy"
        decoding="async"
        alt=""
        title={p.ocrText || ""}
        onError={(e) => { if (e.currentTarget.src !== p.url) e.currentTarget.src = p.url; }}
      />
      <div className="actions">
        <motion.button whileTap={{ scale: 0.82 }} title="Download" onClick={(e) => { e.stopPropagation(); onDownload && onDownload(p); }}>⬇️</motion.button>
        <motion.button whileTap={{ scale: 0.82 }} title="Delete" onClick={(e) => { e.stopPropagation(); onDelete && onDelete(p); }}>🗑️</motion.button>
      </div>
      {blurred ? <button className="reveal" onClick={() => onReveal(p.id)}>🔒 Sensitive — tap to reveal</button> : null}
      <div className="meta">
        <span>{p.category || (p.processed ? "" : "…")}</span>
        {score != null ? <span className="score">{score.toFixed(2)}</span> : null}
      </div>
      {p.caption ? (
        <div className="cap">
          <span>{p.caption}</span>
          <button title="Copy caption" onClick={() => navigator.clipboard && navigator.clipboard.writeText(p.caption)}>📋</button>
        </div>
      ) : null}
      {snippet ? <div className="ocr">{snippet}{p.ocrText.length > 90 ? "…" : ""}</div> : null}
    </motion.div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [photos, setPhotos] = useState([]);
  const [people, setPeople] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [tab, setTab] = useState("Search");
  const [name, setName] = useState("");
  const [aiStatus, setAiStatus] = useState("Idle");
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [albumName, setAlbumName] = useState("");
  const [results, setResults] = useState(null);
  const [revealed, setRevealed] = useState(new Set());
  const [faceQueryDesc, setFaceQueryDesc] = useState(null);
  const [role, setRole] = useState(null);
  const [cameramen, setCameramen] = useState([]);
  const [limit, setLimit] = useState(150); // how many cards to render (pagination)
  const [heavyMap, setHeavyMap] = useState(null); // id -> { embedding, faces }, loaded lazily
  const heavyCount = useRef(-1);
  const processing = useRef(false);

  useEffect(() => watchAuth(setUser), []);

  // Record this login + read my role (admin vs cameraman)
  useEffect(() => {
    if (!user) { setRole(null); return; }
    (async () => {
      try { await upsertProfile(user.uid, user.email); } catch (e) {}
      try { setRole(await getMyRole(user.uid)); } catch (e) { setRole("cameraman"); }
    })();
  }, [user]);

  useEffect(() => { if (role === "admin") setTab("Dashboard"); }, [role]);
  useEffect(() => { setLimit(150); }, [tab, lastQuery]); // reset paging when view changes

  useEffect(() => {
    if (!user || !role) { setPhotos([]); return; }
    return role === "admin" ? subscribeAllPhotos(setPhotos) : subscribePhotos(user.uid, setPhotos);
  }, [user, role]);

  // Admin: load the cameraman roster
  useEffect(() => {
    if (role === "admin") getCameramen().then(setCameramen);
  }, [role, photos]);

  async function refreshMeta() {
    if (!user) return;
    setPeople(await getPeople(user.uid));
    setAlbums(await getAlbums(user.uid));
  }
  useEffect(() => { refreshMeta(); /* eslint-disable-next-line */ }, [user]);

  useEffect(() => {
    if (processing.current) return;
    const next = photos.find((p) => !p.processed);
    if (!next) return;
    processing.current = true;
    (async () => {
      try {
        const data = await processPhoto(next, setAiStatus);
        await savePhotoAI(next.id, data);
        setAiStatus("AI ready");
      } catch (e) {
        setAiStatus("Error: " + e.message);
        await savePhotoAI(next.id, { processed: true, processError: String(e.message) });
      } finally {
        processing.current = false;
      }
    })();
  }, [photos]);

  function reveal(id) {
    setRevealed((s) => { const n = new Set(s); n.add(id); return n; });
  }

  async function handleDownload(p) {
    try { await downloadPhoto(p); } catch (e) { showToast("❌ Download failed: " + e.message, "error"); }
  }
  async function handleDelete(p) {
    if (!window.confirm("Delete this photo permanently?")) return;
    try { await deletePhoto(p.id, p.storagePath); showToast("🗑️ Photo deleted", "success"); } catch (e) { showToast("❌ Delete failed: " + e.message, "error"); }
  }

  function Grid({ items, bestId }) {
    if (!items || !items.length) return <div className="empty">Nothing here yet.</div>;
    const shown = items.slice(0, limit);
    const remaining = items.length - shown.length;
    return (
      <>
        <div className="grid">
          {shown.map((p) => (
            <PhotoCard
              key={p.id + (p._k || "")}
              p={p}
              score={p.score}
              best={bestId === p.id}
              blurred={!!p.sensitive && !revealed.has(p.id)}
              onReveal={reveal}
              onDownload={handleDownload}
              onDelete={handleDelete}
            />
          ))}
        </div>
        {remaining > 0 && (
          <button className="loadmore" onClick={() => setLimit((l) => l + 150)}>
            ⬇ Load more ({remaining} more)
          </button>
        )}
      </>
    );
  }

  function PersonGroup({ group }) {
    const [val, setVal] = useState(group.named ? group.name : "");
    const [busy, setBusy] = useState(false);
    async function save() {
      if (!val.trim()) return;
      setBusy(true);
      try { await savePerson(user.uid, val.trim(), group.centroid); await refreshMeta(); showToast("🏷️ Saved \u201c" + val.trim() + "\u201d", "success"); }
      catch (e) { showToast("❌ " + e.message, "error"); }
      finally { setBusy(false); }
    }
    return (
      <div className="group">
        <h3>
          <span>{group.named ? "🏷️ " : "👤 "}{group.name} <small>{group.count}</small></span>
          <span className="nameform">
            <input placeholder="Name this person" value={val} onChange={(e) => setVal(e.target.value)} />
            <button onClick={save} disabled={busy}>Save</button>
          </span>
        </h3>
        <Grid items={group.photos} />
      </div>
    );
  }

  async function runSearch(qArg) {
    const q = (typeof qArg === "string" ? qArg : query).trim();
    if (!q) return;
    setLastQuery(q);
    setAiStatus("Searching…");
    const ql = q.toLowerCase();
    const textMatches = photos.filter((p) => p.ocrText && p.ocrText.toLowerCase().includes(ql));
    const qEmb = await embedText(q);
    let semantic = [];
    try {
      semantic = await semanticSearch(qEmb, 60);
    } catch {
      semantic = P
        .filter((p) => Array.isArray(p.embedding))
        .map((p) => ({ ...p, score: cosine(qEmb, p.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 60);
    }
    const seen = new Set();
    const merged = [];
    for (const p of [...textMatches, ...semantic]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
    setResults(merged.slice(0, 80));
    setAiStatus("AI ready");
  }

  async function saveCurrentAlbum() {
    if (!lastQuery) return;
    try {
      await saveAlbum(user.uid, albumName.trim() || lastQuery, lastQuery);
      setAlbumName("");
      await refreshMeta();
      showToast("💾 Album saved", "success");
    } catch (e) { showToast("❌ " + e.message, "error"); }
  }

  // Lazily fetch heavy face/embedding data only when a tab that needs it is
  // open (People, Find Me, Events, Search). Keeps the everyday gallery light.
  useEffect(() => {
    const HEAVY = new Set(["People", "Find Me", "Events", "Search"]);
    if (!user || !role || !HEAVY.has(tab)) return;
    if (heavyMap && heavyCount.current === photos.length) return; // already current
    let cancelled = false;
    (async () => {
      setAiStatus("Loading face data…");
      try {
        const rows = await getHeavyData(role === "admin" ? {} : { uid: user.uid });
        if (cancelled) return;
        const m = new Map(rows.map((r) => [r.id, { embedding: r.embedding, faces: r.faces }]));
        heavyCount.current = photos.length;
        setHeavyMap(m);
        setAiStatus("AI ready");
      } catch (e) { setAiStatus("Couldn't load face data"); }
    })();
    return () => { cancelled = true; };
  }, [tab, user, role, photos.length]); // eslint-disable-line

  // photos merged with heavy data (embedding/faces) when it's been loaded.
  const P = useMemo(() => {
    if (!heavyMap) return photos;
    return photos.map((p) => {
      const h = heavyMap.get(p.id);
      return h ? { ...p, embedding: h.embedding, faces: h.faces } : p;
    });
  }, [photos, heavyMap]);

  const categories = useMemo(() => {
    const g = {};
    for (const p of photos) if (p.category) (g[p.category] ||= []).push(p);
    return g;
  }, [photos]);

  const docs = useMemo(() => photos.filter((p) => p.ocrText && p.ocrText.trim()), [photos]);

  const emotions = useMemo(() => {
    const g = {};
    for (const p of photos) if (p.emotion) (g[p.emotion] ||= []).push(p);
    return g;
  }, [photos]);

  const faceGroups = useMemo(() => {
    const entries = [];
    for (const p of P) (p.faces || []).forEach((f) => entries.push({ p, d: f.v }));
    if (!entries.length) return [];
    const labels = clusterDescriptors(entries.map((e) => e.d));
    const clusters = {};
    labels.forEach((lab, i) => { (clusters[lab] ||= []).push(entries[i]); });
    let idx = 0;
    return Object.values(clusters).map((members) => {
      const centroid = meanDescriptor(members.map((m) => m.d));
      let matched = null, bestDist = MATCH_THRESHOLD;
      for (const per of people) {
        const dist = descriptorDistance(centroid, per.centroid);
        if (dist < bestDist) { bestDist = dist; matched = per.name; }
      }
      const seen = new Set(); const ph = [];
      for (const m of members) if (!seen.has(m.p.id)) { seen.add(m.p.id); ph.push(m.p); }
      idx++;
      return { centroid, name: matched || "Person " + idx, photos: ph, count: ph.length, named: !!matched };
    }).sort((a, b) => b.count - a.count);
  }, [P, people]);

  const events = useMemo(() => {
    const withEmb = P.filter((p) => Array.isArray(p.embedding));
    const groups = [];
    for (const p of withEmb) {
      let placed = false;
      for (const g of groups) {
        if (cosine(p.embedding, g.centroid) > 0.8) { g.items.push(p); placed = true; break; }
      }
      if (!placed) groups.push({ centroid: p.embedding, items: [p] });
    }
    return groups.sort((a, b) => b.items.length - a.items.length);
  }, [P]);

  const highlights = useMemo(() => {
    const good = photos.filter((p) => p.processed && !p.isBlurry);
    const byCat = {};
    for (const p of good) {
      const c = p.category || "Other";
      if (!byCat[c] || (p.blurScore || 0) > (byCat[c].blurScore || 0)) byCat[c] = p;
    }
    let picks = Object.values(byCat);
    const ids = new Set(picks.map((p) => p.id));
    const rest = good.filter((p) => !ids.has(p.id)).sort((a, b) => (b.blurScore || 0) - (a.blurScore || 0));
    return picks.concat(rest).slice(0, 12);
  }, [photos]);

  const dupGroups = useMemo(() => {
    const withHash = photos.filter((p) => p.phash);
    const used = new Set();
    const groups = [];
    for (let i = 0; i < withHash.length; i++) {
      if (used.has(withHash[i].id)) continue;
      const grp = [withHash[i]];
      used.add(withHash[i].id);
      for (let j = i + 1; j < withHash.length; j++) {
        if (used.has(withHash[j].id)) continue;
        if (hammingHex(withHash[i].phash, withHash[j].phash) <= DUP_HAMMING) {
          grp.push(withHash[j]); used.add(withHash[j].id);
        }
      }
      if (grp.length > 1) groups.push(grp);
    }
    return groups;
  }, [photos]);

  const faceMatches = useMemo(() => {
    if (!faceQueryDesc) return null;
    const out = [];
    for (const p of P) {
      let best = Infinity;
      for (const fc of (p.faces || [])) {
        const d = descriptorDistance(faceQueryDesc, fc.v);
        if (d < best) best = d;
      }
      if (best < MATCH_THRESHOLD) out.push({ ...p, score: 1 - best });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }, [faceQueryDesc, P]);

  const blurry = useMemo(() => photos.filter((p) => p.isBlurry), [photos]);
  const poorLight = useMemo(
    () => photos.filter((p) => p.brightness != null && (p.brightness < 50 || p.brightness > 205)),
    [photos]
  );
  const pending = photos.filter((p) => !p.processed).length;

  const visibleTabs = role === "admin" ? ["Dashboard", ...TABS, "Cameramen"] : TABS;

  if (user === undefined) return <div className="boot">Loading…</div>;
  if (user === null) return <Login />;

  return (
    <div className="app">
      <HeroFX />
      <div className="userbar">
        <span>{role === "admin" ? "👑 ADMIN · " : "👤 "}{user.email}</span>
        <button className="link" onClick={() => { showToast("👋 Signed out", "info"); logOut(); }}>Sign out</button>
      </div>

      <motion.header initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <img src="/logo.png" className="brand-logo" alt="Karnavati University SGC" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <h1>🧠 AI Photo Sorter</h1>
        <p className="tagline">Search · Categories · People · Emotions · Events · Highlights · Captions · Privacy</p>
        <input className="name" placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      </motion.header>

      <motion.section className="add" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }}>
        <Uploader uploader={name || user.email} uid={user.uid} />
      </motion.section>

      <motion.div className="stats" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
        <div className="stat"><b>{photos.length}</b> photos</div>
        {role === "admin" ? <div className="stat"><b>{cameramen.filter((c) => c.role !== "admin").length}</b> cameramen</div> : null}
        <div className="stat"><b>{Object.keys(categories).length}</b> categories</div>
        <div className="stat"><b>{faceGroups.length}</b> people</div>
        <div className="stat"><b>{events.length}</b> events</div>
        <div className="stat"><b>{dupGroups.length}</b> dup sets</div>
        <div className="stat">AI: <b>{aiStatus}</b>{pending ? ` (${pending} queued)` : ""}</div>
      </motion.div>

      <motion.nav className="tabs" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.15 }}>
        {visibleTabs.map((t) => (
          <button key={t} className={"tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</button>
        ))}
      </motion.nav>

      <main>
        <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
        {tab === "Dashboard" && role === "admin" && (
          <AdminDashboard photos={photos} cameramen={cameramen} onChanged={() => getCameramen().then(setCameramen)} />
        )}

        {tab === "Search" && (
          <>
            <div className="searchbar">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder='Try: "friends outdoors", "red t-shirt at the fest", or words from a document…'
              />
              <button onClick={() => runSearch()}>Search</button>
            </div>
            {results !== null && results.length > 0 && (
              <div className="savealbum">
                <input placeholder={"Name this album (e.g. " + (lastQuery || "Fest") + ")"} value={albumName} onChange={(e) => setAlbumName(e.target.value)} />
                <button onClick={saveCurrentAlbum}>＋ Save as Smart Album</button>
              </div>
            )}
            {results === null
              ? <div className="empty">Type a description (or document text) and hit Search.</div>
              : <Grid items={results} />}
          </>
        )}

        {tab === "Albums" && (
          albums.length === 0
            ? <div className="empty">No albums yet. Run a search, then "Save as Smart Album".</div>
            : <div className="albums">
                {albums.map((a) => (
                  <div className="album" key={a.id}>
                    <button className="album-open" onClick={() => { setQuery(a.query); setTab("Search"); runSearch(a.query); }}>
                      <b>{a.name}</b><small>{a.query}</small>
                    </button>
                    <button className="album-del" title="Delete album" onClick={async () => { await deleteAlbum(a.id); refreshMeta(); }}>🗑️</button>
                  </div>
                ))}
              </div>
        )}

        {tab === "Categories" && (
          Object.keys(categories).length
            ? Object.entries(categories).map(([k, list]) => (
                <div className="group" key={k}><h3>{k} <span>{list.length}</span></h3><Grid items={list} /></div>
              ))
            : <div className="empty">No processed photos yet.</div>
        )}

        {tab === "People" && (
          faceGroups.length
            ? faceGroups.map((g, i) => <PersonGroup key={i} group={g} />)
            : <div className="empty">No faces detected yet.</div>
        )}

        {tab === "Find Me" && (
          <>
            <div className="note">📸 Scan your face (or upload a selfie) to instantly pull every photo you appear in.</div>
            <FindMe onScan={setFaceQueryDesc} />
            {faceMatches === null ? null : faceMatches.length ? (
              <>
                <h3 className="subh">Found you in <span>{faceMatches.length}</span> photo(s)</h3>
                <Grid items={faceMatches} />
              </>
            ) : (
              <div className="empty">No matches yet. Try a clearer, front-facing scan.</div>
            )}
          </>
        )}

        {tab === "Emotions" && (
          Object.keys(emotions).length
            ? Object.entries(emotions).map(([k, list]) => (
                <div className="group" key={k}><h3>{emojiFor(k)} {k} <span>{list.length}</span></h3><Grid items={list} /></div>
              ))
            : <div className="empty">No emotions detected yet (needs faces).</div>
        )}

        {tab === "Events" && (
          events.length
            ? events.map((e, i) => (
                <div className="group" key={i}><h3>Event {i + 1} <span>{e.items.length} photos</span></h3><Grid items={e.items} /></div>
              ))
            : <div className="empty">No events detected yet.</div>
        )}

        {tab === "Highlights" && (
          <>
            <div className="note">⭐ Best of Semester — top-quality, diverse picks across your events. Screenshot or share!</div>
            {highlights.length
              ? <div className="collage">{highlights.map((p) => <img key={p.id} src={p.url} alt="" loading="lazy" />)}</div>
              : <div className="empty">Add more photos to generate highlights.</div>}
          </>
        )}

        {tab === "Documents" && (
          docs.length
            ? <div className="docs">{docs.map((p) => (
                <div className="doc-row" key={p.id}>
                  <img src={p.url} loading="lazy" alt="" />
                  <div className="doc-text"><div className="doc-cat">{p.category}</div><pre>{p.ocrText}</pre></div>
                </div>
              ))}</div>
            : <div className="empty">No documents or screenshots with text yet.</div>
        )}

        {tab === "Duplicates" && (
          dupGroups.length
            ? dupGroups.map((g, i) => {
                const bestId = g.reduce((b, p) => ((p.blurScore || 0) > (b.blurScore || -1) ? p : b), g[0]).id;
                return (
                  <div className="group" key={i}>
                    <h3>Duplicate set {i + 1} <span>{g.length} copies · ★ best shot</span></h3>
                    <Grid items={g} bestId={bestId} />
                  </div>
                );
              })
            : <div className="empty">No duplicates found. 🎉</div>
        )}
        {tab === "Quality" && (
          <>
            <div className="note">Photos to review: blurry ({blurry.length}) and poorly lit ({poorLight.length}).</div>
            <h3 className="subh">😵‍💫 Blurry</h3>
            <Grid items={blurry} />
            <h3 className="subh">💡 Poor lighting</h3>
            <Grid items={poorLight} />
          </>
        )}

        {tab === "Map" && <MapView photos={photos} />}

        {tab === "All" && <Grid items={photos} />}

        {tab === "Admin" && <AdminPanel user={user} photos={photos} />}

        {tab === "Cameramen" && role === "admin" && (
          <div className="admin-grid">
            {cameramen.length
              ? cameramen.map((c) => (
                  <div className="acard" key={c.uid}>
                    <b>{photos.filter((p) => p.uid === c.uid).length}</b>
                    <span>{c.email}{c.role === "admin" ? " (admin)" : ""}</span>
                    <span>{c.last_seen ? new Date(c.last_seen).toLocaleString() : "—"}</span>
                  </div>
                ))
              : <div className="empty">No cameramen have logged in yet.</div>}
          </div>
        )}
        </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
