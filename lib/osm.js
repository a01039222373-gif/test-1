// OpenStreetMap(키 없음) 데이터 조회:
// - Nominatim: 동/지명의 경계 폴리곤
// - Overpass: 도로 선형, 식당 위치
import * as turf from "@turf/turf";

const USER_AGENT = "bipple-map/0.1 (https://github.com/a01039222373-gif/test-1)";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const ROAD_BUFFER_METERS = 60; // 도로 양옆으로 포함할 거리
const POINT_RADIUS_METERS = 500; // 경계가 없는 지명(점)일 때 쓸 반경
const MAX_AREA_KM2 = 25;

export const FOOD_AMENITIES = ["restaurant", "fast_food", "food_court"];

export class SearchError extends Error {}

// Nominatim 이용 정책: 초당 1회 이하
let lastNominatimCall = 0;
async function throttle() {
  const wait = lastNominatimCall + 1100 - Date.now();
  lastNominatimCall = Date.now() + Math.max(wait, 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function nominatim(q, extra = {}) {
  await throttle();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q,
    format: "jsonv2",
    polygon_geojson: "1",
    countrycodes: "kr",
    "accept-language": "ko",
    limit: "5",
    ...extra,
  });
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new SearchError(`지명 검색 실패 (Nominatim ${res.status})`);
  return res.json();
}

async function overpass(query) {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(20000), // 공개 서버가 붐비면 응답 없이 멈추는 경우가 있다
      });
      if (res.ok) return (await res.json()).elements;
      lastErr = new Error(`Overpass ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new SearchError(`지도 데이터 조회 실패 (${lastErr.message})`);
}

function bboxFilter(feature) {
  const [w, s, e, n] = turf.bbox(feature);
  return `(${s},${w},${n},${e})`;
}

const isPolygon = (r) => ["Polygon", "MultiPolygon"].includes(r.geojson?.type);
// 버스정류장·가게 같은 결과는 빼고 행정구역/지명만 쓴다.
const isArea = (r) => r.category === "boundary" || r.category === "place";

// 동/지명 → 경계 폴리곤 Feature
// dongs: 하나의 경계가 없는 동(예: 성수동)을 이루는 행정동 이름들 (Gemini가 알려줌)
export async function findRegion(city, region, dongs = []) {
  if (!region && !city) {
    throw new SearchError("동 이름이나 지명을 함께 입력해 주세요. 예: 역삼동 테헤란로");
  }
  const cityBase = city.replace(/(특별시|광역시|특별자치시|특별자치도)$/, "");
  const inCity = (r) => !cityBase || r.display_name.includes(cityBase);

  let point = null;
  const queries = [...new Set([[region, city].filter(Boolean).join(", "), region].filter(Boolean))];
  for (const q of queries) {
    const results = (await nominatim(q)).filter((r) => isArea(r) && inCity(r));
    const poly = results.find(isPolygon);
    if (poly) return turf.feature(poly.geojson, { name: poly.display_name });
    point ??= results[0];
  }

  // 여러 행정동으로 나뉜 동이면 각 행정동 경계를 합친다.
  const parts = [];
  for (const d of dongs) {
    const results = await nominatim([d, city].filter(Boolean).join(", "));
    const poly = results.find((r) => isArea(r) && isPolygon(r) && inCity(r));
    if (poly) parts.push({ name: d, feature: turf.feature(poly.geojson) });
  }
  if (parts.length) {
    const merged =
      parts.length === 1
        ? parts[0].feature
        : turf.union(turf.featureCollection(parts.map((p) => p.feature)));
    merged.properties = { name: `${region} (${parts.map((p) => p.name).join(", ")})` };
    return merged;
  }

  // 경계가 없는 지명(예: 상권 이름)은 중심점 주변 원으로 대신한다.
  if (point) {
    return turf.circle([Number(point.lon), Number(point.lat)], POINT_RADIUS_METERS, {
      units: "meters",
      properties: { name: point.display_name },
    });
  }
  throw new SearchError(`'${[region, city].filter(Boolean).join(", ")}' 지역을 찾지 못했어요.`);
}

// 지역 폴리곤 안에서 도로를 찾아 도로 주변 영역(지역과 겹치는 부분)으로 좁힌다.
export async function narrowToRoad(regionFeature, road) {
  const [w, s, e, n] = turf.bbox(regionFeature);
  const results = await nominatim(road, {
    viewbox: `${w},${n},${e},${s}`,
    bounded: "1",
    dedupe: "0", // 도로는 구간(way)별로 나뉘어 있으므로 전부 받는다
    limit: "40",
  });
  const lines = results
    .filter((r) => r.category === "highway" && r.geojson?.type === "LineString")
    .map((r) => r.geojson.coordinates);
  if (!lines.length) throw new SearchError(`이 지역에서 '${road}'를 찾지 못했어요.`);

  const corridor = turf.buffer(turf.multiLineString(lines), ROAD_BUFFER_METERS, {
    units: "meters",
  });
  const area = turf.intersect(turf.featureCollection([regionFeature, corridor]));
  if (!area) throw new SearchError(`'${road}'가 이 지역 경계 안을 지나지 않아요.`);
  area.properties = { name: `${regionFeature.properties.name} · ${road}` };
  return area;
}

export function assertAreaSize(areaFeature) {
  const km2 = turf.area(areaFeature) / 1e6;
  if (km2 > MAX_AREA_KM2) {
    throw new SearchError(
      `범위가 너무 넓어요 (${km2.toFixed(1)}km²). 동 이름이나 도로명으로 좁혀 주세요.`
    );
  }
}

// 상가정보 API 키가 없을 때 쓰는 대체 데이터
export async function findOsmRestaurants(areaFeature) {
  const amenity = FOOD_AMENITIES.join("|");
  const elements = await overpass(
    `[out:json][timeout:20];nwr["amenity"~"^(${amenity})$"]${bboxFilter(areaFeature)};out center tags;`
  );

  return elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const t = el.tags || {};
      return {
        id: `${el.type}/${el.id}`,
        name: t["name:ko"] || t.name || "(이름 없음)",
        lat,
        lon,
        cuisine: t.cuisine || "",
        amenity: t.amenity,
        address:
          t["addr:full"] ||
          [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "),
      };
    })
    .filter((r) => r.lat != null && turf.booleanPointInPolygon([r.lon, r.lat], areaFeature));
}
