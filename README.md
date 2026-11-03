# 비플페이 식당 지도

구획(동 이름/지명 + 도로명)을 입력하면 그 구획 안 식당을 지도에 표시하고, 방문자가 식당마다 **비플페이 가능 / 불가능**을 표시해 모든 사용자가 함께 보는 웹 서비스입니다.

- 비플페이 **가능**: 형광 초록 테두리
- **불가능**: 회색
- 같은 식당은 **가장 마지막에 누른 응답**을 따릅니다.
- 로그인 없이 누구나 표시할 수 있고, 다른 사람의 변경은 실시간으로 반영됩니다.

## 동작 방식

1. **검색어 해석**: "역삼동 테헤란로 맛집"처럼 입력한 문장을 Gemini가 `지역(동/지명)`과 `도로명`으로 나눕니다. 키가 없으면 간단한 규칙으로 나눕니다.
2. **구획 만들기**: OpenStreetMap(Nominatim)에서 동/지명의 경계 폴리곤을 가져옵니다. 도로명이 있으면 그 경계 안에서 도로 양옆 60m 띠와 겹치는 부분만 구획으로 씁니다.
3. **식당 목록**: 공공데이터포털 「소상공인시장진흥공단_상가(상권)정보」에서 구획 범위의 음식(대분류 `I2`) 업소를 가져와 폴리곤 안의 것만 남깁니다. 키가 없으면 OpenStreetMap 식당 데이터로 대신 표시합니다.
4. **지도**: Leaflet + OpenStreetMap 타일(키 없음)로 표시합니다.
5. **표시 공유**: Supabase `bipple_status` 테이블에 저장하고 Realtime으로 모든 접속자에게 반영합니다.

## 준비물

| 항목 | 용도 | 받는 곳 |
| --- | --- | --- |
| `DATA_GO_KR_SERVICE_KEY` | 식당 목록 | [data.go.kr 상가(상권)정보 API](https://www.data.go.kr/data/15012005/openapi.do)에서 활용 신청 후 **일반 인증키(Decoding)** |
| `GEMINI_API_KEY` | 자연어 검색어 해석 | [Google AI Studio](https://aistudio.google.com/apikey) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 표시 공유 | Supabase 프로젝트 > Project Settings > API |

## Supabase 설정

Supabase 대시보드 > SQL Editor에서 [supabase/schema.sql](supabase/schema.sql)을 실행합니다.

## 로컬 실행

```bash
npm install
```

`.env.example`을 `.env.local`로 복사하고 키를 채운 뒤:

```bash
npm run dev
```

http://localhost:3000 에서 확인합니다.

## Vercel 배포

1. Vercel에서 이 GitHub 저장소를 Import 합니다.
2. Environment Variables에 위 네 가지 값(+ 선택 `GEMINI_MODEL`)을 넣습니다.
3. Deploy.

## 주의

- 로그인이 없어서 누구나 표시를 바꿀 수 있습니다. 장난 입력을 막는 장치는 없습니다.
- Nominatim(OpenStreetMap 지명 검색)은 초당 1회 정도의 가벼운 사용만 허용합니다. 사용자가 많아지면 결과 캐시나 자체 서버가 필요합니다.
- OpenStreetMap 대체 식당 데이터(Overpass)는 공개 서버가 붐비면 응답하지 않을 수 있습니다.

## 구조

```
app/
  page.js              검색창, 지도, Supabase 실시간 동기화
  api/search/route.js  검색 API (해석 → 구획 → 식당)
components/MapView.js  Leaflet 지도, 마커, 가능/불가능 팝업
lib/
  parseQuery.js        Gemini 검색어 해석
  osm.js               Nominatim 경계·도로, Overpass 대체 식당
  sbiz.js              소상공인 상가정보 API
  supabase.js          Supabase 클라이언트
supabase/schema.sql    테이블·권한·Realtime 설정
```
