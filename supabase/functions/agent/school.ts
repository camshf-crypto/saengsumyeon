// agent/school.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { chat, clean, json } from "./core.ts";


/* ───────── 학년 — 마이페이지 '내 정보' 학년 → 가입 때 고른 학년 순서 (화면 위 '고2 기준으로 답해요'와 같은 값) */
export async function gradeOf(db: any, userId: string, meta: any = {}) {
  const [{ data: m }, { data: p }] = await Promise.all([
    db.from("sm_my").select("grade").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("grade").eq("id", userId).maybeSingle(),
  ]);
  const raw = String(meta?.grade || m?.grade || p?.grade || ""); // 가입 · '학교 · 학년 바꾸기'에서 학생이 고른 학년이 먼저
  const g = raw.match(/[123]/)?.[0];
  return /N수|재수|졸업/.test(raw) ? "N수" : g ? `고${g}` : "";
}
export const YEAR_OF: Record<string, number> = { 고1: 2029, 고2: 2028, 고3: 2027, N수: 2027 };
/* ───────── 학년 로드맵 (비커스 AI 입시 로드맵 고1~고3 · 달마다 제목 · 할 일 · 바로 하기)
 * 먼저 말 걸기(openingOf) · 내 입시 홈 이번 달 카드(monthPlan) · 물꼬 답(학생 정보)이 같이 쓴다
 * go: 누르면 물꼬에 보내는 말 — 탐구 설계 · 수행평가 · 입시 플랜 · 공부법 · 면접 흐름으로 바로 간다
 */
export type Road = { t: string; d: string; go: string };
export const GO = { plan: "내 입시 플랜 짜 줘", task: "수행평가 하자", topic: "탐구주제 하자", study: "시험 공부법 알려 줘", prep: "수시 면접 준비할래", univ: "내 성적으로 갈 수 있는 대학 알려 줘" };
export const ROADMAP: Record<string, Record<number, Road>> = {
  고1: {
    1: { t: "진로 탐색과 고교생활 준비", d: "관심 분야 진단, 희망 학과 탐색, 고교 교육과정 이해, 3년 로드맵 초안", go: GO.plan },
    2: { t: "고1 첫 학기 준비", d: "학교 교육과정 확인, 주요 과목 학습 계획, 관심 분야 독서와 탐구 아이디어", go: GO.study },
    3: { t: "학교 적응과 활동 계획", d: "수행평가 일정 확인, 동아리 탐색, 관심 과목 고르기, 첫 활동 기록", go: GO.task },
    4: { t: "첫 수행평가와 탐구주제", d: "학교 과제 조건 분석, 탐구 질문 구체화, 자료 조사, 중간고사 일정 반영", go: GO.task },
    5: { t: "관심 분야 구체화", d: "1학기 활동 점검, 진로 관련 독서, 탐구 결과 정리", go: GO.topic },
    6: { t: "1학기 활동 심화", d: "교과별 탐구 연결, 수행평가 피드백 반영, 기말고사 일정 반영", go: GO.study },
    7: { t: "1학기 성장 분석", d: "성적 · 활동 점검, 관심 분야 변화 확인, 여름방학 계획", go: GO.plan },
    8: { t: "방학 심화 탐구", d: "1학기 활동에서 발전시킬 주제 고르기, 독서 · 자료 조사 · 프로젝트", go: GO.topic },
    9: { t: "2학기 활동 설계", d: "새 수행평가 일정 확인, 교과 탐구 연결, 과목 선택 정보 점검", go: GO.task },
    10: { t: "전공 관심 심화", d: "중간고사 일정 반영, 탐구 활동 보완, 진로 관련 문제 해결 경험", go: GO.topic },
    11: { t: "1년 활동 연결", d: "탐구 결과 정리, 관심 학과 다시 보기, 고2 심화 주제 후보 고르기", go: GO.topic },
    12: { t: "고1 연간 분석과 고2 계획", d: "학교 활동 기록 검토, 성장 정리, 고2 과목 · 탐구 로드맵 세우기", go: GO.plan },
  },
  고2: {
    1: { t: "고1 활동 분석과 진로 재설계", d: "고1 교과 · 동아리 · 탐구 활동 분석, 희망 학과 다시 보기, 부족한 경험과 심화 방향 찾기", go: GO.plan },
    2: { t: "전공 역량과 심화 탐구 준비", d: "희망 학과 교육과정 분석, 전공 핵심 개념 탐색, 고2 탐구주제 후보 고르기", go: GO.topic },
    3: { t: "고2 교과 활동 설계", d: "선택 과목과 진로 연결, 수행평가 일정 확인, 고1 활동과 이어지는 탐구 계획", go: GO.task },
    4: { t: "전공 관련 첫 심화 탐구", d: "학교 과제 조건 분석, 심화 탐구 질문 세우기, 중간고사 일정 반영", go: GO.task },
    5: { t: "전공 적합성 탐색과 탐구 실행", d: "전공 관련 사회 · 과학 · 기술 문제 분석, 자료 조사, 탐구 과정 기록", go: GO.topic },
    6: { t: "문제 해결 역량 강화", d: "탐구 자료 분석, 해결 방안 찾기, 수행평가 피드백 반영, 기말고사 일정 반영", go: GO.study },
    7: { t: "고2 1학기 활동 분석", d: "과목별 성취도와 탐구 결과 점검, 고1 활동과의 연결 분석, 여름방학 계획", go: GO.plan },
    8: { t: "전공 심화 프로젝트", d: "전공 관련 독서, 심화 탐구 보고서 쓰기, 결과 발표와 피드백", go: GO.topic },
    9: { t: "2학기 탐구 활동 설계", d: "새 수행평가 분석, 이전 탐구의 후속 질문 세우기, 진로 연계 활동 계획", go: GO.task },
    10: { t: "전공 관련 문제 해결 탐구", d: "전공 관련 실제 사례 분석, 탐구 내용 보완, 중간고사 일정 반영", go: GO.topic },
    11: { t: "전공 탐구 성과 정리", d: "고1 · 고2 활동 연결, 탐구 결과 해석, 발표와 질의응답, 후속 탐구 제안", go: GO.topic },
    12: { t: "고2 학생부 분석과 고3 입시 전략", d: "2년 활동 기록 분석, 희망 대학 · 학과 검토, 고3 보완 활동과 입시 로드맵", go: GO.plan },
  },
  고3: {
    1: { t: "고1 · 고2 학생부 종합 분석", d: "교과 성취도와 활동 기록 분석, 진로 연계성 검토, 학생부 강점과 보완점 찾기", go: GO.plan },
    2: { t: "희망 대학과 입시 전형 탐색", d: "대학별 모집요강 · 전형 평가 요소 확인, 희망 학과 비교, 지원 전략 초안", go: GO.univ },
    3: { t: "고3 마지막 교과 활동 설계", d: "수행평가 일정 확인, 이전 탐구와 이어지는 마지막 활동 설계, 학생부 기록 관리", go: GO.task },
    4: { t: "마지막 탐구주제 구체화", d: "교과 심화 탐구 질문 세우기, 수행평가 조건 분석, 중간고사 일정 반영", go: GO.topic },
    5: { t: "고3 탐구 활동 완성", d: "마지막 탐구 자료 분석, 결과 정리, 이전 활동과 연결, 학업 · 진로 역량 점검", go: GO.topic },
    6: { t: "대학 지원 전략 구체화", d: "모의평가 · 교과 성적 검토, 대학별 전형 분석, 수시 지원 후보 정리", go: GO.univ },
    7: { t: "학생부 마지막 점검", d: "고3 1학기 활동 정리, 학생부 기록 확인, 기말고사 뒤 입시 전략 보완", go: GO.plan },
    8: { t: "수시 지원 전략과 면접 기초", d: "대학별 지원 가능성 검토, 학생부 예상 질문 뽑기, 자기소개 · 지원동기 연습", go: GO.prep },
    9: { t: "수시 원서 접수와 대학별 면접 준비", d: "지원 대학 확정, 대학별 면접 유형 분석, 전공 · 학생부 예상 질문과 답변 만들기", go: GO.prep },
    10: { t: "대학별 실전 면접 훈련", d: "기출문제 분석, 모의 면접, 꼬리질문 훈련, 답변 피드백과 보완", go: GO.prep },
    11: { t: "마지막 면접 시뮬레이션", d: "대학별 실전 면접, 제시문 · 전공 질문 대비, 말하기 · 태도 · 답변 완성도 점검", go: GO.prep },
    12: { t: "입시 결과 확인과 진학 준비", d: "합격 결과 확인, 추가 합격 · 정시 일정 점검, 대학 진학과 앞으로의 공부 계획", go: GO.univ },
  },
};
export const roadOf = (g: string, month: number): Road | null => ROADMAP[g === "N수" ? "고3" : g]?.[month] ?? null;
export function seasonOf(g: string, month: number) {
  const r = roadOf(g, month);
  return r ? `${r.t} — ${r.d}` : "";
}

