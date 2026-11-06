// agent/study.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { passOrAdmin } from "./tools.ts";
import { formRoute } from "./router.ts";
import { FREE_OPEN, clean, matchUniv } from "./core.ts";
import { deptOf, motiveForm, planAsk, planCard, safe } from "./plan.ts";
import { suhaengChat } from "./suhaeng.ts";
import { findStudyTips } from "./tools.ts";


export async function quickForm(db: any, userId: string, meta: any, message: string) {
  // 어떤 칸을 띄울지는 router.ts formRoute 가 정한다 (여기서는 그 칸을 만든다)
  const r = formRoute(message);
  if (!r) return null;
  // "내 입시 플랜 짜 줘" · "플랜 다시 짜 줘" — 묻지 않고 바로 적는 칸 (플랜 화면 버튼도 이 말로 온다)
  if (r === "plan_form") {
    return `목표 대학 · 학과를 알려 주면, 그 목표에 맞춰 들을 과목 · 과목별 공부법 · 활동 · 이번 주 미션까지 짜 드릴게요.\n${await planCard(db, userId, meta)}`;
  }
  // 지난 지원동기 / 새로 작성 카드에서 고른 답 → 바로 적는 칸 (지난 것을 고르면 그 내용을 채워 둔다)
  if (r === "motive_pick") {
    const choice = (message.trim().match(/^어떤 지원동기를 진단할까요\?\s*→\s*(.+)$/)?.[1] ?? "").trim();
    const dept = await deptOf(db, userId, meta);
    if (/새로/.test(choice)) return `대학·학과·지원동기를 적고 보내면 바로 진단해요.\n${motiveForm("", dept, "")}`;
    const { data: prev } = await db.from("motive_queries").select("university,department,motive").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
    const hit = (prev ?? []).find((r: any) => `${r.university || "대학 미정"} ${r.department}`.trim() === choice);
    if (hit) return `지난번 지원동기를 채워 뒀어요. 고칠 곳이 있으면 고친 뒤 보내 주세요.\n${motiveForm(safe(hit.university, 30), safe(hit.department, 30), safe(hit.motive, 700))}`;
    // 카드 아래 칸에 직접 적은 글이면 지원동기 칸에 넣어 둔다
    return `대학·학과·지원동기를 적고 보내면 바로 진단해요.\n${motiveForm("", dept, choice.length >= 30 ? safe(choice, 700) : "")}`;
  }
  // 공부법 질문 — 바로 답하지 않고 과목 · 성적 · 많이 틀리는 단원 · 틀리는 이유부터 받는다 (그래야 맞춤으로 고른다)
  if (r === "study") return studyCard(message.replace(/\s+/g, " ").trim());
  // 면접 예상질문 · 꼬리질문은 이용권 전용 — 대학 · 활동을 다 적게 한 뒤에 막지 말고 처음에 알려 준다 (10/26~ 대화 분석: 입력 후 결제 안내 → 이탈)
  // 꼬리질문은 무료로 열었다 (FREE_OPEN) — 생기부 예상질문(대학 6곳)만 이용권 그대로
  if (r === "interview_q" || (r === "form_tail" && !FREE_OPEN)) {
    if (!(await passOrAdmin(db, userId))) {
      const wantsQ = r === "interview_q";
      const what = wantsQ ? "생기부 면접 예상질문" : "면접 꼬리질문 연습";
    return `${what}은 이용권으로 열려요 (한 달 10,900원부터).\n이용권이면 ${wantsQ ? "대학 · 학과만 적으면 내 생기부 노트 활동에서 나올 질문을 뽑고, 바로 꼬리질문 연습까지 이어서 해요" : "면접 질문과 내 답을 적을 때마다 그 대학 면접관처럼 꼬리질문을 계속 받아요"}.\n\n${FREE_OPEN ? "면접 꼬리질문 연습 · 지원동기 · 자기소개 흔한가 진단은 무료예요. 면접에서 제일 먼저 듣는 이야기부터 해 봐요.\n[[질문: 무엇부터 할까요? | 면접 꼬리질문 연습 | 지원동기 흔한가 진단 | 자기소개 흔한가 진단]]" : "무료로는 지금 지원동기 · 자기소개가 흔한지 진단해 볼 수 있어요. 면접에서 제일 먼저 듣는 이야기예요.\n[[질문: 무엇부터 할까요? | 지원동기 흔한가 진단 | 자기소개 흔한가 진단]]"}\n[[이용권]]`;
    }
    if (r === "interview_q") return null; // 이용권이면 AI가 생기부로 뽑는다
  }
  const dept = await deptOf(db, userId, meta);
  const d = dept ? `학과=${dept}` : "학과";
  if (r === "form_topic") return `학과·과목·탐구주제를 적고 보내면 바로 진단해요.\n[[입력: 탐구주제 흔한가 진단 | ${d} | 과목 | 탐구주제]]`;
  // 지원동기도 탐구주제처럼 — 묻지 않고 바로 대학·학과·지원동기 적는 칸 (학과는 프로필에서 채운다)
  if (r === "form_motive") return `대학·학과·지원동기를 적고 보내면 바로 진단해요.\n${motiveForm("", dept, "")}`;
  // 자기소개 — 지원동기 진단과 같은 방식(면접관이 매년 듣는 흔한 표현인지)으로 본다
  if (r === "form_intro") return `면접 자기소개를 적어 보내면, 면접관이 많이 듣는 흔한 표현인지 지원동기 진단과 같은 기준으로 봐 드려요.\n[[입력: 자기소개 흔한가 진단 | 대학 (선택) | ${d} | 자기소개]]`;
  if (r === "form_reading") return `책과 학과·과목을 적고 보내면 바로 진단해요.\n[[입력: 독서 흔한가 진단 | 책 제목 | 저자 (선택) | ${d} | 과목]]`;
  return `면접 질문과 내 답변을 적고 보내면 그 대학 면접관처럼 꼬리질문을 드려요.\n[[입력: 면접 꼬리질문 연습 | 대학 | ${d} | 면접 질문 | 내 답변]]`;
}


