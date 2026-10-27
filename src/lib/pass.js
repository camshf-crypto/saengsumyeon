import { supabase } from "./supabase";

/*
 * 이용권 요금제 — 관리자가 입금을 승인한 날부터 기간만큼 생수면 유료 기능이 모두 열린다
 * (서버 기준: supabase/functions/_shared/pass.ts 와 같은 계산 · 금액은 sql/sm_81_pass_plans.sql 과 같게)
 */
// sale: false 면 결제 창에 안 보인다 (이미 산 사람의 기간 계산에는 그대로 쓴다)
// 지금은 한 달만 판다 — 12월(예비 고3 시즌)에 6개월·1년을 열려면 sale 을 true 로 바꾸고,
// 서버 물꼬 안내(supabase/functions/agent/index.ts '요금제:' 줄)도 같이 고친다
export const PLANS = [
  { k: "agent30", label: "한 달", days: 30, price: 12900, sale: true },
  { k: "agent180", label: "수시 시즌 6개월", days: 180, price: 59900, tag: "추천", sale: false },
  { k: "agent365", label: "입시 1년", days: 365, price: 99900, sale: false },
];
export const PLANS_ON_SALE = PLANS.filter((p) => p.sale);
export const PASS_PRODUCTS = PLANS.map((p) => p.k);
export const PASS_PRICE = PLANS[0].price; // 가장 싼 요금제 ("12,900원부터")
export const BANK = { name: "국민은행", number: "649301-04-159726", holder: "세움러닝(김지윤)" };

// 이용권으로 열리는 것 (결제 창·안내에 같이 쓴다)
export const PASS_BENEFITS = [
  "물꼬 입시 AI · 사용량 크게 · 광고 없음",
  "수시 면접 기출문제 학습 · 무제한 (AI 피드백 · 꼬리질문)",
  "면접 꼬리질문 · 개수 제한 없음",
  "흔한가 진단 (탐구주제·지원동기·독서) · 횟수 제한 없음",
  "생기부 로드맵 · 탐구팩",
];

// 한 달 값으로 바꾼 가격 (예: 6개월 59,900원 → 약 9,983원)
export const perMonth = (p) => Math.round(p.price / (p.days / 30) / 10) * 10;

// 이용권 끝나는 날 (없으면 null) — 앞 이용권이 끝나기 전에 또 샀으면 이어서 센다
export async function getPassUntil() {
  const { data } = await supabase.from("pay_orders").select("product,decided_at,created_at,qty").in("product", PASS_PRODUCTS).eq("status", "approved");
  const days = Object.fromEntries(PLANS.map((p) => [p.k, p.days]));
  const rows = (data ?? [])
    .map((r) => ({ start: new Date(r.decided_at ?? r.created_at).getTime(), days: (days[r.product] ?? 30) * Math.max(1, Number(r.qty ?? 1)) }))
    .sort((a, b) => a.start - b.start);
  let until = 0;
  for (const r of rows) until = Math.max(until, r.start) + r.days * 86400000;
  return until > Date.now() ? new Date(until).toISOString() : null;
}

export async function hasPass() {
  return Boolean(await getPassUntil());
}