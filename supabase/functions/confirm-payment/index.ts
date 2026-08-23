// supabase/functions/confirm-payment/index.ts
//
// 결제 승인 확정. 리다이렉트와 웹훅 두 경로가 모두 여기로 들어온다.
// 반드시 포트원에 실제 결제 내역을 물어본 뒤 금액을 대조하고 확정한다.
//
// 배포:
//   supabase secrets set PORTONE_V2_API_SECRET=...
//   supabase secrets set PORTONE_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy confirm-payment --no-verify-jwt
//
// --no-verify-jwt 필요: 포트원 웹훅은 로그인 토큰 없이 들어온다.

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

/* ── 웹훅 서명 검증 (Standard Webhooks) ──────────────────── */
async function verifyWebhook(raw: string, headers: Headers): Promise<boolean> {
  const secret = Deno.env.get("PORTONE_WEBHOOK_SECRET");
  if (!secret) return true; // 시크릿 미설정이면 검증 생략 (개발용)

  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader) return false;

  // 타임스탬프가 5분 이상 어긋나면 재전송 공격으로 본다
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // "v1,xxx v1,yyy" 형태로 여러 개가 올 수 있다
  return sigHeader
    .split(" ")
    .map((s) => s.split(",")[1])
    .some((s) => s === expected);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const raw = await req.text();
    const body = JSON.parse(raw || "{}");

    // 웹훅이면 서명 검증
    const isWebhook = Boolean(body?.type && body?.data?.paymentId);
    if (isWebhook && !(await verifyWebhook(raw, req.headers))) {
      return json({ error: "invalid_signature" }, 401);
    }

    const paymentId: string | undefined = isWebhook ? body.data.paymentId : body.paymentId;
    if (!paymentId) return json({ error: "missing_payment_id" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1) 주문 조회
    const { data: order } = await db
      .from("orders")
      .select("*")
      .eq("pg_payment_id", paymentId)
      .maybeSingle();

    if (!order) return json({ error: "order_not_found" }, 404);

    // 이미 확정된 주문이면 여기서 끝 (웹훅 중복 수신)
    if (order.status === "paid") {
      return json({ ok: true, status: "paid", alreadyDone: true });
    }

    // 2) 포트원에 실제 결제 내역을 묻는다 — 프론트가 보낸 값은 믿지 않는다
    const res = await fetch(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${Deno.env.get("PORTONE_V2_API_SECRET")}` },
    });
    const pay = await res.json();

    if (!res.ok) {
      console.error("portone lookup failed", pay);
      return json({ error: "lookup_failed" }, 502);
    }

    await db.from("payment_events").insert({
      order_id: order.id,
      source: isWebhook ? "webhook" : "redirect",
      event_type: body?.type ?? pay?.status,
      pg_tx_id: pay?.transactionId ?? null,
      raw: pay,
    });

    const status: string = pay?.status;

    /* ── 가상계좌 발급 ───────────────────────────────────── */
    if (status === "VIRTUAL_ACCOUNT_ISSUED") {
      const vb = pay?.paymentMethod ?? {};
      await db
        .from("orders")
        .update({
          pg_tx_id: pay?.transactionId ?? null,
          pg_method: "VIRTUAL_ACCOUNT",
          vbank_bank: vb?.bank ?? null,
          vbank_num: vb?.accountNumber ?? null,
          vbank_holder: vb?.remitteeName ?? null,
          vbank_due_at: vb?.expiredAt ?? null,
        })
        .eq("id", order.id);
      return json({ ok: true, status: "vbank_issued" });
    }

    /* ── 실패 / 취소 ─────────────────────────────────────── */
    if (status === "FAILED" || status === "CANCELLED") {
      await db
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          fail_reason: pay?.failure?.message ?? status,
        })
        .eq("id", order.id);
      return json({ ok: false, status: "cancelled" });
    }

    /* ── 결제 완료 ───────────────────────────────────────── */
    if (status !== "PAID") {
      return json({ ok: false, status: status ?? "unknown" });
    }

    // 3) 금액 대조 — 여기가 핵심
    const paidTotal = pay?.amount?.total ?? 0;
    if (paidTotal !== order.paid_amount) {
      console.error("amount mismatch", { paymentId, paidTotal, expected: order.paid_amount });

      // 금액이 다르면 즉시 취소한다
      await fetch(`${PORTONE_API}/payments/${encodeURIComponent(paymentId)}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `PortOne ${Deno.env.get("PORTONE_V2_API_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "결제 금액 불일치" }),
      });

      await db
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          fail_reason: `amount_mismatch: ${paidTotal} != ${order.paid_amount}`,
        })
        .eq("id", order.id);

      return json({ error: "amount_mismatch" }, 400);
    }

    // 4) 확정 + 수강권 발급 (멱등)
    const { data: confirmed, error: rpcErr } = await db.rpc("confirm_order", {
      p_order_id: order.id,
      p_tx_id: pay?.transactionId ?? paymentId,
      p_method: pay?.method?.type ?? order.pg_method ?? "CARD",
      p_receipt: pay?.receiptUrl ?? null,
    });
    if (rpcErr) throw rpcErr;

    // 5) 결제한 상품은 장바구니에서 뺀다
    const { data: items } = await db
      .from("order_items")
      .select("product_id")
      .eq("order_id", order.id);

    const productIds = (items ?? []).map((i) => i.product_id).filter(Boolean);
    if (productIds.length > 0) {
      await db.from("cart_items").delete().eq("user_id", order.user_id).in("product_id", productIds);
    }

    return json({ ok: true, status: "paid", newlyConfirmed: confirmed === true });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});