/* 공부법 진단 카드 — 질문에서 과목 · 성적을 찾으면 미리 채운다 */
export const SUBJECTS = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사", "전과목"];
export const ROUTINE_Q = /루틴|하루\s*(공부|계획|일과)|이번\s*주|일주일|요일별|매일\s*(뭐|어떻게)|(주간|하루)\s*(플랜|계획)|플랜.{0,10}(해\s*보|어떻게)/;
export const STUDY_Q = /공부\s*법|학습\s*법|공부\s*방법|공부(를|는)?\s*어떻게|어떻게\s*공부|성적이?\s*(안|잘\s*안)\s*(올|오르|나와)|점수가?\s*안\s*(올|오르|나와)|등급\s*(올리|올릴|안\s*올)|오답\s*노트|공부\s*(잘\s*)?하고\s*있는/;
export const SUBJ: [RegExp, string][] = [[/수학|미적|확통|확률과\s*통계|기하|대수/, "수학"], [/국어|문학|비문학|독서|화작|언매|문법/, "국어"], [/영어|영단어|독해/, "영어"], [/과탐|물리|화학|생명|생과|지구/, "과학탐구"], [/사탐|사회|윤리|생윤|사문|한지|세지|경제|정법/, "사회탐구"], [/한국사/, "한국사"]];
export function studyCard(t: string) {
  const sub = SUBJ.find(([re]) => re.test(t))?.[1] ?? "";
  const g = t.match(/[1-9]\s*등급|\d{2,3}\s*점/)?.[0]?.replace(/\s/g, "") ?? "";
  return `공부법은 사람마다 맞는 게 달라요. 지금 상황을 알려 주면 **어디서 막히는지 먼저 짚고**, 선배들이 효과 본 방법 중에 딱 맞는 걸 골라 드릴게요.
[[입력: 내 공부 진단 — 이것만 알려 주세요 | ${sub ? `과목=${sub}` : "과목"} | ${g ? `성적=${g}` : "성적"} | 많이 틀리는 단원 | 틀리는 이유 | 지금 공부 방법 (선택)]]`;
}

