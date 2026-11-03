-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.bipple_status (
  restaurant_id text primary key,          -- OSM id (예: node/123456)
  name          text,
  lat           double precision,
  lon           double precision,
  status        text not null check (status in ('yes', 'no')),
  updated_at    timestamptz not null default now()
);

-- 로그인이 없으므로 누구나 읽고 쓸 수 있게 한다 (삭제는 막는다).
alter table public.bipple_status enable row level security;

drop policy if exists "anyone can read" on public.bipple_status;
create policy "anyone can read" on public.bipple_status for select using (true);

drop policy if exists "anyone can insert" on public.bipple_status;
create policy "anyone can insert" on public.bipple_status for insert with check (true);

drop policy if exists "anyone can update" on public.bipple_status;
create policy "anyone can update" on public.bipple_status for update using (true) with check (true);

-- 다른 사용자의 변경을 화면에 실시간 반영
alter publication supabase_realtime add table public.bipple_status;
