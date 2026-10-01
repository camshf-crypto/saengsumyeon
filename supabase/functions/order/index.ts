// 계좌이체 주문 — '입금했어요'를 누르면 주문만 접수하고 관리자에게 알림
// 이용권은 관리자가 입금을 확인하고 승인할 때 들어간다
// 배포: npx supabase functions deploy order --project-ref xhywexuazwipwvzrldwo
// 비밀값: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (관리자 폰 푸시 알림)
//
// 요청 (로그인 필수)
//   { product: "ten" | "interview" | "interview6", depositor, receipt?, inquiry_id? }
//   interview  = 생기부 예상질문 지원 대학 1곳 19,000원
//   interview6 = 생기부 예상질문 수시 6곳 24,000원
//
// 금액을 바꾸면 화면(src/pages/inquiry/Paywall.jsx)과 DB 함수 grant_order 의 금액도 같이 바꿔야 한다

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PRODUCTS: Record<string, { name: string; qty: number; amount: number }> = {
  ten: { name: "탐구 10건", qty: 10, amount: 29000 },
  interview: { name: "생기부 예상질문 1곳", qty: 1, amount: 19000 },
  interview6: { name: "생기부 예상질문 6곳", qty: 1, amount: 24000 },
};

/*
 * 관리자 폰으로 푸시 알림 — 관리자 화면에서 '알림 켜기'한 기기 전부
 * 실패해도 주문은 그대로. 없어진 기기(404·410)는 목록에서 지운다
 */
async function notifyAdmins(db: any, payload: { title: string; body: string; url: string }) {
  const pub = (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim();
  const priv = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim();
  if (!pub || !priv) return console.warn("vapid not set");
  try {
    webpush.setVapidDetails((Deno.env.get("VAPID_SUBJECT") ?? "mailto:company@seumlearning.com").trim(), pub, priv);
  } catch (e) {
    // 키 값이 잘못돼도 주문은 그대로 접수한다
    return console.error("vapid invalid", String(e));
  }

  const { data: subs } = await db.from("push_subscriptions").select("*");
  await Promise.all(
    (subs ?? []).map((s: any) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload))
        .catch(async (e: any) => {
          console.error("push failed", e?.statusCode, e?.body);
          if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        })
    )
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "로그인이 필요합니다." }, 401);

    const body = await req.json();
    const p = PRODUCTS[body.product];
    const depositor = String(body.depositor ?? "").trim();
    if (!p) return json({ error: "상품을 골라 주세요." }, 400);
    if (depositor.length < 2) return json({ error: "입금자명을 적어 주세요." }, 400);

    // 같은 사람이 10분 안에 여러 번 누르면 한 번만
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await admin
      .from("pay_orders").select("id").eq("user_id", user.id).eq("status", "pending").gte("created_at", since).limit(1);
    if (recent?.length) return json({ error: "방금 접수된 주문이 있어요. 확인 중이에요." }, 429);

    const { data: orderId, error } = await admin.rpc("grant_order", {
      p_user: user.id,
      p_product: body.product,
      p_depositor: depositor,
      p_receipt: body.receipt ? String(body.receipt) : null,
      p_inquiry: body.inquiry_id ?? null,
    });
    if (error) {
      console.error("grant_order failed", error?.message, error?.details, error?.hint);
      return json({ error: "주문을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." }, 500);
    }

    // 확인 예정 시각 — 밤 12시~아침 6시는 오전 8시, 그 외에는 2시간 안
    const hour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false })) % 24;
    const eta = hour < 6 ? "오늘 오전 8시에" : "2시간 안에";

    // 알림은 실패해도 주문 접수에 영향 없게
    await notifyAdmins(admin, {
      title: "💰 입금 확인 요청",
      body: `${depositor} · ${p.name} ${p.amount.toLocaleString()}원${body.receipt ? " · 현금영수증" : ""}`,
      url: "/admin/orders",
    }).catch((e) => console.error("notify failed", String(e)));

    return json({ order_id: orderId, status: "pending", eta });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});