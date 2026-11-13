// agent/suhaeng.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { FREE_OPEN, clean } from "./core.ts";
import { deptOf, safe } from "./plan.ts";
import { evalSchoolName, evalSubjects, evalTasks, gradeOf, schoolMeta, termNow } from "./school.ts";
import { tpDiagNow, tpStart, tpStep } from "./tamgu.ts";
import { DIAG_FORM, newDiagTopic, roadSubject, noExpSaid, nonAnswer, taskRoute } from "./router.ts";
import { callFn, passOrAdmin, pick } from "./tools.ts";


/* ───────── 수행평가 완성 — 물꼬 채팅 안에서 끝까지 (따로 화면 없음 · sql/sm_110 school_tasks · 함수 school_task)
 * 흐름: '수행평가 하자' → ① 학년(모를 때만) → ② 어떤 과목? (그 학교 · 학년 평가계획에 수행평가가 있는 과목만)
 *       → ③ 그 과목 평가계획 한 줄 요약 + "선생님이 준 안내문 사진 올려 줘" (평가계획엔 실제 주제가 없어서 안내문이 꼭 필요)
 *       → ④ 안내문을 읽고 (고른 과목과 다르면 한 번 확인) → ⑤ 객관식 질문 4~5개 (직접 입력도 됨) → ⑥ 나만의 이야기 (선택)
 *       → ⑦ 완성본 (글 · 기준별 채점 · 세특 예상 문장) — 완성본은 무료 (하루 3개 · 새벽 5시에 다시 · school_task FREE_TASKS)
 *       → ⑧ 발표 과제면 발표 연습 (세움스피치 방식): 발표 대본(슬라이드별) + [[PPT: 과제번호]] PPT 받기(화면에서 파일 생성)
 *          → [[연습화면: 과제번호]] 발표 연습 화면(위 슬라이드 · 아래 표시된 대본 · 녹음) → "[[발표: 초]] [[장시간: 초,초,…]]"
 *       → 완성본 다음에 "어떤 형태로 낼 거야?" — PPT 발표 · 한글 파일 · 워드 파일 · PDF (안내문으로 하나 추천)
 *          한글 · 워드 · PDF 는 [[문서: 과제번호 | hwp·docx·pdf]] → 화면(lib/taskDoc)이 파일을 만든다
 *          → 학생 말 "[[발표: 초]]" → 진단 · 이유 · 수정 · 연습(D-R-R-P) + 시간 · 말 속도 · 군말 → 다시 연습
 * 학년 · 과목은 짐작하지 않는다 (모르면 묻는다) · 학생 학교 말고 다른 학교 이름은 쓰지 않는다
 * 진행 중인 과제는 학생마다 하나 (school_tasks.in_chat) · 카드 답("질문 → 답")이 올 때만 이어 가고, 다른 질문은 평소처럼 물꼬가 답한다
 */
export const SH_START = /^(수행\s*평가\s*(완성|같이|도와|써|쓰|만들|하자|할래|해\s*줘|준비)|수행평가 완성하기)|수행\s*평가.{0,8}(같이\s*하자|하자|도와\s*줘|써\s*줘|만들어\s*줘|완성해\s*줘)/;
export const SH_PREP = /^(.+?)\s*'(.+?)'\s*준비하기$/;
// 팝업 · 체크 목록의 '하는 중' 과제 버튼 ("공통국어2 수행평가 '문학의…' 이어서 하자") — 하던 그 과제를 다시 꺼낸다
export const SH_CONT = /^(.+?)\s*(?:수행\s*평가\s*|탐구\s*)?'(.+?)'\s*이어서\s*(?:하자|하기|할래)$/; // 먼저 말 걸기 팝업 버튼 ("공통국어2 '문학의…' 준비하기")
export const SH_PHOTO = /\[\[\s*사진\s*[:：]\s*([^\]]+)\]\]/;
export const SH_TTL = 12 * 3600000; // 진행 중인 과제를 이어 가는 시간
export const SH_NOSRC = "안내문이 없어";
export const SH_MAKE = "바로 완성본 만들기";
export const SH_PPT = /ppt|피피티|파워\s*포인트|슬라이드|발표\s*(자료|연습|대본|준비)/i; // 'ppt 만들어 줘' 등 — 발표 대본 + PPT 받기로
export const SH_SLIDES = /\[\[\s*장시간\s*[:：]\s*([\d,\s]+)\]\]/; // 연습 화면이 보내는 장별 걸린 초
export const SH_SPEECH = /\[\[\s*발표\s*[:：]\s*(\d+)\s*\]\]/; // 화면 발표 연습 카드가 보내는 표시 (걸린 초)
export const shIsTalk = (t: any) => t?.task_type === "발표" || /발표|PT|프레젠테이션|스피치|말하기/.test([t?.title, t?.analysis?.format, t?.analysis?.overview, t?.analysis?.prompt].join(" "));
// 제출 형태 — 완성본 다음에 묻는다 (안내문 · 과제 형식으로 하나 추천) · PPT 는 발표 대본 + 연습, 나머지는 화면에서 파일 생성(lib/taskDoc)
export const SH_DOC = /한글\s*(파일|문서)|hwp|(?<!키)워드\s*(파일|문서|로)|docx|pdf|피디에프/i;
export const SH_OUT: Record<string, { label: string; desc: string }> = {
  ppt: { label: "PPT 발표", desc: "발표 대본 · PPT 파일 · 발표 연습" },
  hwp: { label: "한글 파일", desc: "한글에서 여는 문서 · 학번 · 이름 칸" },
  docx: { label: "워드 파일", desc: "워드 · 구글 문서" },
  pdf: { label: "PDF", desc: "인쇄 · 온라인 제출" },
};
export function shOutRec(t: any) {
  const txt = [t?.title, t?.analysis?.format, t?.analysis?.overview, t?.analysis?.prompt, t?.analysis?.limits, ...(t?.analysis?.required ?? [])].join(" ");
  if (shIsTalk(t)) return "ppt";
  if (/pdf/i.test(txt)) return "pdf";
  if (/워드|docx|word/i.test(txt)) return "docx";
  return "hwp"; // 학교 제출은 한글이 가장 많다
}
export const shKindOf = (m: string) => (/ppt|피피티|파워\s*포인트|슬라이드|발표/i.test(m) ? "ppt" : /pdf|피디에프/i.test(m) ? "pdf" : /(?<!키)워드|docx/i.test(m) ? "docx" : /한글|hwp/i.test(m) ? "hwp" : "");
// 탐구 · 보고서 과제 — 완성본 뒤에 '보고서 디자인하기'(기억에 남는 탐구보고서 디자인)를 먼저 권한다
export const SH_REPORT_KEYS = ["experiment", "analysis", "inquiry", "thesis", "project", "case", "survey", "review", "field", "reading"];
export const shIsReport = (t: any) => !shIsTalk(t) && (t?.analysis?.kind === "topic" || /보고서|탐구|실험/.test(`${t?.task_type ?? ""} ${t?.title ?? ""}`) || SH_REPORT_KEYS.includes(t?.analysis?.structure));
export const shNextCard = (t: any, done = "") => {
  const rec = shOutRec(t);
  const kinds = ["ppt", "hwp", "docx", "pdf"].filter((k) => k !== done).sort((a, b) => (a === rec ? -1 : b === rec ? 1 : 0));
  const outs = kinds.map((k) => `${SH_OUT[k].label} — ${k === rec && !done ? "추천 · " : ""}${SH_OUT[k].desc}`);
  const again = t?.analysis?.kind === "topic" ? "새 탐구 설계하기 — 다른 주제도 이어서" : "새 수행평가 하기 — 다른 과목도 이어서";
  if (shIsReport(t)) {
    const design = done === "design" ? "보고서 디자인 다시 맞추기 — 고친 완성본을 디자인에 다시 담기" : `보고서 디자인하기 — ${t?.analysis?.out && t.analysis.out !== "design" ? "" : "추천 · "}디자인 30가지 · 사진 · PDF`;
    return `[[질문: 다음은? | ${[design, ...outs.map((o) => o.replace("추천 · ", "")), again].slice(0, 6).join(" | ")}]]`;
  }
  return `[[질문: 다음은? | ${[...outs, "다른 구조로 다시 쓰기 — 논술 · 탐구 보고서 등으로", again].slice(0, 6).join(" | ")}]]`;
};
export const shMin = (sec: number) => `${Math.floor(sec / 60)}분 ${sec % 60}초`;
// 발표 기본기 — 시선처리 · 복식호흡 (세움스피치 · 대본 아래에 늘 같이 보여 준다)
export const SH_BASICS = [
  `### 시선처리`,
  `- Z자: 왼쪽 뒤 → 오른쪽 뒤 → 왼쪽 앞 → 오른쪽 앞. 교실 전체를 한 번 훑을 때 (시작 · 정리)`,
  `- M자: 왼쪽 앞 → 왼쪽 뒤 → 가운데 → 오른쪽 뒤 → 오른쪽 앞. 앞줄 · 뒷줄을 고루 볼 때 (설명 · 예시)`,
  `- 정면: 핵심 문장은 한 사람과 눈을 맞추고 끝까지 말하기`,
  `- 한 곳에 2~3초, 한 문장이 끝날 때 시선을 옮겨. 화면 · 대본은 슬라이드 넘길 때만 봐.`,
  ``,
  `### 복식호흡 (발표 5분 전)`,
  `- 한 손을 배꼽 위에 얹고, 코로 4초 들이마셔 배를 부풀려 (어깨는 그대로)`,
  `- 2초 멈췄다가, 입으로 "스—" 소리를 내며 8초 동안 길게 내쉬어 배를 납작하게`,
  `- 3번 반복. 발표 중에는 // 표시에서 배로 짧게 들이마시고 다음 문장을 시작해`,
].join("\n");
// 대본 표시 읽는 법 (세움스피치 대본 표기)
export const SH_LEGEND = [
  `### 대본 표시 읽는 법`,
  `- / : 짧게 쉬기. 반 박자 멈추고 다음 말로`,
  `- // : 길게 쉬기. 1~2초 멈추고 배로 숨을 들이마셔`,
  `- ↗ : 끝을 올려 말하기 (상승조). 질문하거나 다음 말이 이어질 때`,
  `- ↘ : 끝을 내려 말하기 (하강조). 주장 · 결론을 단단하게 끝낼 때`,
  `- 굵은 글씨 : 힘주어 또박또박`,
  `- 천천히 · 보통 · 빠르게 : 그 장을 말하는 빠르기`,
  `- 시선 Z자 · M자 · 정면 : 그 장에서 청중을 보는 방법 (아래 시선처리)`,
  ``,
  `예) 여러분, / **계단**을 기억하시나요? ↗ //`,
  `→ "여러분," 하고 반 박자 쉬고, "계단"에 힘주고, "기억하시나요?"는 끝을 올린 뒤 1~2초 쉬기`,
].join("\n");
export function shScriptText(sp: any) {
  const slides = (sp?.slides ?? []).map((x: any, i: number) => {
    const how = [x.pace && x.pace !== "보통" ? `${x.pace}${x.pace_why ? ` (${clean(x.pace_why, 60)})` : ""}` : "보통 빠르기", x.gaze ? `시선 ${x.gaze}` : ""].filter(Boolean).join(" · ");
    return `**${i + 1}. ${clean(x.title, 40)}** · ${how}\n${String(x.say ?? "").trim()}`;
  }).join("\n\n");
  const tips = (sp?.tips ?? []).length ? `\n\n### 이 발표에서 꼭 지킬 것\n${sp.tips.map((x: string) => `- ${clean(x, 120)}`).join("\n")}` : "";
  const qs = (sp?.questions ?? []).length ? `\n\n### 발표 뒤 받을 수 있는 질문\n${sp.questions.map((x: any) => `- ${clean(x.q, 160)} — ${clean(x.tip, 200)}`).join("\n")}` : "";
  return `${SH_LEGEND}\n\n### 발표 대본 (${sp?.minutes ?? 3}분)\n\n${slides}\n\n${SH_BASICS}${tips}${qs}`;
}
// 발표 준비 한 번에: ① PPT 받기 → ② 대본 익히기 → ③ 발표 연습 ([[PPT]] 자리에 PPT 카드, 맨 끝에 연습 카드)
export const shSpeechPack = (t: any, sp: any, head = "") =>
  `${head}순서대로 해 봐: **① PPT 받기 → ② 대본 익히기 → ③ 발표 연습**\n\n## ① PPT 받기\n디자인 · 색을 골라 받아. 대본과 같은 순서이고, 장마다 사진 넣는 자리 · 검색어가 있고, 발표자 노트에 대본이 들어 있어. 사진만 넣으면 돼.\n\n[[PPT: ${t.id}]]\n\n## ② 대본 익히기\n${shScriptText(sp)}\n\n## ③ 발표 연습\n**발표 연습하러 가기**를 누르면 연습 화면이 열려. 위에 슬라이드, 아래에 그 장의 대본이 표시와 함께 나와. **녹음 시작**을 누르고 슬라이드를 넘기며 발표하듯 말한 뒤 **끝내고 코칭 받기**를 누르면, 시간 · 장별 시간 · 말 속도 · 군말과 고칠 점을 세움스피치 방식으로 알려 줄게.\n\n[[연습화면: ${t.id}]]`;
