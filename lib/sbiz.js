// 공공데이터포털 「소상공인시장진흥공단_상가(상권)정보」 API로 구획 안 음식점을 가져온다.
// https://www.data.go.kr/data/15012005/openapi.do
import * as turf from "@turf/turf";
import { SearchError } from "@/lib/osm";

const ENDPOINT = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRectangle";
const FOOD_CATEGORY = "I2"; // 상권업종대분류: 음식
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

export const hasSbizKey = () => Boolean(process.env.DATA_GO_KR_SERVICE_KEY);

async function fetchPage(bbox, pageNo) {
  const [minx, miny, maxx, maxy] = bbox;
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    serviceKey: process.env.DATA_GO_KR_SERVICE_KEY, // 포털의 "Decoding" 키
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    minx: String(minx),
    miny: String(miny),
    maxx: String(maxx),
    maxy: String(maxy),
    indsLclsCd: FOOD_CATEGORY,
    type: "json",
  });
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 키 오류 등은 XML로 온다.
    const msg = text.match(/<returnAuthMsg>([^<]+)/)?.[1] || `HTTP ${res.status}`;
    throw new SearchError(`상가정보 API 오류: ${msg}`);
  }
  const authErr = data.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (authErr) {
    throw new SearchError(`상가정보 API 오류: ${authErr.returnAuthMsg || authErr.errMsg}`);
  }
  const code = data.header?.resultCode;
  if (code === "03") return { items: [], total: 0 }; // 데이터 없음
  if (code !== "00") {
    throw new SearchError(`상가정보 API 오류: ${data.header?.resultMsg || code}`);
  }
  return { items: data.body?.items || [], total: Number(data.body?.totalCount || 0) };
}

export async function findSbizRestaurants(areaFeature) {
  const bbox = turf.bbox(areaFeature);
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items: batch, total } = await fetchPage(bbox, page);
    items.push(...batch);
    if (items.length >= total || batch.length < PAGE_SIZE) break;
  }

  return items
    .map((s) => ({
      id: `sbiz/${s.bizesId}`,
      name: [s.bizesNm, s.brchNm].filter(Boolean).join(" "),
      lat: Number(s.lat),
      lon: Number(s.lon),
      cuisine: s.indsSclsNm || s.indsMclsNm || "",
      address: s.rdnmAdr || s.lnoAdr || "",
    }))
    .filter((r) => r.lat && r.lon && turf.booleanPointInPolygon([r.lon, r.lat], areaFeature));
}
