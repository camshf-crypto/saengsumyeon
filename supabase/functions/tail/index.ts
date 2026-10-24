// 면접 꼬리질문 — 내 답변을 넣으면 그 대학 면접관이 파고드는 방식대로 꼬리질문을 하나씩 만든다
// 배포: npx supabase functions deploy tail --project-ref xhywexuazwipwvzrldwo --use-api
//
// 요청 (로그인 필수 · Authorization 헤더)
//   { action: "start", univ, department, main_type, main_q, answer }  → 새 연습 + 첫 꼬리질문
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

// 꼬리 품질이 부족하면 "gpt-5" 로 바꾸면 된다 (질문 1개당 약 5원 → 약 25원)
const MODEL = "gpt-5-mini";
const MAX_TAILS = 6; // 메인 질문 하나에 꼬리는 6개까지 (실제 면접도 보통 1~3단계)
const MAIN_TYPES = ["자기소개", "지원동기", "생기부 질문", "공통·인성", "제시문"];
const PATTERNS = ["이유·근거", "구체화", "개념 심화", "반박·약점", "확장·적용", "사실·출처 확인", "결과·배운 점", "역할·관계", "진로·학과 연결"];
const clean = (v: unknown, n = 600) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/*
 * 꼬리질문의 목적 = "이 학생이 정말 그걸 했는지" 확인하기
 * 패턴은 '어느 쪽으로 파고들지'일 뿐 — 지식 시험·가정 질문이 되지 않게 패턴마다 검증 방향을 정해 둔다
 */
const PGUIDE: Record<string, string> = {
  "이유·근거": "학생이 내린 판단·결론('성공적이었다','흥미를 느꼈다')을 콕 집어, 그렇게 판단한 실제 장면·근거를 묻는다",
  "구체화": "학생이 뭉뚱그려 말한 부분을 실제로 한 사람만 답할 수 있는 디테일(언제·무엇을·어떻게·직접 한 일)로 묻는다",
  "개념 심화": "학생이 직접 말한 개념·이론·용어를 그 활동에서 실제로 어떻게 이해하고 썼는지 묻는다. 학생이 배웠다고 하지 않은 분야 지식을 시험하지 않는다",
  "반박·약점": "학생 말 속의 빈틈(주장과 근거 사이의 거리, 너무 매끄러운 결과)을 짚어 실제로 막혔던 점·안 된 점을 묻는다",
  "확장·적용": "학생이 한 경험에서 배운 것을 그 경험의 다음 행동(그 뒤에 실제로 해 본 것)과 이어서 묻는다. 막연한 가정은 묻지 않는다",
  "사실·출처 확인": "학생이 언급한 자료·영상·책·논문·조사 안에 실제로 무엇이 들어 있었는지(구체적인 내용·결과·조건·장면)를 묻는다. '어디서 얻었나/알았나'처럼 출처 이름만 대면 끝나는 질문은 하지 않는다",
  "결과·배운 점": "그 경험의 실제 결과와, 학생 생각이 그 전과 비교해 구체적으로 어떻게 달라졌는지 묻는다",
  "역할·관계": "함께한 사람들 사이에서 학생 본인이 맡은 몫·직접 한 일, 의견이 갈렸던 순간을 묻는다",
  "진로·학과 연결": "학생이 말한 경험·계기가 이 학과를 고르는 데 실제로 어떻게 이어졌는지 묻는다",
};

