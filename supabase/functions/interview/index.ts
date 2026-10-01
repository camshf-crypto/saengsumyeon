// 내 생기부 면접 예상 질문 — 학생이 학년·학기별 활동(세특·동아리·진로·자율)을 칸에 채우면
// 지원 대학의 면접 데이터(평가요소 비중·질문 출제 특징)에 맞춰 예상 질문만 뽑는다 (꼬리 질문·답변 없음)
// 배포: npx supabase functions deploy interview --project-ref xhywexuazwipwvzrldwo --no-verify-jwt
//
// 요청 { university, department, activities: [{ grade, term, kind, subject?, content }], agreed: true, mode: "preview" | "full" }
//   kind: subject(교과 세특) | club(동아리) | career(진로) | autonomy(자율·봉사)
// 응답 { result: { university, department, groups, total, has_univ_data }, preview, paid }
//   활동 하나당 질문은 딱 1개 (AI에게 지시하고, 서버에서도 활동 수로 잘라낸다)
//   결제 전(preview): 계정당 1번, 무조건 5개 (활동이 4개면 1순위 활동에서 1개 더). 이미 뽑았으면 그때 결과를 다시 돌려준다 (AI를 다시 부르지 않음)
//   결제 후(full): 활동당 1개 전체, 하루 3번
//     상품 interview(1곳 19,000원)는 처음 뽑은 대학으로 고정, interview6(6곳 24,000원)은 대학 6곳까지
//     요청 targets: [{ university, department }] (1~6곳) — 대학마다 질문을 따로 뽑아 results 배열로 돌려준다
//     { action: "status" } → { paid, plan: "one" | "six", used: [이미 뽑은 대학] }
//     record_text(가이드대로 ChatGPT가 요약한 생기부)를 보내면 gpt-5-mini가 먼저 활동 하나하나로 나눈 뒤 질문을 뽑는다
//     '한 활동'은 질문 재료(content), '학과와 닿는 지점'은 DB(record_activities.dept_link)에만 저장 — 질문 AI에는 넘기지 않는다
//   비회원(preview): 브라우저(client_id)당 1번, 뽑아 저장하고 화면에는 2개만 보낸다
//   가입 후 { action: "claim", client_id } → 비회원 기록을 계정으로 옮기고 전부 돌려준다
// 활동은 record_activities에 한 줄씩, 뽑은 결과는 interview_queries에 저장한다 (학생 동의 후)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5";
const DAILY_LIMIT = 3; // 결제 후 하루 3번 뽑기
const PREVIEW_COUNT = 5; // 결제 전 질문 수 상한 (활동당 1개)
const GUEST_SHOW = 2; // 비회원에게 또렷하게 보여주는 질문 수 (나머지는 가입하면 보인다)
const MAX_ACTIVITIES = 80; // 활동 칸 최대 수 (고1~고3 전체)
const KIND_LABEL: Record<string, string> = { subject: "교과 세특", club: "동아리", career: "진로", autonomy: "자율·봉사" };
const EXTRACT_MODEL = "gpt-5-mini"; // 붙여 넣은 요약을 활동으로 나누는 가벼운 모델
const MAX_TEXT = 20000; // 붙여 넣기 최대 글자 수
const GRADES = ["고1", "고2", "고3"];
const TERMS = ["1학기", "2학기"];

