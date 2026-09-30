// 지원동기 흔한가 — 고3 대입 지원동기(면접 답변·자소서)가 얼마나 흔한지 진단
// 배포: npx supabase functions deploy motive --project-ref xhywexuazwipwvzrldwo --no-verify-jwt
//
// 요청 { university?, department, use_for: "interview"|"document", motive, client_id }
// 응답 { score, verdict_level, univ, remaining }
//      무료를 다 쓰면 { quota_exceeded: true, next_open }, 지원동기가 아니면 { invalid: true }
// 횟수: 회원 일주일 2번(다 쓰면 친구 초대 1명당 1번 — motive_bonus), 비회원 일주일 1번

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5-mini";
const MEMBER_WEEKLY = 2; // 회원: 일주일(최근 7일)에 2번
const ANON_WEEKLY = 1; // 비회원: 브라우저당 일주일에 1번
const WEEK_MS = 7 * 24 * 3600 * 1000;

/*
 * 남은 지원동기 진단 — 최근 7일 무료 횟수 + (회원) 친구 초대로 받은 추가 횟수
 *  - 무료: 최근 7일 안에 무료로 쓴 수를 뺀다. 가장 오래된 것이 7일 지나면 1번씩 다시 열린다
 *  - 추가: motive_bonus(친구 초대 보상)에서 받은 수 − 추가로 쓴 수
 * 돌려주는 값: { weekly, bonus, next } — next는 다음 무료 1번이 열리는 시각 (무료가 남아 있으면 null)
 */
async function creditsOf(admin: any, who: { userId?: string; clientId?: string }) {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const limit = who.userId ? MEMBER_WEEKLY : ANON_WEEKLY;
  let q = admin.from("motive_queries").select("created_at").eq("used_bonus", false).gte("created_at", since).order("created_at", { ascending: true });
  q = who.userId ? q.eq("user_id", who.userId) : q.is("user_id", null).eq("client_id", who.clientId);
  const { data: recent } = await q;
  let bonus = 0;
  if (who.userId) {
    const [{ data: gained }, { count: bonusUsed }] = await Promise.all([
      admin.from("motive_bonus").select("amount").eq("user_id", who.userId),
      admin.from("motive_queries").select("id", { count: "exact", head: true }).eq("user_id", who.userId).eq("used_bonus", true),
    ]);
    bonus = Math.max(0, (gained ?? []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0) - (bonusUsed ?? 0));
  }
  const used = recent?.length ?? 0;
  const weekly = Math.max(0, limit - used);
  const next = weekly > 0 || !recent?.length ? null : new Date(new Date(recent[0].created_at).getTime() + WEEK_MS).toISOString();
  return { weekly, bonus, next };
}

const SYSTEM = `고3 학생의 대입 지원동기(면접 답변 또는 자소서 문장)가 얼마나 흔한지 진단한다. JSON만 출력.

무효(지원동기가 아닌 글·의미 없는 문자열·부적절한 내용)면 {"invalid":true,"invalid_reason":"한 문장"}.

흔함 판단 — 입학사정관·면접관이 매년 수없이 듣는 표현일수록 흔하다:
- 막연한 시작: "어릴 때부터", "어렸을 때부터 꿈이었다", "막연히 관심이 있었다"
- 남의 이야기로 시작: "다큐멘터리/뉴스/책을 보고 감명받아", "OO한 사람을 보고"(자기 행동 없이)
- 누구나 쓰는 다짐: "사회에 기여하고 싶다", "~에 이바지하고 싶다", "최고의 OO이 되겠다", "사람들을 돕고 싶다"
- 학교 홍보 문구 되풀이: "우수한 교수진", "체계적인 커리큘럼", "글로벌 인재 양성"
- 구체적 경험·행동·배운 점이 없고 감정만 있음
score 0~100 (높을수록 흔함): 거의 모든 문장이 위 표현 85~100 / 대부분 흔하고 구체 경험이 조금 65~84 / 반반 40~64 / 구체 경험이 중심이고 흔한 표현이 조금 15~39 / 자기만의 장면·행동·배운 점으로 채워짐 0~14

[대학 면접 데이터]가 있으면 그 대학 기준으로도 본다 (없으면 univ_factors는 [], univ_summary·univ_question은 "")
- univ_factors: [대학 면접 데이터]의 평가요소마다 1개씩 (주어진 요소만, 주어진 순서대로)
  · seen 0~100: 이 지원동기에서 그 요소가 얼마나 분명하게 드러나는지 (구체적 경험·행동·근거가 있을수록 높게, 말로만 있으면 낮게)
  · evidence: 그 요소가 드러나는 학생 글의 구절을 **있는 그대로** 복사(3~40자). 드러나지 않으면 ""
  · tip: 이 대학 면접관 관점에서 이 요소를 어떻게 보강하면 되는지 한 문장 (학생 경험을 지어내지 않는다)
- univ_summary: 이 대학 기준으로 본 강점과 보완할 점 2문장. 대학 데이터에 있는 관점을 근거로 쓴다
- univ_question: 이 대학 질문 출제 특징대로 면접관이 이 지원동기를 듣고 던질 첫 질문 1개

모든 글은 쉬운 말, "~예요" 존댓말.

{"invalid":false,"score":0,
"univ_factors":[{"factor":"","seen":0,"evidence":"","tip":""}],"univ_summary":"","univ_question":""}`;

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
      max_completion_tokens: 8000,
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

