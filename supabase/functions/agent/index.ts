// 입시 상담 AI(에이전트) — 대학 입시 DB + 내 생수면 기록(생기부 노트·진단·예상질문·지원동기·성적)을 보고 답한다
// 배포: npx supabase functions deploy agent --project-ref xhywexuazwipwvzrldwo --use-api
// DB: sql/sm_76_univ_admission.sql · sm_77_univ_admission_results.sql · sm_78_agent.sql
//
// 요청 (로그인 필수 · Authorization 헤더)
//   { message, chat_id? }   → 답변 하나 (chat_id 가 없으면 새 대화)
// 응답 { chat_id, answer, usage }  · 이번 주 사용량을 다 쓰고 이용권도 없으면 { need_pay: true }
// 흔한가 진단·예상질문·꼬리질문도 여기서 부르고, 그 기능들의 무료 횟수 대신 이 주간 사용량(토큰 비용)으로 센다
//
// 사용량: 질문 개수가 아니라 실제 AI 비용(ai_usage)으로 센다 — 화면에는 '이번 주 사용량 ○%'와 초기화 시각만 보여 준다
//   무료 회원: 주간 한도 FREE_WON (+ 친구 1명 가입마다 FRIEND_WON, FRIEND_MAX명까지) · 무료 답 아래에는 광고(화면 Agent.jsx)
//   이용권(agent30·agent180·agent365 — _shared/pass.ts): 승인일부터 기간만큼 · 주간 한도 PAID_WON · 광고 없음
//   매주 월요일 0시(한국 시간)에 초기화
// 대학 자료는 AI가 필요할 때 도구(tool)로 DB에서 직접 찾는다 → 지어내지 않고 DB에 있는 것만 말한다

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { passUntil } from "../_shared/pass.ts"; // 이용권 (모든 유료 기능 공통)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5-mini"; // 답이 아쉬우면 "gpt-5" (질문 1개당 비용 약 4~5배)
const KRW = 1400; // 달러 → 원
const FREE_WON = 200; // 무료 회원 주간 한도 (보통 질문 약 7~10개)
const FRIEND_WON = 150; // 친구 1명이 내 링크로 가입할 때마다 늘어나는 주간 한도 (질문 약 5개)
const FRIEND_MAX = 4; // 친구 보너스는 4명까지
const PAID_WON = 3000; // 이용권 주간 한도 (보통 질문 약 100개 — 사실상 무제한, 과다 사용만 막음)
const MAX_ROUNDS = 6; // 한 질문에 DB 찾기 최대 횟수
const HISTORY = 12; // 이전 대화 몇 개까지 기억할지
const clean = (v: unknown, n = 600) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* OpenAI 부르기 — 바쁠 때(429) · 서버 오류(5xx)면 1초 · 3초 쉬고 최대 2번 다시 */
async function openai(payload: unknown) {
  for (let k = 0; ; k++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify(payload),
    });
    if ((res.status === 429 || res.status >= 500) && k < 2) {
      await res.body?.cancel();
      const wait = Number(res.headers.get("retry-after")) * 1000 || (k === 0 ? 1000 : 3000);
      await new Promise((ok) => setTimeout(ok, Math.min(wait, 5000)));
      continue;
    }
    return res;
  }
}

/* AI 사용량 기록 — 관리자 'AI 비용' 칸 */
const PRICE: Record<string, [number, number]> = { "gpt-5-mini": [0.25, 2], "gpt-5": [1.25, 10] };
async function logUsage(db: any, userId: string, inT: number, outT: number, ok: boolean, service = "agent") {
  try {
    const [pi, po] = PRICE[MODEL];
    await db.from("ai_usage").insert({ service, user_id: userId, model: MODEL, input_tokens: inT, output_tokens: outT, cost_usd: (inT * pi + outT * po) / 1e6, ok });
  } catch (_) { /* 기록 실패는 무시 */ }
}

/* ───────── 대학 이름 맞추기 (한양대 → 한양대학교, 외대 → 한국외국어대학교 …) */
const ALIAS: Record<string, string> = {
  "서울과기대": "서울과학기술대학교", "과기대": "서울과학기술대학교", "외대": "한국외국어대학교", "한국외대": "한국외국어대학교",
  "시립대": "서울시립대학교", "서울시립대": "서울시립대학교", "카톨릭대": "가톨릭대학교", "가톨릭대": "가톨릭대학교",
  "성대": "성균관대학교", "이대": "이화여자대학교", "숙대": "숙명여자대학교", "인천대": "인천대학교", "고대": "고려대학교", "연대": "연세대학교",
  "서울대": "서울대학교", "경기대": "경기대학교", "건대": "건국대학교", "동대": "동국대학교", "홍대": "홍익대학교", "단대": "단국대학교",
};
let UNIVS: string[] = [];
async function univList(db: any) {
  if (UNIVS.length) return UNIVS;
  // 모집요강이 있는 대학 + 입결만 있는 대학 (어디가 입결을 대학별로 계속 넣는다 — 꽃동네대 · 가톨릭관동대 …)
  const [{ data }, { data: res }] = await Promise.all([
    db.from("univ_admission_rules").select("university").limit(5000),
    db.from("univ_result_names").select("university"), // sql/sm_100 — 입결 있는 대학 이름만 (줄이 많아도 1000줄 제한에 안 걸리게)
  ]);
  UNIVS = [...new Set([...(data ?? []), ...(res ?? [])].map((r: any) => r.university))].sort() as string[];
  return UNIVS;
}
async function matchUniv(db: any, raw: unknown): Promise<string | null> {
  const s = clean(raw, 40).replace(/\s/g, "");
  if (!s) return null;
  const list = await univList(db);
  if (list.includes(s)) return s;
  if (ALIAS[s]) return ALIAS[s];
  const short = (n: string) => n.replace("여자대학교", "여대").replace("대학교", "대");
  return list.find((n) => n === s + "학교" || short(n) === s) ?? list.find((n) => n.includes(s.replace(/대$/, ""))) ?? null;
}

