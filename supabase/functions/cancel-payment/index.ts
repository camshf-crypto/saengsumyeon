// supabase/functions/cancel-payment/index.ts
//
// 관리자가 환불을 확정하면 포트원에 실제 취소를 요청하고,
// 성공한 경우에만 주문·수강권·환불신청 상태를 정리한다.
//
// 배포: supabase functions deploy cancel-payment

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

const PORTONE_API = "https://api.portone.io";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) 관리자인지 확인
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth } = await asUser.auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized" }, 401);

    const { data: me } = await db
      .from("profiles")
      .select("role")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (me?.role !== "master") return json({ error: "forbidden" }, 403);

    const { refundRequestId, amount, note } = await req.json();
    if (!refundRequestId) return json({ error: "missing_request" }, 400);

    // 2) 신청서 + 주문
    const { data: reqRow } = await db
      .from("refund_requests")
      .select("*, orders(*)")
      .eq("id", refundRequestId)
      .maybeSingle();

    if (!reqRow) return json({ error: "request_not_found" }, 404);
    if (reqRow.status === "done") return json({ error: "already_done" }, 400);

    const order = reqRow.orders;
    if (!order) return json({ error: "order_not_found" }, 404);
    if (order.status !== "paid") return json({ error: "order_not_refundable" }, 400);

    const refundAmount = Number(amount ?? order.paid_amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0)
      return json({ error: "invalid_amount" }, 400);
    if (refundAmount > order.paid_amount) return json({ error: "amount_exceeds_paid" }, 400);

    // 3) 포트원 취소 요청
    const body: Record<string, unknown> = {
      reason: note?.slice(0, 200) || "고객 환불 요청",
    };
    // 전액이면 amount를 생략한다 (포트원은 미지정 시 전액 취소)
    if (refundAmount < order.paid_amount) body.amount = refundAmount;

    // 가상계좌는 현금 환불이라 입금받을 계좌가 필요하다
    if (order.pg_method === "VIRTUAL_ACCOUNT") {
      if (!reqRow.bank_name || !reqRow.account_number || !reqRow.account_holder)
        return json({ error: "missing_refund_account" }, 400);
      body.refundAccount = {
        bank: reqRow.bank_name,
        number: reqRow.account_number,
        holderName: reqRow.account_holder,
      };
    }

    const res = await fetch(
      `${PORTONE_API}/payments/${encodeURIComponent(order.pg_payment_id)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `PortOne ${Deno.env.get("PORTONE_V2_API_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const pg = await res.json();

    await db.from("payment_events").insert({
      order_id: order.id,
      source: "manual",
      event_type: res.ok ? "Cancel.Succeeded" : "Cancel.Failed",
      pg_tx_id: order.pg_tx_id,
      raw: pg,
    });

    if (!res.ok) {
      console.error("portone cancel failed", pg);
      // 포트원이 거절했으면 아무것도 바꾸지 않는다
      return json(
        { error: "pg_cancel_failed", message: pg?.message ?? "결제 취소에 실패했습니다." },
        502
      );
    }

    // 4) 취소 성공 — 상태 정리
    const isFull = refundAmount >= order.paid_amount;

    await db
      .from("orders")
      .update({
        status: "refunded",
        cancelled_at: new Date().toISOString(),
        fail_reason: isFull ? null : `부분 환불 ${refundAmount}원`,
      })
      .eq("id", order.id);

    await db.from("enrollments").update({ status: "revoked" }).eq("order_id", order.id);

    await db
      .from("refund_requests")
      .update({
        status: "done",
        refund_amount: refundAmount,
        admin_note: note?.trim() || null,
        handled_at: new Date().toISOString(),
      })
      .eq("id", refundRequestId);

    // 사용했던 쿠폰은 되돌려준다
    if (order.user_coupon_id) {
      await db
        .from("user_coupons")
        .update({ used_at: null, order_id: null })
        .eq("id", order.user_coupon_id);
    }

    return json({ ok: true, refundAmount, isFull });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});