/* ───────── 우리 학교 평가계획 (sql/sm_105 school_eval_subjects · school_eval_tasks) ─────────
 * 가입 때 고른 학교(user_metadata.school)로 그 학교 · 학년의 과목별 시험 비율과 수행평가(무엇을 · 언제 · 몇 점 · 채점 기준)를 찾는다
 * 학년도는 3월에 바뀐다 (1~2월은 지난 학년도 2학기) · 이번 학기 자료가 없으면 가장 최근 학기 자료를 쓴다
 */
export function termNow() {
  const d = new Date(Date.now() + 9 * 3600000);
  const m = d.getUTCMonth() + 1, y = d.getUTCFullYear();
  return { year: m >= 3 ? y : y - 1, semester: m >= 3 && m <= 8 ? 1 : 2, month: m };
}
export async function schoolMeta(db: any, userId: string, meta: any = null) {
  let m = meta;
  if (!m?.school) {
    const { data } = await db.auth.admin.getUserById(userId).catch(() => ({ data: null }));
    m = data?.user?.user_metadata ?? {};
  }
  return { school: clean(m?.school, 40), region: clean(m?.school_region, 20) };
}
// 학교 이름 맞추기 — 목록에서 고른 이름은 그대로 · 직접 쓴 이름(예: 개포고)은 앞부분이 같은 학교가 하나일 때만
export async function evalSchoolName(db: any, name: string) {
  if (!name) return "";
  const { data: hit } = await db.from("school_eval_subjects").select("school").eq("school", name).limit(1);
  if (hit?.length) return name;
  const short = name.replace(/\s/g, "").replace(/(고등학교|고교|고)$/, "");
  if (short.length < 2) return "";
  const { data } = await db.from("school_eval_subjects").select("school").ilike("school", `${short}고%`).limit(200);
  const names = [...new Set((data ?? []).map((r: any) => r.school))];
  return names.length === 1 ? String(names[0]) : "";
}
export async function evalSubjects(db: any, school: string, gnum: number) {
  let q = db.from("school_eval_subjects")
    .select("id,school,region,year,semester,grade,subject,kind,exam_mid,exam_final,perf_total,essay_total,exam_detail,grading,notes,books,source")
    .eq("school", school).order("year", { ascending: false }).order("semester", { ascending: false }).order("subject").limit(300);
  if (gnum) q = q.eq("grade", gnum);
  const { data } = await q;
  const rows = data ?? [];
  if (!rows.length) return { rows: [], current: false };
  const t = termNow();
  const cur = rows.filter((r: any) => r.year === t.year && r.semester === t.semester);
  const use = cur.length ? cur : rows.filter((r: any) => r.year === rows[0].year && r.semester === rows[0].semester);
  return { rows: use, current: cur.length > 0 };
}
export async function evalTasks(db: any, ids: number[], full = false) {
  if (!ids.length) return [];
  const cols = full ? "id,subject_id,sort,title,unit,standards,methods,period,months,points,rubric,memo" : "id,subject_id,sort,title,methods,period,months,points";
  const { data } = await db.from("school_eval_tasks").select(cols).in("subject_id", ids).order("subject_id").order("sort").limit(600);
  return data ?? [];
}
/* ───────── 학생이 한 것 표시 — 학교 수행평가 목록에서 끝낸 것(done) · 하는 중(doing)
 * 물꼬 수행평가(school_tasks)가 평가계획 과제(eval_task_id)를 골라 시작했으면 그걸로, 아니면 같은 과목 + 제목이 겹치면,
 * 그래도 없으면 같은 과목에 이번 · 다음 달 과제가 하나뿐일 때 그 과제로 본다 (2026-11-06 — 끝낸 걸 또 하라고 하던 문제)
 */
