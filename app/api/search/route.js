import { NextResponse } from "next/server";
import { parseQuery } from "@/lib/parseQuery";
import { findRegion, narrowToRoad, assertAreaSize, findOsmRestaurants, SearchError } from "@/lib/osm";
import { findSbizRestaurants, hasSbizKey } from "@/lib/sbiz";

export const maxDuration = 60;

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ error: "검색어를 입력해 주세요." }, { status: 400 });

  try {
    const parsed = await parseQuery(q);
    const region = await findRegion(parsed.city, parsed.region || (parsed.road ? "" : q));
    const area = parsed.road ? await narrowToRoad(region, parsed.road) : region;
    assertAreaSize(area);

    const source = hasSbizKey() ? "sbiz" : "osm";
    const restaurants =
      source === "sbiz" ? await findSbizRestaurants(area) : await findOsmRestaurants(area);
    return NextResponse.json({ parsed, area, restaurants, source });
  } catch (err) {
    if (err instanceof SearchError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "검색 중 오류가 났어요." }, { status: 500 });
  }
}
