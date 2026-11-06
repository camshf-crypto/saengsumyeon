// agent/tamgu.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { clean, logUsage, openai } from "./core.ts";
import { deptOf } from "./plan.ts";
import { gradeOf, schoolMeta, termNow } from "./school.ts";
import { shCall, shFirstQuestion, shPaywall, shSafe, shSave } from "./suhaeng.ts";
import { TOPIC_QUOTA_MSG, formatCheck, passOrAdmin, pick, runTool } from "./tools.ts";
import { nonAnswer } from "./router.ts";


/* ───────── 탐구 설계 — 탐구주제 흔한가 진단 → 학년 · 이전 활동 맞춤 3개 설계 → (고르면) 수행평가와 같은 흐름 ─────────
 * 아는 건 다시 묻지 않는다: 진단에 쓴 학과 · 과목 · 주제 · 진단 결과 · 가입 학년을 그대로 이어받는다
 * 고1: 바로 설계 · 고2: 고1 활동과 이을지 · 고3: 고1 · 고2 활동을 심화할지 — 기록이 있으면 그 활동을 보기로 먼저 보여 준다
 * 상태: tp_need(주제 · 과목 받기) → tp_grade(학년) → tp_link(이을지) → tp_pick(3개 중 고르기) → analyzed(질문부터 수행평가와 같음)
 * school_tasks.analysis.kind = "topic" · 끝낸 탐구는 다음 학년 설계 때 '이어 가기' 후보가 된다
 */