/* ───────── 공부법 효과 시험 (sql/sm_94 study_tests) ─────────
 * 시작 시험(A) → 공부법대로 일주일 → 비슷한 문제로 다시 시험(B) → 두 점수를 비교해 다음 주를 정한다
 *   A · B 는 처음에 같은 '유형 10개 설계도'로 한 번에 만든다 (같은 유형 · 같은 난이도 · 다른 문제) → 점수 비교가 공정하다
 *   수학 · 과학탐구는 한 번 더 풀어 검산하고, 정답이 안 맞는 문항은 A · B 둘 다에서 뺀다
 *   정답 · 해설은 서버에만 — 학생 화면에는 빼고 보낸다 (그 시험을 낸 뒤에만 A 해설을 보여 준다)
 *   AI 비용은 물꼬 주간 사용량에 들어간다
 */
export const TEST_SUBJECTS = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사"];
export const TEST_DAYS = 7;
export const pubQ = (set: any[]) => (set ?? []).map((q: any) => ({ no: q.no, type: q.type, q: q.q, choices: q.choices }));
export const pickOf = (ans: unknown[], i: number) => (ans?.[i] === null || ans?.[i] === undefined || !Number.isInteger(Number(ans[i])) ? null : Number(ans[i]));
export const scoreOf = (set: any[], ans: unknown[]) => (set ?? []).reduce((n: number, q: any, i: number) => n + (pickOf(ans, i) === q.answer ? 1 : 0), 0);
export const reviewOf = (set: any[], ans: unknown[]) => (set ?? []).map((q: any, i: number) => ({
  no: q.no, type: q.type, q: q.q, choices: q.choices, answer: q.answer, picked: pickOf(ans, i),
  correct: pickOf(ans, i) === q.answer, why: q.why,
}));
export function cleanSet(arr: unknown) {
  return (Array.isArray(arr) ? arr : []).map((q: any) => ({
    no: Number(q?.no) || 0, type: clean(q?.type, 30), q: String(q?.q ?? "").replace(/\r/g, "").trim().slice(0, 900),
    choices: (Array.isArray(q?.choices) ? q.choices : []).map((c: unknown) => clean(c, 160)).filter(Boolean).slice(0, 4),
    answer: Number(q?.answer), why: clean(q?.why, 300),
  })).filter((q) => q.no && q.q && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3);
}
export async function testTips(db: any, subject: string, unit: string, grade: string, exclude: string[] = []) {
  const tips = await findStudyTips(db, { subject, keyword: unit.split(/\s+/)[0] ?? "", grade, exclude }, 2).catch(() => []);
  return tips.length ? tips : await findStudyTips(db, { subject, grade, exclude }, 2).catch(() => []);
}
export async function tipsByIds(db: any, ids: unknown) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!list.length) return [];
  const { data } = await db.from("study_tips").select("id,title,subject,area,summary,steps").in("id", list);
  return data ?? [];
}
export function testView(row: any, withQuestions = true) {
  const ready = row.status === "studying" && row.post_open_at && Date.now() >= new Date(row.post_open_at).getTime();
  return {
    id: row.id, subject: row.subject, unit: row.unit, grade: row.grade, round: row.round, status: row.status,
    total: (row.set_a ?? []).length, pre_score: row.pre_score, post_score: row.post_score,
    pre_at: row.pre_at, post_open_at: row.post_open_at, post_ready: Boolean(ready), result: row.result,
    questions: !withQuestions ? [] : row.status === "pre" ? pubQ(row.set_a) : ready ? pubQ(row.set_b) : [],
  };
}

