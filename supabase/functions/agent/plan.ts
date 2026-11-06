// agent/plan.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { studentContext } from "./context.ts";
import { ALIAS, FREE_OPEN, MODEL, cachedOf, clean, logUsage, matchUniv, openai } from "./core.ts";
import { findStudyTips, runTool } from "./tools.ts";



/* ───────── 내 입시 플랜 (/plan · sql/sm_88) — 학년별 계획 + 이번 주 할 일 ───────── */
// 그 주 월요일 (한국 시간) YYYY-MM-DD
export function weekStartKST(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600000);
  const day = (k.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}
export const PLAN_LINKS = ["topic", "motive", "reading", "prep", "interview", "note", "tail", ""];
export const PLAN_GUIDE = `[학년별로 꼭 챙길 것 — 학생 학년에 맞는 것만 쓴다]
- 고1: 진로 탐색(관심 학과 2~3개 좁히기), 고교학점제 과목 선택 준비(2학년 선택과목을 희망 학과와 맞추기), 기초 탐구 1개를 세특으로 남기기, 독서 습관(한 달 1권), 내신 기초(시험 4주 전부터 계획).
- 고2: 희망 학과와 이어지는 심화 탐구를 교과 세특으로 남기기, 동아리·진로 활동에서 학과 연결, 전공 관련 독서 3~4권, 내신 관리, 겨울방학에 고3 1학기 탐구 미리 정하기.
- 고3: 1학기 세특 마무리 탐구, 생기부 마감 전 활동 정리, 모의고사로 수능 최저 관리, 9월 수시 원서 6곳 고르기, 10~11월 면접 준비(예상질문 · 기출 · 꼬리질문), 수능 이후 면접·논술.
[한국 고등학교 일정] 1학기 3~7월(중간 4월 말 · 기말 6월 말~7월 초), 여름방학 7월 말~8월, 2학기 9~12월(중간 10월 · 기말 12월), 겨울방학 1~2월.`;
export const PLAN_LINK_RULE = `link 는 그 할 일을 생수면에서 바로 할 수 있으면 넣는다: topic(탐구주제 찾기·흔한가) · motive(지원동기 흔한가) · reading(책 고르기·독서 흔한가) · prep(대학 면접 기출 연습) · interview(내 생기부 예상질문) · tail(면접 꼬리질문) · note(생기부 노트에 활동 적기) · ""(생수면 밖에서 하는 일: 시험공부·모의고사 등).`;

export async function planAsk(db: any, userId: string, sys: string, prompt: string, maxTokens = 6000) {
  const res = await openai({ model: MODEL, max_completion_tokens: maxTokens, reasoning_effort: "low", response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] });
  const raw = await res.text();
  let out: any = null, inT = 0, outT = 0, cT = 0;
  try {
    const j = JSON.parse(raw);
    inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0); cT = cachedOf(j.usage);
    out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
  } catch { console.error("plan", res.status, raw.slice(0, 400)); }
  await logUsage(db, userId, inT, outT, Boolean(out), "agent", cT); // 물꼬 사용량에 들어간다 (캐시된 입력은 싸게)
  return out;
}
export const planWeek = (arr: unknown) => (Array.isArray(arr) ? arr : []).map((t: any) => ({
  title: clean(t?.title, 60), detail: clean(t?.detail, 200), link: PLAN_LINKS.includes(t?.link) ? t.link : "",
})).filter((t) => t.title).slice(0, 5);
export async function saveWeek(db: any, userId: string, planId: number, week: any[]) {
  const ws = weekStartKST();
  await db.from("plan_tasks").delete().eq("user_id", userId).eq("week_start", ws).eq("done", false);
  if (week.length) await db.from("plan_tasks").insert(week.map((t, i) => ({ plan_id: planId, user_id: userId, week_start: ws, sort: i, ...t })));
  const { data } = await db.from("plan_tasks").select("id,title,detail,link,done,sort,week_start").eq("user_id", userId).eq("week_start", ws).order("sort");
  return data ?? [];
}