export async function myTasks(db: any, uid: string) {
  const [{ data }, { data: ck }] = await Promise.all([
    db.from("school_tasks").select("id,eval_task_id,subject,title,status,analysis,created_at,updated_at").eq("user_id", uid).order("updated_at", { ascending: false }).limit(60),
    db.from("eval_checks").select("eval_task_id,created_at").eq("user_id", uid).limit(500), // 학생이 직접 '했어요' 체크한 것 (sql/sm_121)
  ]);
  const list = (data ?? []) as any[];
  (list as any).checks = new Map((ck ?? []).map((c: any) => [Number(c.eval_task_id), c.created_at]));
  return list;
}
export function markDone(tasks: any[], mine: any[], mon: number, next: number) {
  const checks: Map<number, string> = (mine as any).checks ?? new Map();
  const suh = mine.filter((x) => x.analysis?.kind !== "topic");
  const same = (t: any, x: any) => nameKey(t.subject) && nameKey(t.subject) === nameKey(x.subject);
  const titleHit = (t: any, x: any) => { const a = nameKey(t.title), b = nameKey(x.title); return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)); };
  const live = tasks.filter((t: any) => (t.months ?? []).some((m: number) => m === mon || m === next));
  for (const t of tasks) {
    if (t.id && checks.has(Number(t.id))) { t.done = true; t.checked = true; t.checked_at = checks.get(Number(t.id)); continue; } // 직접 체크
    const hit = (x: any) =>
      (x.eval_task_id && t.id && Number(x.eval_task_id) === Number(t.id)) ||
      (!x.eval_task_id && same(t, x) && (titleHit(t, x) || live.filter((u: any) => same(u, x)).length === 1 && live.includes(t)));
    const d = suh.find((x) => x.status === "done" && hit(x));
    if (d) { t.done = true; t.done_title = d.title; continue; }
    if (suh.some((x) => x.status !== "done" && hit(x))) t.doing = true;
  }
  return tasks;
}
export const nameKey = (s: unknown) => String(s ?? "").replace(/\s|[·ㆍ]/g, "").replace(/Ⅰ/g, "I").replace(/Ⅱ/g, "II").toLowerCase();

// 대화마다 붙이는 짧은 요약 — 과목별 반영 비율 + 이번 달 · 다음 달 수행평가
export async function schoolContext(db: any, userId: string, meta: any, grade: string) {
  const { school, region } = await schoolMeta(db, userId, meta);
  if (!school) return "[학교 평가계획] 학교 모름 (가입 정보에 학교 없음)";
  const gnum = Number(String(grade).match(/[123]/)?.[0] ?? 0);
  const name = await evalSchoolName(db, school);
  if (!name) return `[학교 평가계획] ${school}${region ? ` (${region})` : ""} · 아직 생수면에 이 학교 평가계획 자료 없음`;
  const { rows, current } = await evalSubjects(db, name, gnum);
  if (!rows.length) return `[학교 평가계획] ${name} · ${gnum ? `${gnum}학년` : "학년 모름"} 자료 없음 (다른 학년 자료만 있음)`;
  const r0 = rows[0];
  const tasks = await evalTasks(db, rows.map((r: any) => r.id));
  const subj = new Map(rows.map((r: any) => [r.id, r.subject]));
  const mon = termNow().month, next = mon === 12 ? 1 : mon + 1;
  const soon = tasks.filter((t: any) => (t.months ?? []).some((x: number) => x === mon || x === next));
  const L = [
    `[학교 평가계획] ${name} ${r0.grade}학년 ${r0.year}학년도 ${r0.semester}학기${current ? "" : " (지금 학기 자료가 아니라 가장 최근 자료)"} · ${rows.length}과목 · 자세히(채점 기준표 · 성취기준)는 school_eval 도구`,
    "과목별 반영(중간/기말/수행 %): " + rows.slice(0, 40).map((r: any) => `${r.subject} ${r.exam_mid ?? 0}/${r.exam_final ?? 0}/${r.perf_total ?? 0}`).join(" · "),
  ];
  if (soon.length) L.push(`이번 달 · 다음 달(${mon}·${next}월) 수행평가: ` + soon.slice(0, 15).map((t: any) => `${subj.get(t.subject_id)} '${clean(t.title, 40)}' ${t.points ?? "?"}점(${clean(t.period, 20) || "시기 미정"})`).join(" · "));
  return L.join("\n").slice(0, 2500);
}

/* ───────── 학교 수행평가를 이번 달 · 다음 달로 나누기 — 먼저 말 걸기(openingOf) · 이번 달 할 일(monthPlan)이 같이 쓴다
 * thisM  : 이번 달에 걸친 것 (이미 지난 주차 빼고 · 이번 달 마감부터 · 주차 순서)
 * nextAll: 다음 달에 걸친 것 전부 (다음 달 마감부터) · nextNew: 그중 다음 달에 새로 시작하는 것
 * always : 4달 넘게 이어지는 상시 과제 (배움일지 · 포트폴리오)
 * mid/fin: 평가계획 notes 에 가장 많이 적힌 중간 · 기말고사 주차 (예: '10월 2주')
 */
/* ───────── 학교 학사일정 (나이스 schoolSchedule · sql/sm_115 school_calendar) — 시험 · 방학 날짜
 * 학교 코드(가입 · 학교 바꾸기에서 고른 school_code)로 받고, 없으면 학교 이름으로 찾는다 · 일주일마다 새로 받음
 * 비밀값 NEIS_KEY 가 있어야 한 번에 다 받는다 (없으면 나이스가 5줄만 준다)
 */
