// 내 생기부 면접 예상 질문 — 학생이 GPT·Claude로 정리한 생기부를 붙여 넣으면
// 지원 대학의 면접 데이터(평가요소 비중·질문 출제 특징)에 맞춰 예상 질문만 뽑는다 (꼬리 질문·답변 없음)
// 배포: npx supabase functions deploy interview --project-ref xhywexuazwipwvzrldwo --no-verify-jwt
//
// 요청 { targets: [{ university, department }] (1~6곳), text, agreed: true }   (로그인 필수)
// 응답 { results: [{ university, department, groups: [{ title, questions: [] }], total, has_univ_data }] }
// 학생 동의를 받고 붙여 넣은 생기부 요약·대학 목록·결과를 모두 interview_queries에 저장한다

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5";
const MAX_TEXT = 20000; // 붙여 넣는 글 최대 길이
const DAILY_LIMIT = 3; // 회원 하루 3번 뽑기 (한 번에 여러 대학도 1번으로 센다 · 결제 전까지 비용을 막는 장치)
const MAX_TARGETS = 6; // 수시 최대 6곳

const SYSTEM = `고3 학생의 대입 면접 예상 질문을 뽑는다. JSON만 출력.

입력: 학생이 AI로 정리한 생활기록부 내용, 지원 대학·학과, (있으면) 그 대학의 면접 데이터.
- 생활기록부에 실제로 적힌 활동·과목·독서·진로만 근거로 질문을 만든다. 없는 활동을 지어내지 않는다
- 꼬리 질문, 답변 예시, 설명은 쓰지 않는다. 면접관이 실제로 던질 **질문 문장만** 쓴다
- 질문에는 활동 이름·과목·책 제목처럼 생기부의 구체적 내용을 넣는다 (예: "화학Ⅰ 탐구에서 촉매 농도를 바꿔 실험한 이유는 무엇인가요?")
- [대학 면접 데이터]가 있으면 그 대학의 평가요소 비중과 질문 출제 특징에 맞춘다. 비중이 큰 요소일수록 질문을 더 많이 만든다
- 그룹은 3~6개. 그룹 이름은 쉬운 말 (예: "지원동기·진로", "전공 관련 탐구", "학업 역량", "인성·공동체", "독서")
- 전체 질문 20~30개. 서로 겹치지 않게
- 입력이 생활기록부 내용이 아니면 {"invalid":true,"invalid_reason":"한 문장"}

{"invalid":false,"groups":[{"title":"","questions":["",""]}]}`;

/* AI 사용량 기록 — 관리자 화면의 'AI 비용·실패' 칸에 쓴다 (기록이 실패해도 진단에는 영향 없음) */
const PRICE: Record<string, [number, number]> = { "gpt-5": [1.25, 10], "gpt-5-mini": [0.25, 2] }; // 100만 토큰당 달러 (입력, 출력)
const USAGE_DB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
type Ctx = { service: string; userId?: string | null; clientId?: string | null };
async function logUsage(ctx: Ctx, model: string, usage: any, ok: boolean) {
  try {
    const [pi, po] = PRICE[model] ?? [0, 0];
    const inT = Number(usage?.prompt_tokens ?? 0);
    const outT = Number(usage?.completion_tokens ?? 0); // 생각하는 과정 토큰 포함
    await USAGE_DB.from("ai_usage").insert({
      service: ctx.service,
      user_id: ctx.userId ?? null,
      client_id: ctx.clientId ?? null,
      model,
      input_tokens: inT,
      output_tokens: outT,
      cost_usd: (inT * pi + outT * po) / 1e6,
      ok,
    });
  } catch (e) {
    console.warn("usage log failed", e);
  }
}

async function ask(user: string, ctx: Ctx) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 12000,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("openai error", res.status, body.slice(0, 800));
    await logUsage(ctx, MODEL, null, false);
    return null;
  }
  let usage: any = null;
  try {
    const j = JSON.parse(body);
    usage = j.usage;
    const out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
    await logUsage(ctx, MODEL, usage, true);
    return out;
  } catch (e) {
    console.error("parse failed", e);
    await logUsage(ctx, MODEL, usage, false);
    return null;
  }
}

const clean = (v: unknown, n = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* 대학 찾기 — 지원동기 진단과 같은 규칙 */
const UNIV_ALIAS: Record<string, string> = {
  서울과기대: "서울과학기술대학교",
  과기대: "서울과학기술대학교",
  카이스트: "한국과학기술원(KAIST)",
  kaist: "한국과학기술원(KAIST)",
  한국과학기술원: "한국과학기술원(KAIST)",
  "공주대학교(예산)": "공주대학교",
};
const univKey = (n: string) =>
  n.replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교/g, "대").replace(/대학/g, "대").toLowerCase();
