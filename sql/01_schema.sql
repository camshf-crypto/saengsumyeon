-- ============================================================
-- 생수면 온라인 강의몰 · 1단계 스키마
-- Supabase SQL Editor에 그대로 붙여넣어 실행
-- ============================================================

-- ── 0. 회원 ────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  phone       text,
  school      text,               -- 재학 고교
  grade       text,               -- 고1/고2/고3/N수
  role        text not null default 'student',   -- student | master
  marketing_agreed boolean default false,
  created_at  timestamptz default now()
);

-- ── 1. 판매 상품 ───────────────────────────────────────────
-- 장바구니·주문에 담기는 단위. 강의 그 자체가 아니라 "파는 것".
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,           -- 강의 + 워크북 PACK
  summary      text,
  kind         text not null,           -- course | book | pack
  list_price   int  not null default 0, -- 정상가 (0이면 미표시)
  price        int  not null,           -- 판매가
  access_days  int  not null default 90,
  thumbnail_url text,
  is_published boolean default false,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

-- ── 2. 강의 / 세부 강의 ────────────────────────────────────
create table if not exists courses (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,            -- 생수면 대입면접 합격패스
  description text,
  is_published boolean default false,
  created_at  timestamptz default now()
);

-- 상품 → 강의 연결 (팩 하나에 강의 여러 개 가능)
create table if not exists product_courses (
  product_id uuid references products(id) on delete cascade,
  course_id  uuid references courses(id)  on delete cascade,
  primary key (product_id, course_id)
);

-- 6강 안의 24개 세부 강의
create table if not exists lectures (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references courses(id) on delete cascade,
  chapter_no    int  not null,          -- 1~6강
  chapter_title text not null,          -- 인성·공동체역량
  title         text not null,          -- 2-1 면접관이 학생부에서 질문을 찾는 방법
  sort_order    int  not null default 0,
  duration_sec  int  default 0,
  video_provider text default 'vimeo',  -- vimeo | mux | cloudflare
  video_key     text,                   -- 외부 스트리밍 ID (원본 URL 저장 금지)
  is_free_preview boolean default false,
  created_at    timestamptz default now()
);
create index if not exists idx_lectures_course on lectures(course_id, chapter_no, sort_order);

-- 강의 자료 (워크북 PDF, 기출 자료 등)
create table if not exists course_materials (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references courses(id) on delete cascade,
  title      text not null,
  file_path  text not null,             -- storage 경로 (비공개 버킷)
  sort_order int default 0
);

-- ── 3. 장바구니 ────────────────────────────────────────────
create table if not exists cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty        int  not null default 1,
  created_at timestamptz default now(),
  unique (user_id, product_id)
);

-- ── 4. 쿠폰 ────────────────────────────────────────────────
create table if not exists coupons (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,          -- 세움스피치 수강생 50% 할인
  discount_type text not null,          -- percent | amount
  discount_value int not null,
  min_amount    int default 0,
  valid_from    timestamptz,
  valid_until   timestamptz,
  max_uses      int,
  used_count    int default 0,
  is_active     boolean default true
);

create table if not exists user_coupons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  coupon_id  uuid not null references coupons(id) on delete cascade,
  issued_at  timestamptz default now(),
  expires_at timestamptz,
  used_at    timestamptz,
  order_id   uuid,
  unique (user_id, coupon_id)
);

-- ── 5. 주문 / 결제 ─────────────────────────────────────────
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  order_no        text unique not null,   -- 표시용 주문번호
  user_id         uuid not null references auth.users(id),
  total_amount    int not null,           -- 총 주문금액
  discount_amount int not null default 0,
  paid_amount     int not null,           -- 총 결제금액
  status          text not null default 'pending',
                  -- pending | paid | cancelled | refund_requested | refunded
  user_coupon_id  uuid references user_coupons(id),
  pg_provider     text,                   -- toss
  pg_payment_key  text,                   -- PG 거래키 (승인 검증용)
  paid_at         timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz default now()
);
create index if not exists idx_orders_user on orders(user_id, created_at desc);

-- 주문 시점의 상품명·가격을 그대로 박제 (나중에 가격 바뀌어도 주문내역 불변)
create table if not exists order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  product_id   uuid references products(id),
  name_snapshot  text not null,
  price_snapshot int  not null,
  access_days_snapshot int not null,
  qty          int not null default 1
);