function verdictLevel(score: number) {
  if (score >= 85) return 4; // 아주 흔해요
  if (score >= 65) return 3; // 흔한 편이에요
  if (score >= 40) return 2; // 조금 흔해요
  if (score >= 15) return 1; // 괜찮은 편이에요
  return 0; // 나만의 지원동기예요
}

const clean = (v: unknown, n = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* 대학 이름 → 찾기용 이름 (DB의 name_key와 같은 규칙: 괄호·띄어쓰기 빼고 '대학교'→'대') */
const univKey = (n: string) =>
  n.replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교/g, "대").replace(/대학/g, "대").toLowerCase();

/* 대학 면접 데이터 찾기 — 이름이 똑같은 것 먼저, 없으면 찾기용 이름으로 (본교를 캠퍼스보다 먼저) */
/* 줄임말로 적어도 찾게 — 데이터에 한 번만 넣은 대학의 다른 이름 */
const UNIV_ALIAS: Record<string, string> = {
  서울과기대: "서울과학기술대학교",
  과기대: "서울과학기술대학교",
  카이스트: "한국과학기술원(KAIST)",
  kaist: "한국과학기술원(KAIST)",
  한국과학기술원: "한국과학기술원(KAIST)",
  "카이스트(한국과학기술원)": "한국과학기술원(KAIST)",
  "공주대학교(예산)": "공주대학교",
  "공주대(예산)": "공주대학교",
};

async function findUniv(admin: any, name: string) {
  if (!name) return null;
  name = UNIV_ALIAS[name.replace(/\s/g, "")] ?? UNIV_ALIAS[name.replace(/\s/g, "").toLowerCase()] ?? name;
  const { data: exact } = await admin.from("univ_profiles").select("*").eq("name", name).maybeSingle();
  if (exact) return exact;
  const { data: list } = await admin.from("univ_profiles").select("*").eq("name_key", univKey(name));
  if (!list?.length) return null;
  return list.find((u: any) => !u.name.includes("(")) ?? list[0];
}

