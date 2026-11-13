// agent/router.ts — 학생 말이 어디로 가는지 한곳에서 정한다 (DB · AI 없이, 글만 보고)
//   순서: ① 입력 카드를 채운 답 · 카드 버튼 답 · 하던 과제 이어 가기  →  ② 그다음에 말 뜻(탐구 · 수행평가 · 면접 · 공부법)
//   index.ts work() · suhaeng.ts suhaengChat · study.ts quickForm 이 이 결과대로 움직인다
//   배포 전 테스트: agent_chk/route_test.ts (실제 학생 말 → 기대 경로)
import { SH_CONT, SH_DOC, SH_PHOTO, SH_PPT, SH_PREP, SH_START, afterArrow } from "./suhaeng.ts";
import { TP_CARD, TP_FROM_DIAG, TP_INTENT, TP_START } from "./tamgu.ts";
import { STUDY_Q } from "./study.ts";

// '내 입시 플랜 짜기' 입력 카드 (학년: … / 활동: …)
export const PLAN_CARD = (m: string) => /^학년\s*[:：]/m.test(m) && /^활동\s*[:：]/m.test(m);
// 진단 결과 카드 '다른 주제 진단하기' — 카드 아래 칸에 새 주제를 같이 적었으면 그 주제
export const TP_NEW_DIAG = /^(?:이 주제로 뭘 할까|이제 뭘 할까)\?\s*→\s*다른 주제 진단/;
export const newDiagTopic = (m: string) => (m.trim().match(/^(?:이 주제로 뭘 할까|이제 뭘 할까)\?\s*→\s*다른 주제 진단[^:：\n]*[:：]\s*([\s\S]{6,})$/)?.[1] ?? "").trim();
// 안내문 사진을 받는 단계 (여기서는 그 단계가 사진을 받는다)
// '탐구주제 흔한가 진단' 입력 카드 (학과: … 과목: … 탐구주제: …) — 하던 수행평가가 있어도 진단으로 (과목 줄을 수행평가 과목으로 읽지 않게)
export const DIAG_FORM = (m: string) => /^\s*학과\s*[:：]/m.test(m) && /^\s*탐구\s*주제\s*[:：]/m.test(m);
// 입시 로드맵(첫 화면) 과목 칸 버튼 — '(로드맵) 영어 수행평가 하자' · '(로드맵) 영어 탐구 하자' (하던 과제가 있어도 새로 시작)
export const ROAD_START = /^\(로드맵\)\s*(.{1,20}?)\s*(수행평가|탐구)\s*하자$/;
export const roadSubject = (m: string) => { const s = m.trim().match(ROAD_START)?.[1]?.trim() ?? ""; return /^(진로|기타)$/.test(s) ? "" : s; };
const PHOTO_STEP = new Set(["picking", "subject_free", "need_source", "pick_task", "draft"]);

export type TaskCtx = { status?: string | null; hasDraft?: boolean; tpDeclined?: boolean };
export type TaskRoute =
  | "plan_card"      // 플랜 입력 카드 → planFromCard
  | "tp_diag_now"    // '다른 주제 진단하기: <주제>' → 그 주제로 바로 흔한가 진단
  | "tp_new_diag"    // '다른 주제 진단하기' (주제 없음) → 입력 카드
  | "tp_from_diag"   // 진단 결과 → 이 주제로 탐구 설계
  | "sh_start"       // 수행평가 새로 시작 (말 · 팝업 · 안내문 사진)
  | "sh_resume"      // 팝업 '○○ 이어서 하자' — 하던 과제 다시 꺼내기 (못 찾으면 새로 시작)
  | "sh_photo_add"   // 하던 수행평가에 안내문 사진을 늦게 올림 → 그 과제에 붙여 다시 읽기
  | "tp_step"        // 하던 탐구 설계 이어 가기
  | "tp_start"       // 탐구 설계 시작
  | "sh_reopen"      // 'ppt · 한글 파일로' — 최근 완성본 다시 꺼내기
  | "sh_step";       // 하던 수행평가 이어 가기 (카드 답이 아니면 평소 대화로)

// 과제 흐름 (수행평가 · 탐구 설계) — 해당 없으면 null
export function taskRoute(msg: string, c: TaskCtx = {}): TaskRoute | null {
  const m = msg.trim();
  const ans = afterArrow(m);
  const photo = SH_PHOTO.test(m);
  const st = String(c.status ?? "");
  if (PLAN_CARD(m)) return "plan_card";
  if (DIAG_FORM(m) && !photo) return null;
  if (SH_CONT.test(m) && !photo) return "sh_resume";
  const road = m.match(ROAD_START);
  if (road) return road[2] === "탐구" ? "tp_start" : "sh_start";
  if (TP_NEW_DIAG.test(m)) return newDiagTopic(m) ? "tp_diag_now" : "tp_new_diag";
  if (TP_FROM_DIAG.test(m) || /^다음은\?\s*→\s*새 탐구 설계/.test(m)) return "tp_from_diag";
  // 안내문 사진은 늘 수행평가 — 탐구 설계 중이어도 ('과목: 영어'를 탐구 과목으로 읽지 않게)
  if (photo && (!st || st === "done" || st.startsWith("tp_"))) return "sh_start";
  if (photo && !PHOTO_STEP.has(st)) return "sh_photo_add";
  if (st.startsWith("tp_") && !c.tpDeclined) return "tp_step";
  if (!ans && !TP_CARD.test(m) && (TP_START.test(m) || TP_INTENT(m)) && (!st || ["done", "writing", "speech"].includes(st) || st.startsWith("tp_") || TP_INTENT(m)) && !SH_START.test(m) && !SH_PPT.test(m) && !SH_DOC.test(m)) return "tp_start";
  if ((SH_START.test(m) && !SH_PPT.test(m)) || SH_PREP.test(m) || /^다음은\?\s*→\s*새 수행평가/.test(m)) return "sh_start";
  if (!ans && !photo && (SH_PPT.test(m) || SH_DOC.test(m)) && (!st || !c.hasDraft)) return "sh_reopen";
  if (st) return "sh_step";
  return null;
}