export const SH_OTHER_SUBJ = "목록에 없는 과목";
export const SH_WHO = "\n\n학교나 학년이 다르면 아래에서 바꿔 줘.\n[[학교바꾸기]]"; // 화면 Agent.jsx → 학교 · 학년 바꾸기 창 (SchoolGate)
export const shSafe = (v: unknown, n: number) => safe(v, n).replace(/\s[—–-]\s/g, " ").trim();
export const afterArrow = (m: string) => (m.includes("→") ? m.split("→").slice(1).join("→").trim() : "");
export const shKey = (s: unknown) => String(s ?? "").replace(/\s|[·ㆍ()]/g, "").replace(/Ⅱ/g, "2").replace(/Ⅰ/g, "1").replace(/II$/, "2").replace(/I$/, "1").toLowerCase();
export const shFiles = (raw: string, uid: string) => raw.split("|").map((p) => p.trim()).filter((p) => p.startsWith(`${uid}/`)).slice(0, 6)
  .map((p) => ({ path: p, name: p.split("/").pop(), type: /\.pdf$/i.test(p) ? "application/pdf" : "image/jpeg" }));

export async function shActive(db: any, uid: string) {
  const { data } = await db.from("school_tasks").select("*").eq("user_id", uid).eq("in_chat", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.updated_at).getTime() > SH_TTL) { await db.from("school_tasks").update({ in_chat: false }).eq("id", data.id); return null; }
  return data;
}
export async function shSave(db: any, t: any, patch: any) {
  const { data } = await db.from("school_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", t.id).select().single();
  return data ?? { ...t, ...patch };
}
/* 학생이 '이 주제로 할게'를 누르면 — 완성 전이라도 입시 로드맵(내 생기부)에 '진행 중'으로 (완성하면 school_task toRecord 가 완성본으로 덮어씀) */
export async function shStartRecord(db: any, t: any) {
  try {
    if (!t?.user_id || t.draft || t.setuk_text || t.status === "done") return;
    const title = clean(t.title, 120);
    if (!title || /^(수행평가|탐구|탐구 설계|수행 평가)$/.test(title)) return;
    const topic = t.analysis?.kind === "topic";
    const source = topic ? "tamgu" : "suhaeng";
    const { data: had } = await db.from("record_activities").select("id,content").eq("source", source).eq("source_id", String(t.id)).maybeSingle();
    if (had && !String(had.content ?? "").startsWith("진행 중")) return;
    const { data: my } = await db.from("sm_my").select("grade,department").eq("user_id", t.user_id).maybeSingle();
    const g = Number(String(t.grade ?? my?.grade ?? "").match(/[123]/)?.[0] ?? 0);
    const subject = clean(t.subject, 40);
    await db.from("record_activities").upsert({
      user_id: t.user_id, grade: g ? `고${g}` : "고1", kind: subject ? "subject" : "career", subject: subject || null,
      title, content: `진행 중 — 물꼬에서 ${topic ? "탐구" : "수행평가"}를 하고 있어요. 완성하면 완성본 · 세특 문장으로 바뀌어요.`,
      department: clean(my?.department, 40), source, source_id: String(t.id),
    }, { onConflict: "source,source_id" });
  } catch (e) {
    console.error("shStartRecord", e);
  }
}
export const shCall = (action: string, taskId: number, token: string, extra: any = {}) => callFn("school_task", { action, taskId, ...extra }, token);
export const shPaywall = (r: any) =>
  `**${clean(r?.error, 200) || "오늘 무료 완성본을 다 썼어요. 새벽 5시에 다시 열려요."}**\n\n그때 "수행평가 이어서 하자"라고 보내 주면 여기서 바로 이어 갈게요.`;

// 그 학교 · 학년 평가계획에서 수행평가가 있는 과목 — 이번 달 · 다음 달 수행평가가 있는 과목 먼저
export async function shSubjects(db: any, school: string, gnum: number) {
  const name = school ? await evalSchoolName(db, school).catch(() => "") : "";
  if (!name || !gnum) return { name, subjects: [] as any[] };
  const { rows } = await evalSubjects(db, name, gnum);
  const tasks = await evalTasks(db, rows.map((r: any) => r.id));
  const mon = termNow().month, next = mon === 12 ? 1 : mon + 1;
  const subjects = rows
    .map((r: any) => {
      const ts = tasks.filter((t: any) => t.subject_id === r.id);
      const near = ts.some((t: any) => (t.months ?? []).includes(mon)) ? 0 : ts.some((t: any) => (t.months ?? []).includes(next)) ? 1 : 2;
      return { id: r.id, subject: shSafe(r.subject, 30), perf: r.perf_total, n: ts.length, near };
    })
    .filter((x: any) => x.n > 0)
    .sort((a: any, b: any) => a.near - b.near);
  return { name, subjects };
}
// 학생이 말한 과목 → 평가계획 과목 (정확히 · 포함 · 교과군 순서로 · 하나로 딱 맞으면 그 과목)
export const SH_FAMILY: Record<string, RegExp> = {
  국어: /국어|^문학|화법|^언어|^독서|작문|^매체/,
  수학: /수학|미적분|확률|기하|대수/,
  영어: /영어|영미/,
  사회: /사회|역사|한국사|지리|윤리|정치|경제(?! 수학)|법과|세계|동아시아|도시/,
  과학: /과학|물리|화학|생명|지구|세포|역학|탐구실험/,
};
export function shMatch(subjects: any[], said: string) {
  const words = String(said ?? "").split(/[\s,·]+/).map((w) => w.replace(/(과목|수행평가|수행|평가|이야|야|요|을|를|은|는|이|가)$/, "")).filter((w) => w.length >= 2 && !/고$|고등학교$|학년$/.test(w));
  for (const w of words) {
    const k = shKey(w);
    const fam0 = SH_FAMILY[w]; // '국어' · '수학'처럼 교과 이름이면 그 교과 과목 전부
    if (fam0) { const f = subjects.filter((x: any) => fam0.test(x.subject)); if (f.length) return f; }
    const exact = subjects.filter((x: any) => shKey(x.subject) === k);
    if (exact.length) return exact;
    const part = subjects.filter((x: any) => shKey(x.subject).includes(k) || (k.length >= 3 && k.includes(shKey(x.subject))));
    if (part.length) return part;
  }
  // '공통수학2 명제파트야'처럼 평가계획 과목 이름과 딱 안 맞으면 — 말에 든 교과 이름(수학 · 국어 …)으로만 좁힌다 (다른 교과로 짐작하지 않게)
  for (const w of words) {
    const fam = Object.entries(SH_FAMILY).find(([k]) => w.includes(k));
    if (fam) { const f = subjects.filter((x: any) => fam[1].test(x.subject)); if (f.length) return f; }
  }
  return [];
}
export const shSubjectCard = (list: any[]) =>
  `[[질문: 어떤 과목 수행평가야? | ${[...list.slice(0, 5).map((x: any) => `${x.subject} — 수행 ${x.perf ?? "?"}% · 평가 ${x.n}개`), `${SH_OTHER_SUBJ} — 카드 아래 칸에 과목 이름 적기`].join(" | ")}]]`;