-- ── 6. 수강권 / 진도 ───────────────────────────────────────
create table if not exists enrollments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  order_id   uuid references orders(id),
  starts_at  timestamptz not null default now(),
  expires_at timestamptz not null,        -- starts_at + access_days
  status     text not null default 'active', -- active | expired | revoked
  unique (user_id, course_id, order_id)
);
create index if not exists idx_enroll_user on enrollments(user_id, status);

create table if not exists lecture_progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  lecture_id   uuid not null references lectures(id) on delete cascade,
  played_sec   int  not null default 0,
  is_completed boolean default false,
  last_played_at timestamptz default now(),
  primary key (user_id, lecture_id)
);

-- ── 7. 환불 신청 ───────────────────────────────────────────
create table if not exists refund_requests (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reason      text not null,       -- stage1_fail | change_mind | etc
  detail      text,
  status      text not null default 'requested', -- requested | approved | rejected | done
  admin_note  text,
  requested_at timestamptz default now(),
  handled_at  timestamptz
);

-- ============================================================
-- RLS
-- ============================================================
alter table profiles         enable row level security;
alter table products         enable row level security;
alter table courses          enable row level security;
alter table product_courses  enable row level security;
alter table lectures         enable row level security;
alter table course_materials enable row level security;
alter table cart_items       enable row level security;
alter table coupons          enable row level security;
alter table user_coupons     enable row level security;
alter table orders           enable row level security;
alter table order_items      enable row level security;
alter table enrollments      enable row level security;
alter table lecture_progress enable row level security;
alter table refund_requests  enable row level security;

-- 관리자 판별 (LMS와 동일하게 role='master')
create or replace function is_master()
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'master');
$$;

-- 유효한 수강권 보유 여부
create or replace function has_access(p_course_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from enrollments
    where user_id = auth.uid()
      and course_id = p_course_id
      and status = 'active'
      and expires_at > now()
  );
$$;

-- 내 프로필
create policy "profile self"  on profiles for select using (id = auth.uid() or is_master());
create policy "profile write" on profiles for update using (id = auth.uid() or is_master());
create policy "profile insert" on profiles for insert with check (id = auth.uid());

-- 공개 진열 정보는 누구나 조회
create policy "product read"  on products        for select using (is_published or is_master());
create policy "course read"   on courses         for select using (is_published or is_master());
create policy "pc read"       on product_courses for select using (true);

-- 강의 영상은 수강권이 있어야 조회 (맛보기는 공개)
create policy "lecture read" on lectures for select
  using (is_free_preview or has_access(course_id) or is_master());
create policy "material read" on course_materials for select
  using (has_access(course_id) or is_master());

-- 장바구니는 본인만
create policy "cart own" on cart_items for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 쿠폰
create policy "coupon read"     on coupons      for select using (is_active or is_master());
create policy "usercoupon own"  on user_coupons for select using (user_id = auth.uid() or is_master());

-- 주문: 본인 조회만. 생성·상태변경은 Edge Function(service_role)에서만.
create policy "order read"  on orders      for select using (user_id = auth.uid() or is_master());
create policy "oitem read"  on order_items for select
  using (exists (select 1 from orders o where o.id = order_id and (o.user_id = auth.uid() or is_master())));

-- 수강권: 본인 조회만. 발급은 서버에서.
create policy "enroll read" on enrollments for select using (user_id = auth.uid() or is_master());

-- 진도는 본인이 직접 기록
create policy "progress own" on lecture_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 환불 신청은 본인이 작성, 처리는 관리자
create policy "refund own"    on refund_requests for select using (user_id = auth.uid() or is_master());
create policy "refund insert" on refund_requests for insert with check (user_id = auth.uid());
create policy "refund admin"  on refund_requests for update using (is_master());

-- 관리자 전체 쓰기
create policy "admin products" on products for all using (is_master()) with check (is_master());
create policy "admin courses"  on courses  for all using (is_master()) with check (is_master());
create policy "admin lectures" on lectures for all using (is_master()) with check (is_master());
create policy "admin materials" on course_materials for all using (is_master()) with check (is_master());
create policy "admin coupons"  on coupons  for all using (is_master()) with check (is_master());

-- ============================================================
-- 가입 시 profiles 자동 생성
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', '수강생'),
          new.raw_user_meta_data->>'phone');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
