import { useEffect, useRef, useState } from "react";

const LEAFLET_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    if (!document.querySelector(`link[data-leaflet]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = LEAFLET_CSS; l.setAttribute("data-leaflet", "1");
      document.head.appendChild(l);
    }
    let s = document.querySelector(`script[data-leaflet]`);
    if (s) { s.addEventListener("load", () => resolve(window.L)); s.addEventListener("error", reject); if (window.L) resolve(window.L); return; }
    s = document.createElement("script");
    s.src = LEAFLET_JS; s.setAttribute("data-leaflet", "1");
    s.onload = () => resolve(window.L); s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function MapView({ photos }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const groupRef = useRef(null);
  const [status, setStatus] = useState("");
  const geo = photos.filter(
    (p) => p && p.lat != null && p.lng != null && Number.isFinite(+p.lat) && Number.isFinite(+p.lng)
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!geo.length || !ref.current) return;
      try {
        const L = await loadLeaflet();
        if (cancelled || !ref.current) return;
        if (!mapRef.current) {
          mapRef.current = L.map(ref.current).setView([+geo[0].lat, +geo[0].lng], 13);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap", maxZoom: 19,
          }).addTo(mapRef.current);
        }
        const map = mapRef.current;
        if (groupRef.current) { map.removeLayer(groupRef.current); }
        const group = L.featureGroup();
        for (const p of geo) {
          const m = L.marker([+p.lat, +p.lng]);
          m.bindPopup(`<img src="${p.url}" style="width:150px;border-radius:8px;display:block"/><div style="font-size:12px;margin-top:4px">${p.category || ""}</div>`);
          group.addLayer(m);
        }
        group.addTo(map);
        groupRef.current = group;
        if (geo.length > 1) map.fitBounds(group.getBounds().pad(0.2));
        setTimeout(() => map.invalidateSize(), 200);
      } catch (e) { setStatus("Map failed to load: " + e.message); }
    })();
    return () => { cancelled = true; };
  }, [geo.length]);

  if (!geo.length) {
    return <div className="empty">No geotagged photos yet. Upload photos taken with location services on — camera captures usually carry no GPS.</div>;
  }
  return (
    <>
      <div className="note">📍 {geo.length} geotagged photo(s) on the map.</div>
      <div ref={ref} className="mapbox" />
      {status && <div className="status">{status}</div>}
    </>
  );
}
