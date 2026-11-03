"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const STYLES = {
  none: { radius: 7, color: "#1d4ed8", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.85 },
  yes: { radius: 9, color: "#39ff14", weight: 5, fillColor: "#3b82f6", fillOpacity: 0.95 },
  no: { radius: 7, color: "#6b7280", weight: 2, fillColor: "#9ca3af", fillOpacity: 0.9 },
};
const STATUS_LABEL = { yes: "비플페이 가능", no: "비플페이 불가능" };

// 같은 건물의 업소는 좌표가 같아서 마커가 겹친다. 위치별로 묶어 마커 하나로 그린다.
function groupByLocation(restaurants) {
  const groups = new Map();
  for (const r of restaurants) {
    const key = `${r.lat.toFixed(6)},${r.lon.toFixed(6)}`;
    if (!groups.has(key)) groups.set(key, { key, lat: r.lat, lon: r.lon, items: [] });
    groups.get(key).items.push(r);
  }
  return [...groups.values()];
}

// 묶음 안에 가능이 하나라도 있으면 형광, 전부 불가능이면 회색
function groupStatus(group, statuses) {
  const list = group.items.map((r) => statuses[r.id]);
  if (list.includes("yes")) return "yes";
  if (list.every((s) => s === "no")) return "no";
  return "none";
}

function popupContent(group, statuses, onSetStatus) {
  const box = document.createElement("div");
  box.className = "popup";
  if (group.items.length > 1) {
    const head = document.createElement("div");
    head.className = "popup-head";
    head.textContent = `이 위치의 식당 ${group.items.length}곳`;
    box.appendChild(head);
  }
  const list = document.createElement("div");
  list.className = "popup-list";
  for (const r of group.items) {
    const status = statuses[r.id];
    const row = document.createElement("div");
    row.className = `popup-item status-${status || "none"}`;
    row.innerHTML = `
      <strong></strong>
      <div class="popup-meta"></div>
      <div class="popup-state">현재: ${STATUS_LABEL[status] || "아직 표시 없음"}</div>
      <div class="popup-buttons">
        <button data-s="yes" class="btn-yes">비플페이 가능</button>
        <button data-s="no" class="btn-no">불가능</button>
      </div>`;
    row.querySelector("strong").textContent = r.name;
    row.querySelector(".popup-meta").textContent = [r.cuisine, r.address].filter(Boolean).join(" · ");
    row.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => onSetStatus(r, b.dataset.s))
    );
    list.appendChild(row);
  }
  box.appendChild(list);
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

  const groups = useMemo(() => groupByLocation(restaurants), [restaurants]);

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

    for (const g of groups) {
      const m = L.circleMarker([g.lat, g.lon], STYLES.none).addTo(map);
      m.bindTooltip(g.items.length > 1 ? `${g.items[0].name} 외 ${g.items.length - 1}곳` : g.items[0].name);
      markersRef.current.set(g.key, m);
    }
    // 마커가 준비된 뒤 상태 반영은 아래 effect가 맡는다.
  }, [ready, area, groups]);

  // 상태(가능/불가능) 반영
  useEffect(() => {
    for (const g of groups) {
      const m = markersRef.current.get(g.key);
      if (!m) continue;
      const status = groupStatus(g, statuses);
      const extra = g.items.length > 1 ? 2 : 0; // 여러 곳이 모인 위치는 조금 크게
      m.setStyle(STYLES[status]);
      m.setRadius(STYLES[status].radius + extra);
      const path = m.getElement?.();
      path?.classList.toggle("neon", status === "yes");
      if (status === "yes") m.bringToFront();
      const wasOpen = m.isPopupOpen();
      m.unbindPopup();
      m.bindPopup(() => popupContent(g, statuses, (...a) => onSetRef.current(...a)), {
        maxHeight: 320,
      });
      if (wasOpen) m.openPopup();
    }
  }, [ready, groups, statuses, area]);

  return <div ref={elRef} className="map" />;
}
