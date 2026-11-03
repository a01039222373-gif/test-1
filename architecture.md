# Architecture

## 전체 구성

```
┌──────────────────────── 브라우저 (모든 사용자) ────────────────────────┐
│  app/page.js  ──  검색창 · 요약 · 범례                                │
│      │                                                                │
│      ├─ components/MapView.js  ── Leaflet 지도 ◀── OSM 타일 서버       │
│      │      (구획 폴리곤, 식당 마커, 가능/불가능 팝업)                   │
│      │                                                                │
│      └─ lib/supabase.js ── 읽기 · upsert · Realtime 구독 ──┐            │
└──────┬─────────────────────────────────────────────────────┼──────────┘
       │ GET /api/search?q=...                               │
       ▼                                                     ▼
┌──────────── Vercel (Next.js 서버) ────────────┐   ┌──── Supabase ────┐
│ app/api/search/route.js                       │   │ bipple_status     │
│   1. lib/parseQuery.js ──────▶ Gemini API     │   │ (RLS + Realtime)  │
│   2. lib/osm.js findRegion ──▶ Nominatim      │   └──────────────────┘
│   3. lib/osm.js narrowToRoad ▶ Nominatim      │
│   4. assertAreaSize                           │
│   5. lib/sbiz.js ────────────▶ 공공데이터포털   │
│      (키 없으면 lib/osm.js ──▶ Overpass)        │
└───────────────────────────────────────────────┘
```

- **식당 데이터**는 검색할 때마다 외부 API에서 가져오고 저장하지 않아요.
- **비플페이 표시**만 Supabase에 저장해요.
- 비밀 키(Gemini, 공공데이터)는 서버에서만 쓰고, 브라우저에는 Supabase 공개(anon) 키만 전달돼요.

## 폴더 구조

```
test-1/
├─ app/
│  ├─ layout.js            HTML 뼈대, 메타데이터
│  ├─ page.js              메인 화면 (클라이언트 컴포넌트)
│  ├─ globals.css          스타일, 형광 테두리(.neon) 효과
│  └─ api/search/route.js  검색 API
├─ components/
│  └─ MapView.js           Leaflet 지도
├─ lib/
│  ├─ parseQuery.js        검색어 → { city, region, road }
│  ├─ osm.js               경계 폴리곤, 도로 구획, 대체 식당 데이터
│  ├─ sbiz.js              소상공인 상가정보 API
│  └─ supabase.js          Supabase 클라이언트 (키 없으면 null)
├─ supabase/schema.sql     DB 테이블 · 권한 · Realtime
├─ .env.example            환경변수 목록
├─ README.md               소개 · 설치 · 배포
├─ 작업절차.md              만든 과정
└─ architecture.md         이 문서
```

## 검색 처리 흐름

```
"역삼동 테헤란로 맛집"
   │ parseQuery (Gemini, 실패 시 규칙)
   ▼
{ city: "", region: "역삼동", road: "테헤란로" }
   │ findRegion: Nominatim polygon_geojson
   ▼
역삼동 경계 폴리곤 (경계 없는 지명은 반경 500m 원)
   │ narrowToRoad: 경계 bbox 안의 테헤란로 구간 → 60m 버퍼 → 경계와 교집합
   ▼
구획 폴리곤
   │ assertAreaSize: 25km² 초과 시 중단
   │ findSbizRestaurants: bbox로 음식(I2) 업소 조회 → 폴리곤 안만 남김
   ▼
{ parsed, area, restaurants[], source: "sbiz" | "osm" }
```

### 식당 객체

| 필드 | 상가정보 (`sbiz`) | OSM 대체 (`osm`) |
| --- | --- | --- |
| `id` | `sbiz/{bizesId}` | `node/{id}`, `way/{id}` 등 |
| `name` | 상호명 + 지점명 | `name:ko` 또는 `name` |
| `lat`, `lon` | 업소 좌표 | 노드 좌표 또는 중심점 |
| `cuisine` | 업종 소분류명 | `cuisine` 태그 |
| `address` | 도로명주소 또는 지번주소 | `addr:*` 태그 |

## 비플페이 표시 흐름

```
사용자 A: 마커 클릭 → [비플페이 가능]
   │ 화면에 먼저 반영
   │ supabase.upsert(bipple_status, { restaurant_id, status: "yes", ... })
   │   └ 실패 시 이전 상태로 되돌리고 오류 표시
   ▼
Supabase bipple_status (restaurant_id 기본키 → 마지막 응답만 남음)
   │ Realtime postgres_changes
   ▼
사용자 B, C …: statuses 갱신 → 마커 스타일 변경
```

### 테이블 `bipple_status`

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `restaurant_id` | text, PK | 식당 객체의 `id` |
| `name` | text | 상호 (확인용) |
| `lat`, `lon` | double precision | 좌표 (확인용) |
| `status` | text | `yes` 또는 `no` |
| `updated_at` | timestamptz | 마지막 응답 시각 |

권한(RLS): 누구나 읽기·추가·수정 가능, 삭제 불가.

### 마커 스타일

| 상태 | 테두리 | 채움 | 비고 |
| --- | --- | --- | --- |
| 미확인 | 파랑 2px | 파랑 | |
| 가능 (`yes`) | 형광 초록 `#39ff14` 5px | 파랑 | `drop-shadow` 빛 번짐, 맨 앞으로 |
| 불가능 (`no`) | 회색 2px | 회색 | |

## 외부 서비스

| 서비스 | 용도 | 키 | 비고 |
| --- | --- | --- | --- |
| OpenStreetMap 타일 | 지도 배경 | 없음 | 출처 표기 필요 |
| Nominatim | 지역 경계, 도로 구간 | 없음 | 초당 1회 수준의 가벼운 사용만 허용 |
| 공공데이터포털 상가정보 | 식당 목록 | `DATA_GO_KR_SERVICE_KEY` | Decoding 키 사용 |
| Overpass | 대체 식당 데이터 | 없음 | 공개 서버가 자주 붐빔, 20초 제한 |
| Gemini | 검색어 해석 | `GEMINI_API_KEY` | 모델은 `GEMINI_MODEL`로 변경 |
| Supabase | 표시 저장·실시간 공유 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 키는 공개돼도 되는 키 |

## 설계상 한계

- **로그인 없음**: 누구나 표시를 바꿀 수 있고 기록이 남지 않아요.
- **식당 캐시 없음**: 검색할 때마다 외부 API를 불러요. 사용자가 늘면 구획별 결과를 Supabase에 저장해 두는 방식이 필요해요.
- **도로 구획 폭**: 도로 양옆 60m로 고정돼 있어요(`ROAD_BUFFER_METERS`).
- **식당 ID 출처**: 상가정보와 OSM은 ID 체계가 달라서, 데이터 출처를 바꾸면 기존 표시가 이어지지 않아요.