const SYSTEM = `너는 지원 학과의 교수이자 면접관이다. 고3 학생의 대입 면접 예상 질문을 뽑는다. JSON만 출력.

입력: 학생이 학년·학기별로 채운 생활기록부 활동(교과 세특·동아리·진로·자율), 지원 대학·학과, (있으면) 그 대학의 면접 데이터.

[질문의 목적 — 가장 먼저 기억할 것]
너는 학생이 적은 활동을 보고 두 가지를 확인하는 교수다. 모든 학과가 똑같다.
1) 진짜 아는가 — 활동에서 다룬 개념·원리·내용을 학생이 제대로 이해하고 있는지
2) 진짜 해봤는가 — 그 활동을 직접 하면서 알게 된 점·느낀 점·자기 생각이 있는지
생기부에 적힌 활동을 그대로 짚고, 그 내용을 학생 입으로 설명하게 만든다.

[질문 유형 — 활동 내용에 맞는 것을 고른다]
- 개념 설명: "탄소순환의 개념에 대해 설명해주세요." / "CT의 개념과 장단점에 대해 설명해주세요."
- 차이·비교: "X-ray와 MRI의 차이점은 무엇인가요?"
- 특성·사례: "조영제로 활용되는 아이오딘의 특성과 활용 사례는?"
- 문제·해결: "CT의 단점을 해결할 수 있는 방안을 말해줄래요?" / "방사선 암치료 시 부작용은 무엇이 있나요?"
- 알게 된 점·느낀 점: "DNA 추출 실험을 통해 알게 된 점은?" / "뇌과학 콘서트에 참여했는데 무엇을 느꼈나요?"
- 구체적으로 다시 말하기: "의료 윤리 원칙을 탐구하며 선택지 4가지를 소개했는데 구체적으로 말해줄래요?"
- 자기 의견(찬반·사회 이슈를 다룬 활동일 때): "인공장기 상용화에 대한 본인의 생각을 말해주세요." / "베이비박스 제도를 합법화해야 하는지 의견을 말해주세요."
- 활동을 먼저 짚고 묻기: "진로 탐구로 '의료 파장 연구'를 했는데, X-ray와 MRI의 차이점은 무엇인가요?"
- 입장 되묻기(학생이 찬반·주장을 낸 활동일 때 — 학생 주장의 약점을 찌른다): "백신 접종 의무화에 반대했는데, 공공의 이익은 고려하지 않았나요?" / "범죄자 신상 공개를 주장했는데, 범죄자의 인권은요?"
- 출처·방법 확인(조사·통계·보고서 활동일 때): "탐구 보고서에 쓴 통계 자료의 출처는 어디인가요?" / "그 데이터는 어떤 방법으로 분석했나요?"
- 개념 확인: "정당방위의 성립 요건은 무엇인가요?" / "소멸시효와 공소시효의 차이점은 무엇인가요?"
- 주제를 시사로 넓히기(활동 주제와 바로 이어지는 사회 이슈만): "AI가 쓴 서면으로 승소한 사례가 있는데, 변호사가 AI로 대체될 수 있다고 보나요?"
- 학년 흐름(여러 학년 활동이 있을 때): "1학년 법조인, 2학년 진로 탐색 중, 3학년 다시 법조인인데 계기가 있나요?" / "2학년엔 시사법률동아리 회장이었는데 3학년엔 사회탐구동아리를 한 이유는?"
- 전공 관점으로 묻기(1순위 활동일 때): 활동 주제를 지원 학과의 입장에서 설명하거나 해결하게 한다. "AI 데이터 분석이 심리 연구에서 갖는 한계는 무엇인가요?" / "경영인이라면 택배 노동자 문제에 어떻게 대처하겠어요?"
(위 문장은 방사선학과·법학과·심리학과·경영학과 학생의 예시다. 말투와 묻는 방식만 따르고 문장을 그대로 베끼지 않는다. 다른 학과도 같은 방식으로 묻는다)
- 학생이 찬반·주장을 낸 활동이 있으면 입장 되묻기를 꼭 섞는다. 면접관이 가장 많이 쓰는 검증 방식이다
- 활동마다 그 활동을 가장 잘 확인할 수 있는 유형을 고르고, 전체 질문이 한 유형에 몰리지 않게 섞는다
- 개념 질문은 학생이 활동에서 직접 다룬 개념, 또는 그 주제를 했다면 당연히 알아야 할 기본 개념만 묻는다. 활동과 상관없는 전공 지식은 묻지 않는다
- 교과 세특 질문은 "○○ 시간에 ~했는데,"로 과목을 먼저 짚는다. 과목과 활동 내용이 잘 안 이어져 보이면(예: 수학 시간에 한옥과 건강을 조사) 그 과목을 어떻게 썼는지 묻는다
  예: "수학 시간에 한옥이 건강에 미치는 영향을 조사했는데, 수학은 어디에 활용했나요?"

[학과와 연결되는 활동 찾기]
- 지원 학과에서 배우는 내용·핵심 개념·관련 교과를 떠올리고, 학생이 적은 모든 활동 중 학과와 직접·간접으로 연결되는 활동을 찾는다
- 과목 이름이 같다는 이유만으로 연결하지 않는다. 실제로 배우거나 조사·탐구·실험·발표한 내용이 있어야 한다

[가장 중요한 규칙 — 모든 질문은 생기부 안에서]
- 모든 질문은 학생이 적은 활동 하나를 근거로 하고, 그 활동의 주제·개념어·활동 이름을 질문 문장에 넣는다
- 일반 인성 질문("장점과 단점은?", "갈등을 해결한 경험은?"), 활동과 상관없는 지원동기 질문("왜 우리 학교에 지원했나요?")은 금지
- 학생이 적지 않은 결과·경험을 지어내서 사실처럼 묻지 않는다

[활동 하나당 질문 1개]
- 활동 하나로 질문은 딱 1개만 만든다 (결제 전 5개를 채울 때만 예외)

[질문 말투 — 면접장에서 교수가 말로 묻는 것처럼]
- 물음표는 질문마다 딱 1개. "~은? ~는?"처럼 두 개를 이어 붙이지 않는다. 묻고 싶은 게 두 개면 더 중요한 하나만 남긴다
- 완전한 문장으로 쓴다. "핵심 근거는?", "동선·안전 설계는?"처럼 명사만 줄여 붙인 말투는 쓰지 않는다
  나쁜 예: "한옥의 건강 영향 핵심 근거는? 조사 후 관점 변화는?" → 좋은 예: "한옥이 건강에 좋다고 한 근거는 무엇인가요?"
- 20~50자 (활동이나 학생 주장을 먼저 짚고 물을 때는 80자까지)
- 학생이 쓴 활동 이름·책 제목·주제·개념어를 그대로 쓴다. 학생이 쓰지 않은 전문 용어(하중 경로, 트러스, 동선 설계 등)를 끌어와 묻지 않는다
- "~했다면" 같은 가정 질문, "생각이 어떻게 바뀌었나요"처럼 변화가 있었다고 가정하는 질문, 다른 사람의 반응을 묻는 질문은 쓰지 않는다
- "알게 된 점은?"만 묻지 말고 활동의 구체 내용을 넣는다 (나쁜 예: "부스 활동에서 알게 된 점은?" → 활동 내용이 짧으면 그 활동에서 무엇을 했는지부터 묻는다: "건축동아리 부스에서는 어떤 체험을 진행했나요?")
- 끝맺음은 "~설명해주세요.", "~무엇인가요?", "~은/는?", "~말해줄래요?", "~느꼈나요?"처럼

[질문을 뽑는 우선순위 — 활동을 이 순서로 정렬해서 질문한다]
1순위 학과 관련 활동: 지원 학과와 분명하게 연결되는 활동. 탐구한 개념·원리를 진짜 아는지 묻는 질문을 중심으로
2순위 전공과 가까운 활동: 전공과 비슷하거나 가까운 활동. 그 활동에서 다룬 내용을 설명하게 하는 질문
3순위 생기부 활동 확인: 전공과 상관없는 활동. 알게 된 점·느낀 점·자기 생각을 묻는 질문

[자유전공일 때 — [학과 유형] 자유전공이라고 적혀 있으면]
- 전공이 정해져 있지 않으므로 1·2순위를 쓰지 않는다
- 학생이 적은 모든 활동에서 골고루 질문한다: 각 활동에서 다룬 개념·내용, 알게 된 점·느낀 점·자기 생각, 그리고 그 활동으로 관심 분야가 어떻게 넓어지거나 바뀌었는지
- 그룹 이름은 "생기부 활동 확인", "관심 분야 탐색" 중에서 쓴다 (결제 전에는 "가장 나올 가능성이 큰 질문" 하나로)

[공통 규칙]
- 꼬리 질문, 답변 예시, 설명은 쓰지 않는다. 면접관이 실제로 던질 **질문 문장만** 쓴다
- [대학 면접 데이터]가 있으면 그 대학 면접관이 되어 질문한다
  · 면접관 핵심 관점·질문 출제 특징·평가 톤 세 가지를 읽고, 그 대학이 실제로 묻는 방식과 깊이로 질문 문장을 만든다
    (예: 개념·원리 이해를 보는 대학이면 개념 설명·차이 질문을 늘리고, 판단과 가치관을 보는 대학이면 자기 의견 질문을 늘리고,
     과정을 보는 대학이면 알게 된 점·해결 방안 질문을 늘린다)
  · 같은 활동이라도 대학마다 질문이 달라져야 한다. 다만 대학 경향은 "무엇을 묻는지"에만 반영하고, 질문 문장은 위의 말투 규칙대로 짧고 쉽게 쓴다
  · 질문은 여전히 학생이 적은 활동 안에서만 만든다 (대학 데이터는 묻는 방식과 깊이에만 쓴다)
- 학생 이름·학교 같은 개인정보는 쓰지 않는다
- {{COUNT_RULE}}
- 입력이 생활기록부 활동이 아니면 {"invalid":true,"invalid_reason":"한 문장"}

{"invalid":false,"groups":[{"title":"","questions":["",""]}]}`;

