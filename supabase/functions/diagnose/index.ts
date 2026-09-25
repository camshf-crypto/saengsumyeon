// 탐구주제 진단 — GPT-5 mini 호출 + DB 유사사례 조회 + 입력 로그 저장
// 배포: npx supabase functions deploy diagnose

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gpt-5-mini";
const DAILY_LIMIT = 3; // 로그인: 하루 3회
const ANON_LIMIT = 1; // 비로그인: 브라우저당 하루 1회

// 제안 주제에 연도·날짜가 들어갔는지 (예: 2024, 1901~1933, 24년, 10~12월)
const DATE_RE = /\d{4}|\d{1,2}\s*년(?!생)|\d{1,2}\s*월|\d+\s*[~.]\s*\d+/;

const SYSTEM = `세특 탐구주제가 얼마나 흔한지 채점하고, 좁힌 대안 1개를 제시한다. JSON만 출력.

무효(의미 없는 문자열·탐구가 아닌 요청·부적절한 내용)면 {"invalid":true,"invalid_reason":"한 문장"}. 표현이 거칠 뿐이면 채점한다.

채점(높을수록 흔함, 제시된 값만):
소재 40/30/20/10/5/0: 흔한 소재(카페인·기후변화)→독창적
대상 20/15/10/5/0: 없음→청소년→고등학생→고3 수험생→우리 학교 특정 집단
조건 20/15/10/5/0: 없음→막연함→1개 분명→2개 이상→변수·비교군 지정
방식 20/15/10/5/0: 자료 정리→사례+의견→비교→설문·조사→실험·측정

대안:
- 원래 소재를 유지하고, 입력의 [방향]에 맞춰 좁힌다
- 해당 과목 수업에서 고등학생이 2~3주에 할 수준(조건 1개, 비교는 둘까지, 문헌·설문·관찰 위주, 실험은 과학 과목만)
- 40~60자 완결 문장, 명사 나열 금지
- 연도·날짜·기간 숫자 금지("최근 6개월"처럼)
- 합격 단정·가짜 통계 금지
reason과 how는 "~예요" 존댓말. how에는 좁힌 방법과 [방향]의 연결점을 함께 쓴다.

{"invalid":false,"score":0,"breakdown":{"소재":0,"대상":0,"조건":0,"방식":0},"reason":"흔한 이유 2~3문장(소재·방식)","suggestion":{"topic":"","how":"한 문장"}}`;

/* 학년별 대안 방향 — 입력에는 해당 학년 한 줄만 넣는다 */
const DIRECTION: Record<string, string> = {
  고1: "고1 — 희망학과가 속한 계열(인문·사회·자연·공학·의약·교육·예체능) 전반과 넓게 연결한다. 흔함 40~55 정도로 가볍게 좁힌다.",
  고2: "고2 — 희망학과의 전공 내용과 직접 연결되게 맞춘다. 흔함 30~45 정도로 좁힌다.",
  고3: "고3 — 희망학과를 졸업한 뒤의 직업군, 실제 업무·현장과 연결되게 맞춘다. 흔함 30~45 정도로 좁힌다.",
};

/* 어느 탐구에나 들어가는 말은 유사사례 검색에서 뺀다 */
const STOP = new Set([
  "영향", "분석", "탐구", "연구", "조사", "방안", "사례", "활용", "변화", "관계",
  "통해", "미치는", "대한", "대해", "따른", "위한", "중요", "필요", "문제",
  "방법", "과정", "결과", "효과", "비교", "이해", "적용", "개선", "발전", "가능",
  "사회", "학생", "우리", "현대", "최근", "다양", "다양한",
]);