/* 평가요소 비중 → 큰 순서로 최대 4개, 합이 100이 되게 */
function topWeights(w: Record<string, number>) {
  const items = Object.entries(w ?? {}).filter(([, v]) => Number(v) > 0);
  const sum = items.reduce((a, [, v]) => a + Number(v), 0);
  if (!sum) return [];
  return items
    .map(([k, v]) => ({ factor: k, weight: Math.round((Number(v) / sum) * 100) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
}

/*
 * 친구 추천 보상 — 추천 링크로 가입한 친구가 이 진단을 처음 하면, 추천한 학생에게 추가 횟수를 준다
 * referrals: { referrer_id(추천한 학생), referred_user_id(가입한 친구) } — 탐구주제 추천과 같은 표
 * 같은 친구로는 한 번만 (bonus 표의 user_id+friend_id 중복 막기), 자기 자신은 제외
 */
async function rewardReferrer(admin: any, friendId: string, table: string, bonusTable: string, amount: number) {
  try {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", friendId);
    if ((count ?? 0) !== 1) return; // 방금 한 것이 이 친구의 첫 진단일 때만
    const { data: ref } = await admin
      .from("referrals").select("referrer_id").eq("referred_user_id", friendId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!ref?.referrer_id || ref.referrer_id === friendId) return;
    const { error } = await admin.from(bonusTable).insert({ user_id: ref.referrer_id, friend_id: friendId, amount, reason: "referral" });
    if (error && !String(error.message).includes("duplicate")) console.warn("referral bonus failed", error);
  } catch (e) {
    console.warn("referral bonus failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user ?? null;

    const body = await req.json();
    const university = clean(body.university, 40);
    const department = clean(body.department, 40);
    const useFor = body.use_for === "document" ? "document" : "interview";
    const motive = String(body.motive ?? "").trim().slice(0, 700);
    const clientId = clean(body.client_id, 64);
    if (!department) return json({ error: "지원 학과를 적어 주세요." }, 400);
    if (motive.length < 30) return json({ error: "지원동기를 30자 이상 적어 주세요." }, 400);
    if (!user && !clientId) return json({ error: "잠시 후 다시 시도해 주세요." }, 400);

    let isAdmin = false;
    if (user) {
      const { data } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      isAdmin = Boolean(data);
    }

    // 남은 횟수 — 회원: 이번 주 2번 먼저, 다 쓰면 친구 초대로 받은 추가 횟수 / 비회원: 일주일에 1번
    const credit = await creditsOf(admin, user ? { userId: user.id } : { clientId });
    if (!isAdmin && credit.weekly + credit.bonus <= 0) {
      return json({ quota_exceeded: true, is_member: Boolean(user), next_open: credit.next, weekly: user ? MEMBER_WEEKLY : ANON_WEEKLY });
    }
    const useBonus = Boolean(user) && !isAdmin && credit.weekly <= 0; // 이번 주 무료를 다 썼으면 추가 횟수에서 쓴다

    // 대학 면접 데이터 (있으면 그 대학 기준으로도 분석)
    const univ = await findUniv(admin, university);
    const weights = univ ? topWeights(univ.weights) : [];
    const univBlock =
      univ && weights.length
        ? `

[대학 면접 데이터] ${univ.name}
평가요소 비중(이 순서대로 univ_factors를 채운다): ${weights.map((w) => `${w.factor} ${w.weight}%`).join(", ")}
면접관 핵심 관점: ${univ.view}
질문 출제 특징: ${univ.question_style}
고득점 답변 구성: ${univ.best_answer}
선호하는 학생: ${univ.preferred}`
        : "";

    const ai = await ask(
      `[지원 대학] ${university || "(안 적음)"}
[지원 학과] ${department}
[쓰는 곳] ${useFor === "interview" ? "면접 답변 (말로 하는 답)" : "자소서·서류 (글)"}
[학생이 쓴 지원동기]
${motive}${univBlock}`,
      { service: "motive", userId: user?.id, clientId }
    );
    if (!ai) return json({ error: "진단하지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
    if (ai.invalid) return json({ invalid: true, invalid_reason: clean(ai.invalid_reason, 120) });

    const score = Math.max(0, Math.min(100, Math.round(Number(ai.score) || 0)));
    const result = {
      score,
      verdict_level: verdictLevel(score),
      // 대학 기준 분석 — 우리 대학별 면접 데이터가 있을 때만
      univ:
        univ && weights.length
          ? {
              name: univ.name,
              view: clean(univ.view, 300), // 면접관 핵심 관점 (화면에 한 줄 보여준다)
              factors: weights.map((w) => {
                const f = (ai.univ_factors ?? []).find((x: any) => clean(x?.factor, 20) === w.factor) ?? {};
                const ev = String(f.evidence ?? "").trim();
                return {
                  factor: w.factor,
                  weight: w.weight,
                  seen: Math.max(0, Math.min(100, Math.round(Number(f.seen) || 0))),
                  evidence: ev && motive.includes(ev) ? ev : "", // 학생 글에 실제로 있는 구절만
                  tip: clean(f.tip, 200),
                };
              }),
              summary: clean(ai.univ_summary, 300),
              question: clean(ai.univ_question, 200),
            }
          : null,
    };

    await admin.from("motive_queries").insert({
      user_id: user?.id ?? null,
      client_id: clientId || null,
      university: university || null,
      department,
      use_for: useFor,
      motive,
      result,
      used_bonus: useBonus,
    });

    // 이 학생이 친구 추천으로 가입했고 이번이 첫 진단이면, 추천한 학생에게 +1번
    if (user) await rewardReferrer(admin, user.id, "motive_queries", "motive_bonus", 1);

    // 이번 진단을 쓴 뒤 남은 횟수 (방금 쓴 것까지 넣어 다시 계산)
    let remaining: number | null = null;
    let nextOpen: string | null = null;
    let bonusLeft = 0;
    if (!isAdmin) {
      const c = await creditsOf(admin, user ? { userId: user.id } : { clientId });
      remaining = c.weekly + c.bonus;
      bonusLeft = c.bonus;
      nextOpen = c.next;
    }
    return json({ ...result, remaining, bonus_left: bonusLeft, next_open: nextOpen, is_member: Boolean(user) });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});