/* 시험지 만들기 — 설계도 + A · B 세트 (수학 · 과학탐구는 검산) */
export async function makeTest(db: any, userId: string, subject: string, unit: string, grade: string) {
  const sys = `너는 한국 고등학교 ${subject} 선생님이다. '${unit}' 단원 확인 시험을 만든다 (학생: ${grade || "고등학생"}). JSON만 출력.
- blueprint: 이 단원에서 꼭 확인할 문제 유형 10개 {no(1~10), type(유형 이름 20자 안), level(기본|중간|응용)} — 기본 4 · 중간 4 · 응용 2.
- set_a 와 set_b: 같은 blueprint 로 각각 10문제. 같은 no 끼리 유형 · 난이도는 같고, 숫자 · 소재 · 보기는 완전히 다르게 (A를 외워서 B를 풀 수 없게).
- 문제 하나: {no, type, q(문제 글), choices(보기 4개), answer(정답 보기 번호 0~3), why(해설 1~2문장)}
- 객관식 4지선다만. 정답은 딱 하나. 정답 위치(0~3)를 골고루 섞는다.
- 고등학교 교육과정 범위만. 교과서 · 수능 · 모의고사의 지문이나 문제를 그대로 옮기지 않는다. 국어 · 영어 지문이 필요하면 3~5문장으로 새로 쓴다.
- 수식은 글자로 쓴다 (x^2, √2, π, 1/2 처럼). 그림이 있어야 풀리는 문제는 내지 않는다.
{"blueprint":[{"no":1,"type":"","level":""}],"set_a":[{"no":1,"type":"","q":"","choices":["","","",""],"answer":0,"why":""}],"set_b":[{"no":1,"type":"","q":"","choices":["","","",""],"answer":0,"why":""}]}`;
  const out = await planAsk(db, userId, sys, `과목: ${subject}\n단원: ${unit}\n학년: ${grade || "모름"}`, 16000);
  if (!out) return { error: "문제를 만들지 못했어요. 잠시 후 다시 해 주세요" };
  let a = cleanSet(out.set_a), b = cleanSet(out.set_b);
  const bp = (Array.isArray(out.blueprint) ? out.blueprint : []).map((x: any) => ({ no: Number(x?.no) || 0, type: clean(x?.type, 30), level: clean(x?.level, 4) }));
  // 같은 번호가 A · B 둘 다 있는 문항만
  let nos = a.map((q) => q.no).filter((n) => b.some((q) => q.no === n));
  // 수학 · 과학탐구 — 한 번 더 풀어서 정답이 안 맞는 번호는 뺀다
  if (["수학", "과학탐구"].includes(subject) && nos.length) {
    const only = (set: any[]) => set.filter((q) => nos.includes(q.no)).map((q) => ({ no: q.no, q: q.q, choices: q.choices }));
    const chk = await planAsk(db, userId,
      `아래 객관식 문제를 하나씩 직접 풀어 정답 보기 번호(0~3)를 낸다. 계산을 끝까지 확인한다. 보기 중 정답이 없거나 둘 이상이면 -1. JSON만: {"a":[{"no":1,"answer":0}],"b":[{"no":1,"answer":0}]}`,
      JSON.stringify({ a: only(a), b: only(b) }), 12000);
    if (chk) {
      const ok = (set: any[], key: string) => (no: number) => {
        const mine = (Array.isArray(chk[key]) ? chk[key] : []).find((x: any) => Number(x?.no) === no);
        return mine && Number(mine.answer) === set.find((q) => q.no === no)?.answer;
      };
      const okA = ok(a, "a"), okB = ok(b, "b");
      nos = nos.filter((n) => okA(n) && okB(n));
    }
  }
  if (nos.length < 6) return { error: "문제를 제대로 만들지 못했어요. 다시 한 번 눌러 주세요" };
  // 남은 문항을 1번부터 다시 번호 매긴다
  const renum = (set: any[]) => nos.map((n, i) => ({ ...set.find((q) => q.no === n), no: i + 1 }));
  a = renum(a); b = renum(b);
  const blueprint = nos.map((n, i) => ({ ...(bp.find((x: any) => x.no === n) ?? { type: a[i].type, level: "" }), no: i + 1 }));
  return { blueprint, set_a: a, set_b: b };
}

