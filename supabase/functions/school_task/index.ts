// 📝 수행평가 완성 (학교 과제) — 비커스 '내 학교 과제(school-task-ai)'를 생수면용으로 옮긴 것
// 배포: npx supabase functions deploy school_task --project-ref xhywexuazwipwvzrldwo
// DB: sql/sm_110_school_task.sql (school_tasks · 저장소 school-task-files) · 학교 평가계획 sql/sm_105 (school_eval_*)
// 비밀값: OPENAI_API_KEY (다른 함수와 같은 키)
//
// 요청 (로그인 필수) { action, taskId, content?, format?, quick? }
//   물꼬 채팅(agent 함수)이 학생 로그인으로 이 함수를 부른다 — 따로 화면 없이 채팅 안에서 고르기 → 질문 → 완성본
//   analyze  : 안내문(사진 · PDF · 글 · 학교 평가계획) 분석 + 내 활동과 잇는 추천          — 무료 (무료는 과제 3개까지)
//   qa       : 질의응답 다음 질문 1개 (최대 5개 · 보기 3~4개)                              — 무료
//   guide    : 학습가이드 (감점 방지 체크리스트 · 문단별 쓰는 법)                            — 무료
//   formats  : 글 구조 14종 목록 + 추천                                                   — 무료
//   draft    : 1차 초안 (완성본 · 빈칸 없음 · 출처가 필요하면 서버가 실제 웹 자료를 찾아 넣음) — 1년 이용권
//   score    : 안내문 · 학교 평가계획 채점 기준으로 채점 (고친 글 content 를 보내면 그 글로)   — 1년 이용권
//   finalize : 세특 예상 문장                                                             — 1년 이용권
//   make     : 딸깍 — (가이드가 없으면 가이드) → 초안 → 채점 → 세특 예상 문장을 한 번에    — 1년 이용권
//   speech_script : 발표 대본 + PPT 재료 — 완성본을 발표 시간에 맞는 말하기 대본(슬라이드별) · 화면 핵심 문구 ·
//                   사진 검색어 · 출처 + 발표 뒤 질문 2개 (PPT 파일은 화면에서 만든다 — AI 다시 안 부름) — 1년 이용권
//   speech_fb     : 발표 연습 코칭 — 학생이 말한 글(음성 인식) · 걸린 시간으로 세움스피치 D-R-R-P
//                   (진단 · 이유 · 수정 · 연습) 피드백 + 말 속도 · 시간 · 군말 숫자          — 1년 이용권
//                   speech 칸(sql/sm_112)에 대본과 연습 기록(최근 5번)을 남긴다
//              학생이 질문에서 고른 답 · 덧붙인 내 생각 · '나만의 이야기'(my_story)가 글에 꼭 들어간다
// 비커스와 다른 점: 선생님 첨삭(review) 없음 · 학생 맥락은 생수면 기록(생기부 노트 · 탐구 · 독서 · 지원 학과)
//                   · 가입 때 고른 학교의 평가계획(채점 기준표)을 안내문처럼 바로 쓸 수 있음

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasPass } from "../_shared/pass.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o";
const FREE_TASKS = 3; // 무료로 분석할 수 있는 과제 수
const BLANK_RE = /\[\[직접 입력:[^\]]*\]\]/g;
const PAID_ACTIONS = new Set(["make", "draft", "score", "finalize", "speech_script", "speech_fb"]);
const PAYWALL = "초안 · 채점 · 세특 예상 문장은 1년 이용권으로 열려요. 분석 · 질의응답 · 학습가이드까지는 무료예요.";

// AI 사용량 기록 — 관리자 'AI 비용' 칸 (gpt-4o 기준 · 웹 검색은 gpt-4.1)
const PRICE: Record<string, [number, number]> = { "gpt-4o": [2.5, 10], "gpt-4.1": [2, 8] };
let DB: any = null, UID = "";
async function logUsage(model: string, inT: number, outT: number, ok: boolean) {
  try {
    const [pi, po] = PRICE[model] ?? [2.5, 10];
    await DB?.from("ai_usage").insert({ service: "school_task", user_id: UID, model, input_tokens: inT, output_tokens: outT, cost_usd: (inT * pi + outT * po) / 1e6, ok });
  } catch (_) { /* 기록 실패는 무시 */ }
}

// ---------- OpenAI ----------
async function ai(system: string, content: any[] | string, temperature = 0.5): Promise<any> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + "\n반드시 json 객체 하나로만 답한다. 모든 글은 한국어." },
        { role: "user", content },
      ],
    }),
  });
  const j = await res.json();
  await logUsage(MODEL, j?.usage?.prompt_tokens ?? 0, j?.usage?.completion_tokens ?? 0, res.ok);
  if (!res.ok) throw new Error(j?.error?.message ?? "AI 호출 실패");
  return JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
}

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
// 질의응답 답 — 고른 보기 + 학생이 직접 덧붙인 내 생각 (둘 다 있으면 같이)
const ansOf = (x: any) => {
  const a = Array.isArray(x?.answer) ? x.answer.map((v: any) => str(v, 120)).filter(Boolean).join(" + ") : str(x?.answer, 200);
  const mine = str(x?.custom, 300);
  return [a, mine && (a ? `내 생각: ${mine}` : mine)].filter(Boolean).join(" / ");
};
const gnum = (g: unknown) => Number(String(g ?? "").match(/[123]/)?.[0] ?? 0);
const gradeLabel = (g: unknown) => { const n = gnum(g); return n ? `고${n}` : str(g, 10); };