export async function neis(path: string, params: Record<string, string>, size = 1000, page = 1) {
  const url = new URL(`https://open.neis.go.kr/hub/${path}`);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", String(page));
  url.searchParams.set("pSize", String(size));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = Deno.env.get("NEIS_KEY");
  if (key) url.searchParams.set("KEY", key);
  const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
  const j = await r.json().catch(() => null);
  return (j?.[path]?.[1]?.row ?? []) as any[];
}
export type CalEvent = { ymd: string; name: string; g: number[] };
export async function schoolCalendar(db: any, meta: any): Promise<CalEvent[] | null> {
  const name = clean(meta?.school, 40), code0 = clean(meta?.school_code, 20);
  if (!name && !code0) return null;
  const key = code0 || name;
  const year = termNow().year;
  const { data: c } = await db.from("school_calendar").select("events,fetched_at,year").eq("key", key).maybeSingle();
  if (c && c.year === year && Date.now() - new Date(c.fetched_at).getTime() < 7 * 86400000) return c.events as CalEvent[];
  try {
    const info = await neis("schoolInfo", code0 ? { SD_SCHUL_CODE: code0 } : { SCHUL_NM: name.replace(/등학교$/, ""), SCHUL_KND_SC_NM: "고등학교" }, 20);
    const row = info.find((x: any) => x.SD_SCHUL_CODE === code0) ?? info.find((x: any) => x.SCHUL_NM === name) ?? info[0];
    if (!row) return c?.events ?? null;
    const q = { ATPT_OFCDC_SC_CODE: row.ATPT_OFCDC_SC_CODE, SD_SCHUL_CODE: row.SD_SCHUL_CODE, AA_FROM_YMD: `${year}0301`, AA_TO_YMD: `${year + 1}0228` };
    const rows: any[] = [];
    for (let pg = 1; pg <= 3; pg++) { const r = await neis("schoolSchedule", q, 1000, pg); rows.push(...r); if (r.length < 1000) break; }
    const events: CalEvent[] = rows
      .filter((x: any) => x.EVENT_NM && !/토요휴업일/.test(x.EVENT_NM))
      .map((x: any) => ({ ymd: String(x.AA_YMD), name: clean(x.EVENT_NM, 40), g: [x.ONE_GRADE_EVENT_YN, x.TW_GRADE_EVENT_YN, x.THREE_GRADE_EVENT_YN].map((v, i) => (v === "Y" ? i + 1 : 0)).filter(Boolean) }))
      .sort((a, b) => a.ymd.localeCompare(b.ymd));
    await db.from("school_calendar").upsert({ key, school: row.SCHUL_NM, atpt: row.ATPT_OFCDC_SC_CODE, code: row.SD_SCHUL_CODE, year, events, fetched_at: new Date().toISOString() }, { onConflict: "key" });
    return events;
  } catch (e) {
    console.error("neis", e);
    return c?.events ?? null;
  }
}
// 이번 학기 시험 · 방학 — 학년에 해당하는 날짜만, 붙어 있는 날은 한 덩어리로 (12월 15일~18일)
export function termDates(cal: CalEvent[] | null, gnum: number) {
  if (!cal?.length) return null;
  const t = termNow();
  const inTerm = (ymd: string) => { const m = Number(ymd.slice(4, 6)); return t.semester === 1 ? m >= 3 && m <= 8 : m >= 8 || m <= 2; };
  const mine = cal.filter((e) => inTerm(e.ymd) && (!e.g.length || !gnum || e.g.includes(gnum)));
  const span = (re: RegExp) => {
    const ds = [...new Set(mine.filter((e) => re.test(e.name)).map((e) => e.ymd))].sort();
    if (!ds.length) return null;
    // 첫 덩어리만 (날짜 간격 7일 안)
    const toD = (y: string) => new Date(`${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}T00:00:00+09:00`);
    let end = ds[0];
    for (const d of ds.slice(1)) { if ((toD(d).getTime() - toD(end).getTime()) / 86400000 <= 7) end = d; else break; }
    return { from: ds[0], to: end, start: toD(ds[0]), end: toD(end) };
  };
  return {
    mid: span(/중간고사|1차\s*지필|1회고사|1차고사/),
    fin: span(/기말고사|2차\s*지필|2회고사|2차고사/),
    vac: span(/방학식|여름방학|겨울방학|학년말\s*방학|종업식/),
  };
}
export const ymdText = (a: { from: string; to: string }) => {
  const f = `${Number(a.from.slice(4, 6))}월 ${Number(a.from.slice(6, 8))}일`;
  if (a.to === a.from) return f;
  return a.to.slice(4, 6) === a.from.slice(4, 6) ? `${f}~${Number(a.to.slice(6, 8))}일` : `${f}~${Number(a.to.slice(4, 6))}월 ${Number(a.to.slice(6, 8))}일`;
};
export const dday = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86400000);
// 이번 달 학교 일정 — 학년에 해당하는 행사를 날짜순으로, 이어진 같은 행사는 한 줄로 (11월 3일~5일 2학기 중간고사)
export function monthEvents(cal: CalEvent[] | null, gnum: number, year: number, month: number) {
  if (!cal?.length) return [];
  const ym = `${year}${String(month).padStart(2, "0")}`;
  const mine = cal.filter((e) => e.ymd.startsWith(ym) && (!e.g.length || !gnum || e.g.includes(gnum)));
  const toD = (y: string) => new Date(`${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}T00:00:00+09:00`);
  const out: { from: string; to: string; name: string }[] = [];
  for (const e of mine) {
    const last = out.find((x) => x.name === e.name && (toD(e.ymd).getTime() - toD(x.to).getTime()) / 86400000 <= 3);
    if (last) { if (e.ymd > last.to) last.to = e.ymd; } else out.push({ from: e.ymd, to: e.ymd, name: e.name });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from)).map((x) => {
    const d = dday(toD(x.from)), end = dday(toD(x.to));
    return { date: ymdText(x), name: x.name, when: end < 0 ? "지남" : d <= 0 ? "오늘" : `D-${d}`, past: end < 0 };
  });
}