/* 루틴을 얼마나 지켰나 — 시작 시험 날부터 7일 동안, 그 과목 루틴 체크 비율 (루틴이 없으면 null) */
export async function adherence(db: any, userId: string, subject: string, fromIso: string) {
  const { data: rs } = await db.from("plan_routines").select("id,days,created_at,active").eq("user_id", userId).eq("subject", subject);
  if (!rs?.length) return null;
  const day0 = new Date(new Date(fromIso).getTime() + 9 * 3600000);
  const days: string[] = [];
  for (let k = 0; k < TEST_DAYS; k++) days.push(new Date(day0.getTime() + k * 86400000).toISOString().slice(0, 10));
  let planned = 0;
  for (const d of days) {
    const wd = ((new Date(`${d}T12:00:00+09:00`).getUTCDay() + 6) % 7) + 1;
    for (const r of rs) if ((r.days ?? []).includes(wd) && String(r.created_at).slice(0, 10) <= d) planned++;
  }
  if (!planned) return null;
  const { count } = await db.from("plan_logs").select("routine_id", { count: "exact", head: true })
    .eq("user_id", userId).eq("done", true).in("routine_id", rs.map((r: any) => r.id)).gte("day", days[0]).lte("day", days[days.length - 1]);
  return Math.min(1, (count ?? 0) / planned);
}

/* 두 점수로 다음 주 정하기 */
export function judge(pre: number, post: number, total: number, round: number, kept: number | null) {
  const diff = post - pre;
  if (kept !== null && kept < 0.5) return { result: "한주더", message: `이번 주 루틴을 ${Math.round(kept * 100)}%만 지켰어요. 방법을 바꾸기 전에 양을 줄여서 한 주 더 해 봐요. (예: 50분 → 30분)` };
  if (post >= Math.ceil(total * 0.8) && diff >= 0) return { result: "늘리기", message: `${total}문제 중 ${post}개를 맞혔어요. 이 단원은 거의 잡혔어요. 같은 방법을 다음 단원에 써 보거나 양을 조금 늘려요.` };
  if (diff >= 2) return { result: "유지", message: `지난번보다 ${diff}개 더 맞혔어요. 지금 공부법이 맞아요. 같은 방법으로 이어 가요.` };
  if (round >= 2) return { result: "교체", message: `2주 동안 해 봤는데 점수가 크게 오르지 않았어요. 이 공부법은 잘 안 맞는 것 같아요. 다른 공부법으로 바꿔 볼게요.` };
  return { result: "한주더", message: `아직 차이가 크지 않아요(${diff >= 0 ? "+" : ""}${diff}개). 공부법이 몸에 붙는 데 2주쯤 걸려요. 같은 방법으로 한 주 더 해요.` };
}

/* ───────── 해 줄까요? (sql/sm_96 agent_actions) ─────────
 * 물꼬가 제안 → 카드 [[할일:번호]] → 학생이 [네]를 누르면 action: "agent_action" 으로 실행
 */