const EXTRACT_SYSTEM = `학생이 붙여 넣은 학교생활기록부 요약을 활동 하나하나로 나눈다. JSON만 출력.

[입력 모양 — 생수면 가이드로 ChatGPT가 요약한 글]
활동마다 이런 묶음으로 온다:
  1학년 · 창체-동아리활동 · 과학동아리 · CT 개념 및 활용 분야 발표
  한 활동: (실제로 한 일)
  학과와 닿는 지점: (요약한 AI의 해석)
  도달한 깊이: (요약한 AI의 해석)
모양이 조금 달라도 같은 방식으로 읽는다.

[규칙]
- 머리줄 하나(학년 · 구분 · …)부터 다음 머리줄 전까지가 활동 1개다. 한 묶음을 여러 개로 쪼개지 않는다
- grade: "1학년"→"고1", "2학년"→"고2", "3학년"→"고3"
- term: 학기가 적혀 있으면 "1학기" | "2학기", 없으면 "1학기"
- kind: 교과세특·세특·과목 이름 → "subject" / 동아리 → "club" / 진로 → "career" / 자율·봉사·행동특성 → "autonomy"
- subject: kind가 "subject"일 때만 과목 이름 (예: 머리줄의 "통합과학"). 나머지는 ""
- title: 머리줄의 활동 제목 (예: "CT 개념 및 활용 분야 발표"). 없으면 ""
- content: "한 활동" 내용을 그대로 옮긴다 (줄이거나 바꾸지 않는다, 400자 이내). "한 활동"이 없으면 그 묶음에서 실제로 한 일을 쓴다
- link: "학과와 닿는 지점" 내용을 그대로 옮긴다 (400자 이내). 없으면 ""
- "도달한 깊이"는 쓰지 않는다
- 주제·개념·책 제목·용어는 바꾸지 않고 그대로 쓴다
- 묶음 끝에 붙은 쓸모없는 글자(예: 줄 끝에 홀로 붙은 학과 이름)는 버린다
- 학생 글에 없는 내용을 지어내지 않는다
- 독서 목록, 수상, 성적, 출결, 봉사 시간 숫자, 이름·학교·선생님 이름은 뺀다
- 생활기록부 내용이 아니면 {"activities":[]}

{"activities":[{"grade":"고1","term":"1학기","kind":"club","subject":"","title":"","content":"","link":""}]}`;