export async function schoolMonths(db: any, school: string, grade: string, meta: any = null, mine: any[] = []) {
  const name = await evalSchoolName(db, school).catch(() => "");
  if (!name) return null;
  const gnum = Number(String(grade).match(/[123]/)?.[0] ?? 0);
  const { rows } = await evalSubjects(db, name, gnum);
  if (!rows.length) return null;
  const raw = await evalTasks(db, rows.map((r: any) => r.id));
  const subj = new Map(rows.map((r: any) => [r.id, r.subject]));
  const kst = new Date(Date.now() + 9 * 3600000);
  const mon = kst.getUTCMonth() + 1, day = kst.getUTCDate(), curW = Math.ceil(day / 7);
  const next = mon === 12 ? 1 : mon + 1;
  const weekOf = (t: any) => { const m = String(t.period ?? "").match(/(\d{1,2})\s*월\s*(\d)\s*주/); return m ? { mon: Number(m[1]), w: Number(m[2]) } : null; };
  const tasks = raw.map((t: any) => {
    const ms = (t.months ?? []) as number[];
    return { id: t.id, subject: String(subj.get(t.subject_id) ?? ""), title: t.title, points: t.points, period: t.period, methods: t.methods, months: ms, last: ms.length ? ms[ms.length - 1] : 0, week: weekOf(t) };
  });
  markDone(tasks, mine, mon, next); // 학생이 끝낸 것 · 하는 중인 것 표시
  const has = (t: any, m: number) => t.months.includes(m);
  const order = (t: any) => t.week?.w ?? 9;
  const byDue = (m: number) => (a: any, b: any) => (Number(a.last !== m) - Number(b.last !== m)) || order(a) - order(b);
  const long = (t: any) => t.months.length >= 4;
  const passed = (t: any) => t.week?.mon === mon && t.week.w < curW;
  const active = tasks.filter((t: any) => !long(t) && (has(t, mon) || has(t, next)));
  const thisM = active.filter((t: any) => has(t, mon) && !passed(t)).sort(byDue(mon));
  const nextAll = active.filter((t: any) => has(t, next)).sort(byDue(next));
  const nextNew = nextAll.filter((t: any) => !has(t, mon));
  const always = tasks.filter((t: any) => long(t) && (has(t, mon) || has(t, next)));
  const examOf = (kind: string) => {
    const cnt = new Map<string, number>();
    for (const r of rows) { const m = String(r.notes ?? "").match(new RegExp(`${kind}[^\\d]{0,6}(\\d{1,2}월\\s*\\d\\s*주)`)); if (m) cnt.set(m[1], (cnt.get(m[1]) ?? 0) + 1); }
    return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };
  // 학사일정(나이스)이 있으면 — 시험은 실제 날짜로, 기말고사가 시작되면 이번 학기 수행평가는 끝난 것으로 본다
  const cal = meta ? termDates(await schoolCalendar(db, { ...meta, school: meta.school || school }).catch(() => null), gnum) : null;
  let mid = examOf("중간고사"), fin = examOf("기말고사"), from = "평가계획";
  let termOver = false, vacation = "";
  if (cal && (cal.mid || cal.fin)) {
    from = "학사일정";
    if (cal.mid) mid = `${ymdText(cal.mid)}${dday(cal.mid.end) >= 0 ? ` (D-${Math.max(0, dday(cal.mid.start))})` : ""}`;
    if (cal.fin) fin = `${ymdText(cal.fin)}${dday(cal.fin.end) >= 0 ? ` (D-${Math.max(0, dday(cal.fin.start))})` : ""}`;
    if (cal.mid && dday(cal.mid.end) < 0) mid = ""; // 이미 끝난 시험은 빼기
    if (cal.fin && dday(cal.fin.end) < 0) fin = "";
    if (cal.fin && dday(cal.fin.start) <= 0) termOver = true;
    if (cal.vac) vacation = ymdText(cal.vac);
  }
  const done = (list: any[]) => (termOver ? [] : list);
  return { name, g: rows[0].grade, year: rows[0].year, semester: rows[0].semester, mon, next, day, lateMonth: day >= 25, thisM: done(thisM), nextAll: done(nextAll), nextNew: done(nextNew), always: done(always), mid, fin, from, termOver, vacation, subjects: rows.length };
}

/* ───────── 전국 입시 일정 (2026~2027 · 학평은 교육청 · 수능 · 대입은 교육부 · 대교협 발표 기준) — 새 학년도 일정이 나오면 여기에 더한다 */
export const NATIONAL: { d: string; to?: string; t: string; g: string[] }[] = [
  { d: "2026-03-24", t: "전국연합학력평가", g: ["고1", "고2", "고3"] },
  { d: "2026-05-07", t: "전국연합학력평가", g: ["고3"] },
  { d: "2026-06-04", t: "전국연합학력평가 (고3은 수능 모의평가)", g: ["고1", "고2", "고3"] },
  { d: "2026-07-08", t: "전국연합학력평가", g: ["고3"] },
  { d: "2026-08-20", to: "2026-09-03", t: "수능 응시원서 접수", g: ["고3"] },
  { d: "2026-09-02", t: "전국연합학력평가 (고3은 수능 모의평가)", g: ["고1", "고2", "고3"] },
  { d: "2026-09-07", to: "2026-09-11", t: "수시 원서 접수 (6장)", g: ["고3"] },
  { d: "2026-10-20", t: "전국연합학력평가", g: ["고1", "고2", "고3"] },
  { d: "2026-11-19", t: "2027학년도 수능", g: ["고3"] },
  { d: "2026-12-11", t: "수능 성적 통지", g: ["고3"] },
  { d: "2026-12-18", t: "수시 합격자 발표 마감", g: ["고3"] },
  { d: "2026-12-21", to: "2026-12-23", t: "수시 합격자 등록", g: ["고3"] },
  { d: "2027-01-04", to: "2027-01-07", t: "정시 원서 접수", g: ["고3"] },
  { d: "2027-02-05", t: "정시 합격자 발표 마감", g: ["고3"] },
];
export function nationalIn(year: number, month: number, grade: string) {
  const g = grade === "N수" ? "고3" : grade;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const md = (x: string) => `${Number(x.slice(5, 7))}월 ${Number(x.slice(8, 10))}일`;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  return NATIONAL.filter((x) => (x.d.startsWith(ym) || x.to?.startsWith(ym)) && (!g || x.g.includes(g)) && (x.to ?? x.d) >= today) // 이미 지난 일정은 빼기
    .map((x) => ({ date: x.to ? `${md(x.d)} ~ ${md(x.to)}` : md(x.d), title: x.t }));
}

/* ───────── 이번 달 할 일 + 다음 달 미리 보기 — 내 입시 홈 맨 위 카드 (AI 안 부름 · 사용량 안 씀)
 * 달마다: 학년 로드맵(ROADMAP) · 전국 입시 일정 · 학교 시험 주차 · 학교 수행평가 (이번 달 마감부터)
 */