/* 플랜에 넣을 목표 자료 — 대학 권장과목 · 전형 · 면접 스타일 + 공부법 카드 + 학과 추천 도서 (있는 것만) */
export const SCI = /공|컴퓨|소프트|전자|전기|기계|화학|화공|물리|생명|생물|의|약|간호|수학|통계|건축|토목|환경|에너지|반도체|신소재|식품|농|수의|보건|치|한의|데이터|AI|인공지능|천문|지구|해양|항공|자동차|로봇/;
export async function planTarget(db: any, userId: string, univRaw: string, dept: string, grade: string) {
  const T: any = { university: univRaw, department: dept };
  const safeRun = async (name: string, args: any) => { try { return await runTool(db, userId, name, args); } catch (e) { console.error("planTarget", name, e); return null; } };
  const full = univRaw ? (await matchUniv(db, univRaw)) : null;
  if (full) T.university = full;
  const sci = SCI.test(dept);
  const exam = grade === "고3" ? "" : "내신";
  const [reco, units, rules, style, books, ...tips] = await Promise.all([
    safeRun("get_recommended_subjects", { university: T.university, department: dept }),
    full ? safeRun("search_units", { university: full, department: dept }) : null,
    full ? safeRun("get_rules", { university: full }) : null,
    univRaw ? safeRun("get_interview_style", { university: T.university }) : null,
    dept ? safeRun("get_book_recs", { department: dept, grade }) : null,
    ...["국어", "수학", "영어", sci ? "과학탐구" : "사회탐구", "전과목"].map((sub) => findStudyTips(db, { subject: sub, grade, exam }, 2).catch(() => [])),
  ]);
  T.has_univ_data = Boolean(full);
  const j = (x: unknown, n: number) => { const t = JSON.stringify(x ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
  const parts = [];
  parts.push(`[목표] ${T.university} ${dept}${full ? "" : " (생수면에 이 대학 입시 자료가 아직 없음 — 대학 이름만 참고, 전형 규칙을 지어내지 말 것)"}`);
  if ((reco as any)?.rows?.length) parts.push(`[권장과목 자료 — 여기 있는 과목 이름만 쓴다]\n${j((reco as any).rows.slice(0, 8), 2500)}`);
  else parts.push("[권장과목 자료] 이 학과 자료 없음 — 일반적인 계열 과목으로 쓰되 kind 는 '일반'");
  if ((units as any)?.rows?.length || (units as any)?.units?.length) parts.push(`[이 학과 모집 단위 · 전형]\n${j((units as any).rows ?? (units as any).units, 2500)}`);
  if ((rules as any)?.rules?.length) parts.push(`[전형 규칙]\n${j((rules as any).rules.slice(0, 6), 3000)}`);
  if (style && !(style as any).error) parts.push(`[면접 스타일]\n${j(style, 1200)}`);
  const tipList = (tips as any[]).flat().filter(Boolean);
  if (tipList.length) parts.push(`[공부법 카드 — study 칸은 여기서만 고른다]\n${j(tipList.map((t: any) => ({ subject: t.subject, title: t.title, steps: t.steps, seniors: t.seniors })), 3500)}`);
  if ((books as any)?.books?.length) parts.push(`[학과 추천 도서 — 책은 여기서만]\n${j((books as any).books.slice(0, 5).map((b: any) => ({ title: b.title, author: b.author, level: b.level })), 800)}`);
  return { T, text: parts.join("\n\n") };
}

/* 플랜 만들기 — 플랜 화면(plan_make)과 채팅(입력 카드 '내 입시 플랜 짜기')이 같이 쓴다 */
export async function makePlan(db: any, userId: string, meta: any, input: any) {
  const grade = ["고1", "고2", "고3"].includes(input.grade) ? input.grade : "";
  const department = clean(input.department, 40), did = String(input.did ?? "").trim().slice(0, 1500);
  const university = clean(input.university ?? input.goal, 40);
  if (!grade) return { error: "학년을 골라 주세요" };
  const [student, target] = await Promise.all([studentContext(db, userId, meta), planTarget(db, userId, university, department, grade)]);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const sys = `너는 생수면의 '물꼬 입시 AI'다. 학생의 목표 대학 · 학과에 맞춘 입시 플랜을 짠다. JSON만 출력.
오늘은 ${today} (한국 시간)이다. 오늘부터 앞으로를 계획한다 (지난 달은 쓰지 않는다).
${PLAN_GUIDE}
규칙:
- 모든 칸이 목표 대학 · 학과로 이어져야 한다. "왜 이걸 하는지"가 목표와 연결되게.
- [목표 자료]에 있는 것만 사실로 쓴다. 전형 이름 · 반영 교과 · 수능 최저 · 권장과목 · 책 제목을 지어내지 않는다. 자료가 없으면 일반적인 말로 쓰고 숫자를 만들지 않는다.
- 학생이 적은 '지금까지 한 것'과 [학생 정보]의 생기부 노트를 보고, 이미 한 것은 이어서 키우고 빈 곳을 채운다. 하지 않은 활동을 했다고 쓰지 않는다.
- 말투는 학생에게 직접 말하듯 짧고 구체적으로 ("~하기", "~정하기"). 막연한 말("열심히 하기") 금지.
- summary: 지금 상황과 목표까지 방향 2문장.
- target_note: 이 대학 · 학과가 학생을 뽑을 때 보는 것 2문장 (전형 · 면접 자료 기준, 없으면 학과 특성으로).
- admission: 이 목표에서 챙길 전형 포인트 2~3개 {label(예: 학생부종합 ○○전형 · 수능 최저), point(학생이 지금 할 일 한 문장)}. 자료 없으면 빈 배열.
- subjects: 들어 두면 좋은 선택과목 3~6개 {name, kind(핵심|권장|일반), why(이 학과와 이어지는 이유 한 줄)}. 고3이면 이미 듣는 과목에서 세특 챙길 과목 위주.
- study: 과목별 공부법 3~4개 {subject, tip(공부법 카드 제목 그대로), how(카드 steps 를 이 학생에 맞게 2~3줄)}. [공부법 카드]에 있는 것만.
- activities: 목표 학과로 이어지는 탐구 · 독서 · 활동 방향 3개 (책은 [학과 추천 도서]의 제목만).
- semester: 이번 학기(또는 방학)에 이룰 목표 3개.
- months: 이번 달부터 4달. 각 달 label("11월") · focus(그 달 핵심 한 줄) · todo 3개.
- week: 이번 주에 할 일 3~5개. 하루 30분~1시간이면 되는 크기로. 공부 1~2개 + 생기부 · 진로 1~2개를 섞는다. 각 title(20자 안팎) · detail(어떻게 하는지 한 문장) · link.
- ${PLAN_LINK_RULE}
{"summary":"","target_note":"","admission":[{"label":"","point":""}],"subjects":[{"name":"","kind":"","why":""}],"study":[{"subject":"","tip":"","how":["",""]}],"activities":["","",""],"semester":["","",""],"months":[{"label":"","focus":"","todo":["","",""]}],"week":[{"title":"","detail":"","link":""}]}`;
  const prompt = `[학년] ${grade}\n[목표 대학] ${target.T.university || "아직 모름"}\n[목표 학과] ${department || "아직 모름"}\n[지금까지 한 것] ${did || "(안 적음)"}\n[고민] ${clean(input.concern, 300) || "(안 적음)"}\n\n[목표 자료]\n${target.text}\n\n[학생 정보]\n${student}`;
  const out = await planAsk(db, userId, sys, prompt);
  if (!out) return { error: "플랜을 만들지 못했어요. 잠시 후 다시 해 주세요" };
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const plan = {
    target: { university: target.T.university, department, has_data: target.T.has_univ_data, note: clean(out.target_note, 300) },
    summary: clean(out.summary, 400),
    admission: arr(out.admission).map((a: any) => ({ label: clean(a?.label, 60), point: clean(a?.point, 160) })).filter((a: any) => a.label).slice(0, 3),
    subjects: arr(out.subjects).map((a: any) => ({ name: clean(a?.name, 30), kind: clean(a?.kind, 4), why: clean(a?.why, 120) })).filter((a: any) => a.name).slice(0, 6),
    study: arr(out.study).map((a: any) => ({ subject: clean(a?.subject, 10), tip: clean(a?.tip, 40), how: arr(a?.how).map((x: unknown) => clean(x, 120)).filter(Boolean).slice(0, 3) })).filter((a: any) => a.subject).slice(0, 4),
    activities: arr(out.activities).map((x: unknown) => clean(x, 160)).filter(Boolean).slice(0, 3),
    semester: arr(out.semester).map((x: unknown) => clean(x, 120)).filter(Boolean).slice(0, 3),
    months: arr(out.months).slice(0, 4).map((m: any) => ({ label: clean(m?.label, 10), focus: clean(m?.focus, 120), todo: arr(m?.todo).map((x: unknown) => clean(x, 100)).filter(Boolean).slice(0, 4) })).filter((m: any) => m.label),
  };
  const { data: row, error } = await db.from("study_plans").insert({ user_id: userId, grade, department, did, goal: university, concern: clean(input.concern, 300), plan }).select("*").single();
  if (error) { console.error("plan save", error); return { error: "플랜을 저장하지 못했어요. 잠시 후 다시 해 주세요" }; }
  const tasks = await saveWeek(db, userId, row.id, planWeek(out.week));
  return { row, tasks };
}

/* 채팅 입력 카드로 플랜 만들기 — "학년: 고2\n학과: 간호학과\n활동: …\n대학: …" 이면 바로 만들고 정해진 모양으로 답한다 */
export async function planFromCard(db: any, user: any, message: string, usage: any, paid: any) {
  const get = (k: string) => { const m = message.match(new RegExp(`^${k}\\s*[:：]\\s*(.*)$`, "m")); const v = (m?.[1] ?? "").trim(); return /^없음$/.test(v) ? "" : v; };
  if (!/^학년\s*[:：]/m.test(message) || !/^활동\s*[:：]/m.test(message)) return null;
  const again = await planCard(db, user.id, user.user_metadata ?? {});
  const grade = (get("학년").match(/고\s*[123]/)?.[0] ?? "").replace(/\s/g, "");
  if (!grade) return `학년을 고1 · 고2 · 고3 중에서 적어 주세요.\n${again}`;
  if (!get("대학") || !get("학과")) return `플랜은 **목표 대학 · 학과**에 맞춰 짜요. 아직 정하지 못했으면 가고 싶은 곳을 하나만 적어도 돼요 (나중에 다시 짤 수 있어요).\n${again}`;
  // 입시 플랜 · 학습 플랜(공부법 도감)은 이용권 전용 — 관리자는 통과
  const isAdm = Boolean((await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()).data);
  // 무료는 맛보기 1번 — 처음 플랜은 채팅에서 끝까지 보여 준다. 매주 미션 체크 · 다시 짜기 · 학습 다이어리는 이용권
  const free = !paid && !isAdm && !FREE_OPEN; // FREE_OPEN 이면 맛보기 제한 없이 누구나
  if (free) {
    const { count: had } = await db.from("study_plans").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    if ((had ?? 0) > 0) {
      const left = Math.max(0, 100 - (usage?.pct ?? 0));
      return `**입시 플랜 맛보기는 1번만 무료예요.** 이미 받은 플랜이 있어서 새로 짜지는 않았어요.\n\n` +
        (left > 0 ? `질문은 계속 할 수 있어요 (무료 사용량 ${left}% 남음 · 다 쓰면 새벽 5시에 다시 채워져요). 탐구주제 · 입결 · 공부법 뭐든 물어보세요.\n\n` : `오늘 무료 질문은 다 썼어요. 새벽 5시에 다시 채워져요.\n\n`) +
        `플랜을 새로 짜고, 내 플랜에 저장해서 미션을 체크하려면 이용권(한 달 10,900원 · 1년 79,000원)이 필요해요.\n\n[[이용권]]`;
    }
  }
  if (usage.pct >= 100 && !paid) return "**오늘 무료 사용량을 다 썼어요.**\n\n새벽 5시에 다시 채워져요. 그때 이 카드를 다시 보내 주면 바로 플랜을 짜 드릴게요.";
  const r: any = await makePlan(db, user.id, user.user_metadata ?? {}, { grade, department: get("학과"), did: get("활동"), goal: get("대학"), university: get("대학") });
  if (r.error) return r.error;
  const P = r.row.plan ?? {};
  const L = [`**${P.target?.university ?? r.row.goal} ${r.row.department} · ${grade} 입시 플랜을 짰어요**`, "", P.summary ?? ""];
  if (P.target?.note) L.push("", `**이 학과는 이런 걸 봐요** — ${P.target.note}`);
  if (P.subjects?.length) { L.push("", "**들어 두면 좋은 과목**"); P.subjects.forEach((x: any) => L.push(`- ${x.name}${x.kind ? ` (${x.kind})` : ""} — ${x.why}`)); }
  if (P.study?.length) { L.push("", "**과목별 공부법**"); P.study.forEach((x: any) => L.push(`- **${x.subject}** · ${x.tip}${x.how?.[0] ? ` — ${x.how[0]}` : ""}`)); }
  if (r.tasks?.length) { L.push("", "**이번 주 미션**"); r.tasks.forEach((t: any) => L.push(`- ${t.title}`)); }
  if (P.semester?.length) { L.push("", "**이번 학기 목표**"); P.semester.forEach((g: string, i: number) => L.push(`${i + 1}. ${g}`)); }
  if (free) L.push("", "**여기까지가 무료 맛보기예요.**", "이용권이면 이 플랜이 내 플랜에 저장돼서 미션을 체크하고, 매주 월요일마다 지난주에 한 걸 보고 새 미션을 받아요. 학습 다이어리 · 자기주도학습법도 같이 열려요.", "", "[[이용권]]");
  else L.push("", "아래 버튼을 눌러 내 플랜에 들어가면 미션을 체크할 수 있어요. 플랜은 저장되고, 매주 월요일마다 지난주에 한 걸 보고 새 미션을 드려요.", "", "[[플랜]]");
  return L.join("\n");
}

/* 질문에 맞춘 첫 단계 문구 — 질문 속 대학·학과·궁금한 것을 짚어 준다 */
export async function openingSteps(db: any, message: string) {
  const t = message.replace(/\s+/g, " ");
  const words = t.split(/[\s,.?!·/]+/).filter(Boolean);
  let univ = "";
  for (const w of words) {
    const cand = w.replace(/(이랑|랑|에서|에|은|는|이|가|을|를|의|도|로)$/, "");
    if (/대$|대학교$|여대$/.test(cand) || ALIAS[cand]) { const m = await matchUniv(db, cand); if (m) { univ = m.replace("여자대학교", "여대").replace("대학교", "대"); break; } }
  }
  const dept = (t.replace(/권장과목|선택과목|과목/g, " ").match(/([가-힣]{2,10}(학과|학부|교육과|의예과|약학과|간호학과))/) || [])[1] ?? "";
  const who = [univ, dept].filter(Boolean).join(" ");
  const topic =
    /꼬리/.test(t) ? "면접 꼬리질문 연습" :
    /예상\s*질문|예상질문/.test(t) ? "생기부 예상질문" :
    /흔한가|흔해|흔한지|진단/.test(t) ? (/지원동기/.test(t) ? "지원동기 흔한가 진단" : /독서|책/.test(t) ? "독서 흔한가 진단" : "탐구주제 흔한가 진단") :
    /탐구|주제|세특|수행평가/.test(t) ? "탐구주제 고민" :
    /면접/.test(t) ? "면접 준비" :
    /권장|선택과목|과목/.test(t) ? "들어야 할 과목" :
    /등급|성적|갈 수|가능|입결|커트|컷/.test(t) ? "내 성적으로 갈 수 있는지" :
    /최저/.test(t) ? "수능최저" :
    /정시|수능/.test(t) ? "정시·수능" :
    /바뀌|변화|달라|2028/.test(t) ? "바뀐 입시" :
    /논술/.test(t) ? "논술" :
    /전형|뽑|모집/.test(t) ? "전형·모집 방법" : "";
  const first = who && topic ? `${who} ${topic} 질문을 읽는 중` : who ? `${who} 질문을 읽는 중` : topic ? `${topic} 질문을 읽는 중` : "질문 읽는 중";
  const personal = /(^|\s)(나|내|저|제)(가|는|의|\s)|내 |생기부|나한테|저한테|등급/.test(t);
  return [first, personal ? "내 생기부·성적 기록 꺼내 보는 중" : who ? `${who} 입시 자료 펼치는 중` : "입시 자료 펼치는 중"];
}

/* 바로 입력 칸 — "탐구주제 흔한가 진단해 줘"처럼 내용 없이 기능만 고른 말이면
   AI를 부르지 않고 곧장 적는 칸을 보여 준다 (빠르고, 사용량도 안 든다) */
export const MOTIVE_Q = "어떤 지원동기를 진단할까요?";
export const safe = (v: unknown, n: number) => clean(v, n).replace(/[|\]\[]/g, " ").replace(/=/g, "＝");
export async function deptOf(db: any, userId: string, meta: any) {
  const { data: my } = await db.from("sm_my").select("department").eq("user_id", userId).maybeSingle();
  return safe(my?.department || meta?.major || "", 30);
}
export const motiveForm = (u: string, d: string, m: string) =>
  `[[입력: 지원동기 흔한가 진단 | ${u ? `대학=${u}` : "대학"} (선택) | ${d ? `학과=${d}` : "학과"} | ${m ? `지원동기=${m}` : "지원동기"}]]`;

/* 플랜 적는 칸 — 아는 학년 · 학과는 미리 채운다 */
export async function planCard(db: any, userId: string, meta: any) {
  const [{ data: my }, { data: prof }, { data: tg }] = await Promise.all([
    db.from("sm_my").select("grade,department").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("grade").eq("id", userId).maybeSingle(),
    db.from("prep_targets").select("university,department").eq("user_id", userId).order("created_at").limit(1).maybeSingle(),
  ]);
  const g = String(my?.grade || meta?.grade || prof?.grade || "").match(/고\s*[123]/)?.[0]?.replace(/\s/g, "") ?? "";
  const u = safe(tg?.university || "", 30);
  const d = safe(tg?.department || my?.department || meta?.major || "", 30);
  // 목표 대학 · 학과가 먼저 — 플랜은 그 목표에 맞춰 권장과목 · 공부법 · 활동을 짠다
  return `[[입력: 내 입시 플랜 짜기 — 목표부터 알려 주세요 | ${u ? `대학=${u}` : "대학"} | ${d ? `학과=${d}` : "학과"} | ${g ? `학년=${g}` : "학년"} | 활동 (선택)]]`;
}
export const hasPlan = async (db: any, userId: string) => Boolean((await db.from("study_plans").select("id").eq("user_id", userId).limit(1).maybeSingle()).data);