export async function proposeAction(db: any, userId: string, a: any) {
  const kind = String(a?.kind ?? "");
  let title = "", payload: any = {};
  if (kind === "prep_school") {
    const raw = clean(a?.university, 40);
    if (raw.length < 2) return { error: "대학 이름이 필요해요" };
    const university = (await matchUniv(db, raw).catch(() => null)) ?? raw;
    const department = clean(a?.department, 40);
    const { data: has } = await db.from("prep_targets").select("id").eq("user_id", userId).eq("university", university).eq("department", department).maybeSingle();
    if (has) return { already: true, note: `${university} ${department} 는 이미 수시 면접 준비에 들어가 있어요 (/prep)` };
    title = `수시 면접 준비에 ${university}${department ? ` ${department}` : ""} 넣기`;
    payload = { university, department };
  } else if (kind === "study_test") {
    const subject = TEST_SUBJECTS.includes(a?.subject) ? a.subject : "";
    const unit = clean(a?.unit, 40);
    if (!subject || unit.length < 2) return { error: "과목과 단원이 필요해요" };
    const { data: open } = await db.from("study_tests").select("id,unit,status").eq("user_id", userId).eq("subject", subject).neq("status", "done").maybeSingle();
    if (open) return { already: true, note: `${subject} 효과 시험이 이미 진행 중이에요 (${open.unit} · /plan 학습 플랜 ${subject} 탭)` };
    title = `${subject} '${unit}' 공부법 효과 시험 만들기 (지금 10문제 → 일주일 뒤 다시)`;
    payload = { subject, unit };
  } else return { error: "모르는 일이에요" };
  // 같은 제안이 아직 대기 중이면 그걸 다시 쓴다
  const { data: same } = await db.from("agent_actions").select("id").eq("user_id", userId).eq("kind", kind).eq("status", "pending").eq("title", title).maybeSingle();
  const row = same ?? (await db.from("agent_actions").insert({ user_id: userId, kind, title, payload }).select("id").single()).data;
  if (!row?.id) return { error: "제안을 저장하지 못했어요" };
  return { proposed: true, id: row.id, title, card: `[[할일:${row.id}]]` };
}

/* 공부법 효과 시험 만들기 — test_make · 해 줄까요? 둘 다 쓴다 */
export async function createTest(db: any, user: any, subject: string, unit: string, round = 1) {
  const [{ data: my }, { data: prof }] = await Promise.all([
    db.from("sm_my").select("grade").eq("user_id", user.id).maybeSingle(),
    db.from("profiles").select("grade").eq("id", user.id).maybeSingle(),
  ]);
  const grade = String(my?.grade || user.user_metadata?.grade || prof?.grade || "").match(/고\s*[123]/)?.[0]?.replace(/\s/g, "") ?? "";
  const t: any = await makeTest(db, user.id, subject, unit, grade);
  if (t.error) return { error: t.error };
  const { data: row, error } = await db.from("study_tests").insert({ user_id: user.id, subject, unit, grade, round, blueprint: t.blueprint, set_a: t.set_a, set_b: t.set_b }).select("*").single();
  if (error) { console.error("test save", error); return { error: "시험지를 저장하지 못했어요. 잠시 후 다시 해 주세요" }; }
  return { row };
}

/* ───────── 선배 사례 (sql/sm_97 senior_cases · 테스트) ─────────
 * '선배 생기부 보기'에 올린 PDF(정제본)에서 글을 뽑아 두고, 물꼬가 답할 때 근거로 쓴다
 * 학생에게는 공개(live)된 생기부 · 판에서 뽑은 것만 보여 준다
 */
export const TRACK_LABEL: Record<string, string> = { hss: "인문·사회", nat: "자연", eng: "공학", med: "의약·보건" };
export const AREA_LABEL: Record<string, string> = { cc: "창체", sp: "세특", hb: "행특", gr: "성적" };
export async function liveBoards(db: any) {
  const { data: recs } = await db.from("sb_records").select("id").eq("status", "live");
  const ids = (recs ?? []).map((r: any) => r.id);
  if (!ids.length) return new Set<number>();
  const { data: bs } = await db.from("sb_boards").select("id").in("record_id", ids).eq("status", "live");
  return new Set<number>((bs ?? []).map((b: any) => Number(b.id)));
}