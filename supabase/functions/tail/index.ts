// 면접 꼬리질문 — 내 답변을 넣으면 그 대학 면접관이 파고드는 방식대로 꼬리질문을 하나씩 만든다
// 배포: npx supabase functions deploy tail --project-ref xhywexuazwipwvzrldwo --use-api
//
// 요청 (로그인 필수 · Authorization 헤더)
//   { action: "start", univ, department?, main_type, main_q, answer }  → 새 연습 + 첫 꼬리질문
//   { action: "next", id, answer }                                     → 이어서 다음 꼬리질문
// 응답 { id, turn: { q, pattern, why, tip }, turns, left: { free, paid } }
//      남은 개수가 없으면 { need_pay: true } · 답변이 너무 짧으면 { error }
// 꼬리질문 1개를 만들 때마다 1개를 쓴다 (무료 5개 → 산 것). 만들기에 실패하면 돌려준다.
// 대학별 패턴 · 실제 예시는 이 함수 안에서만 쓴다 (학생 화면에는 보내지 않는다)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5-mini";
const MAX_TAILS = 6; // 메인 질문 하나에 꼬리는 6개까지 (실제 면접도 보통 1~3단계)
const MAIN_TYPES = ["자기소개", "지원동기", "생기부 질문", "공통·인성", "제시문"];
const PATTERNS = ["이유·근거", "구체화", "개념 심화", "반박·약점", "확장·적용", "사실·출처 확인", "결과·배운 점", "역할·관계", "진로·학과 연결"];
const clean = (v: unknown, n = 600) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* AI 사용량 기록 — 관리자 'AI 비용' 칸 */
const PRICE: Record<string, [number, number]> = { "gpt-5-mini": [0.25, 2] };
async function logUsage(db: any, userId: string, usage: any, ok: boolean) {
  try {
    const [pi, po] = PRICE[MODEL];
    const inT = Number(usage?.prompt_tokens ?? 0), outT = Number(usage?.completion_tokens ?? 0);
    await db.from("ai_usage").insert({ service: "tail", user_id: userId, model: MODEL, input_tokens: inT, output_tokens: outT, cost_usd: (inT * pi + outT * po) / 1e6, ok });
  } catch (_) { /* 기록 실패는 무시 */ }
}

async function ask(db: any, userId: string, system: string, user: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 4000,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const body = await res.text();
  if (!res.ok) { console.error("openai", res.status, body.slice(0, 500)); await logUsage(db, userId, null, false); return null; }
  try {
    const j = JSON.parse(body);
    const out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
    await logUsage(db, userId, j.usage, true);
    return out;
  } catch (e) { console.error("parse", e); await logUsage(db, userId, null, false); return null; }
}

/* 이번 꼬리 패턴 고르기 — 그 대학 비율 × 메인 질문 종류 비율, 바로 앞과 같은 패턴은 덜 나오게 */
function pickPattern(univMix: Record<string, number>, mainMix: Record<string, number>, used: string[]) {
  const last = used[used.length - 1];
  const w = PATTERNS.map((p) => {
    const a = Number(univMix?.[p] ?? 0.08) + 0.01;
    const b = Number(mainMix?.[p] ?? 0.08) + 0.01;
    let v = Math.sqrt(a * b);
    if (p === last) v *= 0.35;
    if (used.filter((x) => x === p).length >= 2) v *= 0.3;
    return v;
  });
  const sum = w.reduce((s, x) => s + x, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < PATTERNS.length; i++) { r -= w[i]; if (r <= 0) return PATTERNS[i]; }
  return PATTERNS[0];
}

/* 메인 질문 종류 → 패턴 비율 ('생기부 질문'은 ①~⑥을 합친다) */
async function mainMixOf(db: any, mainType: string) {
  const { data } = await db.from("tail_main_mix").select("main_type,n,mix");
  const rows = (data ?? []) as any[];
  const pick = mainType === "생기부 질문" ? rows.filter((r) => r.main_type.startsWith("생기부")) : rows.filter((r) => r.main_type === mainType);
  const out: Record<string, number> = {};
  const total = pick.reduce((s, r) => s + r.n, 0) || 1;
  for (const r of pick) for (const [k, v] of Object.entries(r.mix ?? {})) out[k] = (out[k] ?? 0) + Number(v) * (r.n / total);
  return out;
}