// ---------- 학생 맥락: 생수면에서 한 것들 ----------
//  지원 학과(마이페이지) · 생기부 노트 활동 · 탐구 보고서 · 탐구주제 진단 · 독서 진단 · 끝낸 수행평가
async function studentContext(db: any, task: any) {
  const uid = task.user_id;
  const [my, acts, inq, topics, reads, past] = await Promise.all([
    db.from("sm_my").select("grade,department").eq("user_id", uid).maybeSingle(),
    db.from("record_activities").select("grade,kind,subject,title,content").eq("user_id", uid).order("created_at", { ascending: false }).limit(30),
    db.from("inquiries").select("grade,subject,department,topic,suggestion,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(10),
    db.from("topic_queries").select("grade,subject,department,topic,created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(10),
    db.from("reading_queries").select("title,author,department,subject,grade").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
    db.from("school_tasks").select("grade,semester,subject,title,setuk_text").eq("user_id", uid).eq("status", "done").neq("id", task.id).limit(15),
  ]);
  const dept = str(my.data?.department, 40);
  const tg = gnum(task.grade);
  // 학년마다 맞출 깊이 — 고1 넓게(계열 수준) · 고2 학과 개념 · 고3 그 학과 졸업 뒤 직업 현장 문제까지
  const focus = dept ? { level: tg >= 3 ? "직업 현장" : tg === 2 ? "학과" : "계열", value: dept } : null;
  return {
    focus,
    department: dept,
    activities: (acts.data ?? []).map((a: any) => ({ grade: gradeLabel(a.grade), kind: str(a.kind, 10), subject: str(a.subject, 30), title: str(a.title, 60), did: str(a.content, 200) })),
    inquiries: (inq.data ?? []).map((r: any) => ({ grade: gradeLabel(r.grade), subject: str(r.subject, 30), topic: str(r.topic || r.suggestion, 120) })),
    topics: (topics.data ?? []).map((r: any) => ({ grade: gradeLabel(r.grade), subject: str(r.subject, 30), topic: str(r.topic, 120) })),
    readings: (reads.data ?? []).map((b: any) => ({ title: str(b.title, 80), author: str(b.author, 40), subject: str(b.subject, 30) })).filter((b: any) => b.title),
    pastTasks: (past.data ?? []).map((p: any) => ({ grade: gradeLabel(p.grade), semester: p.semester, subject: p.subject, title: p.title, setuk: str(p.setuk_text, 200) })),
  };
}

// 학교 평가계획(sm_105)에서 고른 수행평가 — 안내문처럼 쓴다 (채점 기준표 · 성취기준 · 시기 · 배점 · 유의 사항)
async function evalSource(db: any, task: any) {
  // 과목만 고른 경우 (안내문 사진을 올리기 전) — 그 과목 수행평가 전부를 주고, 안내문과 맞는 영역을 AI가 찾게 한다
  if (!task.eval_task_id && task.eval_subject_id) {
    const { data: s } = await db.from("school_eval_subjects").select("school,grade,semester,subject,exam_mid,exam_final,perf_total,grading,notes,books").eq("id", task.eval_subject_id).maybeSingle();
    if (!s) return null;
    const { data: ts } = await db.from("school_eval_tasks").select("title,unit,standards,methods,period,points,rubric,memo").eq("subject_id", task.eval_subject_id).order("sort");
    return {
      학교: s.school, 학년: s.grade, 학기: s.semester, 과목: s.subject,
      반영비율: { 중간: s.exam_mid, 기말: s.exam_final, 수행: s.perf_total },
      과목수행평가목록: (ts ?? []).map((t: any) => ({ 수행평가: t.title, 단원: t.unit, 성취기준: t.standards, 평가방법: t.methods, 시기: t.period, 배점: t.points, 채점기준표: t.rubric, 안내: t.memo })),
      안내: "과목수행평가목록 중 안내문과 맞는 영역 하나를 골라 그 채점 기준표를 쓴다. 안내문이 이 과목이 아니면 평가계획은 쓰지 않는다.",
      과목유의사항: s.notes, 교재: s.books,
    };
  }
  if (!task.eval_task_id) return null;
  const { data: t } = await db.from("school_eval_tasks").select("*").eq("id", task.eval_task_id).maybeSingle();
  if (!t) return null;
  const { data: s } = await db.from("school_eval_subjects").select("school,grade,semester,subject,exam_mid,exam_final,perf_total,grading,notes,books").eq("id", t.subject_id).maybeSingle();
  return {
    학교: s?.school, 학년: s?.grade, 학기: s?.semester, 과목: s?.subject,
    반영비율: s ? { 중간: s.exam_mid, 기말: s.exam_final, 수행: s.perf_total } : null,
    수행평가: t.title, 단원: t.unit, 성취기준: t.standards, 평가방법: t.methods, 시기: t.period, 배점: t.points,
    채점기준표: t.rubric, 안내: t.memo, 과목유의사항: s?.notes, 교재: s?.books,
  };
}

// 안내문 파일 → 모델 입력 (사진은 이미지로, PDF는 파일로)
async function sourceParts(db: any, task: any) {
  const parts: any[] = [];
  for (const f of arr(task.source_files).slice(0, 6)) {
    if (!String(f?.path ?? "").startsWith(`${task.user_id}/`)) continue; // 내 폴더 파일만
    const { data, error } = await db.storage.from("school-task-files").download(f.path);
    if (error || !data) continue;
    const buf = new Uint8Array(await data.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    const type = f.type || data.type || "";
    if (type.includes("pdf")) parts.push({ type: "file", file: { filename: f.name || "안내문.pdf", file_data: `data:application/pdf;base64,${b64}` } });
    else if (type.startsWith("image/")) parts.push({ type: "image_url", image_url: { url: `data:${type};base64,${b64}` } });
  }
  return parts;
}

// 같은 교과군으로 보는 과목
const SUBJECT_FAMILY: Record<string, string[]> = {
  국어: ["국어", "문학", "독서", "작문", "화법", "언어", "매체"],
  수학: ["수학", "대수", "미적분", "확률", "통계", "기하"],
  영어: ["영어", "영미"],
  사회: ["사회", "통합사회", "경제", "정치", "법", "윤리", "지리", "세계사", "한국사", "역사", "국제", "금융", "도시", "여행"],
  과학: ["과학", "통합과학", "물리", "화학", "생명", "지구", "역학", "전자기", "물질", "세포", "유전", "행성", "기후변화와 환경"],
  정보: ["정보", "인공지능", "데이터", "기술"],
};
function familyOf(subject: string) {
  const s = String(subject || "");
  for (const [fam, keys] of Object.entries(SUBJECT_FAMILY)) if (keys.some((k) => s.includes(k))) return fam;
  return "";
}

const SOURCE_RULE = `조사·분석·통계·사례가 들어가는 부분은 출처가 반드시 있어야 한다. 출처는 지어내지 않는다(기사·논문 제목, 숫자, 주소를 만들지 말 것).
대신 "어디서 무엇을 찾을지"를 실제로 있는 곳으로 안내한다: KOSIS 국가통계포털, 한국은행 경제통계시스템(ECOS), 공공데이터포털, 국가법령정보센터, 빅카인즈(뉴스), RISS·DBpia(논문), 정부 부처·통계청 보도자료, 교과서·책.
학생은 찾은 자료를 "기관 · 자료 이름 · 발표 날짜 · 주소" 형식으로 적는다. 책은 『제목』(저자)만 적고 쪽수는 적지 않는다.`;

/*
 * 글 구조(양식) 14종 — 비커스 보고서 작성과 같은 것. 초안의 문단 제목(##)은 이 순서를 그대로 쓴다
 */
const FORMATS: { key: string; label: string; hint: string; parts: [string, string][] }[] = [
  { key: "basic", label: "서론·본론·결론", hint: "가장 기본적인 글 구조", parts: [["서론", "문제 제기·이 주제를 고른 이유"], ["본론 1", "첫 번째 핵심 내용과 근거"], ["본론 2", "두 번째 핵심 내용·사례 적용"], ["결론", "정리와 나의 생각·느낀 점"]] },
  { key: "argument", label: "논술·주장하는 글", hint: "입장을 정하고 근거로 설득", parts: [["쟁점 제시", "무엇을 두고 의견이 갈리는지"], ["내 주장", "어느 쪽인지 분명하게"], ["근거", "왜 그렇게 생각하는지 두세 가지"], ["반론 검토", "반대 입장을 다루고 재반박"], ["결론", "주장 정리와 남은 문제"]] },
  { key: "experiment", label: "실험 보고서", hint: "직접 실험하고 측정한 탐구", parts: [["서론", "왜 이 실험을 했는지"], ["이론적 배경", "관련 개념과 선행 자료"], ["실험 방법", "바꾼 것과 고정한 것"], ["결과", "숫자와 그래프로"], ["고찰·결론", "예상과 다른 점, 진로 연결"]] },
  { key: "analysis", label: "조사·분석 보고서", hint: "통계·자료로 현황을 파헤침", parts: [["서론", "왜 이 문제를 들여다봤는지"], ["현황 분석", "통계·자료로 실태"], ["원인 분석", "왜 그런지 근거로"], ["결론·제언", "종합과 대안"]] },
  { key: "inquiry", label: "탐구 보고서", hint: "자유 주제를 파고든 탐구", parts: [["탐구 동기", "관심을 갖게 된 계기"], ["탐구 내용", "무엇을 어떻게 알아봤는지"], ["탐구 결과", "알게 된 것과 나만의 해석"], ["느낀 점", "배운 점과 다음에 할 것"]] },
  { key: "thesis", label: "소논문", hint: "형식을 갖춘 심화 연구", parts: [["초록", "목적·방법·결과 한 문단"], ["서론", "연구 배경과 연구 문제"], ["선행 연구", "기존 연구와 차별점"], ["본론", "자료 분석과 결과"], ["결론", "종합과 한계, 진로 연결"]] },
  { key: "critique", label: "감상·비평문", hint: "책·작품을 읽고 쓴 글", parts: [["도입", "무엇을 읽었고 왜 골랐는지"], ["분석", "핵심 주장과 근거"], ["비평", "동의하는 점과 아쉬운 점"], ["결론", "종합 의견과 진로 연결"]] },
  { key: "reading", label: "독서 보고서", hint: "책을 읽고 탐구로 이어감", parts: [["책 선정 이유", "왜 이 책을 골랐는지"], ["핵심 내용", "무엇을 다룬 책인지"], ["인상 깊은 부분", "한 대목과 그 이유"], ["이어진 탐구", "책에서 생긴 질문을 더 알아본 것"], ["느낀 점", "진로와의 연결"]] },
  { key: "project", label: "프로젝트·제작 보고서", hint: "무언가를 만들거나 설계", parts: [["기획 배경", "왜 만들려 했는지"], ["설계", "어떻게 만들 계획이었는지"], ["제작 과정", "만들며 겪은 일"], ["결과와 반응", "무엇이 나왔고 어떻게 쓰였는지"], ["보완할 점", "다음에 고친다면"]] },
  { key: "case", label: "사례 연구 보고서", hint: "사례 하나를 깊이", parts: [["사례 선정", "왜 이 사례인지"], ["사례 개요", "무슨 일이 있었는지"], ["분석", "왜 그런 결과가 나왔는지"], ["시사점", "여기서 배울 점"]] },
  { key: "survey", label: "설문·인터뷰 보고서", hint: "직접 묻고 모은 자료", parts: [["조사 목적", "무엇을 알고 싶었는지"], ["조사 방법", "누구에게 어떻게 물었는지"], ["결과", "숫자와 답변 정리"], ["해석", "숫자 뒤에 있는 것"], ["결론", "알게 된 것과 제안"]] },
  { key: "review", label: "문헌 조사 보고서", hint: "자료를 모아 정리", parts: [["조사 주제", "무엇을 정리하려 했는지"], ["자료 선정", "어떤 자료를 어떻게 골랐는지"], ["정리", "공통점과 차이"], ["종합", "밝혀진 것과 아직 모르는 것"]] },
  { key: "proposal", label: "제안서", hint: "문제를 찾아 해결책 제안", parts: [["문제 제기", "무엇이 문제인지"], ["원인 분석", "왜 그런지"], ["제안", "구체적으로 무엇을 하자는 건지"], ["기대 효과와 한계", "나아지는 것과 어려운 것"]] },
  { key: "field", label: "현장체험·견학 보고서", hint: "직접 가 보고 쓴 글", parts: [["사전 준비", "가기 전에 알아본 것"], ["체험 내용", "보고 들은 것"], ["인상 깊은 점", "예상과 달랐던 부분"], ["배운 점", "진로와의 연결"]] },
];
const formatOf = (k: unknown) => FORMATS.find((f) => f.key === k);

// 과제 형식·제목으로 어울리는 글 구조를 고른다 (학생이 바꿀 수 있음)
function recommendFormat(t: any): string {
  const s = `${t?.task_type ?? ""} ${t?.analysis?.format ?? ""} ${t?.title ?? ""} ${t?.analysis?.summary ?? ""}`;
  const rules: [RegExp, string][] = [
    [/실험|측정|관찰/, "experiment"], [/설문|인터뷰|면담/, "survey"], [/견학|현장|체험/, "field"],
    [/제작|만들|설계|캠페인|포스터|UCC/, "project"], [/제안|정책|해결 ?방안/, "proposal"],
    [/토론|찬반|논술|주장|논설|설득/, "argument"], [/비평|감상|작품/, "critique"],
    [/독서|책|도서/, "reading"], [/소논문|연구/, "thesis"], [/사례/, "case"],
    [/통계|데이터|분석|현황/, "analysis"], [/문헌|자료 ?조사/, "review"], [/탐구/, "inquiry"],
  ];
  return rules.find(([re]) => re.test(s))?.[1] ?? "basic";
}


function formatList(t: any) {
  const reco = recommendFormat(t);
  return {
    formats: FORMATS.map((f) => ({ key: f.key, label: f.label, hint: f.hint, parts: f.parts.map(([p]) => p) })),
    recommended: reco,
    current: formatOf(t?.analysis?.structure)?.key ?? reco,
  };
}
const taskBrief = (t: any) => JSON.stringify({
  학년: t.grade, 학기: t.semester, 학교: t.school, 과목: t.subject, 형식: t.task_type, 과제: t.title,
  분석: t.analysis, 추천: t.reco,
});
async function save(db: any, task: any, patch: any) {
  const { data, error } = await db.from("school_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", task.id).eq("user_id", task.user_id).select().single();
  if (error) throw error;
  return data;
}

// ---------- analyze: 안내문 분석 + 내 활동과 잇는 추천 ----------
async function analyze(db: any, task: any) {
  const [ctx, files, ev] = await Promise.all([studentContext(db, task), sourceParts(db, task), evalSource(db, task)]);
  if (!files.length && !str(task.source_text) && !ev) throw new Error("안내문 사진 · PDF나 글을 올리거나, 학교 평가계획에서 수행평가를 골라 주세요.");
  const fam = familyOf(task.subject || ev?.과목 || "");
  const tg = gnum(task.grade);

  // 이어 갈 수 있는 앞선 활동 — 생기부 노트 활동 · 탐구 보고서 · 탐구주제 · 끝낸 수행평가
  //   심화 = 앞 학년 활동 · 확장 = 같은 학년 다른 과목 활동
  const earlier = [
    ...ctx.activities.map((a: any) => ({ kind: "생기부 노트", grade: gnum(a.grade), subject: a.subject, title: a.title, did: a.did })),
    ...ctx.inquiries.map((a: any) => ({ kind: "탐구 보고서", grade: gnum(a.grade), subject: a.subject, title: a.topic, did: "" })),
    ...ctx.topics.map((a: any) => ({ kind: "탐구주제", grade: gnum(a.grade), subject: a.subject, title: a.topic, did: "" })),
    ...ctx.pastTasks.map((p: any) => ({ kind: "수행평가", grade: gnum(p.grade), subject: p.subject, title: p.title, did: p.setuk })),
  ]
    .map((x) => {
      const sameFam = fam && familyOf(x.subject) === fam;
      const relation = x.grade && x.grade < tg ? "심화" : x.grade === tg && !sameFam ? "확장" : x.grade === tg && sameFam ? "심화" : "";
      return { ...x, relation, when: x.grade ? `고${x.grade}` : "" };
    })
    .filter((x) => x.title && x.relation)
    .slice(0, 30);

  const system = `너는 고등학교 수행평가와 학생부(세특)를 잘 아는 입시 코치다.
1) 학교 수행평가 안내문(사진 · PDF · 글)과 [학교가 공개한 평가계획]을 읽고 그대로 정리한다. 둘 다 없는 내용은 지어내지 않는다(없으면 빈 값).
   [학교가 공개한 평가계획]이 있으면 채점 기준표(요소 · 배점 · 만점 기준 문장)를 criteria 와 required 에 그대로 옮긴다. 안내문과 다르면 안내문을 따른다.
2) 이 학생이 생수면에서 한 활동(생기부 노트 · 탐구 보고서 · 탐구주제 · 끝낸 수행평가)과 지원 학과를 보고, 이번 과제를 앞선 활동 위에 이어 붙이는 방향을 추천한다.
   - deepen: [이어 갈 수 있는 앞선 활동] 중 이번 과제와 가장 잘 이어지는 것 1개.
       · relation "심화"(앞 학년이나 같은 교과군 활동) → 한 단계 깊게 (고1 계열 관점 → 고2 학과 개념 → 고3 직업 현장 문제)
       · relation "확장"(같은 학년 다른 과목) → 깊이는 같게, 같은 관심을 이번 과목의 다른 관점 · 방법 · 자료로 넓힌다. 같은 내용 반복 금지.
       · when: "고1"처럼. did: 그때 한 것(제목을 되풀이하지 않는다). how: 이번 과제 형식에 맞춰 무엇을 더 하는지 구체적으로. 이어질 게 없으면 deepen 은 null.
   - perSection: 필수 항목(채점 요소)마다 1개씩(최대 6개).
       · section: 짧은 이름 12자 안쪽. tip: 학생이 바로 할 수 있는 구체적인 할 일(토론이면 "~해야 한다" 찬반 주제 예시).
       · 책을 고르는 항목이면 [독서 진단한 책]에서 먼저 고르고 "『제목』(이미 진단한 책)"으로. 맞는 책이 없을 때만 실제로 있는 책을 추천.
       · 조사 · 분석이 필요하면 tip 에 "어디서(실제 기관 · 포털) · 무엇을 · 검색어"와 "출처 꼭 적기". 출처 · 숫자 · 기사 제목을 지어내지 않는다.
       · strengthens: 이걸 하면 강화되는 역량 한 줄. criterion: 걸린 채점 요소 이름. needSource: 바깥 자료가 필요하면 true.
       · 채점 기준표에 만점 기준 문장이 있으면 tip 에 "만점은 '…한 경우'라서 이걸 꼭 넣어요"처럼 짚는다.
   - saveForLater: 이번에 깊게 쓰지 말고 다음 학기 · 학년 다른 과목 탐구로 남길 것 1개. grade 는 "고2"처럼. 없으면 null.
   - 모든 추천의 기준은 [진로 초점](지원 학과)이다. 고1은 계열 전반의 넓은 관점, 고2는 그 학과 개념 · 이론, 고3은 그 학과를 나와 하는 일의 실제 문제까지.
     진로 초점이 없으면 과목 자체의 역량으로만 쓴다.
   - 학생에게 보이는 글(how, tip, strengthens)은 쉬운 말 "~해요"체.
3) analysis.criteria 는 채점 항목 이름과 배점을 그대로 옮긴다. name 은 반드시 채운다.
   채점 영역이 하나(예: '발표하기 10점')인데 그 안에 채점 요소가 여러 개(예: '채점 요소 5가지' 목록)면, 요소마다 criteria 항목으로 나눈다.
   name 은 요소를 12자 안쪽으로 줄인 이름(예: "정보 선정", "구성", "청중 고려", "표현 · 전달", "태도"), points 는 총점을 요소 수로 나눈 값(소수면 반올림 없이 그대로).
4) subject 는 안내문에 적힌 과목 이름 그대로 쓴다 (학생이 고른 과목과 달라도 바꾸지 않는다). 안내문이 없으면 평가계획 과목.
5) 학교 이름은 [학생 정보]의 학교만 쓴다. 다른 학교 이름을 짓지 않는다.
json 형식:
{"title":"","subject":"","taskType":"보고서|발표|토론|논술|실험|프로젝트|기타",
 "analysis":{"overview":"","format":"","prompt":"","required":[""],"penalties":[""],"units":[""],"criteria":[{"name":"","points":0}],"limits":""},
 "reco":{"deepen":{"kind":"","relation":"심화","title":"","when":"","did":"","how":""}|null,
   "perSection":[{"section":"","tip":"","strengthens":"","criterion":"","needSource":false}],
   "saveForLater":{"subject":"","grade":"","tip":""}|null},
 "summary":"이 과제를 한 문장으로"}`;

  const user: any[] = [
    { type: "text", text: `학생 정보: ${JSON.stringify({ 학년: task.grade, 학기: task.semester, 학교: task.school, 지원학과: ctx.department })}` },
    { type: "text", text: `진로 초점: ${JSON.stringify(ctx.focus)}` },
    { type: "text", text: `이어 갈 수 있는 앞선 활동: ${JSON.stringify(earlier)}` },
    { type: "text", text: `독서 진단한 책: ${JSON.stringify(ctx.readings)}` },
    { type: "text", text: `학교가 공개한 평가계획: ${ev ? JSON.stringify(ev) : "(없음)"}` },
    { type: "text", text: `안내문 글: ${str(task.source_text, 8000) || "(없음 — 첨부 파일이나 평가계획을 읽을 것)"}` },
    ...files,
  ];
  const r = await ai(system, user, 0.3);

  const reco = r.reco ?? {};
  if (reco.saveForLater) reco.saveForLater.grade = gradeLabel(reco.saveForLater.grade);
  if (reco.deepen) {
    reco.deepen.relation = reco.deepen.relation === "확장" ? "확장" : "심화";
    if (!str(reco.deepen.how)) reco.deepen = null;
  }
  reco.perSection = arr(reco.perSection).map((p: any) => ({
    section: str(p?.section, 30), tip: str(p?.tip, 400), strengthens: str(p?.strengthens, 160),
    criterion: str(p?.criterion, 60), needSource: p?.needSource === true,
  })).filter((p: any) => p.section || p.tip);

  const analysis = r.analysis ?? {};
  analysis.criteria = arr(analysis.criteria)
    .map((c: any) => ({ name: str(c?.name || c?.item || c?.criterion || c?.title || c?.label, 80), points: Number(c?.points ?? c?.score ?? c?.max) || 0 }))
    .filter((c: any) => c.name);
  const data = await save(db, task, {
    title: str(r.title, 200) || task.title || ev?.수행평가 || "수행평가",
    subject: str(r.subject, 60) || task.subject || ev?.과목 || null,
    task_type: str(r.taskType, 20) || task.task_type,
    analysis: { ...analysis, summary: str(r.summary, 300) },
    reco,
    status: "analyzed",
  });
  return { task: data };
}

// ---------- qa: 다음 질문 1개 ----------
async function nextQuestion(db: any, task: any) {
  const answered = arr(task.qa).filter((x: any) => ansOf(x));
  if (answered.length >= 5) return { done: true, task };
  const ctx = await studentContext(db, task);
  const system = `너는 학생이 수행평가를 스스로 설계하도록 돕는 코치다. 답을 대신 정하지 않고, 학생이 고르게 한다.
지금까지의 답을 보고 다음 질문 1개를 만든다. 질문은 4~5개로 끝낸다(이미 ${answered.length}개 답함).
질문은 [채점 기준]을 채우는 순서로 만든다. badge 는 그 질문이 채우는 채점 요소 이름(채점 기준에 있는 말 그대로).
과제 형식별 순서 (채점 기준이 따로 있으면 그쪽이 먼저):
- 발표: 무엇을 소개할지(정보 선정 · 믿을 만한 출처) → 누구에게 무엇을 남길지(청중 · 목적) → 구성(도입에서 붙잡기 · 전개 순서 · 정리) → 보여 줄 자료(시각 자료 · 매체) → 전달 전략(말하기 · 태도 · 질문 대비).
- 토론: 입장 → 근거 → 예상 반론 → 재반박 → 마무리 주장.
- 감상문 · 비평 · 논술: 대상 · 작품 고르기 → 나만의 관점 → 근거(장면 · 인용) → 반대 시각 → 결론.
- 보고서 · 탐구 · 실험 · 프로젝트: 주제 범위 → 관점 · 개념 연결 → 자료(직접 비교할 것) → 해결 · 주장 → 진로 연결.
과목 범위를 지킨다:
- 이 과목(과제 과목)의 성취기준 · 채점 기준 안에서 묻는다. 다른 교과 내용(예: 국어 과제에 생명과학 · 물리)을 새로 끌어오지 않는다.
- 다른 교과와의 융합은 안내문이 융합을 요구하거나, 학생이 직접 적었거나, 학생의 앞선 활동에서 이어질 때만 보기로 둔다.
- 진로 · 지원 학과는 '무엇을 다룰지(소재)'를 고를 때 쓰고, 질문의 목적은 그 과목에서 평가하는 능력(국어면 말하기 · 쓰기 · 읽기, 사회면 자료 분석 · 주장 등)이다.
학생마다 다른 글이 나오게 한다:
- 앞선 활동이 적으면 첫 질문은 "이 학생만의 출발점"을 묻는다: 일상에서 겪은 일, 요즘 관심 있는 것, 지원 학과에서 이어지는 것.
- 앞선 활동이 있으면 그 활동을 이어 가는 보기를 먼저 둔다.
- 보기마다 학생이 직접 쓸 수 있게 화면에 '직접 입력'이 있으니, 보기는 서로 확실히 다른 방향으로.
- 보기마다 from 에 어디서 나온 보기인지 짧게: "생기부 노트 · 경제 동아리", "탐구 보고서 · ○○", "독서 · 『넛지』", "지원 학과 · 경제학과". 재료에서 나온 게 아니면 "새 방향".
- 첫 질문(지금까지 답이 0개)만: 보기를 4개 만들고, 학생이 1~2개를 골라 섞을 수 있다(multi=true).
추천(deepen, perSection)은 과목 범위 규칙을 지키는 선에서만 질문에 녹인다.
보기마다 한 줄 설명. 쉬운 말로. 충분히 모였으면 {"done":true}.
json: {"done":false,"q":"","badge":"","multi":false,"options":[{"label":"","desc":"","from":""}]}`;
  const user = `과제: ${taskBrief(task)}\n과제 형식: ${task.task_type ?? ""}\n채점 기준: ${JSON.stringify(arr(task.analysis?.criteria))}\n필수 요소: ${JSON.stringify(arr(task.analysis?.required).slice(0, 8))}\n진로 초점(고1 계열 · 고2 학과 · 고3 직업 현장 — 질문도 이 깊이로): ${JSON.stringify(ctx.focus)}\n이 학생만의 재료: ${JSON.stringify({ 생기부노트: ctx.activities.map((a: any) => `${a.subject} ${a.title}`).slice(0, 12), 탐구: [...ctx.inquiries, ...ctx.topics].map((t: any) => t.topic).slice(0, 10), 독서: ctx.readings.map((b: any) => b.title).slice(0, 12) })}\n지금까지: ${JSON.stringify(answered.map((x: any) => ({ q: x.q, a: ansOf(x) })))}`;
  const r = await ai(system, user, 0.6);
  if (r.done) return { done: true, task };
  const first = answered.length === 0;
  const item = {
    q: str(r.q, 300), badge: str(r.badge, 60), multi: first, maxPick: first ? 2 : 1,
    options: arr(r.options).slice(0, first ? 4 : 3).map((o: any) => ({ label: str(o?.label, 80), desc: str(o?.desc, 160), from: str(o?.from, 40) })).filter((o: any) => o.label),
    answer: null, custom: null,
  };
  const data = await save(db, task, { qa: [...answered, item], status: "qa" });
  return { done: false, task: data };
}

// ---------- guide: 학습가이드 ----------
async function guide(db: any, task: any) {
  const [ctx, ev] = await Promise.all([studentContext(db, task), evalSource(db, task)]);
  const system = `수행평가 학습가이드를 마크다운으로 쓴다. 학생이 직접 쓰기 전에 읽는 안내서다.
${SOURCE_RULE}
"## 조사·분석에 쓸 출처" 칸은 조사·분석이 필요한 항목(추천 perSection 의 needSource=true)이 있을 때만 넣는다: ① 무엇을 찾을지 ② 어디서(위 기관·포털) ③ 검색어 2~3개.
책이 필요한 과제면 [독서 진단한 책]을 먼저 쓴다 — "## 이 과제에 쓸 책"에 맞는 책 1~2권과 그 책에서 쓸 부분. 맞는 책이 없을 때만 실제로 있는 새 책.
[학교가 공개한 평가계획]의 채점 기준표가 있으면 "## 만점 받는 법" 칸에 요소마다 만점 기준 문장과 그걸 채우는 방법을 짝지어 쓴다.
구성: # 제목 / 한 문단 총평(학생 답과 지원 학과 · 앞선 활동 연결) / ## 감점 방지 체크리스트 / ## 만점 받는 법(채점 기준표가 있을 때) /
## 문단별 쓰는 법(필수 항목 순서대로: 무엇을, 어떤 자료로, 이어지는 활동) / ## 조사·분석에 쓸 출처(필요할 때만) / ## 이번에 남겨 둘 것.
지어낸 통계·기사·논문 제목을 쓰지 않는다.
json: {"guide":"마크다운"}`;
  const r = await ai(system, `과제: ${taskBrief(task)}\n질의응답: ${JSON.stringify(arr(task.qa).map((x: any) => ({ q: x.q, a: ansOf(x) })))}\n진로 초점: ${JSON.stringify(ctx.focus)}\n독서 진단한 책: ${JSON.stringify(ctx.readings)}\n학교가 공개한 평가계획: ${ev ? JSON.stringify(ev) : "(없음)"}`, 0.5);
  const data = await save(db, task, { guide: str(r.guide, 12000), status: "guide" });
  return { task: data };
}

// ---------- draft: 1차 초안 (완성본) ----------
async function draft(db: any, task: any, formatKey?: string, quick = false) {
  const ctx = await studentContext(db, task);
  const fmt = formatOf(formatKey) ?? formatOf(task.analysis?.structure) ?? formatOf(recommendFormat(task))!;
  if (task.analysis?.structure !== fmt.key) task = await save(db, task, { analysis: { ...(task.analysis ?? {}), structure: fmt.key } });
  const outline = fmt.parts.map(([p, g], i) => `${i + 1}. ## ${p} — ${g}`).join("\n");

  // 출처가 필요한 항목 — 서버가 실제 웹 자료를 찾아 넣는다 (최대 2개 항목 · 없으면 과제 전체로 한 번)
  // quick(물꼬 채팅): 자료 찾기는 한 번만 — 채팅 한 번 안에 완성본까지 끝내야 해서
  let needSecs: any[] = arr(task.reco?.perSection).filter((p: any) => p.needSource === true).slice(0, quick ? 1 : 2);
  if (!needSecs.length) needSecs = [{ section: "" }];
  let picked = arr(task.sources);
  if (!picked.length) {
    const found = await Promise.all(needSecs.map((p: any) => searchSection(task, ctx, p.section).catch(() => [])));
    const per = needSecs.length === 1 ? 3 : 2;
    picked = found.flatMap((list: any[]) => list.slice(0, per)).map((x: any) => ({ section: x.section, title: x.title, publisher: x.publisher, url: x.url, summary: x.summary }));
    if (picked.length) task = await save(db, task, { sources: picked });
  }

  const system = `학생의 질의응답 답과 학습가이드로 수행평가 "1차 초안 본문"을 마크다운으로 쓴다. 고등학생 문체(~했다, ~이다).
이건 학생이 그대로 내도 될 만큼 완성된 글이다. 학생은 마지막에 조금만 고친다:
- 맨 위 제목(#)은 과제 제목 그대로. 안내 문구와 목록을 쓰지 않는다.
- 글 구조는 [글 구조]를 그대로 따른다: 문단 제목(##)은 그 이름과 순서 그대로("## 참고 자료"만 예외).
- 채점 요소 · 필수 항목마다 어느 문단에서 채울지 정해, 그 문단 안에서 빠짐없이 다룬다. 채점 기준표의 만점 기준 문장을 충족하게 쓴다.
- 같은 말을 문단마다 되풀이하지 않는다. 문단마다 새 내용(개념 → 예시 → 분석 → 나의 생각 순으로 깊어지게).
- 문단마다 이어지는 글로 4~6문장. 불릿 목록으로 쪼개지 않는다(안내문이 표·목록을 요구할 때만 예외).
- 추천의 deepen.how 와 perSection 을 해당 문단에 반영(앞선 활동에서 이어지는 문장 한두 개).
- 나의 생각·느낀 점: 질의응답에서 학생이 고른 답을 바탕으로 2~3곳에 학생 목소리로.
- [나만의 이야기]와 질의응답의 "내 생각"은 학생이 직접 쓴 것이다. 빠짐없이 글에 녹이고, 학생이 쓴 표현과 경험을 최대한 살린다 (다른 학생 글과 달라지는 핵심).
책: 책이 필요한 과제면 [독서 진단한 책]에서 맞는 책을 골라 처음 나오는 문단에서 한 번만 『제목』(저자)로. 쪽수는 쓰지 않는다. 책 내용은 일반적으로 알려진 핵심만, 지어내지 않는다.
출처: [참고할 자료]를 맞는 문단에 나눠 실제 근거로 쓰고 문장 끝에 "(출처: 발행처, 「제목」)". 자료 내용은 summary 에 있는 것만.
- [참고할 자료]에 없는 숫자·통계·기사·법령 조항·인용을 새로 만들지 않는다.
- 글 맨 끝 "## 참고 자료"에 쓴 책과 자료(발행처, 「제목」, 주소)를 적는다.
금지: 빈칸·자리표시([[...]], (직접 입력), ○○, OO, ___). 토론·발표처럼 실제로 일어난 일을 "~했다"로 꾸며 내지 않는다.
json: {"content":"마크다운"}`;
  const r = await ai(system, `과제: ${taskBrief(task)}\n질의응답: ${JSON.stringify(arr(task.qa).map((x: any) => ({ q: x.q, a: ansOf(x) })))}\n학습가이드: ${str(task.guide, 6000)}\n진로 초점: ${JSON.stringify(ctx.focus)}\n독서 진단한 책: ${JSON.stringify(ctx.readings)}\n참고할 자료: ${JSON.stringify(picked)}\n[나만의 이야기] ${str(task.my_story, 2000) || "(없음)"}\n[글 구조] ${fmt.label}\n${outline}`, 0.6);
  const content = str(r.content, 20000).replace(BLANK_RE, "").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ");
  const data = await save(db, task, { draft: content, draft_round: (task.draft_round ?? 0) + 1, score: null, status: "writing" });
  return { task: data };
}

// ---------- score: 채점 ----------
async function score(db: any, task: any, content?: string) {
  const text = typeof content === "string" ? content : task.draft ?? "";
  if (!str(text)) throw new Error("채점할 글이 없어요.");
  const ev = await evalSource(db, task);
  const system = `수행평가 채점관. 안내문 평가 기준(criteria)과 [학교가 공개한 채점 기준표]로만 채점한다. 둘 다 없으면 4개(자료의 적절성, 분석·해석, 문제 해결, 논리적 표현) 각 25점.
채점 기준표가 있으면 요소마다 배점 · 단계별 기준 문장으로 판단하고 got 는 그 단계 점수로 준다.
조사·분석·통계·사례를 썼는데 출처가 없으면 자료·근거 기준에서 감점하고 tip 에 "출처 적기".
tip 은 "만점까지 몇 점 — 이렇게"로, 고칠 문장을 quote 에 원문 그대로 짧게.
엄격하게 채점한다. 만점은 그 요소의 최상위 기준 문장을 하나도 빠짐없이, 구체적인 근거와 함께 채웠을 때만 준다. 애매하면 한 단계 아래 점수.
이 글은 첫 초안이라 대부분 고칠 곳이 있다. 적어도 한 요소는 만점이 아니어야 하고, 만점이 아닌 요소마다 tip 을 꼭 쓴다. 칭찬만 하는 tip 은 금지.
json: {"items":[{"name":"","got":0,"max":0,"tip":"","quote":""}]}`;
  const r = await ai(system, `평가 기준: ${JSON.stringify(arr(task.analysis?.criteria))}\n학교가 공개한 채점 기준표: ${ev ? JSON.stringify({ 배점: ev.배점, 채점기준표: ev.채점기준표 }) : "(없음)"}\n감점: ${JSON.stringify(task.analysis?.penalties ?? [])}\n본문:\n${str(text, 20000)}`, 0.2);
  const items = arr(r.items).map((i: any) => ({ name: str(i.name, 60), got: Number(i.got) || 0, max: Number(i.max) || 0, tip: str(i.tip, 300), quote: str(i.quote, 200) })).filter((i: any) => i.name);
  const total = items.reduce((s: number, i: any) => s + i.got, 0);
  const sc = { total, max: items.reduce((s: number, i: any) => s + i.max, 0) || 100, items, at: new Date().toISOString() };
  const data = await save(db, task, { draft: text, score: sc });
  return { task: data };
}

// ---------- finalize: 세특 예상 문장 ----------
async function finalize(db: any, task: any, content?: string) {
  const text = typeof content === "string" && content.trim() ? content : task.draft ?? "";
  if (!str(text)) throw new Error("완성할 글이 없어요.");
  const system = `완성된 수행평가로 학교 선생님이 쓸 법한 세특(교과 세부능력 및 특기사항) 예상 문장을 만든다.
세특: 관찰자 시점, ~함/~임 체, 300~500자, 활동→역량→성장 순, 과장 금지, 본문에 없는 활동 금지.
json: {"setuk":""}`;
  const r = await ai(system, `과제: ${taskBrief(task)}\n최종 본문:\n${str(text, 20000)}`, 0.4);
  const data = await save(db, task, {
    draft: text,
    setuk_text: str(r.setuk, 1200),
    status: "done",
  });
  return { task: data };
}

// ---------- 발표 연습 (세움스피치 방식) ----------
// 발표 시간 — 안내문에 'N분'이 있으면 그 시간, 없으면 3분
function speechMinutes(task: any) {
  const an = task.analysis ?? {};
  const txt = [an.limits, an.format, an.overview, an.prompt, ...(arr(an.required)), task.title].map((x) => String(x ?? "")).join(" ");
  const m = txt.match(/(\d{1,2})\s*(?:~\s*\d{1,2}\s*)?분/);
  const n = m ? Number(m[1]) : 3;
  return n >= 1 && n <= 20 ? n : 3;
}
const SYL_PER_MIN = 280; // 발표에 알맞은 말 속도 (1분에 260~320음절)

async function speechScript(db: any, task: any) {
  if (!str(task.draft)) throw new Error("완성본이 먼저 있어야 발표 대본을 만들 수 있어요.");
  const minutes = speechMinutes(task);
  const system = `너는 세움스피치(면접 · 발표 코칭 학원)의 발표 코치다. 완성된 수행평가 글을 고등학생이 실제로 말할 발표 대본으로 바꾼다.
규칙:
- 발표 시간은 ${minutes}분. 대본 전체 글자 수(공백 빼고)는 약 ${minutes * SYL_PER_MIN}자 (1분에 ${SYL_PER_MIN}음절 기준). 넘치면 줄인다.
- 슬라이드별로 나눈다 (${Math.max(3, Math.min(8, minutes + 2))}장 안팎). title 은 슬라이드 제목 (15자 안쪽), say 는 그 장에서 그대로 말할 문장.
- 첫 장 첫 문장은 결론이나 질문으로 시작해 듣는 사람을 붙잡는다. 마지막 장은 핵심을 한 문장으로 다시 말하고 끝낸다.
- 말하는 문장: 짧게 (한 문장 40자 안쪽), "~입니다/~습니다" 발표체, 글말(~함, 및, 등)을 입말로 바꾼다. 숫자 · 출처는 완성본에 있는 것만.
- 말하기 표시 (세움스피치 대본 표기):
  · 멈춤: 짧게 쉴 곳 " /" (쉼표 자리 · 강조 낱말 앞), 길게 쉴 곳 " //" (핵심 주장 뒤 · 슬라이드 넘기기 전). 슬라이드마다 " /" 2~3곳, " //" 1곳.
  · 억양: 문장 끝에 " ↗"(상승조) 또는 " ↘"(하강조). 상승조 = 청중에게 묻는 문장 · 나열 중간 · 다음 내용이 이어질 때. 하강조 = 주장 · 결론 · 숫자를 말하고 끝낼 때. 모든 문장에 하나씩 붙인다.
  · 강조할 낱말은 **굵게** (슬라이드마다 1~2개).
- pace: 그 슬라이드 말 빠르기 "천천히" | "보통" | "빠르게". 천천히 = 핵심 주장 · 숫자 · 결론 · 첫인사. 빠르게 = 배경 설명 · 예시 나열 · 이미 아는 내용. pace_why 에 이유 한 줄.
- gaze: 그 슬라이드 시선 "Z자" | "M자" | "정면". Z자 = 교실 전체를 훑을 때 (시작 · 정리). M자 = 앞줄 · 뒷줄을 고루 볼 때 (설명 · 예시). 정면 = 핵심 한 문장을 한 사람에게 꽂을 때 (결론 · 질문).
- 채점 기준(전달력 · 발표 태도 등)이 있으면 그 기준을 채우는 쪽으로 쓴다.
- PPT 화면 (슬라이드마다 · 내용은 완성본에서만 가져온다 · 대본 문장을 그대로 옮기지 않고 화면용으로 줄인다):
  · head: 그 장의 핵심 메시지 한 줄 (30자 안쪽, 결론형 — 예: "계단은 넘을 수 없는 계급의 선").
  · layout: 내용에 맞는 화면 하나 — "bullets"(핵심 2~4개) | "big"(숫자 · 한 낱말을 크게) | "compare"(두 가지 비교) | "steps"(순서 · 과정 3~4단계) | "quote"(인용 · 정의 한 문장). 같은 layout 이 3장 넘게 이어지지 않게 섞는다.
  · items: bullets · steps 면 [{"label":"짧은 제목 12자","text":"설명 40자 안쪽"}] 2~4개, compare 면 정확히 2개 (왼쪽 · 오른쪽), quote 면 1개 (label=출처나 말한 사람).
  · big: layout 이 big 일 때 {"value":"숫자나 낱말 (10자 안쪽)","caption":"무슨 뜻인지 30자 안쪽"} — 완성본에 있는 숫자만.
  · image: 그 장에 넣을 시각 자료 {"what":"무엇을 보여 줄지 20자","search":"학생이 찾을 실제 검색어"}. 시각 자료가 필요 없는 장은 null. 안내문이 시각 자료(이미지 · 영상 · PPT)를 요구하면 절반 넘는 장에 넣는다.
- deck_title: PPT 표지 제목 (20자 안쪽, 과제 제목을 발표답게).
- sources: 완성본에 실제로 나온 출처만 그대로 (없으면 빈 배열). 지어내지 않는다.
- tips: 이 발표에서 꼭 지킬 것 3개 (시선 · 속도 · 강조 · 손 같은 실제 행동, 한 줄씩).
- questions: 발표가 끝나고 선생님 · 친구가 물을 만한 질문 2개와 답할 때 넣을 핵심(tip, 한 줄).
json: {"deck_title":"","slides":[{"title":"","say":"","pace":"천천히|보통|빠르게","pace_why":"","gaze":"Z자|M자|정면","head":"","layout":"bullets|big|compare|steps|quote","items":[{"label":"","text":""}],"big":{"value":"","caption":""},"image":{"what":"","search":""}}],"sources":[""],"tips":[""],"questions":[{"q":"","tip":""}]}`;
  const r = await ai(system, `과제: ${taskBrief(task)}\n채점 기준: ${JSON.stringify(arr(task.analysis?.criteria))}\n완성본:\n${str(task.draft, 12000)}`, 0.4);
  const pick = (v: unknown, ok: string[], d: string) => (ok.includes(String(v)) ? String(v) : d);
  const slides = arr(r.slides).map((x: any) => ({
    title: str(x?.title, 40), say: str(x?.say, 1500),
    pace: pick(x?.pace, ["천천히", "보통", "빠르게"], "보통"), pace_why: str(x?.pace_why, 80),
    gaze: pick(x?.gaze, ["Z자", "M자", "정면"], "Z자"),
    head: str(x?.head, 50),
    layout: pick(x?.layout, ["bullets", "big", "compare", "steps", "quote"], "bullets"),
    items: arr(x?.items).map((it: any) => ({ label: str(it?.label, 24), text: str(it?.text, 80) })).filter((it: any) => it.label || it.text).slice(0, 4),
    big: x?.big?.value ? { value: str(x.big.value, 16), caption: str(x.big.caption, 50) } : null,
    image: x?.image?.what ? { what: str(x.image.what, 40), search: str(x.image.search, 60) } : null,
  })).filter((x: any) => x.say).slice(0, 10);
  if (!slides.length) throw new Error("발표 대본을 만들지 못했어요.");
  const speech = {
    minutes,
    deck_title: str(r.deck_title, 40) || str(task.title, 40),
    sources: arr(r.sources).map((x: any) => str(x, 200)).filter(Boolean).slice(0, 8),
    slides,
    tips: arr(r.tips).map((x: any) => str(x, 120)).filter(Boolean).slice(0, 3),
    questions: arr(r.questions).map((x: any) => ({ q: str(x?.q, 160), tip: str(x?.tip, 200) })).filter((x: any) => x.q).slice(0, 2),
    attempts: arr(task.speech?.attempts),
    at: new Date().toISOString(),
  };
  const data = await save(db, task, { speech });
  return { task: data, speech };
}

// 숫자로 보는 것 — 시간 · 말 속도 · 군말 (음성 인식이라 '음 · 어'는 일부 빠질 수 있다)
function speechStats(text: string, seconds: number, minutes: number) {
  const syl = (text.match(/[가-힣]/g) ?? []).length + Math.round((text.match(/[a-zA-Z0-9]+/g) ?? []).length * 1.5);
  const sec = Math.max(1, Math.round(seconds));
  const spm = Math.round(syl / (sec / 60));
  const fillers = (text.match(/(^|\s)(음+|어+|그+|아+|저기|약간|뭔가|막|이제)(?=[\s,.]|$)/g) ?? []).length;
  const limit = minutes * 60;
  return { seconds: sec, syl, spm, fillers, limit, timeGap: sec - limit };
}

// 장마다 권장 시간 (대본 글자 수 · 1분 280음절) — 연습 화면이 보낸 장별 시간과 비교
const slideTarget = (say: unknown) => Math.max(8, Math.round(((String(say ?? "").replace(/\*\*|\/\/|\/|[↗↘]/g, "").match(/[가-힣a-zA-Z0-9]/g) ?? []).length / SYL_PER_MIN) * 60));
async function speechFeedback(db: any, task: any, transcript: unknown, seconds: unknown, slideTimes?: unknown) {
  const text = str(transcript, 6000);
  if ((text.match(/[가-힣]/g) ?? []).length < 20) throw new Error("말한 내용이 너무 짧아요. 대본을 소리 내어 끝까지 말해 봐요.");
  const sp = task.speech ?? {};
  const minutes = Number(sp.minutes) || speechMinutes(task);
  const st = speechStats(text, Number(seconds) || 0, minutes);
  const prev = arr(sp.attempts).at(-1) ?? null;
  // 장별 시간 (연습 화면에서 왔을 때만)
  const times = arr(slideTimes).map((x: any) => Math.max(0, Math.round(Number(x) || 0)));
  const slides = times.length ? arr(sp.slides).map((x: any, i: number) => ({ no: i + 1, title: str(x?.title, 30), sec: times[i] ?? 0, target: slideTarget(x?.say) })).filter((x: any) => x.sec > 0) : [];
  const system = `너는 세움스피치(면접 · 발표 코칭 학원) 발표 코치다. 학생이 발표 대본을 보고 실제로 말한 것(음성 인식 글)과 숫자를 보고 코칭한다.
세움스피치 피드백 순서 D-R-R-P:
- diag(진단): 이번 연습에서 가장 먼저 고칠 것 딱 하나. 지적에서 멈추지 않는다.
- why(이유): 그게 왜 점수(채점 기준)나 듣는 사람에게 손해인지 한 문장.
- fix_before / fix_after(수정): 학생이 실제로 말한 문장 하나를 그대로 옮기고(fix_before), 이렇게 말하면 된다는 고친 문장(fix_after). 학생이 말한 글에 없는 문장을 fix_before 로 지어내지 않는다.
- practice(연습): 다음 연습 한 번에서 할 행동 하나. 대본 표시(멈춤 / · //, 상승조 ↗ · 하강조 ↘, 슬라이드 빠르기, 시선 Z자 · M자 · 정면)를 짚어 말한다 (예: "2장 '계급을 말합니다 //'에서 2초 쉬고 하강조로 끝내기").
그 밖:
- good: 잘한 점 하나 (구체적으로, 실제로 말한 내용에서).
- missed: 대본의 슬라이드 중 말하지 않았거나 크게 빠진 슬라이드 제목 (없으면 빈 배열).
- 숫자 판단은 서버가 준 숫자만 쓴다. 음성 인식이라 띄어쓰기 · 맞춤법 · 군말은 정확하지 않을 수 있으니 맞춤법은 지적하지 않는다.
- 쉬운 말 "~해요"체. 칭찬만 하지 않는다.
json: {"good":"","diag":"","why":"","fix_before":"","fix_after":"","practice":"","missed":[""]}`;
  const r = await ai(system, `과제: ${taskBrief(task)}\n채점 기준: ${JSON.stringify(arr(task.analysis?.criteria))}\n발표 시간 ${minutes}분\n숫자: ${JSON.stringify({ 걸린시간초: st.seconds, 제한초: st.limit, 말속도_1분음절: st.spm, 알맞은속도: "260~320", 군말: st.fillers })}\n장별 시간(초 · 권장): ${slides.length ? JSON.stringify(slides.map((x: any) => `${x.no}장 ${x.title} ${x.sec}초/권장 ${x.target}초`)) : "(없음)"}\n지난 연습: ${prev ? JSON.stringify({ 걸린시간초: prev.seconds, 말속도: prev.spm, 군말: prev.fillers, 진단: prev.diag }) : "(처음)"}\n대본: ${JSON.stringify(arr(sp.slides))}\n학생이 말한 것: ${text}`, 0.3);
  const fb = {
    good: str(r.good, 300), diag: str(r.diag, 300), why: str(r.why, 300),
    fix_before: str(r.fix_before, 300), fix_after: str(r.fix_after, 300), practice: str(r.practice, 300),
    missed: arr(r.missed).map((x: any) => str(x, 40)).filter(Boolean).slice(0, 4),
  };
  const attempt = { at: new Date().toISOString(), seconds: st.seconds, spm: st.spm, fillers: st.fillers, diag: fb.diag };
  const data = await save(db, task, { speech: { ...sp, minutes, attempts: [...arr(sp.attempts), attempt].slice(-5) } });
  return { task: data, stats: { ...st, slides }, prev, feedback: fb };
}

// ---------- make: 딸깍 — 가이드(없으면) → 초안 → 채점 → 세특 예상 문장 ----------
async function make(db: any, task: any, formatKey?: string) {
  if (!str(task.guide)) task = (await guide(db, task)).task;
  task = (await draft(db, task, formatKey)).task;
  task = (await score(db, task)).task;
  return finalize(db, task);
}

// ---------- 자료 찾기 (비커스 · 생수면 탐구보고서와 같은 방식) — 웹 검색 → 링크 확인 → 본문 읽고 점수 ----------
const SEARCH_MODEL = "gpt-4.1";

async function pageText(url: string) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(url, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!r.ok || !String(r.headers.get("content-type") ?? "").includes("html")) return { ok: false, text: "" };
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    return { ok: text.length > 200, text };
  } catch {
    return { ok: false, text: "" };
  }
}

async function searchSection(task: any, ctx: any, section?: string) {
  const sec = arr(task.reco?.perSection).find((p: any) => p.section === section);
  const target = section ? `${section}${sec?.tip ? ` — ${str(sec.tip, 300)}` : ""}` : str(task.analysis?.overview, 300);

  const prompt = `고등학생 수행평가에 쓸 실제 자료를 웹에서 찾아라.
수행평가: ${task.title} (${task.subject ?? ""} · ${task.task_type ?? ""})
과제 내용: ${str(task.analysis?.prompt || task.analysis?.overview, 600)}
이번에 자료가 필요한 항목: ${target}
학생 진로 초점: ${JSON.stringify(ctx.focus)}
방법:
1) 항목을 쪼개 검색어 4~6개를 만든다 (핵심 개념, 사례 대상, 통계 이름, '보도자료·통계·보고서' 같은 말을 섞는다)
2) 검색어마다 따로 검색해 후보를 모은다
조건:
- 반드시 웹 검색으로 실제로 열어 확인한 자료만. 기억으로 제목을 만들지 않는다
- 한국어 자료 우선: 정부·공공기관, 통계(KOSIS·한국은행 등), 신문사, 국내 논문 사이트, 교육 자료. 필요하면 영어 1~2개
- 주제와 직접 관련 있고 구체적 근거(수치·기준·사례)가 있는 자료 우선
- 후보 8~10개, 요약은 그 자료에 실제로 쓰인 내용만 쉬운 말 두 문장
마지막에 아래 JSON만 출력:
{"sources":[{"title":"자료 제목","url":"https://...","publisher":"발행처","kind":"논문|기사|공식자료|통계|보고서|기타","summary":"두 문장 요약"}]}`;

  const call = (tool: string) =>
    fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: SEARCH_MODEL, tools: [{ type: tool }], include: ["web_search_call.action.sources"], input: prompt, max_output_tokens: 6000 }),
    });
  let res = await call("web_search");
  if (res.status === 400) res = await call("web_search_preview"); // 계정에 따라 도구 이름이 다름
  const body = await res.json().catch(() => null);
  await logUsage(SEARCH_MODEL, body?.usage?.input_tokens ?? 0, body?.usage?.output_tokens ?? 0, res.ok);
  if (!res.ok || !body) throw new Error("자료를 찾지 못했어요. 잠시 후 다시 해 주세요.");

  // 답변 + 실제로 본 링크
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  let text = "";
  const seen = new Set<string>();
  for (const item of body.output ?? []) {
    if (item.type === "web_search_call") for (const s2 of item.action?.sources ?? []) if (s2?.url) seen.add(norm(s2.url));
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text") continue;
      text += c.text ?? "";
      for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) seen.add(norm(a.url));
    }
  }
  let parsed: any = null;
  try {
    const m = text.match(/\{[\s\S]*"sources"[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch { parsed = null; }
  const uniq = new Map<string, any>();
  for (const x of parsed?.sources ?? []) if (x?.url && x?.title && /^https?:\/\//.test(x.url) && !uniq.has(norm(x.url))) uniq.set(norm(x.url), x);
  const list = [...uniq.values()].slice(0, 10);

  // 실제로 본 링크이거나, 서버가 열어 봐서 열리는 링크만
  const checked = await Promise.all(list.map(async (x: any) => {
    const u = norm(x.url);
    if ([...seen].some((c) => c === u || c.startsWith(u) || u.startsWith(c))) return x;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(x.url, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
      clearTimeout(t);
      return r.status < 400 ? x : null;
    } catch { return null; }
  }));
  const verified = checked.filter(Boolean) as any[];
  if (!verified.length) return [];

  // 본문 읽고 점수 매기기
  const pages = await Promise.all(verified.map((x) => pageText(x.url)));
  const judged = await ai(
    `고등학생 수행평가에 쓸 자료 후보를 평가한다. [본문]이 있으면 본문 기준으로만 판단하고 요약도 본문 내용으로 고친다. 모르면 낮게 준다. 쉬운 말.
점수(각 0~3): same 항목과 직접 관련 / trust 공공기관·학술지·언론처럼 믿을 만한 출처 / detail 구체적 근거(수치·기준·사례) / level 고등학생이 읽을 수 있는 수준
json: {"items":[{"i":1,"same":0,"trust":0,"detail":0,"level":0,"summary":"본문 기준 두 문장","use":"이 항목에서 어떻게 쓸지 한 줄"}]}`,
    `항목: ${target}\n\n${verified.map((x, i) => `[후보 ${i + 1}] ${x.title} (${x.publisher ?? ""})\n[요약] ${x.summary ?? ""}\n[본문] ${pages[i]?.ok ? pages[i].text.slice(0, 2500) : "(읽지 못함)"}`).join("\n\n")}`,
    0.2,
  );
  const n = (v: any) => Math.max(0, Math.min(3, Number(v) || 0));
  const scored = verified.map((x, i) => {
    const j = arr(judged?.items).find((y: any) => Number(y.i) === i + 1) ?? {};
    return {
      id: crypto.randomUUID(),
      section: section ?? "",
      title: str(x.title, 200),
      url: str(x.url, 500),
      publisher: str(x.publisher, 80),
      kind: str(x.kind, 20),
      summary: str(pages[i]?.ok && j.summary ? j.summary : x.summary, 400),
      use: str(j.use, 200),
      score: n(j.same) + n(j.trust) + n(j.detail) + n(j.level),
      checked: pages[i]?.ok ? "body" : "link", // body = 서버가 본문을 읽고 요약을 맞춤
      selected: false,
    };
  }).sort((a, b) => b.score - a.score);
  let good = scored.filter((x) => x.score >= 6);
  if (good.length < 3) good = scored.slice(0, 3);
  return good.slice(0, 5);
}


// ---------- server ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!OPENAI_KEY) return json({ error: "OPENAI_API_KEY가 설정되지 않았어요." }, 500);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: "로그인하면 수행평가 완성을 쓸 수 있어요", need_login: true }, 401);
    DB = db; UID = user.id;

    const { action, taskId, content, format, quick, transcript, seconds, slideTimes } = await req.json().catch(() => ({}));
    if (!taskId) return json({ error: "과제 번호가 없어요." }, 400);
    const { data: task } = await db.from("school_tasks").select("*").eq("id", Number(taskId)).eq("user_id", user.id).maybeSingle();
    if (!task) return json({ error: "과제를 찾을 수 없어요." }, 404);

    // 1년 이용권(또는 관리자)인지
    const paid = (await hasPass(db, user.id)) || Boolean((await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()).data);
    if (PAID_ACTIONS.has(action) && !paid) return json({ paywall: true, error: PAYWALL }, 402);
    // 무료는 과제 3개까지 분석 (이미 분석한 과제는 다시 분석해도 됨)
    if (action === "analyze" && !paid && task.status === "draft") {
      const { count } = await db.from("school_tasks").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "draft");
      if ((count ?? 0) >= FREE_TASKS) return json({ paywall: true, error: `무료로는 수행평가 ${FREE_TASKS}개까지 분석할 수 있어요. 1년 이용권이면 개수 제한 없이 초안 · 채점까지 끝까지 해요.` }, 402);
    }

    let out: any;
    switch (action) {
      case "analyze":  out = await analyze(db, task); break;
      case "qa":       out = await nextQuestion(db, task); break;
      case "guide":    out = await guide(db, task); break;
      case "formats":  out = formatList(task); break;
      case "make":     out = await make(db, task, format); break;
      case "draft":    out = await draft(db, task, format, quick === true); break;
      case "score":    out = await score(db, task, content); break;
      case "finalize": out = await finalize(db, task, content); break;
      case "speech_script": out = await speechScript(db, task); break;
      case "speech_fb":     out = await speechFeedback(db, task, transcript, seconds, slideTimes); break;
      default: return json({ error: `모르는 action: ${action}` }, 400);
    }
    return json({ success: true, paid, ...out });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});