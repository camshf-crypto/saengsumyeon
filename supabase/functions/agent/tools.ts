// agent/tools.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { passUntil } from "../_shared/pass.ts";
import { ALIAS, FREE_OPEN, clean, json, matchUniv, univList } from "./core.ts";
import { findSeniors } from "./extra.ts";
import { evalSchoolName, evalSubjects, evalTasks, gradeOf, nameKey, schoolMeta } from "./school.ts";
import { proposeAction } from "./study.ts";


/* ───────── 도구: AI가 필요할 때 DB에서 찾는다 */
export const TOOLS = [
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
  {
    type: "function",
    function: {
      name: "school_eval",
      description: "학생 학교의 교과별 평가계획(학교가 공개한 교수·학습 및 평가 운영 계획)을 가져온다. 과목별 중간·기말·수행평가 반영 비율, 시험 문항 구성, 수행평가 영역(제목·단원·성취기준·평가 방법·시기·배점·채점 기준표·유의 사항), 성취도 기준, 교재. 수행평가 · 내신 시험 · 세특 · 과목 공부 계획 질문이면 먼저 부른다. 과목을 비우면 그 학년 전 과목 요약.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "과목 이름 일부 (예: 공통국어2, 화학, 미적분). 비우면 전 과목 요약" },
          grade: { type: "integer", description: "학년 1~3. 비우면 학생 학년" },
          school: { type: "string", description: "다른 학교를 물을 때만 (예: 휘문고등학교). 비우면 학생 학교" },
        },
      },
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

/* 이용권 또는 관리자인가 — 이용권 전용 기능(예상질문 · 꼬리질문 · 기출 피드백) 확인용 */
// 카드 보기 안에 넣는 글 — 카드를 깨는 글자(| [ ])를 빼고 짧게
const cardText = (v: unknown, n = 70) => clean(String(v ?? "").replace(/[|[\]]/g, " ").replace(/\s+/g, " "), n);
export async function passOrAdmin(db: any, userId: string) {
  if (await passUntil(db, userId)) return true;
  const { data } = await db.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/* 생수면의 다른 서버 기능(진단)을 학생 로그인 그대로 부른다 */
export async function callFn(fn: string, body: unknown, token: string, pass = false) {
  // 서버 쪽 일시 오류(5xx · 연결 끊김)면 1.5초 뒤 한 번 더 — 학생에게 "서버 오류"를 덜 보이게 (횟수 초과 · 입력 오류 같은 4xx 는 다시 안 함)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fn}`, {
        method: "POST",
        // x-agent-key: 이 기능의 무료 횟수 대신 에이전트 주간 사용량(토큰)으로 계산하라는 표시 (서버끼리만)
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "x-agent-key": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", "x-agent-pass": pass ? "1" : "0" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status >= 500 && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (!res.ok && !data?.error) return { error: "진단하지 못했어요. 잠시 뒤 다시 해 주세요" };
      return data;
    } catch (e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      console.error("callFn", fn, e);
      return { error: "진단하지 못했어요. 잠시 뒤 다시 해 주세요" };
    }
  }
  return { error: "진단하지 못했어요. 잠시 뒤 다시 해 주세요" };
}

