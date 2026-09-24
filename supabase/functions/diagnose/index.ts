// 탐구주제 진단 — GPT-5 호출 + DB 유사사례 조회 + 입력 로그 저장
// 배포: npx supabase functions deploy diagnose

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "gpt-5";
const DAILY_LIMIT = 3; // 로그인한 사람이 하루에 새로 진단할 수 있는 횟수
const ANON_LIMIT = 1; // 로그인 전에는 브라우저당 하루 1회

const SYSTEM = `당신은 고등학교 생활기록부 세특 탐구주제를 진단하는 전문가입니다.
학생이 제출한 탐구주제가 얼마나 흔한지 채점하고, 더 좁힌 대안을 제시합니다.

[먼저 판단할 것]
입력이 탐구주제로 성립하는지 확인하세요.
아래에 해당하면 채점하지 말고 이 JSON만 출력하세요.
{ "invalid": true, "invalid_reason": "왜 성립하지 않는지 한 문장" }

- 의미 없는 문자열 ("ㅁㄴㅇㄹ", "asdf", "테스트", 자모 나열)
- 무엇을 알아보려는지 전혀 읽히지 않는 문장
- 탐구가 아닌 요청이나 질문 ("숙제 해줘", "안녕")
- 욕설이나 부적절한 내용

단, 표현이 어색하거나 범위가 막연한 것만으로는 무효가 아닙니다.
문법이 거칠어도 무엇을 알아보려는지 읽히면 채점하세요.
고등학생이 쓴 다듬어지지 않은 주제를 함부로 무효로 처리하지 마세요.

[채점 방식]
아래 네 항목의 점수를 합산합니다. 총점 0~100, 높을수록 흔함.
반드시 제시된 값 중 하나만 고르세요. 그 사이 값은 쓰지 않습니다.

1. 소재 흔함 (0~40)
   40  거의 모든 학생이 떠올리는 소재 (카페인, 미세먼지, 플라스틱, ESG, 기후변화 등)
   30  자주 보이는 소재
   20  더러 보이는 소재
   10  드물게 보이는 소재
    5  거의 못 본 소재
    0  독창적인 소재

2. 대상 구체성 (0~20)
   20  대상이 없거나 "현대 사회", "사람들" 수준
   15  "청소년", "학생" 수준
   10  "고등학생", "여성" 수준
    5  "고3 수험생", "기숙사 거주 학생" 수준
    0  "우리 학교 3학년 야자 참여 학생" 수준

3. 조건·변수 구체성 (0~20)
   20  아무 조건 없음 ("~가 ~에 미치는 영향")
   15  조건 하나가 막연하게 언급됨
   10  조건 하나가 분명함 (시간대, 계절, 지역 중 하나)
    5  조건 둘 이상이 분명함
    0  측정 변수와 비교군이 모두 지정됨

4. 탐구 방식 (0~20)
   20  자료를 찾아 정리하는 수준
   15  사례를 소개하고 의견을 붙이는 수준
   10  두 대상을 비교하는 수준
    5  직접 조사하거나 설문을 수행하는 수준
    0  실험·측정으로 검증하는 수준

[판정 문구]
85~100  아주 흔해요
65~80   흔한 편이에요
45~60   조금 흔해요
25~40   괜찮은 편이에요
0~20    드문 편이에요

[대안 규칙]
- 학생의 원래 주제에서 출발할 것. 다른 소재로 바꾸지 말 것
- 대안은 딱 1개만 제시할 것. 흔함 점수를 가장 크게 낮출 수 있는 방향으로 좁힐 것
- 고등학생이 학교 환경에서 실제로 수행 가능할 것
  (대학 실험실 장비, 대규모 데이터, 임상 자료가 필요한 주제는 금지)
- 해당 과목 수업에서 다룰 수 있는 범위일 것
- 주제는 한 문장, 45자 이내
- 대안도 같은 방식으로 채점할 것
- 무엇을 어떻게 좁혔는지 한 문장으로 설명할 것

[금지]
- 합격을 보장하거나 평가 결과를 단정하는 표현
- "몇 퍼센트의 학생이" 처럼 실제 통계인 척하는 수치

성립하는 주제라면 아래 형태의 JSON만 출력하세요.
{
  "invalid": false,
  "score": 85,
  "breakdown": { "소재": 40, "대상": 15, "조건": 20, "방식": 10 },
  "verdict": "아주 흔해요",
  "reason": "왜 흔한지 2~3문장. 소재와 접근 방식을 각각 짚을 것",
  "suggestion": {
    "topic": "좁힌 주제 한 문장",
    "score": 15,
    "how": "무엇을 어떻게 좁혔는지 한 문장"
  }
}`;