/* 참고할 실제 흐름: 그 대학의 같은 종류 메인 질문 사례 2개 + 다른 대학의 같은 패턴 꼬리 3개 */
async function examplesFor(db: any, univ: string, mainType: string, pattern: string) {
  const kind = mainType;
  const { data: mine } = await db.from("tail_examples").select("case_no,step,kind,question,pattern").eq("univ", univ).order("case_no").order("step").limit(60);
  const cases: Record<number, any[]> = {};
  for (const r of mine ?? []) (cases[r.case_no] ??= []).push(r);
  const list = Object.values(cases);
  const same = list.filter((c) => c[0]?.kind === kind);
  const chosen = (same.length ? same : list).slice(0, 2);
  const flows = chosen.map((c) => c.map((r: any) => (r.step === 0 ? `메인: ${r.question}` : `→ (${r.pattern ?? "꼬리"}) ${r.question}`)).join("\n"));

  const { data: other } = await db.from("tail_examples").select("question").eq("pattern", pattern).neq("univ", univ).limit(40);
  const samples = (other ?? []).map((r: any) => r.question).sort(() => Math.random() - 0.5).slice(0, 3);
  return { flows, samples };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: "로그인하면 꼬리질문 5개를 무료로 받을 수 있어요", need_login: true }, 401);
    const body = await req.json().catch(() => ({}));
    const answer = clean(body.answer, 1200);
    if (answer.length < 15) return json({ error: "답변을 15자 이상 적어 주세요 (실제로 말할 것처럼)" }, 400);

    // ── 연습 불러오기 또는 새로 만들기
    let s: any;
    if (body.action === "next") {
      const { data } = await db.from("tail_sessions").select("*").eq("id", Number(body.id)).eq("user_id", user.id).maybeSingle();
      if (!data) return json({ error: "연습을 찾지 못했어요. 새로 시작해 주세요" }, 404);
      s = data;
      const tails = (s.turns as any[]).filter((t) => t.q).length;
      if (tails >= MAX_TAILS) return json({ error: `메인 질문 하나에 꼬리는 ${MAX_TAILS}개까지예요. 새 질문으로 연습해 보세요`, done: true }, 400);
      s.turns = [...s.turns, { a: answer }];
    } else if (body.action === "start") {
      const univ = clean(body.univ, 40);
      const mainType = MAIN_TYPES.includes(body.main_type) ? body.main_type : "생기부 질문";
      const mainQ = clean(body.main_q, 300);
      if (!univ) return json({ error: "대학을 골라 주세요" }, 400);
      if (mainQ.length < 5) return json({ error: "면접 질문을 적어 주세요" }, 400);
      s = { univ, department: clean(body.department, 40) || null, main_type: mainType, main_q: mainQ, turns: [{ a: answer }] };
    } else {
      return json({ error: "잘못된 요청이에요" }, 400);
    }

    // ── 1개 쓰기 (무료 먼저)
    const { data: use } = await db.rpc("tail_use", { p_user: user.id });
    if (!use?.ok) return json({ need_pay: true });

    // ── 이 대학 패턴 (목록에 없는 대학이면 전체 평균처럼)
    const { data: un } = await db.from("tail_univ").select("mix,stats").eq("univ", s.univ).maybeSingle();
    const mainMix = await mainMixOf(db, s.main_type);
    const used = (s.turns as any[]).filter((t) => t.q).map((t) => t.pattern);
    const pattern = pickPattern(un?.mix ?? {}, mainMix, used);
    const { data: pdesc } = await db.from("tail_patterns").select("meaning,example").eq("pattern", pattern).maybeSingle();
    const ex = await examplesFor(db, s.univ, s.main_type, pattern);
    const st = un?.stats ?? {};

    const convo = [`면접관(메인 질문): ${s.main_q}`]
      .concat((s.turns as any[]).map((t) => (t.q ? `면접관(꼬리, ${t.pattern}): ${t.q}` : `학생: ${t.a}`)))
      .join("\n");

    const system = `너는 한국 대학 학생부종합전형 면접관이다. 학생의 '바로 앞 답변'을 듣고 꼬리질문 1개를 한다.
규칙:
- 반드시 이번 패턴으로 묻는다: [${pattern}] = ${pdesc?.meaning ?? ""} (예: ${pdesc?.example ?? ""})
- 학생이 방금 한 말 속의 단어·주장·경험을 콕 집어서 묻는다. 답변에 없는 내용을 지어내지 않는다.
- 실제 면접관 말투로 짧게 (한두 문장, 80자 안). 존댓말. 칭찬·설명 없이 질문만.
- 앞에서 이미 한 질문과 겹치지 않게 한다.
- 학생 이름·학교 같은 개인정보는 묻지 않는다.
- why: 면접관이 이 질문으로 무엇을 확인하려는지 한 문장 (학생에게 보여 줌, 40자 안)
- tip: 이 꼬리에 답할 때 방향 한 문장 (정답을 대신 써 주지 말고 무엇을 넣으면 좋은지, 50자 안)
- 학생 답변이 질문과 상관없거나 장난이면 off=true 로 하고 question 에는 "질문에 맞게 다시 답해 주세요"류 한 문장.
JSON으로만: {"question":"","why":"","tip":"","off":false}`;

    const userMsg = `[대학] ${s.univ}${s.department ? ` · ${s.department}` : ""}
[이 대학 면접 특징] 메인 질문 1개당 꼬리 평균 ${st.per_main ?? "-"}개 · 파고들 때 평균 ${st.depth ?? "-"}단계 · 가장 많은 꼬리: ${st.top ?? "-"} · 특징: ${st.feature ?? "-"}
[이 대학 실제 꼬리 흐름 예시]
${ex.flows.join("\n\n") || "(없음)"}
[다른 대학의 '${pattern}' 꼬리 예시]
${ex.samples.map((q: string) => `- ${q}`).join("\n") || "(없음)"}

[지금까지 면접]
${convo}

위 마지막 학생 답변에 이어질 '${pattern}' 꼬리질문 1개.`;

    const out = await ask(db, user.id, system, userMsg);
    const q = clean(out?.question, 200);
    if (!q) {
      await db.rpc("tail_refund", { p_user: user.id, p_by: use.by });
      return json({ error: "질문을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요 (개수는 돌려 드렸어요)" }, 502);
    }
    if (out?.off) {
      await db.rpc("tail_refund", { p_user: user.id, p_by: use.by }); // 장난 답변이면 개수는 쓰지 않는다
      return json({ error: q, off: true }, 400);
    }
    const turn = { q, pattern, why: clean(out?.why, 80), tip: clean(out?.tip, 100) };
    s.turns = [...s.turns, turn];

    let id = s.id;
    if (id) {
      await db.from("tail_sessions").update({ turns: s.turns, updated_at: new Date().toISOString() }).eq("id", id);
    } else {
      const { data: row, error } = await db.from("tail_sessions").insert({
        user_id: user.id, univ: s.univ, department: s.department, main_type: s.main_type, main_q: s.main_q, turns: s.turns,
      }).select("id").single();
      if (error) throw error;
      id = row.id;
    }
    const { data: c } = await db.from("tail_credits").select("free_used,balance").eq("user_id", user.id).maybeSingle();
    return json({
      id, turn, turns: s.turns,
      left: { free: Math.max(5 - Number(c?.free_used ?? 0), 0), paid: Number(c?.balance ?? 0) },
      max: MAX_TAILS,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "잠시 문제가 생겼어요. 다시 시도해 주세요" }, 500);
  }
});