/* 질문 앞에 붙어 나오는 '[개념 심화] =' 같은 꼬리표를 떼어 낸다 */
const stripLabel = (q: string) =>
  q.replace(/^\s*(\[[^\]]{1,20}\]|\([^)]{1,20}\)|(면접관|꼬리|질문)\s*[:：])\s*=?\s*/u, "").replace(/^["'“]|["'”]$/g, "").trim();

/* 비교용: 공백·문장부호를 없앤 글자 */
const norm = (t: string) => t.replace(/[\s"'“”‘’.,·…!?~()\[\]]/g, "");

/* AI 사용량 기록 — 관리자 'AI 비용' 칸 */
const PRICE: Record<string, [number, number]> = { "gpt-5-mini": [0.25, 2], "gpt-5": [1.25, 10] };
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
      reasoning_effort: "medium", // 학생 말을 정확히 짚으려면 low 보다 한 단계 더 생각하게
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
      if (!clean(body.department, 40)) return json({ error: "학과를 적어 주세요" }, 400);
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
    // 학교마다 다른 꼬리 — 첫 꼬리부터 그 대학이 실제로 많이 묻는 방향(패턴 비율)으로 고른다
    // 대신 어느 패턴이든 '정말 했는지 확인하는' 쪽으로 묻게 한다 (PGUIDE)
    const first = used.length === 0;
    const pattern = pickPattern(un?.mix ?? {}, mainMix, used);
    const { data: pdesc } = await db.from("tail_patterns").select("meaning,example").eq("pattern", pattern).maybeSingle();
    const pct = Math.round(Number(un?.mix?.[pattern] ?? 0) * 100); // 이 대학 꼬리 중 이 패턴 비율
    const direction = `[${pattern}] — ${PGUIDE[pattern] ?? pdesc?.meaning ?? ""}${pct ? ` (${s.univ} 실제 꼬리질문의 ${pct}%가 이 방향)` : ""}
${first ? `첫 꼬리이므로 학생이 "했다"고 말한 행동·경험 하나를 골라 이 방향으로 정말 했는지 확인한다. 경험 없이 생각·다짐만 있으면 그 생각을 하게 된 실제 장면부터 묻는다.` : ""}
${s.univ}의 실제 꼬리 흐름(아래 예시)의 말투·파고드는 깊이를 따라 한다 — 다른 대학과 다르게 느껴지도록.`;
    const ex = await examplesFor(db, s.univ, s.main_type, pattern);
    const st = un?.stats ?? {};

    const convo = [`면접관(메인 질문): ${s.main_q}`]
      .concat((s.turns as any[]).map((t) => (t.q ? `면접관(꼬리, ${t.pattern}): ${t.q}` : `학생: ${t.a}`)))
      .join("\n");

    const system = `너는 한국 대학 학생부종합전형 면접관이다. 학생의 '바로 앞 답변'을 듣고 꼬리질문 1개를 한다.
꼬리질문의 목적은 단 하나 — "이 학생이 말한 것을 정말 직접 했는지, 정말 그렇게 생각했는지" 확인하는 것이다.
직접 해 본 학생은 바로 답할 수 있고, 꾸며 낸 학생은 막히는 질문을 한다.

이번 파고드는 방향: ${direction}

좋은 꼬리 예시 (학생이 한 말 → 꼬리):
- "재학생 영상을 보고 항공법규에 흥미" → 그 영상에서 어떤 장면을 보고 흥미가 생겼어요? 그 뒤에 직접 더 찾아본 게 있어요?
- "팀장으로 문학·베이킹·디자인 융합 프로젝트" → 2학년 때 실제로 만든 결과물이 뭐였어요?
- "장자의 죽음관을 접하고 당연하던 생각을 돌아봄" → 장자를 읽기 전엔 죽음을 어떻게 생각했고, 뭐가 바뀌었어요?
- "아스파탐을 탐구하며 섭취량을 함께 봐야 한다는 걸 배움" → 그럼 할머니가 드시는 제로음료는 하루 몇 캔까지 괜찮다고 나왔어요?
- "제올라이트 종류마다 흡착량을 비교" → 어떤 종류를 무엇으로 재서 비교했고, 결과가 어땠어요?
- "산후 여성 인터뷰를 함" → 몇 분을 어떻게 만났고, 가장 기억에 남은 답이 뭐였어요?
- "천마총 발굴 일지를 직접 분석" → 일지에서 찾아 해설에 실제로 넣은 내용이 뭐였어요?
- "방송부에서 엔지니어 역할" → 실제로 방송사고가 난 적 있어요? 원인이 뭐였고 어떻게 해결했어요?
- "다양한 공연에서 위로를 받음" (추상적) → 가장 기억에 남는 공연 하나와, 어떤 장면에서 위로받았는지 말해 주세요.
- "아이마다 발달이 다르다" (경험 없음) → 아이마다 다르다는 걸 직접 느낀 장면이 있어요?
- "그림 카드로 다문화 아이 멘토링" → 처음에 안 통했던 카드가 있었어요? 어떻게 바꿨어요?
- "긴장해서 기억이 안 나요" / "직접 해 보진 못했어요" → 몰아세우지 말고, 실제로 한 데까지 묻는다 (예: 괜찮아요. 본인이 받은 재활 중에 대학에서 제대로 배워 보고 싶은 게 있어요?)

규칙:
1) 먼저 학생 '마지막 답변'에서 파고들 구절을 고른다. quote 에는 그 구절을 답변에서 글자 그대로 옮긴다 (바꿔 말하지 않는다).
2) 질문은 그 구절에 대해서만 묻는다. 학생이 말하지 않은 뜻을 덧붙이거나, 학생 말을 다르게 요약하지 않는다.
   (나쁜 예: 학생은 "두 사상을 통해 삶과 자유를 전혀 다른 관점에서 볼 수 있었다"고 했는데 "장자와 칸트가 전혀 다르다고 한 근거는?"이라고 묻기 — 학생 말을 잘못 옮긴 것)
3) 금지:
   - 학생이 배웠다고 말하지 않은 분야 지식을 시험하는 질문 (나쁜 예: 영상을 보고 흥미가 생겼다는 학생에게 "항공법규의 핵심 내용을 설명해 보세요")
   - 교과서 정의를 외워 말하게 하는 질문 (나쁜 예: "독립변인과 종속변인의 차이를 설명해 주세요" → 좋은 예: "취침 시간이나 카페인 같은 다른 요인은 실제로 어떻게 걸러 냈어요?")
   - "더 자세히", "예를 들어" 같은 군더더기로 시작하는 질문 — 바로 묻는다
   - 이름·제목·날짜 한 단어로 답이 끝나는 질문 (나쁜 예: "어떤 논문을 분석하셨나요?" — 제목만 외워 와도 통과)
   - "그 정보는 어디에서 얻으셨나요?", "어디서 알았어요?" 같은 출처 질문 — "인터넷이요" 한마디로 끝난다
     → 그 조사에서 알게 된 내용 자체를 묻는다 (좋은 예: "인슐린 제품의 문제점을 조사했다고 했는데, 그중 가장 크다고 본 문제와 그 이유가 뭐였어요?")
※ 우선순위: 답변 안에서 이야기가 갑자기 넘어가는 곳(A를 했는데 B를 하고 싶다)이 있으면 그 연결부터 묻는다. 진짜 했고 진짜 생각한 학생만 그 이음새를 설명할 수 있다.
   (좋은 예: 당뇨·인슐린을 탐구했는데 대학에서는 희귀질환·유전자 실험을 하고 싶다 → "인슐린을 탐구하다가 희귀질환·유전자 쪽으로 관심이 옮겨 간 계기가 뭐였어요?")
     → 그 안을 직접 봐야 답할 수 있게 묻는다 (좋은 예: "주사제가 산화에 취약하다고 했는데, 그 논문에서 안정성을 떨어뜨린 조건이 뭐였어요?")
   - 가능하면 "그래서 그게 지원 동기·학과와 어떻게 이어졌는지"까지 한 문장 안에서 묶어, 외운 답으로는 못 넘어가게 한다
   - "~하면 어떻게 하겠어요?", "항상 ~되나요?" 같은 가정·미래·꼬투리 질문
   - 답변에 없는 경험·사실을 지어낸 질문
4) 좋은 질문은 실제로 한 사람만 아는 것을 묻는다: 그때 처음 본 장면, 직접 한 일, 막혔던 순간, 자료에서 알게 된 내용, 바뀐 생각의 전과 후.
   (좋은 예: 영상을 보고 흥미가 생겼다 → "그 영상에서 어떤 장면을 보고 이 학과를 알아봐야겠다고 생각했어요?")
5) 실제 면접관 말투로 짧게 (한두 문장, 80자 안). 존댓말. 칭찬·설명 없이 질문만. 질문 앞에 [패턴] 같은 꼬리표를 붙이지 않는다.
6) 앞에서 이미 한 질문과 겹치지 않게 한다. 학생 이름·학교 같은 개인정보는 묻지 않는다.
- why: 이 대학 면접관이 이 질문으로 무엇을 확인하려는지 한 문장 (학생에게 보여 줌, 50자 안). 이 방향 비율이 높은 대학이면 "○○대는 이런 꼬리를 자주 물어요"처럼 대학 특징을 드러낸다
- tip: 이 꼬리에 답할 때 방향 한 문장 (정답을 대신 써 주지 말고 무엇을 넣으면 좋은지, 50자 안)
- 학생 답변이 질문과 상관없거나 장난이면 off=true 로 하고 question 에는 "질문에 맞게 다시 답해 주세요"류 한 문장.
JSON으로만: {"quote":"","question":"","why":"","tip":"","off":false}`;

    const userMsg = `[대학] ${s.univ}${s.department ? ` · ${s.department}` : ""}
[이 대학 면접 특징] 메인 질문 1개당 꼬리 평균 ${st.per_main ?? "-"}개 · 파고들 때 평균 ${st.depth ?? "-"}단계 · 가장 많은 꼬리: ${st.top ?? "-"} · 특징: ${st.feature ?? "-"}
[이 대학 실제 꼬리 흐름 예시]
${ex.flows.join("\n\n") || "(없음)"}
[다른 대학의 '${pattern}' 꼬리 예시 — 말투만 참고. 정의·지식을 묻는 질문은 따라 하지 않는다]
${ex.samples.map((q: string) => `- ${q}`).join("\n") || "(없음)"}

[지금까지 면접]
${convo}

위 마지막 학생 답변에 이어질 ${s.univ} 면접관의 꼬리질문 1개 (방향: ${pattern}). 이 학생이 정말 했는지 확인하는 질문으로.`;

    // quote 가 학생 마지막 답변에 실제로 없으면 (말을 지어내거나 바꿔 옮긴 것) 한 번 더 만든다
    const lastA = norm(String((s.turns as any[])[s.turns.length - 1]?.a ?? ""));
    const grounded = (o: any) => {
      const qt = norm(String(o?.quote ?? ""));
      return o?.off || (qt.length >= 2 && lastA.includes(qt));
    };
    let out = await ask(db, user.id, system, userMsg);
    if (out && !grounded(out)) {
      const again = await ask(db, user.id, system, userMsg + `\n\n(주의: quote 는 학생 마지막 답변의 구절을 글자 그대로 옮겨야 하고, 질문은 그 구절에 대해서만 묻는다)`);
      if (again && (grounded(again) || !out?.question)) out = again;
    }
    // '어디서 얻었/알았' 같은 출처만 묻는 질문이면 한 번 더 만든다 (한마디로 끝나서 진짜 했는지 확인이 안 됨)
    const weak = (o: any) => /어디(에서|서)\s*(얻|알|찾|보|접하|들)/.test(String(o?.question ?? "")) || /어떤 (논문|책|자료|영상|사이트)(을|를)\s*(분석|참고|보|읽)/.test(String(o?.question ?? ""));
    if (out && !out.off && weak(out)) {
      const again = await ask(db, user.id, system, userMsg + `\n\n(주의: 출처·제목만 대면 끝나는 질문은 안 된다. 그 자료·조사에서 알게 된 내용이나, 답변 속 이야기가 넘어가는 이음새를 물어라)`);
      if (again?.question && !weak(again)) out = again;
    }
    const q = stripLabel(clean(out?.question, 200));
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