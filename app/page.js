"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [statuses, setStatuses] = useState({});

  // 공유된 비플페이 표시를 불러오고, 다른 사용자의 변경을 실시간으로 받는다.
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("bipple_status")
      .select("restaurant_id,status")
      .then(({ data, error }) => {
        if (error) return setError(`표시 정보를 불러오지 못했어요: ${error.message}`);
        setStatuses(Object.fromEntries(data.map((d) => [d.restaurant_id, d.status])));
      });
    const channel = supabase
      .channel("bipple_status")
      .on("postgres_changes", { event: "*", schema: "public", table: "bipple_status" }, (payload) => {
        const row = payload.new;
        if (row?.restaurant_id) setStatuses((s) => ({ ...s, [row.restaurant_id]: row.status }));
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const search = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setError(err.message || "검색에 실패했어요.");
    } finally {
      setLoading(false);
    }
  };

  const setStatus = useCallback(async (restaurant, status) => {
    const prev = statuses[restaurant.id];
    setStatuses((s) => ({ ...s, [restaurant.id]: status }));
    if (!supabase) return;
    const { error } = await supabase.from("bipple_status").upsert({
      restaurant_id: restaurant.id,
      name: restaurant.name,
      lat: restaurant.lat,
      lon: restaurant.lon,
      status,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setStatuses((s) => ({ ...s, [restaurant.id]: prev }));
      setError(`저장하지 못했어요: ${error.message}`);
    }
  }, [statuses]);

  const counts = useMemo(() => {
    const c = { yes: 0, no: 0 };
    for (const r of result?.restaurants || []) if (statuses[r.id]) c[statuses[r.id]]++;
    return c;
  }, [result, statuses]);

  return (
    <main className="page">
      <header className="bar">
        <h1>비플페이 식당 지도</h1>
        <form onSubmit={search} className="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 역삼동 테헤란로, 성수동 연무장길"
            aria-label="구획 검색"
          />
          <button disabled={loading}>{loading ? "수집 중…" : "검색"}</button>
        </form>
      </header>

      <section className="info">
        {error && <p className="error">{error}</p>}
        {!supabase && (
          <p className="warn">Supabase가 설정되지 않아 표시가 이 브라우저에만 남아요.</p>
        )}
        {result?.source === "osm" && (
          <p className="warn">
            공공데이터 상가정보 키가 설정되지 않아 OpenStreetMap 식당 데이터로 대신 표시 중이에요.
          </p>
        )}
        {result && (
          <p>
            <b>{result.area.properties?.name}</b> · 식당 {result.restaurants.length}곳 · 가능{" "}
            {counts.yes} · 불가능 {counts.no}
          </p>
        )}
        <p className="legend">
          <span className="dot dot-none" /> 미확인
          <span className="dot dot-yes" /> 비플페이 가능
          <span className="dot dot-no" /> 불가능
        </p>
      </section>

      <MapView
        area={result?.area}
        restaurants={result?.restaurants || []}
        statuses={statuses}
        onSetStatus={setStatus}
      />
    </main>
  );
}