export async function monthPlan(db: any, user: any) {
  const meta = user.user_metadata ?? {};
  const [grade, sch] = await Promise.all([gradeOf(db, user.id, meta).catch(() => ""), schoolMeta(db, user.id, meta)]);
  const mine = await myTasks(db, user.id).catch(() => []);
  const sm = sch.school ? await schoolMonths(db, sch.school, grade, meta, mine).catch(() => null) : null;
  const kst = new Date(Date.now() + 9 * 3600000);
  const y = kst.getUTCFullYear(), mon = kst.getUTCMonth() + 1, next = mon === 12 ? 1 : mon + 1, ny = mon === 12 ? y + 1 : y;
  const calRaw = sch.school ? await schoolCalendar(db, { ...meta, school: sch.school }).catch(() => null) : null;
  const gn = Number(String(grade).match(/[123]/)?.[0] ?? 0);
  const exams = (m: number) => [sm?.mid && Number(sm.mid.match(/\d+/)?.[0]) === m ? `중간고사 ${sm.mid}` : "", sm?.fin && Number(sm.fin.match(/\d+/)?.[0]) === m ? `기말고사 ${sm.fin}` : ""].filter(Boolean);
  const pickT = (t: any, m: number) => ({ id: t.id, subject: t.subject, title: t.title, points: t.points, period: t.period, due: t.last === m, done: Boolean(t.done), doing: Boolean(t.doing), checked: Boolean(t.checked) });
  return {
    grade, school: sch.school || null, school_name: sm?.name ?? null, has_data: Boolean(sm), term: sm ? `${sm.year}학년도 ${sm.semester}학기` : null,
    exam_from: sm?.from ?? null, term_over: Boolean(sm?.termOver), vacation: sm?.vacation || null,
    months: [
      { month: mon, label: "이번 달", todo: grade ? seasonOf(grade, mon) : "", road: grade ? roadOf(grade, mon) : null, events: monthEvents(calRaw, gn, y, mon), national: nationalIn(y, mon, grade), exams: exams(mon), tasks: (sm?.thisM ?? []).map((t: any) => pickT(t, mon)) },
      { month: next, label: "다음 달 미리 보기", todo: grade ? seasonOf(grade, next) : "", road: grade ? roadOf(grade, next) : null, events: monthEvents(calRaw, gn, ny, next), national: nationalIn(ny, next, grade), exams: exams(next), tasks: (sm?.nextNew ?? []).map((t: any) => pickT(t, next)) },
    ],
    always: (sm?.always ?? []).map((t: any) => ({ subject: t.subject, title: t.title, points: t.points, period: t.period })),
  };
}

/* ───────── 물꼬가 먼저 말 걸기 — 물꼬 화면에 들어올 때마다 (AI 안 부름 · 사용량 안 씀)
 * 지난번에 한 것 → 이어서 할 순서 → 우리 학교 곧 있을 수행평가 → 이번 달 할 일 · 버튼(선택지) 3개까지
 * 학생이 버튼을 누르거나 답하면 이 말이 대화 첫머리로 같이 저장된다 (body.opening)
 */
