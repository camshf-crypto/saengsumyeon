// supabase/functions/create-order/index.ts
//
// 장바구니 항목으로 pending 주문을 만든다.
// 결제 금액은 반드시 여기서 확정한다. 프론트가 보낸 금액은 쓰지 않는다.
//
// 배포: supabase functions deploy create-order

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// SM20260805-A1B2C3 형태. 포트원 paymentId로 그대로 쓴다.
function makeOrderNo() {
  const d = new Date();
  const ymd =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SM${ymd}-${rand}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 요청자 확인 (RLS 적용된 클라이언트로 본인 확인만)
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth } = await asUser.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const { cartItemIds, userCouponId, method } = await req.json();
    if (!Array.isArray(cartItemIds) || cartItemIds.length === 0) {
      return json({ error: "empty_cart" }, 400);
    }

    // 이후 조회·쓰기는 service_role로
    const db = createClient(url, serviceKey);

    // 1) 장바구니 항목 — 반드시 본인 것만
    const { data: items, error: itemErr } = await db
      .from("cart_items")
      .select("id, product_id, products(id, name, price, access_days, is_published)")
      .eq("user_id", user.id)
      .in("id", cartItemIds);

    if (itemErr) throw itemErr;
    if (!items || items.length === 0) return json({ error: "empty_cart" }, 400);
    if (items.some((i) => !i.products?.is_published)) {
      return json({ error: "product_unavailable" }, 400);
    }

    // 2) 이미 수강 중인 강의를 또 사는 것 막기
    const productIds = items.map((i) => i.product_id);
    const { data: pcs } = await db
      .from("product_courses")
      .select("product_id, course_id")
      .in("product_id", productIds);

    const courseIds = [...new Set((pcs ?? []).map((p) => p.course_id))];
    if (courseIds.length > 0) {
      const { data: owned } = await db
        .from("enrollments")
        .select("course_id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .in("course_id", courseIds);
      if (owned && owned.length > 0) {
        return json({ error: "already_enrolled" }, 400);
      }
    }

    // 3) 금액 확정 (DB 가격 기준)
    const subtotal = items.reduce((s, i) => s + (i.products?.price ?? 0), 0);

    // 4) 쿠폰 검증
    let discount = 0;
    let validCouponId: string | null = null;

    if (userCouponId) {
      const { data: uc } = await db
        .from("user_coupons")
        .select("id, user_id, used_at, expires_at, coupons(discount_type, discount_value, min_amount, is_active)")
        .eq("id", userCouponId)
        .maybeSingle();

      const c = uc?.coupons as
        | { discount_type: string; discount_value: number; min_amount: number; is_active: boolean }
        | undefined;

      const usable =
        uc &&
        uc.user_id === user.id &&
        !uc.used_at &&
        (!uc.expires_at || new Date(uc.expires_at) > new Date()) &&
        c?.is_active &&
        subtotal >= (c?.min_amount ?? 0);

      if (!usable) return json({ error: "invalid_coupon" }, 400);

      discount =
        c!.discount_type === "percent"
          ? Math.floor((subtotal * c!.discount_value) / 100)
          : c!.discount_value;
      discount = Math.min(discount, subtotal);
      validCouponId = uc!.id;
    }

    const payAmount = subtotal - discount;
    if (payAmount <= 0) return json({ error: "invalid_amount" }, 400);

    // 5) 주문 생성
    const orderNo = makeOrderNo();
    const { data: order, error: orderErr } = await db
      .from("orders")
      .insert({
        order_no: orderNo,
        user_id: user.id,
        total_amount: subtotal,
        discount_amount: discount,
        paid_amount: payAmount,
        status: "pending",
        user_coupon_id: validCouponId,
        pg_provider: "portone",
        pg_channel: "inicis",
        pg_payment_id: orderNo,
        pg_method: method ?? "CARD",
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    const { error: oiErr } = await db.from("order_items").insert(
      items.map((i) => ({
        order_id: order.id,
        product_id: i.product_id,
        name_snapshot: i.products!.name,
        price_snapshot: i.products!.price,
        access_days_snapshot: i.products!.access_days,
        qty: 1,
      }))
    );
    if (oiErr) throw oiErr;

    const first = items[0].products!.name;
    const orderName = items.length > 1 ? `${first} 외 ${items.length - 1}건` : first;

    return json({
      orderId: order.id,
      orderNo,
      orderName,
      payAmount, // 결제창에 넘길 금액은 이 값만 사용할 것
    });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});