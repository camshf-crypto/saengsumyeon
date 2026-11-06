// agent/core.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { TOOLS } from "./tools.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const MODEL = "gpt-5-mini"; // 답이 아쉬우면 "gpt-5" (질문 1개당 비용 약 4~5배)
export const KRW = 1400; // 달러 → 원
// 2026-11-01 두 배로 (2주 시험: 다시 오는 학생 · 결제 · 비용을 보고 되돌릴 수 있게 숫자만 바꾼다)
export const FREE_WON = 200; // 무료 처음 맛보기 — 한 번 (평균 질문 약 26개 · 질문 하나 평균 약 7.8원)
export const FREE_DAILY_WON = 120; // 맛보기를 다 쓴 다음부터 매일 새벽 5시(한국)에 다시 채워지는 양 (평균 질문 약 15개)
export const WON_PER_Q = 8; // 화면에 '질문 약 N개 남음'으로 보여 줄 때 쓰는 질문 하나 평균 비용
export const FREE_RESET_HOUR = 5; // 하루가 바뀌는 시각 — 학원 끝나고 밤늦게 공부하는 학생이 자정에 두 번 받지 않게 새벽 5시
export const FREE_FROM = "2026-10-26T15:00:00Z"; // 이때(한국 10/27 0시)부터 쓴 것을 센다 — 그 전에 쓴 건 안 셈
export const FRIEND_WON = 75; // 친구 1명이 내 링크로 가입할 때마다 늘어나는 주간 한도 (2026-10-29 절반 · 150 → 75)
export const FRIEND_MAX = 4; // 친구 보너스는 4명까지
// 2026-11-06 사용자 모으기 — 물꼬 안 유료 기능을 모두 무료로 연다 (무료 사용량은 그대로 · 새벽 5시에 다시 채워짐)
//   그대로 이용권: 생기부 예상질문(대학 6곳) · 다시 유료로 돌리려면 false 로 바꾸고 agent · school_task 배포
export const FREE_OPEN = true;
export const PAID_WON = 3000; // 이용권 주간 한도 (보통 질문 약 100개 — 사실상 무제한, 과다 사용만 막음)
export const MAX_ROUNDS = 6; // 한 질문에 DB 찾기 최대 횟수
export const HISTORY = 20; // 이전 대화 몇 개까지 기억할지 (10번 주고받기) · 최근 4개 밖의 물꼬 답은 앞 900자만 (비용)
export const clean = (v: unknown, n = 600) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* OpenAI 부르기 — 바쁠 때(429) · 서버 오류(5xx)면 1초 · 3초 쉬고 최대 2번 다시 */
export async function openai(payload: unknown) {
  for (let k = 0; ; k++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify(payload),
    });
    if ((res.status === 429 || res.status >= 500) && k < 2) {
      await res.body?.cancel();
      const wait = Number(res.headers.get("retry-after")) * 1000 || (k === 0 ? 1000 : 3000);
      await new Promise((ok) => setTimeout(ok, Math.min(wait, 5000)));
      continue;
    }
    return res;
  }
}

/* AI 사용량 기록 — 관리자 'AI 비용' 칸 */
//   100만 토큰당 달러 [입력, 출력, 캐시된 입력] — 같은 앞부분(물꼬 안내문)이 다시 들어가면 OpenAI가 입력값의 10%만 받는다 (2026-11-06부터 반영)
export const PRICE: Record<string, [number, number, number]> = { "gpt-5-mini": [0.25, 2, 0.025], "gpt-5": [1.25, 10, 0.125] };
// OpenAI 답의 usage 에서 캐시된 입력 토큰 수
export const cachedOf = (u: any) => Number(u?.prompt_tokens_details?.cached_tokens ?? u?.input_tokens_details?.cached_tokens ?? 0);
export async function logUsage(db: any, userId: string, inT: number, outT: number, ok: boolean, service = "agent", cachedT = 0) {
  try {
    const [pi, po, pc] = PRICE[MODEL];
    const cached = Math.min(Math.max(0, cachedT), inT);
    const cost = ((inT - cached) * pi + cached * pc + outT * po) / 1e6; // 실제 OpenAI 청구 금액대로
    await db.from("ai_usage").insert({ service, user_id: userId, model: MODEL, input_tokens: inT, output_tokens: outT, cost_usd: cost, ok });
  } catch (_) { /* 기록 실패는 무시 */ }
}

/* ───────── 대학 이름 맞추기 (한양대 → 한양대학교, 외대 → 한국외국어대학교 …) */
export const ALIAS: Record<string, string> = {
  "서울과기대": "서울과학기술대학교", "과기대": "서울과학기술대학교", "외대": "한국외국어대학교", "한국외대": "한국외국어대학교",
  "시립대": "서울시립대학교", "서울시립대": "서울시립대학교", "카톨릭대": "가톨릭대학교", "가톨릭대": "가톨릭대학교",
  "성대": "성균관대학교", "이대": "이화여자대학교", "숙대": "숙명여자대학교", "인천대": "인천대학교", "고대": "고려대학교", "연대": "연세대학교",
  "서울대": "서울대학교", "경기대": "경기대학교", "건대": "건국대학교", "동대": "동국대학교", "홍대": "홍익대학교", "단대": "단국대학교",
};
export let UNIVS: string[] = [];
export async function univList(db: any) {
  if (UNIVS.length) return UNIVS;
  // 모집요강이 있는 대학 + 입결만 있는 대학 (어디가 입결을 대학별로 계속 넣는다 — 꽃동네대 · 가톨릭관동대 …)
  const [{ data }, { data: res }] = await Promise.all([
    db.from("univ_admission_rules").select("university").limit(5000),
    db.from("univ_result_names").select("university"), // sql/sm_100 — 입결 있는 대학 이름만 (줄이 많아도 1000줄 제한에 안 걸리게)
  ]);
  UNIVS = [...new Set([...(data ?? []), ...(res ?? [])].map((r: any) => r.university))].sort() as string[];
  return UNIVS;
}
export async function matchUniv(db: any, raw: unknown): Promise<string | null> {
  const s = clean(raw, 40).replace(/\s/g, "");
  if (!s) return null;
  const list = await univList(db);
  if (list.includes(s)) return s;
  if (ALIAS[s]) return ALIAS[s];
  const short = (n: string) => n.replace("여자대학교", "여대").replace("대학교", "대");
  return list.find((n) => n === s + "학교" || short(n) === s) ?? list.find((n) => n.includes(s.replace(/대$/, ""))) ?? null;
}

export async function chat(messages: any[], withTools: boolean) {
  const res = await openai({
    model: MODEL,
    max_completion_tokens: 6000,
    reasoning_effort: "low",
    messages,
    ...(withTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
  });
  const body = await res.text();
  if (!res.ok) { console.error("openai", res.status, body.slice(0, 500)); return null; }
  try { return JSON.parse(body); } catch { return null; }
}