function keywords(topic: string): string[] {
  return [
    ...new Set(
      topic
        .split(/[^가-힣a-zA-Z0-9]+/)
        .map((w) => w.replace(/(이|가|은|는|을|를|의|에|와|과|로|으로|에서|에게|도|만|부터|까지)$/, ""))
        .filter((w) => w.length >= 2 && !STOP.has(w))
    ),
  ].slice(0, 4);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Msg = { role: "system" | "user" | "assistant"; content: string };

/* GPT-5 mini 호출 → { result, raw } 또는 { error } */
async function ask(messages: Msg[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 8000, // 내부 추론에 먼저 쓰이므로 넉넉히
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error("openai error", res.status, body.slice(0, 1000));
    return { error: "진단에 실패했습니다." };
  }

  const raw: string = JSON.parse(body).choices?.[0]?.message?.content ?? "";
  try {
    return { result: JSON.parse(raw.replace(/```json|```/g, "").trim()), raw };
  } catch {
    console.error("parse failed", raw.slice(0, 1000));
    return { error: "진단 결과를 읽지 못했습니다." };
  }
}

/* 대안이 규칙(날짜 금지·40~60자)을 어겼으면 고칠 내용을 돌려준다 */
function problems(r: any): string[] {
  const t = String(r?.suggestion?.topic ?? "");
  if (r?.invalid || !t) return [];
  const out: string[] = [];
  if (DATE_RE.test(t + (r.suggestion.how ?? ""))) out.push("연도·날짜·기간 숫자를 모두 빼세요.");
  if (t.length < 40 || t.length > 70) out.push(`대안 주제가 ${t.length}자입니다. 40~60자의 완결된 문장으로 쓰세요.`);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { department, grade, term, subject, topic, user_id, client_id } = await req.json();
    if (!topic || !department || !subject) return json({ error: "입력값이 부족합니다." }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 0) 같은 주제면 저장된 결과를 쓰고, 아니면 하루 사용량 확인
    const { data: quota, error: quotaErr } = await supabase
      .rpc("check_topic_quota", {
        p_user_id: user_id ?? null,
        p_client_id: client_id ?? null,
        p_department: department,
        p_subject: subject,
        p_topic: topic,
        p_daily_limit: DAILY_LIMIT,
        p_anon_limit: ANON_LIMIT,
      })
      .single();
    if (quotaErr) console.error("quota check failed", quotaErr);

    if (quota?.cached) return json({ ...quota.cached, from_cache: true });
    if (quota && quota.allowed === false) {
      return json({
        quota_exceeded: true,
        used_today: quota.used_today,
        daily_limit: user_id ? DAILY_LIMIT : ANON_LIMIT,
        is_member: Boolean(user_id),
      });
    }

    // 1) 같은 학과의 실제 유사 탐구를 참고자료로
    const kws = keywords(topic);
    let similar: string[] = [];
    if (kws.length) {
      const { data } = await supabase
        .from("topic_db")
        .select("inquiry")
        .eq("department", department)
        .or(kws.map((k) => `inquiry.ilike.%${k}%`).join(","))
        .limit(3);
      similar = (data ?? []).map((r: { inquiry: string }) => r.inquiry);
    }

    // 2) GPT-5 mini 채점
    const userMsg = [
      `희망학과: ${department}`,
      `학년: ${grade ?? ""} ${term ?? ""}`.trim(),
      `과목: ${subject}`,
      `탐구주제: ${topic}`,
      `[방향] ${DIRECTION[grade] ?? DIRECTION["고2"]}`,
      ...(similar.length ? ["", "[같은 학과 실제 유사 탐구]", ...similar.map((s) => `- ${s}`)] : []),
    ].join("\n");

    const messages: Msg[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: userMsg },
    ];

    let ans = await ask(messages);
    if (ans.error) return json({ error: ans.error }, 502);

    // 규칙을 어겼으면 한 번만 다시 쓰게 한다 (실패하면 첫 결과 사용)
    const fix = problems(ans.result);
    if (fix.length) {
      const retry = await ask([
        ...messages,
        { role: "assistant", content: ans.raw! },
        { role: "user", content: `고쳐서 같은 JSON 전체를 다시 출력하세요.\n- ${fix.join("\n- ")}` },
      ]);
      if (!retry.error) ans = retry;
    }

    const result = ans.result;
    if (result.invalid === true) return json({ invalid: true, invalid_reason: result.invalid_reason ?? "" });

    // 3) 저장 (같은 주제가 다시 오면 재사용)
    const full = { ...result, similar_count: similar.length, similar };
    const { error: logErr } = await supabase.from("topic_queries").insert({
      user_id: user_id ?? null,
      client_id: client_id ?? null,
      department,
      grade: grade ?? "",
      term: term ?? null,
      subject,
      topic,
      score: result.score ?? null,
      match_count: similar.length,
      result: full,
    });
    if (logErr) console.error("log insert failed", logErr);

    return json(full);
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});