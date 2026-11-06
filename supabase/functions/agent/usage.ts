// agent/usage.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { passUntil } from "../_shared/pass.ts";
import { FREE_DAILY_WON, FREE_FROM, FREE_RESET_HOUR, FREE_WON, KRW, PAID_WON, WON_PER_Q } from "./core.ts";


/* 이번 주 시작 (한국 시간 월요일 0시) · 다음 초기화 시각 */
export function weekWindow() {
  const kst = new Date(Date.now() + 9 * 3600000);
  const day = (kst.getUTCDay() + 6) % 7; // 월=0
  const startKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - day);
  const start = new Date(startKst - 9 * 3600000);
  return { start, reset: new Date(start.getTime() + 7 * 86400000) };
}

/* 사용량 — ai_usage 의 물꼬 비용 합계를 한도와 비교해 % 로
 *   2026-11-06: 채팅(agent)만이 아니라 카드로 하는 수행평가 · 탐구(school_task — 질문 · 설계 · 완성본 · 채점)도 같이 센다 (AI를 부르면 토큰이 나가니까) */
export async function usageOf(db: any, userId: string, paid: string | null) {
  // 이용권: 매주 월요일 0시 초기화
  // 무료: ① 처음 맛보기 FREE_WON (FREE_FROM 부터 쓴 전체) → ② 맛보기를 어제까지 다 썼으면 매일 FREE_DAILY_WON (한국 새벽 5시 초기화)
  const { start, reset } = weekWindow();
  const kst = new Date(Date.now() + (9 - FREE_RESET_HOUR) * 3600000); // 한국 시각에서 5시간 빼기 → 새벽 5시가 하루의 시작
  const today = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - (9 - FREE_RESET_HOUR) * 3600000); // 오늘(한국 새벽 5시 기준) 시작
  const tomorrow = new Date(today.getTime() + 86400000);
  const from = paid ? start.toISOString() : FREE_FROM;
  const { data: rows } = await db.from("ai_usage").select("cost_usd,created_at").in("service", ["agent", "school_task"]).eq("user_id", userId).gte("created_at", from).limit(20000);
  const won = (list: any[]) => list.reduce((a: number, r: any) => a + Number(r.cost_usd ?? 0), 0) * KRW;
  if (paid) {
    const pct = Math.min(100, Math.round((won(rows ?? []) / PAID_WON) * 100));
    return { pct, reset_at: reset.toISOString(), free_once: false, paid_until: paid, invite: null };
  }
  const before = won((rows ?? []).filter((r: any) => new Date(r.created_at) < today)); // 어제까지 쓴 것
  const daily = before >= FREE_WON; // 맛보기를 어제까지 다 썼으면 오늘부터는 하루치
  const used = daily ? won((rows ?? []).filter((r: any) => new Date(r.created_at) >= today)) : won(rows ?? []);
  const limit = daily ? FREE_DAILY_WON : FREE_WON;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return {
    pct, reset_at: null, paid_until: paid, invite: null,
    left_q: Math.max(0, Math.floor((limit - used) / WON_PER_Q)), // 남은 질문 수 (대략)
    free_once: !daily,                     // 처음 맛보기 중
    free_daily: daily,                     // 하루치 무료 중
    free_reset_at: tomorrow.toISOString(), // 다 쓰면 다시 채워지는 때 (맛보기를 오늘 다 써도 내일 0시부터 하루치)
  };
}

/* 이용권: _shared/pass.ts 의 passUntil (한 달·6개월·1년) */

/*
 * 기출문제 학습(/prep) 무료 문제 수 — 결제 없이 무료 3문제 + 친구 1명 가입할 때마다 5문제 (sql/sm_86)
 * 친구 초대 대신 결제: 한 달 이용권 12,900원 = 기출 무제한 · 생기부 예상질문 24,000원 = 기출 무제한 + 예상질문 학습
 * 학교: 무료는 처음 AI 피드백을 받은 학교 1곳만 (지웠다 다시 넣어도 그 학교) · 결제하면 6곳까지
 * 생기부 예상질문에서 나온 질문(source interview)은 24,000원 결제(interview_access)한 학생만
 */