// 과목 평가계획 한 줄 요약 (안내문을 받기 전에 짚어 주는 것)
export async function shSubjectSummary(db: any, schoolName: string, subjectId: number) {
  const { data: s } = await db.from("school_eval_subjects").select("grade,semester,year,subject,exam_mid,exam_final,perf_total").eq("id", subjectId).maybeSingle();
  if (!s) return "";
  const { data: ts } = await db.from("school_eval_tasks").select("title,period,points,rubric").eq("subject_id", subjectId).order("sort");
  const lines = (ts ?? []).slice(0, 6).map((t: any) => {
    const els = (Array.isArray(t.rubric) ? t.rubric : []).map((e: any) => clean(String(e?.element ?? "").replace(/\s*[(（].*$/, ""), 18)).filter(Boolean).slice(0, 4);
    return `- ${clean(t.title, 40)} · ${t.points ?? "?"}점 · ${clean(t.period, 14) || "시기 미정"}${els.length ? ` · 채점: ${els.join(" / ")}` : ""}`;
  });
  return `**${schoolName} ${s.grade}학년 ${s.subject}** — 수행평가 ${s.perf_total ?? "?"}%${[s.exam_mid ? `중간 ${s.exam_mid}` : "", s.exam_final ? `기말 ${s.exam_final}` : ""].filter(Boolean).length ? ` (${[s.exam_mid ? `중간 ${s.exam_mid}` : "", s.exam_final ? `기말 ${s.exam_final}` : ""].filter(Boolean).join(" · ")})` : ""}\n${lines.join("\n")}`;
}
export const shNoticeCard = (subject: string) =>
  `[[입력: 수행평가 안내문 사진 올리기 | 과목=${shSafe(subject, 30)}]]`;
export const SH_PHOTO_ONLY = (subject: string) =>
  `수행평가는 **선생님 안내문 사진**이 꼭 있어야 해 — 과제 주제 · 채점 기준이 안내문에만 있거든. 아래 카드의 사진 올리기 버튼으로 찍어 올려 줘 (여러 장 가능).\n안내문을 아직 못 받았으면 받은 뒤에 다시 와 줘. 그 사이에 하고 싶은 주제를 깊게 파 보고 싶으면 '탐구주제 하자'라고 해.\n\n${shNoticeCard(subject)}`;
export const shAskNotice = (summary: string, subject: string) =>
  `${summary ? `${summary}\n\n` : ""}평가계획에는 비율 · 배점 · 채점 기준만 있고 **실제 과제 주제는 선생님이 준 안내문**에 있어.\n선생님이 준 **안내문 종이를 사진 찍어 올려 줘** — 아래 카드의 사진 올리기 버튼 (여러 장 가능). 수행평가는 안내문 사진이 있어야 시작할 수 있어.\n\n${shNoticeCard(subject)}`;

// 질문 하나 → 카드
export function shQuestionText(t: any) {
  const qa = Array.isArray(t.qa) ? t.qa : [];
  const cur = qa.find((x: any) => !(Array.isArray(x.answer) ? x.answer.length : x.answer) && !x.custom);
  if (!cur) return "";
  const n = qa.indexOf(cur) + 1;
  // 보기 설명 앞에 어디서 온 보기인지 — 앞선 활동 · 물꼬 기억에서 이어지면 "이어 가기 · …", 아니면 "새로 시작"
  const tag = (f: string) => (!f ? "" : /새\s*방향/.test(f) ? "새로 시작" : `이어 가기 · ${f}`);
  const opts = (cur.options ?? []).slice(0, 4).map((o: any) => `${shSafe(o.label, 60)} — ${shSafe([tag(clean(o.from, 40)), o.desc].filter(Boolean).join(". "), 110)}`);
  if (t.analysis?.kind === "topic") {
    // 탐구 설계 상담 — 지난 단계(고른 답) · 이번 단계 이름 · 짧은 반응 + 무엇을 정하는지 · 질문 카드
    const doneSteps = qa.slice(0, n - 1).map((x: any, i: number) => `${i + 1}. ${clean(x.step || x.q, 30)} — ${clean(Array.isArray(x.answer) ? x.answer.join(" + ") : x.answer || x.custom, 60)}`);
    return `${doneSteps.length ? `${doneSteps.join("\n")}\n\n` : ""}**질문 ${n} · ${clean(cur.step || cur.badge || "탐구 좁히기", 30)}**\n${clean(cur.lead, 300)}${n === 1 ? "\n보기에 없는 생각은 카드 아래 칸에 직접 적어도 돼요." : ""}\n\n[[질문: ${shSafe(cur.q, 120)} | ${[...opts, ...([] as string[])].join(" | ")}]]`;
  }
  return `**질문 ${n}**${cur.badge ? ` · ${clean(cur.badge, 30)}` : ""}${n === 1 ? "\n보기에 없는 내 생각이 있으면 카드 아래 칸에 직접 적어도 돼. 두 개를 섞고 싶으면 'A + B'처럼." : ""}\n\n[[질문: ${shSafe(cur.q, 120)} | ${[...opts, ...([] as string[])].join(" | ")}]]`;
}
// 질문이 끝나면 — 발표 과제가 아니면 A4 분량 → 글 구조 → 너만의 이야기
export const shPagesQ = (out = "") => `[[질문: A4 몇 쪽으로 쓸까? | 1쪽 — 핵심만 짧게 | 2쪽 — 가장 많이 내는 분량 | 3쪽 — 자료 · 표까지 넉넉히 | 4쪽 이상 — ${out === "design" ? "4쪽으로 쓰고 디자인에서 사진 · 표로 늘리기" : "4쪽으로 쓰고 표 · 그림으로 늘리기"} | 정해진 분량 없음 — 물꼬가 알맞게]]`;
// 질문이 끝나면 — 바로 쓰지 않고 '이 주제로 할까?' 확정부터 (확정해야 로드맵에 저장하고 보고서 쓰기로)
const shAns = (x: any) => clean(Array.isArray(x.answer) ? x.answer.join(" + ") : x.answer || String(x.custom ?? "").replace(/^모름 — .*/, "모름"), 60);
export function shConfirmText(t: any) {
  const topic = t.analysis?.kind === "topic";
  const qa = (t.qa ?? []).filter((x: any) => (Array.isArray(x.answer) ? x.answer.length : x.answer) || x.custom);
  const lines = qa.slice(0, 6).map((x: any) => `- ${clean(x.step || x.q, 30)}: ${shAns(x)}`);
  return `질문은 여기까지야. 지금까지 정한 걸 정리하면:\n\n**${topic ? "탐구 주제" : "과제"}** ${clean(t.title, 100)}${t.subject ? ` (${clean(t.subject, 20)})` : ""}\n${lines.join("\n")}\n\n이 주제로 확정하면 **내 입시 로드맵 ${clean(t.subject, 20) || "진로"} 칸에 저장**하고 ${topic ? "보고서" : "완성본"} 쓰기로 넘어가. 마음에 안 들면 질문을 처음부터 다시 해도 돼.\n\n[[질문: 이 주제로 할까? | 이 주제로 할게 — 로드맵에 저장하고 ${topic ? "보고서" : "완성본"} 쓰기 | 다시 고를래 — 질문 처음부터 다시]]`;
}
export async function shAfterQa(db: any, t: any) {
  const qa = (t.qa ?? []).filter((x: any) => (Array.isArray(x.answer) ? x.answer.length : x.answer) || x.custom);
  const nt = await shSave(db, t, { qa, status: "confirm_topic" });
  return shConfirmText({ ...t, ...nt, qa });
}
export async function shAfterQaGo(db: any, t: any) {
  const qa = (t.qa ?? []).filter((x: any) => (Array.isArray(x.answer) ? x.answer.length : x.answer) || x.custom);
  if (shIsTalk(t)) {
    await shSave(db, t, { qa, status: "story" });
    return shStoryText();
  }
  // 탐구 설계는 무조건 보고서 디자인으로 — 형태는 묻지 않고 바로 쪽수
  if (t.analysis?.kind === "topic") {
    const nt = await shSave(db, t, { qa, status: "pages", analysis: { ...(t.analysis ?? {}), out: "design" } });
    return `질문은 여기까지야. 이 탐구는 **보고서 디자인**으로 만들어 (디자인 30가지 · 사진 · 도표 칸 · PDF).\n\n${shPagesText({ ...nt, analysis: { ...(nt.analysis ?? {}), out: "design" } })}`;
  }
  await shSave(db, t, { qa, status: "outform" });
  return `질문은 여기까지야. 쓰기 전에 **어떻게 낼지**부터 정하자. 그에 따라 분량이 달라져.\n보고서 디자인은 사진 · 도표 칸이 있어서 같은 쪽수여도 글이 절반쯤이고, 한글 · 워드 파일은 글로 쪽을 채워.\n\n${shOutCard(t)}`;
}
// 제출 형태 카드 — 탐구 · 보고서면 '보고서 디자인'을 추천으로 맨 앞에
export function shOutCard(t: any) {
  const rec = shOutRec(t);
  const kinds = ["hwp", "docx", "pdf", "ppt"].sort((a, b) => (a === rec ? -1 : b === rec ? 1 : 0));
  const outs = kinds.map((k) => `${SH_OUT[k].label} — ${!shIsReport(t) && k === rec ? "추천 · " : ""}${SH_OUT[k].desc}`);
  const design = shIsReport(t) ? ["보고서 디자인 — 추천 · 디자인 30가지 · 사진 · 도표 칸 · PDF"] : [];
  return `[[질문: 어떻게 낼 거야? | ${[...design, ...outs].join(" | ")}]]`;
}
export const shOutKey = (a: string) => (/^보고서 디자인/.test(a) ? "design" : shKindOf(a));
export const SH_PAGE_CHARS: Record<string, number> = { design: 700, hwp: 1500, docx: 1500, pdf: 1500 };
export function shPagesText(t: any) {
  const out = t.analysis?.out ?? "hwp";
  const head = out === "design"
    ? "**A4 몇 쪽**으로 할까? 보고서 디자인은 한 쪽에 글 약 700자 + 사진 · 도표 칸이야 (기본 틀은 표지 · 방법 · 결과 · 결론 4장)."
    : `**A4 몇 쪽**으로 쓸까? ${SH_OUT[out]?.label ?? "한글 파일"}은 한 쪽에 글 약 1,500자야 (글자 크기 10~11pt).`;
  return `${head}\n선생님이 분량을 정해 줬으면 그대로 골라 줘.\n\n${shPagesQ(out)}`;
}
// 글 구조 3개 추천 (school_task structure) — 구조마다 문단 순서를 같이 보여 준다
export async function shStructure(db: any, t: any, token: string, emit: (s: string) => void) {
  emit("고른 답에 맞는 글 구조 고르는 중");
  const r: any = await shCall("structure", t.id, token);
  const list = (r?.structures ?? []) as any[];
  if (!list.length) {
    await shSave(db, t, { status: "story" });
    return `구조 추천을 못 불러와서 고른 답에 가장 맞는 구조로 쓸게.\n\n${shStoryText()}`;
  }
  const top = list.slice(0, 3);
  return [
    `**글 구조 고르기** — 구조마다 문단 순서가 달라. 네가 고른 답에 맞는 걸 3개 골랐어.`,
    "",
    ...top.map((x, i) => `${i + 1}. **${clean(x.label, 30)}**${i === 0 ? " (추천)" : ""} — ${clean(x.why || x.hint, 60)}\n   ${x.parts.map((p: string) => clean(p, 14)).join(" → ")}`),
    "",
    `[[질문: 어떤 구조로 쓸까? | ${[...top.map((x, i) => `${shSafe(x.label, 30)} — ${i === 0 ? "추천 · " : ""}${shSafe(x.why || x.hint, 50)}`), `다른 구조 보기 — ${list.length}가지 전부`].join(" | ")}]]`,
  ].join("\n");
}
export const shStoryText = () =>
  `거의 다 됐어. 마지막으로 **너만의 이야기**가 있으면 적어 줘. 이 과제와 관련해 겪은 일 · 느낀 점 · 꼭 넣고 싶은 말을 적으면 글에 그대로 넣어서, 친구들과 다른 글이 돼.\n\n[[질문: 너만의 이야기 있어? (카드 아래 칸에 적어 줘) | ${SH_MAKE} — 지금까지 고른 답으로 쓸게]]`;

// 안내문 분석 → (고른 과목과 다르면 확인) → 첫 질문
export async function shAnalyze(db: any, t: any, token: string, emit: (s: string) => void) {
  const chosen = t.subject;
  emit("안내문 읽고 평가계획 채점 기준이랑 맞춰 보는 중 (20초쯤)");
  const a: any = await shCall("analyze", t.id, token);
  if (a?.paywall) return shPaywall(a);
  if (a?.error || !a?.task) return `안내문을 읽지 못했어. ${clean(a?.error, 120)}\n사진이 흐리면 다시 찍어 올려 줘.\n\n${shNoticeCard(chosen || "")}`;
  const task = a.task;
  // 고른 과목과 안내문 과목이 다르면 한 번 확인 (예: '문학'을 골랐는데 '화법과 언어' 안내문)
  const got = String(task.subject ?? "");
  if (chosen && got && !shKey(got).includes(shKey(chosen)) && !shKey(chosen).includes(shKey(got))) {
    await shSave(db, task, { status: "confirm_subject", subject: chosen, analysis: { ...(task.analysis ?? {}), noticeSubject: got } });
    return `올린 안내문은 **${clean(got, 20)}** 과제 같아. 고른 과목은 **${clean(chosen, 20)}**이었는데, 어느 쪽이 맞아?\n\n[[질문: 어느 과목 수행평가야? | ${shSafe(got, 20)} — 올린 안내문 과목으로 할게 | 다시 올릴게 — 안내문을 잘못 올렸어]]`;
  }
  return shFirstQuestion(task, token, emit);
}
export async function shFirstQuestion(task: any, token: string, emit: (s: string) => void) {
  emit("첫 질문 만드는 중");
  const q: any = await shCall("qa", task.id, token);
  const tk = q?.task ?? task;
  const an = tk.analysis ?? {};
  const head = [
    `**${clean(tk.title, 60)}**${tk.subject ? ` (${clean(tk.subject, 20)})` : ""}`,
    an.summary ? clean(an.summary, 200) : "",
    an.criteria?.length ? `채점 기준: ${an.criteria.map((c: any) => `${clean(c.name, 24)}${c.points ? ` ${c.points}점` : ""}`).join(" · ")}` : "",
    tk.reco?.deepen?.how ? `이어 가기: ${clean(tk.reco.deepen.how, 200)}` : "",
    "",
    an.kind === "topic"
      ? "이제 질문 4~5개로 이 탐구를 너만의 탐구로 좁혀 볼게. 고른 답이 보고서의 관점 · 근거 · 방법이 돼."
      : "질문 4~5개를 고르면 바로 완성본을 만들어 줄게. 앞 답에서 한 단계씩 더 들어가며 물어볼게.",
  ].filter((x, i, a) => x || (i > 0 && a[i - 1])).join("\n");
  const qt = shQuestionText(tk);
  return `${head}\n\n${qt || `첫 질문을 만들지 못했어. '다시'를 보내면 이어서 물어볼게.${q?.error ? ` (${clean(q.error, 80)})` : ""}`}`;
}

// 완성본 → 채팅 글 (초안 · 기준별 채점 · 세특)
export async function shMake(db: any, t: any, token: string, emit: (s: string) => void) {
  emit("완성본 쓰는 중 · 출처가 필요하면 실제 자료도 찾아요 (1분쯤)");
  const d: any = await shCall("draft", t.id, token, { quick: true });
  if (d?.paywall) return shPaywall(d);
  if (d?.error || !d?.task?.draft) return `완성본을 만들지 못했어. 잠시 뒤 다시 눌러 줘.\n\n[[질문: 다시 해 볼까? | ${SH_MAKE}]]`;
  emit("채점 기준으로 꼼꼼히 점검하는 중");
  const s: any = await shCall("score", t.id, token);
  emit("세특 예상 문장 만드는 중");
  const f: any = await shCall("finalize", t.id, token);
  const task = f?.task ?? s?.task ?? d.task;
  const sc = task.score;
  // 무료(이용권 없음)는 채팅에 미리보기 — 첫 문단은 다, 나머지는 문단마다 앞 두 문장. 전체는 보고서 디자인 화면 · 이용권으로 파일 받기
  const pass = FREE_OPEN || (await passOrAdmin(db, t.user_id).catch(() => false)); // FREE_OPEN 이면 채팅에 전체 글
  const preview = (md: string) => {
    const parts = String(md ?? "").split(/\n(?=## )/);
    return parts.map((p, i) => {
      if (i <= 1 || /^## 참고 자료/.test(p)) return p;
      const [head, ...rest] = p.split("\n");
      const body = rest.join(" ").replace(/\s+/g, " ").trim();
      const two = (body.match(/[^.!?。]+[.!?。]/g) ?? [body]).slice(0, 2).join(" ").trim();
      return `${head}\n${two}${body.length > two.length ? " …" : ""}`;
    }).join("\n");
  };
  const shown = pass ? String(task.draft ?? "") : preview(task.draft);
  const previewNote = pass ? "" : task.analysis?.out === "design"
    ? "\n> 채팅에는 미리보기만 보여 줘. **전체 글은 보고서 디자인 화면**에서 볼 수 있고, PDF로 저장할 때 이용권이 필요해."
    : "\n> 채팅에는 미리보기만 보여 줘. **전체 글을 한글 · 워드 · PDF 파일로 받을 때** 이용권이 필요해.";
  const scoreText = sc?.items?.length
    ? `### 기준별 점검 ${sc.total} / ${sc.max}점\n${sc.items.map((i: any) => `- ${clean(i.name, 30)} **${i.got}/${i.max}**${i.tip ? ` — ${clean(i.tip, 160)}` : ""}`).join("\n")}`
    : "";
  return [
    `**완성본이 나왔어.** 아래 점검에서 짚은 곳을 고쳐서 내 말투로 다듬으면 돼. 이 활동은 **내 입시 홈 → 내 생기부**에 ${task.subject ? `${clean(task.subject, 30)} 세특` : "진로활동"}으로 바로 들어갔어.`,
    "",
    shown,
    previewNote,
    "",
    scoreText,
    task.setuk_text ? `\n### 세특 예상 문장\n${clean(task.setuk_text, 1200)}` : "",
    "",
    shOutNext(task),
  ].join("\n");
}

// 완성본 다음 — 쓰기 전에 고른 제출 형태대로 바로 버튼 (안 골랐으면 고르게)
export function shOutNext(task: any) {
  const out = task.analysis?.out;
  if (out === "design") {
    // 완성본 맨 끝에 버튼 하나만 — 다른 카드를 밑에 붙이지 않는다 (한글 · PPT 는 말로 하면 받을 수 있음)
    return `이제 **보고서 디자인**하러 가자. 아래 버튼을 누르면 이 완성본이 디자인 보고서에 들어가. 디자인 30가지 중에 고르고 사진 · 글씨체 · 색을 바꾼 뒤 PDF로 저장하면 돼.\n한글 파일이나 PPT 발표도 필요하면 "한글 파일 줘", "PPT 만들어 줘"라고 말해.\n\n[[디자인: ${task.id}]]`;
  }
  if (out === "hwp" || out === "docx" || out === "pdf") {
    return `**${SH_OUT[out].label}**로 내기로 했지. 아래 버튼으로 받아서 학번 · 이름 칸만 채우면 돼.\n\n[[문서: ${task.id} | ${out}]]\n${shNextCard(task, out)}`;
  }
  if (out === "ppt") {
    return `**PPT 발표**로 내기로 했지. 이제 이 완성본으로 발표 대본 · PPT를 만들자.\n\n[[질문: 다음은? | PPT 발표 — 발표 대본 · PPT 파일 · 발표 연습 | 한글 파일 — 완성본을 문서로도 받기]]`;
  }
  return `**어떤 형태로 낼 거야?** 안내문에 맞는 걸 골라 줘. 고르면 바로 파일로 받을 수 있어.\n${shNextCard(task)}`;
}

export async function suhaengChat(db: any, user: any, message: string, token: string, emit: (s: string) => void, history: any[] = []): Promise<string | null> {
  const uid = user.id, meta = user.user_metadata ?? {};
  const msg = message.trim();
  const ans = afterArrow(msg);
  const photo = msg.match(SH_PHOTO);
  let t = await shActive(db, uid);
  const mon = termNow().month;

  // 어디로 갈지는 router.ts 가 정한다 (입력 카드 · 카드 답 · 하던 과제 먼저, 말 뜻은 그다음)
  let r = taskRoute(msg, { status: t?.status, hasDraft: Boolean(t?.draft) });
  // 흔한가 진단 입력 카드는 하던 수행평가와 상관없이 진단으로 (AI가 diagnose 를 부른다)
  if (!photo && DIAG_FORM(msg)) return null;
  // 학생이 '실험은 싫다'고 했으면 과제에 적어 둔다 (탐구 설계 · 질문 · 완성본이 실험을 빼게)
  if (t && !t.analysis?.no_exp && noExpSaid(msg, history)) t = await shSave(db, t, { analysis: { ...(t.analysis ?? {}), no_exp: true } });

  // ⓪ 탐구 설계 — 진단 결과 카드 · '탐구 설계 / 보고서 써 줘 / 탐구주제 찾아 줘' · '새 탐구 설계하기'
  if (r === "tp_diag_now") return tpDiagNow(db, uid, meta, newDiagTopic(msg), token);
  if (r === "tp_new_diag") {
    const d = await deptOf(db, uid, meta);
    return `새 주제를 적고 보내면 바로 진단해요.\n[[입력: 탐구주제 흔한가 진단 | ${d ? `학과=${d}` : "학과"} | 과목 | 탐구주제]]`;
  }
  if (r === "tp_from_diag") return tpStart(db, uid, meta, msg, t, token, emit, history);
  if (r === "tp_step") {
    const out = await tpStep(db, uid, meta, t, msg, ans, token, emit, history);
    if (out !== null) return out;
    r = taskRoute(msg, { status: t?.status, hasDraft: Boolean(t?.draft), tpDeclined: true });
  }
  if (r === "tp_start") return tpStart(db, uid, meta, msg, t, token, emit, history);

  // 하던 수행평가에 안내문 사진을 늦게 올렸으면 — 그 과제(과목 그대로)에 붙여 안내문부터 다시 읽는다
  if (r === "sh_photo_add" && t && photo) {
    t = await shSave(db, t, { status: "draft", source_files: shFiles(photo[1], uid), qa: [] });
    return shAnalyze(db, t, token, emit);
  }

  // ⓪ 이어서 — 팝업 '○○ 이어서 하자': 하던 그 과제를 채팅에 다시 꺼내 지금 단계 카드를 다시 보여 준다 (없으면 새로 시작)
  if (r === "sh_resume") {
    const m = msg.trim().match(SH_CONT)!;
    const key = (x: string) => String(x ?? "").replace(/\s/g, "");
    const { data: live } = await db.from("school_tasks").select("*").eq("user_id", uid).neq("status", "done")
      .gte("updated_at", new Date(Date.now() - 90 * 86400000).toISOString()).order("updated_at", { ascending: false }).limit(30);
    const wantTopic = /탐구\s*'/.test(msg);
    const same = (live ?? []).filter((x: any) => (x.analysis?.kind === "topic") === wantTopic && (x.subject ? key(x.subject).includes(key(m[1])) || key(m[1]).includes(key(x.subject)) : /^(진로|기타)$/.test(m[1].trim())));
    const words = key(m[2]).match(/[가-힣A-Za-z0-9]{2}/g) ?? [];
    const best = same.sort((a: any, b: any) => words.filter((w) => key(b.title).includes(w)).length - words.filter((w) => key(a.title).includes(w)).length)[0];
    if (best) {
      if (t && t.id !== best.id) await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
      t = await shSave(db, best, { in_chat: true });
      const head = `좋아, **${clean(t.subject, 20)}** '${clean(m[2], 40)}' 하던 데서 이어 갈게.`;
      const st = String(t.status ?? "");
      if (st === "need_source" || st === "picking" || st === "subject_free") return `${head}

${shAskNotice("", t.subject ?? "")}`;
      if (st === "analyzed" || st === "qa") { const q = shQuestionText(t); return q ? `${head}

${q}` : `${head}

${await shAfterQa(db, t)}`; }
      if (st === "confirm_topic") return `${head}\n\n${shConfirmText(t)}`;
      if (st === "outform") return `${head}\n\n${shOutCard(t)}`;
      if (st === "pages") return `${head}

${shPagesText(t)}`;
      if (t.draft && (st === "writing" || st === "speech")) return `${head}

${shOutNext(t)}`;
      return `${head} 지난번 마지막 질문에 이어서 답해 줘. 처음부터 다시 하고 싶으면 "새 수행평가 하기"라고 말해 줘.`;
    }
  }

  // ① 시작 — '수행평가 하자' · 팝업 '○○ 준비하기' · 안내문 사진을 바로 올림 · '새 수행평가 하기' · (하던 과제를 못 찾은 '이어서 하자')
  const prep = msg.match(SH_PREP) ?? msg.trim().match(SH_CONT);
  if (r === "sh_start" || r === "sh_resume") {
    if (t) await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
    const { school } = await schoolMeta(db, uid, meta);
    const grade = await gradeOf(db, uid, meta).catch(() => "");
    const gnum = Number(String(grade).match(/[123]/)?.[0] ?? 0);
    const base: any = { user_id: uid, school: school || null, grade: gnum ? `고${gnum}` : null, semester: mon >= 3 && mon <= 8 ? 1 : 2, in_chat: true, status: "picking", title: "수행평가" };
    // 사진부터 올렸으면 — 과목은 안내문에서 읽는다
    if (photo) {
      const { data } = await db.from("school_tasks").insert({ ...base, status: "draft", source_files: shFiles(photo[1], uid) }).select().single();
      if (!data) return "수행평가를 시작하지 못했어. 잠시 뒤 다시 해 줘.";
      return shAnalyze(db, data, token, emit);
    }
    const { data: nt, error } = await db.from("school_tasks").insert(base).select().single();
    if (!nt) { console.error("suhaeng insert", error); return `수행평가를 시작하지 못했어. 잠시 뒤 다시 해 줘. (${clean(error?.message, 80)})`; }
    // 학년을 모르면 학년부터 (짐작하지 않는다)
    if (!gnum) {
      await shSave(db, nt, { status: "grade", analysis: { hint: clean(prep ? prep[1] : roadSubject(msg) || msg.replace(SH_START, "").replace(/수행\s*평가.*$/, ""), 40) } });
      return `좋아, 수행평가 같이 끝내 보자! 먼저 몇 학년이야?\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]${SH_WHO}`;
    }
    const { name, subjects } = await shSubjects(db, school, gnum);
    // 팝업 '○○ 준비하기' · 시작 말에 과목이 있으면 그 과목으로 (하나로 딱 맞을 때만)
    const said = prep ? prep[1] : roadSubject(msg) || msg.replace(SH_START, "").replace(/수행\s*평가.*$/, "");
    const hit = shMatch(subjects, said);
    if (hit.length > 1 && hit.length < subjects.length) {
      return `좋아, 수행평가 같이 끝내 보자! 어떤 과목이야?\n**${name} ${gnum}학년** 평가계획에 있는 과목 중에서 골라 줘.\n\n${shSubjectCard(hit)}${SH_WHO}`;
    }
    if (hit.length === 1) {
      const sum = await shSubjectSummary(db, name, hit[0].id);
      await shSave(db, nt, { status: "need_source", subject: hit[0].subject, eval_subject_id: hit[0].id });
      return `좋아, **${hit[0].subject}** 수행평가 같이 끝내 보자!\n\n${shAskNotice(sum, hit[0].subject)}${SH_WHO}`;
    }
    if (!subjects.length) {
      await shSave(db, nt, { status: "subject_free" });
      return `좋아, 수행평가 같이 끝내 보자! 어떤 과목이야?\n${school ? `(${school} ${gnum}학년 평가계획은 아직 생수면에 없어서, 과목만 알려 주면 안내문으로 할게)` : "(학교를 알려 주면 그 학교 평가계획 채점 기준까지 맞춰 줄게)"}\n\n[[질문: 어떤 과목 수행평가야? | 국어 | 수학 | 영어 | 사회 | 과학 | 그 밖의 과목 — 카드 아래 칸에 과목 이름 적기]]${SH_WHO}`;
    }
    return `좋아, 수행평가 같이 끝내 보자! 어떤 과목이야?\n**${name} ${gnum}학년** 평가계획에서 수행평가가 있는 과목만 골라 왔어 (이번 달 · 다음 달 수행평가 있는 과목 먼저).\n\n${shSubjectCard(subjects)}${SH_WHO}`;
  }
  // 'ppt 만들어 줘' · '발표 연습' · '발표 대본' — 채팅에 진행 중인 과제가 없거나 완성본이 없으면, 가장 최근 완성본(2주 안)을 다시 꺼낸다
  if (r === "sh_reopen") {
    const { data: last } = await db.from("school_tasks").select("*").eq("user_id", uid).not("draft", "is", null)
      .gte("updated_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!last) return `PPT · 한글 · 워드 · PDF 파일은 수행평가 완성본으로 만들어. 먼저 수행평가를 완성하면, 그 글을 원하는 형태로 바로 받을 수 있어 (발표면 대본 · 연습까지).\n\n[[수행평가]]`;
    if (t && t.id !== last.id) await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
    t = await shSave(db, last, { in_chat: true });
  }
  if (!t) return null;
  const wantMake = /완성본\s*(만들|써|쓰|줘)/.test(msg); // 카드 없이 그냥 '완성본 만들어 줘'라고 해도

  // ①-2 학년
  if (t.status === "grade") {
    const g = Number((ans || msg).match(/^고?\s*([123])\s*(학년)?$/)?.[1] ?? 0);
    if (!g) return ans ? `고1 · 고2 · 고3 중에 골라 줘.\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]` : null;
    const { name, subjects } = await shSubjects(db, t.school ?? "", g);
    t = await shSave(db, t, { grade: `고${g}`, status: subjects.length ? "picking" : "subject_free" });
    const hit = subjects.length ? shMatch(subjects, t.analysis?.hint ?? "") : [];
    if (hit.length === 1) {
      const sum = await shSubjectSummary(db, name, hit[0].id);
      await shSave(db, t, { status: "need_source", subject: hit[0].subject, eval_subject_id: hit[0].id });
      return shAskNotice(sum, hit[0].subject);
    }
    if (hit.length > 1 && hit.length < subjects.length) return `**${name} ${g}학년** 평가계획에 있는 과목 중에서 골라 줘.\n\n${shSubjectCard(hit)}`;
    return subjects.length
      ? `**${name} ${g}학년** 평가계획에서 수행평가가 있는 과목만 골라 왔어.\n\n${shSubjectCard(subjects)}`
      : `어떤 과목이야?\n\n[[질문: 어떤 과목 수행평가야? | 국어 | 수학 | 영어 | 사회 | 과학 | 그 밖의 과목 — 카드 아래 칸에 과목 이름 적기]]`;
  }

  // ② 과목 고르기 (평가계획 과목 · 평가계획이 없으면 자유)
  if (t.status === "picking" || t.status === "subject_free") {
    if (photo) {
      t = await shSave(db, t, { status: "draft", source_files: shFiles(photo[1], uid) });
      return shAnalyze(db, t, token, emit);
    }
    if (!ans) return null; // 카드 답이 아니면 평소 물꼬 대화
    const gnum = Number(String(t.grade ?? "").match(/[123]/)?.[0] ?? 0);
    if (t.status === "subject_free") {
      if (ans.startsWith("그 밖의 과목") || nonAnswer(ans)) return `카드 아래 칸에 과목 이름을 적어 줘 (예: 화법과 언어). 과목은 내가 짐작해서 정하지 않아.\n\n[[질문: 어떤 과목 수행평가야? | 국어 | 수학 | 영어 | 사회 | 과학]]`;
      t = await shSave(db, t, { status: "need_source", subject: clean(ans.split(" — ")[0], 30) });
      return shAskNotice("", t.subject);
    }
    const { name, subjects } = await shSubjects(db, t.school ?? "", gnum);
    if (ans.startsWith(SH_OTHER_SUBJ) || /^그 밖의 과목/.test(ans) || nonAnswer(ans)) return `카드 아래 칸에 과목 이름을 적어 줘. 과목은 내가 짐작해서 정하지 않아.\n\n${shSubjectCard(subjects)}`;
    const label = ans.split(" — ")[0].trim();
    const exact = subjects.filter((x: any) => shKey(x.subject) === shKey(label));
    const found = exact.length ? exact : shMatch(subjects, label);
    if (found.length === 1) {
      const sum = await shSubjectSummary(db, name, found[0].id);
      await shSave(db, t, { status: "need_source", subject: found[0].subject, eval_subject_id: found[0].id });
      return shAskNotice(sum, found[0].subject);
    }
    if (found.length > 1) return `**${clean(ans, 20)}**이(가) 들어간 과목이 여러 개야. 하나 골라 줘.\n\n${shSubjectCard(found)}`;
    // 평가계획에 없는 과목 — 그대로 진행 (안내문으로)
    await shSave(db, t, { status: "need_source", subject: clean(ans, 30) });
    return `**${name} ${gnum}학년** 평가계획에는 '${clean(ans, 20)}' 수행평가가 없어. 그래도 안내문이 있으면 그걸로 같이 하자.\n\n${shAskNotice("", clean(ans, 30))}`;
  }

  // ③ 안내문 받기 (사진 · 글 · 없음)
  if (t.status === "need_source") {
    if (/안내문\s*(이\s*)?(아직\s*)?(없|못\s*받)/.test(ans || msg)) return SH_PHOTO_ONLY(t.subject ?? "");
    // 안내문은 사진으로만 — 글만 보내면 사진을 다시 부탁한다
    if (!photo && /^(과목\s*[:：]|안내문 내용)/m.test(msg)) return SH_PHOTO_ONLY(t.subject ?? "");
    const subj = msg.match(/^과목\s*[:：]\s*(.*)$/m)?.[1]?.trim() ?? "";
    const body = msg.match(/^안내문 내용[^:：]*[:：]\s*([\s\S]*)$/m)?.[1]?.trim() ?? "";
    if (!photo && (body.length < 10 || body === "없음")) return null;
    t = await shSave(db, t, {
      status: "draft",
      subject: subj && subj !== "없음" ? subj : t.subject,
      source_text: body && body !== "없음" ? body : t.source_text,
      ...(photo ? { source_files: shFiles(photo[1], uid) } : {}),
    });
    return shAnalyze(db, t, token, emit);
  }

  // ③-2 안내문 없이 — 평가계획의 수행평가 고르기
  if (t.status === "pick_task") {
    if (photo) { t = await shSave(db, t, { status: "draft", source_files: shFiles(photo[1], uid) }); return shAnalyze(db, t, token, emit); }
    if (!ans) return null;
    const c = ((t.analysis?.candidates ?? []) as any[]).find((x: any) => x.label === ans || ans.startsWith(x.label));
    if (!c) return null;
    t = await shSave(db, t, { status: "draft", eval_task_id: c.id, title: c.label });
    return shAnalyze(db, t, token, emit);
  }

  // ④ 고른 과목과 안내문 과목이 다를 때
  if (t.status === "confirm_subject") {
    if (!ans) return null;
    if (ans.startsWith("다시 올릴게")) {
      await shSave(db, t, { status: "need_source", source_files: [], source_text: null });
      return `좋아, **${clean(t.subject, 20)}** 안내문을 다시 올려 줘.\n\n${shNoticeCard(t.subject ?? "")}`;
    }
    const ns = t.analysis?.noticeSubject || t.subject;
    // 안내문 과목도 그 학교 평가계획에 있으면 — 그 과목 채점 기준으로 다시 읽는다
    const gnum = Number(String(t.grade ?? "").match(/[123]/)?.[0] ?? 0);
    const { subjects } = await shSubjects(db, t.school ?? "", gnum);
    const same = subjects.filter((x: any) => shKey(x.subject) === shKey(ns));
    if (same.length === 1) {
      t = await shSave(db, t, { status: "draft", subject: same[0].subject, eval_subject_id: same[0].id, eval_task_id: null });
      return shAnalyze(db, t, token, emit);
    }
    t = await shSave(db, t, { status: "analyzed", subject: ns, eval_subject_id: null, eval_task_id: null });
    return shFirstQuestion(t, token, emit);
  }

  // ⑤-0 주제 확정 — '이 주제로 할게'면 로드맵에 저장하고 쓰기로 · '다시 고를래'면 질문 처음부터
  if (t.status === "confirm_topic") {
    if (/^이 주제로/.test(ans) || (!ans && (wantMake || /^(이 주제로|이걸로|좋아|확정)/.test(msg.trim())))) {
      await shStartRecord(db, { ...t, user_id: t.user_id ?? uid });
      const go = await shAfterQaGo(db, t);
      return `**저장했어** — 내 입시 로드맵 ${clean(t.subject, 20) || "진로"} 칸에 '하는 중'으로 들어갔어. 다 쓰면 완성본으로 바뀌어.\n\n${go}`;
    }
    if (/^다시 고를래/.test(ans)) {
      t = await shSave(db, t, { status: "analyzed", qa: [] });
      return shFirstQuestion(t, token, emit);
    }
    return ans ? shConfirmText(t) : null;
  }

  // ⑤ 객관식 질문
  if (t.status === "analyzed" || t.status === "qa") {
    // 질문은 최소 4개 — 한 답에서 더 파고들어야 학생마다 다른 결과가 나온다
    const qa0 = Array.isArray(t.qa) ? t.qa : [];
    const done0 = qa0.filter((x: any) => (Array.isArray(x.answer) ? x.answer.length : x.answer) || x.custom).length;
    const open0 = qa0.some((x: any) => !(Array.isArray(x.answer) ? x.answer.length : x.answer) && !x.custom);
    if (wantMake && !ans) {
      if (done0 < 4) {
        if (open0) return `질문 4개는 답해야 너만의 결과가 나와. 지금 ${done0}개 답했어.\n\n${shQuestionText(t)}`;
      } else {
        return shAfterQa(db, t);
      }
    }
    // 질문 만들기가 실패했으면 '다시'로 다음 질문을 다시 만든다
    if (!open0 && /^(다시|다음 질문|계속)\s*(해\s*줘|해|요)?[.!]?$/.test(msg)) {
      emit("다음 질문 만드는 중");
      const r: any = await shCall("qa", t.id, token);
      if (r?.done && r?.task) return shAfterQa(db, r.task);
      if (!r?.task) return `질문을 만들지 못했어. 잠시 뒤 '다시'를 보내 줘. (${clean(r?.error, 80)})`;
      return shQuestionText(r.task);
    }
    if (!ans) return null;
    const qa = Array.isArray(t.qa) ? [...t.qa] : [];
    const i = qa.findIndex((x: any) => !(Array.isArray(x.answer) ? x.answer.length : x.answer) && !x.custom);
    if ((ans.startsWith("여기까지 하고 완성본") && done0 >= 4) || (i < 0 && done0 >= 4)) {
      return shAfterQa(db, { ...t, qa });
    }
    if (i < 0) return null;
    const cur = qa[i];
    const labels = (cur.options ?? []).map((o: any) => shSafe(o.label, 60));
    const parts = ans.split(/\s*\+\s*/).map((x) => x.trim()).filter(Boolean);
    const picked = parts.filter((x) => labels.includes(x));
    let own = parts.filter((x) => !labels.includes(x)).join(" + ");
    // 보기 대신 칸에 적은 말이 답이 아닐 때 (10/26~ 대화: '세개다'를 주제 이름으로, '롤모델이 없어'에도 롤모델 질문을 계속)
    const na = !picked.length ? nonAnswer(own) : null;
    if (na === "all" && !cur.multi) return `이 질문은 하나만 골라야 다음 질문이 그 안으로 깊어져. 제일 끌리는 걸 하나 골라 줘 (둘을 섞고 싶으면 칸에 'A + B'처럼 적어 줘).\n\n${shQuestionText(t)}`;
    if (na === "all") picked.push(...labels.slice(0, cur.maxPick || 2));
    if (na === "any" && labels.length) picked.push(labels[0]);
    if (na === "all" || na === "any") own = "";
    if (na === "unknown" || na === "said") own = `모름 — 학생이 '${clean(own, 30)}'라고 함. 이 질문의 전제를 버리고 다음 질문은 학생이 바로 고를 수 있는 구체 후보로 다시 묻기`;
    qa[i] = { ...cur, answer: picked.length ? (cur.multi ? picked : picked[0]) : null, custom: own || null };
    t = await shSave(db, t, { qa });
    emit("다음 질문 만드는 중");
    const r: any = await shCall("qa", t.id, token);
    if (r?.done && r?.task) return shAfterQa(db, r.task);
    if (!r?.task) return `다음 질문을 만들지 못했어. '다시'를 보내면 이어서 물어볼게. (${clean(r?.error, 80)})`;
    return shQuestionText(r.task);
  }

  // ⑤-1 제출 형태 (쓰기 전에 — 분량이 달라진다)
  if (t.status === "outform") {
    if (wantMake && !ans) { t = await shSave(db, t, { status: "story" }); return shMake(db, t, token, emit); }
    if (!ans && !SH_DOC.test(msg) && !SH_PPT.test(msg) && !/디자인/.test(msg)) return null;
    const out = shOutKey(ans || msg);
    if (!out) return `어떻게 낼지 골라 줘.\n\n${shOutCard(t)}`;
    if (out === "ppt") {
      // 발표 — 쪽수 대신 발표 시간으로 대본을 만든다. 완성본(발표 내용) 구조만 고른다
      t = await shSave(db, t, { status: "structure", analysis: { ...(t.analysis ?? {}), out } });
      return `**PPT 발표**로 낼게. 완성본(발표 내용)을 쓰고 나서 발표 대본 · PPT · 발표 연습으로 이어 갈게.\n\n${await shStructure(db, t, token, emit)}`;
    }
    t = await shSave(db, t, { status: "pages", analysis: { ...(t.analysis ?? {}), out } });
    return shPagesText(t);
  }
  // ⑤-2 A4 분량
  if (t.status === "pages") {
    if (wantMake && !ans) { t = await shSave(db, t, { status: "story" }); return shMake(db, t, token, emit); }
    if (!ans && !/^\s*\d\s*(쪽|장|페이지|p)/i.test(msg)) return null;
    const said = ans || msg;
    const n = Number(said.match(/(\d)\s*(쪽|장|페이지|p)?/i)?.[1] ?? 0);
    if (!n && !/정해진 분량 없음|모르|상관없/.test(said)) return shPagesText(t);
    t = await shSave(db, t, { status: "structure", analysis: { ...(t.analysis ?? {}), pages: Math.min(4, n) || 0, pages_said: n } });
    return `${n > 4 ? `${n}쪽은 채팅에서 한 번에 쓰기엔 길어서 **4쪽**으로 쓸게. 보고서 디자인에서 사진 · 표 · 그래프를 넣으면 ${n}쪽이 돼.\n\n` : ""}${await shStructure(db, t, token, emit)}`;
  }
  // ⑤-3 글 구조
  if (t.status === "structure") {
    if (wantMake && !ans) { t = await shSave(db, t, { status: "story" }); return shMake(db, t, token, emit); }
    if (!ans && !/^\s*\d{1,2}\s*(번)?\s*$/.test(msg)) return null;
    const f: any = await shCall("formats", t.id, token);
    const all = (f?.formats ?? []) as any[];
    if (/^다른 구조 보기/.test(ans)) {
      await shSave(db, t, { analysis: { ...(t.analysis ?? {}), structure_view: "all" } });
      const reco = (t.analysis?.structure_reco ?? []) as string[];
      const more = all.filter((x) => !reco.includes(x.key)).slice(0, 5);
      return [
        `글 구조 ${all.length}가지야. 번호나 이름을 카드 아래 칸에 적어도 돼.`,
        "",
        ...all.map((x, i) => `${i + 1}. **${clean(x.label, 30)}** — ${clean(x.hint, 40)} (${x.parts.map((p: string) => clean(p, 12)).join(" → ")})`),
        "",
        `[[질문: 어떤 구조로 쓸까? | ${[...reco.map((k) => all.find((x) => x.key === k)).filter(Boolean).map((x: any) => `${shSafe(x.label, 30)} — 추천 · ${shSafe(x.hint, 40)}`), ...more.map((x) => `${shSafe(x.label, 30)} — ${shSafe(x.hint, 40)}`)].slice(0, 6).join(" | ")}]]`,
      ].join("\n");
    }
    const said = (ans || msg).trim();
    const num = Number(said.match(/^(\d{1,2})\s*(번)?\b/)?.[1] ?? 0);
    const shown = t.analysis?.structure_view === "all" ? all : ((t.analysis?.structure_reco ?? []) as string[]).map((k) => all.find((x) => x.key === k)).filter(Boolean);
    const pick = num ? (shown[num - 1] ?? all[num - 1]) : all.find((x) => shSafe(x.label, 30) === said.split(" — ")[0].trim() || said.startsWith(shSafe(x.label, 30)) || said.includes(x.label));
    if (!pick) return `목록에 있는 구조를 골라 줘.\n\n${await shStructure(db, t, token, emit)}`;
    t = await shSave(db, t, { status: "story", analysis: { ...(t.analysis ?? {}), structure: pick.key } });
    return `**${clean(pick.label, 30)}** 구조로 쓸게 (${pick.parts.map((p: string) => clean(p, 12)).join(" → ")}).\n\n${shStoryText()}`;
  }

  // ⑥ 나만의 이야기 → 완성본
  if (t.status === "story" || t.status === "guide") {
    if (!ans && !wantMake) return null;
    const story = !ans || ans.startsWith(SH_MAKE) ? "" : ans;
    if (story) t = await shSave(db, t, { my_story: clean(story, 2000) });
    return shMake(db, t, token, emit);
  }

  // ⑧ 발표 연습 — 대본 만들기 · 말한 것 코칭 (완성본이 있어야 함)
  const speechMsg = msg.match(SH_SPEECH);
  const wantSpeech = /^다음은\?\s*→\s*(발표 연습|PPT 발표)/.test(msg) || (!ans && SH_PPT.test(msg) && !SH_DOC.test(msg));
  if (t.draft && (t.status === "done" || t.status === "writing" || t.status === "speech") && (wantSpeech || speechMsg || /^다음은\?\s*→\s*대본 다시 보기/.test(msg))) {
    if (speechMsg) {
      const slideTimes = (msg.match(SH_SLIDES)?.[1] ?? "").split(",").map((x) => Number(x.trim())).filter((x) => x >= 0);
      const said = msg.replace(SH_SPEECH, "").replace(SH_SLIDES, "").split("\n").slice(1).join("\n").trim();
      emit("말한 내용을 대본 · 채점 기준이랑 맞춰 보는 중");
      const r: any = await shCall("speech_fb", t.id, token, { transcript: said, seconds: Number(speechMsg[1]), slideTimes });
      if (r?.paywall) return shPaywall(r);
      if (r?.error || !r?.feedback) return `${clean(r?.error, 160) || "코칭을 만들지 못했어. 잠시 뒤 다시 해 줘."}\n\n[[연습화면: ${t.id}]]`;
      const { stats: st, prev, feedback: fb } = r;
      const min = r.task?.speech?.minutes ?? 3;
      const time = st.timeGap > 15 ? `${shMin(st.seconds)} — 제한 ${min}분보다 ${st.timeGap}초 길어` : st.timeGap < -30 ? `${shMin(st.seconds)} — 제한 ${min}분보다 ${-st.timeGap}초 짧아` : `${shMin(st.seconds)} — 시간 딱 좋아`;
      const speed = st.spm > 330 ? `1분에 ${st.spm}음절 — 빨라 (알맞은 속도 260~320)` : st.spm < 240 ? `1분에 ${st.spm}음절 — 느려 (알맞은 속도 260~320)` : `1분에 ${st.spm}음절 — 알맞아`;
      const off = (st.slides ?? []).filter((x: any) => x.sec < x.target * 0.6 || x.sec > x.target * 1.5);
      const per = off.length ? `\n- 장별 시간: ${off.map((x: any) => `${x.no}장 ${x.sec}초 (권장 ${x.target}초 · ${x.sec < x.target ? "너무 빨리 넘김" : "너무 김"})`).join(" · ")}` : (st.slides ?? []).length ? `\n- 장별 시간: 장마다 고르게 잘 나눴어` : "";
      const cmp = prev ? `\n- 지난번과 비교: 시간 ${shMin(prev.seconds)} → ${shMin(st.seconds)} · 속도 ${prev.spm} → ${st.spm} · 군말 ${prev.fillers} → ${st.fillers}` : "";
      return [
        `### 발표 연습 코칭`,
        `- 걸린 시간: ${time}`,
        `- 말 속도: ${speed}`,
        `- 군말(음 · 어 · 그 · 약간 · 이제): ${st.fillers}번${per}${cmp}`,
        "",
        [
          fb.good ? `**잘한 점** ${fb.good}` : "",
          `**진단** ${fb.diag}`,
          fb.why ? `**이유** ${fb.why}` : "",
          fb.fix_before && fb.fix_after ? `**수정** 지금 "${fb.fix_before}"\n→ 이렇게 "${fb.fix_after}"` : "",
          fb.practice ? `**다음 연습** ${fb.practice}` : "",
          fb.missed?.length ? `**빠진 부분** ${fb.missed.join(" · ")}` : "",
        ].filter(Boolean).join("\n\n"),
        "",
        `음성 인식이라 '음 · 어'는 일부 빠질 수 있어. 고친 점을 생각하며 한 번 더 해 봐. 두 번째는 **실전 연습**(대본 숨기고 핵심 낱말만)으로 해 보는 걸 추천해.`,
        "",
        `[[연습화면: ${t.id}]]`,
        `[[질문: 다음은? | 대본 다시 보기 — 대본 · PPT · 예상 질문 | 새 수행평가 하기 — 다른 과목도 이어서]]`,
      ].filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n");
    }
    if (/^다음은\?\s*→\s*대본 다시 보기/.test(msg) && t.speech?.slides?.length) {
      return shSpeechPack(t, t.speech);
    }
    emit("완성본을 발표 대본으로 바꾸는 중 (30초쯤)");
    const r: any = await shCall("speech_script", t.id, token);
    if (r?.paywall) return shPaywall(r);
    if (r?.error || !r?.speech) return `발표 대본을 만들지 못했어. ${clean(r?.error, 120)}\n\n[[질문: 다음은? | 발표 연습하기 — 대본 다시 만들기]]`;
    // 상태는 'done'(완성) 그대로 둔다 — 내 입시 홈 · 관리자 숫자가 '완성'으로 보이게 · 발표 기록은 speech 칸에
    await shSave(db, r.task ?? t, {}); // 이어 하기 시간(12시간)만 다시 잰다
    return shSpeechPack(t, r.speech, `**${clean(t.title, 60)}**${t.subject ? ` (${clean(t.subject, 20)})` : ""} 완성본으로 발표 준비를 시작할게. `);
  }

  // ⑦-1 보고서 디자인 — 기억에 남는 탐구보고서 디자인 30개(/inquiry/:id/report)로 넘긴다
  if (t.draft && (/^다음은\?\s*→\s*보고서 디자인/.test(msg) || (!ans && /보고서\s*(를\s*)?(디자인|꾸미|예쁘게)/.test(msg)))) {
    emit("완성본을 디자인 보고서 칸에 나눠 담는 중 (20초쯤)");
    const r: any = await shCall("to_report", t.id, token);
    if (r?.error || !r?.inquiryId) return `보고서 디자인을 열지 못했어. ${clean(r?.error, 140)}\n\n[[질문: 다시 해 볼까? | 보고서 디자인하기 — 다시 시도]]`.replace("다시 해 볼까?", "다음은?");
    return [
      `**${clean(t.title, 60)}** 완성본을 보고서 디자인에 옮겼어.`,
      `- 디자인 30가지 중에 고르고, 사진 칸 · 글씨체 · 색을 직접 바꿀 수 있어. 고른 뒤에도 언제든 바꿔져.`,
      `- 측정 · 조사 결과는 비워 뒀어. 탐구를 하고 나서 결과 칸을 채우면 돼.`,
      `- 노트북 · 태블릿에서 보기 편해. 완성하면 PDF로 저장해.`,
      "",
      `[[보고서디자인: ${r.inquiryId}]]`,
      shNextCard(r.task ?? t, "design"),
    ].join("\n");
  }

  // ⑦-2 제출 파일 (한글 · 워드 · PDF) — 화면이 [[문서: 과제번호 | 종류]] 로 파일을 만든다
  const docPick = /^다음은\?\s*→\s*(한글 파일|워드 파일|PDF)/.exec(msg);
  if (t.draft && (docPick || (!ans && SH_DOC.test(msg)))) {
    const kind = docPick ? shKindOf(docPick[1]) : shKindOf(msg) || "hwp";
    if (kind === "ppt") return null;
    const how: Record<string, string> = {
      hwp: "아래 버튼을 누르면 한글에서 바로 열리는 문서(.docx)가 받아져. 한글 기본 글꼴(함초롬바탕 10pt) · 줄 간격 160%로 맞춰 뒀어. 한글에서 열고 **파일 → 다른 이름으로 저장 → 한글 문서(hwp)**로 저장하면 돼.",
      docx: "아래 버튼을 누르면 워드 파일(.docx)이 받아져. 워드 · 구글 문서에서 바로 열려.",
      pdf: "아래 버튼을 누르면 인쇄 화면이 열려. 프린터를 **PDF로 저장**으로 바꾸고 저장하면 돼.",
    };
    return `**${clean(t.title, 60)}** 완성본을 **${SH_OUT[kind].label}**로 받아.\n${how[kind]}\n제목 아래 학번 · 이름 칸만 채우면 제출할 수 있어.\n\n[[문서: ${t.id} | ${kind}]]\n${shNextCard(t, kind)}`;
  }

  // ⑦ 완성 뒤 — 다른 구조로 다시 쓰기
  if (t.status === "done" || t.status === "writing" || t.status === "speech") {
    if (/^다음은\?\s*→\s*다른 구조로/.test(msg)) {
      const f: any = await shCall("formats", t.id, token);
      const list = (f?.formats ?? []).filter((x: any) => x.key !== f?.current).slice(0, 6);
      return `어떤 구조로 다시 쓸까?\n\n[[질문: 글 구조 고르기 | ${list.map((x: any) => `${shSafe(x.label, 30)} — ${shSafe(x.hint, 40)}`).join(" | ")}]]`;
    }
    if (/^글 구조 고르기\s*→/.test(msg)) {
      const f: any = await shCall("formats", t.id, token);
      const pick = (f?.formats ?? []).find((x: any) => shSafe(x.label, 30) === ans);
      if (!pick) return null;
      emit("완성본 다시 쓰는 중 (1분쯤)");
      const d: any = await shCall("draft", t.id, token, { format: pick.key, quick: true });
      if (d?.paywall) return shPaywall(d);
      const s: any = await shCall("score", t.id, token);
      const task = s?.task ?? d?.task;
      return `**${pick.label}** 구조로 다시 썼어.\n\n${String(task?.draft ?? "")}\n\n${task?.score ? `### 기준별 점검 ${task.score.total} / ${task.score.max}점` : ""}\n\n${shNextCard(task ?? t)}`;
    }
    return null;
  }
  return null;
}