const FULL_RULE = `그룹 이름은 다음 중에서 쓴다 (질문이 있는 그룹만): "학과 관련 활동", "전공과 가까운 활동", "생기부 활동 확인"
- 활동 하나당 질문은 딱 1개. 전체 질문 수는 [질문 수]와 정확히 같다
- 한 활동으로 질문 2개를 만들지 않는다. 모든 활동이 정확히 한 번씩 쓰인다
- 각 활동이 1·2·3순위 중 어디에 해당하는지 보고 그 그룹에 넣는다. 1순위 그룹부터 순서대로 쓴다`;
const PREVIEW_RULE = `그룹은 1개, 이름은 "가장 나올 가능성이 큰 질문"
- 질문은 무조건 정확히 ${PREVIEW_COUNT}개. 이 규칙이 [활동 하나당 질문 1개]보다 먼저다
- 먼저 모든 활동에서 1개씩 뽑는다. 그래도 ${PREVIEW_COUNT}개가 안 되면 1순위(학과 관련) 활동에서 다른 각도로 1개를 더 뽑는다 (같은 내용을 말만 바꾸지 않는다)
- 활동이 ${PREVIEW_COUNT}개보다 많으면 우선순위대로 고른다: 학과 관련 활동 먼저, 모자라면 전공과 가까운 활동, 그래도 모자라면 생기부 활동 확인
- 1순위 활동 질문부터 순서대로 쓴다
- 학생이 "내 생기부 얘기다"라고 바로 느낄 만큼 활동의 구체적 내용을 넣은 날카로운 질문만`;

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