export async function openingOf(db: any, user: any) {
  const uid = user.id, meta = user.user_metadata ?? {};
  const ago = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  const when = (d: string) => { const n = ago(d); return n <= 0 ? "오늘" : n === 1 ? "어제" : n < 7 ? `${n}일 전` : n < 30 ? `${Math.floor(n / 7)}주 전` : "지난달"; };
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [chat, topic, inq, acts, plan, grade, sch] = await Promise.all([
    db.from("agent_chats").select("id,title,updated_at").eq("user_id", uid).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("topic_queries").select("topic,department,subject,created_at").eq("user_id", uid).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("inquiries").select("id,topic,created_at").eq("user_id", uid).gte("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("agent_actions").select("title,created_at").eq("user_id", uid).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("study_plans").select("id").eq("user_id", uid).limit(1).maybeSingle(),
    gradeOf(db, uid, meta).catch(() => ""),
    schoolMeta(db, uid, meta),
  ]);
  const mine = await myTasks(db, uid).catch(() => [] as any[]);
  // 부르는 이름 — 세 글자면 성 빼고 (김민준 → 민준아 · 김지수 → 지수야)
  const full = clean(meta.name || meta.full_name, 10).replace(/\s/g, "");
  const first = /^[가-힣]{3}$/.test(full) ? full.slice(1) : /^[가-힣]{2}$/.test(full) ? full : "";
  const call = first ? first + ((first.charCodeAt(first.length - 1) - 0xac00) % 28 ? "아" : "야") : "";
  const hi = call ? `${call}, 다시 왔네!` : "다시 왔네!";
  const L: string[] = [];
  const steps: string[] = [];
  const opts: string[] = [];

  // 0) 이번 달 우리 학교 일정 (나이스 학사일정) — 달이 바뀌고 처음 들어오면 맨 먼저, 아니면 다가오는 것만
  const c = chat.data;
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const curY = kstNow.getUTCFullYear(), curM = kstNow.getUTCMonth() + 1;
  const gnum0 = Number(String(grade).match(/[123]/)?.[0] ?? 0);
  const newMonth = !c || new Date(new Date(c.updated_at).getTime() + 9 * 3600000).getUTCMonth() + 1 !== curM;
  const calLines: string[] = [];
  if (sch.school) {
    const evs = monthEvents(await schoolCalendar(db, { ...meta, school: sch.school }).catch(() => null), gnum0, curY, curM);
    const show = newMonth ? evs : evs.filter((e) => !e.past);
    if (show.length) {
      calLines.push(newMonth
        ? `${call ? `${call}, ` : ""}**${curM}월**이 시작됐어! 너 **${sch.school}${gnum0 ? ` ${gnum0}학년` : ""}**이지? 이번 달 학교 일정이야.`
        : `**${sch.school}** ${curM}월 남은 일정이야.`);
      calLines.push(...show.slice(0, 10).map((e) => `- ${e.date} · ${e.name}${e.past ? "" : ` (${e.when})`}`));
      if (show.length > 10) calLines.push(`그 밖에 ${show.length - 10}개 더`);
      calLines.push("(나이스 학사일정 기준 · 바뀔 수 있으니 학교 공지도 같이 봐)");
    }
  }

  // 1) 지난번에 한 것
  if (c) L.push(`${hi} ${when(c.updated_at)}엔 **'${clean(c.title, 30)}'** 이야기를 했지.`);
  else L.push(`${call ? `${call}, ` : ""}반가워! 나는 물꼬야. 입시 · 생기부 · 수행평가 · 공부법 뭐든 같이 챙겨 줄게.`);

  // 2) 이어서 할 순서 — 하다 만 것부터
  if (acts.data) { steps.push(`'${clean(acts.data.title, 30)}' 마무리하기`); opts.push(`'${clean(acts.data.title, 24)}' 이어서 하기`); }
  if (inq.data) { steps.push(`탐구 보고서 **'${clean(inq.data.topic, 30)}'** 어디까지 했는지 보고 다음 단계 하기`); opts.push("탐구 보고서 이어서 하기"); }
  else if (topic.data && !mine.some((x: any) => x.analysis?.kind === "topic" && (clean(x.analysis?.origin?.topic, 120) === clean(topic.data.topic, 120) || new Date(x.created_at) > new Date(topic.data.created_at)))) {
    steps.push(`**'${clean(topic.data.topic, 30)}'** 주제로 탐구 보고서까지 완성하기 (주제 → 탐구 방법 → 결과 → 보고서)`);
    opts.push("그 탐구주제로 보고서 쓰기");
  }
  if (plan.data) steps.push("입시 플랜 이번 주 미션 체크하기");

  // 3) 학교 수행평가 — 월별로, 지금 타이밍에 맞는 것부터 (schoolMonths)
  //    월말(25일~)이면 다음 달 것부터 · 시험 주차도 같이
  const schoolLines: string[] = [];
  const schoolOpts: string[] = [];
  let smAll: any = null;
  if (sch.school) {
    const sm = await schoolMonths(db, sch.school, grade, meta, mine).catch(() => null);
    smAll = sm;
    if (!sm?.name) schoolLines.push(`**${sch.school}** 평가계획은 지금 준비하고 있어. 들어오면 그 학교 수행평가 일정에 맞춰서 먼저 알려 줄게.`);
    else {
      const { name, g, mon, next, lateMonth, thisM, nextAll, nextNew, always, mid, fin } = sm;
      const line = (t: any, m: number) => `- ${t.subject} **'${clean(t.title, 34)}'** ${t.points ?? "?"}점 · ${clean(t.period, 16) || "시기 미정"}${t.last === m ? " · 마감" : ""}`;
      // 끝낸 것은 목록에서 빼고 '끝냄 N개'로만 · 하는 중인 것은 맨 앞에 '하는 중'
      const block = (label: string, all: any[], m: number, brief = false) => {
        const left = all.filter((t: any) => !t.done).sort((a: any, b: any) => Number(Boolean(b.doing)) - Number(Boolean(a.doing)));
        const fin = all.length - left.length;
        if (!all.length) return [];
        if (!left.length) return ["", `**${label}** ${all.length}개 — **전부 끝냈어!**`];
        // 이번 달 것은 팝업 아래 체크 목록(화면 TaskChecklist)으로 보여 주니 여기선 한 줄만
        if (brief) return ["", `**${label}** ${fin ? `${all.length}개 중 ${fin}개 끝냄 · 남은 ${left.length}개` : `${left.length}개`} — 체크 목록에 있어${left.some((t: any) => t.doing) ? ` (하는 중: ${left.filter((t: any) => t.doing).map((t: any) => `${t.subject} '${clean(t.title, 20)}'`).slice(0, 2).join(" · ")})` : ""}`];
        return ["", `**${label}** ${fin ? `${all.length}개 중 ${fin}개 끝냄 · 남은 ${left.length}개` : `${left.length}개`}`,
          ...left.slice(0, 5).map((t: any) => line(t, m) + (t.doing ? " · **하는 중**" : "")), ...(left.length > 5 ? [`그 밖에 ${left.length - 5}개 더`] : [])];
      };
      const first = lateMonth
        ? block(`${next}월에 할 수행평가`, nextAll, next)
        : [...block(`${mon}월 수행평가`, thisM, mon, true), ...block(`${next}월에 새로 시작하는 수행평가`, nextNew, next)];
      if (always.length) first.push("", `상시 수행평가 ${always.length}개: ${always.slice(0, 3).map((t: any) => `${t.subject} '${clean(t.title, 16)}'`).join(" · ")} (꾸준히 쌓기)`);
      if (first.some((x) => x.startsWith("- ") || /전부 끝냈어|체크 목록에 있어/.test(x))) {
        schoolLines.push(`그래서 **${name} ${g}학년** 일정에 맞춰 보면:`, ...first);
        const undone = (xs: any[]) => xs.filter((t: any) => !t.done);
        const top = (lateMonth ? undone(nextAll)[0] ?? undone(thisM)[0] : undone(thisM)[0] ?? undone(nextNew)[0]) as any;
        if (top) schoolOpts.push(`${top.subject} '${clean(top.title, 18)}' ${top.doing ? "이어서 하기" : "준비하기"}`);
        schoolOpts.push(`${lateMonth || !thisM.length ? next : mon}월 수행평가 채점 기준 전부 보기`);
      } else if (!sm.termOver) schoolLines.push(`**${name} ${g}학년**은 ${mon}·${next}월에 잡힌 수행평가가 없어. 지금은 시험 준비에 집중해도 돼.`);
      if (sm.termOver) schoolLines.push("", `기말고사가 시작돼서 이번 학기 수행평가는 끝났어.${sm.vacation ? ` 방학은 ${sm.vacation}부터야.` : ""} 지금은 기말 공부와 방학 계획에 집중하자.`);
      else if (mid || fin) schoolLines.push("", `시험은 ${[mid && `중간고사 ${mid}`, fin && `기말고사 ${fin}`].filter(Boolean).join(" · ")}${sm.from === "학사일정" ? "이야 (학교 학사일정 기준)." : "쯤이야 (학교 평가계획 기준)."}`);
    }
  }

  // 3-1) 이번 달에 끝낸 것 — 했으면 했다고 먼저 말해 준다 (수행평가 · 탐구 · 같은 달 한국 시간)
  const kst0 = new Date(Date.now() + 9 * 3600000);
  const thisMonth = (d: string) => { const k = new Date(new Date(d).getTime() + 9 * 3600000); return k.getUTCFullYear() === kst0.getUTCFullYear() && k.getUTCMonth() === kst0.getUTCMonth(); };
  const doneNow = mine.filter((x: any) => x.status === "done" && thisMonth(x.updated_at));
  // 입시 홈에서 '했어요' 체크한 학교 과제 (이번 달에 체크한 것)
  const checkedNow = smAll?.name ? [...smAll.thisM, ...smAll.nextAll, ...smAll.always].filter((t: any, i: number, a: any[]) => t.checked && thisMonth(t.checked_at) && a.indexOf(t) === i) : [];
  const doneAll = [
    ...doneNow.map((x: any) => `- 완료 · ${x.analysis?.kind === "topic" ? "탐구" : `${clean(x.subject, 16) || "수행평가"}`} **'${clean(x.title, 34)}'**`),
    ...checkedNow.map((t: any) => `- 완료 · ${clean(t.subject, 16)} **'${clean(t.title, 34)}'** (내가 체크)`),
  ];
  const doneLines = doneAll.length
    ? ["", `**${kst0.getUTCMonth() + 1}월에 끝낸 것 ${doneAll.length}개** 잘했어!`, ...doneAll.slice(0, 5), ...(doneAll.length > 5 ? [`그 밖에 ${doneAll.length - 5}개 더`] : []),
       ...(doneNow.length ? ["", "물꼬에서 끝낸 건 내 입시 홈 · 내 생기부에도 들어가 있어."] : [])]
    : [];

  // 3-2) 전국 입시 일정 — 이번 달 · 다음 달 (학평 · 수능 · 원서 접수)
  const natLines: string[] = [];
  {
    const kst = new Date(Date.now() + 9 * 3600000);
    const y = kst.getUTCFullYear(), m1 = kst.getUTCMonth() + 1, m2 = m1 === 12 ? 1 : m1 + 1;
    const nat = [...nationalIn(y, m1, grade), ...nationalIn(m1 === 12 ? y + 1 : y, m2, grade)];
    if (nat.length) natLines.push("", `${nat.slice(0, 3).map((x) => `${x.date} **${x.title}**`).join(" · ")}`);
  }

  // 4) 이번 달 로드맵 — 학년 · 달마다 지금 할 일 (학교 일정 앞에 둬서 '로드맵상 지금 이거 → 너희 학교는 이렇게'로 읽히게)
  const mon = termNow().month;
  const road = grade ? roadOf(grade, mon) : null;
  // 이번 달 로드맵을 이미 채웠는지 — 탐구 달은 탐구, 수행평가 달은 수행평가를 이번 달에 하나라도 끝냈으면
  const roadDone = road && ((road.go === GO.topic && doneNow.some((x: any) => x.analysis?.kind === "topic")) || (road.go === GO.task && (doneNow.some((x: any) => x.analysis?.kind !== "topic") || checkedNow.length > 0)));
  const roadLines = road ? [`**${grade} ${mon}월 로드맵 · ${road.t}**${roadDone ? " — **완료**" : ""}`, roadDone ? `이번 달 핵심은 채웠어. 남은 건 아래 학교 일정에 맞춰 하나씩 하면 돼.` : `이번 달에 할 것: ${road.d}`] : [];
  // 로드맵과 학교 수행평가 잇기 — 이번 달 할 일을 학교 과제 하나로 같이 채울 수 있으면 그걸 짚어 준다
  let linkOpt = "";
  if (road && smAll?.name) {
    const pool = ((smAll.lateMonth ? smAll.nextAll : [...smAll.thisM, ...smAll.nextNew]) as any[]).filter((t: any) => !t.done); // 끝낸 과제는 다시 권하지 않는다
    // 탐구 달: 제목에 탐구 · 보고서가 있는 과제 → 프로젝트 · 연구 → 발표 순 (방법 칸만 맞는 건 마지막) · 수행평가 달: 이번 달 마감 첫 과제
    const score = (x: any) => {
      const tt = String(x.title ?? ""), mm = String(x.methods ?? "");
      if (/탐구|보고서|소논문/.test(tt)) return 4;
      if (/연구|프로젝트/.test(tt)) return 3;
      if (/탐구|보고서/.test(mm)) return 2;
      if (/발표/.test(tt)) return 1;
      return 0;
    };
    const hit = road.go === GO.topic ? [...pool].sort((a, b) => score(b) - score(a)).find((x) => score(x) > 0) : road.go === GO.task ? pool[0] : null;
    if (hit && !roadDone) {
      roadLines.push(`${smAll.name}에선 **${hit.subject} '${clean(hit.title, 30)}'**(${hit.points ?? "?"}점 · ${clean(hit.period, 12) || "시기 미정"})로 하면 로드맵이랑 수행평가를 한 번에 채울 수 있어.`);
      linkOpt = `${hit.subject} '${clean(hit.title, 18)}' 준비하기`;
    } else if (road.go === GO.study && (smAll.mid || smAll.fin)) {
      roadLines.push(`${smAll.name} 시험은 ${[smAll.mid && `중간고사 ${smAll.mid}`, smAll.fin && `기말고사 ${smAll.fin}`].filter(Boolean).join(" · ")}쯤이야. 지금부터 과목별 공부 순서를 잡아 두자.`);
    }
  }
  if (c && !opts.length) opts.push("지난 대화 이어서 하기");

  // 이번 달 학교 일정 — 새 달 첫 방문이면 맨 위(인사 대신), 아니면 지난번 이야기 다음
  if (calLines.length) {
    if (newMonth) L.splice(0, L.length, ...calLines, "", ...L.slice(c ? 0 : 1)); // 처음 온 학생은 '반가워' 인사를 일정 뒤로 빼지 않고 생략
    else L.push("", ...calLines);
  }
  // 순서: (학교 일정) → 지난번 → 이번 달 로드맵 → 우리 학교 수행평가 · 시험 → 이어서 할 순서 (번호 목록은 맨 끝 — 화면에서 목록 뒤 문단이 목록에 붙지 않게)
  if (doneLines.length) L.push(...doneLines);
  if (roadLines.length) L.push("", ...roadLines);
  if (schoolLines.length) L.push("", ...schoolLines);
  else if (!sch.school) L.push("", "학교를 알려 주면 그 학교 수행평가 일정 · 채점 기준에 맞춰서 챙겨 줄 수 있어.");
  if (natLines.length) L.push(...natLines);
  if (steps.length) L.push("", steps.length > 1 ? "이어서 할 순서야:" : "다음으로 할 건:", ...steps.slice(0, 3).map((s, i) => `${i + 1}. ${s}`));
  // 버튼: 로드맵과 이어진 학교 과제 → 이번 달 로드맵 바로 하기 → 하다 만 것 → 학교 수행평가
  const uniq = [...new Set([linkOpt, roadDone ? "" : road?.go ?? "", ...opts, ...schoolOpts].filter(Boolean))].slice(0, 3);
  return { text: L.join("\n") + (uniq.length ? `\n\n[[선택지: ${uniq.join(" | ")}]]` : ""), last_chat: c?.id ?? null };
}