async function findUniv(admin: any, name: string) {
  if (!name) return null;
  const n = name.replace(/\s/g, "");
  name = UNIV_ALIAS[n] ?? UNIV_ALIAS[n.toLowerCase()] ?? name;
  const { data: exact } = await admin.from("univ_profiles").select("*").eq("name", name).maybeSingle();
  if (exact) return exact;
  const { data: list } = await admin.from("univ_profiles").select("*").eq("name_key", univKey(name));
  if (!list?.length) return null;
  return list.find((u: any) => !u.name.includes("(")) ?? list[0];
}
function topWeights(w: Record<string, number>) {
  const items = Object.entries(w ?? {}).filter(([, v]) => Number(v) > 0);
  const sum = items.reduce((a, [, v]) => a + Number(v), 0);
  if (!sum) return [];
  return items.map(([k, v]) => ({ factor: k, weight: Math.round((Number(v) / sum) * 100) })).sort((a, b) => b.weight - a.weight);
}

/* 오늘(한국 시간) 0시 */
function todayStartKST() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 9 * 3600 * 1000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "로그인이 필요해요.", login: true }, 401);

    const body = await req.json();
    const text = String(body.text ?? "").trim().slice(0, MAX_TEXT);
    const targets = (Array.isArray(body.targets) ? body.targets : [])
      .map((t: any) => ({ university: clean(t?.university, 40), department: clean(t?.department, 40) }))
      .filter((t: any) => t.university || t.department)
      .slice(0, MAX_TARGETS);
    if (!targets.length) return json({ error: "지원 대학·학과를 적어 주세요." }, 400);
    if (targets.some((t: any) => !t.university || !t.department)) return json({ error: "대학과 학과를 모두 적어 주세요." }, 400);
    if (text.length < 200) return json({ error: "요약한 활동 내용을 200자 이상 붙여 넣어 주세요." }, 400);
    if (!body.agreed) return json({ error: "저장 동의에 체크해 주세요." }, 400);

    // 결제한 회원만 (관리자는 결제 없이)
    const { data: adminRow } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) {
      const { data: access } = await admin.from("interview_access").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!access) return json({ error: "생기부 예상질문을 결제하면 이용할 수 있어요.", paywall: true }, 402);
    }
    if (!adminRow) {
      const { count } = await admin
        .from("interview_queries").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).gte("created_at", todayStartKST());
      if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `오늘은 ${DAILY_LIMIT}번까지 뽑을 수 있어요. 내일 다시 해 주세요.` }, 429);
    }

    // 대학마다 동시에 뽑는다 (6곳이어도 1곳과 비슷한 시간)
    async function one(t: { university: string; department: string }) {
      const univ = await findUniv(admin, t.university);
      const weights = univ ? topWeights(univ.weights) : [];
      const univBlock = univ
        ? `

[대학 면접 데이터] ${univ.name}
${weights.length ? `평가요소 비중: ${weights.map((w) => `${w.factor} ${w.weight}%`).join(", ")}` : ""}
면접관 핵심 관점: ${univ.view}
질문 출제 특징: ${univ.question_style}`
        : "";
      const ai = await ask(
        `[지원 대학] ${t.university}
[지원 학과] ${t.department}${univBlock}

[학생 생활기록부 정리]
${text}`,
        { service: "interview", userId: user.id }
      );
      if (!ai) return { ...t, error: "이 대학은 질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요." };
      if (ai.invalid) return { ...t, error: clean(ai.invalid_reason, 150) || "요약한 활동 내용을 붙여 넣어 주세요.", invalid: true };
      const groups = (ai.groups ?? [])
        .map((g: any) => ({
          title: clean(g?.title, 30),
          questions: (g?.questions ?? []).map((q: any) => clean(q, 200)).filter(Boolean).slice(0, 12),
        }))
        .filter((g: any) => g.title && g.questions.length)
        .slice(0, 6);
      return {
        university: univ?.name ?? t.university,
        department: t.department,
        groups,
        total: groups.reduce((a: number, g: any) => a + g.questions.length, 0),
        has_univ_data: Boolean(univ),
      };
    }
    const results = await Promise.all(targets.map(one));
    if (results.every((r: any) => r.invalid)) return json({ error: (results[0] as any).error }, 400);
    if (results.every((r: any) => r.error)) return json({ error: "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);

    // 모두 저장 — 붙여 넣은 요약, 대학 목록, 결과 (학생이 동의한 시각과 함께)
    await admin.from("interview_queries").insert({
      user_id: user.id,
      university: targets[0].university,
      department: targets[0].department,
      targets,
      text,
      text_length: text.length,
      result: { results },
      agreed_at: new Date().toISOString(),
    });

    return json({ results });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});