async function ask(user: string, ctx: Ctx, rule = FULL_RULE) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 12000,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM.replace("{{COUNT_RULE}}", rule) }, { role: "user", content: user }],
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

/* 붙여 넣은 요약 → 활동 목록 (gpt-5-mini) */
async function extract(text: string, ctx: Ctx) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      max_completion_tokens: 16000,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: text }],
    }),
  });
  const body = await res.text();
  const c = ctx; // 비용은 면접 예상질문에 같이 잡는다
  if (!res.ok) {
    console.error("extract error", res.status, body.slice(0, 800));
    await logUsage(c, EXTRACT_MODEL, null, false);
    return null;
  }
  let usage: any = null;
  try {
    const j = JSON.parse(body);
    usage = j.usage;
    const out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
    await logUsage(c, EXTRACT_MODEL, usage, true);
    return Array.isArray(out?.activities) ? out.activities : [];
  } catch (e) {
    console.error("extract parse failed", e);
    await logUsage(c, EXTRACT_MODEL, usage, false);
    return null;
  }
}

const clean = (v: unknown, n = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// 질문이 "~은? ~는?"처럼 두 개로 오면 첫 번째만 남긴다
const oneQuestion = (q: string) => {
  const i = q.indexOf("?");
  return i > 0 && i < q.length - 1 ? q.slice(0, i + 1) : q;
};

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

/* 자유전공(자율전공·무전공·전공자율선택) — 학과와 연결할 전공이 없어 생기부 활동 전체에서 골고루 묻는다 */
const isFreeMajor = (dept: string) => /자유\s*전공|자율\s*전공|무\s*전공|전공\s*자율|자유\s*학부|자율\s*학부/.test(dept);

/* 비회원에게 보낼 결과 — 앞의 2개만 (나머지는 서버에만 있고, 가입하면 보인다) */
function guestView(r: any) {
  const qs = (r.groups ?? []).flatMap((g: any) => g.questions);
  return { ...r, groups: [{ title: "가장 나올 가능성이 큰 질문", questions: qs.slice(0, GUEST_SHOW) }], total: qs.length, locked: Math.max(0, qs.length - GUEST_SHOW) };
}

/* 오늘(한국 시간) 0시 */
function todayStartKST() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 9 * 3600 * 1000).toISOString();
}

/* 결제 상품 — 승인된 주문 중 6곳 상품이 하나라도 있으면 six, 아니면 one (관리자는 six) */
async function planOf(admin: any, userId: string, isAdmin: boolean) {
  if (isAdmin) return "six";
  const { data } = await admin
    .from("pay_orders").select("product").eq("user_id", userId).eq("status", "approved").in("product", ["interview", "interview6"]);
  return (data ?? []).some((o: any) => o.product === "interview6") ? "six" : "one";
}
const planMax = (plan: string) => (plan === "six" ? 6 : 1);

/* 이미 결제 후 질문을 뽑은 대학들 (대학 고정·6곳 제한에 쓴다) */
async function usedUnivs(admin: any, userId: string) {
  const { data } = await admin.from("interview_queries").select("targets").eq("user_id", userId).eq("preview", false);
  const used = new Map<string, string>();
  (data ?? []).forEach((r: any) =>
    (Array.isArray(r.targets) ? r.targets : []).forEach((t: any) => t?.university && used.set(univKey(String(t.university)), String(t.university)))
  );
  return used;
}

