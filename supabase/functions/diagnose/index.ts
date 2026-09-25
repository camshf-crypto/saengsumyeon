// 탐구주제 진단 — GPT-5 호출 + DB 유사사례 조회 + 입력 로그 저장
// 배포: npx supabase functions deploy diagnose

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gpt-5";
const DAILY_LIMIT = 3; // 로그인: 하루 3회
const ANON_LIMIT = 1; // 비로그인: 브라우저당 하루 1회

// 제안 주제에 연도·날짜가 들어갔는지 (예: 2024, 1901~1933, 24년, 10~12월)
const DATE_RE = /\d{4}|\d{1,2}\s*년(?!생)|\d{1,2}\s*월|\d+\s*[~.]\s*\d+/;

const SYSTEM = `세특 탐구주제가 얼마나 흔한지 채점하고, 좁힌 대안 1개를 제시한다. JSON만 출력.

무효(의미 없는 문자열·탐구가 아닌 요청·부적절한 내용)면 {"invalid":true,"invalid_reason":"한 문장"}. 오타나 거친 표현은 채점한다.

채점(높을수록 흔함, 제시된 값만). 입력에 드러나지 않은 항목은 최고점을 준다:
소재 40/30/20/10/5/0: 누구나 떠올리는 소재(카페인·기후변화)→독창적
대상 20/15/10/5/0: 다루는 사람·사물이 막연함("우리 삶", "DNA")→넓은 범주→특정 종류→특정 집단·시료→직접 정한 한 집단·한 시료
조건 20/15/10/5/0: 없음→막연함→1개 분명→2개 이상→변수·비교군 모두 지정
방식 20/15/10/5/0: 자료 정리→사례+의견→두 대상 비교→설문·조사→실험·측정
[실제 세특 기록]은 같은 학과 학생들의 실제 기록이다. 비슷한 기록이 많을수록 소재 점수를 높이고, 대안은 이 기록들과 겹치지 않게 한다. 주제와 관련 없는 기록은 무시한다.

대안:
- 학생의 관심 소재는 살리고 [방향]에 맞춰 좁힌다. 단, 질문이 비현실적이거나 사실·논리가 맞지 않으면(예: "초전도체로 건물 띄우기") 관심은 살린 채 실제로 탐구할 수 있는 질문으로 바꾼다
- 방법은 주제에 맞춘다: 수량 관계는 모형·계산, 자연 현상은 실험·측정, 글·사회 현상은 문헌·사례 비교. 설문은 사람의 인식·행동을 다룰 때만 쓰고, "우리 학교"나 설문을 억지로 붙이지 않는다
- 과목은 주제와 자연스럽게 이어질 때만 그 과목의 개념·활동을 활용한다. 어울리지 않으면 과목에 억지로 엮지 않는다
- 난이도는 학생이 쓴 주제 수준을 기준으로 조금만(80% 정도) 낮춘다. 쉬운 주제는 쉽게, 어려운 주제는 어렵게 두고, 학생이 쓴 개념·도구(예: 매트랩, 미카엘리스-멘텐)는 맞게 쓰였으면 살린다
- 학생이 직접 구할 수 없는 자료(해외 기관 내부 자료·임상 수치)와 "규명" 같은 과한 목표만 뺀다
- 비교하면 무엇과 무엇인지 밝히고, 참고 사례를 쓰면 그것을 어떻게 활용하는지까지 한 흐름으로 쓴다
- 40~60자 한 문장, 명사 나열 금지, "~하는 탐구"로 끝맺는다
- [방향]은 내용으로만 반영한다. "~관점에서", "~수준으로", 학생 학년 같은 지시 표현을 주제에 쓰지 않는다
- 연도·날짜·기간 숫자, 합격 단정, 가짜 통계 금지
reason과 how는 "~예요" 존댓말. reason은 매긴 점수와 맞게 쓰고, how에는 좁힌 방법과 계열·전공·직업의 연결점을 쓴다. 질문을 크게 바꿨다면 왜 바꿨는지도 how에 짧게 쓴다.

{"invalid":false,"breakdown":{"소재":0,"대상":0,"조건":0,"방식":0},"reason":"흔한 이유 2~3문장(소재·방식)","suggestion":{"topic":"","how":"한 문장"}}`;