export type FormRoute =
  | "plan_form" | "motive_pick" | "study"
  | "form_topic" | "form_motive" | "form_intro" | "form_reading" | "form_tail"
  | "interview_q";   // 생기부 면접 예상질문 — 이용권이 없으면 처음에 안내, 있으면 AI
// AI 없이 바로 적는 칸 · 안내 (quickForm) — 해당 없으면 null (AI가 답한다)
export function formRoute(message: string): FormRoute | null {
  const s = message.trim();
  if (/^(내\s*)?(입시\s*)?플랜\s*(다시\s*)?(짜|만들)/.test(s)) return "plan_form";
  if (/^어떤 지원동기를 진단할까요\?\s*→\s*(.+)$/.test(s)) return "motive_pick";
  if (/\n|[:：]/.test(s)) return null; // 입력 칸을 채워 보낸 글(학과: … )은 AI가 진단한다
  const t = s.replace(/\s+/g, " ");
  if (t.length <= 90 && STUDY_Q.test(t)) return "study";
  if (t.length > 40) return null; // 학생이 내용까지 적었으면 AI가 읽는다
  const check = /흔한가|흔한지|흔해|흔함/.test(t);
  if (check && /자기\s*소개/.test(t)) return "form_intro";
  if (check && /지원\s*동기/.test(t)) return "form_motive";
  if (check && /독서|책/.test(t)) return "form_reading";
  if (check) return "form_topic";
  if (/꼬리\s*질문/.test(t)) return "form_tail";
  if (/예상\s*질문/.test(t)) return "interview_q";
  return null;
}

// 테스트 · 기록용 — 학생 말 하나가 처음 가는 곳
export function route(msg: string, c: TaskCtx = {}) {
  return taskRoute(msg, c) ?? formRoute(msg) ?? "llm";
}

/* ───────── 카드 답 확인 — 보기를 안 고르고 칸에 적은 말이 '답'이 아닐 때 ─────────
 * all     : '세개다 · 다 · 둘 다' (하나를 골라야 하는데)
 * unknown : '몰라 · 모르겠어 · 없어 · 롤모델이 없어'
 * any     : '아무거나 · 상관없어 · 너가 골라'
 * said    : '주제 말했잖아 · 아까 말했는데' (이미 말한 걸 다시 물었다는 불만)
 */
export type NonAnswer = "all" | "unknown" | "any" | "said";
export function nonAnswer(a: string): NonAnswer | null {
  const s = String(a ?? "").trim().replace(/[.!?~,ㅠㅜㅡ;]+/g, "").trim();
  if (!s) return null;
  const n = s.replace(/\s/g, "");
  if (n.length > 20) return null;
  if (/^(세\s*개|셋|두\s*개|둘|네\s*개|전부|모두|다)\s*(다|모두|전부)?\s*(할래|하고\s*싶어|좋아|해\s*줘|섞어\s*줘|합쳐\s*줘|요)?$/.test(s)) return "all";
  if (/^(아무거나|아무\s*거나|상관\s*없|너가|네가|니가|알아서|물꼬가|추천해\s*줘|골라\s*줘)/.test(s)) return "any";
  if (/(말했|했잖|했다고|얘기했|이야기했)/.test(n)) return "said";
  if (/^(몰라|모르|모름|글쎄|잘\s*모르|없어|없음|없는데|딱히|그런\s*거\s*없)/.test(s) || (n.length <= 10 && /(없어|없음|없는데|몰라|모르겠어|모르겠음)$/.test(n))) return "unknown";
  return null;
}
// 바로 앞 물꼬 답의 [[질문: … | 보기 | …]] 카드 — 보기 목록
export function cardOptions(text: string) {
  const all = [...String(text ?? "").matchAll(/\[\[\s*질문\s*[:：]([^\]]*)\]\]/g)];
  const last = all[all.length - 1];
  if (!last) return null;
  const parts = last[1].split("|").map((x) => x.trim()).filter(Boolean);
  return { q: parts.shift() ?? "", options: parts };
}
// 학생이 '실험은 싫다 · 못 한다'고 했는지 (이번 말 + 최근 대화)
export const NO_EXP = /실험\s*(은|는|이|하는\s*건|하기)?\s*(싫|말고|빼|없이|못\s*하|못해|어려워|힘들|안\s*하|안할)/;
export const noExpSaid = (msg: string, history: any[] = []) =>
  NO_EXP.test(msg) || history.slice(-12).some((h: any) => h?.role === "user" && NO_EXP.test(String(h.content ?? "")));