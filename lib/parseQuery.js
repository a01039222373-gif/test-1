// 사용자가 입력한 자연어 검색어에서 지역(동/지명)과 도로명(○○로/○○길)을 뽑아낸다.
// GEMINI_API_KEY가 있으면 Gemini로 해석하고, 없거나 실패하면 간단한 규칙으로 해석한다.

const SCHEMA = {
  type: "OBJECT",
  properties: {
    city: { type: "STRING", description: "시/구 이름. 없으면 빈 문자열" },
    region: { type: "STRING", description: "동 이름 또는 지명. 없으면 빈 문자열" },
    road: { type: "STRING", description: "도로명(○○로, ○○길). 없으면 빈 문자열" },
    dongs: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "region이 여러 행정동으로 나뉜 동이면 그 행정동 이름들",
    },
  },
  required: ["city", "region", "road", "dongs"],
};

const PROMPT = `너는 한국 지도 검색어 해석기다. 사용자의 검색어에서 다음을 뽑아 JSON으로만 답하라.
- city: 시/군/구 이름 (예: "강남구", "성동구"). 구를 알 수 있으면 구 이름을 쓴다. 없으면 "".
- region: 동 이름이나 지명 (예: "역삼동", "성수동", "홍대"). 없으면 "".
- road: 도로명 (예: "테헤란로", "연무장길"). 없으면 "".
- dongs: region이 여러 행정동으로 나뉘어 있으면 그 행정동 이름 전체 (예: 성수동 → ["성수1가1동", "성수1가2동", "성수2가1동", "성수2가3동"]). 나뉘지 않았거나 모르면 [].
맞춤법은 실제 행정구역/도로명 표기로 바로잡되, 없는 정보는 지어내지 마라.

검색어: `;

function ruleBased(text) {
  const tokens = text
    .replace(/(에\s*있는|근처|주변|식당|맛집|음식점|보여줘|찾아줘|알려줘)/g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  const road = tokens.find((t) => /(로|길)$/.test(t) && !/(동|가)$/.test(t)) || "";
  const city = tokens.find((t) => /(시|구|군)$/.test(t)) || "";
  const region = tokens.filter((t) => t !== road && t !== city).join(" ");
  return { city, region, road, dongs: [] };
}

export async function parseQuery(text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ...ruleBased(text), parser: "rule" };

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(10000), // 붐빌 때 오래 걸리면 규칙 기반으로 넘어간다
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: PROMPT + text }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
          },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
    return {
      city: parsed.city || "",
      region: parsed.region || "",
      road: parsed.road || "",
      dongs: Array.isArray(parsed.dongs) ? parsed.dongs.filter(Boolean).slice(0, 8) : [],
      parser: "gemini",
    };
  } catch (err) {
    console.error("Gemini parse failed, falling back to rules:", err.message);
    return { ...ruleBased(text), parser: "rule" };
  }
}