/* 학년별 대안 방향 — 입력에는 해당 학년 한 줄만 넣는다 */
const DIRECTION: Record<string, string> = {
  고1: "희망학과가 속한 큰 계열(인문·사회·자연·공학·의약·교육·예체능) 전반에 두루 쓰일 내용으로 넓게 잡는다. 흔함 40~55 정도로 가볍게 좁힌다.",
  고2: "희망학과 전공에서 실제로 배우는 개념과 직접 이어지게 한다. 흔함 30~45 정도로 좁힌다.",
  고3: "희망학과 졸업 후 직업의 실제 업무·현장 문제와 이어지게 한다. 흔함 30~45 정도로 좁힌다.",
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

/* GPT-5 호출 → { result, raw } 또는 { error } */
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

/* 항목 점수를 허용된 값으로 맞추고 총점을 직접 계산한다 */
const ALLOWED: Record<string, number[]> = {
  소재: [40, 30, 20, 10, 5, 0],
  대상: [20, 15, 10, 5, 0],
  조건: [20, 15, 10, 5, 0],
  방식: [20, 15, 10, 5, 0],
};

function scoreOf(r: any) {
  const b: Record<string, number> = {};
  for (const [k, vals] of Object.entries(ALLOWED)) {
    const v = Number(r?.breakdown?.[k]);
    // 허용 값이 아니면 가장 가까운 값으로 (값이 없으면 최고점 = 흔함)
    b[k] = Number.isFinite(v)
      ? vals.reduce((a, c) => (Math.abs(c - v) < Math.abs(a - v) ? c : a))
      : vals[0];
  }
  return { breakdown: b, score: Object.values(b).reduce((a, c) => a + c, 0) };
}

/* 대안이 규칙(날짜 금지·40~60자)을 어겼으면 고칠 내용을 돌려준다 */
function problems(r: any): string[] {
  const t = String(r?.suggestion?.topic ?? "");
  if (r?.invalid || !t) return [];
  const out: string[] = [];
  if (DATE_RE.test(t + (r.suggestion.how ?? ""))) out.push("연도·날짜·기간 숫자를 모두 빼세요.");
  if (t.length < 40 || t.length > 70) out.push(`대안 주제가 ${t.length}자입니다. 40~60자 한 문장으로 쓰세요.`);
  if (/관점에서|관점으로|계열별|고[123]|수준으로|수준에서/.test(t)) out.push('"~관점에서", "고2 수준" 같은 지시 표현을 빼고 실제 내용으로 쓰세요.');
  if (/하겠|규명/.test(t)) out.push('"~하겠다", "규명" 같은 표현 없이 "~하는 탐구"로 쓰세요.');
  if (!/탐구$/.test(t.trim().replace(/[.。]$/, ""))) out.push('대안 주제는 "~탐구"로 끝맺으세요.');
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
    let similarCount = 0;
    if (kws.length) {
      const { data } = await supabase
        .from("topic_db")
        .select("inquiry")
        .eq("department", department)
        .or(kws.map((k) => `inquiry.ilike.%${k}%`).join(","))
        .limit(50);

      // 키워드가 하나만 겹치는 엉뚱한 기록은 버린다 (키워드가 2개 이상일 때)
      const need = Math.min(2, kws.length);
      const ranked = (data ?? [])
        .map((r: { inquiry: string }) => ({ t: r.inquiry, n: kws.filter((k) => r.inquiry.includes(k)).length }))
        .filter((x) => x.n >= need)
        .sort((x, y) => y.n - x.n);

      similarCount = ranked.length;
      similar = ranked.slice(0, 3).map((x) => x.t);
    }

    // 2) GPT-5 채점
    const userMsg = [
      `희망학과: ${department}`,
      `학년: ${grade ?? ""} ${term ?? ""}`.trim(),
      `과목: ${subject}`,
      `탐구주제: ${topic}`,
      `[방향] ${DIRECTION[grade] ?? DIRECTION["고2"]}`,
      "",
      `[실제 세특 기록] 같은 학과에서 비슷한 탐구 ${similarCount >= 50 ? "50건 이상" : `${similarCount}건`}`,
      ...similar.map((s) => `- ${s}`),
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

    if (ans.result.invalid === true) {
      return json({ invalid: true, invalid_reason: ans.result.invalid_reason ?? "" });
    }
    const result = { ...ans.result, ...scoreOf(ans.result) };

    // 3) 저장 (같은 주제가 다시 오면 재사용)
    const full = { ...result, similar_count: similarCount, similar };
    const { error: logErr } = await supabase.from("topic_queries").insert({
      user_id: user_id ?? null,
      client_id: client_id ?? null,
      department,
      grade: grade ?? "",
      term: term ?? null,
      subject,
      topic,
      score: result.score ?? null,
      match_count: similarCount,
      result: full,
    });
    if (logErr) console.error("log insert failed", logErr);

    return json(full);
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});