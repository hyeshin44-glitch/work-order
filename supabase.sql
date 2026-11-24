-- 작업지시 관리: 수파베이스 표 만들기
-- 수파베이스 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 을 누르면 됩니다.

-- 1) 규격 (품명별 입수량, 포장박스)
create table if not exists specs (
  id         bigint generated always as identity primary key,
  name       text not null unique,          -- 품명
  spec       text default '',               -- 규격
  per_box    integer,                       -- 입수량 (한 박스에 들어가는 개수)
  outbox     text default '',               -- 포장박스(아웃박스)
  created_at timestamptz default now()
);

-- 2) 작업지시
create table if not exists work_orders (
  id          bigint generated always as identity primary key,  -- 작업No.
  instructor  text not null,                 -- 지시자 (로그인 이름 자동)
  order_date  date not null default (now() at time zone 'Asia/Seoul')::date, -- 작업지시일
  ship_date   date,                          -- 출고일
  customer    text default '',               -- 주문자
  destination text default '',               -- 주문처
  item        text default '',               -- 품목
  outbox      text default '',               -- 아웃박스
  q1  integer, q2  integer, q3  integer, q4  integer,
  q5  integer, q6  integer, q7  integer, q8  integer,
  q9  integer, q10 integer, q11 integer, q12 integer,  -- 수량N (N개 묶음 수)
  memo        text default '',               -- 비고
  in_progress boolean not null default false, -- 작업진행중
  done        boolean not null default false, -- 완료
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists work_orders_ship_date_idx on work_orders (ship_date);
create index if not exists work_orders_order_date_idx on work_orders (order_date);

-- 3) 로그인이 이름만 쓰는 방식이라, 링크를 아는 사람은 누구나 읽고 쓸 수 있게 열어 둡니다.
alter table specs enable row level security;
alter table work_orders enable row level security;

drop policy if exists "open specs" on specs;
create policy "open specs" on specs for all to anon, authenticated using (true) with check (true);

drop policy if exists "open work_orders" on work_orders;
create policy "open work_orders" on work_orders for all to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on specs, work_orders to anon, authenticated;

-- 4) 시즌 데이터 전체 삭제 (작업No.도 1번부터 다시 시작)
create or replace function reset_season(include_specs boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table work_orders restart identity;
  if include_specs then
    truncate table specs restart identity;
  end if;
end;
$$;

grant execute on function reset_season(boolean) to anon, authenticated;

-- 5) 다른 사람이 입력하면 내 화면도 바로 바뀌도록 실시간 알림 켜기
do $$
begin
  begin
    alter publication supabase_realtime add table work_orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table specs;
  exception when duplicate_object then null;
  end;
end $$;
