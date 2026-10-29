import { supabase } from "./supabase";

/*
 * 이용권 요금제 — 관리자가 입금을 승인한 날부터 기간만큼 생수면 유료 기능이 모두 열린다
 * (서버 기준: supabase/functions/_shared/pass.ts 와 같은 계산 · 금액은 sql/sm_81_pass_plans.sql 과 같게)
 */
// sale: false 면 결제 창에 안 보인다 (이미 산 사람의 기간 계산에는 그대로 쓴다)
// 지금은 1년 이용권 하나만 판다 (첫해 가격 79,000원) — 한 달·6개월은 팔지 않는다
// 가격을 바꾸면 sql 의 agent_order 금액 · 서버 물꼬 안내(supabase/functions/agent/index.ts '요금제:' 줄)도 같이 고친다
export const PLANS = [
  { k: "agent30", label: "한 달", days: 30, price: 12900, sale: false },
  { k: "agent180", label: "수시 시즌 6개월", days: 180, price: 59900, sale: false },
  { k: "agent365", label: "1년 이용권", days: 365, price: 79000, tag: "첫해 가격", sale: true },
];
export const PLANS_ON_SALE = PLANS.filter((p) => p.sale);
export const PASS_PRODUCTS = PLANS.map((p) => p.k);
export const PASS_PRICE = PLANS_ON_SALE[0].price; // 지금 파는 요금제 가격 (79,000원)
export const BANK = { name: "국민은행", number: "649301-04-159726", holder: "세움러닝(김지윤)" };

// 이용권으로 열리는 것 (결제 창·안내에 같이 쓴다)
export const PASS_BENEFITS = [
  "물꼬 입시 AI · 무제한 · 광고 없음",
  "흔한가 진단 (탐구주제·지원동기·독서) · 무제한",
  "탐구 보고서 · 결과 분석 → 보고서 PDF 완성",
  "생기부 AI 진단 + 로드맵 · 생기부 예상질문 6곳",
  "수시 면접 기출 6곳 · 꼬리질문 무제한",
  "공부법 도감 (입시 플랜 · 학습 플랜) · 학습 다이어리 · 자기주도학습법",
  "선배 합격 생기부 5개",
  // 아직 만드는 중 — 열리면 '(출시 예정)'을 지운다
  "수행평가 완성 · 무제한 (출시 예정)",
  "선택과목 · 내 학과 맞춤 3년 설계 (출시 예정)",
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