export const STUDY_FREE = 0; // 기출 AI 피드백은 이용권 전용 (무료 문제 없음)
export const STUDY_PER_FRIEND = 0; // 친구 초대로 늘어나는 문제도 없음
// 학교 이름 맞추기 — "단국대학교(죽전)" · "단국대" 를 같은 학교로
export const ukey = (v: string) => String(v ?? "").replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교$|대학$/, "대");
export const STUDY_SCHOOLS_FREE = 1; // 무료는 학교 1곳 (처음 AI 피드백을 받은 학교)
export const STUDY_SCHOOLS_PAID = 6; // 결제하면 6곳까지
export async function studyQuota(db: any, userId: string) {
  const [{ count: used }, { data: refs }, { data: adm }, { data: acc }, pass, { data: schoolRows }] = await Promise.all([
    db.from("prep_study_uses").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "past"),
    db.from("referrals").select("referred_user_id").eq("referrer_id", userId).not("referred_user_id", "is", null).limit(1000),
    db.from("admins").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("interview_access").select("user_id").eq("user_id", userId).maybeSingle(),
    passUntil(db, userId),
    db.from("prep_study_uses").select("university,created_at").eq("user_id", userId).eq("source", "past").order("created_at", { ascending: true }).limit(2000),
  ]);
  // 기출을 푼 학교 (처음 푼 순) — 맨 처음 학교가 무료 학교
  const schools: string[] = [];
  for (const r of schoolRows ?? []) if (!schools.some((x) => ukey(x) === ukey(r.university))) schools.push(r.university);
  const friends = new Set((refs ?? []).map((r: any) => r.referred_user_id).filter((id: string) => id && id !== userId)).size;
  const admin = Boolean(adm);
  // 기출 무제한: 한 달 이용권(12,900원) 기간 중 · 생기부 예상질문(24,000원) 결제 · 관리자
  const unlimited = admin || Boolean(acc) || Boolean(pass);
  const limit = unlimited ? 9999 : STUDY_FREE + friends * STUDY_PER_FRIEND;
  return {
    used: used ?? 0, limit, left: Math.max(0, limit - (used ?? 0)), friends, free: STUDY_FREE, per_friend: STUDY_PER_FRIEND,
    interview_paid: admin || Boolean(acc) || Boolean(pass), unlimited, pass_until: pass, // 이용권이면 예상질문도 열림
    schools, free_university: schools[0] ?? null, school_limit: admin ? 99 : unlimited ? STUDY_SCHOOLS_PAID : STUDY_SCHOOLS_FREE,
  };
}
/* 이 문제를 풀 수 있나 — 이미 연 문제면 그대로 · 새 기출이면 남은 수 확인 · 예상질문이면 결제 확인 */
export async function studyGate(db: any, userId: string, university: string, question: string, source: string) {
  const quota = await studyQuota(db, userId);
  if (source === "interview") return quota.interview_paid ? { ok: true, quota } : { ok: false, quota, need: "interview_pay" };
  const { data: had } = await db.from("prep_study_uses").select("id").eq("user_id", userId).eq("university", university).eq("question", question).maybeSingle();
  if (had) return { ok: true, quota, isNew: false };
  // 학교 수 — 무료는 처음 푼 학교 1곳만, 결제하면 6곳까지
  const known = quota.schools.some((x: string) => ukey(x) === ukey(university));
  if (!known && quota.schools.length >= quota.school_limit) return { ok: false, quota, need: quota.unlimited ? "school_max" : "school" };
  if (quota.left > 0) return { ok: true, quota, isNew: true };
  return { ok: false, quota, need: "invite" };
}