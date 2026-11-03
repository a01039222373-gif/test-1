"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const STYLES = {
  none: { radius: 7, color: "#1d4ed8", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.85 },
  yes: { radius: 9, color: "#39ff14", weight: 5, fillColor: "#3b82f6", fillOpacity: 0.95 },
  no: { radius: 7, color: "#6b7280", weight: 2, fillColor: "#9ca3af", fillOpacity: 0.9 },
};

function popupContent(r, status, onSetStatus) {
  const box = document.createElement("div");
  box.className = "popup";
  const label = { yes: "비플페이 가능", no: "비플페이 불가능" }[status] || "아직 표시 없음";
  box.innerHTML = `
    <strong></strong>
    <div class="popup-meta"></div>
    <div class="popup-state">현재: ${label}</div>
    <div class="popup-buttons">
      <button data-s="yes" class="btn-yes">비플페이 가능</button>
      <button data-s="no" class="btn-no">불가능</button>
    </div>`;
  box.querySelector("strong").textContent = r.name;
  box.querySelector(".popup-meta").textContent = [r.cuisine, r.address].filter(Boolean).join(" · ");
  box.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => onSetStatus(r, b.dataset.s))
  );
  return box;
}

export default function MapView({ area, restaurants, statuses, onSetStatus }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const areaLayerRef = useRef(null);
  const markersRef = useRef(new Map());
  const [ready, setReady] = useState(false);
  const onSetRef = useRef(onSetStatus);
  onSetRef.current = onSetStatus;

  // 지도 생성 (leaflet은 window가 필요해서 브라우저에서만 불러온다)
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || mapRef.current) return;
      const L = mod.default;
      LRef.current = L;
      mapRef.current = L.map(elRef.current, { preferCanvas: false }).setView([37.5665, 126.978], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(mapRef.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // 구획과 식당 마커 다시 그리기
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    areaLayerRef.current?.remove();
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();
    if (!area) return;

    areaLayerRef.current = L.geoJSON(area, {
      style: { color: "#2563eb", weight: 2, dashArray: "6 4", fillColor: "#60a5fa", fillOpacity: 0.08 },
      interactive: false,
    }).addTo(map);
    map.fitBounds(areaLayerRef.current.getBounds(), { padding: [20, 20] });

    for (const r of restaurants) {
      const m = L.circleMarker([r.lat, r.lon], STYLES.none).addTo(map);
      m.bindTooltip(r.name);
      markersRef.current.set(r.id, m);
    }
    // 마커가 준비된 뒤 상태 반영은 아래 effect가 맡는다.
  }, [ready, area, restaurants]);

  // 상태(가능/불가능) 반영
  useEffect(() => {
    for (const r of restaurants) {
      const m = markersRef.current.get(r.id);
      if (!m) continue;
      const status = statuses[r.id] || "none";
      m.setStyle(STYLES[status]);
      m.setRadius(STYLES[status].radius);
      const path = m.getElement?.();
      path?.classList.toggle("neon", status === "yes");
      if (status === "yes") m.bringToFront();
      const wasOpen = m.isPopupOpen();
      m.unbindPopup();
      m.bindPopup(() => popupContent(r, statuses[r.id], (...a) => onSetRef.current(...a)));
      if (wasOpen) m.openPopup();
    }
  }, [ready, restaurants, statuses, area]);

  return <div ref={elRef} className="map" />;
}
