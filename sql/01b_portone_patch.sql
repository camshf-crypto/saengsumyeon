-- ============================================================
-- 생수면 강의몰 · 1단계 보정 패치
-- 결제사: 포트원(PortOne) + KG이니시스
-- 1단계 스키마 실행 후 이어서 실행
-- ============================================================

-- ── orders 결제 컬럼 정리 ──────────────────────────────────
alter table orders drop column if exists pg_payment_key;

alter table orders
  add column if not exists pg_provider    text default 'portone',
  add column if not exists pg_channel     text default 'inicis',   -- 포트원 채널키에 매핑된 PG사
  add column if not exists pg_payment_id  text,   -- 우리가 만든 결제건 ID (= order_no)
  add column if not exists pg_tx_id       text,   -- 포트원이 발급한 거래 ID
  add column if not exists pg_method      text,   -- card | vbank | trans | phone
  add column if not exists receipt_url    text,   -- 매출전표 URL
  add column if not exists fail_reason    text;

create unique index if not exists uq_orders_pg_tx on orders(pg_tx_id) where pg_tx_id is not null;

-- 가상계좌(무통장)용 — 이니시스 vbank 쓸 경우
alter table orders
  add column if not exists vbank_bank     text,
  add column if not exists vbank_num      text,
  add column if not exists vbank_holder   text,
  add column if not exists vbank_due_at   timestamptz;

-- ── 결제 이벤트 로그 (웹훅 멱등 처리용) ────────────────────
-- 리다이렉트와 웹훅이 같은 결제를 두 번 알려도 수강권이 두 번 나가면 안 됨.
create table if not exists payment_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references orders(id) on delete cascade,
  source      text not null,          -- redirect | webhook | manual
  event_type  text,                   -- Transaction.Paid 등
  pg_tx_id    text,
  raw         jsonb,                  -- 포트원 응답 원문 전체 보관
  created_at  timestamptz default now()
);
create index if not exists idx_payment_events_order on payment_events(order_id, created_at desc);

alter table payment_events enable row level security;
-- 조회는 관리자만. 쓰기는 Edge Function(service_role)만 하므로 정책 없음.
create policy "pevent admin" on payment_events for select using (is_master());

-- ── 결제 승인 처리 (멱등) ──────────────────────────────────
-- Edge Function에서 포트원 API로 금액을 검증한 뒤에만 호출할 것.
-- 이미 paid인 주문은 아무 일도 하지 않고 false를 돌려준다.
create or replace function confirm_order(
  p_order_id uuid,
  p_tx_id    text,
  p_method   text,
  p_receipt  text
) returns boolean
language plpgsql security definer as $$
declare
  v_order orders%rowtype;
  v_item  record;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found: %', p_order_id;
  end if;

  -- 이미 처리된 결제 (웹훅 중복 수신)
  if v_order.status = 'paid' then
    return false;
  end if;

  update orders
     set status      = 'paid',
         pg_tx_id    = p_tx_id,
         pg_method   = p_method,
         receipt_url = p_receipt,
         paid_at     = now()
   where id = p_order_id;

  -- 주문에 포함된 상품의 강의를 수강권으로 발급
  for v_item in
    select oi.access_days_snapshot as days, pc.course_id
      from order_items oi
      join product_courses pc on pc.product_id = oi.product_id
     where oi.order_id = p_order_id
  loop
    insert into enrollments (user_id, course_id, order_id, starts_at, expires_at)
    values (v_order.user_id, v_item.course_id, p_order_id,
            now(), now() + (v_item.days || ' days')::interval)
    on conflict (user_id, course_id, order_id) do nothing;
  end loop;

  -- 쿠폰 사용 확정
  if v_order.user_coupon_id is not null then
    update user_coupons
       set used_at = now(), order_id = p_order_id
     where id = v_order.user_coupon_id and used_at is null;
  end if;

  return true;
end;
$$;

revoke execute on function confirm_order(uuid, text, text, text) from anon, authenticated;