export const TP_START = /탐구\s*(주제)?\s*(설계|디자인)|탐구\s*보고서\s*(써|쓰|만들|완성|작성|하자|할래)|그 탐구주제로 보고서|탐구\s*주제\s*(찾아|추천)|탐구\s*주제\s*(로|를|는)?\s*(할래|하자|할게|정했|해\s*볼래|시작)|(이걸로|이거로|이\s*주제로)\s*(탐구|할래|하자|할게)|탐구\s*(시작|하자|할래|해\s*보자)/;
// '탐구' 이야기면 탐구 설계로 — 수행평가 · 흔한가 진단 요청 · 카드 답 · 입력 카드("학과: … 탐구주제: …")는 빼고
export const TP_CARD = /(학과|과목|탐구\s*주제|지원\s*동기|책\s*제목|대학)\s*[:：=]/;
export const TP_INTENT = (m: string) =>
  /탐구/.test(m) && !TP_CARD.test(m) && !/수행\s*평가/.test(m) && !/흔한가|흔한지|진단/.test(m) && !/^\[\[|→/.test(m) &&
  (TP_START.test(m) || m.replace(/\s/g, "").length <= 40 ||
    /(해\s*줘|해야|하고\s*싶|써야|쓰고\s*싶|준비|도와|할래|하자|할게|시작|정했|추천|찾아|골라|설계|디자인|써\s*줘|작성|만들|어떻게|뭐\s*하지|뭘\s*하지)/.test(m));
// '아까 그거 · 기존꺼 그대로' — 대화에서 이미 이야기한 주제를 쓰자는 말
export const TP_PREV = /기존|아까|그대로|이야기한|얘기한|방금|위에\s*(거|것)|그\s*주제|그거로|그걸로|이전\s*(거|것)/;

// 대화에서 이미 이야기한 탐구주제 찾기 — 최근 대화 8개를 짧게 읽는다 (회사 비용 · 학생 사용량에 안 들어감)
export async function tpTopicFromChat(db: any, uid: string, history: any[]) {
  const recent = (history ?? []).slice(-8).map((m: any) => `${m.role === "user" ? "학생" : "물꼬"}: ${String(m.content ?? "").replace(/\[\[[^\]]*\]\]/g, "").slice(0, 1200)}`).join("\n");
  if (!/탐구|실험|주제/.test(recent)) return null;
  const res = await openai({
    model: "gpt-5-mini", max_completion_tokens: 800, reasoning_effort: "minimal", response_format: { type: "json_object" },
    messages: [
      { role: "system", content: '대화에서 학생이 고르거나 하겠다고 한 탐구주제 하나를 찾는다. 물꼬가 여러 개를 제안했으면 학생이 고른 것(예: "1번")만. 학생이 아직 고르지 않았으면 topic 은 "". JSON: {"topic":"40~70자 탐구주제","subject":"과목(없으면 빈칸)","dept":"학과(없으면 빈칸)"}' },
      { role: "user", content: recent },
    ],
  }).catch(() => null);
  if (!res) return null;
  let out: any = null, inT = 0, outT = 0;
  try { const j = await res.json(); inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0); out = JSON.parse(j.choices?.[0]?.message?.content ?? ""); } catch { /* 무시 */ }
  await logUsage(db, uid, inT, outT, Boolean(out), "agent_mem");
  const topic = clean(out?.topic, 120);
  return topic.length >= 6 ? { topic, subject: clean(out?.subject, 30), dept: clean(out?.dept, 30) } : null;
}
// 학생이 주제를 같이 적었는지 — 시작 말이 아닌 줄 중 가장 긴 것 (따옴표 안이 있으면 그것)
export function tpTopicIn(msg: string) {
  const q = msg.match(/["'“‘「](.{6,120}?)["'”’」]/)?.[1];
  if (q) return clean(q, 120);
  const lines = msg.split(/\n+/).map((x) => x.trim()).filter((x) => x.length >= 8 && !TP_START.test(x) && !TP_INTENT(x) && !/^(야|음|그럼)\s/.test(x) && !/^[가-힣 ()]{1,12}\s*[:：]/.test(x) && !/^탐구\s*(주제|보고서)?\s*\S{0,8}$/.test(x));
  return clean(lines.sort((a, b) => b.length - a.length)[0] ?? "", 120);
}
export const TP_FROM_DIAG = /^(?:이 주제로 뭘 할까|이제 뭘 할까)\?\s*→\s*(이 주제로|바꾼 주제로|추천 주제로|내 주제로) 탐구/;
export const TP_METHOD: Record<string, string> = { experiment: "실험", survey: "설문", review: "문헌 조사", analysis: "통계 분석", case: "사례", project: "제작", inquiry: "탐구" };
export const tpPrev = (g: number) => (g >= 3 ? "고1 · 고2" : "고1");

export async function tpStart(db: any, uid: string, meta: any, msg: string, t: any, token = "", emit: (s: string) => void = () => {}, history: any[] = []) {
  if (t) await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
  const { school } = await schoolMeta(db, uid, meta);
  const grade = await gradeOf(db, uid, meta).catch(() => "");
  const mon = termNow().month;
  // 바로 전 탐구주제 흔한가 진단 (2주 안) — 학과 · 과목 · 주제 · 결과를 그대로 이어받는다
  const fromDiag = TP_FROM_DIAG.exec(msg);
  const given = fromDiag ? "" : tpTopicIn(msg);
  if (given) return tpStartGiven(db, uid, meta, given, t);
  const useDiag = fromDiag || /그 탐구주제|이 주제|진단한 주제/.test(msg);
  const { data: dq } = useDiag
    ? await db.from("topic_queries").select("id,department,grade,subject,topic,score,result,created_at").eq("user_id", uid).gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const better = clean(dq?.result?.suggestion?.topic, 120);
  const topic = /^(바꾼|추천) 주제로$/.test(fromDiag?.[1] ?? "") && better ? better : clean(dq?.topic, 120);
  const gnum = Number(String(grade || dq?.grade || "").match(/[123]/)?.[0] ?? 0);
  const origin = dq ? { query_id: dq.id, topic, score: dq.score, reason: clean(dq.result?.reason, 300), better } : null;
  const base: any = {
    user_id: uid, school: school || null, grade: gnum ? `고${gnum}` : null, semester: mon >= 3 && mon <= 8 ? 1 : 2, in_chat: true,
    status: dq ? (gnum ? "tp_direct" : "tp_grade") : "tp_need", subject: clean(dq?.subject, 30) || null, title: topic || "탐구",
    task_type: "보고서", analysis: { kind: "topic", origin, dept: clean(dq?.department, 30), ...(dq ? { direct: true, go: true, picked: { title: topic } } : {}) },
  };
  const { data: nt, error } = await db.from("school_tasks").insert(base).select().single();
  if (!nt) { console.error("tp insert", error); return `탐구 설계를 시작하지 못했어. 잠시 뒤 다시 해 줘. (${clean(error?.message, 80)})`; }
  if (!dq) {
    // 이 대화(또는 바로 전 대화)에서 이미 고른 주제가 있으면 — '기존꺼 그대로'면 바로, 아니면 보기 맨 앞에
    const prev = (t?.analysis?.recent?.topic ? t.analysis.recent : null) ?? (await tpTopicFromChat(db, uid, history).catch(() => null));
    if (prev && TP_PREV.test(msg)) return tpUseRecent(db, nt, prev, token, emit);
    if (/추천|찾아|골라|뭐\s*하지|뭘\s*하지/.test(msg) && !prev) return tpRecoNow(db, uid, meta, nt, token, emit);
    await shSave(db, nt, { status: "tp_how", analysis: { ...(nt.analysis ?? {}), recent: prev } });
    return `탐구는 **네가 하고 싶은 주제를 깊게** 하는 거야. 먼저 주제를 어떻게 정할지 골라 줘.\n\n${tpHowQ(prev)}`;
  }
  // 진단에서 고른 주제 — 이미 정했으니 바로 질문으로 (학년을 모르면 학년만)
  if (!gnum) return `**${clean(topic, 80)}**로 탐구를 할게. 먼저 몇 학년이야? (학년마다 깊이가 달라)\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]`;
  return tpGo(db, nt, token, emit);
}
export const tpHowQ = (prev: any = null) => `[[질문: 탐구주제를 어떻게 정할까? | ${[
  prev?.topic ? `이야기한 주제로 — ${shSafe(prev.topic, 70)}` : "",
  "내 주제로 바로 — 하고 싶은 주제를 적으면 그걸 깊게",
  "흔한가 진단 먼저 — 진단 보고 내 주제 · 바꾼 주제 중 고르기",
  "주제 추천 받기 — 아직 주제가 없어요",
].filter(Boolean).join(" | ")}]]`;
export const TP_HOW_Q = tpHowQ();
// 대화에서 고른 주제로 바로 — 과목 · 학과도 대화에서 가져온다
export async function tpUseRecent(db: any, t: any, prev: any, token: string, emit: (s: string) => void) {
  t = await shSave(db, t, {
    title: clean(prev.topic, 120), subject: prev.subject || t.subject || null,
    analysis: { ...(t.analysis ?? {}), mode: "mine", dept: prev.dept || t.analysis?.dept || "", origin: { topic: clean(prev.topic, 120) }, picked: { title: clean(prev.topic, 120) } },
  });
  if (!t.grade) { await shSave(db, t, { status: "tp_grade", analysis: { ...(t.analysis ?? {}), direct: true, go: true } }); return `**${clean(prev.topic, 80)}**로 할게. 몇 학년이야? (학년마다 깊이가 달라)\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]`; }
  return tpGo(db, t, token, emit);
}
// '주제 추천 받기' — 더 묻지 않고 바로 3개 (2026-11-06)
//   희망 학과 · 학년 · 생기부 노트 · 끝낸 수행평가 · 탐구 · 지난 흔한가 진단을 school_task 'design' 이 다 읽고 설계한다
//   이어 갈지 · 새로 할지도 물꼬가 판단(link: auto) · 흔한가 진단은 다시 돌리지 않는다
export async function tpRecoNow(db: any, uid: string, meta: any, t: any, token: string, emit: (s: string) => void) {
  const [dept, grade] = await Promise.all([deptOf(db, uid, meta).catch(() => ""), gradeOf(db, uid, meta).catch(() => "")]);
  const gnum = Number(String(grade || t.grade || "").match(/[123]/)?.[0] ?? 0);
  t = await shSave(db, t, {
    status: "tp_link", grade: gnum ? `고${gnum}` : t.grade, title: "관심 분야 탐구",
    analysis: { ...(t.analysis ?? {}), mode: "reco", dept: t.analysis?.dept || dept || "", link: "auto", link_from: "" },
  });
  emit("지금까지 한 활동 · 진단 · 희망 학과를 보고 탐구주제 3개 찾는 중");
  return tpDesign(db, t, token, emit);
}
export async function tpRecoForm(db: any, uid: string, meta: any, t: any) {
  await shSave(db, t, { status: "tp_need", analysis: { ...(t.analysis ?? {}), mode: "reco" } });
  const d = await deptOf(db, uid, meta);
  return `학과 · 과목을 적어 줘. 학년 · 이전 활동에 맞춰 주제 3개를 설계해 줄게.\n\n[[입력: 탐구 설계 시작 | ${d ? `학과=${d}` : "학과"} | 과목]]`;
}
// 주제가 정해졌으면 바로 질문 4~5개 (설계 3개 없이)
export async function tpGo(db: any, t: any, token: string, emit: (s: string) => void) {
  const d = t.analysis?.picked ?? { title: t.title };
  const txt = `${t.title} ${d.how ?? ""}`;
  const format = TP_METHOD[d.method] ?? (/실험|측정/.test(txt) ? "실험" : /설문|인터뷰/.test(txt) ? "설문" : /통계|자료|비교/.test(txt) ? "통계 분석" : "탐구");
  t = await shSave(db, t, { status: "analyzed", analysis: { ...(t.analysis ?? {}), direct: true, picked: d, summary: clean(d.how || d.why, 300), format, overview: clean(d.why, 200) } });
  return shFirstQuestion(t, token, emit);
}
export const tpDiagForm = async (db: any, uid: string, meta: any, topic = "", subject = "") => {
  const d = await deptOf(db, uid, meta);
  return `주제를 적고 보내면 흔한가 진단을 해 줄게. 결과를 보고 **내 주제 그대로** 할지, **덜 흔하게 바꾼 주제**로 할지 고르면 돼.\n\n[[입력: 탐구주제 흔한가 진단 | ${d ? `학과=${d}` : "학과"} | ${subject ? `과목=${shSafe(subject, 30)}` : "과목"} | ${topic ? `탐구주제=${shSafe(topic, 120)}` : "탐구주제"}]]`;
};

// 진단 결과 카드 '다른 주제 진단하기'에 새 주제를 같이 적어 보냈을 때 — 입력 카드를 다시 띄우지 않고 바로 진단한다
//   학과 · 과목은 바로 전 진단(topic_queries)에서 이어받는다. 없으면 주제를 채운 입력 카드
export async function tpDiagNow(db: any, uid: string, meta: any, topic: string, token: string) {
  const { data: last } = await db.from("topic_queries").select("department,subject,grade").eq("user_id", uid).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const dept = clean(last?.department, 40) || (await deptOf(db, uid, meta));
  const subject = clean(last?.subject, 40);
  const tp = clean(topic, 100);
  if (!dept || !subject) return `과목만 채우면 바로 진단해요.\n\n[[입력: 탐구주제 흔한가 진단 | ${dept ? `학과=${shSafe(dept, 30)}` : "학과"} | 과목 | 탐구주제=${shSafe(tp, 100)}]]`;
  const paid = await passOrAdmin(db, uid);
  const args = { department: dept, subject, topic: tp, grade: clean(last?.grade, 3) };
  const out: any = await runTool(db, uid, "check_topic", args, token, paid).catch(() => null);
  if (out?.quota_exceeded) return TOPIC_QUOTA_MSG;
  if (out && typeof out.score === "number") return formatCheck("topic", out, { ...args, __paid: paid });
  if (out?.invalid) return `${clean(out.reason, 160) || "탐구주제로 읽기 어려워요."}\n\n[[입력: 탐구주제 흔한가 진단 | 학과=${shSafe(dept, 30)} | 과목=${shSafe(subject, 30)} | 탐구주제]]`;
  return `${clean(out?.error, 80) || "진단하지 못했어요. 잠시 뒤 다시 해 주세요"}\n\n[[입력: 탐구주제 흔한가 진단 | 학과=${shSafe(dept, 30)} | 과목=${shSafe(subject, 30)} | 탐구주제=${shSafe(tp, 100)}]]`;
}

// 학생이 주제를 정해서 왔을 때 — 같은 주제의 진단 · 지난 설계에서 학과 · 과목을 찾아 이어받고, 그대로 할지 3개 설계를 받을지 묻는다
export async function tpStartGiven(db: any, uid: string, meta: any, topic: string, t: any) {
  if (t) await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
  const key = (x: unknown) => String(x ?? "").replace(/[\s·.,]/g, "");
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const [{ data: qs }, { data: ts }] = await Promise.all([
    db.from("topic_queries").select("id,department,grade,subject,topic,score,result,created_at").eq("user_id", uid).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
    db.from("school_tasks").select("subject,grade,title,analysis,updated_at").eq("user_id", uid).order("updated_at", { ascending: false }).limit(20),
  ]);
  const dq = (qs ?? []).find((q: any) => key(q.topic) === key(topic) || key(q.result?.suggestion?.topic) === key(topic));
  const prev = (ts ?? []).find((x: any) => x.analysis?.kind === "topic" && (key(x.title) === key(topic) || (x.analysis?.designs ?? []).some((d: any) => key(d.title) === key(topic))));
  const picked = (prev?.analysis?.designs ?? []).find((d: any) => key(d.title) === key(topic)) ?? null;
  const { school } = await schoolMeta(db, uid, meta);
  const grade = await gradeOf(db, uid, meta).catch(() => "");
  const gnum = Number(String(grade || dq?.grade || prev?.grade || "").match(/[123]/)?.[0] ?? 0);
  const mon = termNow().month;
  const an: any = {
    kind: "topic", direct: true, dept: clean(dq?.department ?? prev?.analysis?.dept, 30) || (await deptOf(db, uid, meta)),
    origin: dq ? { query_id: dq.id, topic: clean(dq.topic, 120), score: dq.score, reason: clean(dq.result?.reason, 300), better: clean(dq.result?.suggestion?.topic, 120) } : prev?.analysis?.origin ?? { topic },
    picked: picked ?? { title: topic },
  };
  const { data: nt, error } = await db.from("school_tasks").insert({
    user_id: uid, school: school || null, grade: gnum ? `고${gnum}` : null, semester: mon >= 3 && mon <= 8 ? 1 : 2, in_chat: true,
    status: gnum ? "tp_direct" : "tp_grade", subject: clean(dq?.subject ?? prev?.subject, 30) || null, title: topic, task_type: "보고서", analysis: an,
  }).select().single();
  if (!nt) return `탐구를 시작하지 못했어. 잠시 뒤 다시 해 줘. (${clean(error?.message, 80)})`;
  if (!gnum) return `**${clean(topic, 80)}**로 탐구를 할게. 먼저 몇 학년이야? (학년마다 깊이가 달라)\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]`;
  return tpDirectCard(nt);
}
export const tpDirectCard = (t: any) =>
  `좋아, **${clean(t.title, 90)}**${t.subject ? ` (${clean(t.subject, 20)})` : ""}로 탐구를 할게.\n이 주제 그대로 깊게 할지, 흔한가 진단을 먼저 받아 보고 정할지 골라 줘.\n\n[[질문: 이 주제로 어떻게 할까? | 이 주제 그대로 시작 — 질문 4~5개로 깊게 | 흔한가 진단 먼저 — 흔하면 덜 흔하게 바꾼 주제도 받기]]`;

// 이전 학년 활동 — 생기부 노트 · 탐구 보고서 · 끝낸 수행평가 · 탐구 (지금 학년보다 앞선 것만)
export async function tpEarlier(db: any, uid: string, g: number) {
  const [acts, inq, done] = await Promise.all([
    db.from("record_activities").select("grade,subject,title").eq("user_id", uid).order("created_at", { ascending: false }).limit(60),
    db.from("inquiries").select("grade,subject,topic").eq("user_id", uid).order("created_at", { ascending: false }).limit(20),
    db.from("school_tasks").select("grade,subject,title").eq("user_id", uid).eq("status", "done").order("updated_at", { ascending: false }).limit(20),
  ]);
  const gn = (x: unknown) => Number(String(x ?? "").match(/[123]/)?.[0] ?? 0);
  const all = [
    ...(done.data ?? []).map((r: any) => ({ g: gn(r.grade), subject: clean(r.subject, 16), title: clean(r.title, 40) })),
    ...(inq.data ?? []).map((r: any) => ({ g: gn(r.grade), subject: clean(r.subject, 16), title: clean(r.topic, 40) })),
    ...(acts.data ?? []).map((r: any) => ({ g: gn(r.grade), subject: clean(r.subject, 16), title: clean(r.title, 40) })),
  ].filter((x) => x.title && x.g && x.g < g);
  const seen = new Set<string>();
  return all.filter((x) => (seen.has(x.title) ? false : (seen.add(x.title), true)));
}

export async function tpLinkQuestion(db: any, uid: string, t: any) {
  const g = Number(String(t.grade ?? "").match(/[123]/)?.[0] ?? 0);
  // 주제를 고르기 전에 묻는 질문 — 이어 갈 활동이 정해져야 그 위에 주제 3개를 설계한다
  const head = `탐구주제를 고르기 전에 방향부터 정하자. 고${g}${t.subject ? ` · ${clean(t.subject, 20)}` : ""}${t.analysis?.dept ? ` · ${clean(t.analysis.dept, 20)}` : ""}에 맞춰 주제 3개를 설계해 줄게.`;
  if (g <= 1) {
    await shSave(db, t, { status: "tp_link", analysis: { ...(t.analysis ?? {}), link: "auto" } });
    return `${head} 고1은 계열을 넓게 보면서 교과서 개념으로 할 수 있게 설계해.\n\n[[질문: 어떤 쪽으로 설계할까? | 물꼬가 골라 줘 — 학과 · 과목으로 3개 | 내 관심사도 넣을래 — 카드 아래 칸에 한 줄로]]`;
  }
  const items = (await tpEarlier(db, uid, g)).slice(0, 3);
  await shSave(db, t, { status: "tp_link", analysis: { ...(t.analysis ?? {}), link_items: items } });
  const why = g >= 3 ? "고3은 앞선 탐구에서 풀지 못한 것을 심화하면 전공 적합성이 가장 잘 보여." : "고2는 고1 활동을 한 단계 깊게 이으면 생기부 흐름이 생겨.";
  if (!items.length) {
    return `${head}\n${why} 그런데 생수면에 ${tpPrev(g)} 기록이 아직 없어. ${tpPrev(g)} 때 한 탐구 · 활동이 있으면 카드 아래 칸에 한 줄로 적어 줘 (예: 고1 통합과학 · 구리 산화 실험).\n\n[[질문: ${tpPrev(g)} 때 한 활동과 이어 갈까? | 새로운 분야로 — 이전 활동 없이 시작 | 물꼬가 골라 줘 — 진단 결과 · 학과로 설계]]`;
  }
  return `${head}\n${why} 생수면 기록에서 이어 갈 만한 걸 찾았어.\n\n[[질문: ${tpPrev(g)} 때 한 활동과 이어 갈까? | ${[
    ...items.map((x) => `이어 가기: ${shSafe(x.title, 40)} — 고${x.g}${x.subject ? ` · ${shSafe(x.subject, 14)}` : ""}`),
    "새로운 분야로 — 이전 활동과 따로",
    "물꼬가 골라 줘 — 이어 갈지 판단해 줄게",
  ].join(" | ")}]]`;
}

export async function tpDesign(db: any, t: any, token: string, emit: (s: string) => void) {
  emit("학년 · 이전 활동 · 진단 결과로 탐구 3개 설계하는 중 (20초쯤)");
  const r: any = await shCall("design", t.id, token);
  if (r?.paywall) return shPaywall(r);
  if (r?.error || !r?.designs?.length) return `탐구를 설계하지 못했어. ${clean(r?.error, 120)}\n\n[[질문: 어떤 탐구로 할까? | 다시 설계 — 한 번 더]]`;
  await shSave(db, r.task ?? t, { status: "tp_pick" });
  const list = r.designs.map((d: any, i: number) =>
    [`**${i + 1}. [${clean(d.type, 8)}] ${clean(d.title, 90)}**`, d.why ? `왜 너에게: ${clean(d.why, 160)}` : "", d.how ? `어떻게: ${clean(d.how, 200)}` : "", d.from ? `이어지는 활동: ${clean(d.from, 60)}` : ""].filter(Boolean).join("\n")).join("\n\n");
  return `맞춤으로 3개를 설계했어.${r.decision ? `\n${clean(r.decision, 200)}` : ""}\n\n${list}\n\n하나를 고르면 질문 몇 개로 너만의 탐구로 다듬고, 보고서 · PPT · 발표 연습까지 이어서 해 줄게.\n\n[[질문: 어떤 탐구로 할까? | ${[
    ...r.designs.map((d: any, i: number) => `${i + 1}번 — ${shSafe(d.title, 70)}`),
    "다시 설계 — 다른 3개로",
    "직접 고칠래 — 카드 아래 칸에 주제 적기",
  ].join(" | ")}]]`;
}

// 탐구 설계 단계 처리 (진행 중인 과제가 탐구일 때) — 처리 안 하면 null
export async function tpStep(db: any, uid: string, meta: any, t: any, msg: string, ans: string, token: string, emit: (s: string) => void, history: any[] = []) {
  if (t.status === "tp_need") {
    const pick = (k: string) => msg.match(new RegExp(`^${k}[^:：\\n]*[:：]\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
    const dept = pick("학과"), subj = pick("과목"), topic = pick("탐구주제");
    if (!dept && !subj && !topic) return null;
    const ok = (v: string) => v && v !== "없음";
    const grade = await gradeOf(db, uid, meta).catch(() => "");
    const gnum = Number(String(grade).match(/[123]/)?.[0] ?? 0);
    const has = Boolean(ok(topic) && !/^\(?선택\)?$/.test(topic));
    t = await shSave(db, t, {
      subject: ok(subj) ? clean(subj, 30) : t.subject, title: has ? clean(topic, 120) : "관심 분야 탐구", grade: gnum ? `고${gnum}` : t.grade,
      status: gnum ? (has ? "tp_direct" : "tp_link") : "tp_grade",
      analysis: { ...(t.analysis ?? {}), dept: ok(dept) ? clean(dept, 30) : "", origin: has ? { topic: clean(topic, 120) } : null, ...(has ? { direct: true, picked: { title: clean(topic, 120) } } : {}) },
    });
    if (t.analysis?.mode === "mine" && !has) return `탐구주제 칸을 채워 줘. 거칠게 적어도 돼.\n\n[[입력: 내 탐구주제 | ${ok(dept) ? `학과=${shSafe(dept, 30)}` : "학과"} | ${ok(subj) ? `과목=${shSafe(subj, 30)}` : "과목"} | 탐구주제]]`;
    if (!gnum) {
      if (has) await shSave(db, t, { status: "tp_grade", analysis: { ...(t.analysis ?? {}), direct: true, go: true } });
      return `몇 학년이야? (학년마다 깊이가 달라)\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]`;
    }
    return has ? tpGo(db, t, token, emit) : tpLinkQuestion(db, uid, t);
  }
  if (t.status === "tp_grade") {
    const g = Number((ans || msg).match(/^고?\s*([123])\s*(학년)?$/)?.[1] ?? 0);
    if (!g) return ans ? `고1 · 고2 · 고3 중에 골라 줘.\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]` : null;
    t = await shSave(db, t, { grade: `고${g}`, ...(t.analysis?.direct && !t.analysis?.go ? { status: "tp_direct" } : {}) });
    if (t.analysis?.go || (t.analysis?.origin?.query_id && t.analysis?.direct && TP_FROM_DIAG.test(String(t.analysis?.from_msg ?? "")))) return tpGo(db, t, token, emit);
    return t.analysis?.direct ? tpDirectCard(t) : tpLinkQuestion(db, uid, t);
  }
  if (t.status === "tp_direct") {
    if (!ans) return null;
    if (/^흔한가 진단/.test(ans)) {
      await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
      return tpDiagForm(db, uid, meta, t.title, t.subject ?? "");
    }
    if (/^3가지로 설계/.test(ans)) {
      t = await shSave(db, t, { analysis: { ...(t.analysis ?? {}), link: "auto" } });
      return tpDesign(db, t, token, emit);
    }
    return tpGo(db, t, token, emit);
  }
  // 주제를 어떻게 정할까? — 내 주제 · 흔한가 진단 먼저 · 추천
  if (t.status === "tp_how" || t.status === "tp_need") {
    const prev = t.analysis?.recent?.topic ? t.analysis.recent : null;
    if (/^이야기한 주제로/.test(ans) && prev) return tpUseRecent(db, t, prev, token, emit);
    if (!ans && TP_PREV.test(msg) && !/^[가-힣 ]{1,12}\s*[:：]/m.test(msg)) {
      const p2 = prev ?? (await tpTopicFromChat(db, uid, history).catch(() => null));
      if (p2) return tpUseRecent(db, t, p2, token, emit);
    }
  }
  if (t.status === "tp_how") {
    if (!ans) return null;
    if (/^흔한가 진단/.test(ans)) {
      await db.from("school_tasks").update({ in_chat: false }).eq("id", t.id);
      return tpDiagForm(db, uid, meta);
    }
    if (/^주제 추천/.test(ans)) return tpRecoNow(db, uid, meta, t, token, emit);
    if (/^내 주제로/.test(ans)) {
      await shSave(db, t, { status: "tp_need", analysis: { ...(t.analysis ?? {}), mode: "mine" } });
      const d = await deptOf(db, uid, meta);
      return `하고 싶은 탐구주제를 적어 줘. 거칠게 적어도 돼 — 질문 4~5개로 깊게 다듬어 줄게.\n\n[[입력: 내 탐구주제 | ${d ? `학과=${d}` : "학과"} | 과목 | 탐구주제]]`;
    }
    // '주제 말했잖아' — 대화에서 이미 말한 주제를 찾아 쓴다 (그 말을 주제 이름으로 쓰지 않는다)
    const na = nonAnswer(ans);
    if (na === "said") {
      const p2 = (t.analysis?.recent?.topic ? t.analysis.recent : null) ?? (await tpTopicFromChat(db, uid, history).catch(() => null));
      if (p2) return tpUseRecent(db, t, p2, token, emit);
      const d = await deptOf(db, uid, meta);
      return `미안, 앞에서 말한 주제를 못 찾았어. 한 번만 아래 칸에 적어 주면 그 주제로 바로 이어 갈게.\n\n[[입력: 내 탐구주제 | ${d ? `학과=${d}` : "학과"} | 과목 | 탐구주제]]`;
    }
    if (na) return `${TP_HOW_Q}`;
    // 카드 아래 칸에 주제를 바로 적은 경우
    if (ans.length >= 6) {
      t = await shSave(db, t, { title: clean(ans, 120), analysis: { ...(t.analysis ?? {}), mode: "mine", origin: { topic: clean(ans, 120) }, picked: { title: clean(ans, 120) } } });
      if (!t.grade) { await shSave(db, t, { status: "tp_grade", analysis: { ...(t.analysis ?? {}), direct: true, go: true } }); return `몇 학년이야? (학년마다 깊이가 달라)\n\n[[질문: 몇 학년이야? | 고1 | 고2 | 고3]]`; }
      return tpGo(db, t, token, emit);
    }
    return `${TP_HOW_Q}`;
  }
  if (t.status === "tp_link") {
    if (!ans) return null;
    const an = t.analysis ?? {};
    let link = "auto", from = "";
    if (/^이어 가기\s*[:：]/.test(ans)) { link = "link"; from = ans.replace(/^이어 가기\s*[:：]\s*/, "").split(" — ")[0]; }
    else if (/^새로운 분야/.test(ans)) link = "new";
    else if (/^(물꼬가 골라|내 관심사도)/.test(ans) || nonAnswer(ans)) link = "auto";
    else { link = Number(String(t.grade).match(/[123]/)?.[0]) <= 1 ? "auto" : "link"; from = clean(ans, 200); } // 직접 적은 활동 · 관심사
    t = await shSave(db, t, { analysis: { ...an, link, link_from: from, interest: link === "auto" && from ? from : an.interest } });
    return tpDesign(db, t, token, emit);
  }
  if (t.status === "tp_pick") {
    if (!ans) return null;
    if (/^다시 설계/.test(ans)) return tpDesign(db, t, token, emit);
    const designs = (t.analysis?.designs ?? []) as any[];
    const n = Number(ans.match(/^(\d)번/)?.[1] ?? 0);
    const d = n ? designs[n - 1] : null;
    // 칸에 적은 말이 주제가 아니면 (10/26~ 대화: '세개다'가 주제 이름이 되어 질문 5개 · 완성본 제목까지 감)
    const na = d ? null : nonAnswer(ans);
    const card = `[[질문: 어떤 탐구로 할까? | ${designs.map((x: any, i: number) => `${i + 1}번 — ${shSafe(x.title, 70)}`).join(" | ")}]]`;
    if (na === "all") return `하나씩 해야 깊게 쓸 수 있어. 제일 끌리는 걸 하나 먼저 골라 줘. 둘 이상을 합치고 싶으면 합친 주제를 카드 아래 칸에 한 문장으로 적어 줘.\n\n${card}`;
    if (na === "unknown" || na === "said") return `그럼 1번부터 해 보는 걸 추천해 — 지금 학년에서 가장 무난하게 쓸 수 있어. 골라 줘.\n\n${card}`;
    const pickAny = na === "any" && designs.length ? designs[0] : null;
    if (!d && !pickAny && !/^직접 고칠래/.test(ans) && ans.replace(/\s/g, "").length < 8) return `보기 중에서 골라 줘. 내 주제가 따로 있으면 카드 아래 칸에 한 문장으로 적어 줘.\n\n${card}`;
    const title = d ? clean(d.title, 120) : pickAny ? clean(pickAny.title, 120) : /^직접 고칠래/.test(ans) ? "" : clean(ans, 120);
    if (!title) return `고칠 주제를 카드 아래 칸에 적어 줘.\n\n[[질문: 어떤 탐구로 할까? | ${designs.map((x: any, i: number) => `${i + 1}번 — ${shSafe(x.title, 70)}`).join(" | ")}]]`;
    const dd = d ?? pickAny;
    t = await shSave(db, t, {
      title, status: "analyzed",
      analysis: { ...(t.analysis ?? {}), picked: dd ?? { title }, summary: clean(dd?.how || dd?.why, 300), format: TP_METHOD[dd?.method] ?? "탐구", overview: clean(dd?.why, 200) },
    });
    return shFirstQuestion(t, token, emit);
  }
  return null;
}