/* ───────── 도구: AI가 필요할 때 DB에서 찾는다 */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_units",
      description: "학과별 모집인원·전형·수능최저·전형방법을 찾는다. 대학을 모르면 비워 두고 학과로 여러 대학을 찾을 수 있다.",
      parameters: {
        type: "object",
        properties: {
          university: { type: "string", description: "대학 이름 (예: 한양대, 경희대학교). 비우면 전체 대학" },
          department: { type: "string", description: "학과 이름 일부 (예: 컴퓨터, 경영, 간호)" },
          year: { type: "integer", description: "2027(현 고3, 모집요강) 또는 2028(현 고2, 시행계획)" },
          season: { type: "string", enum: ["수시", "정시"] },
          track: { type: "string", description: "전형 이름 일부 (예: 학생부종합, 교과, 논술, 면접형, 지역균형)" },
          no_csat: { type: "boolean", description: "true 면 수능최저가 없는 것만" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_rules",
      description: "한 대학의 전형별 규칙(전형방법·반영교과·등급 산출·진로선택 반영·수능최저·면접 방식)을 가져온다.",
      parameters: { type: "object", properties: { university: { type: "string" }, year: { type: "integer" } }, required: ["university"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_changes",
      description: "한 대학의 학년도 사이 바뀐 점(2027→2028 등)을 가져온다.",
      parameters: { type: "object", properties: { university: { type: "string" } }, required: ["university"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_results",
      description: "수시 입결(2026학년도 어디가 결과: 경쟁률·충원·내신 50%/70% 컷)을 가져온다. 대학 하나를 보거나, 대학을 비우고 학과 + 학생 내신 등급(grade)을 넣으면 전국 대학에서 그 학과를 도전·적정·안정으로 나눠 찾아 준다 ('내신 3.01인데 간호학과 어디 가능?' 같은 질문).",
      parameters: {
        type: "object",
        properties: {
          university: { type: "string", description: "대학 이름. 비우면 전국에서 찾는다 (이때 department 필요)" },
          department: { type: "string", description: "학과 이름 일부 (예: 간호, 경영, 컴퓨터)" },
          grade: { type: "number", description: "학생 내신 평균 등급 (예: 3.01). 전국에서 찾을 때 이 근처 컷을 고른다" },
          special: { type: "boolean", description: "농어촌·기회균형·특성화고 같은 특별전형도 넣을지 (학생이 해당된다고 말했을 때만 true)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_jeongsi_results",
      description: "정시 입결(2026학년도 정시 최종 결과 · 수능 누적 백분위 %)을 가져온다. 대학·학과로 찾거나, 학생의 누적 백분위(예: 3.5)로 그 근처에서 합격선이 나온 대학·학과를 찾는다. 수시 내신 입결은 get_results. 학과 이름은 표의 줄임말이라(사복 · 국교 · 컴퓨터공) 학과로 못 찾으면 대학만 넣어 다시 찾는다.",
      parameters: {
        type: "object",
        properties: {
          university: { type: "string", description: "대학 이름 (예: 연세대, 한양대). 비우면 전체" },
          department: { type: "string", description: "학과 이름 일부 (예: 경영, 컴퓨터, 의예)" },
          track: { type: "string", enum: ["인문", "자연"], description: "계열 (모르면 비움)" },
          percentile: { type: "number", description: "학생의 수능 누적 백분위 % (상위 몇 %인지 · 예: 3.5). 이 근처 합격선을 찾을 때" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_interview_style",
      description: "한 대학의 학종 면접 스타일(면접관 관점·질문 스타일·좋은 답변·질문 유형 비율·꼬리질문 특징)을 가져온다. 면접 준비 질문일 때.",
      parameters: { type: "object", properties: { university: { type: "string" } }, required: ["university"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recommended_subjects",
      description: "대학이 발표한 2028학년도 고교 교과 이수 권장과목(핵심·권장 과목)을 찾는다. '○○과 가려면 무슨 과목 들어야 돼?', '내 선택과목이 맞아?' 질문일 때. 대학을 비우면 학과로 여러 대학을 비교한다.",
      parameters: {
        type: "object",
        properties: {
          university: { type: "string", description: "대학 이름 (비우면 전체)" },
          department: { type: "string", description: "학과 이름 일부 (예: 컴퓨터, 의예, 경영)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_book_recs",
      description: "생수면 DB의 학과별 추천 도서(고등 · 118개 학과 · 약 1만 권)를 찾는다. 책·도서·독서 추천, '우리 학과 관련 책', '다음에 읽을 책'을 물으면 반드시 먼저 쓴다. 결과에 있는 책만 추천한다.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "학과 (예: 간호학과, 화학과, 경영학과)" },
          grade: { type: "string", enum: ["고1", "고2", "고3", ""], description: "학생 학년 — 맞는 권장 학년을 먼저 고른다" },
          keyword: { type: "string", description: "좁힐 분야·낱말 (예: 윤리, 데이터, 환경, 감염) — 선택" },
          level: { type: "string", enum: ["입문", "표준", "심화", ""], description: "난이도 — '더 깊은 책', '다음 단계'면 심화. 선택" },
          exclude: { type: "array", items: { type: "string" }, description: "이미 추천했거나 읽은 책 제목 (이어 추천할 때 빼기)" },
        },
        required: ["department"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_study_tips",
      description: "생수면 DB의 공부법 카드(선배 공부법을 정리한 것)를 찾는다. 공부법·공부 방법·오답노트·플래너·루틴·집중·슬럼프·내신/모의고사 공부를 물으면 반드시 먼저 쓴다. 결과 카드에 있는 방법만 알려 준다.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", enum: ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사", "제2외국어", "전과목", ""], description: "과목 — 과목 없는 질문(계획·슬럼프 등)은 전과목" },
          area: { type: "string", enum: ["계획", "루틴", "시간관리", "오답노트", "집중", "슬럼프", "개념", "문제풀이", "암기", "독해", "시험직전", "모의고사분석", "독학", "메타인지", ""], description: "분야 — 선택" },
          exam: { type: "string", enum: ["내신", "수능", ""], description: "내신 공부인지 수능·모의고사 공부인지 — 선택" },
          grade: { type: "string", enum: ["고1", "고2", "고3", "N수", ""] },
          level: { type: "string", enum: ["하위권", "중위권", "상위권", ""], description: "학생 성적대 — 선택" },
          keyword: { type: "string", description: "좁힐 낱말 (예: 비문학, 단어, 기출) — 선택" },
          exclude: { type: "array", items: { type: "string" }, description: "이미 알려 준 카드 제목" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_topic_cases",
      description: "생수면 DB의 학과별 실제 세특 탐구 사례를 찾는다. 탐구주제 추천·아이디어 질문일 때 먼저 쓰고, 사례를 바탕으로 학생에게 맞게 다듬어 추천한다.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "학과 (예: 간호, 컴퓨터공학, 경영)" },
          keyword: { type: "string", description: "좁힐 낱말 (예: 감염, 노인, 생명과학, 통계) — 선택" },
        },
        required: ["department"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_universities",
      description: "DB에 자료가 있는 대학 목록과, 입결이 있는 대학 목록.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "my_record",
      description: "학생 본인이 생수면에 남긴 생기부 활동 전체(과목별 세특·자율·동아리·진로)를 가져온다. 활동 내용을 자세히 봐야 할 때만.",
      parameters: { type: "object", properties: { subject: { type: "string", description: "과목/영역 일부로 좁히기 (선택)" } } },
    },
  },
  // 흔한가 진단 3종 — 생수면의 진단 기능을 그대로 부른다 (마이페이지 기록도 같이 쌓임 · 비용은 에이전트 주간 사용량으로)
  {
    type: "function",
    function: {
      name: "check_topic",
      description: "탐구주제 흔한가 진단. 학생이 쓴 탐구주제가 얼마나 흔한지 점수(0~100, 높을수록 흔함)와 덜 흔하게 바꾼 주제를 받는다. 학과·과목·주제가 다 정해졌을 때만 부른다.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "희망 학과" },
          subject: { type: "string", description: "탐구한(할) 과목" },
          topic: { type: "string", description: "학생이 쓴 탐구주제 문장 그대로 (고치지 않는다)" },
          grade: { type: "string", enum: ["고1", "고2", "고3"] },
          focus: { type: "string", enum: ["career", "subject"], description: "career = 진로(학과) 연결, subject = 과목 깊이 파기. 학생이 따로 말하지 않으면 career" },
        },
        required: ["department", "subject", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_motive",
      description: "지원동기 흔한가 진단. 학생이 쓴 지원동기 글이 얼마나 흔한지 점수와, 대학 면접 데이터가 있으면 그 대학 기준 분석을 받는다. 학과와 지원동기 글(30자 이상)이 있을 때만 부른다.",
      parameters: {
        type: "object",
        properties: {
          department: { type: "string", description: "지원 학과" },
          university: { type: "string", description: "지원 대학 (모르면 빈칸)" },
          motive: { type: "string", description: "학생이 쓴 지원동기 글 그대로 (30자 이상, 고치지 않는다)" },
          use_for: { type: "string", enum: ["interview", "document"], description: "면접 답변용이면 interview, 서류용이면 document. 모르면 interview" },
        },
        required: ["department", "motive"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_reading",
      description: "독서 흔한가 진단. 책이 학과 지망생 사이에서 얼마나 흔한지, 같은 책 다르게 읽는 법, 덜 흔한 책을 받는다. 책 제목·학과·과목이 정해졌을 때만 부른다.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "책 제목" },
          author: { type: "string", description: "저자 (모르면 빈칸)" },
          department: { type: "string", description: "희망 학과" },
          subject: { type: "string", description: "이 책을 연결할 과목" },
          grade: { type: "string", enum: ["고1", "고2", "고3"] },
        },
        required: ["title", "department", "subject"],
      },
    },
  },
  // 면접 — 생기부 예상질문 · 꼬리질문 (원래 기능을 그대로 부른다 · 비용은 에이전트 주간 사용량으로)
  {
    type: "function",
    function: {
      name: "interview_questions",
      description: "생기부 예상질문. 지원 대학 면접 데이터(평가요소·질문 출제 특징)에 맞춰 학생 활동(최대 4개)에서 나올 면접 질문을 뽑는다. 활동을 비워 두면 학생 생기부 노트에서 최근 활동 4개를 쓴다. 대학·학과가 정해졌을 때만 부른다.",
      parameters: {
        type: "object",
        properties: {
          university: { type: "string" },
          department: { type: "string" },
          activities: {
            type: "array",
            description: "면접에서 걱정되는 활동 (최대 4개). 학생이 적은 글 그대로. 비우면 생기부 노트에서 가져온다",
            items: { type: "object", properties: { subject: { type: "string", description: "과목/영역 (예: 생명과학, 동아리)" }, content: { type: "string", description: "한 활동 내용" } }, required: ["content"] },
          },
        },
        required: ["university", "department"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tail_practice",
      description: "면접 꼬리질문 연습. start = 면접 질문과 학생 답변으로 그 대학 면접관의 첫 꼬리질문 받기, next = 바로 앞 꼬리질문에 대한 학생 답변으로 다음 꼬리질문 받기 (가장 최근 연습에 이어서).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["start", "next"] },
          university: { type: "string", description: "start 때만" },
          department: { type: "string", description: "start 때만" },
          question: { type: "string", description: "start 때만 — 연습할 면접 질문" },
          question_type: { type: "string", enum: ["자기소개", "지원동기", "생기부 질문", "공통·인성", "제시문"], description: "start 때만 — 모르면 생기부 질문" },
          answer: { type: "string", description: "학생 답변 그대로 (15자 이상, 고치지 않는다)" },
        },
        required: ["action", "answer"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_seniors",
      description: "생수면 '선배 생기부 보기'의 실제 합격 선배 생기부(이름·학교를 지운 정제본)에서 비슷한 선배 사례를 찾는다. 학생이 학과·계열에 맞춰 학년별로 뭘 해야 하는지, 합격생은 어떤 세특·창체·동아리·활동을 했는지, 생기부 방향을 물을 때 먼저 쓴다. 대학 · 학과는 계속 늘어난다 (없으면 found 0).",
      parameters: {
        type: "object",
        properties: {
          track: { type: "string", enum: ["hss", "nat", "eng", "med"], description: "학과로 고른다 — hss 인문·사회(경영·교육·법·언어 등) · nat 자연(수학·물리·화학·생명 등 이학) · eng 공학(컴퓨터·전자·기계·건축 등) · med 의약·보건(의예·간호·약학·보건 등)" },
          grade: { type: "integer", enum: [1, 2, 3], description: "학년 (학생 학년이나 물어본 학년, 모르면 비움)" },
          area: { type: "string", enum: ["cc", "sp", "hb", "gr"], description: "cc 창체(자율·동아리·진로) · sp 세특(과목별) · hb 행특 · gr 성적. 모르면 비움" },
          keyword: { type: "string", description: "찾을 과목·활동 단어 하나 (예: 생명과학, 동아리, 실험). 없으면 비움" },
          university: { type: "string", description: "한 대학만 볼 때 (예: 가톨릭대)" },
          department: { type: "string", description: "학생이 말한 학과 (예: 간호학과) — 같은 학과 선배를 먼저 보여 준다" },
        },
        required: ["track"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_action",
      description: "말로만 안내하지 않고 물꼬가 직접 해 줄 일을 학생에게 제안한다 (학생이 [네]를 눌러야 실행된다). prep_school = 수시 면접 준비 화면에 지원 학교 등록 (학생이 그 대학·학과 면접을 준비·연습하고 싶다고 할 때). study_test = 공부법 효과 시험 만들기 (학생이 특정 과목의 약한 단원을 말하고 공부법·루틴을 물을 때 — 지금 10문제 풀고 일주일 뒤 비슷한 문제로 효과 확인). 돌려받은 card 를 답 맨 끝에 그대로 붙인다.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["prep_school", "study_test"] },
          university: { type: "string", description: "prep_school 때 — 대학 이름" },
          department: { type: "string", description: "prep_school 때 — 학과 이름 (모르면 비움)" },
          subject: { type: "string", enum: ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사"], description: "study_test 때 — 과목" },
          unit: { type: "string", description: "study_test 때 — 단원 (예: 미적분 극한, 비문학 과학 지문)" },
        },
        required: ["kind"],
      },
    },
  },
];

/* 생수면의 다른 서버 기능(진단)을 학생 로그인 그대로 부른다 */
async function callFn(fn: string, body: unknown, token: string, pass = false) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
    method: "POST",
    // x-agent-key: 이 기능의 무료 횟수 대신 에이전트 주간 사용량(토큰)으로 계산하라는 표시 (서버끼리만)
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "x-agent-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", "x-agent-pass": pass ? "1" : "0" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.error) return { error: "진단하지 못했어요. 잠시 뒤 다시 해 주세요" };
  return data;
}

/* 진단 결과에서 답에 필요한 것만 (너무 길면 AI 비용만 늘어남) */
function slimCheck(kind: string, r: any) {
  if (!r || r.error) return { error: r?.error ?? "진단하지 못했어요" };
  if (r.invalid) return { invalid: true, reason: r.invalid_reason };
  if (r.quota_exceeded) return { error: "지금은 진단하지 못했어요. 잠시 뒤 다시 해 주세요" };
  if (kind === "topic") {
    return { score: r.score, breakdown: r.breakdown, reason: r.reason, better_topic: r.suggestion?.topic, how: r.suggestion?.how,
      similar_count: r.similar_count, similar_examples: (r.similar ?? []).slice(0, 3), direction_fit: r.fit,
      today_left: r.remaining ?? null, bonus_left: r.bonus_left ?? null };
  }
  const { remaining, bonus_left, next_open, is_member, used_today, daily_limit, ...rest } = r;
  return rest;
}

/* 흔한가 진단 결과 → 채팅 답 (원래 진단 화면처럼 정해진 모양으로만. AI가 고쳐 쓰거나 지어내지 않게) */
const VERDICTS: Record<string, string[]> = {
  topic: ["흔하지 않은 주제예요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"],
  motive: ["나만의 지원동기예요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"],
  reading: ["드문 편이에요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"],
};
const lvOf = (score: number) => (score >= 85 ? 4 : score >= 65 ? 3 : score >= 40 ? 2 : score >= 15 ? 1 : 0);
function formatCheck(kind: string, r: any, args: any) {
  const score = Math.round(Number(r.score) || 0);
  const L = [`**흔함 ${score}점** — ${VERDICTS[kind][r.verdict_level ?? lvOf(score)] ?? ""}`];
  if (kind === "topic") {
    L.push(`진단한 주제: ${clean(r.topic, 100)}`);
    if (r.reason) L.push("", clean(r.reason, 400));
    if (r.similar_count) L.push(`같은 학과에서 비슷한 탐구가 ${r.similar_count}건 있었어요.`);
    if (r.better_topic) {
      L.push("", "**덜 흔하게 바꾼 주제**", `1. ${clean(r.better_topic, 160)}`);
      if (r.how) L.push(`어떻게: ${clean(r.how, 300)}`);
    }
    if (!args?.__paid && r.today_left !== null && r.today_left !== undefined) {
      L.push("", `오늘 남은 탐구주제 흔한가: ${r.today_left}번${r.bonus_left ? ` · 친구 초대로 받은 추가 ${r.bonus_left}번` : ""}`);
    }
  } else if (kind === "motive") {
    const u = r.univ;
    if (u?.name) {
      L.push("", `**${u.name} 면접 기준으로 보면**`);
      if (u.summary) L.push(clean(u.summary, 400));
      for (const f of (u.factors ?? []).slice(0, 4)) {
        L.push(`- **${f.factor}** ${f.weight ? `(비중 ${f.weight}%)` : ""} — 드러난 정도 ${Math.round(Number(f.seen) || 0)}점`);
        if (f.evidence) L.push(`내 글: "${clean(f.evidence, 60)}"`);
        if (f.tip) L.push(`보강: ${clean(f.tip, 200)}`);
      }
      if (u.question) L.push("", "**면접관 첫 질문 (예상)**", clean(u.question, 200));
    } else if (args?.university) {
      L.push("", `${clean(args.university, 30)} 면접 자료는 아직 없어서, 대학 기준 분석 없이 흔함만 봤어요.`);
    }
    if (!u?.name && score >= 40) L.push("", "덜 흔하게 하려면: \"어릴 때부터\", \"사회에 기여하고 싶다\" 같은 말 대신 내가 직접 한 일, 막혔던 순간, 그 뒤 바뀐 생각을 한 장면으로 넣어 보세요.");
  } else {
    if (r.title) L.push(`진단한 책: ${clean(r.title, 60)}${r.author ? ` (${clean(r.author, 30)})` : ""}${r.level ? ` · ${r.level}` : ""}`);
    if (r.reason) L.push("", clean(r.reason, 400));
    const angles = (r.angles ?? []).filter((a: any) => a?.title).slice(0, 3);
    if (angles.length) {
      L.push("", "**같은 책 다르게 읽기**");
      angles.forEach((a: any, k: number) => { L.push(`${k + 1}. ${clean(a.tag, 10)} — ${clean(a.title, 80)}`); if (a.how) L.push(`어떻게: ${clean(a.how, 200)}`); L.push(""); });
    }
    const alts = (r.alternatives ?? []).filter((a: any) => a?.title).slice(0, 3);
    if (alts.length) {
      L.push("**덜 흔한 책**");
      alts.forEach((a: any) => L.push(`- ${clean(a.level, 4)} · ${clean(a.title, 50)}${a.author ? ` (${clean(a.author, 20)})` : ""} — ${clean(a.why, 120)}`));
    }
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const SEUL = { 고1: "고1", 고2: "고2", 고3: "고3" } as Record<string, string>;

const pick = (r: any, keys: string[]) => Object.fromEntries(keys.filter((k) => r[k] !== null && r[k] !== "" && r[k] !== undefined).map((k) => [k, r[k]]));

// 공부법 카드 고르기 (sm_90 study_tips) — 과목·분야가 맞는 것 중 추천 많은 순, 학년·성적대·내신/수능이 맞으면 앞으로
async function findStudyTips(db: any, args: any, n = 8) {
  const cols = "id,title,subject,area,exam,grade,level,summary,steps,for_whom,caution,votes";
  const sub = clean(args?.subject, 8), area = clean(args?.area, 8), kw = clean(args?.keyword, 20);
  let q = db.from("study_tips").select(cols).order("votes", { ascending: false }).limit(300);
  if (sub) q = q.in("subject", sub === "전과목" ? ["전과목"] : [sub, "전과목"]);
  if (area) q = q.eq("area", area);
  let { data: rows, error } = await q;
  if (error) return [];
  if (!rows?.length && area) ({ data: rows } = await db.from("study_tips").select(cols).in("subject", sub ? [sub, "전과목"] : ["전과목"]).order("votes", { ascending: false }).limit(300));
  const norm = (t: string) => String(t ?? "").replace(/\s/g, "");
  const ex = new Set((Array.isArray(args?.exclude) ? args.exclude : []).map((t: unknown) => norm(String(t))));
  let list = (rows ?? []).filter((r: any) => !ex.has(norm(r.title)));
  if (kw) { const hit = list.filter((r: any) => `${r.title} ${r.summary} ${JSON.stringify(r.steps)}`.includes(kw)); if (hit.length) list = hit; }
  const gr = clean(args?.grade, 3), lv = clean(args?.level, 4), ex2 = clean(args?.exam, 3);
  const score = (r: any) =>
    (sub && r.subject === sub ? 4 : 0) + (gr && r.grade === gr ? 2 : 0) + (lv && r.level === lv ? 2 : 0) +
    (ex2 && r.exam === ex2 ? 2 : 0) + Math.min(r.votes ?? 1, 10) * 0.5;
  return list.sort((a: any, b: any) => score(b) - score(a)).slice(0, n).map((r: any) => ({
    id: r.id, title: r.title, subject: r.subject, area: r.area, exam: r.exam, grade: r.grade, level: r.level,
    summary: r.summary, steps: r.steps, for_whom: r.for_whom, caution: r.caution || undefined, seniors: r.votes,
  }));
}

async function runTool(db: any, userId: string, name: string, args: any, token = "", paid = false) {
  if (name === "propose_action") return proposeAction(db, userId, args);
  if (name === "find_seniors") return findSeniors(db, args);
  if (name === "interview_questions") {
    let acts = (Array.isArray(args?.activities) ? args.activities : [])
      .map((a: any) => ({ subject: clean(a?.subject, 30), content: String(a?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 600) }))
      .filter((a: any) => a.content.length >= 5);
    if (!acts.length) {
      const { data } = await db.from("record_activities").select("grade,term,kind,subject,title,content").eq("user_id", userId).order("created_at", { ascending: false }).limit(4);
      acts = (data ?? []).filter((r: any) => clean(r.content, 600)).map((r: any) => ({ ...r, content: clean(r.content, 600) }));
    }
    if (!acts.length) return { need_activities: true, note: "생기부 노트에 활동이 없어요. 면접에서 걱정되는 활동을 학생에게 받아야 해요" };
    const activities = acts.slice(0, 4).map((a: any) => ({
      grade: a.grade ?? "고3", term: a.term ?? "1학기", kind: a.kind ?? "subject", subject: a.subject ?? "", title: a.title ?? "", content: a.content,
    }));
    const r: any = await callFn("interview", {
      university: clean(args?.university, 40), department: clean(args?.department, 40), activities, agreed: true, mode: "preview",
    }, token);
    if (r?.job) {
      // 결제한 학생은 뒤에서 만든다 — 끝날 때까지 잠깐 기다린다 (최대 약 80초)
      for (let k = 0; k < 40; k++) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const { data: j } = await db.from("interview_queries").select("status,result,error").eq("id", r.job).maybeSingle();
        if (j?.status === "done") { r.result = j.result?.results?.[0]; break; }
        if (j?.status === "failed") return { error: j.error ?? "질문을 뽑지 못했어요" };
      }
      if (!r.result) return { running: true, note: "아직 만드는 중이에요. 1~2분 뒤 생기부 예상질문 화면(/interview)이나 마이페이지에서 볼 수 있어요" };
    }
    if (r?.error) return { error: r.error, paywall: r.paywall ?? undefined };
    const res = r?.result ?? {};
    return {
      university: res.university, department: res.department, has_univ_data: res.has_univ_data,
      groups: (res.groups ?? []).map((g: any) => ({ title: g.title, questions: g.questions })),
      used_activities: activities.map((a: any) => `${a.subject || ""} ${clean(a.content, 60)}`.trim()),
      note: "채팅에서는 활동 4개까지 써요. 생기부 전체 활동으로 대학 6곳 질문과 PDF까지 받으려면 생기부 예상질문 화면(24,000원 · 질문마다 답변 피드백·꼬리질문 연습까지)에서 해요",
    };
  }
  if (name === "tail_practice") {
    const answer = String(args?.answer ?? "").trim().slice(0, 1200);
    let body: any;
    if (args?.action === "next") {
      const { data: last } = await db.from("tail_sessions").select("id").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (!last) return { error: "이어서 할 연습이 없어요. 면접 질문과 답변으로 새로 시작해요" };
      body = { action: "next", id: last.id, answer };
    } else {
      body = {
        action: "start", univ: clean(args?.university, 40), department: clean(args?.department, 40),
        main_type: args?.question_type ?? "생기부 질문", main_q: clean(args?.question, 300), answer,
      };
    }
    const r: any = await callFn("tail", body, token);
    if (r?.error) return { error: r.error, done: r.done ?? undefined };
    const tails = (r?.turns ?? []).filter((t: any) => t.q).length;
    return { tail_question: r?.turn?.q, why: r?.turn?.why, tip: r?.turn?.tip, step: tails, max: r?.max ?? 6 };
  }
  if (name === "check_topic") {
    const topic = clean(args?.topic, 100);
    const r = await callFn("diagnose", {
      department: clean(args?.department, 40), subject: clean(args?.subject, 40), topic,
      grade: SEUL[clean(args?.grade, 3)] ?? "", term: "", focus: args?.focus === "subject" ? "subject" : "career", user_id: userId, client_id: null,
    }, token, paid);
    if (r?.quota_exceeded) return { kind: "탐구주제", topic, quota_exceeded: true };
    return { kind: "탐구주제", topic, ...slimCheck("topic", r) };
  }
  if (name === "check_motive") {
    const r = await callFn("motive", {
      department: clean(args?.department, 40), university: clean(args?.university, 40),
      use_for: args?.use_for === "document" ? "document" : "interview", motive: String(args?.motive ?? "").trim().slice(0, 700),
    }, token);
    return { kind: "지원동기", ...slimCheck("motive", r), asked_university: clean(args?.university, 40) || undefined };
  }
  if (name === "check_reading") {
    const r = await callFn("reading", {
      title: clean(args?.title, 80), author: clean(args?.author, 40), department: clean(args?.department, 40),
      subject: clean(args?.subject, 40), grade: SEUL[clean(args?.grade, 3)] ?? "", term: "",
    }, token);
    return { kind: "독서", ...slimCheck("reading", r) };
  }
  if (name === "list_universities") {
    const list = await univList(db);
    const { data } = await db.from("univ_result_names").select("university");
    return { universities: list, with_results: (data ?? []).map((r: any) => r.university) };
  }
  if (name === "my_record") {
    let q = db.from("record_activities").select("grade,term,kind,subject,title,content").eq("user_id", userId).order("created_at").limit(120);
    if (args?.subject) q = q.ilike("subject", `%${clean(args.subject, 20)}%`);
    const { data } = await q;
    return { activities: (data ?? []).map((r: any) => ({ ...pick(r, ["grade", "term", "kind", "subject", "title"]), content: clean(r.content, 700) })) };
  }
  if (name === "get_recommended_subjects") {
    let q = db.from("univ_subject_reco").select("university,campus,college,department,area,level,subjects,note").limit(120);
    if (args?.university) {
      const full = (await matchUniv(db, args.university)) ?? ALIAS[clean(args.university, 40).replace(/\s/g, "")] ?? null;
      const key = clean(args.university, 40).replace(/\s/g, "").replace(/대학교$|대$/, "");
      q = full ? q.ilike("university", `${full}*`.replace("*", "%")) : q.ilike("university", `%${key}%`);
    }
    if (args?.department) {
      const d = clean(args.department, 30).replace(/[(),]/g, "");
      q = q.or(`department.ilike.*${d}*,note.ilike.*${d}*,department.ilike.*전체*,department.ilike.*공통*`);
    }
    if (!args?.university && !args?.department) return { error: "대학이나 학과를 알려 주세요" };
    const { data } = await q.order("university");
    const rows = (data ?? []).map((r: any) => ({ ...pick(r, ["university", "campus", "college", "department", "area", "level", "subjects"]), note: clean(r.note, 300) }));
    const { data: all } = await db.from("univ_subject_reco").select("university").limit(5000);
    return { count: rows.length, rows, univs_with_data: [...new Set((all ?? []).map((r: any) => r.university))], note: rows.length ? undefined : "이 조건의 권장과목 자료가 없어요" };
  }
  if (name === "get_book_recs") {
    // 학과 이름 맞추기 — "간호학과" · "간호" · "간호학부" / 없으면 같은 계열 비슷한 학과
    const raw = clean(args?.department, 30);
    const core = raw.replace(/\s/g, "").replace(/(학과|학부|전공|과)$/, "");
    if (core.length < 2) return { error: "학과를 알려 주세요" };
    const cols = "department,track,area,title,author,level,grade,reason";
    let { data: rows } = await db.from("book_recs").select(cols).eq("department", raw.replace(/\s/g, "")).limit(400);
    if (!rows?.length) ({ data: rows } = await db.from("book_recs").select(cols).ilike("department", `%${core}%`).limit(400));
    if (!rows?.length && core.length >= 3) ({ data: rows } = await db.from("book_recs").select(cols).ilike("department", `%${core.slice(0, 2)}%`).limit(400));
    if (!rows?.length) {
      const { data: all } = await db.from("book_rec_depts").select("department").limit(500);
      const depts = (all ?? []).map((r: any) => r.department);
      return { found: false, note: `${raw} 추천 도서 자료가 아직 없어요`, near_departments: depts.filter((d: any) => [...core].some((c) => d.includes(c))).slice(0, 8) };
    }
    const norm = (t: string) => String(t ?? "").replace(/[\s·:,.()'"“”‘’]/g, "");
    const ex = new Set((Array.isArray(args?.exclude) ? args.exclude : []).map((t: unknown) => norm(String(t))));
    const kw = clean(args?.keyword, 20), lv = clean(args?.level, 4), gr = clean(args?.grade, 3);
    let list = rows.filter((r: any) => !ex.has(norm(r.title)));
    if (kw) { const hit = list.filter((r: any) => `${r.area} ${r.title} ${r.reason}`.includes(kw)); if (hit.length) list = hit; }
    if (lv) { const hit = list.filter((r: any) => r.level === lv || (lv === "심화" && r.level === "최상")); if (hit.length >= 2) list = hit; }
    // 학년에 맞는 책을 앞으로 (권장 학년이 '고1~고2' 처럼 걸쳐 있어도)
    const fit = (r: any) => (gr && String(r.grade).includes(gr.slice(1)) ? 0 : 1);
    list = list.sort(() => Math.random() - 0.5).sort((a: any, b: any) => fit(a) - fit(b)).slice(0, 12);
    return {
      found: true, department: rows[0].department, track: rows[0].track, total: rows.length,
      areas: [...new Set(rows.map((r: any) => r.area).filter(Boolean))].slice(0, 15),
      books: list.map((r: any) => ({ title: r.title, author: r.author || undefined, area: r.area, level: r.level, grade: r.grade, reason: clean(r.reason, 160) })),
    };
  }
  if (name === "get_study_tips") {
    const tips = await findStudyTips(db, args, 8);
    if (!tips.length) return { found: false, note: "이 조건의 공부법 카드가 아직 없어요" };
    return { found: true, tips };
  }
  if (name === "get_topic_cases") {
    // topic_db 칸 이름이 무엇이든 동작하게 (note_diagnose 와 같은 방식)
    const d = clean(args?.department, 30).replace(/(학과|학부|전공)$/, "");
    const kw = clean(args?.keyword, 20);
    if (d.length < 2) return { error: "학과를 알려 주세요" };
    for (const col of ["department", "dept", "major", "학과", "dept_name", "department_name"]) {
      const { data, error } = await db.from("topic_db").select("*").ilike(col, `%${d}%`).limit(kw ? 200 : 40);
      if (error) continue;
      let rows = (data ?? []).map((row: any) =>
        Object.entries(row).filter(([k, v]) => typeof v === "string" && v.trim() && !/(^id$|_id$|created|updated|embedding)/i.test(k))
          .map(([k, v]) => `${k}: ${clean(v, 140)}`).join(" / "));
      if (kw) { const hit = rows.filter((t: string) => t.includes(kw)); if (hit.length) rows = hit; }
      return { count: rows.length, cases: rows.sort(() => Math.random() - 0.5).slice(0, 15) };
    }
    return { error: "탐구 사례 자료를 찾지 못했어요" };
  }
  if (name === "get_interview_style") {
    // 면접 스타일 DB(univ_profiles · tail_univ)는 입시 DB에 없는 대학도 있어서 이름을 따로 맞춘다
    const raw = clean(args?.university, 40).replace(/\s/g, "");
    const full = (await matchUniv(db, raw)) ?? ALIAS[raw] ?? raw;
    const key = (n: string) => n.replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교/g, "대").replace(/대학/g, "대").toLowerCase();
    let { data: p } = await db.from("univ_profiles").select("name,view,question_style,best_answer,preferred,tone,question_mix_label").eq("name", full).maybeSingle();
    if (!p) {
      const { data: list } = await db.from("univ_profiles").select("name,view,question_style,best_answer,preferred,tone,question_mix_label").eq("name_key", key(full));
      p = (list ?? []).find((u: any) => !u.name.includes("(")) ?? (list ?? [])[0] ?? null;
    }
    const { data: t } = await db.from("tail_univ").select("univ,stats").in("univ", [full, raw, full.replace("대학교", "대")]).limit(1);
    if (!p && !t?.length) return { error: `${full} 면접 스타일 자료는 아직 없어요` };
    return {
      university: p?.name ?? full,
      view: clean(p?.view, 500), question_style: clean(p?.question_style, 500), best_answer: clean(p?.best_answer, 400),
      preferred: clean(p?.preferred, 300), tone: clean(p?.tone, 200), question_mix: p?.question_mix_label ?? undefined,
      tail_stats: t?.[0]?.stats ?? undefined,
    };
  }
  const univ = args?.university ? await matchUniv(db, args.university) : null;
  if (args?.university && !univ) return { error: `'${args.university}' 자료가 아직 없어요`, universities: await univList(db) };

  if (name === "search_units") {
    let q = db.from("univ_admission").select("university,year,source,college,department,season,track,quota_type,quota,csat_min,eval_detail,note").limit(univ ? 120 : 80);
    if (univ) q = q.eq("university", univ);
    if (args?.department) q = q.ilike("department", `%${clean(args.department, 30)}%`);
    if (args?.year) q = q.eq("year", Number(args.year));
    if (args?.season) q = q.eq("season", args.season);
    if (args?.track) q = q.ilike("track", `%${clean(args.track, 30)}%`);
    if (args?.no_csat) q = q.or("csat_min.is.null,csat_min.ilike.없음*,csat_min.eq.-");
    if (!univ && !args?.department && !args?.track) return { error: "대학이나 학과·전형 중 하나는 알려 주세요" };
    const { data } = await q.order("university").order("year", { ascending: false });
    const rows = (data ?? []).map((r: any) => ({ ...pick(r, ["university", "year", "college", "department", "season", "track", "quota_type", "quota", "csat_min"]), eval: clean(r.eval_detail, 220), note: clean(r.note, 400) }));
    return { count: rows.length, rows, hint: rows.length >= 80 ? "결과가 많아 일부만 보여 줘요. 대학·학년도·전형으로 좁혀서 다시 찾으세요" : undefined };
  }
  if (name === "get_rules") {
    let q = db.from("univ_admission_rules").select("*").eq("university", univ);
    if (args?.year) q = q.eq("year", Number(args.year));
    const { data } = await q.order("year", { ascending: false });
    return { university: univ, rules: (data ?? []).map((r: any) => pick({ ...r, note: clean(r.note, 300), method: clean(r.method, 300) }, ["year", "season", "track", "track_type", "quota_type", "quota", "method", "subjects", "subject_detail", "grade_calc", "elective_calc", "csat_min", "interview", "interview_ratio", "interview_type", "note"])) };
  }
  if (name === "get_changes") {
    const { data } = await db.from("univ_admission_changes").select("year,item,before,after").eq("university", univ).order("year");
    // year 는 '바뀐 뒤' 학년도 → before 는 그 전 해 값. 헷갈리지 않게 '2026→2027' 처럼 붙여서 준다
    const rows = (data ?? []).map((r: any) => ({ 구분: `${r.year - 1}→${r.year}`, 항목: r.item, [`${r.year - 1}`]: r.before, [`${r.year}`]: r.after }));
    return { university: univ, changes: rows, note: "구분이 '2026→2027'인 줄은 올해 고3 입시가 작년과 달라진 점, '2027→2028'인 줄은 고2 입시가 올해와 달라질 점이다. 학생이 2027과 2028 차이를 물으면 '2027→2028' 줄만 쓴다." };
  }
  if (name === "get_jeongsi_results") {
    // 정시 입결 (sql/sm_99) — 표의 대학 이름은 짧은 이름(연세대 · 서울시립대 · 한국외대)
    const COLS = "track,university,campus,gun,department,tag,band,pct_low,pct_high,exact,unclear,note";
    let q = db.from("univ_jeongsi_results").select(COLS).limit(80);
    const ur = clean(args?.university, 40).replace(/\s/g, "");
    if (ur) {
      const SHORT: Record<string, string> = { 외대: "한국외대", 한국외국어대: "한국외대", 시립대: "서울시립대", 과기대: "서울과기대", 서울과학기술대: "서울과기대", 성대: "성균관대", 이대: "이화여대", 숙대: "숙명여대", 고대: "고려대", 연대: "연세대", 건대: "건국대", 동대: "동국대", 홍대: "홍익대", 단대: "단국대", 에리카: "한양대", 한양대에리카: "한양대" };
      const u = ur.replace(/여자대학교$/, "여대").replace(/대학교$/, "대").replace(/\(.*\)|ERICA/gi, "");
      const name = SHORT[u] ?? (u.endsWith("대") ? u : `${u}대`);
      const { count } = await db.from("univ_jeongsi_results").select("id", { count: "exact", head: true }).eq("university", name);
      q = count ? q.eq("university", name) : q.ilike("university", `%${name.replace(/대$/, "")}%`);
      if (/에리카|ERICA/i.test(ur)) q = q.eq("campus", "에리카");
    }
    // 표는 줄임말 (컴퓨터공 · 경영 · 의예) — '컴퓨터공학과' → '컴퓨터공', '경영학과' → '경영'
    if (args?.department) {
      const d0 = clean(args.department, 30).replace(/\s/g, "");
      let d = d0.replace(/(학과|학부|전공|과)$/, "").replace(/공학$/, "공");
      if (d.length < 2) d = d0.replace(/(과|학부|전공)$/, ""); // 수학과 → 수학 · 약학과 → 약학
      q = q.ilike("department", `%${d}%`);
    }
    if (args?.track === "인문" || args?.track === "자연") q = q.eq("track", args.track);
    const p = Number(args?.percentile);
    if (Number.isFinite(p) && p > 0) {
      const w = Math.max(0.3, p * 0.15); // 상위권일수록 좁게 (1% → ±0.3 · 10% → ±1.5)
      q = q.gte("pct_low", Math.max(0, p - w)).lte("pct_low", p + w);
    }
    const { data } = await q.order("pct_low", { ascending: true });
    const rows = (data ?? []).map((r: any) => ({
      계열: r.track, 대학: r.university + (r.campus && r.campus !== "서울" ? `(${r.campus})` : ""), 군: r.gun ? `${r.gun}군` : "", 학과: r.department + (r.tag ? `[${r.tag}]` : ""),
      누적백분위: r.exact != null ? `${r.exact}%` : (r.pct_high == null ? `${r.pct_low}% 이하` : `${r.pct_low}~${r.pct_high}%`), ...(r.unclear ? { 확인필요: "원본 글자가 흐려 이름이 정확하지 않을 수 있음" } : {}),
    }));
    return {
      results: rows,
      note: rows.length
        ? "2026학년도 정시 최종 결과(네이버 카페 오쓰카 '입결표 최종(9월)' 참고 자료)다. 누적 백분위는 수능 성적이 상위 몇 %인지이고 작을수록 높다. 커트라인 순서가 대학·학과의 우열을 뜻하지 않고, 해마다 바뀌며 대학마다 반영 비율·과목 가산점이 달라 참고용이다. 학과 이름은 표의 줄임말이다(예: 사복=사회복지, 국교=국어교육). [지]=지역균형, [인]=인문계열 모집, [자]=자유전공 등."
        : "이 대학·학과는 정시 입결 자료가 아직 없어요 (인서울 주요 대학 · 의치한약수 위주로 들어 있음)",
    };
  }
  if (name === "get_results" && !univ) {
    // 전국에서 학과 + 내신으로 찾기 (sql/sm_77 · 어디가 2026 입결)
    if (!args?.department) return { error: "대학이나 학과 중 하나는 알려 주세요" };
    const d0 = clean(args.department, 30).replace(/\s/g, "");
    let d = d0.replace(/(학과|학부|전공|과)$/, "");
    if (d.length < 2) d = d0;
    const g = Number(args?.grade);
    let q = db.from("univ_admission_results").select("university,result_year,department,track,quota,competition,cut50,cut70")
      .ilike("department", `%${d}%`).gte("result_year", 2025).not("cut70", "is", null);
    if (Number.isFinite(g) && g > 0) q = q.gte("cut70", Math.max(1, g - 0.8)).lte("cut70", g + 1.2);
    const { data } = await q.limit(900);
    const SPECIAL = /지역인재|지역기회|농어촌|기회균|특성화|장애|특수교육|기초|차상위|저소득|사회배려|사회통합|사회기여|보훈|서해|고른기회|다문화|만학도|성인학습|재직자|평생학습|군위탁|계약학과|한부모|정원외|목회자|교역자|추천자|특기자|외국인|북한/;
    const best = new Map<string, any>();   // 대학·학과·전형마다 가장 최근 해만
    for (const r of data ?? []) {
      if (/\[정시/.test(r.track) || (!args?.special && SPECIAL.test(r.track))) continue;
      const k = `${r.university}|${r.department}|${r.track}`;
      const o = best.get(k);
      if (!o || r.result_year > o.result_year) best.set(k, r);
    }
    const rows = [...best.values()];
    if (!rows.length) return { results: [], note: `'${d0}' 수시 입결을 아직 못 찾았어요 (어디가 2026 입결을 대학별로 넣는 중)` };
    const show = (r: any) => ({ 대학: r.university, 학과: r.department, 전형: r.track, 학년도: r.result_year, 모집: r.quota, 경쟁률: r.competition, "50%컷": r.cut50, "70%컷": r.cut70 });
    if (!(Number.isFinite(g) && g > 0)) return { results: rows.sort((a, b) => a.cut70 - b.cut70).slice(0, 40).map(show) };
    const group = (lo: number, hi: number) => {
      const seen = new Set<string>(), out: any[] = [];
      for (const r of rows.filter((r) => r.cut70 >= lo && r.cut70 < hi).sort((a, b) => Math.abs(a.cut70 - g) - Math.abs(b.cut70 - g))) {
        if (seen.has(r.university)) continue;   // 대학마다 한 줄 (내 내신에 가장 가까운 전형)
        seen.add(r.university); out.push(show(r));
        if (out.length >= 10) break;
      }
      return out;
    };
    return {
      grade: g,
      도전: group(0, g - 0.2),            // 70%컷이 내 내신보다 높음 (숫자가 작음)
      적정: group(g - 0.2, g + 0.3),
      안정: group(g + 0.3, 99),
      note: "어디가 2026학년도 수시 결과(9등급 환산등급) 기준이다. 70%컷 = 합격자 중 70% 지점 등급(숫자가 작을수록 높음). 도전 = 70%컷이 내 내신보다 0.2 넘게 높은 곳, 적정 = 비슷한 곳, 안정 = 0.3 넘게 낮은 곳. 해마다 바뀌고 학종은 내신만으로 정해지지 않아 참고용이다. 일반 전형만 골랐다 — 지역인재(그 지역 고교 졸업자만)·농어촌·기회균형 같은 특별전형은 빠져 있다 (넣으려면 special=true).",
    };
  }
  if (name === "get_results") {
    let q = db.from("univ_admission_results").select("result_year,department,track,quota,competition,extra,cut50,cut70,avg,cut_min,grade_system,change_note,score50,score70").eq("university", univ).limit(80);
    if (args?.department) q = q.ilike("department", `%${clean(args.department, 30)}%`);
    const { data } = await q.order("result_year", { ascending: false });
    return { university: univ, results: (data ?? []).map((r: any) => pick(r, Object.keys(r))), note: (data ?? []).length ? undefined : "이 대학은 입결 자료가 아직 없어요" };
  }
  return { error: "알 수 없는 도구" };
}

/* ───────── 학년 — 마이페이지 '내 정보' 학년 → 가입 때 고른 학년 순서 (화면 위 '고2 기준으로 답해요'와 같은 값) */
async function gradeOf(db: any, userId: string, meta: any = {}) {
  const [{ data: m }, { data: p }] = await Promise.all([
    db.from("sm_my").select("grade").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("grade").eq("id", userId).maybeSingle(),
  ]);
  const raw = String(m?.grade || meta?.grade || p?.grade || "");
  const g = raw.match(/[123]/)?.[0];
  return /N수|재수|졸업/.test(raw) ? "N수" : g ? `고${g}` : "";
}
const YEAR_OF: Record<string, number> = { 고1: 2029, 고2: 2028, 고3: 2027, N수: 2027 };

/* ───────── 학생 정보 (생수면에서 한 것들) — 대화마다 짧게 붙인다 */
async function studentContext(db: any, userId: string, meta: any = {}) {
  const [prof, my, acts, diag, iv, mot, grades, tails, inq, pl] = await Promise.all([
    db.from("profiles").select("name,school,grade").eq("id", userId).maybeSingle(),
    db.from("sm_my").select("grade,department").eq("user_id", userId).maybeSingle(),
    db.from("record_activities").select("grade,kind,subject,title,content").eq("user_id", userId).order("created_at", { ascending: false }).limit(40),
    db.from("note_diagnoses").select("departments,result,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("interview_queries").select("university,department,targets,created_at").eq("user_id", userId).neq("status", "failed").order("created_at", { ascending: false }).limit(5),
    db.from("motive_queries").select("university,department,motive").eq("user_id", userId).order("created_at", { ascending: false }).limit(3),
    db.from("study_grades").select("subject,grade,exam").eq("user_id", userId),
    db.from("tail_sessions").select("univ,department").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
    db.from("inquiries").select("department,grade,subject,topic,suggestion,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
    db.from("study_plans").select("grade,department,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const L: string[] = [];
  const p = prof.data ?? {}, m = my.data ?? {};
  // 가입할 때 적은 정보 + 마이페이지 '내 정보' (마이페이지 화면과 같은 순서: 내 정보 학년 → 가입 학년)
  const grade = m.grade || meta?.grade || p.grade || "모름";
  L.push(`[가입·마이페이지 정보] 학년: ${grade} · 학교: ${p.school || meta?.school || "모름"} · 희망 학과: ${m.department || meta?.major || "모름"}`
    + ` (가입 때 적은 학년: ${meta?.grade || p.grade || "없음"}${m.grade ? ` · 마이페이지 내 정보 학년: ${m.grade}` : ""})`);
  // 학년 상태 — 지난 학년 활동을 생기부 노트에 적었는지 (고2면 고1, 고3이면 고1·고2)
  {
    const gnum = Number(String(grade).match(/[123]/)?.[0] ?? 0);
    const byG = (n: number) => (acts.data ?? []).filter((r: any) => String(r.grade ?? "").includes(String(n))).length;
    const prev = gnum >= 2 ? Array.from({ length: gnum - 1 }, (_, i) => i + 1) : [];
    const prevCnt = prev.reduce((s0, n) => s0 + byG(n), 0);
    L.push(`[학년 상태] ${gnum ? `고${gnum}` : "학년 모름"} · ${gnum ? `${YEAR_OF[`고${gnum}`]}학년도 입시` : "학년도 모름"}`
      + (prev.length ? ` · 지난 학년(${prev.map((n) => `고${n}`).join("·")}) 생기부 노트 활동 ${prevCnt}개` : "")
      + ` · 지금 학년 활동 ${gnum ? byG(gnum) : 0}개`);
  }
  const d = diag.data?.result;
  if (d) {
    L.push(`[생기부 노트 진단] 희망 학과 ${(diag.data.departments ?? []).join(", ")} · 기준 학과 ${d.main ?? "-"}`);
    if (Array.isArray(d.fit)) L.push("학과 연결도: " + d.fit.map((f: any) => `${f.department} ${f.level}(${f.score})`).join(", "));
    if (d.summary) L.push("요약: " + clean(d.summary, 300));
    if (Array.isArray(d.competencies)) L.push("역량: " + d.competencies.map((c: any) => `${c.name} ${c.status}`).join(", "));
  }
  const a = acts.data ?? [];
  if (a.length) {
    L.push(`[생기부 활동 ${a.length}개 — 최근 것 요약, 자세히는 my_record 도구]`);
    for (const r of a.slice(0, 25)) L.push(`- ${r.grade ?? ""} ${r.kind ?? ""} ${r.subject ?? ""}${r.title ? ` · ${r.title}` : ""}: ${clean(r.content, 110)}`);
  } else L.push("[생기부 활동] 아직 생수면에 적은 활동 없음");
  const ivs = iv.data ?? [];
  if (ivs.length) {
    const t = new Set<string>();
    ivs.forEach((r: any) => { (Array.isArray(r.targets) ? r.targets : []).forEach((x: any) => x?.university && t.add(`${x.university}${x.department ? " " + x.department : ""}`)); if (r.university) t.add(`${r.university}${r.department ? " " + r.department : ""}`); });
    if (t.size) L.push("[생기부 예상질문을 뽑은 지원 대학] " + [...t].slice(0, 8).join(", "));
  }
  for (const r of mot.data ?? []) L.push(`[지원동기] ${r.university ?? ""} ${r.department ?? ""}: ${clean(r.motive, 200)}`);
  const g = grades.data ?? [];
  if (g.length) L.push("[인증한 성적] " + g.map((r: any) => `${r.subject} ${r.grade}등급${r.exam ? `(${r.exam})` : ""}`).join(", "));
  const iq = inq.data ?? [];
  if (iq.length) {
    L.push("[생수면에서 한 탐구주제 (최근 순)]");
    for (const r of iq) L.push(`- ${r.department ?? ""} · ${r.grade ?? ""} ${r.subject ?? ""}: ${clean(r.suggestion || r.topic, 90)}`);
  }
  if (pl?.data) L.push(`[내 입시 플랜] 있음 — ${pl.data.grade}${pl.data.department ? ` · ${pl.data.department}` : ""} (${String(pl.data.created_at).slice(0, 10)} 만듦)`);
  const tl = tails.data ?? [];
  if (tl.length) L.push("[꼬리질문 연습한 대학] " + [...new Set(tl.map((r: any) => `${r.univ} ${r.department ?? ""}`.trim()))].join(", "));
  const mem = memoryText(await memoryOf(db, userId).catch(() => ({ facts: {}, notes: [] })));
  return `${mem}\n\n${L.join("\n")}`.slice(0, 8000);
}

/* ───────── 물꼬 노트 (sql/sm_96 agent_memory) — 학생에 대해 기억하는 것 ─────────
 * 대화가 끝날 때마다 학생이 한 말에서 오래 기억할 것만 뽑아 고친다 (뒤에서 · 학생 사용량에 안 들어감)
 * 학생은 '물꼬가 기억하는 나'에서 보고 지울 수 있다
 */
const MEM_KEYS = ["학년", "계열", "목표 대학", "목표 학과", "성적", "약한 과목", "약한 단원", "틀리는 이유", "공부 습관", "지원 대학", "면접 일정", "고민"];
async function memoryOf(db: any, userId: string) {
  const { data } = await db.from("agent_memory").select("facts,notes,updated_at").eq("user_id", userId).maybeSingle();
  return { facts: (data?.facts ?? {}) as Record<string, string>, notes: (Array.isArray(data?.notes) ? data.notes : []) as any[], updated_at: data?.updated_at ?? null };
}
function memoryText(m: { facts: Record<string, string>; notes: any[] }) {
  const L: string[] = [];
  for (const k of MEM_KEYS) if (m.facts?.[k]) L.push(`- ${k}: ${clean(m.facts[k], 120)}`);
  for (const n of (m.notes ?? []).slice(-12)) if (n?.t) L.push(`- ${clean(n.t, 80)}${n.at ? ` (${String(n.at).slice(5, 10)})` : ""}`);
  return L.length ? `[물꼬 노트 — 지난 대화에서 이 학생에 대해 기억한 것. 아래 다른 정보와 다르면 더 최근 것을 따른다]\n${L.join("\n")}` : "[물꼬 노트] 아직 기억한 것 없음 (처음 이야기하는 학생)";
}
async function updateMemory(db: any, userId: string, message: string, answer: string) {
  const said = String(message ?? "").replace(/\s+/g, " ").trim();
  if (said.replace(/\s/g, "").length < 4) return;
  const cur = await memoryOf(db, userId);
  const sys = `너는 입시 상담 AI '물꼬'의 기억 담당이다. 학생이 이번에 한 말에서 다음 상담에도 쓸 '오래 가는 사실'만 뽑아 물꼬 노트를 고친다. JSON만 출력.
- 학생이 직접 말한 것만. 물꼬 답에 나온 추천 · 추측 · 예시는 넣지 않는다 (물꼬 답은 학생 말이 무엇에 대한 답인지 이해하는 데만 쓴다).
- 질문 카드에서 "더 볼까요 · 자세히 · 어떤 계열을 볼까요" 같은 둘러보기 보기를 고른 것은 학생의 목표가 아니다 — 계열 · 목표 학과에 넣지 않는다. 학생이 "나는 ○○ 가고 싶어", "내 희망은 ○○"처럼 자기 목표로 말할 때만 넣는다.
- facts: 바뀌거나 새로 알게 된 칸만. 칸 이름은 이것만: ${MEM_KEYS.join(" · ")}. 값은 짧게 (60자 안). 학생이 더 이상 아니라고 하면 그 칸을 "" 로.
  · 성적은 과목과 함께 (예: "수학 4등급(모의) · 국어 2등급"). 면접 일정은 대학과 날짜 (예: "가천대 11/22").
- notes_add: 칸에 안 맞지만 오래 기억할 것 (최대 2개, 40자 안). 예: "인강보다 문제집으로 공부하는 걸 좋아함"
- notes_remove: 이제 맞지 않는 기존 노트의 번호.
- 넣지 않는 것: 오늘 기분 · 한 번 묻고 끝나는 궁금증 · 인사 · 건강 · 질병 · 가족 사정 · 연애 · 종교 · 정치 같은 민감한 개인 이야기 · 다른 사람의 개인 정보.
- 바뀐 게 없으면 {"facts":{},"notes_add":[],"notes_remove":[]}
{"facts":{},"notes_add":[],"notes_remove":[]}`;
  const prompt = `[지금 물꼬 노트]\n${JSON.stringify(cur.facts)}\n${cur.notes.map((n: any, i: number) => `${i}. ${n.t}`).join("\n") || "(노트 없음)"}\n\n[물꼬가 바로 앞에 한 말 (참고만)]\n${String(answer ?? "").replace(/\[\[[^\]]*\]\]/g, "").slice(0, 600)}\n\n[학생이 이번에 한 말]\n${said.slice(0, 1500)}`;
  const res = await openai({ model: "gpt-5-mini", max_completion_tokens: 1500, reasoning_effort: "minimal", response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] });
  const raw = await res.text();
  let out: any = null, inT = 0, outT = 0;
  try {
    const j = JSON.parse(raw);
    inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0);
    out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
  } catch { console.error("memory", res.status, raw.slice(0, 300)); }
  await logUsage(db, userId, inT, outT, Boolean(out), "agent_mem"); // 회사 비용 — 학생 사용량에는 안 들어감
  if (!out) return;
  const facts = { ...cur.facts };
  let changed = false;
  for (const [k, v] of Object.entries(out.facts ?? {})) {
    if (!MEM_KEYS.includes(k)) continue;
    const val = clean(v, 80);
    if (val === (facts[k] ?? "")) continue;
    if (val) facts[k] = val; else delete facts[k];
    changed = true;
  }
  const drop = new Set((Array.isArray(out.notes_remove) ? out.notes_remove : []).map(Number));
  let notes = cur.notes.filter((_: any, i: number) => !drop.has(i));
  if (notes.length !== cur.notes.length) changed = true;
  const now = new Date().toISOString();
  for (const t of (Array.isArray(out.notes_add) ? out.notes_add : []).slice(0, 2)) {
    const tt = clean(t, 60);
    if (tt && !notes.some((n: any) => n.t === tt)) { notes.push({ t: tt, at: now }); changed = true; }
  }
  notes = notes.slice(-20);
  if (!changed) return;
  await db.from("agent_memory").upsert({ user_id: userId, facts, notes, updated_at: now }, { onConflict: "user_id" });
}

function systemPrompt(student: string) {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜
  return `너는 생수면의 '물꼬 입시 AI'다. 학생이 이름을 물으면 '물꼬 입시 AI'라고 말한다. 오늘은 ${today} (한국 시간)이다. 한국 고등학생(주로 고1~고3)과 학부모의 대입 질문에 답한다.

[기억과 행동 — 너는 이 학생의 개인 입시 에이전트다]
- [학생 정보] 맨 위 '물꼬 노트'는 지난 대화에서 이 학생에 대해 기억한 것이다. 이미 아는 것(학년 · 목표 · 성적 · 약한 과목 등)은 다시 묻지 말고 바로 쓴다. 필요하면 "지난번에 수학 미적분이 약하다고 했지?"처럼 자연스럽게 이어 간다. 학생이 이번에 다르게 말하면 이번 말을 따른다.
- 노트에 있는 걸 일부러 다 늘어놓지 않는다. 지금 질문에 필요한 것만 쓴다.
- 말로만 "○○ 화면에 가서 해 보세요"라고 하지 말고, 직접 해 줄 수 있으면 propose_action 도구로 제안한다:
  · prep_school — 학생이 어느 대학 · 학과 면접을 준비하겠다 / 연습하고 싶다고 하면: 수시 면접 준비에 그 학교 넣기
  · study_test — 학생이 약한 과목 · 단원을 말하며 공부법 · 루틴을 물으면 (공부법을 알려 준 뒤): 그 단원 공부법 효과 시험 만들기
  도구가 돌려준 card(예: [[할일:12]])를 답 맨 끝에 그대로 붙인다. 학생이 [네]를 눌러야 실행되니 "넣어 둘까요?"처럼 묻는다 ("넣어 뒀어요" 금지).
  한 답에 제안은 2개까지. 도구가 already 를 돌려주면 이미 되어 있다고 짧게 말하고 카드는 붙이지 않는다.
- 학생이 학과 · 계열에 맞춰 뭘 해야 하는지, 합격생은 어떻게 했는지, 세특 · 창체 · 동아리 · 활동 방향을 물으면 find_seniors 로 실제 합격 선배 사례를 먼저 찾는다.
  찾으면 "실제 가천대 의약·보건 합격 선배 생기부를 보니"처럼 근거(대학 · 계열 · 학년)를 밝히고, 선배가 한 것을 요약해 2~4개 보여 준 뒤 이 학생에게 맞게 바꿔 제안한다. 문장을 길게 그대로 옮기지 않는다.
  선배 사례를 지어내지 않는다. found 가 0이면 "아직 이 계열 선배 사례가 없어서 일반 정보로 알려 줄게"라고 나눠 말한다.

[물꼬 입시 AI 이용 안내 — 학생이 사용량·광고·결제를 물으면 이걸로 답한다]
- 무료 회원: 매주 정해진 사용량(화면 위 '이번 주 사용량 %')을 쓸 수 있고, 매주 월요일 0시에 다시 채워진다. 무료로 받은 답 아래에는 광고가 나온다.
- 친구가 내 추천 링크로 가입하면 주간 사용량이 늘어난다(4명까지).
- 생수면 이용권: 요금제는 지금 한 달 12,900원 하나만 판다 (6개월·1년 요금제는 아직 없다고 말한다). 승인된 날부터 그 기간 동안 물꼬 사용량 한도가 크게 늘고 광고가 없다. 면접 꼬리질문(개수 제한 없음), 흔한가 진단(탐구주제는 무료 하루 3번 → 횟수 없이), 생기부 로드맵, 탐구팩도 모두 열린다. 계좌 입금 후 '입금했어요'를 누르면 확인되는 대로 열린다.
- 생기부 예상질문(내 생기부 전체 · 대학 6곳 · PDF · 질문마다 답변 피드백과 꼬리질문 연습)은 이용권과 따로 24,000원 (생기부 예상질문 화면에서 결제).
- 수시 면접 준비(/prep) 기출문제 학습: 무료는 학교 1곳 · 3문제, 친구 1명이 내 링크로 가입할 때마다 5문제 더. 친구 초대 대신 이용권(한 달 12,900원)이면 학교 6곳까지 기출 무제한, 생기부 예상질문(24,000원)을 사면 기출 무제한 + 예상질문 학습까지.
- 광고를 없애고 싶다는 질문이면 브라우저 광고 차단 방법 같은 바깥 이야기는 하지 말고, 위 이용권을 짧게 안내한 뒤 마지막 줄에 [[이용권]] 을 붙인다 (화면에 결제 버튼이 생긴다).
- 사용량을 다 썼다는 질문이면 초기화 시각·친구 초대·이용권을 안내하고 마지막 줄에 [[이용권]] 을 붙인다.

[지금 입시 시기 — 오늘 날짜에 맞춰 조언한다]
- 2027학년도(현 고3): 수시 원서접수는 2026년 9월에 이미 끝났다. 수능은 2026년 11월 19일. 그 뒤 수시 면접·논술 고사, 12월 수시 발표, 12월 말~1월 정시 원서접수.
  → 고3에게 지금 "서류 보완·활동 추가·봉사·생기부 기재"를 권하지 않는다(이미 끝남). 지금 할 수 있는 것: 수능(최저 맞추기), 이미 지원한 전형의 면접·논술 대비, 정시 준비.
  → 고3이 "어떻게 해야 돼?"라고 물으면 먼저 수시에 이미 지원했는지 카드로 묻는다.
- 2028학년도(현 고2): 내년 수시를 준비하는 시기. 생기부·선택과목·내신·탐구 조언이 의미 있다.
- 고1: 2029학년도. 발표 전이라 2028 기준으로 방향만 말한다.
- 학년은 [학생 정보]보다 학생이 대화에서 직접 말한 학년을 따른다 (예: 가입은 고3인데 "나 고1이야" → 고1 · 2029학년도로 답한다). 학년도를 말할 때 고3=2027 · 고2=2028 · 고1=2029 를 틀리지 않는다. 가입 학년이 다르면 "마이페이지에서 학년을 고치면 다음부터 맞춰 드려요"라고 한 줄 덧붙인다.

[하면 안 되는 말]
- 생기부·세특·창체 문장을 다듬거나 대신 써 줄 때는 학생이 적은 사실(한 활동 · 실험 조건 · 수치 · 결과)만 쓴다. 학생이 하지 않은 실험 · 농도 · 반복 · 통계 · 결과 · 확장 활동(예: '농도별 처리', '용량-반응 곡선', 'EC50 산출')을 더하지 않는다. 생기부에 없는 활동은 면접에서 학생을 곤란하게 만든다.
  · 글자 수를 채워야 하는데 사실이 모자라면 지어내지 말고, "더 쓰려면 이런 걸 알려 주세요 (실험 조건 · 반복 횟수 · 결과 숫자 · 내가 맡은 역할 · 배운 점)"라고 묻는다. 앞으로 할 계획은 '계획함'으로만 쓴다.
- 면접 '기출'이나 '자료: ○○ 문항집' 같은 출처는 도구 결과에 실제로 있을 때만 말한다. 없으면 기출이라고 하지 않고 "생기부를 보고 뽑은 예상질문"이라고 밝힌다.
- 학생이 면접 기출 · 생기부 예상질문을 달라고 하면: 기출문제는 '수시 면접 준비'에서 지원 대학별로 연습한다고 짧게 안내하고 답 맨 끝에 [[면접준비]] 를 붙인다 (수시 면접 준비 화면으로 가는 버튼). 생기부 예상질문을 이 채팅에서 몇 개 뽑아 줄 때도 끝에 [[면접준비]] 를 붙인다.
- 생기부 노트의 활동이 지금 묻는 학과와 다르면 (예: 물리치료 면접인데 노트가 건축 활동) 그 활동으로 질문을 만들지 말고 "생기부 노트가 ○○ 활동이라 지금 학과와 달라요. 이 학과 활동을 알려 주면 맞춰 뽑아 줄게요"라고 먼저 말한다.
- 자기소개서·교사추천서(대입에서 폐지), 수상 실적·개인 봉사 실적(대입 미반영)을 준비하라고 하지 않는다.
- DB에서 찾지 않은 대학별 특징(면접 스타일, "○배수 후 면접", 경쟁률 등)을 지어내지 않는다. 면접 특징은 get_interview_style 결과가 있을 때만 말한다.
- 입결이 DB에 없으면 "합격 가능성은 입결 자료가 없어 판단하기 어려워요"라고 말하고, 가능성을 짐작해 말하지 않는다.
- 성적이 내신인지 모의고사인지는 웬만하면 묻지 않는다. 3.01 · 2.7 처럼 소수점이 있으면 내신이다. "모의고사 · 수능 · 백분위"라는 말이 없으면 내신으로 보고 수시로 답한다. 정말 알 수 없을 때(예: 숫자 없이 "3등급인데 정시 수시 어디?")만 카드로 한 번 묻는다.

[내 성적으로 갈 수 있는 대학 — 중요]
- "내신 3.01인데 간호학과 어디 가능?", "3등급대 갈 수 있는 경영학과"처럼 성적 + 학과로 물으면 되묻지 말고 바로 get_results 를 university 없이 department + grade 로 불러 답한다. 지역 · 전형 · 대학을 먼저 묻지 않는다 (지역 무관 · 일반 전형으로 정하고 한 줄로 밝힌다).
- 학과가 없으면 [학생 정보]의 희망 학과를 쓴다. 학과도 희망 학과도 없을 때만 [입력 카드]로 학과 하나만 묻는다.
- 답 모양: 맨 위 한 줄 "내신 3.01 · 수시 일반전형 · 전국 기준이에요 (어디가 2026 입결)". 그다음 도전 · 적정 · 안정 순서로 대학을 3~5곳씩, 각 줄에 '대학 · 전형 · 70%컷 · 경쟁률' 숫자를 그대로 쓴다. 마지막에 "학종은 내신만으로 정해지지 않아요" 한 줄.
- "어떤 대학을 확인해 볼까요?", "대학 5곳을 골라 주면 확인해 줄게요" 처럼 학생에게 대학을 고르게 하지 않는다. 도구가 전국에서 골라 준다.
- 끝에 이어 가기 카드는 하나만 붙일 수 있다: [[질문: 이어서 볼까요? | 특별전형도 — 농어촌·기회균형 등 해당되면 | 한 대학 자세히 — 대학 이름을 적어 주세요 | 다른 학과 — 학과를 적어 주세요]]

[학과 · 계열 둘러보기 ("요즘 뜨는 학과", "유망 학과", "○○ 계열 더 알려 줘")]
- 생수면 DB에는 '뜨는 학과 순위' 자료가 없다. 흐름을 말할 때는 "일반적인 흐름이에요"라고 밝히고, 끝의 출처 줄에 "대학·산업 채용·연구 트렌드 종합" 같은 지어낸 출처를 쓰지 않는다. 출처 줄은 실제로 부른 도구 자료만 적는다 (도구를 안 불렀으면 출처 줄을 쓰지 않는다).
- 흐름은 2~3개 계열만 짧게 말하고, 각 계열에 실제 학과 이름 예를 붙이려면 search_units(department: 인공지능 · 데이터 · 바이오 같은 낱말)로 찾은 대학·학과 이름만 쓴다.
- 학생이 한 계열을 골라 "더 보기"를 누르면 그 계열 자체를 보여 준다. 공부법 카드(get_study_tips)로 넘어가지 않는다. 이 순서로:
  ① 이 계열 학과 이름 예 3~5개 (search_units 결과 · 대학 이름과 함께)
  ② 고교에서 들으면 좋은 과목 (get_recommended_subjects · 대학 비우고 학과 낱말로)
  ③ 수시 입결 범위 (get_results · 대학 비우고 학과 낱말로 → 70%컷이 대략 몇~몇 등급인지 한 줄)
  ④ 입문 책 1권 (get_book_recs)
- 바로 앞 답에 붙였던 것과 같은 질문 카드를 또 붙이지 않는다. 이어 가기 카드는 다음 단계로: [[질문: 다음은? | 내 성적으로 갈 곳 — 내신을 적어 주세요 | 탐구주제 — 이 계열 세특 주제 | 다른 계열 — 바이오·에너지 등]]

[자료 쓰는 법]
- 대학 입시 정보(모집인원·전형·수능최저·면접·바뀐 점·입결)는 반드시 도구로 DB를 찾아서 답한다. 기억으로 지어내지 않는다.
- 2027 = 현재 고3(2027학년도 모집요강), 2028 = 현재 고2(2028학년도 시행계획, 확정 전). 학생 학년에 맞는 학년도 하나만 보여 준다(고3 → 2027, 고2 → 2028). 학생이 다른 학년도를 물을 때만 그 학년도를 보여 준다. 고1이면 2028 기준으로 말하고 "2029학년도는 아직 발표 전"이라고 덧붙인다.
- 생수면 DB에 있는 대학만 다룬다. DB에 없는 대학·정보는 "아직 생수면에 ○○ 자료가 없어요"라고 솔직히 말하고, 기억으로 지어내거나 비슷한 대학 자료로 대신하지 않는다.
  그때는 "11월 안에 넣어 드릴 예정이에요. 꼭 필요한 자료가 있으면 건의함에 남겨 주세요 — 남긴 것부터 먼저 넣어요." 라고 말하고 답 맨 끝에 [[건의함]] 을 붙인다 (생수면 의견함으로 가는 버튼).
  입결 · 경쟁률 · 면접 기출 · 대학 정보처럼 자료가 없는 것은 모두 같다. 다른 방식으로 도와드릴까요 같은 되묻기는 붙이지 않는다. [[대학요청]] 카드는 쓰지 않는다.
- 면접 준비 질문("○○대 면접 어떻게 봐?")이면 search_units/get_rules 로 면접 방식(비율·단계)을 찾고, get_interview_style 로 그 대학 면접관 스타일까지 함께 알려 준다.
- 권장과목(고교에서 들으면 좋은 선택과목) 질문은 get_recommended_subjects 로 찾는다. 대학이 쓴 말(핵심/권장/추천)을 그대로 쓰고, 권장과목은 "필수"가 아니라 대학이 권하는 것임을 함께 말한다. 학생 생기부 노트에 들은 과목이 있으면 맞춰 보고 빠진 과목을 알려 준다. 자료가 없는 대학은 "아직 자료가 없어요"라고 말하고 지어내지 않는다.
- 정시(수능) 입결은 get_jeongsi_results 로 찾는다 (2026학년도 정시 결과 · 누적 백분위 %). 수시 입결(내신 컷)은 get_results. 학생이 정시·수능·모의고사 성적으로 갈 수 있는 곳을 물으면 get_jeongsi_results 를 쓴다.
  · 모의고사 등급만 말하면 누적 백분위를 짐작하지 말고 "국수탐 백분위나 누적 %를 알면 더 정확해요"라고 하고, 등급 기준의 대략적인 범위로만 말한다.
  · 답할 때 "2026학년도 정시 결과 기준 참고 자료"임을 한 번 밝히고, 확인필요 표시가 있는 학과는 이름이 정확하지 않을 수 있다고 덧붙인다.
- 입결(합격자 성적)은 일부 대학만 있다. 없으면 없다고 말하고, 합격 가능성을 단정하지 않는다 ("가능성이 있어 보여요" 정도로만, 근거 숫자와 함께).
- 숫자(인원·등급·비율)는 DB 값을 그대로 쓴다.

[학년에 맞춰 답하기 — 중요]
- [학생 정보]의 [학년 상태]를 먼저 본다. 가입 때 고른 학년이 기본이고, 학생이 대화에서 다른 학년을 말하면 그걸 따른다.
- 학년을 모르면(학년 모름) 탐구주제 · 로드맵 · 입시 질문에 답하기 전에 학년부터 카드로 묻는다:
  [[질문: 지금 몇 학년이에요? | 고1 — 2029학년도 입시 | 고2 — 2028학년도 입시 | 고3 — 2027학년도 입시 | N수생]]
- 학년별로 말하는 것이 다르다:
  · 고1: 진로 탐색 · 기초 과목 · 활동을 쌓기 시작하는 때. 어려운 말 대신 쉬운 말로 짧게. 입결 · 전형은 방향만.
  · 고2: 고1 활동을 이어서 깊게 만드는 때 (선택과목 · 심화 탐구 · 학과 맞추기). 탐구주제 · 세특 · 입시 로드맵 · 학과 추천을 물으면 고1 때 한 활동을 바탕으로 이어 준다.
  · 고3: 수시 원서는 이미 끝남 → 수능 · 면접 · 논술 · 정시. 새 활동을 권하지 않는다.
- 고2 · 고3 학생이 탐구주제 · 세특 방향 · 입시 로드맵 · 학과 추천 · 생기부를 물었는데 [학년 상태]의 지난 학년 생기부 노트 활동이 0개면:
  답 앞에서 "고1 때 한 활동을 알면 이어지는 걸로 맞춰 줄 수 있어요"라고 한 줄 말하고, 지난 학년 활동을 적는 칸을 낸다 —
  [[입력: 고1 때 한 활동 (생각나는 것만) | 과목·동아리 | 한 활동]]
  학생이 바로 답을 원하면(이미 한 번 물었거나 "그냥 알려줘") 묻지 말고 일반 방향으로 답한 뒤 끝에 [[노트]] 를 붙인다 (생기부 노트에 활동을 적으러 가는 버튼).
- 지난 학년 활동이 있으면 그 활동을 이름으로 짚으며 이어지는 다음 단계를 제안한다 (예: "고1 때 한 ○○ 탐구를 이렇게 심화해 보세요").

[먼저 물어보기 — 중요]
- 질문이 넓어서 답이 너무 많아지는 경우(예: "탐구주제 찾아 줘", "나한테 맞는 학교 추천해 줘", "학종 어디 써?")에는 바로 목록을 나열하지 않고 질문 카드로 먼저 묻는다.
  단, 성적과 학과를 이미 말한 "갈 수 있는 대학" 질문은 예외다 — 묻지 않고 바로 찾는다 ([내 성적으로 갈 수 있는 대학] 참고).
- 질문 카드는 답 맨 끝에만 붙인다. 본문은 "먼저 하나만 물어볼게요." 한 줄만 쓴다. 본문에 도구 이름(get_… 같은 영어)·내부 설명·"고3 생기부 활동을 바탕으로…" 같은 계획을 쓰지 않는다.
  형식 (한 질문 = 한 줄, 보기 2~4개 + 필요하면 '직접 입력' 보기, 각 보기는 '보기 — 짧은 설명'):
  [[질문: 어떤 학과 기준으로 찾을까요? | 간호학과 — 내 희망 학과 | 보건행정학과 — 진단에서 잘 맞은 학과 | 다른 학과 — 아래에 직접 적어 주세요]]
- 한 번에 카드는 1개만 낸다. 앞 답에 따라 다음 보기가 달라지기 때문이다.
- 되묻기는 한 번이면 충분하다. 바로 앞 답에서 이미 카드로 물었고 학생이 답했으면(학생 글에 "→" 가 있거나 "학과: …" 처럼 칸을 채워 보냈으면) 또 묻지 않는다. 그 답과 [학생 정보]로 바로 결과를 준다. 빠진 게 있으면 알맞게 정해서 쓰고 "(과목은 ○○ 기준으로 골랐어요)"처럼 한 줄로 밝힌다.
- 학과·과목·주제·대학·책 제목·지원동기처럼 학생이 직접 적어야 하는 것은 보기 카드 대신 [입력 카드]로 한 번에 받는다 (원래 흔한가 화면처럼):
  [[입력: 카드 제목 | 칸 이름=미리 채울 값 | 칸 이름 | 칸 이름 (선택)]]
  · 칸 이름은 이 중에서만 쓴다: 학년, 학과, 과목, 탐구주제, 대학, 지원동기, 책 제목, 저자, 활동, 면접 질문, 내 답변
  · [학생 정보]로 아는 값은 '=' 뒤에 미리 채운다 (예: 학과=간호학과). 모르면 비워 둔다.
  · 꼭 없어도 되는 칸은 이름 뒤에 (선택)을 붙인다.
  · 학생이 카드를 보내면 "학과: … / 과목: …" 처럼 한 줄씩 온다. 그 값을 그대로 쓰고 다시 묻지 않는다.

[공부법 — 생수면 공부법 카드 DB로]
- 과목 공부법·성적이 안 오르는 고민은 바로 답하지 않는다. 과목 · 성적 · 많이 틀리는 단원 · 틀리는 이유를 모르면 짧게 한 줄 쓰고 이 카드만 붙인다 (아는 값은 '=' 뒤에 채운다):
  [[입력: 내 공부 진단 — 이것만 알려 주세요 | 과목 | 성적 | 많이 틀리는 단원 | 틀리는 이유 | 지금 공부 방법 (선택)]]
  (계획·루틴·집중·슬럼프처럼 과목과 상관없는 고민은 카드 없이 바로 찾는다)
- 학생이 "과목: … / 성적: … / 많이 틀리는 단원: … / 틀리는 이유: …"를 보내면 다시 묻지 않고:
  ① 첫 줄은 **지금 막히는 곳** (굵게, 이 말 그대로. "진단(2줄)" 같은 표시는 쓰지 않는다), 다음 줄부터 2~3문장 — 학생이 적은 단원 · 이유 · 지금 공부 방법을 보고 "어디서 새고 있는지"를 짚는다 (예: 개념은 아는데 시간 안에 못 푼다 → 풀이 속도 문제). 적은 말을 그대로 되풀이하지 말고 원인을 말한다.
  ② 틀리는 이유로 area 를 골라 get_study_tips 를 부른다: 개념을 모름·이해 안 됨 → 개념 / 알았는데 틀림·실수 → 오답노트 / 시간 부족 → 문제풀이 / 문제를 잘못 읽음 → 독해 · 메타인지 / 외워도 까먹음 → 암기. keyword 에 단원 이름, level 은 성적(모의 1~2등급 상위권, 3~5 중위권, 6~ 하위권 · 내신 5등급제면 1 상위·2~3 중위·4~5 하위).
  ③ 카드 2개를 아래 모양 그대로 (이렇게 해 봐요 단계는 한 줄에 "1. … 2. … 3. …" 로 이어 쓴다 — 화면이 줄을 나눠 번호로 보여 준다) 학생의 단원에 맞게 풀어서 알려 준다 ("미적분 그래프 문제라면 …"처럼 학생 단원을 넣어서). 카드에 없는 공부법을 지어내지 않는다.
- 그 밖의 공부법 질문(계획·루틴·집중·슬럼프·오답노트 등)은 get_study_tips 로 찾는다 (학년·성적대는 [학생 정보]에서).
- 도구 결과(tips)에 있는 방법만 알려 준다. 기억으로 공부법을 지어내지 않는다. 한 번에 1~2개만:
  **카드 제목** · 과목 · 분야
  한 줄 요약
  이렇게 해 봐요 1. 2. 3. (steps 그대로 쉽게)
  seniors 가 2 이상이면 "선배 n명이 추천한 방법" 한 줄
- 마지막에 이어 가기 카드: [[질문: 다음은? | 다른 방법 — 같은 고민 다른 공부법 | 다른 과목도 진단 | 이걸로 이번 주 플랜 — 입시 플랜에 넣기]]

[책 추천 — 생수면 추천 도서 DB로]
- 학생이 "추천 도서", "우리 학과 관련 책", "간호학과 책 추천", "다음에 읽을 책"처럼 책을 물으면 get_book_recs 로 찾는다 (학년은 [학생 정보]에서). 학과를 모르면 학과 입력 카드로 먼저 묻는다: [[입력: 어떤 학과 책을 찾을까요? | 학과]]
- 도구 결과(books)에 있는 책만 추천한다. 기억으로 다른 책을 지어내지 않는다. 저자가 비어 있으면 저자를 쓰지 않는다.
- 한 번에 1~2권만. 학생 학년에 맞는 권장 학년 · 난이도로 고르고, 서로 다른 분야면 더 좋다. 각 책은 이렇게:
  **책 제목** (저자) · 분야 · 난이도 · 권장 학년
  왜 이 책 · 추천 이유를 학생 말로 한 줄
  세특 연결 · 읽고 나서 탐구·발표로 이어 갈 방향 한 줄
- 마지막에 이어 가기 카드 하나: [[질문: 다음은 어떻게 할까요? | 더 깊은 책 — 이 책 다음 단계 | 다른 분야 — (도구 areas 중 하나) 책 | 이 책으로 탐구주제 — 세특 탐구로 잇기 | 이 책 흔한가 — 같은 학과에서 얼마나 읽는지]]
- 이어 가기: "더 깊은 책"이면 level 심화로, "다른 분야"면 keyword 를 그 분야로, 둘 다 앞에서 추천한 책 제목을 exclude 에 넣어 다시 찾는다. "이 책으로 탐구주제"면 그 책 내용과 학과를 잇는 탐구주제 3개를 제안한다. "이 책 흔한가"면 check_reading 으로 진단한다.
- 자료가 없는 학과면 "아직 ○○ 추천 도서 자료가 없어요"라고 말하고, near_departments 가 있으면 그 학과 책으로 볼지 묻는다.

[입시 플랜 — 목표 대학 · 학과부터]
- 학생이 "고1인데 뭐 해야 돼?", "고2 겨울방학 뭐 하지", "입시 계획 짜 줘", "지금부터 뭘 준비해야 해?"처럼 앞으로 할 일·계획을 물으면:
  번호 목록이나 할 일을 미리 늘어놓지 않는다 (카드를 받은 뒤 플랜에서 다 알려 준다). "목표 대학 · 학과를 알려 주면 그 목표에 맞춰 들을 과목 · 과목별 공부법 · 활동 · 이번 주 미션까지 짜 드릴게요." 한 줄만 쓰고 입력 카드를 붙인다 (아는 값은 미리 채운다):
  [[입력: 내 입시 플랜 짜기 — 목표부터 알려 주세요 | 대학=건국대 | 학과=간호학과 | 학년=고2 | 활동 (선택)]]
  (모르는 칸은 '=' 없이 비워 둔다. 학생이 카드를 보내면 서버가 바로 플랜을 만든다 — 너는 다시 묻지 않는다)
- 학생이 "이번 주 뭐 해", "하루 공부 루틴 짜 줘", "이번 주 플랜 해 보려고"처럼 하루 · 요일별로 할 일을 물으면, 루틴은 6~8줄로 짧게 (줄마다 **언제(분)** · 무엇 · 어떻게 한 줄). 마지막에 "학습 다이어리에 넣으면 매일 체크할 수 있어요." 한 줄과 [[루틴저장]] 을 붙인다.
- [학생 정보]에 '[내 입시 플랜]'이 있고 학생이 플랜을 보거나 체크하고 싶어 하면, 짧게 안내하고 [[플랜]] 을 붙인다 (내 플랜 화면으로 가는 버튼). 다시 짜고 싶어 하면 위 입력 카드를 다시 낸다.

[탐구주제 질문 순서 — 이 순서를 꼭 지킨다]
⓪ 학생이 이번 질문에 자기 주제·분야를 직접 말했으면(예: "내진설계 관련 탐구를 했는데 심화 주제 추천해 줘", "CT 영상 탐구 이어서 할 거 알려 줘") 아무것도 묻지 않는다.
   그 주제를 기준으로 바로 더 깊게 / 다른 각도로 하는 주제 3개를 제안한다 (학과는 [학생 정보]에서, 과목은 몰라도 된다). '지난번 탐구주제' 카드도, 학과·과목 입력 카드도 내지 않는다.
① 과목·진로 묻기 — 카드 한 장만, 딱 한 번:
   학생 질문이 "화학과 탐구주제 뭐 할까"처럼 과목·진로·방향 없이 넓으면, 어떤 과목(또는 진로)으로 할지 고르는 질문 카드 하나만 낸다.
   보기: 그 학과와 잘 맞는 고교 과목 3개 + '진로로 찾기 — 희망 진로를 적어 주세요' + '다른 과목 — 과목을 적어 주세요'.
   [학생 정보]에 '[생수면에서 한 탐구주제' 목록이 실제로 있으면 맨 앞에 '지난번 주제 이어서 — (가장 최근 주제 짧게)' 보기를 하나 더 넣는다 (목록이 없으면 넣지 않는다 — 처음 쓰는 학생에게 '지난번' 이야기를 하지 않는다).
   예: [[질문: 어떤 과목으로 할까요? | 화학 — 반응·합성·분석 실험 | 생명과학 — 효소·생체 물질 | 물리학 — 에너지·소재 성질 | 진로로 찾기 — 희망 진로를 적어 주세요 | 다른 과목 — 과목을 적어 주세요]]
   학생이 고르거나 적으면 더 묻지 않고 바로 ④ 추천:
   · 과목을 고르면 그 과목으로, 서로 다른 방향(실험 / 사회·환경 / 데이터·분석 등)의 주제 3개.
   · "진로로 찾기: (진로)"면 그 진로와 이어지는 주제 3개 (과목은 알맞게 골라 [과목] 으로 붙인다).
   · 지난번 주제 이어서면 그 주제를 더 깊게/다른 각도로 하는 주제 3개.
   학생 질문에 과목·진로·방향·관심사가 이미 있으면(예: "화학과 촉매 관련 탐구주제", "화학Ⅱ로 탐구주제") 이 카드도 내지 않고 바로 ④.
② 학과: 학과를 알면(학생 질문 또는 [학생 정보]의 희망 학과) 학과는 묻지 않는다. 학과·과목 입력 카드도 내지 않는다 — 과목은 ① 카드로만 묻는다.
   추천하는 주제마다 [과목] 을 붙인다 (학생이 고른 과목, 진로로 찾았으면 알맞은 과목).
   학과를 정말 모를 때만 과목 카드 대신 입력 카드로 묻는다: [[입력: 어떤 학과로 찾을까요? | 학과 | 과목 (선택)]]
④ 추천: 학과가 정해지면 get_topic_cases 로 그 학과 실제 사례를 보고, 학생 학년·과목에 맞게 다듬은 주제 3개만 각 2~3줄(주제 / 무엇을 어떻게 해 보는지 / 학과와 이어지는 점)로 제안한다. 사례를 그대로 베끼지 않는다.
   끝에 /topic 같은 화면 주소 안내는 붙이지 않는다. 대신 다음 단계를 고르는 카드 하나만 붙인다:
   [[질문: 어떤 주제로 더 구체적으로 짜 볼까요? | 1번 — (주제 짧게) | 2번 — (주제 짧게) | 3번 — (주제 짧게) | 다른 방향 — 원하는 방향을 적어 주세요]]
   학생이 하나를 고르면 그 주제의 탐구 계획(무엇을 / 어떻게 / 무엇을 기록할지 / 학과 연결)을 짧게 짜 준다.
   학생이 "다른 방향: (적은 말)"로 보내면 더 묻지 말고 그 방향에 맞춘 새 주제 3개를 같은 모양으로 제안한다 (앞에서 낸 주제와 겹치지 않게).
- 보기 카드에 '다른 ○○'·'직접' 보기를 넣을 때 설명은 "원하는 ○○을 적어 주세요"로 쓴다 (누르면 적는 칸이 열린다).
- 학생이 학과를 말하면(예: 간호학과) 그 학과와 관련된 활동만 꺼내 쓴다. 다른 분야 활동(예: 건축·한옥 탐구)은 말하지도 인용하지도 않는다.
- 학생에게 보이는 글에는 영어 도구 이름(get_topic_cases 등)을 절대 쓰지 않는다. 필요하면 "실제 사례", "입시 자료"처럼 우리말로만 말한다.

[흔한가 진단 — 채팅에서 바로 한다]
학생이 "내 탐구주제 흔한가?", "지원동기 흔한지 봐 줘", "이 책 흔해?"처럼 진단을 원하면 다른 화면으로 보내지 말고 여기서 진단한다.
- 필요한 것이 다 모이면 바로 도구로 진단한다. 빠진 것만 한 번에 하나씩 묻는다. 학년·희망 학과는 [학생 정보]에서 가져오고 다시 묻지 않는다.
- 빠진 것은 입력 카드 하나로 한 번에 받는다 (아는 값은 미리 채운다):
  · 탐구주제(check_topic): [[입력: 진단할 탐구주제를 적어 주세요 | 학과=… | 과목 | 탐구주제]]
    [학생 정보]에 생수면에서 한 탐구주제가 있으면 탐구주제=(가장 최근 주제)로 미리 채운다.
  · 지원동기(check_motive): [[입력: 진단할 지원동기를 적어 주세요 | 대학 (선택) | 학과=… | 지원동기]] (30자 이상)
  · 독서(check_reading): [[입력: 진단할 책을 적어 주세요 | 책 제목 | 저자 (선택) | 학과=… | 과목]]
- 학생이 입력 카드로 "학과: … / 과목: … / 탐구주제: …"를 보내면 더 묻지 말고 바로 진단한다 (지난 주제를 이어 할지 등 다른 카드를 끼워 넣지 않는다).
- 학생이 쓴 주제·글은 고치지 말고 그대로 넣는다.
- 진단 결과 답은 서버가 정해진 모양으로 만든다. 너는 도구만 부르면 된다.
- invalid 면 그 이유를 쉬운 말로 전하고 다시 적어 달라고 한다.
- 진단 결과를 보고 "다른 주제도 진단해 볼까요?" 같은 되묻기는 붙이지 않는다.

[면접 — 생기부 예상질문 · 꼬리질문도 채팅에서 바로 한다]
생기부 예상질문(interview_questions):
- 학생이 "예상질문 뽑아 줘", "○○대 면접에서 내 생기부로 뭐 물어볼까?"처럼 원하면 쓴다.
- 대학·학과가 필요하다. 모르면 입력 카드로 받는다: [[입력: 예상질문을 뽑을 대학을 적어 주세요 | 대학 | 학과=…]]
- [학생 정보]에 생기부 노트 활동이 있으면 활동은 묻지 않고 비워서 부른다(노트에서 최근 4개를 쓴다). 없으면(need_activities) 입력 카드로 받는다: [[입력: 면접에서 걱정되는 활동을 적어 주세요 | 대학=… | 학과=… | 과목 | 활동]]
- 결과는 질문을 번호 목록으로 그대로 보여 준다 (고치거나 답을 써 주지 않는다). 위에 "○○대 면접 기준으로 뽑았어요" 한 줄, has_univ_data 가 false 면 "이 대학 면접 자료가 없어 평균 기준이에요".
- 질문 목록 아래에 note 를 한 줄로 덧붙인다.
- 끝에 이 카드를 붙여서 바로 꼬리질문 연습으로 이어지게 한다: [[질문: 어떤 질문으로 답변 연습을 해 볼까요? | 1번 — (질문 짧게) | 2번 — (질문 짧게) | 3번 — (질문 짧게)]]
꼬리질문 연습(tail_practice):
- 시작에는 대학 · 학과 · 면접 질문 · 내 답변(15자 이상, 실제로 말하듯)이 필요하다. 빠진 것을 입력 카드로 받는다 (아는 값은 미리 채움):
  [[입력: 꼬리질문 연습 — 면접처럼 답해 보세요 | 대학=… | 학과=… | 면접 질문=… | 내 답변]]
- 꼬리질문을 받으면 이 모양으로만 쓴다 (5줄 안쪽):
  **면접관 꼬리질문 (n/6)**
  (tail_question 그대로)
  확인하려는 것: (why)
  답할 때: (tip)
  마지막 줄: "실제로 말하듯 답을 적어 보내면 다음 꼬리질문을 드려요."
- 꼬리질문이 나온 바로 다음 학생 글은 그 꼬리질문에 대한 답변으로 보고 tail_practice next 로 부른다. 학생이 "그만", "다른 질문" 등을 말하면 멈춘다.
- 내 답변을 대신 써 주지 않는다. 학생이 "답 어떻게 해?"라고 물으면 tip 방향만 짧게 말한다.
- done 이면 이 질문은 꼬리를 다 받았으니 새 질문으로 하자고 한다.

[그 밖의 넓은 질문]
- [학생 정보]나 앞 대화로 이미 알 수 있는 건 다시 묻지 않는다. 대학·학과·전형이 정해진 질문은 바로 답한다.
- 범위가 정해지면 추천은 3개까지만, 각 2~3줄로. 더 원하면 "더 보여 줘"라고 하게 한다.
- 학생이 묻지 않은 다른 학과·대학 이야기를 꺼내지 않는다.

[학생 본인 정보]
- [학생 정보] 첫 줄 [가입·마이페이지 정보]는 학생이 가입할 때·마이페이지에 적은 값이다. 학년·학교·희망 학과는 여기서 가져와 쓰고, 다시 묻지 않는다.
- 학생이 "내가 가입할 때 몇 학년으로 했어?"처럼 자기 정보를 물으면 카드 없이 바로 알려 준다 (예: "가입할 때 고3으로 적혀 있어요").
- 학생이 대화에서 실제 학년이 다르다고 하면(예: "나 고1이야") 묻지 말고 이번 대화는 그 학년 기준으로 답하고, 한 줄만 덧붙인다: "마이페이지에서 학년을 고1로 바꿔 두면 다음 상담부터 맞춰 드려요."

[학생 맞춤]
- 아래 [학생 정보]는 이 학생이 생수면에서 직접 한 기록이다. "내 생기부로", "나한테 맞는" 같은 질문이면 이 정보를 근거로 답하고, 활동 내용을 짧게 인용한다.
- 학생 활동과 학과·전형을 연결할 때: 학종(서류형/면접형)은 활동이 학과와 이어지는지, 교과는 성적, 논술·최저는 수능 준비가 필요함을 구분해서 말한다.
- 학생 정보가 비어 있으면 "생기부 노트(/my/note)에 활동을 적으면 맞춤으로 볼 수 있어요"라고 안내한다.
- 생수면 다른 기능은 학생이 그 기능이 필요한 질문을 했을 때만 짧게 권한다 (생기부 예상질문·꼬리질문·흔한가 진단은 채팅에서 직접 해 준다. 화면 주소로 보내지 않는다). 답마다 습관처럼 붙이지 않는다.

[답 쓰는 법]
- 쉬운 말, "~예요/~해요". 학생에게 말하듯 친절하지만 짧게. 전체 15줄 안쪽으로. 체크리스트·코멘트 같은 덧붙임 섹션을 늘어놓지 않는다.
- 핵심 먼저 1~2문장, 그다음 필요한 만큼 목록이나 짧은 표. 굵게는 **두 별표**로만.
- 추천처럼 항목마다 설명이 붙으면 이 모양을 꼭 지킨다 (번호 줄 아래 설명 줄은 앞에 기호 없이):
  1. 제목 한 줄
  무엇을: 한 줄
  학과 연결: 한 줄
  (빈 줄 하나 띄우고 다음 번호)
- 여러 대학을 비교할 때는 표(| 로 구분)가 좋다.
- 마지막에 출처를 한 줄로: "자료: ○○대 2028 시행계획" 처럼.
- 입시와 상관없는 질문이면 정중히 입시 상담 범위를 안내한다.
- 답 끝에 "원하면 ○○도 확인해 줄게요", "볼까요?", "더 알려 드릴까요?" 같은 제안·되묻기를 붙이지 않는다. 할 말을 다 했으면 출처 한 줄로 끝낸다. (넓은 질문을 좁힐 때의 질문 카드만 예외)
- 학생을 "당신"이라고 부르지 않는다. 학년을 말할 때는 "고3이라 2027학년도 기준이에요"처럼 쓴다.

[학생 정보]
${student}`;
}

async function chat(messages: any[], withTools: boolean) {
  const res = await openai({
    model: MODEL,
    max_completion_tokens: 6000,
    reasoning_effort: "low",
    messages,
    ...(withTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
  });
  const body = await res.text();
  if (!res.ok) { console.error("openai", res.status, body.slice(0, 500)); return null; }
  try { return JSON.parse(body); } catch { return null; }
}

/* 이번 주 시작 (한국 시간 월요일 0시) · 다음 초기화 시각 */
function weekWindow() {
  const kst = new Date(Date.now() + 9 * 3600000);
  const day = (kst.getUTCDay() + 6) % 7; // 월=0
  const startKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - day);
  const start = new Date(startKst - 9 * 3600000);
  return { start, reset: new Date(start.getTime() + 7 * 86400000) };
}

/* 이번 주 사용량 — ai_usage 의 agent 비용 합계를 한도와 비교해 % 로 */
async function usageOf(db: any, userId: string, paid: string | null) {
  const { start, reset } = weekWindow();
  const [{ data: rows }, { data: refs }] = await Promise.all([
    db.from("ai_usage").select("cost_usd").eq("service", "agent").eq("user_id", userId).gte("created_at", start.toISOString()).limit(5000),
    db.from("referrals").select("referred_user_id").eq("referrer_id", userId).not("referred_user_id", "is", null).limit(100),
  ]);
  const usedWon = (rows ?? []).reduce((a: number, r: any) => a + Number(r.cost_usd ?? 0), 0) * KRW;
  const friends = new Set((refs ?? []).map((r: any) => r.referred_user_id).filter((id: string) => id && id !== userId)).size;
  const limit = paid ? PAID_WON : FREE_WON + Math.min(friends, FRIEND_MAX) * FRIEND_WON;
  const pct = Math.min(100, Math.round((usedWon / limit) * 100));
  return {
    pct, reset_at: reset.toISOString(), paid_until: paid,
    invite: paid ? null : { friends, max: FRIEND_MAX, plus_pct: Math.round((FRIEND_WON / FREE_WON) * 100) },
  };
}

/* 이용권: _shared/pass.ts 의 passUntil (한 달·6개월·1년) */

/*
 * 기출문제 학습(/prep) 무료 문제 수 — 결제 없이 무료 3문제 + 친구 1명 가입할 때마다 5문제 (sql/sm_86)
 * 친구 초대 대신 결제: 한 달 이용권 12,900원 = 기출 무제한 · 생기부 예상질문 24,000원 = 기출 무제한 + 예상질문 학습
 * 학교: 무료는 처음 AI 피드백을 받은 학교 1곳만 (지웠다 다시 넣어도 그 학교) · 결제하면 6곳까지
 * 생기부 예상질문에서 나온 질문(source interview)은 24,000원 결제(interview_access)한 학생만
 */
const STUDY_FREE = 3; // AI 피드백 3문제까지 무료 — 그다음은 친구 초대
const STUDY_PER_FRIEND = 5;
// 학교 이름 맞추기 — "단국대학교(죽전)" · "단국대" 를 같은 학교로
const ukey = (v: string) => String(v ?? "").replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교$|대학$/, "대");
const STUDY_SCHOOLS_FREE = 1; // 무료는 학교 1곳 (처음 AI 피드백을 받은 학교)
const STUDY_SCHOOLS_PAID = 6; // 결제하면 6곳까지
async function studyQuota(db: any, userId: string) {
  const [{ count: used }, { data: refs }, { data: adm }, { data: acc }, pass, { data: schoolRows }] = await Promise.all([
    db.from("prep_study_uses").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "past"),
    db.from("referrals").select("referred_user_id").eq("referrer_id", userId).not("referred_user_id", "is", null).limit(1000),
    db.from("admins").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("interview_access").select("user_id").eq("user_id", userId).maybeSingle(),
    passUntil(db, userId),
    db.from("prep_study_uses").select("university,created_at").eq("user_id", userId).eq("source", "past").order("created_at", { ascending: true }).limit(2000),
  ]);
  // 기출을 푼 학교 (처음 푼 순) — 맨 처음 학교가 무료 학교
  const schools: string[] = [];
  for (const r of schoolRows ?? []) if (!schools.some((x) => ukey(x) === ukey(r.university))) schools.push(r.university);
  const friends = new Set((refs ?? []).map((r: any) => r.referred_user_id).filter((id: string) => id && id !== userId)).size;
  const admin = Boolean(adm);
  // 기출 무제한: 한 달 이용권(12,900원) 기간 중 · 생기부 예상질문(24,000원) 결제 · 관리자
  const unlimited = admin || Boolean(acc) || Boolean(pass);
  const limit = unlimited ? 9999 : STUDY_FREE + friends * STUDY_PER_FRIEND;
  return {
    used: used ?? 0, limit, left: Math.max(0, limit - (used ?? 0)), friends, free: STUDY_FREE, per_friend: STUDY_PER_FRIEND,
    interview_paid: admin || Boolean(acc), unlimited, pass_until: pass,
    schools, free_university: schools[0] ?? null, school_limit: admin ? 99 : unlimited ? STUDY_SCHOOLS_PAID : STUDY_SCHOOLS_FREE,
  };
}
/* 이 문제를 풀 수 있나 — 이미 연 문제면 그대로 · 새 기출이면 남은 수 확인 · 예상질문이면 결제 확인 */
async function studyGate(db: any, userId: string, university: string, question: string, source: string) {
  const quota = await studyQuota(db, userId);
  if (source === "interview") return quota.interview_paid ? { ok: true, quota } : { ok: false, quota, need: "interview_pay" };
  const { data: had } = await db.from("prep_study_uses").select("id").eq("user_id", userId).eq("university", university).eq("question", question).maybeSingle();
  if (had) return { ok: true, quota, isNew: false };
  // 학교 수 — 무료는 처음 푼 학교 1곳만, 결제하면 6곳까지
  const known = quota.schools.some((x: string) => ukey(x) === ukey(university));
  if (!known && quota.schools.length >= quota.school_limit) return { ok: false, quota, need: quota.unlimited ? "school_max" : "school" };
  if (quota.left > 0) return { ok: true, quota, isNew: true };
  return { ok: false, quota, need: "invite" };
}


/* ───────── 내 입시 플랜 (/plan · sql/sm_88) — 학년별 계획 + 이번 주 할 일 ───────── */
// 그 주 월요일 (한국 시간) YYYY-MM-DD
function weekStartKST(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600000);
  const day = (k.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}
const PLAN_LINKS = ["topic", "motive", "reading", "prep", "interview", "note", "tail", ""];
const PLAN_GUIDE = `[학년별로 꼭 챙길 것 — 학생 학년에 맞는 것만 쓴다]
- 고1: 진로 탐색(관심 학과 2~3개 좁히기), 고교학점제 과목 선택 준비(2학년 선택과목을 희망 학과와 맞추기), 기초 탐구 1개를 세특으로 남기기, 독서 습관(한 달 1권), 내신 기초(시험 4주 전부터 계획).
- 고2: 희망 학과와 이어지는 심화 탐구를 교과 세특으로 남기기, 동아리·진로 활동에서 학과 연결, 전공 관련 독서 3~4권, 내신 관리, 겨울방학에 고3 1학기 탐구 미리 정하기.
- 고3: 1학기 세특 마무리 탐구, 생기부 마감 전 활동 정리, 모의고사로 수능 최저 관리, 9월 수시 원서 6곳 고르기, 10~11월 면접 준비(예상질문 · 기출 · 꼬리질문), 수능 이후 면접·논술.
[한국 고등학교 일정] 1학기 3~7월(중간 4월 말 · 기말 6월 말~7월 초), 여름방학 7월 말~8월, 2학기 9~12월(중간 10월 · 기말 12월), 겨울방학 1~2월.`;
const PLAN_LINK_RULE = `link 는 그 할 일을 생수면에서 바로 할 수 있으면 넣는다: topic(탐구주제 찾기·흔한가) · motive(지원동기 흔한가) · reading(책 고르기·독서 흔한가) · prep(대학 면접 기출 연습) · interview(내 생기부 예상질문) · tail(면접 꼬리질문) · note(생기부 노트에 활동 적기) · ""(생수면 밖에서 하는 일: 시험공부·모의고사 등).`;

async function planAsk(db: any, userId: string, sys: string, prompt: string, maxTokens = 6000) {
  const res = await openai({ model: MODEL, max_completion_tokens: maxTokens, reasoning_effort: "low", response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] });
  const raw = await res.text();
  let out: any = null, inT = 0, outT = 0;
  try {
    const j = JSON.parse(raw);
    inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0);
    out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
  } catch { console.error("plan", res.status, raw.slice(0, 400)); }
  await logUsage(db, userId, inT, outT, Boolean(out)); // 물꼬 주간 사용량에 들어간다
  return out;
}
const planWeek = (arr: unknown) => (Array.isArray(arr) ? arr : []).map((t: any) => ({
  title: clean(t?.title, 60), detail: clean(t?.detail, 200), link: PLAN_LINKS.includes(t?.link) ? t.link : "",
})).filter((t) => t.title).slice(0, 5);
async function saveWeek(db: any, userId: string, planId: number, week: any[]) {
  const ws = weekStartKST();
  await db.from("plan_tasks").delete().eq("user_id", userId).eq("week_start", ws).eq("done", false);
  if (week.length) await db.from("plan_tasks").insert(week.map((t, i) => ({ plan_id: planId, user_id: userId, week_start: ws, sort: i, ...t })));
  const { data } = await db.from("plan_tasks").select("id,title,detail,link,done,sort,week_start").eq("user_id", userId).eq("week_start", ws).order("sort");
  return data ?? [];
}

/* 플랜에 넣을 목표 자료 — 대학 권장과목 · 전형 · 면접 스타일 + 공부법 카드 + 학과 추천 도서 (있는 것만) */
const SCI = /공|컴퓨|소프트|전자|전기|기계|화학|화공|물리|생명|생물|의|약|간호|수학|통계|건축|토목|환경|에너지|반도체|신소재|식품|농|수의|보건|치|한의|데이터|AI|인공지능|천문|지구|해양|항공|자동차|로봇/;
async function planTarget(db: any, userId: string, univRaw: string, dept: string, grade: string) {
  const T: any = { university: univRaw, department: dept };
  const safeRun = async (name: string, args: any) => { try { return await runTool(db, userId, name, args); } catch (e) { console.error("planTarget", name, e); return null; } };
  const full = univRaw ? (await matchUniv(db, univRaw)) : null;
  if (full) T.university = full;
  const sci = SCI.test(dept);
  const exam = grade === "고3" ? "" : "내신";
  const [reco, units, rules, style, books, ...tips] = await Promise.all([
    safeRun("get_recommended_subjects", { university: T.university, department: dept }),
    full ? safeRun("search_units", { university: full, department: dept }) : null,
    full ? safeRun("get_rules", { university: full }) : null,
    univRaw ? safeRun("get_interview_style", { university: T.university }) : null,
    dept ? safeRun("get_book_recs", { department: dept, grade }) : null,
    ...["국어", "수학", "영어", sci ? "과학탐구" : "사회탐구", "전과목"].map((sub) => findStudyTips(db, { subject: sub, grade, exam }, 2).catch(() => [])),
  ]);
  T.has_univ_data = Boolean(full);
  const j = (x: unknown, n: number) => { const t = JSON.stringify(x ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
  const parts = [];
  parts.push(`[목표] ${T.university} ${dept}${full ? "" : " (생수면에 이 대학 입시 자료가 아직 없음 — 대학 이름만 참고, 전형 규칙을 지어내지 말 것)"}`);
  if ((reco as any)?.rows?.length) parts.push(`[권장과목 자료 — 여기 있는 과목 이름만 쓴다]\n${j((reco as any).rows.slice(0, 8), 2500)}`);
  else parts.push("[권장과목 자료] 이 학과 자료 없음 — 일반적인 계열 과목으로 쓰되 kind 는 '일반'");
  if ((units as any)?.rows?.length || (units as any)?.units?.length) parts.push(`[이 학과 모집 단위 · 전형]\n${j((units as any).rows ?? (units as any).units, 2500)}`);
  if ((rules as any)?.rules?.length) parts.push(`[전형 규칙]\n${j((rules as any).rules.slice(0, 6), 3000)}`);
  if (style && !(style as any).error) parts.push(`[면접 스타일]\n${j(style, 1200)}`);
  const tipList = (tips as any[]).flat().filter(Boolean);
  if (tipList.length) parts.push(`[공부법 카드 — study 칸은 여기서만 고른다]\n${j(tipList.map((t: any) => ({ subject: t.subject, title: t.title, steps: t.steps, seniors: t.seniors })), 3500)}`);
  if ((books as any)?.books?.length) parts.push(`[학과 추천 도서 — 책은 여기서만]\n${j((books as any).books.slice(0, 5).map((b: any) => ({ title: b.title, author: b.author, level: b.level })), 800)}`);
  return { T, text: parts.join("\n\n") };
}

/* 플랜 만들기 — 플랜 화면(plan_make)과 채팅(입력 카드 '내 입시 플랜 짜기')이 같이 쓴다 */
async function makePlan(db: any, userId: string, meta: any, input: any) {
  const grade = ["고1", "고2", "고3"].includes(input.grade) ? input.grade : "";
  const department = clean(input.department, 40), did = String(input.did ?? "").trim().slice(0, 1500);
  const university = clean(input.university ?? input.goal, 40);
  if (!grade) return { error: "학년을 골라 주세요" };
  const [student, target] = await Promise.all([studentContext(db, userId, meta), planTarget(db, userId, university, department, grade)]);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const sys = `너는 생수면의 '물꼬 입시 AI'다. 학생의 목표 대학 · 학과에 맞춘 입시 플랜을 짠다. JSON만 출력.
오늘은 ${today} (한국 시간)이다. 오늘부터 앞으로를 계획한다 (지난 달은 쓰지 않는다).
${PLAN_GUIDE}
규칙:
- 모든 칸이 목표 대학 · 학과로 이어져야 한다. "왜 이걸 하는지"가 목표와 연결되게.
- [목표 자료]에 있는 것만 사실로 쓴다. 전형 이름 · 반영 교과 · 수능 최저 · 권장과목 · 책 제목을 지어내지 않는다. 자료가 없으면 일반적인 말로 쓰고 숫자를 만들지 않는다.
- 학생이 적은 '지금까지 한 것'과 [학생 정보]의 생기부 노트를 보고, 이미 한 것은 이어서 키우고 빈 곳을 채운다. 하지 않은 활동을 했다고 쓰지 않는다.
- 말투는 학생에게 직접 말하듯 짧고 구체적으로 ("~하기", "~정하기"). 막연한 말("열심히 하기") 금지.
- summary: 지금 상황과 목표까지 방향 2문장.
- target_note: 이 대학 · 학과가 학생을 뽑을 때 보는 것 2문장 (전형 · 면접 자료 기준, 없으면 학과 특성으로).
- admission: 이 목표에서 챙길 전형 포인트 2~3개 {label(예: 학생부종합 ○○전형 · 수능 최저), point(학생이 지금 할 일 한 문장)}. 자료 없으면 빈 배열.
- subjects: 들어 두면 좋은 선택과목 3~6개 {name, kind(핵심|권장|일반), why(이 학과와 이어지는 이유 한 줄)}. 고3이면 이미 듣는 과목에서 세특 챙길 과목 위주.
- study: 과목별 공부법 3~4개 {subject, tip(공부법 카드 제목 그대로), how(카드 steps 를 이 학생에 맞게 2~3줄)}. [공부법 카드]에 있는 것만.
- activities: 목표 학과로 이어지는 탐구 · 독서 · 활동 방향 3개 (책은 [학과 추천 도서]의 제목만).
- semester: 이번 학기(또는 방학)에 이룰 목표 3개.
- months: 이번 달부터 4달. 각 달 label("11월") · focus(그 달 핵심 한 줄) · todo 3개.
- week: 이번 주에 할 일 3~5개. 하루 30분~1시간이면 되는 크기로. 공부 1~2개 + 생기부 · 진로 1~2개를 섞는다. 각 title(20자 안팎) · detail(어떻게 하는지 한 문장) · link.
- ${PLAN_LINK_RULE}
{"summary":"","target_note":"","admission":[{"label":"","point":""}],"subjects":[{"name":"","kind":"","why":""}],"study":[{"subject":"","tip":"","how":["",""]}],"activities":["","",""],"semester":["","",""],"months":[{"label":"","focus":"","todo":["","",""]}],"week":[{"title":"","detail":"","link":""}]}`;
  const prompt = `[학년] ${grade}\n[목표 대학] ${target.T.university || "아직 모름"}\n[목표 학과] ${department || "아직 모름"}\n[지금까지 한 것] ${did || "(안 적음)"}\n[고민] ${clean(input.concern, 300) || "(안 적음)"}\n\n[목표 자료]\n${target.text}\n\n[학생 정보]\n${student}`;
  const out = await planAsk(db, userId, sys, prompt);
  if (!out) return { error: "플랜을 만들지 못했어요. 잠시 후 다시 해 주세요" };
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const plan = {
    target: { university: target.T.university, department, has_data: target.T.has_univ_data, note: clean(out.target_note, 300) },
    summary: clean(out.summary, 400),
    admission: arr(out.admission).map((a: any) => ({ label: clean(a?.label, 60), point: clean(a?.point, 160) })).filter((a: any) => a.label).slice(0, 3),
    subjects: arr(out.subjects).map((a: any) => ({ name: clean(a?.name, 30), kind: clean(a?.kind, 4), why: clean(a?.why, 120) })).filter((a: any) => a.name).slice(0, 6),
    study: arr(out.study).map((a: any) => ({ subject: clean(a?.subject, 10), tip: clean(a?.tip, 40), how: arr(a?.how).map((x: unknown) => clean(x, 120)).filter(Boolean).slice(0, 3) })).filter((a: any) => a.subject).slice(0, 4),
    activities: arr(out.activities).map((x: unknown) => clean(x, 160)).filter(Boolean).slice(0, 3),
    semester: arr(out.semester).map((x: unknown) => clean(x, 120)).filter(Boolean).slice(0, 3),
    months: arr(out.months).slice(0, 4).map((m: any) => ({ label: clean(m?.label, 10), focus: clean(m?.focus, 120), todo: arr(m?.todo).map((x: unknown) => clean(x, 100)).filter(Boolean).slice(0, 4) })).filter((m: any) => m.label),
  };
  const { data: row, error } = await db.from("study_plans").insert({ user_id: userId, grade, department, did, goal: university, concern: clean(input.concern, 300), plan }).select("*").single();
  if (error) { console.error("plan save", error); return { error: "플랜을 저장하지 못했어요. 잠시 후 다시 해 주세요" }; }
  const tasks = await saveWeek(db, userId, row.id, planWeek(out.week));
  return { row, tasks };
}

/* 채팅 입력 카드로 플랜 만들기 — "학년: 고2\n학과: 간호학과\n활동: …\n대학: …" 이면 바로 만들고 정해진 모양으로 답한다 */
async function planFromCard(db: any, user: any, message: string, usage: any, paid: any) {
  const get = (k: string) => { const m = message.match(new RegExp(`^${k}\\s*[:：]\\s*(.*)$`, "m")); const v = (m?.[1] ?? "").trim(); return /^없음$/.test(v) ? "" : v; };
  if (!/^학년\s*[:：]/m.test(message) || !/^활동\s*[:：]/m.test(message)) return null;
  const again = await planCard(db, user.id, user.user_metadata ?? {});
  const grade = (get("학년").match(/고\s*[123]/)?.[0] ?? "").replace(/\s/g, "");
  if (!grade) return `학년을 고1 · 고2 · 고3 중에서 적어 주세요.\n${again}`;
  if (!get("대학") || !get("학과")) return `플랜은 **목표 대학 · 학과**에 맞춰 짜요. 아직 정하지 못했으면 가고 싶은 곳을 하나만 적어도 돼요 (나중에 다시 짤 수 있어요).\n${again}`;
  if (usage.pct >= 100 && !paid) return "**이번 주 사용량을 다 썼어요.** 월요일 0시에 다시 채워져요.\n\n[[친구초대]]\n[[이용권]]";
  const r: any = await makePlan(db, user.id, user.user_metadata ?? {}, { grade, department: get("학과"), did: get("활동"), goal: get("대학"), university: get("대학") });
  if (r.error) return r.error;
  const P = r.row.plan ?? {};
  const L = [`**${P.target?.university ?? r.row.goal} ${r.row.department} · ${grade} 입시 플랜을 짰어요**`, "", P.summary ?? ""];
  if (P.target?.note) L.push("", `**이 학과는 이런 걸 봐요** — ${P.target.note}`);
  if (P.subjects?.length) { L.push("", "**들어 두면 좋은 과목**"); P.subjects.forEach((x: any) => L.push(`- ${x.name}${x.kind ? ` (${x.kind})` : ""} — ${x.why}`)); }
  if (P.study?.length) { L.push("", "**과목별 공부법**"); P.study.forEach((x: any) => L.push(`- **${x.subject}** · ${x.tip}${x.how?.[0] ? ` — ${x.how[0]}` : ""}`)); }
  if (r.tasks?.length) { L.push("", "**이번 주 미션**"); r.tasks.forEach((t: any) => L.push(`- ${t.title}`)); }
  if (P.semester?.length) { L.push("", "**이번 학기 목표**"); P.semester.forEach((g: string, i: number) => L.push(`${i + 1}. ${g}`)); }
  L.push("", "아래 버튼을 눌러 내 플랜에 들어가면 미션을 체크할 수 있어요. 플랜은 저장되고, 매주 월요일마다 지난주에 한 걸 보고 새 미션을 드려요.", "", "[[플랜]]");
  return L.join("\n");
}

/* 질문에 맞춘 첫 단계 문구 — 질문 속 대학·학과·궁금한 것을 짚어 준다 */
async function openingSteps(db: any, message: string) {
  const t = message.replace(/\s+/g, " ");
  const words = t.split(/[\s,.?!·/]+/).filter(Boolean);
  let univ = "";
  for (const w of words) {
    const cand = w.replace(/(이랑|랑|에서|에|은|는|이|가|을|를|의|도|로)$/, "");
    if (/대$|대학교$|여대$/.test(cand) || ALIAS[cand]) { const m = await matchUniv(db, cand); if (m) { univ = m.replace("여자대학교", "여대").replace("대학교", "대"); break; } }
  }
  const dept = (t.replace(/권장과목|선택과목|과목/g, " ").match(/([가-힣]{2,10}(학과|학부|교육과|의예과|약학과|간호학과))/) || [])[1] ?? "";
  const who = [univ, dept].filter(Boolean).join(" ");
  const topic =
    /꼬리/.test(t) ? "면접 꼬리질문 연습" :
    /예상\s*질문|예상질문/.test(t) ? "생기부 예상질문" :
    /흔한가|흔해|흔한지|진단/.test(t) ? (/지원동기/.test(t) ? "지원동기 흔한가 진단" : /독서|책/.test(t) ? "독서 흔한가 진단" : "탐구주제 흔한가 진단") :
    /탐구|주제|세특|수행평가/.test(t) ? "탐구주제 고민" :
    /면접/.test(t) ? "면접 준비" :
    /권장|선택과목|과목/.test(t) ? "들어야 할 과목" :
    /등급|성적|갈 수|가능|입결|커트|컷/.test(t) ? "내 성적으로 갈 수 있는지" :
    /최저/.test(t) ? "수능최저" :
    /정시|수능/.test(t) ? "정시·수능" :
    /바뀌|변화|달라|2028/.test(t) ? "바뀐 입시" :
    /논술/.test(t) ? "논술" :
    /전형|뽑|모집/.test(t) ? "전형·모집 방법" : "";
  const first = who && topic ? `${who} ${topic} 질문을 읽는 중` : who ? `${who} 질문을 읽는 중` : topic ? `${topic} 질문을 읽는 중` : "질문 읽는 중";
  const personal = /(^|\s)(나|내|저|제)(가|는|의|\s)|내 |생기부|나한테|저한테|등급/.test(t);
  return [first, personal ? "내 생기부·성적 기록 꺼내 보는 중" : who ? `${who} 입시 자료 펼치는 중` : "입시 자료 펼치는 중"];
}

/* 바로 입력 칸 — "탐구주제 흔한가 진단해 줘"처럼 내용 없이 기능만 고른 말이면
   AI를 부르지 않고 곧장 적는 칸을 보여 준다 (빠르고, 사용량도 안 든다) */
const MOTIVE_Q = "어떤 지원동기를 진단할까요?";
const safe = (v: unknown, n: number) => clean(v, n).replace(/[|\]\[]/g, " ").replace(/=/g, "＝");
async function deptOf(db: any, userId: string, meta: any) {
  const { data: my } = await db.from("sm_my").select("department").eq("user_id", userId).maybeSingle();
  return safe(my?.department || meta?.major || "", 30);
}
const motiveForm = (u: string, d: string, m: string) =>
  `[[입력: 지원동기 흔한가 진단 | ${u ? `대학=${u}` : "대학"} (선택) | ${d ? `학과=${d}` : "학과"} | ${m ? `지원동기=${m}` : "지원동기"}]]`;

/* 플랜 적는 칸 — 아는 학년 · 학과는 미리 채운다 */
async function planCard(db: any, userId: string, meta: any) {
  const [{ data: my }, { data: prof }, { data: tg }] = await Promise.all([
    db.from("sm_my").select("grade,department").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("grade").eq("id", userId).maybeSingle(),
    db.from("prep_targets").select("university,department").eq("user_id", userId).order("created_at").limit(1).maybeSingle(),
  ]);
  const g = String(my?.grade || meta?.grade || prof?.grade || "").match(/고\s*[123]/)?.[0]?.replace(/\s/g, "") ?? "";
  const u = safe(tg?.university || "", 30);
  const d = safe(tg?.department || my?.department || meta?.major || "", 30);
  // 목표 대학 · 학과가 먼저 — 플랜은 그 목표에 맞춰 권장과목 · 공부법 · 활동을 짠다
  return `[[입력: 내 입시 플랜 짜기 — 목표부터 알려 주세요 | ${u ? `대학=${u}` : "대학"} | ${d ? `학과=${d}` : "학과"} | ${g ? `학년=${g}` : "학년"} | 활동 (선택)]]`;
}
const hasPlan = async (db: any, userId: string) => Boolean((await db.from("study_plans").select("id").eq("user_id", userId).limit(1).maybeSingle()).data);

async function quickForm(db: any, userId: string, meta: any, message: string) {
  // "내 입시 플랜 짜 줘" · "플랜 다시 짜 줘" — 묻지 않고 바로 적는 칸 (플랜 화면 버튼도 이 말로 온다)
  if (/^(내\s*)?(입시\s*)?플랜\s*(다시\s*)?(짜|만들)/.test(message.trim())) {
    return `목표 대학 · 학과를 알려 주면, 그 목표에 맞춰 들을 과목 · 과목별 공부법 · 활동 · 이번 주 미션까지 짜 드릴게요.\n${await planCard(db, userId, meta)}`;
  }
  // 지난 지원동기 / 새로 작성 카드에서 고른 답 → 바로 적는 칸 (지난 것을 고르면 그 내용을 채워 둔다)
  const pickM = message.trim().match(/^어떤 지원동기를 진단할까요\?\s*→\s*(.+)$/);
  if (pickM) {
    const choice = pickM[1].trim();
    const dept = await deptOf(db, userId, meta);
    if (/새로/.test(choice)) return `대학·학과·지원동기를 적고 보내면 바로 진단해요.\n${motiveForm("", dept, "")}`;
    const { data: prev } = await db.from("motive_queries").select("university,department,motive").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
    const hit = (prev ?? []).find((r: any) => `${r.university || "대학 미정"} ${r.department}`.trim() === choice);
    if (hit) return `지난번 지원동기를 채워 뒀어요. 고칠 곳이 있으면 고친 뒤 보내 주세요.\n${motiveForm(safe(hit.university, 30), safe(hit.department, 30), safe(hit.motive, 700))}`;
    // 카드 아래 칸에 직접 적은 글이면 지원동기 칸에 넣어 둔다
    return `대학·학과·지원동기를 적고 보내면 바로 진단해요.\n${motiveForm("", dept, choice.length >= 30 ? safe(choice, 700) : "")}`;
  }
  if (/\n|[:：]/.test(message.trim())) return null; // 입력 칸을 채워 보낸 글(학과: … )은 AI가 진단한다
  // 공부법 질문 — 바로 답하지 않고 과목 · 성적 · 많이 틀리는 단원 · 틀리는 이유부터 받는다 (그래야 맞춤으로 고른다)
  const sm = message.replace(/\s+/g, " ").trim();
  // 수행평가 도우미는 준비 중 — AI 없이 바로 안내 ('수행평가 주제 · 탐구 · 발표'는 탐구주제처럼 물꼬가 돕는다)
  if (/수행\s*평가/.test(sm) && !/주제|탐구|발표/.test(sm)) return SOON_TEXT;
  if (sm.length <= 90 && STUDY_Q.test(sm)) return studyCard(sm);
  const t = message.replace(/\s+/g, " ").trim();
  if (t.length > 40) return null; // 학생이 내용까지 적었으면 AI가 읽는다
  const check = /흔한가|흔한지|흔해|흔함/.test(t);
  let kind = "";
  if (check && /지원\s*동기/.test(t)) kind = "motive";
  else if (check && /독서|책/.test(t)) kind = "reading";
  else if (check) kind = "topic";
  else if (/꼬리\s*질문/.test(t)) kind = "tail";
  if (!kind) return null;
  const dept = await deptOf(db, userId, meta);
  const d = dept ? `학과=${dept}` : "학과";
  if (kind === "topic") return `학과·과목·탐구주제를 적고 보내면 바로 진단해요.\n[[입력: 탐구주제 흔한가 진단 | ${d} | 과목 | 탐구주제]]`;
  // 지원동기도 탐구주제처럼 — 묻지 않고 바로 대학·학과·지원동기 적는 칸 (학과는 프로필에서 채운다)
  if (kind === "motive") return `대학·학과·지원동기를 적고 보내면 바로 진단해요.\n${motiveForm("", dept, "")}`;
  if (kind === "reading") return `책과 학과·과목을 적고 보내면 바로 진단해요.\n[[입력: 독서 흔한가 진단 | 책 제목 | 저자 (선택) | ${d} | 과목]]`;
  return `면접 질문과 내 답변을 적고 보내면 그 대학 면접관처럼 꼬리질문을 드려요.\n[[입력: 면접 꼬리질문 연습 | 대학 | ${d} | 면접 질문 | 내 답변]]`;
}

const SOON_TEXT = "**수행평가 도우미는 지금 준비 중이에요.**\n과목별 양식에 맞춰 도와줄 수 있게 만들고 있어요. 열리면 첫 화면 타일에서 바로 쓸 수 있어요.\n\n수행평가 **주제**를 찾는 중이라면 지금도 도와줄 수 있어요. '수행평가 탐구주제 추천해 줘'처럼 물어봐 주세요.";

/* 공부법 진단 카드 — 질문에서 과목 · 성적을 찾으면 미리 채운다 */
const SUBJECTS = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사", "전과목"];
const ROUTINE_Q = /루틴|하루\s*(공부|계획|일과)|이번\s*주|일주일|요일별|매일\s*(뭐|어떻게)|(주간|하루)\s*(플랜|계획)|플랜.{0,10}(해\s*보|어떻게)/;
const STUDY_Q = /공부\s*법|학습\s*법|공부\s*방법|공부(를|는)?\s*어떻게|어떻게\s*공부|성적이?\s*(안|잘\s*안)\s*(올|오르|나와)|점수가?\s*안\s*(올|오르|나와)|등급\s*(올리|올릴|안\s*올)|오답\s*노트|공부\s*(잘\s*)?하고\s*있는/;
const SUBJ: [RegExp, string][] = [[/수학|미적|확통|확률과\s*통계|기하|대수/, "수학"], [/국어|문학|비문학|독서|화작|언매|문법/, "국어"], [/영어|영단어|독해/, "영어"], [/과탐|물리|화학|생명|생과|지구/, "과학탐구"], [/사탐|사회|윤리|생윤|사문|한지|세지|경제|정법/, "사회탐구"], [/한국사/, "한국사"]];
function studyCard(t: string) {
  const sub = SUBJ.find(([re]) => re.test(t))?.[1] ?? "";
  const g = t.match(/[1-9]\s*등급|\d{2,3}\s*점/)?.[0]?.replace(/\s/g, "") ?? "";
  return `공부법은 사람마다 맞는 게 달라요. 지금 상황을 알려 주면 **어디서 막히는지 먼저 짚고**, 선배들이 효과 본 방법 중에 딱 맞는 걸 골라 드릴게요.
[[입력: 내 공부 진단 — 이것만 알려 주세요 | ${sub ? `과목=${sub}` : "과목"} | ${g ? `성적=${g}` : "성적"} | 많이 틀리는 단원 | 틀리는 이유 | 지금 공부 방법 (선택)]]`;
}

/* ───────── 공부법 효과 시험 (sql/sm_94 study_tests) ─────────
 * 시작 시험(A) → 공부법대로 일주일 → 비슷한 문제로 다시 시험(B) → 두 점수를 비교해 다음 주를 정한다
 *   A · B 는 처음에 같은 '유형 10개 설계도'로 한 번에 만든다 (같은 유형 · 같은 난이도 · 다른 문제) → 점수 비교가 공정하다
 *   수학 · 과학탐구는 한 번 더 풀어 검산하고, 정답이 안 맞는 문항은 A · B 둘 다에서 뺀다
 *   정답 · 해설은 서버에만 — 학생 화면에는 빼고 보낸다 (그 시험을 낸 뒤에만 A 해설을 보여 준다)
 *   AI 비용은 물꼬 주간 사용량에 들어간다
 */
const TEST_SUBJECTS = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사"];
const TEST_DAYS = 7;
const pubQ = (set: any[]) => (set ?? []).map((q: any) => ({ no: q.no, type: q.type, q: q.q, choices: q.choices }));
const pickOf = (ans: unknown[], i: number) => (ans?.[i] === null || ans?.[i] === undefined || !Number.isInteger(Number(ans[i])) ? null : Number(ans[i]));
const scoreOf = (set: any[], ans: unknown[]) => (set ?? []).reduce((n: number, q: any, i: number) => n + (pickOf(ans, i) === q.answer ? 1 : 0), 0);
const reviewOf = (set: any[], ans: unknown[]) => (set ?? []).map((q: any, i: number) => ({
  no: q.no, type: q.type, q: q.q, choices: q.choices, answer: q.answer, picked: pickOf(ans, i),
  correct: pickOf(ans, i) === q.answer, why: q.why,
}));
function cleanSet(arr: unknown) {
  return (Array.isArray(arr) ? arr : []).map((q: any) => ({
    no: Number(q?.no) || 0, type: clean(q?.type, 30), q: String(q?.q ?? "").replace(/\r/g, "").trim().slice(0, 900),
    choices: (Array.isArray(q?.choices) ? q.choices : []).map((c: unknown) => clean(c, 160)).filter(Boolean).slice(0, 4),
    answer: Number(q?.answer), why: clean(q?.why, 300),
  })).filter((q) => q.no && q.q && q.choices.length === 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3);
}
async function testTips(db: any, subject: string, unit: string, grade: string, exclude: string[] = []) {
  const tips = await findStudyTips(db, { subject, keyword: unit.split(/\s+/)[0] ?? "", grade, exclude }, 2).catch(() => []);
  return tips.length ? tips : await findStudyTips(db, { subject, grade, exclude }, 2).catch(() => []);
}
async function tipsByIds(db: any, ids: unknown) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!list.length) return [];
  const { data } = await db.from("study_tips").select("id,title,subject,area,summary,steps").in("id", list);
  return data ?? [];
}
function testView(row: any, withQuestions = true) {
  const ready = row.status === "studying" && row.post_open_at && Date.now() >= new Date(row.post_open_at).getTime();
  return {
    id: row.id, subject: row.subject, unit: row.unit, grade: row.grade, round: row.round, status: row.status,
    total: (row.set_a ?? []).length, pre_score: row.pre_score, post_score: row.post_score,
    pre_at: row.pre_at, post_open_at: row.post_open_at, post_ready: Boolean(ready), result: row.result,
    questions: !withQuestions ? [] : row.status === "pre" ? pubQ(row.set_a) : ready ? pubQ(row.set_b) : [],
  };
}

/* 시험지 만들기 — 설계도 + A · B 세트 (수학 · 과학탐구는 검산) */
async function makeTest(db: any, userId: string, subject: string, unit: string, grade: string) {
  const sys = `너는 한국 고등학교 ${subject} 선생님이다. '${unit}' 단원 확인 시험을 만든다 (학생: ${grade || "고등학생"}). JSON만 출력.
- blueprint: 이 단원에서 꼭 확인할 문제 유형 10개 {no(1~10), type(유형 이름 20자 안), level(기본|중간|응용)} — 기본 4 · 중간 4 · 응용 2.
- set_a 와 set_b: 같은 blueprint 로 각각 10문제. 같은 no 끼리 유형 · 난이도는 같고, 숫자 · 소재 · 보기는 완전히 다르게 (A를 외워서 B를 풀 수 없게).
- 문제 하나: {no, type, q(문제 글), choices(보기 4개), answer(정답 보기 번호 0~3), why(해설 1~2문장)}
- 객관식 4지선다만. 정답은 딱 하나. 정답 위치(0~3)를 골고루 섞는다.
- 고등학교 교육과정 범위만. 교과서 · 수능 · 모의고사의 지문이나 문제를 그대로 옮기지 않는다. 국어 · 영어 지문이 필요하면 3~5문장으로 새로 쓴다.
- 수식은 글자로 쓴다 (x^2, √2, π, 1/2 처럼). 그림이 있어야 풀리는 문제는 내지 않는다.
{"blueprint":[{"no":1,"type":"","level":""}],"set_a":[{"no":1,"type":"","q":"","choices":["","","",""],"answer":0,"why":""}],"set_b":[{"no":1,"type":"","q":"","choices":["","","",""],"answer":0,"why":""}]}`;
  const out = await planAsk(db, userId, sys, `과목: ${subject}\n단원: ${unit}\n학년: ${grade || "모름"}`, 16000);
  if (!out) return { error: "문제를 만들지 못했어요. 잠시 후 다시 해 주세요" };
  let a = cleanSet(out.set_a), b = cleanSet(out.set_b);
  const bp = (Array.isArray(out.blueprint) ? out.blueprint : []).map((x: any) => ({ no: Number(x?.no) || 0, type: clean(x?.type, 30), level: clean(x?.level, 4) }));
  // 같은 번호가 A · B 둘 다 있는 문항만
  let nos = a.map((q) => q.no).filter((n) => b.some((q) => q.no === n));
  // 수학 · 과학탐구 — 한 번 더 풀어서 정답이 안 맞는 번호는 뺀다
  if (["수학", "과학탐구"].includes(subject) && nos.length) {
    const only = (set: any[]) => set.filter((q) => nos.includes(q.no)).map((q) => ({ no: q.no, q: q.q, choices: q.choices }));
    const chk = await planAsk(db, userId,
      `아래 객관식 문제를 하나씩 직접 풀어 정답 보기 번호(0~3)를 낸다. 계산을 끝까지 확인한다. 보기 중 정답이 없거나 둘 이상이면 -1. JSON만: {"a":[{"no":1,"answer":0}],"b":[{"no":1,"answer":0}]}`,
      JSON.stringify({ a: only(a), b: only(b) }), 12000);
    if (chk) {
      const ok = (set: any[], key: string) => (no: number) => {
        const mine = (Array.isArray(chk[key]) ? chk[key] : []).find((x: any) => Number(x?.no) === no);
        return mine && Number(mine.answer) === set.find((q) => q.no === no)?.answer;
      };
      const okA = ok(a, "a"), okB = ok(b, "b");
      nos = nos.filter((n) => okA(n) && okB(n));
    }
  }
  if (nos.length < 6) return { error: "문제를 제대로 만들지 못했어요. 다시 한 번 눌러 주세요" };
  // 남은 문항을 1번부터 다시 번호 매긴다
  const renum = (set: any[]) => nos.map((n, i) => ({ ...set.find((q) => q.no === n), no: i + 1 }));
  a = renum(a); b = renum(b);
  const blueprint = nos.map((n, i) => ({ ...(bp.find((x: any) => x.no === n) ?? { type: a[i].type, level: "" }), no: i + 1 }));
  return { blueprint, set_a: a, set_b: b };
}

/* 루틴을 얼마나 지켰나 — 시작 시험 날부터 7일 동안, 그 과목 루틴 체크 비율 (루틴이 없으면 null) */
async function adherence(db: any, userId: string, subject: string, fromIso: string) {
  const { data: rs } = await db.from("plan_routines").select("id,days,created_at,active").eq("user_id", userId).eq("subject", subject);
  if (!rs?.length) return null;
  const day0 = new Date(new Date(fromIso).getTime() + 9 * 3600000);
  const days: string[] = [];
  for (let k = 0; k < TEST_DAYS; k++) days.push(new Date(day0.getTime() + k * 86400000).toISOString().slice(0, 10));
  let planned = 0;
  for (const d of days) {
    const wd = ((new Date(`${d}T12:00:00+09:00`).getUTCDay() + 6) % 7) + 1;
    for (const r of rs) if ((r.days ?? []).includes(wd) && String(r.created_at).slice(0, 10) <= d) planned++;
  }
  if (!planned) return null;
  const { count } = await db.from("plan_logs").select("routine_id", { count: "exact", head: true })
    .eq("user_id", userId).eq("done", true).in("routine_id", rs.map((r: any) => r.id)).gte("day", days[0]).lte("day", days[days.length - 1]);
  return Math.min(1, (count ?? 0) / planned);
}

/* 두 점수로 다음 주 정하기 */
function judge(pre: number, post: number, total: number, round: number, kept: number | null) {
  const diff = post - pre;
  if (kept !== null && kept < 0.5) return { result: "한주더", message: `이번 주 루틴을 ${Math.round(kept * 100)}%만 지켰어요. 방법을 바꾸기 전에 양을 줄여서 한 주 더 해 봐요. (예: 50분 → 30분)` };
  if (post >= Math.ceil(total * 0.8) && diff >= 0) return { result: "늘리기", message: `${total}문제 중 ${post}개를 맞혔어요. 이 단원은 거의 잡혔어요. 같은 방법을 다음 단원에 써 보거나 양을 조금 늘려요.` };
  if (diff >= 2) return { result: "유지", message: `지난번보다 ${diff}개 더 맞혔어요. 지금 공부법이 맞아요. 같은 방법으로 이어 가요.` };
  if (round >= 2) return { result: "교체", message: `2주 동안 해 봤는데 점수가 크게 오르지 않았어요. 이 공부법은 잘 안 맞는 것 같아요. 다른 공부법으로 바꿔 볼게요.` };
  return { result: "한주더", message: `아직 차이가 크지 않아요(${diff >= 0 ? "+" : ""}${diff}개). 공부법이 몸에 붙는 데 2주쯤 걸려요. 같은 방법으로 한 주 더 해요.` };
}

/* ───────── 해 줄까요? (sql/sm_96 agent_actions) ─────────
 * 물꼬가 제안 → 카드 [[할일:번호]] → 학생이 [네]를 누르면 action: "agent_action" 으로 실행
 */
async function proposeAction(db: any, userId: string, a: any) {
  const kind = String(a?.kind ?? "");
  let title = "", payload: any = {};
  if (kind === "prep_school") {
    const raw = clean(a?.university, 40);
    if (raw.length < 2) return { error: "대학 이름이 필요해요" };
    const university = (await matchUniv(db, raw).catch(() => null)) ?? raw;
    const department = clean(a?.department, 40);
    const { data: has } = await db.from("prep_targets").select("id").eq("user_id", userId).eq("university", university).eq("department", department).maybeSingle();
    if (has) return { already: true, note: `${university} ${department} 는 이미 수시 면접 준비에 들어가 있어요 (/prep)` };
    title = `수시 면접 준비에 ${university}${department ? ` ${department}` : ""} 넣기`;
    payload = { university, department };
  } else if (kind === "study_test") {
    const subject = TEST_SUBJECTS.includes(a?.subject) ? a.subject : "";
    const unit = clean(a?.unit, 40);
    if (!subject || unit.length < 2) return { error: "과목과 단원이 필요해요" };
    const { data: open } = await db.from("study_tests").select("id,unit,status").eq("user_id", userId).eq("subject", subject).neq("status", "done").maybeSingle();
    if (open) return { already: true, note: `${subject} 효과 시험이 이미 진행 중이에요 (${open.unit} · /plan 학습 플랜 ${subject} 탭)` };
    title = `${subject} '${unit}' 공부법 효과 시험 만들기 (지금 10문제 → 일주일 뒤 다시)`;
    payload = { subject, unit };
  } else return { error: "모르는 일이에요" };
  // 같은 제안이 아직 대기 중이면 그걸 다시 쓴다
  const { data: same } = await db.from("agent_actions").select("id").eq("user_id", userId).eq("kind", kind).eq("status", "pending").eq("title", title).maybeSingle();
  const row = same ?? (await db.from("agent_actions").insert({ user_id: userId, kind, title, payload }).select("id").single()).data;
  if (!row?.id) return { error: "제안을 저장하지 못했어요" };
  return { proposed: true, id: row.id, title, card: `[[할일:${row.id}]]` };
}

/* 공부법 효과 시험 만들기 — test_make · 해 줄까요? 둘 다 쓴다 */
async function createTest(db: any, user: any, subject: string, unit: string, round = 1) {
  const [{ data: my }, { data: prof }] = await Promise.all([
    db.from("sm_my").select("grade").eq("user_id", user.id).maybeSingle(),
    db.from("profiles").select("grade").eq("id", user.id).maybeSingle(),
  ]);
  const grade = String(my?.grade || user.user_metadata?.grade || prof?.grade || "").match(/고\s*[123]/)?.[0]?.replace(/\s/g, "") ?? "";
  const t: any = await makeTest(db, user.id, subject, unit, grade);
  if (t.error) return { error: t.error };
  const { data: row, error } = await db.from("study_tests").insert({ user_id: user.id, subject, unit, grade, round, blueprint: t.blueprint, set_a: t.set_a, set_b: t.set_b }).select("*").single();
  if (error) { console.error("test save", error); return { error: "시험지를 저장하지 못했어요. 잠시 후 다시 해 주세요" }; }
  return { row };
}

/* ───────── 선배 사례 (sql/sm_97 senior_cases · 테스트) ─────────
 * '선배 생기부 보기'에 올린 PDF(정제본)에서 글을 뽑아 두고, 물꼬가 답할 때 근거로 쓴다
 * 학생에게는 공개(live)된 생기부 · 판에서 뽑은 것만 보여 준다
 */
const TRACK_LABEL: Record<string, string> = { hss: "인문·사회", nat: "자연", eng: "공학", med: "의약·보건" };
const AREA_LABEL: Record<string, string> = { cc: "창체", sp: "세특", hb: "행특", gr: "성적" };
async function liveBoards(db: any) {
  const { data: recs } = await db.from("sb_records").select("id").eq("status", "live");
  const ids = (recs ?? []).map((r: any) => r.id);
  if (!ids.length) return new Set<number>();
  const { data: bs } = await db.from("sb_boards").select("id").in("record_id", ids).eq("status", "live");
  return new Set<number>((bs ?? []).map((b: any) => Number(b.id)));
}
async function findSeniors(db: any, a: any) {
  const track = TRACK_LABEL[a?.track] ? a.track : "";
  if (!track) return { error: "계열이 필요해요" };
  const [live, { data: profs }] = await Promise.all([
    liveBoards(db),
    db.from("senior_profiles").select("key,university,department,interest,school_type,metrics,summary,books").eq("track", track).eq("live", true).limit(500),
  ]);
  const profOf = new Map((profs ?? []).map((p: any) => [p.key, p]));
  const dept = clean(a?.department, 20).replace(/학과|학부|과$/g, "");
  const u = clean(a?.university, 10).replace(/대학교|대학/g, "대").replace(/대$/, "");
  const run = async (kw: string) => {
    let q = db.from("senior_cases").select("board_id,profile_key,university,track,grade,area,label,body,sort").eq("track", track);
    if ([1, 2, 3].includes(Number(a?.grade))) q = q.in("grade", [Number(a.grade), 0]);
    if (AREA_LABEL[a?.area]) q = q.in("area", [a.area, "gr"]);
    if (u) q = q.ilike("university", `%${u}%`);
    if (kw) q = q.or(`body.ilike.%${kw}%,label.ilike.%${kw}%`);
    const { data } = await q.order("sort").limit(400);
    // 퍼즐 판에서 온 줄은 공개된 판만 · 선배 카드에서 온 줄은 공개된 카드만
    return (data ?? []).filter((r: any) => (r.profile_key ? profOf.has(r.profile_key) : live.has(Number(r.board_id))));
  };
  const kw = clean(a?.keyword, 20).replace(/[%,()]/g, "");
  let rows = await run(kw);
  let widened = false;
  if (!rows.length && kw) { rows = await run(""); widened = true; }
  if (!rows.length) return { found: 0, note: `아직 ${TRACK_LABEL[track]} 계열 선배 사례가 없어요. 사례가 없다고 밝히고 일반 정보로 답한다.` };
  // 같은 학과 선배를 앞으로
  // 학과 이름 또는 관심 분야(예: 자유전공 선배의 '심리학')가 맞으면 앞으로
  const deptHit = (r: any) => {
    const p: any = profOf.get(r.profile_key);
    return dept && p && (String(p.department ?? "").includes(dept) || String(p.interest ?? "").includes(dept)) ? 0 : 1;
  };
  rows.sort((x: any, y: any) => deptHit(x) - deptHit(y));
  // 선배(또는 판)마다 고르게 — 한 사람에서 최대 4줄, 모두 14줄
  const per: Record<string, number> = {};
  const pick: any[] = [];
  for (const r of rows) {
    if (r.area === "gr") continue; // 성적 지표는 아래 seniors 에 따로
    const k = r.profile_key ?? `b${r.board_id}`;
    if ((per[k] ?? 0) >= 4) continue;
    per[k] = (per[k] ?? 0) + 1;
    const pf: any = profOf.get(r.profile_key);
    pick.push({ who: pf ? `${pf.university} ${pf.department}${pf.interest ? `(관심: ${pf.interest})` : ""} 선배` : `${r.university} ${TRACK_LABEL[r.track]} 선배`, grade: `${r.grade}학년`, area: AREA_LABEL[r.area] ?? r.area, label: r.label, text: clean(r.body, 220) });
    if (pick.length >= 14) break;
  }
  // 이번에 나온 선배 카드 — 합격 학과 · 학교 유형 · 성적 지표 · 한 줄 특징
  const keys = [...new Set(rows.map((r: any) => r.profile_key).filter(Boolean))].slice(0, 5);
  const seniors = keys.map((k: any) => {
    const p: any = profOf.get(k); const m = p.metrics ?? {};
    return {
      who: `${p.university} ${p.department} 합격 선배`, interest: p.interest || undefined, school_type: p.school_type,
      grades: [m.gpa_all ? `5등급 환산 전 과목 ${m.gpa_all}(${m.gpa_all_band})` : "", m.gpa_main ? `국영수사과 ${m.gpa_main}` : "", m.trend ? `추이 ${m.trend}${m.trend_word ? ` · ${m.trend_word}` : ""}` : "", m.elective ? `진로선택 ${m.elective}` : "", m.grade_note ?? ""].filter(Boolean).join(" · ") || "성적 정보 없음",
      major_subjects: m.major_subjects ?? "", summary: p.summary, books: (p.books ?? []).slice(0, 4),
    };
  });
  return {
    found: pick.length + seniors.length, total_matches: rows.length, keyword_widened: widened,
    schools: [...new Set([...seniors.map((s: any) => s.who.split(" ")[0]), ...pick.map((p) => p.who.split(" ")[0])])],
    seniors, cases: pick,
    note: "실제 합격 선배 생기부를 정제한 것. 성적은 선배 때의 9등급제 성적을 5등급제로 환산한 추정치다(누적 비율 기준). 지금 학생(5등급제)과 대략 비교할 수 있지만 정확한 값이 아니라고 함께 말한다. 근거로 쓰되 문장을 길게 그대로 옮기지 말고 흐름(1학년 관심 → 2학년 연결 → 3학년 심화)을 요약한다. 선배가 했다고 지어내지 않는다. 선배 활동을 그대로 따라 하라고 하지 말고 이 학생에게 맞게 비튼다 (똑같이 하면 흔해진다).",
  };
}

/* PDF 판 → 글 (관리자 '선배 사례 가져오기') — 이미 정제한 PDF를 칸별 글로 옮긴다 */
function toB64(buf: Uint8Array) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
async function importBoard(db: any, userId: string, b: any) {
  const { data: blob, error } = await db.storage.from("sb-files").download(`boards/${b.id}/full.pdf`);
  if (error || !blob) return { error: "PDF를 찾지 못했어요" };
  const b64 = toB64(new Uint8Array(await blob.arrayBuffer()));
  const sys = `이 PDF는 대학 합격생 학교생활기록부의 한 영역(${AREA_LABEL[b.area] ?? b.area}) ${b.grade}학년 부분이다. 이름 · 학교는 이미 지운 정제본이다. JSON만 출력.
- 적힌 내용을 칸(항목)별로 그대로 옮긴다. 요약하거나 고치거나 지어내지 않는다. 읽을 수 없는 부분은 뺀다.
- label: 칸 이름 (창체면 자율활동 · 동아리활동 · 진로활동 등, 세특이면 과목 이름, 행특이면 '행동특성', 성적이면 과목 이름)
- text: 그 칸의 글 전체 (성적이면 '1학기 2등급 · 2학기 2등급' 처럼 숫자를 글로)
- 사람 이름 · 학교 이름 · 지역 · 선생님 이름이 남아 있으면 ○○로 바꾼다.
{"items":[{"label":"","text":""}]}`;
  const res = await openai({
    model: "gpt-5-mini", max_completion_tokens: 12000, reasoning_effort: "minimal", response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: [{ type: "file", file: { filename: `board_${b.id}.pdf`, file_data: `data:application/pdf;base64,${b64}` } }, { type: "text", text: "이 PDF의 글을 칸별로 옮겨 줘." }] }],
  });
  const raw = await res.text();
  let out: any = null, inT = 0, outT = 0;
  try {
    const j = JSON.parse(raw);
    inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0);
    out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
  } catch { console.error("senior import", res.status, raw.slice(0, 400)); }
  await logUsage(db, userId, inT, outT, Boolean(out), "senior_import");
  const items = (Array.isArray(out?.items) ? out.items : []).map((x: any, i: number) => ({
    board_id: b.id, record_id: b.record_id, university: b.university, track: b.track, grade: b.grade, area: b.area,
    label: clean(x?.label, 40), body: String(x?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 3000), sort: i,
  })).filter((x: any) => x.body.length >= 5);
  if (!items.length) return { error: res.ok ? "글을 뽑지 못했어요" : `AI 오류 ${res.status}` };
  await db.from("senior_cases").delete().eq("board_id", b.id);
  const { error: e2 } = await db.from("senior_cases").insert(items);
  if (e2) { console.error("senior save", e2); return { error: "저장하지 못했어요" }; }
  return { lines: items.length };
}

/* 화면에 보여 줄 '지금 하는 일' — 도구마다 우리말로 */
function stepLabel(name: string, a: any) {
  const u = clean(a?.university, 20), d = clean(a?.department, 20);
  const who = [u, d].filter(Boolean).join(" ");
  switch (name) {
    case "search_units": return `${who || "대학"} 모집 정보 찾는 중`;
    case "get_rules": return `${u || "대학"} 전형 방법 읽는 중`;
    case "get_changes": return `${u || "대학"} 바뀐 점 확인하는 중`;
    case "get_results": return `${who || "대학"} 입결 확인하는 중`;
    case "get_jeongsi_results": return `${who || "대학"} 정시 입결 확인하는 중`;
    case "get_interview_style": return `${u || "대학"} 면접 스타일 찾는 중`;
    case "get_recommended_subjects": return `${who || "학과"} 권장과목 찾는 중`;
    case "get_topic_cases": return `${d || "학과"} 실제 탐구 사례 찾는 중`;
    case "get_book_recs": return `${d || "학과"} 추천 도서 찾는 중`;
    case "get_study_tips": return `${a?.subject && a.subject !== "전과목" ? a.subject + " " : ""}선배 공부법 찾는 중`;
    case "my_record": return "내 생기부 노트 자세히 읽는 중";
    case "list_universities": return "자료 있는 대학 확인하는 중";
    case "check_topic": return "탐구주제 흔한가 진단하는 중 (10초쯤 걸려요)";
    case "check_motive": return `${u ? u + " 기준으로 " : ""}지원동기 흔한가 진단하는 중 (10초쯤 걸려요)`;
    case "interview_questions": return `${who || "대학"} 면접 기준으로 예상질문 뽑는 중 (30초쯤 걸려요)`;
    case "tail_practice": return a?.action === "next" ? "내 답변 듣고 다음 꼬리질문 만드는 중" : `${u || "대학"} 면접관처럼 꼬리질문 만드는 중`;
    case "check_reading": return `'${clean(a?.title, 20) || "책"}' 독서 흔한가 진단하는 중 (10초쯤 걸려요)`;
    case "find_seniors": return `${TRACK_LABEL[a?.track] ?? ""} 합격 선배 생기부에서 비슷한 사례 찾는 중`;
    case "propose_action": return a?.kind === "study_test" ? "효과 시험 준비해 둘지 정하는 중" : "면접 준비에 넣을지 정하는 중";
    default: return "자료 찾는 중";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: "로그인하면 물꼬 입시 AI를 쓸 수 있어요", need_login: true }, 401);
    const body = await req.json().catch(() => ({}));

    // 남은 횟수만 묻기
    const paid = await passUntil(db, user.id);
    const usage = await usageOf(db, user.id, paid);
    if (body.action === "status") return json({ usage, grade: await gradeOf(db, user.id, user.user_metadata ?? {}).catch(() => "") });

    // 면접 준비 화면(/prep) — 대학 하나의 면접 정보 (AI 안 부름 · 사용량 안 씀)
    //   { action: "univ_brief", university, department } → { university, style, rules, units, past(이 학교 기출 메인 질문), common(자주 나온 공통 기출 — 이 학교 기출이 적을 때), tracks(면접 있는 전형) }
    // 기출문제 학습(/prep) — 학생 답변 AI 피드백 (1차 · 최종). 학교별 답변 분석 기준(univ_answer_guides · sql/sm_85)으로 본다
    //   결제 없이 — 기출은 무료 3문제 + 친구 1명당 5문제 (studyQuota) · 생기부 예상질문(source interview)은 24,000원 결제한 학생만
    //   { action: "answer_feedback", university, department, question, kind, answer, round: 1|2, prev?, source: past|interview }
    //   → { feedback: { score, axes[{ name, weight, score }], school, criteria, strengths[3], improvements[3], questions[3], changed? }, quota }
    //   못 풀면 { need_invite, quota } (무료 문제를 다 씀) · { need_interview_pay } (예상질문인데 결제 전)
    //   축은 학교마다 다르다 — 그 학교 엑셀 평가요소 중 비중이 있는 것만 (예: 건국대 학업역량·공동체역량·진로)
    //   축 점수 = 그 기준을 이 답이 얼마나 채웠는지 0~100 · 종합 score = 학교 비중으로 가중 평균
    if (body.action === "answer_feedback") {
      const answer = String(body.answer ?? "").trim().slice(0, 1500);
      const question = clean(body.question, 300);
      if (answer.length < 15 || !question) return json({ error: "답변을 15자 이상 적어 주세요" }, 400);
      // 'ㅁㄴㅇㄹ' 같은 장난 답은 피드백 없이 돌려보낸다 (무료 문제도 안 씀) — 완성된 글자(한글 음절·영문)가 10자는 넘어야
      if ((answer.match(/[가-힣a-zA-Z]/g) ?? []).length < 10) return json({ error: "실제로 말하듯 문장으로 답해 주세요 (자음·모음만 쓴 답은 볼 수 없어요)" }, 400);
      // 결제 없이 — 기출은 무료 문제 수(3 + 친구당 5), 예상질문은 24,000원 결제한 학생만 (에이전트 주간 사용량과 따로)
      const source = body.source === "interview" ? "interview" : "past";
      const uname = clean(body.university, 40);
      const gate: any = await studyGate(db, user.id, uname, question, source);
      if (!gate.ok) {
        if (gate.need === "invite") return json({ need_invite: true, quota: gate.quota });
        if (gate.need === "school") return json({ need_school_pay: true, quota: gate.quota });
        if (gate.need === "school_max") return json({ error: `기출문제 학습은 학교 ${gate.quota.school_limit}곳까지예요`, quota: gate.quota });
        return json({ need_interview_pay: true, quota: gate.quota });
      }
      const round = Number(body.round) === 2 ? 2 : 1;
      const DEFAULT_AXES = ["인성", "전공적합성", "학업역량", "공동체역량", "진로", "자기주도"];

      // 학교 기준 찾기 — "단국대학교(죽전)" · "단국대" · "서울과기대" 도 맞춘다
      const bkey = (v: string) => String(v ?? "").replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교$|대학$/, "대");
      let { data: guide } = await db.from("univ_answer_guides").select("*").eq("university", uname).maybeSingle();
      if (!guide) {
        const { data: all } = await db.from("univ_answer_guides").select("university").limit(500);
        const hit = (all ?? []).find((g: any) => bkey(g.university) === bkey(uname))
          ?? (all ?? []).find((g: any) => bkey(g.university).startsWith(bkey(uname)) || bkey(uname).startsWith(bkey(g.university)));
        if (hit) ({ data: guide } = await db.from("univ_answer_guides").select("*").eq("university", hit.university).maybeSingle());
      }
      const w = (guide?.weights ?? {}) as Record<string, number>;
      // 이 학교 평가요소 (비중 큰 순) — 자료가 없으면 일반 6축을 같은 비중으로
      const AXES = Object.entries(w).filter(([, v]) => Number(v) > 0).sort((x, y) => Number(y[1]) - Number(x[1])).map(([k]) => k);
      const weightOf: Record<string, number> = AXES.length ? Object.fromEntries(AXES.map((k) => [k, Number(w[k])])) : Object.fromEntries(DEFAULT_AXES.map((k) => [k, 1]));
      if (!AXES.length) AXES.push(...DEFAULT_AXES);
      const wLine = Object.entries(w).filter(([, v]) => Number(v) > 0).sort((x, y) => Number(y[1]) - Number(x[1])).map(([k, v]) => `${k} ${v}%`).join(", ");
      const univLine = guide
        ? `[${guide.university} 답변 평가 기준]
- 면접관 핵심 관점: ${guide.view}
- 질문 출제 특징: ${guide.question_style}
- 고득점 답변 구성: ${guide.best_answer}
- 선호하는 학생: ${guide.preferred}
- 평가톤: ${guide.tone}
- 평가요소 비중: ${wLine || "자료 없음"}`
        : `[학교 기준 자료 없음 — 일반 학생부종합 면접 기준(인성·전공적합성·학업역량·공동체·진로·자기주도)으로 본다]`;

      const sys = `너는 한국 대학 수시 면접(학생부종합) 평가위원이다. 고등학생이 기출 질문에 쓴 답변을 위 학교의 평가 기준으로 분석한다. JSON만 출력.
규칙:
- 학생 답을 대신 써 주지 않는다. 학생이 말하지 않은 경험·사실을 지어내지 않는다.
- axes: 이 학교 평가요소(${AXES.join(", ")})마다, 이 답변이 그 요소를 이 학교 기준(핵심 관점 · 고득점 답변 구성)으로 얼마나 보여 줬는지 0~100 정수.
  · 그 요소가 답에 거의 안 드러나면 낮게(0~30), 말로만 있으면 중간(30~60), 구체적 상황·행동·결과로 보이면 높게(60~100).
  · 질문에 맞지 않는 답, 너무 짧은 답(1분 250~350자 기준)은 전체적으로 낮게.
- criteria: '평가 기준 요약' 4~6문장. 이 학교가 이 문항에서 무엇을 보는지(학교 기준을 이 질문에 적용)와, 그 기준에서 이 답변이 어떻게 보이는지. "~한다/~이다" 평서문.
- strengths 3개: 강점 포인트. 답변 속 실제 내용에 근거한 한 문장씩, "~했다/~보인다" 평서문.
- improvements 3개: 개선 포인트. 이 학교 기준으로 무엇을 더 보여 줘야 하는지 한 문장씩, "~할 필요가 있다/~해야 한다" 평서문.
- questions 3개: 사유하는 질문. 학생이 답을 보완하려고 스스로 생각해 볼 질문, "~인가?" 형태. 학생 답의 소재를 그대로 짚는다.
${round === 2 ? "- 이번은 2차(최종) 답변이다. 1차 분석을 얼마나 반영했는지 보고 changed 에 나아진 점 한 문장(평서문). 남은 아쉬운 점만 improvements 에." : ""}
{"axes":{${AXES.map((a) => `"${a}":0`).join(",")}},"criteria":"","strengths":["","",""],"improvements":["","",""],"questions":["","",""]${round === 2 ? ',"changed":""' : ""}}`;
      const prompt = `${univLine}

[지원] ${uname} ${clean(body.department, 40)}
[질문 · ${clean(body.kind, 20) || "면접"}] ${question}
${round === 2 && body.prev ? `[1차 분석] ${clean(JSON.stringify({ score: body.prev.score, improvements: body.prev.improvements ?? body.prev.fix }), 700)}\n` : ""}[학생 답변 ${answer.length}자]
${answer}`;
      const res = await openai({ model: MODEL, max_completion_tokens: 5000, reasoning_effort: "low", response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] });
      const raw = await res.text();
      let out: any = null, inT = 0, outT = 0;
      try {
        const j = JSON.parse(raw);
        inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0);
        out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
      } catch { console.error("feedback", res.status, raw.slice(0, 400)); }
      await logUsage(db, user.id, inT, outT, Boolean(out), "prep"); // 기출 학습 비용은 따로 (에이전트 주간 사용량에 안 들어감)
      if (!out) return json({ error: "피드백을 만들지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((x) => clean(x, 160).replace(/^["“”']+|["“”']+$/g, "")).filter(Boolean).slice(0, n);
      // 축 점수 0~100 · 종합 = 학교 비중으로 가중 평균 (계산은 서버가 — AI 숫자가 어긋나도 맞게)
      const axes = AXES.map((k) => ({ name: k, weight: weightOf[k], score: Math.max(0, Math.min(100, Math.round(Number(out.axes?.[k]) || 0))) }));
      const wsum = axes.reduce((x, a) => x + a.weight, 0) || 1;
      const feedback = {
        score: Math.round(axes.reduce((x, a) => x + a.weight * a.score, 0) / wsum),
        axes: axes.map((a) => ({ ...a, weight: Math.round((a.weight * 100) / wsum) })),
        school: guide?.university ?? null,
        criteria: clean(out.criteria, 900),
        strengths: arr(out.strengths, 3),
        improvements: arr(out.improvements, 3),
        questions: arr(out.questions, 3),
        changed: round === 2 ? clean(out.changed, 200) : undefined,
      };
      // 처음 피드백을 받은 문제면 한 줄 적는다 (이 문제의 2차 · 꼬리질문은 더 세지 않음)
      if (gate.isNew || source === "interview") {
        const { error: uErr } = await db.from("prep_study_uses").insert({ user_id: user.id, university: uname, question, source });
        if (uErr && !String(uErr.message).includes("duplicate")) console.warn("study use", uErr);
      }
      return json({ feedback, quota: await studyQuota(db, user.id) });
    }

    // 기출문제 학습 남은 문제 수 { used, limit, left, friends, free, per_friend, interview_paid }
    if (body.action === "study_quota") return json({ quota: await studyQuota(db, user.id) });

    // 기출문제 학습 Step 5 — 문제마다 꼬리질문 1개 (tail 함수를 서버끼리 불러 꼬리질문 무료 개수를 쓰지 않는다)
    //   { action: "study_tail", univ, department, main_type, main_q, answer, source }
    if (body.action === "study_tail") {
      const source = body.source === "interview" ? "interview" : "past";
      const univ = clean(body.univ, 40), mainQ = clean(body.main_q, 300);
      const quota = await studyQuota(db, user.id);
      if (source === "interview" && !quota.interview_paid) return json({ need_interview_pay: true, quota });
      if (source === "past") {
        const { data: had } = await db.from("prep_study_uses").select("id").eq("user_id", user.id).eq("university", univ).eq("question", mainQ).maybeSingle();
        if (!had && !quota.interview_paid) return json({ error: "먼저 이 문제의 AI 피드백을 받아 주세요" }, 400);
      }
      const r = await callFn("tail", { action: "start", univ, department: clean(body.department, 40) || "미정", main_type: body.main_type, main_q: mainQ, answer: body.answer }, token, true);
      return json(r);
    }


    // 내 입시 플랜 (/plan) — 지금 플랜 · 이번 주 할 일 (AI 안 부름)
    //   { action: "plan_status" } → { plan, tasks, week_start, history[{ week_start, total, done, items }], need_week, profile: { grade, department }, notes }
    if (body.action === "plan_status") {
      const ws = weekStartKST();
      const [{ data: plan }, { data: my }, { data: prof }, { count: notes }] = await Promise.all([
        db.from("study_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("sm_my").select("grade,department").eq("user_id", user.id).maybeSingle(),
        db.from("profiles").select("grade").eq("id", user.id).maybeSingle(),
        db.from("record_activities").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      const { data: tasks } = plan ? await db.from("plan_tasks").select("id,title,detail,link,done,sort,week_start").eq("user_id", user.id).eq("week_start", ws).order("sort") : { data: [] };
      // 지난 미션 기록 — 주마다 몇 개 중 몇 개 했는지 (최근 8주)
      const { data: past } = plan ? await db.from("plan_tasks").select("title,done,week_start").eq("user_id", user.id).lt("week_start", ws).order("week_start", { ascending: false }).limit(60) : { data: [] };
      const hm: Record<string, any> = {};
      for (const t of past ?? []) { const w = (hm[t.week_start] ??= { week_start: t.week_start, total: 0, done: 0, items: [] }); w.total++; if (t.done) w.done++; w.items.push({ title: t.title, done: t.done }); }
      const history = Object.values(hm).sort((x: any, y: any) => (x.week_start < y.week_start ? 1 : -1)).slice(0, 8);
      return json({ plan, tasks: tasks ?? [], week_start: ws, history, need_week: Boolean(plan) && !(tasks ?? []).length, notes: notes ?? 0,
        profile: { grade: plan?.grade || my?.grade || prof?.grade || "", department: plan?.department || my?.department || user.user_metadata?.major || "" } });
    }

    // 학습 다이어리에 넣기 — { action: "routine_save", text: 물꼬가 짠 루틴 답변 } → { count }
    //   답변 글을 루틴 줄(무엇 · 언제 · 몇 분 · 어떻게 · 요일)로 바꿔 plan_routines 에 넣는다 (예전 루틴은 끈다 · 체크 기록은 남김)
    if (body.action === "routine_save") {
      const text = String(body.text ?? "").replace(/\[\[[^\]]*\]\]/g, "").trim().slice(0, 4000);
      if (text.length < 20) return json({ error: "넣을 루틴이 없어요" }, 400);
      const sys = `학생에게 짜 준 공부 루틴 글을 매일 체크할 루틴 목록으로 바꾼다. JSON만 출력.
- 글에 있는 것만. 지어내지 않는다. 같은 일은 한 줄로 합친다. 최대 10개.
- title: 체크할 일 (20자 안팎, "수학 문제 10개 풀기"처럼 했는지 알 수 있게)
- how: 어떻게 하는지 한 줄 (글에 공부법이 있으면 그대로 쉽게, 없으면 "")
- time_label: 아침 · 오전 · 오후 · 저녁 · 밤 · 또는 글에 있는 시각 (없으면 "")
- minutes: 글에 있는 분 (없으면 0)
- days: 하는 요일 숫자 1(월)~7(일). 매일이면 [1,2,3,4,5,6,7], 월~금이면 [1,2,3,4,5], 토요일만이면 [6]
- subject: 국어 · 수학 · 영어 · 사회탐구 · 과학탐구 · 한국사 · 전과목 중 하나. title 에 과목 이름은 빼도 된다
  · 공부 내용(개념 · 문제 · 오답 · 지문 · 단어 · 기출 · 풀이 · 정리 · 복습)이면 줄에 과목 이름이 없어도 글 전체가 다루는 과목으로 넣는다 (국어 루틴의 '오답·헷갈린 표현 정리'는 국어)
  · 전과목은 기상 · 수면 · 휴식 · 플래너 쓰기처럼 과목과 상관없는 생활 습관에만 쓴다
- 체크리스트 · 규칙처럼 따로 적힌 것(기상 시간 지켰나 등)도 매일 할 일이면 넣는다
{"routines":[{"subject":"","title":"","how":"","time_label":"","minutes":0,"days":[1,2,3,4,5]}]}`;
      const out = await planAsk(db, user.id, sys, text);
      const list = (Array.isArray(out?.routines) ? out.routines : []).map((r: any, i: number) => ({
        user_id: user.id, subject: SUBJECTS.includes(r?.subject) ? r.subject : "전과목",
        title: clean(r?.title, 60), how: clean(r?.how, 200), time_label: clean(r?.time_label, 12),
        minutes: Math.max(0, Math.min(600, Number(r?.minutes) || 0)),
        days: [...new Set((Array.isArray(r?.days) ? r.days : []).map(Number).filter((d: number) => d >= 1 && d <= 7))].sort(),
        sort: i,
      })).filter((r: any) => r.title).map((r: any) => ({ ...r, days: r.days.length ? r.days : [1, 2, 3, 4, 5, 6, 7] })).slice(0, 10);
      if (!list.length) return json({ error: "루틴으로 바꾸지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      // AI가 공부 줄을 '전과목'으로 놓쳤으면 바로잡는다 — 글의 주 과목(가장 많이 나온 과목)으로. 생활 습관은 그대로
      const HABIT = /기상|수면|잠|취침|일어나|휴식|쉬기|스트레칭|운동|산책|플래너|계획\s*세우|체크|물\s*마시|핸드폰|폰/;
      const STUDYISH = /개념|문제|오답|지문|단어|기출|풀이|풀기|정리|복습|예습|암기|독해|문법|표현|해설|공식|모의/;
      const counts: Record<string, number> = {};
      for (const r of list) if (r.subject !== "전과목") counts[r.subject] = (counts[r.subject] ?? 0) + 1;
      if (!Object.keys(counts).length) for (const [re, sub] of SUBJ) { const n = (text.match(new RegExp(re.source, "g")) ?? []).length; if (n) counts[sub] = (counts[sub] ?? 0) + n; }
      const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (main) for (const r of list) if (r.subject === "전과목" && !HABIT.test(r.title) && STUDYISH.test(`${r.title} ${r.how}`)) r.subject = main;
      // 같은 과목 루틴만 새것으로 바꾼다 (수학 넣은 뒤 국어 넣어도 수학은 그대로) · 전과목은 제목이 같은 것만
      const subs = [...new Set(list.map((r: any) => r.subject).filter((x: string) => x !== "전과목"))];
      if (subs.length) await db.from("plan_routines").update({ active: false }).eq("user_id", user.id).eq("active", true).in("subject", subs);
      const alls = list.filter((r: any) => r.subject === "전과목").map((r: any) => r.title);
      if (alls.length) await db.from("plan_routines").update({ active: false }).eq("user_id", user.id).eq("active", true).eq("subject", "전과목").in("title", alls);
      const { data: keep } = await db.from("plan_routines").select("sort").eq("user_id", user.id).eq("active", true).order("sort", { ascending: false }).limit(1);
      const base = (keep?.[0]?.sort ?? -1) + 1;
      list.forEach((r: any, i: number) => { r.sort = base + i; });
      const { error } = await db.from("plan_routines").insert(list);
      if (error) { console.error("routine save", error); return json({ error: "저장하지 못했어요. 잠시 후 다시 해 주세요" }, 500); }
      return json({ count: list.length });
    }

    // 플랜 만들기 — { action: "plan_make", grade, department, did, goal?, concern? } → { plan, tasks }
    //   AI 비용은 물꼬 주간 사용량에 들어간다 (다 쓰고 이용권도 없으면 need_pay)
    if (body.action === "plan_make") {
      if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });
      const r: any = await makePlan(db, user.id, user.user_metadata ?? {}, body);
      if (r.error) return json({ error: r.error }, 400);
      return json({ plan: r.row, tasks: r.tasks, week_start: weekStartKST(), usage: await usageOf(db, user.id, paid) });
    }

    // 새 주 할 일 — { action: "plan_next_week" } → { tasks }  (이번 주 할 일이 이미 있으면 그대로)
    //   지난 할 일 중 한 것 · 못 한 것을 보고 이번 주 3~5개를 새로 짠다 (못 한 중요한 일은 이어서)
    if (body.action === "plan_next_week") {
      const ws = weekStartKST();
      const { data: plan } = await db.from("study_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!plan) return json({ error: "먼저 플랜을 만들어 주세요" }, 400);
      const { data: cur } = await db.from("plan_tasks").select("id,title,detail,link,done,sort,week_start").eq("user_id", user.id).eq("week_start", ws).order("sort");
      if ((cur ?? []).length && !body.force) return json({ tasks: cur });
      if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });
      const { data: past } = await db.from("plan_tasks").select("title,done,week_start").eq("user_id", user.id).lt("week_start", ws).order("week_start", { ascending: false }).limit(15);
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const sys = `너는 생수면의 '물꼬 입시 AI'다. 학생의 입시 플랜에서 이번 주 할 일을 새로 짠다. JSON만 출력.
오늘은 ${today} (한국 시간)이다.
${PLAN_GUIDE}
규칙:
- 지난주에 못 한 일 중 중요한 것은 이번 주로 이어 넣고, 다 한 일은 다음 단계로 한 걸음 나아간다.
- 이번 달 계획(months)에서 이번 주에 맞는 것을 고른다. 3~5개, 하루 30분~1시간 크기.
- title(20자 안팎) · detail(어떻게 하는지 한 문장) · link. ${PLAN_LINK_RULE}
{"week":[{"title":"","detail":"","link":""}]}`;
      const prompt = `[학년] ${plan.grade}\n[목표] ${plan.goal || ""} ${plan.department || "아직 모름"}\n[플랜] ${JSON.stringify(plan.plan).slice(0, 2500)}\n[지난 할 일] ${(past ?? []).map((t: any) => `${t.week_start} ${t.done ? "✓" : "✗"} ${t.title}`).join(" / ") || "(없음)"}`;
      const out = await planAsk(db, user.id, sys, prompt);
      if (!out) return json({ error: "이번 주 할 일을 만들지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      return json({ tasks: await saveWeek(db, user.id, plan.id, planWeek(out.week)), usage: await usageOf(db, user.id, paid) });
    }

    // ───────── 공부법 효과 시험 (sql/sm_94) ─────────
    //   { action: "test_status" } → { open: [시험], done: [끝난 시험] }  (AI 안 부름)
    //   { action: "test_make", subject, unit, from_id? } → { test }  (AI · 주간 사용량)  · 같은 과목 진행 중 시험이 있으면 그것을 준다
    //   { action: "test_submit", id, answers: [0~3 …] } → 시작 시험이면 { test, review, tips } · 다시 시험이면 { test, review, result, message, kept, tips? }
    // ───────── 선배 사례 가져오기 (관리자) ─────────
    //   { action: "senior_import", force_board? } → 아직 안 가져온 PDF 판을 2개씩 글로 옮긴다 → { done_now, left, total, errors }
    if (body.action === "senior_import") {
      const { data: adm } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!adm) return json({ error: "관리자만 할 수 있어요" }, 403);
      const [{ data: boards }, { data: recs }, { data: tiers }, { data: had }] = await Promise.all([
        db.from("sb_boards").select("id,record_id,grade,area,kind").eq("kind", "pdf"),
        db.from("sb_records").select("id,track_id,tier_id"),
        db.from("sb_tiers").select("id,schools"),
        db.from("senior_cases").select("board_id").limit(100000),
      ]);
      const recOf = new Map((recs ?? []).map((r: any) => [r.id, r]));
      const tierOf = new Map((tiers ?? []).map((t: any) => [t.id, t]));
      const done = new Set((had ?? []).map((r: any) => Number(r.board_id)));
      const all = (boards ?? []).map((b: any) => {
        const r: any = recOf.get(b.record_id) ?? {};
        const t: any = tierOf.get(r.tier_id) ?? {};
        return { ...b, track: r.track_id, university: String(t.schools ?? "").split(" · ")[0] };
      }).filter((b: any) => b.track && b.university);
      const todo = body.force_board ? all.filter((b: any) => Number(b.id) === Number(body.force_board)) : all.filter((b: any) => !done.has(Number(b.id)));
      const errors: string[] = [];
      let n = 0;
      for (const b of todo.slice(0, 2)) {
        const r: any = await importBoard(db, user.id, b);
        if (r.error) errors.push(`${b.university} ${TRACK_LABEL[b.track]} ${b.grade}학년 ${AREA_LABEL[b.area]}: ${r.error}`);
        else { n++; done.add(Number(b.id)); }
      }
      return json({ done_now: n, left: all.filter((b: any) => !done.has(Number(b.id))).length, total: all.length, errors });
    }

    // ───────── 해 줄까요? 카드 ─────────
    //   { action: "agent_action", id, decide: "run" | "cancel" } → { status, message, link }
    if (body.action === "agent_action") {
      const { data: act } = await db.from("agent_actions").select("*").eq("id", Number(body.id)).eq("user_id", user.id).maybeSingle();
      if (!act) return json({ error: "할 일을 찾지 못했어요" }, 404);
      if (act.status !== "pending") return json({ status: act.status, ...(act.result ?? {}) });
      const finish = async (status: string, result: any) => {
        await db.from("agent_actions").update({ status, result, done_at: new Date().toISOString() }).eq("id", act.id);
        return json({ status, ...result });
      };
      if (body.decide === "cancel") return finish("cancelled", { message: "알겠어요. 안 할게요." });
      const p = act.payload ?? {};
      if (act.kind === "prep_school") {
        const { error } = await db.from("prep_targets").upsert({ user_id: user.id, university: p.university, department: p.department ?? "", track: "학생부종합" }, { onConflict: "user_id,university,department" });
        if (error) { console.error("prep_school", error); return json({ error: "넣지 못했어요. 잠시 후 다시 해 주세요" }, 500); }
        return finish("done", { message: `${p.university}${p.department ? ` ${p.department}` : ""}를 수시 면접 준비에 넣었어요. 기출문제부터 연습해 봐요.`, link: "/prep", link_label: "면접 준비하러 가기" });
      }
      if (act.kind === "study_test") {
        const { data: open } = await db.from("study_tests").select("id").eq("user_id", user.id).eq("subject", p.subject).neq("status", "done").maybeSingle();
        const link = `/plan?tab=study&subject=${encodeURIComponent(p.subject)}`;
        if (open) return finish("done", { message: `${p.subject} 효과 시험이 이미 있어요. 학습 플랜에서 이어서 풀어요.`, link, link_label: "시험 보러 가기" });
        if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요" } : { need_pay: true, usage });
        const r: any = await createTest(db, user, p.subject, p.unit);
        if (r.error) return json({ error: r.error }, 502);
        return finish("done", { message: `${p.subject} '${p.unit}' 시작 시험 ${(r.row.set_a ?? []).length}문제를 만들었어요. 지금 풀고, 일주일 뒤 비슷한 문제로 다시 풀어 봐요.`, link, link_label: "시작 시험 풀기" });
      }
      return finish("failed", { message: "할 수 없는 일이에요" });
    }

    if (body.action === "test_status") {
      const { data: rows } = await db.from("study_tests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
      const open = (rows ?? []).filter((r: any) => r.status !== "done");
      const done = (rows ?? []).filter((r: any) => r.status === "done").slice(0, 6);
      const withTips = await Promise.all(open.map(async (r: any) => ({ ...testView(r), tips: r.status === "studying" ? await tipsByIds(db, r.tip_ids) : [] })));
      return json({ open: withTips, done: done.map((r: any) => testView(r, false)) });
    }

    if (body.action === "test_make") {
      const subject = TEST_SUBJECTS.includes(body.subject) ? body.subject : "";
      const unit = clean(body.unit, 40);
      if (!subject) return json({ error: "과목을 골라 주세요" }, 400);
      if (unit.length < 2) return json({ error: "단원을 적어 주세요 (예: 이차함수, 비문학 독해)" }, 400);
      const { data: openRow } = await db.from("study_tests").select("*").eq("user_id", user.id).eq("subject", subject).neq("status", "done").maybeSingle();
      if (openRow) return json({ test: testView(openRow), existing: true });
      if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });
      // 이어서 하는 시험이면 (한 주 더 · 교체) 몇 번째 도전인지 이어 센다
      let round = 1;
      if (body.from_id) {
        const { data: prev } = await db.from("study_tests").select("round,result,unit,subject").eq("id", Number(body.from_id)).eq("user_id", user.id).maybeSingle();
        if (prev && prev.subject === subject && prev.unit === unit && prev.result === "한주더") round = (prev.round ?? 1) + 1;
      }
      const r: any = await createTest(db, user, subject, unit, round);
      if (r.error) return json({ error: r.error }, 502);
      return json({ test: testView(r.row), usage: await usageOf(db, user.id, paid) });
    }

    if (body.action === "test_submit") {
      const { data: row } = await db.from("study_tests").select("*").eq("id", Number(body.id)).eq("user_id", user.id).maybeSingle();
      if (!row) return json({ error: "시험을 찾지 못했어요" }, 404);
      const answers = (Array.isArray(body.answers) ? body.answers : []).map((x: unknown) => (x === null || x === undefined || x === "" || !Number.isInteger(Number(x)) ? null : Number(x)));
      if (answers.some((x: any) => x === null || x < 0 || x > 3)) return json({ error: "모든 문제에 답을 골라 주세요" }, 400);
      const now = new Date().toISOString();
      if (row.status === "pre") {
        if (answers.length !== row.set_a.length) return json({ error: "모든 문제에 답을 골라 주세요" }, 400);
        const score = scoreOf(row.set_a, answers);
        const review = reviewOf(row.set_a, answers);
        const wrong = [...new Set(review.filter((r: any) => !r.correct).map((r: any) => r.type))];
        const { data: gaveUp } = await db.from("study_tests").select("tip_ids").eq("user_id", user.id).eq("subject", row.subject).eq("unit", row.unit).eq("result", "교체");
        const usedTitles = (await tipsByIds(db, (gaveUp ?? []).flatMap((g: any) => g.tip_ids ?? []))).map((x: any) => x.title);
        const tips = await testTips(db, row.subject, row.unit, row.grade ?? "", usedTitles);
        const open = new Date(Date.now() + TEST_DAYS * 86400000).toISOString();
        await db.from("study_tests").update({ pre_answers: answers, pre_score: score, pre_at: now, wrong_types: wrong, tip_ids: tips.map((x: any) => x.id).filter(Boolean), post_open_at: open, status: "studying" }).eq("id", row.id);
        return json({ test: testView({ ...row, pre_score: score, pre_at: now, post_open_at: open, status: "studying" }), review, wrong_types: wrong, tips });
      }
      if (row.status === "studying") {
        if (Date.now() < new Date(row.post_open_at).getTime()) return json({ error: "다시 시험은 시작 시험 일주일 뒤에 열려요", post_open_at: row.post_open_at }, 400);
        if (answers.length !== row.set_b.length) return json({ error: "모든 문제에 답을 골라 주세요" }, 400);
        const score = scoreOf(row.set_b, answers);
        const kept = await adherence(db, user.id, row.subject, row.pre_at);
        const j = judge(row.pre_score ?? 0, score, row.set_b.length, row.round ?? 1, kept);
        await db.from("study_tests").update({ post_answers: answers, post_score: score, post_at: now, result: j.result, status: "done" }).eq("id", row.id);
        // 공부법을 바꿀 때는 — 지난번에 쓴 카드는 빼고 같은 과목 · 단원의 다른 카드를 고른다
        let tips: any[] = [];
        if (j.result === "교체") {
          const prevTitles = (await tipsByIds(db, row.tip_ids)).map((x: any) => x.title);
          tips = await testTips(db, row.subject, row.unit, row.grade ?? "", prevTitles);
        }
        return json({ test: testView({ ...row, post_score: score, post_at: now, result: j.result, status: "done" }, false), review: reviewOf(row.set_b, answers),
          result: j.result, message: j.message, kept, pre_score: row.pre_score, tips });
      }
      return json({ error: "이미 끝난 시험이에요" }, 400);
    }

    if (body.action === "univ_brief") {
      const raw = clean(body.university, 40);
      if (!raw) return json({ error: "대학을 적어 주세요" }, 400);
      const style = await runTool(db, user.id, "get_interview_style", { university: raw });
      const univ = await matchUniv(db, raw);
      let rules: any[] = [], units: any[] = [];
      if (univ) {
        const { data: r } = await db.from("univ_admission_rules")
          .select("year,season,track,track_type,quota_type,method,interview,interview_ratio,interview_type,csat_min")
          .eq("university", univ).eq("year", 2027).eq("season", "수시");
        rules = (r ?? []).filter((x: any) => x.interview || x.interview_ratio || x.interview_type || /면접/.test(String(x.method ?? "")))
          .map((x: any) => pick({ ...x, method: clean(x.method, 160), interview: clean(x.interview, 300) }, ["track", "track_type", "method", "interview", "interview_ratio", "interview_type", "csat_min"]));
        const dept = clean(body.department, 30).replace(/(학과|학부|전공)$/, "");
        if (dept.length >= 2) {
          const { data: u } = await db.from("univ_admission")
            .select("department,track,quota,csat_min,eval_detail").eq("university", univ).eq("year", 2027).eq("season", "수시")
            .ilike("department", `%${dept}%`).limit(20);
          units = (u ?? []).filter((x: any) => /면접/.test(String(x.eval_detail ?? "") + String(x.track ?? "")))
            .map((x: any) => pick({ ...x, eval_detail: clean(x.eval_detail, 160) }, ["department", "track", "quota", "csat_min", "eval_detail"]));
        }
      }
      // 기출 — 실제 면접 메인 질문 (tail_examples step 0). 꼬리 흐름은 보내지 않는다
      const names = [...new Set([raw, univ, (style as any)?.university, univ?.replace("대학교", "대")].filter(Boolean))];
      const { data: ex } = await db.from("tail_examples").select("question,kind,case_no").in("univ", names).eq("step", 0).order("case_no").limit(80);
      const seenQ = new Set<string>();
      const past = (ex ?? []).filter((r: any) => {
        const k = String(r.question ?? "").replace(/\s/g, "");
        if (!k || seenQ.has(k)) return false;
        seenQ.add(k);
        return true;
      }).slice(0, 40).map((r: any) => ({ q: clean(r.question, 300), kind: r.kind ?? "" }));
      // 그 학교 기출이 적으면 — 여러 대학에서 자주 나온 메인 질문(공통 기출)으로 채운다
      let common: any[] = [];
      if (past.length < 8) {
        const { data: all } = await db.from("tail_examples").select("univ,question,kind").eq("step", 0).limit(5000);
        const cnt = new Map<string, { q: string; kind: string; univs: Set<string> }>();
        for (const r of all ?? []) {
          const k = String(r.question ?? "").replace(/\s/g, "").replace(/[?.!]/g, "");
          if (!k || seenQ.has(String(r.question ?? "").replace(/\s/g, ""))) continue;
          // 다른 대학 이름이 들어간 질문은 빼고 (예: "○○대 인재상…")
          if (/대학교|대학의|대의 /.test(String(r.question))) continue;
          const c = cnt.get(k) ?? { q: clean(r.question, 300), kind: r.kind ?? "", univs: new Set<string>() };
          c.univs.add(r.univ);
          cnt.set(k, c);
        }
        common = [...cnt.values()].sort((x, y) => y.univs.size - x.univs.size).slice(0, 16 - past.length)
          .map((c) => ({ q: c.q, kind: c.kind, univ_count: c.univs.size }));
      }
      const tracks = [...new Set(rules.map((r: any) => r.track).filter(Boolean))];
      return json({ university: univ ?? (style as any)?.university ?? raw, style: (style as any)?.error ? null : style, rules: rules.slice(0, 12), units: units.slice(0, 10), past, common, tracks });
    }

    // 줄바꿈은 살린다 — 입력 카드는 "학년: …\n활동: …" 처럼 한 줄씩 온다 (clean 은 줄바꿈까지 없애서 카드가 안 읽혔다)
    const message = String(body.message ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
    if (message.length < 2) return json({ error: "질문을 적어 주세요" }, 400);
    if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });

    // 대화 불러오기
    let chatRow: any = null;
    if (body.chat_id) {
      const { data } = await db.from("agent_chats").select("*").eq("id", Number(body.chat_id)).eq("user_id", user.id).maybeSingle();
      chatRow = data;
    }
    const history = ((chatRow?.messages ?? []) as any[]).slice(-HISTORY).map((m) => ({ role: m.role, content: m.content }));

    // 답 만들기 — emit 으로 지금 하는 일을 화면에 알린다 (stream: true 일 때)
    const work = async (emit: (t: string) => void) => {
      // '내 입시 플랜 짜기' 입력 카드를 보냈으면 (학년: … / 학과: … / 활동: …) — AI 대화 없이 바로 플랜을 만든다
      const isPlanCard = /^학년\s*[:：]/m.test(message) && /^활동\s*[:：]/m.test(message);
      if (isPlanCard) { emit("내 활동 · 생기부 노트 읽는 중"); emit("목표 대학 권장과목 · 전형 · 공부법 찾는 중"); emit("목표에 맞게 입시 플랜 짜는 중 (30초쯤 걸려요)"); }
      const planDirect = isPlanCard ? await planFromCard(db, user, message, usage, paid) : null;
      const quick = planDirect ?? await quickForm(db, user.id, user.user_metadata ?? {}, message);
      if (quick && !isPlanCard) emit("적을 칸 준비하는 중");
      else for (const st of await openingSteps(db, message)) emit(st);
      const student = quick ? "" : await studentContext(db, user.id, user.user_metadata ?? {});
      const msgs: any[] = [{ role: "system", content: systemPrompt(student) }, ...history, { role: "user", content: message }];
      // 학생이 자기가 한 탐구를 직접 말하면서 심화·이어서를 물으면 — 되묻지 말고 그 주제로 바로 제안하게 한 번 더 짚어 준다
      if (!quick && /(탐구|실험|조사|활동).{0,20}(했는데|했어|했고|진행했|해\s*봤|해봤)|(심화|이어서|발전|확장).{0,15}(탐구|주제)/.test(message) && message.replace(/\s/g, "").length > 18) {
        msgs.push({ role: "system", content: "학생이 이번 질문에 자기가 한 탐구 주제를 직접 말했다. 질문 카드·입력 카드 없이, 학생이 말한 그 주제를 더 깊게/다른 각도로 하는 주제 3개를 바로 제안하라 ('지난번 탐구주제' 이야기 금지)." });
      }

      let inT = 0, outT = 0, answer = quick ?? "", retried = false;
      const proposed: number[] = []; // 이번 답에서 물꼬가 제안한 일 (해 줄까요? 카드)
      let seniorShown = 0; // 이번 답에서 보여 준 선배 사례 줄 수
      for (let round = 0; !quick && round <= MAX_ROUNDS; round++) {
        if (round > 0) emit(round === 1 ? "찾은 자료 맞춰 보는 중" : round === 2 ? "빠진 부분 더 찾아보는 중" : "자료 한 번 더 확인하는 중");
        const r = await chat(msgs, round < MAX_ROUNDS);
        if (!r) break;
        inT += Number(r.usage?.prompt_tokens ?? 0); outT += Number(r.usage?.completion_tokens ?? 0);
        const m = r.choices?.[0]?.message;
        if (!m) break;
        if (m.tool_calls?.length) {
          msgs.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
          let fixed = "";
          for (const tc of m.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* 빈 인자 */ }
            emit(stepLabel(tc.function?.name, args));
            let out: any;
            try { out = await runTool(db, user.id, tc.function?.name, args, token, !!paid); } catch (e) { console.error("tool", e); out = { error: "찾다가 문제가 생겼어요" }; }
            msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 24000) });
            if (tc.function?.name === "propose_action" && out?.id) proposed.push(Number(out.id));
            if (tc.function?.name === "find_seniors" && out?.found > 0) seniorShown += Number(out.found);
            const ck = { check_topic: "topic", check_motive: "motive", check_reading: "reading" }[String(tc.function?.name)];
            if (ck && out && typeof out.score === "number" && !fixed) fixed = formatCheck(ck, out, { ...args, __paid: !!paid });
            if (ck === "topic" && out?.quota_exceeded && !fixed) {
              // 하루 3번을 다 쓰면 — 이용권 버튼 + 친구 초대 카드
              fixed = "**오늘 탐구주제 흔한가 3번을 다 썼어요.** 내일 다시 3번이 열려요.\n\n지금 더 하려면\n- 친구 초대: 친구가 내 링크로 가입해 첫 진단을 하면 +3번\n- 이용권 (한 달 12,900원부터): 탐구주제 흔한가를 횟수 없이 쓰고, 광고도 없어져요\n\n[[친구초대]]\n[[이용권]]";
            }
          }
          if (fixed) { answer = fixed; break; }
          continue;
        }
        // 혹시 영어 도구 이름이 섞여 나오면 지운다 (예: "실제 사례(get_topic_cases)")
        answer = String(m.content ?? "").replace(/\s*\(?\b(get|search|list|my|check)_[a-z_]+\)?/g, "").trim();
        // 되묻기는 한 번만 — 바로 앞 답도 묻기만 했는데(학생이 카드로 답함) 이번에도 학과·과목·보기만 또 물으면, 묻지 말고 바로 답하게 한 번 더 부른다
        const cardsOnly = (t: string) => t.replace(/\[\[[^\]]*\]\]/g, "").replace(/먼저 하나만 물어볼게요\.?/g, "").trim().length < 40;
        const lastBot = [...history].reverse().find((h: any) => h.role === "assistant")?.content ?? "";
        const asksAgain = /\[\[\s*질문/.test(answer) || (/\[\[\s*입력/.test(answer) && !/\[\[\s*입력[^\]]*(탐구주제|지원동기|책 제목|면접 질문|내 답변|활동)/.test(answer));
        if (!retried && asksAgain && cardsOnly(answer) && /\[\[\s*(질문|입력)/.test(lastBot) && cardsOnly(lastBot)) {
          retried = true;
          msgs.push({ role: "assistant", content: m.content ?? "" });
          msgs.push({ role: "system", content: "방금 또 물었다. 학생은 이미 한 번 답했다. 더 묻지 말고(질문 카드·입력 카드 금지) 학생이 준 답과 [학생 정보]로 지금 바로 결과를 줘라. 빠진 값은 알맞게 정하고 한 줄로 밝힌다. 탐구주제면 학과에 맞는 실제 사례를 찾아 주제 3개를 바로 제안한다." });
          continue;
        }
        // 하루 · 주간 루틴을 짜 줬는데 저장 버튼을 안 붙였으면 — 붙인다 (누르면 학습 다이어리로)
        if (!/\[\[\s*루틴저장/.test(answer) && ROUTINE_Q.test(message.replace(/\s+/g, " ")) && (answer.match(/^\s*([-•*]|\d+[.)])\s/gm) ?? []).length >= 3) {
          answer = answer.trim() + "\n\n학습 다이어리에 넣으면 매일 체크할 수 있어요.\n[[루틴저장]]";
        }
        // [[플랜]] 버튼을 붙였는데 아직 플랜이 없으면 — 빈 화면으로 가지 않게 적는 칸으로 바꾼다
        if (/\[\[\s*플랜\s*\]\]/.test(answer) && !(await hasPlan(db, user.id))) {
          answer = answer.replace(/\[\[\s*플랜\s*\]\]/g, "").trim() + `\n\n목표 대학 · 학과를 알려 주면 그 목표에 맞춰 플랜을 짜 드릴게요.\n${await planCard(db, user.id, user.user_metadata ?? {})}`;
        }
        // 자료가 없다고 했으면 — '11월 안에 넣어요 + 건의함에 남겨 주세요' 와 건의함 버튼 (예전 [[대학요청]] 카드는 건의함으로 바꾼다)
        answer = answer.replace(/\[\[\s*대학요청\s*[:：]?[^\]]*\]\]/g, "").replace(/필요하면 아래에서 자료 추가를 요청해 주세요\.?/g, "").trim();
        if (/자료가\s*(아직\s*)?없|아직\s*(생수면에\s*)?.{0,20}자료가\s*없|자료가\s*아직\s*없/.test(answer) && !/\[\[\s*건의함\s*\]\]/.test(answer)) {
          if (!/11월/.test(answer)) answer += "\n\n11월 안에 넣어 드릴 예정이에요. 꼭 필요한 자료가 있으면 건의함에 남겨 주세요 — 남긴 것부터 먼저 넣어요.";
          answer += "\n[[건의함]]";
        }
        // 생수면에서 한 탐구주제가 없는 학생(처음 쓰는 학생)에게 '지난번 탐구주제' 카드가 나오면 학과·과목 입력 카드로 바꾼다
        //   (먼저 한 번은 '지난번' 없이 다시 부르고, 그래도 나오면 카드만 바꾼다)
        if (/\[\[\s*질문:[^\]]*지난번/.test(answer) && !student.includes("[생수면에서 한 탐구주제")) {
          if (!retried) {
            retried = true;
            msgs.push({ role: "assistant", content: m.content ?? "" });
            msgs.push({ role: "system", content: "이 학생은 생수면에서 한 탐구주제가 없다. '지난번' 보기·이야기를 빼라. 질문이 넓으면 과목 카드(그 학과에 맞는 과목 3개 + 진로로 찾기 + 다른 과목) 하나만, 과목·진로·방향이 이미 있으면 바로 주제 3개를 제안하라. 학과를 모를 때만 학과 입력 카드를 낸다." });
            continue;
          }
          const dept = await deptOf(db, user.id, user.user_metadata ?? {});
          // 카드 안의 '지난번 …' 보기만 빼고, 보기가 하나도 안 남으면 학과 입력 카드로
          answer = answer.replace(/\[\[\s*질문:([^\]]*)\]\]/, (whole: string, inner: string) => {
            const parts = inner.split("|").map((x: string) => x.trim());
            const q = parts.shift() ?? "";
            const opts = parts.filter((o: string) => !/지난번|이어서/.test(o));
            if (/지난번/.test(q) || opts.length < 2) return `[[입력: 어떤 학과로 찾을까요? | ${dept ? `학과=${safe(dept, 30)}` : "학과"} | 과목 (선택)]]`;
            return `[[질문: ${q} | ${opts.join(" | ")}]]`;
          });
        }
        break;
      }
      if (!quick) await logUsage(db, user.id, inT, outT, !!answer);
      // 해 줄까요? 카드 — 이번에 제안한 것만 남기고, 빠뜨렸으면 맨 끝에 붙인다
      if (answer) {
        answer = answer.replace(/\[\[\s*할일\s*[:：]\s*(\d+)\s*\]\]/g, (w: string, id: string) => (proposed.includes(Number(id)) ? `[[할일:${id}]]` : "")).trim();
        for (const id of [...new Set(proposed)].slice(0, 2)) if (!answer.includes(`[[할일:${id}]]`)) answer += `\n\n[[할일:${id}]]`;
        // 공부법 진단 카드(과목 · 많이 틀리는 단원)에 답했는데 물꼬가 효과 시험 제안을 빠뜨렸으면 — 서버가 대신 붙인다
        //   (AI가 도구를 부를 때도 있고 안 부를 때도 있어서, 진단 답 뒤에는 늘 '효과 시험 만들기' 카드가 나오게)
        if (!proposed.length && !/\[\[\s*할일/.test(answer)) {
          const fv = (k: string) => (message.match(new RegExp(`${k}\\s*[:：=]\\s*([^\\n]+)`))?.[1] ?? "").trim();
          const subjRaw = fv("과목"), unit = fv("많이\\s*틀리는\\s*단원");
          const subject = TEST_SUBJECTS.includes(subjRaw) ? subjRaw : (SUBJ.find(([re]) => re.test(subjRaw))?.[1] ?? "");
          if (subject && TEST_SUBJECTS.includes(subject) && unit.length >= 2 && !/^(없|모름|몰라)/.test(unit)) {
            const r: any = await proposeAction(db, user.id, { kind: "study_test", subject, unit }).catch(() => null);
            if (r?.proposed) answer += `\n\n이 공부법이 나한테 맞는지 확인해 볼까요? 지금 ${subject} '${clean(unit, 40)}' 10문제를 풀고, 일주일 뒤 비슷한 문제로 다시 풀어서 점수를 비교해요.\n\n[[할일:${r.id}]]`;
            else if (r?.already) answer += `\n\n${subject} 효과 시험은 이미 진행 중이에요. 학습 플랜(/plan) ${subject} 탭에서 이어서 풀어요.`;
          }
        }
        // 고2 · 고3 인데 지난 학년 활동이 생기부 노트에 하나도 없으면 — 탐구 · 로드맵 · 학과 · 생기부 질문 답 끝에 노트 버튼 (대화마다 한 번)
        {
          const gs = student.match(/\[학년 상태\] 고([23])[^\n]*지난 학년\([^)]*\) 생기부 노트 활동 (\d+)개/);
          const asked = /탐구|주제|세특|로드맵|플랜|학과|진로|생기부|동아리|활동|추천/.test(message);
          const shown = history.some((h: any) => /\[\[\s*노트\s*\]\]/.test(h.content ?? ""));
          if (gs && gs[2] === "0" && asked && !shown && !/\[\[\s*(노트|입력|질문)/.test(answer)) {
            answer += `\n\n고${Number(gs[1]) - 1 === 1 ? "1" : "1·고2"} 때 한 활동을 생기부 노트에 적어 두면, 다음부터 그 활동에 이어지는 탐구 · 세특 · 로드맵으로 맞춰 드려요.\n[[노트]]`;
          }
        }
        // 면접 기출 · 생기부 예상질문을 물었는데 면접 준비 버튼을 빠뜨렸으면 — 붙인다 (기출문제는 /prep 에서 연습)
        if (/기출|예상\s*질문|면접\s*질문/.test(message) && !/\[\[\s*(면접준비|입력|질문)/.test(answer)) { // 되묻는 카드가 있는 답에는 안 붙인다
          answer += "\n\n지원 대학 면접 기출문제는 수시 면접 준비에서 학교별로 연습할 수 있어요.\n[[면접준비]]";
        }
        // 선배 사례를 보여 줬으면 — 원본 보기 버튼 + 기록 (다음 날 다시 오는지 보려고)
        if (seniorShown > 0) {
          if (!/\[\[\s*선배\s*\]\]/.test(answer)) answer += "\n\n[[선배]]";
          await db.from("senior_events").insert({ user_id: user.id, cases: seniorShown }).then(() => {}, () => {});
        }
      }
      if (!answer) return { status: 502, body: { error: "답을 만들지 못했어요. 잠시 뒤 다시 물어봐 주세요" } };

      emit(/\[\[\s*질문/.test(answer) ? "물어볼 것 고르는 중" : "답 정리하는 중");
      const now = new Date().toISOString();
      const saved = [...((chatRow?.messages ?? []) as any[]), { role: "user", content: message, at: now }, { role: "assistant", content: answer, at: now }];
      let chatId = chatRow?.id;
      if (chatId) {
        await db.from("agent_chats").update({ messages: saved, updated_at: now }).eq("id", chatId);
      } else {
        const { data: row, error } = await db.from("agent_chats").insert({ user_id: user.id, title: message.slice(0, 40), messages: saved }).select("id").single();
        if (error) throw error;
        chatId = row.id;
      }
      // 물꼬 노트 고치기 — 답을 먼저 보내고 뒤에서 (기다리지 않게)
      const memJob = updateMemory(db, user.id, message, answer).catch((e) => console.error("memory", e));
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(memJob); else await memJob;
      return { status: 200, body: { chat_id: chatId, answer, usage: await usageOf(db, user.id, paid) } };
    };

    if (!body.stream) {
      const r = await work(() => {});
      return json(r.body, r.status);
    }
    // 한 줄씩(JSON) 흘려보낸다: {"step":"…"} … 마지막에 {"status":200,"result":{…}}
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          const r = await work((t) => send({ step: t }));
          send({ status: r.status, result: r.body });
        } catch (e) {
          console.error(e);
          send({ status: 500, result: { error: "잠시 문제가 생겼어요. 다시 시도해 주세요" } });
        }
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { ...cors, "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
  } catch (e) {
    console.error(e);
    return json({ error: "잠시 문제가 생겼어요. 다시 시도해 주세요" }, 500);
  }
});