/* 어느 탐구에나 들어가는 말은 검색에서 뺀다 */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { department, grade, term, subject, topic, user_id, client_id } = await req.json();

    if (!topic || !department || !subject) {
      return new Response(JSON.stringify({ error: "입력값이 부족합니다." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 0) 같은 주제가 이미 있으면 그걸 쓰고, 없으면 하루 사용량을 확인한다
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

    // 같은 주제로 이미 진단한 결과가 있으면 AI를 부르지 않는다
    if (quota?.cached) {
      return new Response(JSON.stringify({ ...quota.cached, from_cache: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 하루 한도를 넘었으면 안내만 돌려준다
    if (quota && quota.allowed === false) {
      return new Response(
        JSON.stringify({
          quota_exceeded: true,
          used_today: quota.used_today,
          daily_limit: user_id ? DAILY_LIMIT : ANON_LIMIT,
          is_member: Boolean(user_id),
        }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 1) 같은 학과에서 실제로 나온 유사 탐구를 참고자료로 뽑는다
    const kws = keywords(topic);
    let similar: string[] = [];

    if (kws.length > 0) {
      const { data } = await supabase
        .from("topic_db")
        .select("inquiry")
        .eq("department", department)
        .or(kws.map((k) => `inquiry.ilike.%${k}%`).join(","))
        .limit(5);
      similar = (data ?? []).map((r: { inquiry: string }) => r.inquiry);
    }

    // 2) GPT-5에게 채점과 대안을 맡긴다
    const userMsg = [
      "[학생 정보]",
      `희망학과: ${department}`,
      `학년: ${grade ?? ""} ${term ?? ""}`.trim(),
      `과목: ${subject}`,
      "",
      "[탐구주제]",
      topic,
      ...(similar.length
        ? ["", "[참고 — 같은 학과에서 실제로 나온 유사 탐구]", ...similar.map((s) => `- ${s}`)]
        : []),
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: MODEL,
        // GPT-5는 답을 쓰기 전에 내부 추론에 토큰을 먼저 쓴다.
        // 넉넉히 주고 추론은 얕게 해야 본문이 잘리지 않는다.
        max_completion_tokens: 8000,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
      }),
    });

    const bodyText = await res.text();

    if (!res.ok) {
      console.error("openai http error", res.status, bodyText.slice(0, 1500));
      return new Response(
        JSON.stringify({ error: "진단에 실패했습니다.", debug: bodyText.slice(0, 500) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.parse(bodyText);
    const choice = payload.choices?.[0];
    const text = choice?.message?.content ?? "";

    // 본문이 비면 왜 끊겼는지 로그에 남긴다
    if (!text.trim()) {
      console.error(
        "empty content",
        "finish_reason=", choice?.finish_reason,
        "usage=", JSON.stringify(payload.usage)
      );
      return new Response(
        JSON.stringify({
          error: "진단 결과를 받지 못했습니다.",
          debug: { finish_reason: choice?.finish_reason, usage: payload.usage },
        }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let result;
    try {
      result = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      console.error("json parse failed. raw =", text.slice(0, 1500));
      return new Response(
        JSON.stringify({ error: "진단 결과를 읽지 못했습니다.", debug: text.slice(0, 500) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 탐구주제로 성립하지 않는 입력 — 점수를 매기지 않고 그대로 돌려준다
    if (result.invalid === true) {
      return new Response(
        JSON.stringify({ invalid: true, invalid_reason: result.invalid_reason ?? "" }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 3) 입력과 결과를 저장한다 (다음에 같은 주제가 오면 이걸 재사용)
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

    return new Response(JSON.stringify(full), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("unhandled", e);
    return new Response(JSON.stringify({ error: "서버 오류가 발생했습니다." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});