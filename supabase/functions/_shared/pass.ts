// 이용권 — 관리자가 입금을 승인한 날부터 요금제 기간만큼 (sql/sm_81_pass_plans.sql)
//   agent30 한 달 12,900원 (30일) · agent180 수시 시즌 59,900원 (180일) · agent365 입시 1년 99,900원 (365일)
// 이용권이 있으면 생수면 유료 기능이 모두 열린다: 물꼬 입시 에이전트(주간 사용량 크게 · 광고 없음),
// 생기부 예상질문(대학 6곳 · PDF), 면접 꼬리질문(개수 제한 없음), 생기부 로드맵, 탐구팩, 흔한가 진단(횟수 제한 없음)
// 여러 번 사면 기간이 이어 붙는다 (끝나는 날 다음부터)
export const PLAN_DAYS: Record<string, number> = { agent30: 30, agent180: 180, agent365: 365 };

export async function passUntil(db: any, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db
    .from("pay_orders").select("product,decided_at,created_at,qty")
    .eq("user_id", userId).in("product", Object.keys(PLAN_DAYS)).eq("status", "approved");
  // 승인 순서대로 — 앞 이용권이 끝나기 전에 또 샀으면 끝나는 날부터 이어서 센다
  const rows = (data ?? []).map((r: any) => ({ start: new Date(r.decided_at ?? r.created_at).getTime(), days: (PLAN_DAYS[r.product] ?? 30) * Math.max(1, Number(r.qty ?? 1)) }))
    .sort((a: any, b: any) => a.start - b.start);
  let until = 0;
  for (const r of rows) until = Math.max(until, r.start) + r.days * 86400000;
  return until > Date.now() ? new Date(until).toISOString() : null;
}

export async function hasPass(db: any, userId: string | null | undefined) {
  return Boolean(await passUntil(db, userId));
}