/* 진단 결과에서 답에 필요한 것만 (너무 길면 AI 비용만 늘어남) */
export function slimCheck(kind: string, r: any) {
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
export const VERDICTS: Record<string, string[]> = {
  topic: ["흔하지 않은 주제예요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"],
  motive: ["나만의 지원동기예요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"],
  reading: ["드문 편이에요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"],
};
export const lvOf = (score: number) => (score >= 85 ? 4 : score >= 65 ? 3 : score >= 40 ? 2 : score >= 15 ? 1 : 0);
export function formatCheck(kind: string, r: any, args: any) {
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
      L.push("", `오늘 남은 탐구주제 흔한가: ${r.today_left}번${r.bonus_left ? ` · 추가 ${r.bonus_left}번` : ""}`);
    }
    // 진단에서 끝나지 않게 — 바로 탐구 설계로 (학년 · 이전 활동 맞춤 3개 → 보고서 · PPT · 발표)
    L.push("", "이 주제로 탐구 보고서까지 같이 만들 수 있어. 어떤 주제로 할지 골라 줘.",
      // 쉬운 말로 (2026-11-06) — 예전 말('이 주제로 뭘 할까?' · '바꾼 주제로 탐구 설계하기')도 tamgu.ts · router.ts 가 그대로 알아듣는다
      // 보기마다 실제 주제를 적어 둔다 — 무엇으로 시작하는지 헷갈리지 않게 (카드 글자 '|' ']' 는 빼기)
      `[[질문: 이제 뭘 할까? | ${[r.better_topic ? `추천 주제로 탐구하기 — ${cardText(r.better_topic)}` : "", `내 주제로 탐구하기 — ${cardText(r.topic || args?.topic) || "내가 쓴 주제 그대로"}`, "다른 주제 진단하기 — 새 주제가 흔한지 보기"].filter(Boolean).join(" | ")}]]`);
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

export const SEUL = { 고1: "고1", 고2: "고2", 고3: "고3" } as Record<string, string>;
// 탐구주제 흔한가 하루 횟수를 다 썼을 때 — 결제 안내 없이, 오늘 이어서 할 수 있는 것으로
export const TOPIC_QUOTA_MSG = "**오늘 탐구주제 흔한가 2번을 다 썼어요.** 새벽 5시에 다시 2번이 열려요.\n\n오늘은 이미 진단한 주제로 탐구 설계를 이어 가거나, 수행평가 · 공부법 · 입시 질문을 계속 할 수 있어요.\n[[질문: 이어서 뭘 할까? | 진단한 주제로 탐구 설계하기 | 수행평가 하기 | 다른 질문 하기]]";

export const pick = (r: any, keys: string[]) => Object.fromEntries(keys.filter((k) => r[k] !== null && r[k] !== "" && r[k] !== undefined).map((k) => [k, r[k]]));

// 공부법 카드 고르기 (sm_90 study_tips) — 과목·분야가 맞는 것 중 추천 많은 순, 학년·성적대·내신/수능이 맞으면 앞으로
export async function findStudyTips(db: any, args: any, n = 8) {
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

export async function runTool(db: any, userId: string, name: string, args: any, token = "", paid = false) {
  if (name === "propose_action") return proposeAction(db, userId, args);
  if (name === "find_seniors") return findSeniors(db, args);
  if (name === "interview_questions") {
    if (!(await passOrAdmin(db, userId))) return { paywall: true, note: "생기부 예상질문은 이용권 전용이에요. 질문을 지어내지 말고, 이용권이면 대학 6곳 예상질문을 받을 수 있다고 짧게 안내한 뒤 답 끝에 [[이용권]]을 붙인다" };
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
      note: "채팅에서는 활동 4개까지 써요. 생기부 전체 활동으로 대학 6곳 질문과 PDF까지 받으려면 생기부 예상질문 화면(/interview)에서 해요",
    };
  }
  if (name === "tail_practice") {
    if (!FREE_OPEN && !(await passOrAdmin(db, userId))) return { paywall: true, note: "꼬리질문 연습은 이용권 전용이에요. 꼬리질문을 지어내지 말고, 이용권이면 무제한으로 연습할 수 있다고 짧게 안내한 뒤 답 끝에 [[이용권]]을 붙인다" };
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
  if ((name === "check_topic" || name === "check_reading") && !SEUL[clean(args?.grade, 3)]) {
    const g = await gradeOf(db, userId).catch(() => "");
    if (SEUL[g]) args = { ...args, grade: g };
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
  if (name === "school_eval") {
    const mine = await schoolMeta(db, userId);
    const want = clean(args?.school, 40) || mine.school;
    if (!want) return { no_school: true, note: "학생 학교를 몰라요. 어느 학교인지 물어본다 (학교를 알려 주면 그 학교 평가계획으로 답할 수 있다고)" };
    const name = await evalSchoolName(db, want);
    if (!name) return { no_data: true, school: want, note: "이 학교 평가계획은 아직 생수면에 없어요. 지어내지 말고 없다고 말한 뒤, 일반적인 수행평가 · 시험 준비 방법으로 돕는다 (학교 평가계획은 계속 추가 중)" };
    const gnum = Number(args?.grade) || Number(String(await gradeOf(db, userId)).match(/[123]/)?.[0] ?? 0);
    const { rows, current } = await evalSubjects(db, name, gnum);
    if (!rows.length) return { no_data: true, school: name, grade: gnum, note: `${name} ${gnum}학년 자료는 아직 없어요` };
    const r0 = rows[0];
    const head = { school: name, grade: r0.grade, year: r0.year, semester: r0.semester, current_term: current, source: r0.source };
    const sk = nameKey(args?.subject);
    if (!sk) {
      const tasks = await evalTasks(db, rows.map((r: any) => r.id));
      return {
        ...head,
        subjects: rows.map((r: any) => ({
          subject: r.subject, kind: r.kind ?? undefined, exam_mid: r.exam_mid, exam_final: r.exam_final, perf_total: r.perf_total,
          tasks: tasks.filter((t: any) => t.subject_id === r.id).map((t: any) => ({ title: clean(t.title, 60), points: t.points, period: clean(t.period, 30), methods: t.methods })),
        })),
      };
    }
    const hit = rows.filter((r: any) => nameKey(r.subject).includes(sk) || sk.includes(nameKey(r.subject)));
    if (!hit.length) return { ...head, not_found: args.subject, subjects: rows.map((r: any) => r.subject), note: "그 과목이 이 학년 목록에 없어요. 비슷한 과목을 고르게 하거나 학생에게 확인한다" };
    const tasks = await evalTasks(db, hit.map((r: any) => r.id), true);
    return {
      ...head,
      subjects: hit.slice(0, 3).map((r: any) => ({
        ...pick(r, ["subject", "kind", "exam_mid", "exam_final", "perf_total", "essay_total", "exam_detail", "grading", "notes", "books"]),
        tasks: tasks.filter((t: any) => t.subject_id === r.id).map((t: any) => pick(t, ["title", "unit", "standards", "methods", "period", "months", "points", "rubric", "memo"])),
      })),
    };
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