/* 대학 1곳의 질문 뽑기 — 결과 또는 { error, status } */
async function makeQuestions(
  admin: any,
  target: { university: string; department: string },
  count: number,
  text: string,
  preview: boolean,
  limit: number,
  ctx: Ctx
) {
  const { university, department } = target;
  // 대학 면접 데이터 — 면접관 핵심 관점 · 질문 출제 특징 · 평가 톤 세 가지만 참고한다
  const univ = await findUniv(admin, university);
  // 빈 칸은 빼고 넘긴다 (데이터가 비어 있는 대학은 'null'이 AI에게 넘어가지 않게, 반영 표시도 하지 않는다)
  const univParts = univ
    ? ([
        ["면접관 핵심 관점", univ.view],
        ["질문 출제 특징", univ.question_style],
        ["평가 톤", univ.tone],
      ] as [string, unknown][]).filter(([, v]) => v != null && String(v).trim())
    : [];
  const univBlock = univParts.length
    ? `\n\n[대학 면접 데이터] ${univ.name}\n` + univParts.map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n")
    : "";

  const ai = await ask(
    `[지원 대학] ${university}
[지원 학과] ${department}${isFreeMajor(department) ? "\n[학과 유형] 자유전공 — 우선순위 없이 학생이 적은 모든 활동에서 골고루 질문한다" : ""}${univBlock}

[활동 수] ${count}개
[질문 수] ${limit}개 (활동 하나당 딱 1개)

[학생 생활기록부 활동]
${text}`,
    ctx,
    preview ? PREVIEW_RULE : FULL_RULE
  );
  if (!ai) return { error: "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요.", status: 502 };
  if (ai.invalid) return { error: clean(ai.invalid_reason, 150) || "생기부 활동을 조금 더 구체적으로 적어 주세요.", status: 400 };

  let groups = (ai.groups ?? [])
    .map((g: any) => ({
      title: clean(g?.title, 30),
      questions: (g?.questions ?? []).map((q: any) => oneQuestion(clean(q, 120))).filter(Boolean),
    }))
    .filter((g: any) => g.title && g.questions.length)
    .slice(0, 6);

  // AI가 규칙을 어기고 많이 뽑아도 활동 수(결제 전은 5개)까지만 남긴다 — 앞 그룹(1순위)부터 채운다
  let left = limit;
  groups = groups
    .map((g: any) => {
      const qs = g.questions.slice(0, Math.max(0, left));
      left -= qs.length;
      return { ...g, questions: qs };
    })
    .filter((g: any) => g.questions.length);

  if (preview) {
    // 결제 전 — 그룹이 여러 개로 와도 하나로 모은다
    const qs = groups.flatMap((g: any) => g.questions);
    groups = qs.length ? [{ title: "가장 나올 가능성이 큰 질문", questions: qs }] : [];
  }
  if (!groups.length) return { error: "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요.", status: 502 };
  return {
    result: {
      university: univ?.name ?? university,
      department,
      groups,
      total: groups.reduce((a: number, g: any) => a + g.questions.length, 0),
      has_univ_data: univParts.length > 0,
      activity_count: count,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user ?? null; // 비회원이면 null
    const body = await req.json();
    const clientId = clean(body.client_id, 64);

    // 가입(로그인) 뒤 — 이 브라우저의 비회원 기록을 계정으로 옮기고, 뽑아 둔 질문을 전부 돌려준다 (AI 비용 0)
    if (body.action === "claim") {
      if (!user) return json({ error: "로그인이 필요해요.", login: true }, 401);
      if (clientId) {
        await admin.from("interview_queries").update({ user_id: user.id }).is("user_id", null).eq("client_id", clientId);
        await admin.from("record_activities").update({ user_id: user.id }).is("user_id", null).eq("client_id", clientId);
      }
      const { data: prev } = await admin
        .from("interview_queries").select("result").eq("user_id", user.id).eq("preview", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return json({ result: prev?.result?.results?.[0] ?? null, preview: true });
    }

    // 결제 후 화면 — 어떤 상품인지, 이미 뽑은 대학이 어디인지 (AI 비용 0)
    if (body.action === "status") {
      if (!user) return json({ paid: false });
      const { data: adm } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      const { data: acc } = adm ? { data: true } : await admin.from("interview_access").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!acc) return json({ paid: false });
      const plan = await planOf(admin, user.id, Boolean(adm));
      const used = await usedUnivs(admin, user.id);
      return json({ paid: true, plan, max: planMax(plan), used: [...used.values()], admin: Boolean(adm) });
    }

    const mode = body.mode === "full" ? "full" : "preview";
    if (!user && mode === "full") return json({ error: "로그인이 필요해요.", login: true }, 401);
    if (!user && !clientId) return json({ error: "잠시 후 다시 시도해 주세요." }, 400);
    // 지원 대학·학과 — 결제 후는 1~6곳(targets), 결제 전은 1곳
    const rawTargets =
      mode === "full" && Array.isArray(body.targets) && body.targets.length
        ? body.targets
        : [{ university: body.university, department: body.department }];
    const seen = new Set<string>();
    const targets = rawTargets
      .map((t: any) => ({ university: clean(t?.university, 40), department: clean(t?.department, 40) }))
      .filter((t: any) => t.university && t.department && !seen.has(univKey(t.university)) && seen.add(univKey(t.university)))
      .slice(0, mode === "full" ? 6 : 1);
    if (!targets.length) return json({ error: "지원 대학과 학과를 적어 주세요." }, 400);
    const department = targets[0].department;
    if (!body.agreed) return json({ error: "저장 동의에 체크해 주세요." }, 400);

    // 활동 정리 — 빈 칸은 버린다 (칸 입력과 붙여 넣기 둘 다 같은 모양으로)
    const tidy = (list: unknown) => (Array.isArray(list) ? list : [])
      .map((a: any) => ({
        grade: GRADES.includes(a?.grade) ? a.grade : "고3",
        term: TERMS.includes(a?.term) ? a.term : "1학기",
        kind: KIND_LABEL[a?.kind] ? a.kind : "subject",
        subject: a?.kind === "subject" ? clean(a?.subject, 30) : "",
        content: String(a?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
        title: clean(a?.title, 80),
        link: String(a?.link ?? "").replace(/\s+/g, " ").trim().slice(0, 600), // 학과와 닿는 지점 — DB에만 저장 (질문 AI에는 안 넘김)
      }))
      .filter((a: any) => a.content)
      .slice(0, MAX_ACTIVITIES);
    // 결제 후 붙여 넣기 — 요약 글을 받으면 칸 입력 대신 그걸로 활동을 만든다
    const pasted = mode === "full" ? String(body.record_text ?? "").trim().slice(0, MAX_TEXT) : "";
    let activities = tidy(body.activities);
    if (!pasted) {
      const has = (k: string) => activities.some((a: any) => a.kind === k && (k !== "subject" || a.subject));
      if (!has("subject") || !has("club") || !has("career") || !has("autonomy")) {
        return json({ error: "세특 1개(과목 포함)와 동아리·진로·자율 칸을 모두 채워 주세요." }, 400);
      }
    } else if (pasted.length < 100) {
      return json({ error: "가이드대로 요약한 내용을 전부 붙여 넣어 주세요." }, 400);
    }

    // 결제 여부 (관리자는 결제한 것으로)
    const { data: adminRow } = user ? await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle() : { data: null };
    const { data: access } = !user ? { data: null } : adminRow ? { data: true } : await admin.from("interview_access").select("user_id").eq("user_id", user.id).maybeSingle();
    const paid = Boolean(access);

    if (!paid && mode === "full") return json({ error: "생기부 예상질문을 결제하면 이용할 수 있어요.", paywall: true }, 402);

    if (!paid) {
      // 결제 전 — 계정당 1번. 이미 뽑았으면 그 결과를 다시 보여준다 (AI 비용 0)
      let q = admin.from("interview_queries").select("result").eq("preview", true).order("created_at", { ascending: false }).limit(1);
      q = user ? q.eq("user_id", user.id) : q.is("user_id", null).eq("client_id", clientId);
      const { data: prev } = await q.maybeSingle();
      const r0 = prev?.result?.results?.[0];
      if (r0) return json({ result: user ? r0 : guestView(r0), preview: true, paid: false, guest: !user, again: true });
    } else if (!adminRow) {
      const { count } = await admin
        .from("interview_queries").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("preview", false).gte("created_at", todayStartKST());
      if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `오늘은 ${DAILY_LIMIT}번까지 뽑을 수 있어요. 내일 다시 해 주세요.` }, 429);
    }
    const preview = !paid;

    // 1곳 상품은 처음 뽑은 대학으로 고정, 6곳 상품은 대학 6곳까지 (관리자는 제한 없음)
    if (!preview && !adminRow) {
      const plan = await planOf(admin, user.id, false);
      const max = planMax(plan);
      const used = await usedUnivs(admin, user.id);
      const all = new Map(used);
      targets.forEach((t: any) => all.set(univKey(t.university), t.university));
      if (targets.length > max || all.size > max) {
        const list = [...used.values()];
        return json(
          {
            error:
              plan === "six"
                ? `수시 6곳 상품은 대학 6곳까지 뽑을 수 있어요.${list.length ? ` 이미 뽑은 대학: ${list.join(", ")}` : ""}`
                : list.length
                ? `1곳 상품은 처음 뽑은 ${list[0]}로 고정돼요. 다른 대학도 보려면 수시 6곳 상품으로 바꿔 주세요.`
                : "1곳 상품은 대학 1곳만 뽑을 수 있어요.",
            plan,
            used: list,
            upgrade: plan === "one",
          },
          403
        );
      }
    }

    if (pasted) {
      const raw = await extract(pasted, { service: "interview", userId: user?.id ?? null });
      if (!raw) return json({ error: "요약한 내용을 읽지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
      activities = tidy(raw);
      if (!activities.length) return json({ error: "요약한 내용에서 활동을 찾지 못했어요. 가이드대로 요약했는지 확인해 주세요." }, 400);
    }

    // 질문 수 — 결제 전은 무조건 5개, 결제 후는 활동 수만큼 (활동당 1개)
    const limit = preview ? PREVIEW_COUNT : activities.length;

    // AI에게 줄 생기부 정리 — 학년·학기 순서로, 활동마다 번호를 붙인다
    const order = (a: any) => GRADES.indexOf(a.grade) * 2 + TERMS.indexOf(a.term);
    const byTerm = new Map<string, any[]>();
    [...activities].sort((x, y) => order(x) - order(y)).forEach((a: any) => {
      const k = `${a.grade} ${a.term}`;
      if (!byTerm.has(k)) byTerm.set(k, []);
      byTerm.get(k)!.push(a);
    });
    let no = 0;
    const text = [...byTerm.entries()]
      .map(([k, list]) => `[${k}]\n` + list.map((a: any) => `${++no}. ${KIND_LABEL[a.kind]}${a.subject ? ` · ${a.subject}` : ""}${a.title ? ` · ${a.title}` : ""}: ${a.content}`).join("\n"))
      .join("\n\n");

    // 대학마다 질문을 따로 뽑는다 (동시에)
    const ctx = { service: "interview", userId: user?.id ?? null, clientId: user ? null : clientId };
    const outs = await Promise.all(targets.map((t: any) => makeQuestions(admin, t, activities.length, text, preview, limit, ctx)));
    const results = outs.filter((o: any) => o.result).map((o: any) => o.result);
    if (!results.length) {
      const e = outs[0] as any;
      return json({ error: e?.error ?? "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요." }, e?.status ?? 502);
    }
    const failed = targets.filter((_: any, i: number) => !(outs[i] as any).result).map((t: any) => t.university);
    const result = results[0];

    // 저장 — 뽑은 결과(마이페이지에서 다시 본다)와 활동 한 줄씩(데이터)
    const { data: row } = await admin
      .from("interview_queries")
      .insert({
        user_id: user?.id ?? null,
        client_id: user ? null : clientId,
        university: result.university,
        department,
        targets: results.map((r: any) => ({ university: r.university, department: r.department })),
        activities,
        text,
        text_length: text.length,
        result: { results },
        preview,
        agreed_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    const { error: actErr } = await admin.from("record_activities").insert(
      activities.map((a: any) => ({
        user_id: user?.id ?? null,
        client_id: user ? null : clientId,
        query_id: row?.id ?? null,
        department,
        departments: [...new Set(results.map((r: any) => r.department))],
        grade: a.grade,
        term: a.term,
        kind: a.kind,
        subject: a.subject || null,
        content: a.content,
        title: a.title || null,
        dept_link: a.link || null,
      }))
    );
    if (actErr) console.warn("record_activities insert failed", actErr);

    return json({ result: user ? result : guestView(result), results: user ? results : undefined, failed, preview, paid, guest: !user });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});