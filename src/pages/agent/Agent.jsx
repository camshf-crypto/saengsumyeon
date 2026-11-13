import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import LoginGate from "../../components/LoginGate";
import AdSlot from "../../components/AdSlot";
import { refLink } from "../../lib/referral";
import UpgradeModal from "../../components/UpgradeModal"; // 업그레이드 팝업 → 요금제 화면(/pricing)에서 결제
import { PASS_PRICE, PASS_PRODUCTS } from "../../lib/pass";
import { track } from "../../lib/track";
import { STYLES, PALETTES, recommend, buildDeck } from "../../lib/speechDeck"; // 발표 PPT (pptxgenjs 는 PptButton 에서 누를 때만 불러옴)
import PracticeRoom from "./PracticeRoom"; // 발표 연습 화면 (위 슬라이드 · 아래 대본 · 녹음)

/*
 * 🤖 입시 상담 AI — /agent
 *   대학 입시 DB(모집요강·시행계획·입결·면접 스타일) + 내 생수면 기록(생기부 노트·진단·예상질문·지원동기·성적)을 보고 답한다
 *   사용량: 질문 개수가 아니라 실제 AI 비용으로 센다 — '이번 주 사용량 ○%' 막대 + 초기화 시각(매주 월요일 0시)
 *   무료 회원: 주간 한도 · 답 아래 광고 · 친구 초대 보너스 없음 (다 쓰면 이용권으로)
 *   · 무료로 받은 답 2개마다 그 아래에 광고 카드(AdSlot variant=card · home_top 광고를 같이 씀 · 답마다 다른 업체)
 *   이용권(한 달·6개월·1년 — src/lib/pass.js PLANS)이 있으면 사용량 크게 · 광고 없음
 *   대화는 agent_chats 에 저장 — 왼쪽 대화 목록(휴대폰은 '대화 목록' 버튼)에서 다시 연다 · 주소 ?c=번호 로 새로고침해도 이어짐
 *   이용권 한 달 10,900원 · 1년 79,000원 — 계좌 입금 → '입금했어요' → 관리자 승인되면 바로 열림 (rpc agent_order, components/PassSheet)
 *   면접 예상질문 · 꼬리질문은 처음 화면 타일에서 뺐다 — 수시 면접 준비(/prep)에서 한다
 *   에이전트 (sql/sm_96): 물꼬가 기억하는 나(물꼬 노트 — 대화마다 물꼬가 스스로 고침) · 해 줄까요? 카드 [[할일:번호]] (면접 준비에 학교 넣기 · 효과 시험 만들기)
 * DB: sql/sm_76 · sm_77 · sm_78_agent.sql · sm_80_agent_order.sql · 서버 함수: supabase/functions/agent
 */

// 2026-11-06 사용자 모으기 — 물꼬 안 유료 기능 무료 (서버 agent/core.ts FREE_OPEN 과 같이 바꾼다)
//   결제 안내 · 요금제 팝업을 띄우지 않는다 · 무료 사용량은 그대로 (새벽 5시에 다시) · 생기부 예상질문만 [[이용권]]
const FREE_OPEN = true;
const NAVY = "#1E2A5A";
const PINK = "#FD1673";
const WIDTH = "mx-auto max-w-2xl px-4 sm:px-5";
/* 학년 달력 — 첫 화면 '이번 달에 많이 묻는 것' 3개 (서버 index.ts SEASON 과 같은 흐름) */
const SEASON_Q = {
  고1: { "1-2": ["희망 계열 찾는 방법 알려 줘", "고1 겨울방학에 읽을 입문 책 추천해 줘", "고1 올라가기 전에 뭐 준비해?"], "3": ["고1 1년 로드맵 짜 줘", "동아리 어떻게 골라?", "고1 첫 학기에 뭐부터 해야 해?"], "4-5": ["수행평가 같이 완성해 줘", "첫 탐구 보고서 써 보고 싶어", "중간고사 공부법 알려 줘"], "6-7": ["1학기 활동 생기부 노트에 정리하는 법", "기말 공부법 알려 줘", "여름방학에 할 탐구 추천해 줘"], "8": ["방학에 읽을 책 추천해 줘", "방학 탐구 보고서 하나 완성해 줘", "2학기 준비 뭐 해?"], "9": ["2학기 탐구 보고서 같이 완성해 줘", "수행평가 같이 완성해 줘", "수행평가 주제 잡는 법"], "10-11": ["수행평가 같이 완성해 줘", "중간고사 공부법 알려 줘", "고1인데 지금 뭐 해야 해?"], "12": ["고1 1년 기록 정리해 줘", "고2 때 뭐 해야 해?", "기말 공부법 알려 줘"] },
  고2: { "1-2": ["고1 활동 이어서 고2 탐구 방향 잡아 줘", "고2 올라가기 전에 뭐 준비해?", "겨울방학 독서 추천해 줘"], "3": ["선택과목 내 학과에 맞아?", "고2 1년 로드맵 짜 줘", "고2 때 꼭 해야 할 것"], "4-5": ["세특 탐구 보고서 같이 완성해 줘", "수행평가 같이 완성해 줘", "중간고사 공부법 알려 줘"], "6-7": ["1학기 탐구 보고서 심화하기", "기말 공부법 알려 줘", "여름방학 심화 탐구 추천해 줘"], "8": ["여름방학 심화 탐구 보고서 완성해 줘", "학과 관련 책 추천해 줘", "2학기 세특 방향 잡아 줘"], "9": ["2학기 세특 탐구 보고서 완성해 줘", "수행평가 같이 완성해 줘", "진로랑 이어지는 활동 뭐 해?"], "10-11": ["탐구 보고서 마무리해 줘", "수행평가 같이 완성해 줘", "고2인데 지금 뭐 해야 해?"], "12": ["고2 1년 기록 정리해 줘", "고3 1년 계획 짜 줘", "기말 공부법 알려 줘"] },
  고3: { "1-2": ["내 내신으로 갈 수 있는 대학 알려 줘", "내 생기부 점검해 줘", "수시 지원 전략 어떻게 세워?"], "3": ["생기부 예상질문 뽑아 줘", "내 생기부로 학종 쓰기 좋은 학교", "고3 1년 계획 짜 줘"], "4-5": ["마지막 수행평가 같이 완성해 줘", "내 내신으로 갈 수 있는 대학 알려 줘", "수시 지원 전략 어떻게 세워?"], "6-7": ["수시 6장 어떻게 정해?", "내 내신으로 갈 수 있는 대학 알려 줘", "수능 최저 없는 학종 찾아 줘"], "8": ["지원 동기 정리 도와줘", "면접 준비 어떻게 시작해?", "생기부 예상질문 뽑아 줘"], "9": ["지원한 대학 면접 스타일 알려 줘", "생기부 예상질문 뽑아 줘", "면접 꼬리질문 연습하고 싶어"], "10-11": ["면접 예상질문 뽑아 줘", "면접 꼬리질문 연습하고 싶어", "수능 전 공부법 알려 줘"], "12": ["면접 마지막 점검", "정시 입결 알려 줘", "내 성적으로 정시 갈 수 있는 곳"] },
};
const seasonKey = (m) => (m <= 2 ? "1-2" : m === 3 ? "3" : m <= 5 ? "4-5" : m <= 7 ? "6-7" : m === 8 ? "8" : m === 9 ? "9" : m <= 11 ? "10-11" : "12");

/* 처음 화면 — 물꼬가 할 수 있는 일 (누르면 그 기능 예시 질문을 바로 보냄) */
const FEATURES = [
  { title: "모집요강·입결", desc: "37개 대학 2027·2028 전형·수능최저 · 일부 대학 입결", q: "경희대 2027이랑 2028 뭐가 달라져?" },
  { title: "흔한가 진단", desc: "내 탐구주제·지원동기·독서가 얼마나 흔한지", q: "내 탐구주제 흔한가 진단해 줘" },
  { title: "내 생기부 맞춤", desc: "내 생기부(로드맵)를 보고 학교·전형 추천", q: "내 생기부로 학종 쓰기 좋은 학교 추천해 줘" },
  { title: "학습법", desc: "성적·많이 틀리는 단원으로 내 공부법 진단 · 루틴 짜기", q: "내 공부법 진단해 줘" },
  { title: "세특·독서", desc: "희망 학과에 맞는 세특 방향 · 이어 읽을 책 추천", q: "내 학과에 맞는 세특 방향이랑 읽을 책 추천해 줘" },
  { title: "입시 플랜", desc: "목표 대학·학과로 과목·활동·이번 주 미션까지", q: "내 입시 플랜 짜 줘" },
  { title: "권장과목", desc: "29개 대학이 발표한 학과별 들어야 할 과목", q: "컴퓨터공학과 가려면 고등학교 때 무슨 과목 들어야 돼?" },
  { title: "탐구주제", desc: "학과별 실제 탐구 사례로 내 주제 찾기", q: "탐구주제 찾아 줘" },
  { title: "수행평가", desc: "과목 양식에 맞춰 수행평가 준비 돕기", soon: true },
];
// 수행평가는 준비 중 — 타일을 누르거나 채팅으로 물으면 서버에 보내지 않고 바로 안내 (AI 비용 없음)
//   '수행평가 주제' · '수행평가 탐구'처럼 주제를 찾는 질문은 그대로 물꼬가 답한다 (탐구주제로 돕기)
const EXAMPLES = [
  "간호학과 합격 선배는 고1 때 뭐 했어?",
  "내 생기부로 학종 쓰기 좋은 학교 추천해 줘",
  "수학 미적분 어떻게 공부해야 돼?",
  "수능최저 없는 학종으로 컴퓨터공학과 뽑는 학교 알려 줘",
  "경희대 2027이랑 2028 뭐가 달라져?",
  "연세대 경영학과 작년 입결 알려 줘",
  "지역균형 전형 있는 학교들 최저 비교해 줘",
];

/* ─── 답변 글 보여 주기: **굵게** · - 목록 · | 표 | 정도만 */
function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={i} className="text-gray-900">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
}
/* AI가 맨 끝에 붙인 질문 카드를 떼어 낸다
 *   [[질문: 질문 | 보기 — 설명 | 보기 — 설명]]  (여러 개면 1/2, 2/2 로 넘기며 답함)
 *   예전 형식 [[선택지: A | B]] 도 질문 없는 카드로 읽는다 */
function splitChoices(text) {
  const t = String(text ?? "");
  const qs = [];
  const body = t.replace(/\[\[\s*(질문|선택지)\s*[:：]\s*([^\]]+)\]\]/g, (_, kind, inner) => {
    const parts = inner.split("|").map((x) => x.trim()).filter(Boolean);
    const q = kind === "질문" ? parts.shift() : "";
    const opts = parts.slice(0, 6).map((o) => { const [label, ...d] = o.split(/\s+[—–-]\s+/); return { label: label.trim(), desc: d.join(" — ").trim() }; });
    if (opts.length) qs.push({ q, opts });
    return "";
  }).trim();
  // 직접 적는 칸: [[입력: 제목 | 학과=간호학과 | 과목 | 대학 (선택)]] — '=' 뒤는 미리 채워 둘 값
  let form = null;
  const rest = body.replace(/\[\[\s*입력\s*[:：]\s*([^\]]+)\]\]/g, (_, inner) => {
    const parts = inner.split("|").map((x) => x.trim()).filter(Boolean);
    const title = parts.shift() || "아래 칸을 채워 주세요";
    const fields = parts.slice(0, 5).map((f) => {
      const [name, ...v] = f.split("=");
      const optional = /\(선택\)/.test(name);
      let value = v.join("=").trim();
      if (value.length < 25 && /^[(（…]|^\.\.\.|모르면|비워|비움/.test(value)) value = ""; // AI가 안내 글을 그대로 넣었으면 비운다
      value = value.replace(/＝/g, "=");
      return { name: name.replace(/\(선택\)/, "").trim(), value, optional };
    }).filter((f) => f.name);
    if (!form && fields.length) form = { title, fields };
    return "";
  }).trim();
  const pass = /\[\[\s*이용권\s*\]\]/.test(rest);
  const invite = /\[\[\s*친구초대\s*\]\]/.test(rest);
  // 자료가 없는 대학 — [[대학요청: 대학 | 학과]] → 추가 요청 설문 카드
  let univReq = null;
  const rest2 = rest.replace(/\[\[\s*대학요청\s*[:：]?\s*([^\]]*)\]\]/g, (_, inner) => {
    const [u = "", d = ""] = inner.split("|").map((x) => x.trim());
    if (!univReq) univReq = { university: u, department: d };
    return "";
  });
  const plan = /\[\[\s*플랜\s*\]\]/.test(rest2);
  const routine = /\[\[\s*루틴저장\s*\]\]/.test(rest2);
  // 물꼬가 제안한 일 — [[할일:번호]] → 해 줄까요? 카드
  const senior = /\[\[\s*선배\s*\]\]/.test(rest2); // 선배 사례를 보여 준 답 → 원본 보기 버튼
  const prep = /\[\[\s*면접준비\s*\]\]/.test(rest2); // 면접 기출 · 예상질문 → 수시 면접 준비(/prep) 버튼
  const note = /\[\[\s*노트\s*\]\]/.test(rest2); // 지난 학년 활동이 없을 때 → 생기부 노트(/my/note) 버튼
  const voice = /\[\[\s*건의함\s*\]\]/.test(rest2); // 없는 자료 → 생수면 의견함(/voice) 버튼
  const suhaeng = /\[\[\s*수행평가\s*\]\]/.test(rest2);
  const tamgu = /\[\[\s*탐구설계\s*\]\]/.test(rest2); // 탐구 이야기 → 탐구 설계 시작 버튼 (주제 정하기 → 질문 → 쪽수 · 양식 → 완성본 → 보고서 디자인) // 수행평가 하나를 끝까지 → 수행평가 완성(/suhaeng) 버튼
  const designTask = Number(rest2.match(/\[\[\s*디자인\s*[:：]\s*(\d+)\s*\]\]/)?.[1] ?? 0); // 완성본 → 보고서 디자인하러 가기 (DesignGo)
  const reportId = Number(rest2.match(/\[\[\s*보고서디자인\s*[:：]\s*(\d+)\s*\]\]/)?.[1] ?? 0); // 완성본 → 탐구보고서 디자인(/inquiry/:id/report) 버튼
  const practiceTask = Number(rest2.match(/\[\[\s*연습화면\s*[:：]\s*(\d+)\s*\]\]/)?.[1] ?? 0); // 발표 연습 화면 열기 버튼
  const docM = rest2.match(/\[\[\s*문서\s*[:：]\s*(\d+)\s*\|\s*(hwp|docx|pdf)\s*\]\]/); // 완성본 → 한글 · 워드 · PDF (DocButton)
  const docFile = docM ? { id: Number(docM[1]), kind: docM[2] } : null;
  const pptTask = Number(rest2.match(/\[\[\s*PPT\s*[:：]\s*(\d+)\s*\]\]/)?.[1] ?? 0); // 발표 대본 → PPT 받기 버튼 (PptButton)
  const speech = Number(rest2.match(/\[\[\s*발표연습\s*[:：]\s*(\d+)\s*\]\]/)?.[1] ?? 0); // 발표 연습 카드 (분) → SpeechCard
  const schoolChg = /\[\[\s*학교바꾸기\s*\]\]/.test(rest2); // 학교 · 학년이 다를 때 → 학교 바꾸기 창 (components/SchoolGate)
  const acts = [...new Set([...rest2.matchAll(/\[\[\s*할일\s*[:：]\s*(\d+)\s*\]\]/g)].map((x) => Number(x[1])))].slice(0, 3);
  return { body: rest2.replace(/\[\[\s*할일\s*[:：]\s*\d+\s*\]\]/g, "").replace(/\[\[\s*(이용권|친구초대|플랜|루틴저장|선배|면접준비|노트|건의함|수행평가|학교바꾸기|탐구설계)\s*\]\]/g, "").replace(/\[\[\s*발표연습\s*[:：]\s*\d+\s*\]\]/g, "").replace(/\[\[\s*PPT\s*[:：]\s*\d+\s*\]\]/g, "\n@@PPT@@\n").replace(/\[\[\s*문서\s*[:：][^\]]*\]\]/g, "").replace(/\[\[\s*연습화면\s*[:：]\s*\d+\s*\]\]/g, "").replace(/\[\[\s*보고서디자인\s*[:：]\s*\d+\s*\]\]/g, "").replace(/\[\[\s*디자인\s*[:：]\s*\d+\s*\]\]/g, "").trim(), questions: qs.slice(0, 3), pass, form, invite, univReq, plan, routine, acts, senior, prep, note, voice, suhaeng, schoolChg, speech, pptTask, docFile, practiceTask, reportId, designTask, tamgu };
}

/* 입력 카드 — 원래 흔한가 화면처럼 학과·과목·주제를 직접 적어서 한 번에 보낸다 */
const HINT = {
  학년: "고1 · 고2 · 고3",
  학과: "예: 간호학과",
  과목: "예: 생명과학",
  탐구주제: "예: 노인 낙상 사고를 줄이는 병실 환경 조사",
  대학: "예: 가천대 · 안 정했으면 비워 두세요",
  지원동기: "지원동기를 30자 이상 그대로 붙여 넣어 주세요",
  자기소개: "면접에서 말할 자기소개를 그대로 붙여 넣어 주세요 (30자 이상)",
  "책 제목": "예: 이기적 유전자",
  저자: "예: 리처드 도킨스 · 몰라도 돼요",
  활동: "예: 생명과학 효소 실험 보고서 / 보건 동아리 / 내신 2.8 — 한 것을 생각나는 대로",
  "면접 질문": "예: 효소 실험에서 가장 어려웠던 점은 무엇인가요?",
  "내 답변": "실제 면접에서 말하듯 15자 이상 적어 주세요",
  성적: "예: 모의고사 4등급 · 내신 3등급 · 70점",
  "많이 틀리는 단원": "예: 미적분 극한 · 비문학 과학 지문 · 모르겠으면 '모름'",
  "틀리는 이유": "아래에서 고르거나 직접 적어요",
  "지금 공부 방법": "예: 인강 듣고 문제집 1권 · 하루 1시간 · 오답은 답만 확인",
};
// 고르기만 해도 되는 칸 — 눌러서 넣고 빼기 (여러 개 가능)
const CHIPS = {
  "틀리는 이유": ["개념을 잘 몰라요", "알았는데 실수해요", "시간이 모자라요", "문제를 잘못 읽어요", "외워도 까먹어요", "어디서 틀리는지 몰라요"],
};
const LONG = /지원동기|자기소개|탐구주제|주제|활동|면접 질문|내 답변|지금 공부 방법|안내문/;
const MIN = (name) => (/지원동기|자기소개/.test(name) ? 30 : /내 답변/.test(name) ? 15 : 1);
function InputCard({ form, onSubmit, onClose, onPhotos, uploading = false }) {
  const isNotice = /수행평가 안내문/.test(form.title); // 수행평가 안내문 카드 — 사진 · PDF로도 올릴 수 있다
  const [vals, setVals] = useState(() => form.fields.map((f) => f.value));
  const minOf = (f) => MIN(f.name);
  const ok = form.fields.every((f, k) => f.optional || vals[k].trim().length >= minOf(f));
  function submit() {
    if (!ok) return;
    onSubmit(form.fields.map((f, k) => `${f.name}: ${vals[k].trim() || "없음"}`).join("\n"));
  }
  return (
    <div className="mt-2 rounded bg-white p-4 shadow-sm ring-1 ring-black/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14.5px] font-extrabold text-gray-900">{form.title}</p>
        <button onClick={onClose} className="text-[20px] leading-none text-gray-400" aria-label="닫기">×</button>
      </div>
      <div className="mt-3 grid gap-2.5">
        {form.fields.map((f, k) => {
          const long = LONG.test(f.name);
          const Tag = long ? "textarea" : "input";
          const n = vals[k].trim().length;
          return (
            <label key={f.name} className="block">
              <span className="mb-1 flex items-baseline gap-1.5 text-[12.5px] font-bold text-gray-700">
                {f.name}
                {f.optional && <small className="font-medium text-gray-400">선택</small>}
                {MIN(f.name) > 1 && <small className={`ml-auto font-medium ${n >= MIN(f.name) ? "text-gray-400" : "text-[#C2410C]"}`}>{n}/{MIN(f.name)}자 이상</small>}
              </span>
              <Tag
                value={vals[k]}
                rows={long ? (/지원동기|자기소개|내 답변|활동|안내문/.test(f.name) ? 5 : 2) : undefined}
                onChange={(e) => setVals((v) => v.map((x, j) => (j === k ? e.target.value.slice(0, /안내문/.test(f.name) ? 3000 : /지원동기|자기소개|내 답변|활동/.test(f.name) ? 1200 : 300) : x)))}
                onKeyDown={(e) => { if (!long && e.key === "Enter" && !e.nativeEvent.isComposing) submit(); }}
                placeholder={HINT[f.name] ?? ""}
                className="w-full resize-none rounded bg-[#F8F9FB] px-3 py-2 text-[13.5px] leading-relaxed text-gray-900 outline-none ring-1 ring-transparent placeholder:text-gray-400 focus:ring-gray-300"
              />
              {CHIPS[f.name] && (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {CHIPS[f.name].map((c) => {
                    const list = vals[k].split(/\s*,\s*/).filter(Boolean);
                    const on = list.includes(c);
                    return (
                      <button type="button" key={c}
                        onClick={() => setVals((v) => v.map((x, j) => (j === k ? (on ? list.filter((y) => y !== c) : [...list, c]).join(", ") : x)))}
                        className={`rounded px-3 py-1.5 text-[12.5px] font-bold ring-1 ${on ? "text-white ring-transparent" : "bg-white text-gray-600 ring-gray-200"}`}
                        style={on ? { background: NAVY } : undefined}>{c}</button>
                    );
                  })}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {isNotice && onPhotos && (
        // 안내문이 사진이면 — 과목은 위 칸에 적은 대로 같이 보낸다
        <label className={`mt-3 flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded border-2 border-dashed border-gray-200 text-[13.5px] font-bold text-gray-600 hover:border-sm-orange ${uploading ? "pointer-events-none opacity-50" : ""}`}>
          {uploading ? "올리는 중…" : "사진 · PDF로 올리기 (여러 장 가능)"}
          <input type="file" accept="image/*,application/pdf" multiple className="hidden"
            onChange={(e) => { const subj = vals[form.fields.findIndex((f) => /과목/.test(f.name))]?.trim(); onPhotos(e, subj ? `과목: ${subj}` : ""); }} />
        </label>
      )}
      <button onClick={submit} disabled={!ok} className="mt-2 h-11 w-full rounded text-[14px] font-extrabold text-white disabled:opacity-30" style={{ background: NAVY }}>
        {isNotice ? "글로 보내기" : "보내기"}
      </button>
    </div>
  );
}

/*
 * 학습 다이어리에 넣기 — 물꼬가 짠 하루 · 주간 루틴을 /plan 다이어리로 (sql/sm_91 · 서버 routine_save)
 * 누르면 루틴 줄로 바꿔 저장하고 바로 다이어리 화면으로 넘어간다
 */
function RoutineSaveCard({ text, onBuy }) {
  const nav = useNavigate();
  const [state, setState] = useState(""); // "" · busy · error 글
  async function save() {
    setState("busy");
    const { data, error } = await supabase.functions.invoke("agent", { body: { action: "routine_save", text } });
    let r = data;
    if (error) { try { r = await error.context?.json?.(); } catch { r = null; } }
    // 다이어리에 넣으면서 효과 시험도 만들어졌으면 → 바로 시험 화면으로 (지금 10문제)
    if (r?.count && r?.link) return nav(r.link, { state: { from: "agent", diary: true, test: r.test } });
    if (r?.count) return nav("/plan", { state: { from: "agent", diary: true } });
    if (r?.need_pay) { setState(""); return FREE_OPEN ? setState("오늘 무료 사용량을 다 썼어요. 새벽 5시에 다시 채워져요.") : onBuy?.(); }
    setState(r?.error ?? "잠시 후 다시 해 주세요");
  }
  return (
    <div className="mt-2 rounded bg-white p-4 ring-1 ring-black/10">
      <b className="block text-[14.5px] font-extrabold text-gray-900">이 루틴을 내 학습 다이어리에 넣을까요?</b>
      <small className="mt-0.5 block text-[12.5px] leading-relaxed text-gray-500">매일 할 일을 체크하고, 이 공부법이 나한테 맞는지 확인하는 시험(지금 10문제 → 일주일 뒤 비슷한 문제)도 자동으로 만들어 드려요.</small>
      <button onClick={save} disabled={state === "busy"} className="mt-3 h-11 w-full rounded text-[14px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
        {state === "busy" ? "다이어리에 넣고 시험 문제 만드는 중… (30초쯤)" : "학습 다이어리에 넣고 자기주도학습법 시작 ›"}
      </button>
      {state && state !== "busy" && <p className="mt-2 text-[12.5px] font-bold text-red-500">{state}</p>}
      {!FREE_OPEN && <p className="mt-2 text-center text-[11.5px] text-gray-400">학습 다이어리 · 자기주도학습법은 이용권 전용이에요</p>}
    </div>
  );
}

/*
 * 해 줄까요? — 물꼬가 직접 해 주겠다고 제안한 일 (sql/sm_96 agent_actions · 서버 agent_action)
 * [네, 해 줘]를 눌러야 실행된다 · 한 번 정하면 대화를 다시 열어도 결과가 그대로 보인다
 */
const ACT_LABEL = { prep_school: "면접 준비", study_test: "자기주도학습법" };
function ActionCard({ id, onBuy }) {
  const nav = useNavigate();
  const [row, setRow] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    supabase.from("agent_actions").select("id,kind,title,status,result").eq("id", id).maybeSingle().then(({ data }) => setRow(data ?? false));
  }, [id]);
  async function decide(d) {
    setBusy(d); setErr("");
    const { data, error } = await supabase.functions.invoke("agent", { body: { action: "agent_action", id, decide: d } });
    let r = data;
    if (error) { try { r = await error.context?.json?.(); } catch { r = null; } }
    setBusy("");
    if (r?.need_pay && r?.pass_only && !FREE_OPEN) return onBuy?.(); // 자기주도학습법은 이용권 전용
    if (r?.need_pay) return setErr(FREE_OPEN ? "오늘 무료 사용량을 다 썼어요. 새벽 5시에 다시 채워져요." : "오늘 무료 사용량을 다 썼어요. 새벽 5시에 다시 채워지고, 이용권(한 달 10,900원부터)이면 바로 계속 쓸 수 있어요.");
    if (!r || r.error) return setErr(r?.error ?? "잠시 후 다시 해 주세요");
    setRow((x) => ({ ...x, status: r.status, result: r }));
  }
  if (!row) return null;
  const res = row.result ?? {};
  return (
    <div className={`mt-2 rounded p-4 ring-1 ${row.status === "done" ? "bg-[#ECFBF3] ring-[#0B8A5E]/20" : row.status === "pending" ? "bg-white ring-black/10" : "bg-[#F8F9FB] ring-black/5"}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex-none rounded px-2 py-0.5 text-[11px] font-extrabold text-white" style={{ background: row.status === "done" ? "#0B8A5E" : NAVY }}>{ACT_LABEL[row.kind] ?? "할 일"}</span>
        <div className="min-w-0 flex-1">
          <b className={`block text-[14px] font-extrabold leading-snug ${row.status === "cancelled" ? "text-gray-400 line-through" : "text-gray-900"}`}>{row.title}</b>
          {row.status === "pending" && <small className="mt-0.5 block text-[12px] text-gray-500">물꼬가 대신 해 둘까요?</small>}
          {row.status !== "pending" && res.message && <small className={`mt-0.5 block text-[12.5px] ${row.status === "done" ? "text-[#0B6B4A]" : "text-gray-400"}`}>{res.message}</small>}
        </div>
      </div>
      {row.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => decide("run")} disabled={Boolean(busy)} className="h-10 flex-1 rounded text-[13.5px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
            {busy === "run" ? (row.kind === "study_test" ? "문제 만드는 중… (30초~1분)" : "하는 중…") : "네, 해 줘"}
          </button>
          <button onClick={() => decide("cancel")} disabled={Boolean(busy)} className="h-10 rounded bg-white px-4 text-[13.5px] font-bold text-gray-500 ring-1 ring-gray-200 disabled:opacity-50">아니요</button>
        </div>
      )}
      {row.status === "done" && res.link && (
        <button onClick={() => nav(res.link)} className="mt-3 h-10 w-full rounded bg-white text-[13.5px] font-extrabold ring-1 ring-[#0B8A5E]/30" style={{ color: "#0B6B4A" }}>{res.link_label ?? "보러 가기"} ›</button>
      )}
      {err && <p className="mt-2 text-[12.5px] font-bold text-red-500">{err}</p>}
    </div>
  );
}

/*
 * 물꼬가 기억하는 나 — 물꼬 노트 (sql/sm_96 agent_memory)
 * 대화하면서 물꼬가 스스로 적는다 · 학생은 보고 지울 수 있다 (자기 것만)
 */
const MEM_KEYS = ["학년", "계열", "목표 대학", "목표 학과", "성적", "약한 과목", "약한 단원", "틀리는 이유", "공부 습관", "지원 대학", "면접 일정", "고민"];
function MemoryBox({ refreshKey = 0 }) {
  const [m, setM] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => supabase.from("agent_memory").select("facts,notes").maybeSingle().then(({ data }) => setM({ facts: data?.facts ?? {}, notes: Array.isArray(data?.notes) ? data.notes : [] }));
  // 답이 온 뒤 물꼬가 뒤에서 노트를 고치니 조금 기다렸다가 다시 읽는다
  useEffect(() => { const t = setTimeout(load, refreshKey ? 6000 : 0); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey]);
  if (!m) return null;
  const facts = MEM_KEYS.filter((k) => m.facts[k]).map((k) => ({ k, v: m.facts[k] }));
  const total = facts.length + m.notes.length;
  async function save(next) {
    setM(next);
    await supabase.from("agent_memory").update({ facts: next.facts, notes: next.notes, updated_at: new Date().toISOString() }).not("user_id", "is", null);
  }
  const dropFact = (k) => { const f = { ...m.facts }; delete f[k]; save({ ...m, facts: f }); };
  const dropNote = (i) => save({ ...m, notes: m.notes.filter((_, j) => j !== i) });
  async function forgetAll() {
    if (!window.confirm("물꼬가 기억한 것을 모두 지울까요?")) return;
    await supabase.from("agent_memory").delete().not("user_id", "is", null);
    setM({ facts: {}, notes: [] });
  }
  return (
    <div className="mt-3 rounded bg-white px-4 py-3 ring-1 ring-black/5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="text-[12.5px] font-bold text-gray-800">물꼬가 기억하는 나</span>
        <span className="text-[11.5px] font-bold text-gray-400">{total ? `${total}개 ${open ? "▲" : "▼"}` : "아직 없음"}</span>
      </button>
      {!open && facts.length > 0 && (
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-gray-500">{facts.slice(0, 4).map((f) => f.v).join(" · ")}</p>
      )}
      {!total && <p className="mt-1 text-[11.5px] leading-relaxed text-gray-400">목표 대학 · 성적 · 약한 단원을 말해 주면 기억해 두고 다음에 이어서 도와줘요.</p>}
      {open && total > 0 && (
        <div className="mt-2">
          <ul className="grid gap-1">
            {facts.map((f) => (
              <li key={f.k} className="group flex items-start gap-2 text-[12px] leading-relaxed">
                <b className="w-[70px] flex-none text-gray-400">{f.k}</b>
                <span className="min-w-0 flex-1 text-gray-800">{f.v}</span>
                <button onClick={() => dropFact(f.k)} className="flex-none px-1 text-gray-300 hover:text-red-500" aria-label={`${f.k} 지우기`}>×</button>
              </li>
            ))}
            {m.notes.map((n, i) => (
              <li key={`n${i}`} className="flex items-start gap-2 text-[12px] leading-relaxed">
                <b className="w-[70px] flex-none text-gray-400">기억</b>
                <span className="min-w-0 flex-1 text-gray-800">{n.t}</span>
                <button onClick={() => dropNote(i)} className="flex-none px-1 text-gray-300 hover:text-red-500" aria-label="지우기">×</button>
              </li>
            ))}
          </ul>
          <button onClick={forgetAll} className="mt-2 text-[11.5px] font-semibold text-gray-400 underline">모두 잊어 줘</button>
        </div>
      )}
    </div>
  );
}

/*
 * 대학 자료 추가 요청 — 생수면에 없는 대학을 물었을 때 (설문처럼 골라서 보냄)
 * univ_requests 표에 저장 (sql/sm_87) → 관리자 화면 '사람 › 대학 추가 요청'에서 많이 요청한 순으로 본다
 */
const NEEDS = ["면접 기출", "면접 방식", "인재상", "모집요강·전형", "입결"];
function UnivRequestCard({ req, question }) {
  const [univ, setUniv] = useState(req.university ?? "");
  const [dept, setDept] = useState(req.department ?? "");
  const [needs, setNeeds] = useState(["면접 기출"]);
  const [memo, setMemo] = useState("");
  const [state, setState] = useState(""); // "" | busy | done | error
  const toggle = (n) => setNeeds((v) => (v.includes(n) ? v.filter((x) => x !== n) : [...v, n]));
  async function submit() {
    if (univ.trim().length < 2 || !needs.length) return;
    setState("busy");
    const { error } = await supabase.from("univ_requests").insert({
      university: univ.trim().slice(0, 40), department: dept.trim().slice(0, 40), needs, memo: memo.trim().slice(0, 300), question: String(question ?? "").slice(0, 300),
    });
    setState(error ? "error" : "done");
  }
  if (state === "done") {
    return (
      <div className="mt-2 rounded bg-[#ECFBF3] px-4 py-3.5 text-[13.5px] leading-relaxed text-[#0B6B4A] ring-1 ring-[#0B8A5E]/20">
        <b>{univ} 자료 추가 요청을 받았어요.</b>
        <br />
        요청이 많은 대학부터 자료를 넣고 있어요. 들어오면 같은 질문으로 다시 물어봐 주세요.
      </div>
    );
  }
  return (
    <div className="mt-2 rounded bg-white p-4 shadow-sm ring-1 ring-black/10">
      <p className="text-[14.5px] font-extrabold text-gray-900">이 대학 자료를 추가해 드릴까요?</p>
      <p className="mt-0.5 text-[12.5px] text-gray-500">요청이 많은 대학부터 넣어요.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-bold text-gray-700">대학</span>
          <input value={univ} onChange={(e) => setUniv(e.target.value.slice(0, 40))} placeholder="예: 한양대 ERICA" className="w-full rounded bg-[#F8F9FB] px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-gray-300" />
        </label>
        <label className="block">
          <span className="mb-1 flex gap-1.5 text-[12.5px] font-bold text-gray-700">학과 <small className="font-medium text-gray-400">선택</small></span>
          <input value={dept} onChange={(e) => setDept(e.target.value.slice(0, 40))} placeholder="예: 건축학과" className="w-full rounded bg-[#F8F9FB] px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-gray-300" />
        </label>
      </div>
      <p className="mb-1.5 mt-3 text-[12.5px] font-bold text-gray-700">어떤 자료가 필요해요? <small className="font-medium text-gray-400">여러 개</small></p>
      <div className="flex flex-wrap gap-1.5">
        {NEEDS.map((n) => (
          <button key={n} type="button" onClick={() => toggle(n)} className={`rounded px-3 py-1.5 text-[12.5px] font-bold ring-1 ${needs.includes(n) ? "text-white ring-transparent" : "bg-white text-gray-600 ring-gray-200"}`} style={needs.includes(n) ? { background: NAVY } : undefined}>
            {n}
          </button>
        ))}
      </div>
      <input value={memo} onChange={(e) => setMemo(e.target.value.slice(0, 300))} placeholder="한마디 (선택) · 예: 수시 면접 준비 중이에요" className="mt-3 w-full rounded bg-[#F8F9FB] px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-gray-300" />
      {state === "error" && <p className="mt-2 text-[12.5px] font-bold text-red-500">요청을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.</p>}
      <button onClick={submit} disabled={univ.trim().length < 2 || !needs.length || state === "busy"} className="mt-3 h-11 w-full rounded text-[14px] font-extrabold text-white disabled:opacity-30" style={{ background: NAVY }}>
        {state === "busy" ? "보내는 중…" : "추가 요청 보내기"}
      </button>
    </div>
  );
}

/* 질문 카드 — 보기를 고르거나 직접 적고 → 다음 질문 → 마지막에 한 번에 보낸다 */
// '다른 방향' · '직접 입력' 같은 보기 — 누르면 바로 보내지 않고 원하는 걸 적게 한다
const WRITE_OPT = (o) => /^(다른\s*(방향|학과|주제|대학|책|과목)|진로로|직접|기타)/.test(o.label) || /직접\s*적|적어\s*주세요|적어요/.test(o.desc ?? "");
const WRITE_HINT = (o) => (/진로/.test(o.label) ? "희망 진로를 적어 주세요 · 예: 신약 연구원, 화장품 연구원"
  : /과목/.test(o.label) ? "어떤 과목인지 적어 주세요 · 예: 화학Ⅱ, 지구과학"
  : /학과/.test(o.label) ? "어떤 학과인지 적어 주세요 · 예: 보건행정학과"
  : /대학/.test(o.label) ? "어느 대학인지 적어 주세요 · 예: 가천대"
  : /책/.test(o.label) ? "어떤 책인지 적어 주세요"
  : "어떤 방향으로 하고 싶은지 적어 주세요 · 예: 노인 돌봄 로봇, 감염 예방 교육");
function QuestionCard({ questions, onSubmit, onClose, onPhotos, uploading = false }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [typed, setTyped] = useState("");
  const [writing, setWriting] = useState(null); // 적기로 고른 보기 ('다른 방향' 등)
  const inputRef = useRef(null);
  const cur = questions[step];
  const total = questions.length;
  function answer(a) {
    const v = String(a ?? "").trim();
    if (!v) return;
    const next = [...answers.slice(0, step), v];
    setTyped("");
    setWriting(null);
    if (step + 1 < total) { setAnswers(next); setStep(step + 1); return; }
    onSubmit(total === 1 && !questions[0].q ? next[0] : questions.map((q, k) => (q.q ? `${q.q} → ${next[k]}` : next[k])).join("\n"));
  }
  return (
    <div className="mt-2 rounded bg-white p-4 shadow-sm ring-1 ring-black/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14.5px] font-extrabold text-gray-900">{cur.q || "골라 주세요"}</p>
        <button onClick={onClose} className="text-[20px] leading-none text-gray-400" aria-label="닫기">×</button>
      </div>
      {/* 수행평가 고르기 카드 — 선생님이 준 안내문 종이를 사진으로 올리는 게 먼저 (제일 정확) */}
      {onPhotos && /어떤 수행평가/.test(cur.q) && (
        <>
          <label className={`mt-3 flex h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded text-[14px] font-extrabold text-white ${uploading ? "pointer-events-none opacity-50" : ""}`} style={{ background: NAVY }}>
            {uploading ? "올리는 중…" : "선생님이 준 안내문 사진 올리기"}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => onPhotos(e)} />
          </label>
          <p className="mt-1.5 text-center text-[11.5px] text-gray-400">종이 안내문을 찍어 올리면 제일 정확해요 · 여러 장 가능 · 사진이 없으면 아래에서 골라요</p>
        </>
      )}
      <div className="mt-3 flex flex-col">
        {cur.opts.map((o) => (
          <button key={o.label} onClick={() => (WRITE_OPT(o) ? (setWriting(o), setTimeout(() => inputRef.current?.focus(), 30)) : answer(o.label))} className={`flex items-start gap-3 rounded px-2 py-2.5 text-left hover:bg-[#F8F9FB] ${writing?.label === o.label ? "bg-[#F8F9FB]" : ""}`}>
            <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${writing?.label === o.label ? "border-[5px]" : "border-gray-300"}`} style={writing?.label === o.label ? { borderColor: NAVY } : undefined} />
            <span>
              <span className="block text-[13.5px] font-bold text-gray-900">{o.label}</span>
              {o.desc && <span className="mt-0.5 block text-[12px] text-gray-500">{o.desc}</span>}
            </span>
          </button>
        ))}
      </div>
      {writing && <p className="mt-2 text-[12.5px] font-bold" style={{ color: NAVY }}>{WRITE_HINT(writing).split(" · ")[0]}</p>}
      <div className={`mt-2 flex items-center gap-2 ${writing ? "" : "border-t border-gray-100 pt-3"}`}>
        <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 200))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) answer(writing ? `${writing.label}: ${typed}` : typed); }}
          placeholder={writing ? WRITE_HINT(writing).split(" · ").slice(1).join(" · ") || "적어 주세요" : "직접 입력해도 돼요"}
          className={`h-9 flex-1 rounded bg-[#F8F9FB] px-3 text-[13px] outline-none ${writing ? "ring-2" : ""}`} style={writing ? { "--tw-ring-color": NAVY } : undefined} />
        {total > 1 && (
          <span className="flex items-center gap-1 text-[12px] text-gray-400">
            <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} className="px-1 disabled:opacity-30">‹</button>
            {step + 1}/{total}
            <button onClick={() => answers[step] && setStep(step + 1)} disabled={!answers[step] || step + 1 >= total} className="px-1 disabled:opacity-30">›</button>
          </span>
        )}
        <button onClick={() => answer(writing ? `${writing.label}: ${typed}` : typed)} disabled={!typed.trim()} className="flex h-8 w-8 items-center justify-center rounded text-[15px] font-extrabold text-white disabled:opacity-30" style={{ background: NAVY }} aria-label="보내기">→</button>
      </div>
    </div>
  );
}

/* 한 줄 안의 '무엇을: …' 같은 앞말은 굵게 */
function Line({ text }) {
  const m = String(text).match(/^([^:：]{1,14})[:：]\s+(.+)$/);
  if (m && !/https?$/.test(m[1])) return <><b className="text-gray-900">{m[1]}</b> <span className="text-gray-400">·</span> <Inline text={m[2]} /></>;
  return <Inline text={text} />;
}

/* 답변 글 보여 주기 — 목록 항목 아래 이어지는 줄은 그 항목 안으로 묶어 줄을 맞춘다
 *   - 제목            → 굵은 제목 (번호/점)
 *     무엇을: …        → 같은 들여쓰기로 한 칸 안에
 *   | 표 |             → 표 · ## 제목 → 소제목 */
/* "이렇게 해 봐요 1. … 2. … 3. …" 처럼 한 줄에 붙어 온 단계를 줄마다 나눠 번호로 보여 준다 */
function splitSteps(text) {
  const t = String(text ?? "");
  const at = t.search(/(^|\s)1[.)]\s/);
  if (at < 0 || !/\s2[.)]\s/.test(t.slice(at))) return null;
  const head = t.slice(0, at).trim();
  const steps = t.slice(at).trim().split(/\s+(?=\d{1,2}[.)]\s)/).map((x) => x.replace(/^\d{1,2}[.)]\s*/, "").trim()).filter(Boolean);
  return steps.length >= 2 ? { head, steps } : null;
}
function Steps({ text, plain = false }) {
  const sp = splitSteps(text);
  if (!sp) return <p className={plain ? "" : "mt-1 text-[13.5px] text-gray-600"}><Line text={text} /></p>;
  return (
    <div className={plain ? "" : "mt-1.5 text-[13.5px] text-gray-600"}>
      {sp.head && <p className="font-bold text-gray-800"><Line text={sp.head} /></p>}
      <ol className="mt-1 grid gap-1">
        {sp.steps.map((x, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[2px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-white text-[11px] font-extrabold ring-1 ring-gray-300" style={{ color: NAVY }}>{i + 1}</span>
            <span className="min-w-0 flex-1 leading-relaxed"><Line text={x} /></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
// 목록 카드 안 한 줄 — 번호로 시작하면 작은 번호 줄, 단계가 붙어 있으면 나눠서
function Kid({ text }) {
  const m = String(text).match(/^(\d{1,2})[.)]\s+(.*)$/);
  if (m) return (
    <p className="mt-1 flex gap-2 text-[13.5px] text-gray-600">
      <span className="mt-[2px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-white text-[11px] font-extrabold ring-1 ring-gray-300" style={{ color: NAVY }}>{m[1]}</span>
      <span className="min-w-0 flex-1 leading-relaxed"><Line text={m[2]} /></span>
    </p>
  );
  return <Steps text={text} />;
}

// 내 말풍선 — 사진 경로 표시([[사진: …]])는 숨긴다
/* 완성본 → 한글 · 워드 · PDF 받기 (lib/taskDoc · docx 는 누를 때만 불러온다 · AI 다시 안 부름) */
const DOC_LABEL = { hwp: "한글 파일 받기", docx: "워드 파일 받기", pdf: "PDF로 저장하기" };
/* 보고서 디자인하러 가기 — 완성본을 디자인 보고서 칸에 담고(school_task to_report) 바로 /inquiry/:id/report 로 */
export function DesignGo({ taskId }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.functions.invoke("school_task", { body: { action: "to_report", taskId } });
    setBusy(false);
    if (error || !data?.inquiryId) {
      let msg = data?.error ?? "";
      try { msg = msg || (await error?.context?.json?.())?.error || ""; } catch { /* 무시 */ }
      return setErr(msg || "디자인을 열지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
    nav(`/inquiry/${data.inquiryId}/report`, { state: { from: "agent" } });
  }
  return (
    <div className="mt-3">
      <button onClick={go} disabled={busy} className="flex w-full items-center justify-between gap-3 rounded border border-gray-200 bg-white p-4 text-left hover:border-gray-400 disabled:opacity-60">
        <span>
          <b className="block text-[14.5px] font-extrabold text-gray-900">보고서 디자인하러 가기</b>
          <small className="text-[12.5px] text-gray-500">{busy ? "완성본을 디자인 칸에 옮기는 중 (20초쯤)…" : "디자인 30가지 · 사진 · 글씨체 · 색 바꾸기 · PDF 저장"}</small>
        </span>
        <span className="flex h-9 flex-none items-center rounded bg-gray-800 px-3.5 text-[13px] font-extrabold text-white">{busy ? "옮기는 중" : "열기 ›"}</span>
      </button>
      {err && <p className="mt-1.5 text-[12.5px] font-bold text-red-600">{err}</p>}
    </div>
  );
}

export function DocButton({ taskId, kind, paid = true, onBuy }) {
  const [state, setState] = useState(""); // "" · making · done · fail · popup · copied
  async function getTask() {
    const { data } = await supabase.from("school_tasks").select("title,subject,draft").eq("id", taskId).maybeSingle();
    if (!data?.draft) throw new Error("no draft");
    return data;
  }
  async function make() {
    // 완성본 파일(한글 · 워드 · PDF)도 무료 (FREE_OPEN)
    if (!paid && !FREE_OPEN) {
      track("paywall_doc", kind);
      return onBuy?.({ reason: "doc", title: "완성본 파일은 이용권으로 받아요", desc: "완성본 · 채점 · 세특 예상 문장까지는 무료예요. 한글 · 워드 · PDF 파일로 받으려면 이용권이 필요해요. 한 달 10,900원부터예요." });
    }
    setState("making");
    try {
      const t = await getTask();
      const lib = await import("../../lib/taskDoc");
      if (kind === "pdf") {
        if (!lib.printPdf(t)) return setState("popup");
      } else {
        const D = await import("docx");
        await lib.makeDocx(D, t, kind);
      }
      track("suhaeng_doc", kind);
      setState("done");
    } catch (e) {
      console.error("doc", e);
      setState("fail");
    }
  }
  async function copy() {
    try {
      const t = await getTask();
      await navigator.clipboard.writeText(String(t.draft).replace(/\*\*/g, "").replace(/^#{1,4}\s+/gm, ""));
      setState("copied");
    } catch { setState("fail"); }
  }
  const msg = { done: kind === "pdf" ? "인쇄 화면에서 'PDF로 저장'을 고르면 돼요." : kind === "hwp" ? "받았어요. 한글에서 열고 '다른 이름으로 저장 → HWP'로 저장하면 돼요." : "받았어요. 학번 · 이름 칸만 채우면 돼요.", popup: "새 창이 막혔어요. 브라우저 주소창 오른쪽에서 팝업을 허용하고 다시 눌러 주세요.", fail: "만들지 못했어요. 다시 눌러 주세요.", copied: "글을 복사했어요. 원하는 곳에 붙여 넣으면 돼요." }[state];
  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-4">
      <b className="text-[14.5px] font-extrabold text-gray-900">{DOC_LABEL[kind]?.replace(/ 받기| 저장하기/, "")} 제출용</b>
      <p className="mt-1 text-[12.5px] text-gray-500">A4 · 제목 · 학번 · 이름 칸 · 문단 제목 · 참고 자료까지 그대로</p>
      <div className="mt-3 flex gap-2">
        <button onClick={make} disabled={state === "making"} className="h-11 flex-[2] rounded text-[14px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
          {state === "making" ? "만드는 중…" : DOC_LABEL[kind]}
        </button>
        <button onClick={copy} className="h-11 flex-1 rounded border border-gray-300 text-[13.5px] font-bold text-gray-700">글만 복사</button>
      </div>
      {msg && <p className={`mt-2 text-[12.5px] ${state === "fail" || state === "popup" ? "font-semibold text-red-500" : "text-gray-500"}`}>{msg}</p>}
    </div>
  );
}

/* PPT 받기 — 발표 대본(school_tasks.speech)으로 PPT 파일을 이 브라우저에서 바로 만든다 (AI 다시 안 부름 · 비용 없음)
 * 디자인 6개(구성이 다름) × 색 6개 — 과목으로 하나씩 추천 (lib/speechDeck) · pptxgenjs 는 누를 때만 불러온다
 */
function StyleThumb({ k, p }) { // 디자인 미리보기 (작은 슬라이드 그림)
  const c = (x) => `#${x}`;
  const box = "relative block h-12 overflow-hidden rounded-sm";
  const bg = { background: c(k === "board" ? p.surface : p.bg), boxShadow: "inset 0 0 0 1px rgba(0,0,0,.08)" };
  const bar = (st) => <span className="absolute" style={st} />;
  return (
    <span className={box} style={bg}>
      {k === "classic" && <>{bar({ left: 6, top: 8, width: 30, height: 4, background: c(p.title) })}{bar({ left: 6, top: 15, width: 10, height: 2, background: c(p.accent) })}{bar({ left: 6, top: 22, width: 24, height: 16, background: c(p.surface) })}{bar({ left: 34, top: 22, width: 24, height: 16, background: c(p.surface) })}</>}
      {k === "minimal" && <>{bar({ left: 8, top: 9, width: 34, height: 3, background: c(p.title) })}{bar({ left: 8, top: 16, right: 8, height: 1, background: c(p.line) })}{bar({ left: 8, top: 22, width: 22, height: 16, border: `1px solid ${c(p.box)}` })}{bar({ left: 34, top: 22, width: 22, height: 16, border: `1px solid ${c(p.box)}` })}</>}
      {k === "sidebar" && <>{bar({ left: 0, top: 0, bottom: 0, width: 18, background: c(p.primary) })}{bar({ left: 4, top: 5, width: 9, height: 5, background: c(p.accent) })}{bar({ left: 24, top: 8, width: 30, height: 4, background: c(p.title) })}{bar({ left: 24, top: 18, width: 36, height: 3, background: c(p.line) })}{bar({ left: 24, top: 25, width: 30, height: 3, background: c(p.line) })}</>}
      {k === "board" && <>{bar({ left: 0, top: 0, right: 0, height: 13, background: c(p.primary) })}{bar({ left: 6, top: 20, width: 22, height: 20, background: c(p.bg), boxShadow: "0 1px 3px rgba(0,0,0,.2)" })}{bar({ left: 34, top: 20, width: 22, height: 20, background: c(p.bg), boxShadow: "0 1px 3px rgba(0,0,0,.2)" })}</>}
      {k === "bold" && <><span className="absolute right-1 top-[-4px] text-[22px] font-black leading-none" style={{ color: c(p.line) }}>01</span>{bar({ left: 5, top: 7, width: 3, height: 12, background: c(p.accent) })}{bar({ left: 11, top: 10, width: 28, height: 5, background: c(p.title) })}{bar({ left: 5, top: 26, width: 24, height: 14, background: c(p.accent) })}{bar({ left: 0, bottom: 0, width: "40%", height: 2, background: c(p.accent) })}</>}
      {k === "editorial" && <>{bar({ left: 5, right: 5, top: 4, height: 1, background: c(p.primary) })}{bar({ left: "30%", right: "30%", top: 10, height: 4, background: c(p.title) })}{bar({ left: "44%", right: "44%", top: 18, height: 1, background: c(p.accent) })}{bar({ left: "20%", right: "20%", top: 26, height: 2, background: c(p.line) })}{bar({ left: "25%", right: "25%", top: 32, height: 2, background: c(p.line) })}</>}
    </span>
  );
}
function PptButton({ taskId }) {
  const [state, setState] = useState(""); // "" · making · done · fail
  const [task, setTask] = useState(null);
  const [style, setStyle] = useState("");
  const [palette, setPalette] = useState("");
  useEffect(() => {
    let on = true;
    supabase.from("school_tasks").select("title,subject,speech").eq("id", taskId).maybeSingle().then(({ data }) => {
      if (!on || !data) return;
      setTask(data);
      const r = recommend(data.subject);
      setStyle((v) => v || r.style);
      setPalette((v) => v || r.palette);
    });
    return () => { on = false; };
  }, [taskId]);
  const rec = task ? recommend(task.subject) : {};
  const P = PALETTES.find((x) => x.key === palette) ?? PALETTES[0];

  async function make() {
    setState("making");
    try {
      const t = task;
      if (!t?.speech?.slides?.length) throw new Error("no speech");
      const { default: PptxGenJS } = await import("pptxgenjs");
      const deck = buildDeck(new PptxGenJS(), t.speech, { title: t.title, subject: t.subject, style, palette });
      const name = String(t.speech.deck_title || t.title || "발표").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
      await deck.writeFile({ fileName: `${name}_발표.pptx` });
      try { localStorage.setItem(`sm_ppt_${taskId}`, JSON.stringify({ style, palette })); } catch { /* 저장 못 해도 됨 */ }
      track("suhaeng_ppt", `${style}/${palette}`);
      setState("done");
    } catch (e) {
      console.error("ppt", e);
      setState("fail");
    }
  }
  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <b className="text-[14.5px] font-extrabold text-gray-900">PPT 받기</b>
        <small className="text-[12px] text-gray-400">대본과 같은 순서 · 발표자 노트에 대본</small>
      </div>
      <p className="mt-2 text-[12.5px] font-bold text-gray-600">디자인</p>
      <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {STYLES.map((t) => (
          <button key={t.key} onClick={() => setStyle(t.key)} title={t.desc}
            className={`rounded border p-1.5 text-left ${style === t.key ? "border-gray-900 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-400"}`}>
            <StyleThumb k={t.key} p={P} />
            <span className="mt-1 block truncate text-[11.5px] font-bold text-gray-800">{t.name}{t.key === rec.style && <span className="ml-1 text-[10.5px] text-sm-orange">추천</span>}</span>
            <span className="block truncate text-[10.5px] text-gray-400">{t.desc}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] font-bold text-gray-600">색</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {PALETTES.map((p) => (
          <button key={p.key} onClick={() => setPalette(p.key)}
            className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-[12px] font-bold ${palette === p.key ? "border-gray-900 ring-1 ring-gray-900" : "border-gray-200 hover:border-gray-400"}`}>
            <span className="flex h-4 w-6 overflow-hidden rounded-sm ring-1 ring-black/10"><span className="flex-1" style={{ background: `#${p.primary}` }} /><span className="w-2" style={{ background: `#${p.accent}` }} /></span>
            {p.name}
          </button>
        ))}
      </div>
      <button onClick={make} disabled={state === "making" || !task} className="mt-3 h-11 w-full rounded text-[14px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
        {state === "making" ? "만드는 중…" : state === "done" ? "다시 받기 (.pptx)" : ".pptx 받기"}
      </button>
      {state === "done" && <p className="mt-2 text-[12.5px] text-gray-500">내려받았어요. 사진 넣는 자리에 사진만 넣으면 돼요. 디자인이나 색을 바꿔서 다시 받아도 돼요.</p>}
      {state === "fail" && <p className="mt-2 text-[12.5px] font-semibold text-red-500">만들지 못했어요. 다시 눌러 주세요.</p>}
    </div>
  );
}

/* 발표 연습 카드 — 세움스피치 방식 코칭 (서버 agent 수행평가 ⑧ · school_task speech_fb)
 * '말하기 시작' → 브라우저 음성 인식(크롬 · 엣지 · 사파리)으로 말한 걸 글로 받고 시간을 잰다 → '다 했어'
 * 보내는 말: 첫 줄 "발표 연습 끝 [[발표: 초]]" + 둘째 줄부터 말한 내용 (화면에는 showUser 가 짧게 보여 준다)
 */
function SpeechCard({ minutes, onDone }) {
  const [state, setState] = useState("idle"); // idle · rec · done
  const [sec, setSec] = useState(0);
  const [said, setSaid] = useState("");
  const [live, setLive] = useState("");
  const [err, setErr] = useState("");
  const recRef = useRef(null);
  const startRef = useRef(0);
  const keepRef = useRef(false);
  const finalRef = useRef("");
  const limit = minutes * 60;

  useEffect(() => () => { keepRef.current = false; recRef.current?.stop?.(); }, []);
  useEffect(() => {
    if (state !== "rec") return;
    const t = setInterval(() => setSec(Math.round((Date.now() - startRef.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [state]);

  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current = `${finalRef.current} ${r[0].transcript}`.trim();
        else interim += r[0].transcript;
      }
      setSaid(finalRef.current);
      setLive(interim);
    };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { keepRef.current = false; setErr("마이크 사용을 허용해 주세요."); setState("idle"); } };
    rec.onend = () => { if (keepRef.current) { try { rec.start(); } catch { /* 이미 켜짐 */ } } }; // 말을 쉬면 브라우저가 끊어서 다시 켠다
    recRef.current = rec;
    rec.start();
  }
  function start() {
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return setErr("이 브라우저는 음성 인식이 안 돼요. 크롬이나 사파리에서 해 주세요.");
    setErr(""); setSaid(""); setLive(""); finalRef.current = ""; setSec(0);
    startRef.current = Date.now();
    keepRef.current = true;
    setState("rec");
    listen();
  }
  function stop() {
    keepRef.current = false;
    recRef.current?.stop?.();
    setSec(Math.round((Date.now() - startRef.current) / 1000));
    setState("done");
  }
  const text = `${said} ${live}`.trim();
  const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  const over = sec > limit;

  return (
    <div className="mt-3 rounded border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <b className="text-[14.5px] font-extrabold text-gray-900">발표 연습</b>
        <span className={`text-[13px] font-bold tabular-nums ${over ? "text-red-500" : "text-gray-500"}`}>{mmss(sec)} / {mmss(limit)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full transition-all" style={{ width: `${Math.min(100, (sec / limit) * 100)}%`, background: over ? "#EF4444" : NAVY }} />
      </div>
      {state === "idle" && <p className="mt-3 text-[13px] leading-relaxed text-gray-500">대본을 보면서 실제 발표하듯 소리 내어 말해 봐요. 다 말하면 '다 했어'를 눌러요.</p>}
      {state !== "idle" && (
        <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-[#F7F8FA] px-3 py-2.5 text-[13.5px] leading-relaxed text-gray-700">
          {text || (state === "rec" ? "듣고 있어요… 말을 시작해 봐요" : "말한 내용이 잡히지 않았어요")}
        </p>
      )}
      {err && <p className="mt-2 text-[12.5px] font-semibold text-red-500">{err}</p>}
      <div className="mt-3 flex gap-2">
        {state === "idle" && <button onClick={start} className="h-11 flex-1 rounded text-[14px] font-extrabold text-white" style={{ background: NAVY }}>말하기 시작</button>}
        {state === "rec" && <button onClick={stop} className="h-11 flex-1 rounded bg-red-500 text-[14px] font-extrabold text-white">다 했어</button>}
        {state === "done" && (
          <>
            <button onClick={start} className="h-11 flex-1 rounded border border-gray-300 text-[14px] font-bold text-gray-700">다시 하기</button>
            <button
              onClick={() => onDone(`발표 연습 끝 [[발표: ${sec}]]\n${said.slice(0, 3500)}`)}
              disabled={said.replace(/\s/g, "").length < 20}
              className="h-11 flex-[2] rounded text-[14px] font-extrabold text-white disabled:opacity-40"
              style={{ background: NAVY }}
            >
              코칭 받기
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const showUser = (t) => {
  const sp = String(t ?? "").match(/\[\[\s*발표\s*[:：]\s*(\d+)\s*\]\]/);
  if (sp) { const said = String(t).split("\n").slice(1).join(" ").trim(); return `발표 연습 ${Math.floor(sp[1] / 60)}분 ${sp[1] % 60}초 · 말한 내용 ${said.length}자\n${said.length > 140 ? `${said.slice(0, 140)}…` : said}`; }
  return noEmoji(t).replace(/\s*\[\[\s*사진\s*[:：][^\]]*\]\]/g, "").trim() || "안내문 사진";
};

// 이모지 빼기 — 화면은 글만 (전문적인 느낌)
export const noEmoji = (t) => String(t ?? "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B06}\u{2300}-\u{23FF}]\uFE0F?/gu, "").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/gm, "");
export function Rich({ text }) { // 내 입시 홈(MyHome)에서도 저장한 답을 같은 모양으로 보여 준다
  const lines = noEmoji(text).replace(/\r/g, "").split("\n");
  const blocks = []; // { type: "p"|"h"|"table"|"item", ... }
  let item = null;
  let gap = false;
  const LIST = /^\s*([-•*·]|\d+[.)])\s+/;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    if (!l) { item = item && item.kids.length ? null : item; gap = true; continue; }
    // 빈 줄 뒤에 들여쓰지 않은 보통 문장이 오면 목록이 끝난 것 (마지막 항목에 붙지 않게)
    if (item && gap && !/^\s{2,}/.test(raw) && !LIST.test(raw)) item = null;
    gap = false;
    if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const t = lines[i].trim();
        if (!/^\|[\s:|-]+\|$/.test(t)) rows.push(t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      blocks.push({ type: "table", rows });
      item = null;
      continue;
    }
    if (/^#{1,4}\s/.test(l)) { blocks.push({ type: "h", text: l.replace(/^#+\s/, "") }); item = null; continue; }
    const indented = /^\s{2,}/.test(raw);
    if (LIST.test(raw) && !(item && indented)) {
      const num = (raw.match(/^\s*(\d+)[.)]/) || [])[1];
      item = { type: "item", num, title: l.replace(LIST, ""), kids: [] };
      blocks.push(item);
      continue;
    }
    if (item) { item.kids.push(l.replace(/^\s*[-•*·]\s+/, "")); continue; } // 번호(1. 2.)는 살린다 — 단계로 보여 줌
    blocks.push({ type: "p", text: l });
  }
  return (
    <div className="space-y-2.5">
      {blocks.map((b, k) => {
        if (b.type === "h") return <p key={k} className="pt-1 text-[14.5px] font-extrabold text-gray-900"><Inline text={b.text} /></p>;
        if (b.type === "p") return <Steps key={k} text={b.text} plain />;
        if (b.type === "table") return (
          <div key={k} className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className={ri === 0 ? "bg-[#F1F3F8] font-bold" : "border-t border-gray-100"}>
                    {r.map((c, ci) => <td key={ci} className="whitespace-nowrap px-2 py-1.5"><Inline text={c} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        // 목록 항목: 제목 + 그 아래 줄들을 같은 왼쪽 선에 맞춘다
        const card = b.kids.length > 0;
        return (
          <div key={k} className={`flex gap-2.5 ${card ? "rounded bg-[#F8F9FB] px-3.5 py-3" : ""}`}>
            <span className={`shrink-0 text-center font-extrabold ${b.num ? "mt-[1px] h-5 w-5 rounded-full text-[11.5px] leading-5 text-white" : "w-3 text-gray-400"}`} style={b.num ? { background: NAVY } : undefined}>{b.num ?? "•"}</span>
            <div className="min-w-0 flex-1">
              <p className={card ? "font-bold text-gray-900" : ""}><Line text={b.title} /></p>
              {b.kids.map((t, ti) => <Kid key={ti} text={t} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* 이번 주 사용량 — 컴퓨터는 왼쪽 '새 대화' 밑, 휴대폰은 제목 밑 (금액은 안 보여 준다) */
function UsageBar({ usage, pending, className = "mt-3" }) {
  if (!usage) return <div className={`${className} h-[52px]`} />;
  // 무료: 처음 맛보기 한 번 → 다 쓰면 매일 새벽 5시에 하루치 (free_daily) · 이용권은 매주 월요일 0시 초기화
  const reset = usage.reset_at ? new Date(usage.reset_at) : null;
  const resetText = reset
    ? `${"일월화수목금토"[reset.getDay()]}요일 ${reset.getHours() === 0 ? "0시" : reset.toLocaleTimeString("ko-KR", { hour: "numeric" })}에 초기화`
    : usage.free_daily || usage.pct >= 100 ? "새벽 5시에 다시 채워져요" : "처음 한 번 · 다 쓰면 매일 새벽 5시에 조금씩";
  const until = usage.paid_until ? new Date(usage.paid_until).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "";
  const full = usage.pct >= 100;
  return (
    <div className={`${className} rounded bg-white px-4 py-3 ring-1 ring-black/5`}>
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-[12.5px]">
        <p className="font-bold text-gray-800">{reset ? "이번 주 사용량" : usage.free_daily ? "오늘 무료 사용량" : "무료 맛보기"}</p>
        <p className="font-extrabold" style={{ color: full ? PINK : NAVY }}>{usage.paid_until ? `${usage.pct}% 사용됨` : full ? "다 썼어요" : `${Math.max(0, 100 - usage.pct)}% 남음`}</p>
      </div>
      {usage.paid_until && <p className="mt-1 inline-block rounded bg-[#EEF2FF] px-1.5 py-0.5 text-[11px] font-bold" style={{ color: NAVY }}>이용권 · {until}까지</p>}
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(usage.pct, 2)}%`, background: full ? PINK : "#3D6BEF" }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-gray-400">{resetText}</p>
        {!usage.paid_until && pending && <p className="text-[11.5px] font-bold text-[#C2410C]">이용권 입금 확인 중</p>}
      </div>
    </div>
  );
}

/* 친구 초대로 사용량 늘리기 — 기존 친구 추천 링크(?ref=코드)를 같이 쓴다 */
function InviteCard({ invite, topic = false }) {
  const [code, setCode] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.rpc("get_my_referral").then(({ data }) => setCode((Array.isArray(data) ? data[0] : data)?.my_code ?? null));
  }, []);
  if (!invite || invite.friends >= invite.max) return null;
  async function copy() {
    const link = code ? refLink(code) : "";
    if (!link) return;
    try {
      await navigator.clipboard.writeText(`대학 37곳 입시 자료로 답해 주는 물꼬 입시 AI 같이 써 보자\n${link}`);
      setMsg("링크를 복사했어요. 카톡에 붙여넣어 보내 주세요.");
    } catch {
      window.prompt("이 링크를 친구에게 보내 주세요", link);
    }
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded bg-white p-4 ring-1 ring-black/5">
      <div>
        <p className="text-[13.5px] font-extrabold text-gray-900">{topic ? "친구 초대하면 탐구주제 흔한가 +3번" : `친구 초대하면 주간 사용량 +${invite.plus_pct}%`}</p>
        <p className="mt-0.5 text-[11.5px] text-gray-500">내 링크로 친구가 가입할 때마다 · 지금까지 {invite.friends}명 (최대 {invite.max}명)</p>
        {msg && <p className="mt-1 text-[11.5px] font-bold" style={{ color: PINK }}>{msg}</p>}
      </div>
      <button onClick={copy} disabled={!code} className="h-10 shrink-0 rounded px-3.5 text-[13px] font-extrabold text-white disabled:opacity-40" style={{ background: PINK }}>링크 복사</button>
    </div>
  );
}

/* 대화 목록 — 컴퓨터는 왼쪽에 늘 보이고, 휴대폰은 버튼을 누르면 왼쪽에서 열린다 */
function ChatList({ chats, chatId, onOpen, onNew, onDelete, top = null }) {
  const today = new Date().toDateString();
  const groups = [["오늘", chats.filter((c) => new Date(c.updated_at).toDateString() === today)], ["이전", chats.filter((c) => new Date(c.updated_at).toDateString() !== today)]];
  return (
    <div className="flex h-full flex-col">
      <button onClick={onNew} className="flex h-11 items-center justify-center gap-1.5 rounded text-[14px] font-extrabold text-white" style={{ background: NAVY }}>＋ 새 대화</button>
      {top}
      <div className="mt-4 flex-1 overflow-y-auto">
        {chats.length === 0 && <p className="px-2 text-[13px] text-gray-400">아직 대화가 없어요. 물어본 내용은 여기에 저장돼요.</p>}
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label} className="mb-4">
            <p className="px-2 pb-1.5 text-[11.5px] font-bold text-gray-400">{label}</p>
            {list.map((c) => (
              <div key={c.id} className={`group flex items-center rounded transition-colors ${c.id === chatId ? "bg-[#ECEEF2]" : "hover:bg-[#F3F4F6]"}`}>
                <button onClick={() => onOpen(c.id)} className={`min-w-0 flex-1 truncate px-2.5 py-2.5 text-left text-[13.5px] ${c.id === chatId ? "font-bold text-gray-900" : "text-gray-600"}`}>{c.title || "대화"}</button>
                <button onClick={() => onDelete(c.id)} className="px-2 text-[15px] text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" aria-label="대화 지우기">×</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* 생각하는 중 — 서버가 보내 주는 '지금 하는 일'을 차례로 보여 준다 (에이전트가 일하는 느낌) */
function Thinking({ steps, startedAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const list = steps.length ? steps : ["질문 이해하는 중"];
  return (
    <div className="mr-4 px-1 py-1">{/* 흰 칸 없이 글자만 */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gray-400 opacity-50" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gray-500" />
        </span>
        <p className="text-[13.5px] font-extrabold text-gray-900">물꼬가 생각하는 중</p>
        <span className="text-[12px] font-bold tabular-nums text-gray-400">{sec}초</span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {list.map((t, i) => {
          const cur = i === list.length - 1;
          return (
            <li key={i} className={`flex items-center gap-2 text-[13px] ${cur ? "font-bold text-gray-800" : "text-gray-400"}`}>
              {cur
                ? <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-gray-200" style={{ borderTopColor: "#4B5563" }} />
                : <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] text-gray-400">✓</span>}
              {t}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* 서버에 묻기 — 한 줄씩 오는 진행 상황을 받다가 마지막 결과를 돌려준다 */
async function askAgent(payload, onStep) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!res.body || !(res.headers.get("content-type") || "").includes("ndjson")) {
    const j = await res.json().catch(() => ({}));
    return { status: res.status, result: j };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const o = JSON.parse(line);
        if (o.step) onStep(o.step);
        if (o.result) last = o;
      } catch { /* 줄이 덜 왔으면 다음에 */ }
    }
  }
  return last ?? { status: 500, result: { error: "답을 받지 못했어요" } };
}

export const OPENING_GAP = 3 * 3600 * 1000; // 먼저 말 걸기 팝업을 닫은 뒤 다시 띄우기까지 (3시간)

/* 물꼬가 먼저 말 걸기 팝업 — 물꼬 캐릭터 + 말풍선 + 버튼 (휴대폰은 아래에서 올라옴) */
/* 이번 달 학교 수행평가 — 이미 낸 건 체크 (물꼬 첫 팝업 · sql/sm_121 eval_checks) */
export function TaskChecklist({ plan, onCheck, onAsk, limit = 6 }) {
  const [more, setMore] = useState(false);
  const m = plan?.months?.[0];
  if (!m?.tasks?.length) return null;
  const school = plan.school_name || plan.school;
  const list = [...m.tasks].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)) || Number(Boolean(b.doing)) - Number(Boolean(a.doing)));
  const left = list.filter((t) => !t.done).length;
  const shown = more ? list : list.slice(0, limit);
  return (
    <div className="bg-white px-4 py-3.5 ring-1 ring-black/5">
      <p className="text-[14px] font-extrabold text-gray-900">{school} {m.month}월 수행평가 <span className="font-bold text-gray-500">{list.length}개 · 남은 {left}개</span></p>
      <p className="mt-0.5 text-[12px] text-gray-500">이미 낸 건 왼쪽 네모를 체크해 줘. 다음부턴 남은 것만 알려 줄게.</p>
      <div className="mt-2.5 space-y-1.5">
        {shown.map((t) => {
          const auto = t.done && !t.checked; // 물꼬에서 끝낸 것
          return (
            <div key={t.id ?? `${t.subject}${t.title}`} className={`flex items-stretch bg-[#F7F8FA] ${t.done ? "opacity-70" : ""}`}>
              <button onClick={() => !auto && t.id && onCheck(t)} disabled={auto || !t.id} className="flex w-11 flex-none items-center justify-center">
                <span className={`relative block h-[20px] w-[20px] border-2 ${t.done ? "border-sm-navy bg-sm-navy" : "border-gray-300 bg-white"}`}>
                  {t.done && <span className="absolute left-[5px] top-[1px] block h-[11px] w-[5px] rotate-45 border-b-2 border-r-2 border-white" />}
                </span>
              </button>
              <button onClick={() => onAsk(t.doing ? `${t.subject} 수행평가 '${t.title}' 이어서 하자` : `${t.subject} 수행평가 '${t.title}' 준비하기`)} className="min-w-0 flex-1 py-2 pr-3 text-left">
                <b className={`block truncate text-[13px] font-bold ${t.done ? "text-gray-500 line-through" : "text-gray-900"}`}>{t.subject} · {t.title}</b>
                <small className="text-[11.5px] text-gray-500">
                  {t.done ? (t.checked ? "했어요" : "물꼬에서 완료") : t.doing ? "하는 중" : `${t.points ?? "?"}점 · ${t.period || "시기 미정"}`}
                  {!t.done && t.due && <b className="ml-1.5 font-extrabold text-[#FD1673]">{m.month}월 마감</b>}
                </small>
              </button>
            </div>
          );
        })}
      </div>
      {!more && list.length > limit && <button onClick={() => setMore(true)} className="mt-2 text-[12.5px] font-bold text-gray-500">{list.length - limit}개 더 보기</button>}
    </div>
  );
}

export function OpeningPopup({ text, onClose, plan, onCheck }) { // 첫 화면(입시 로드맵)에서도 같은 팝업을 띄운다
  const { body, questions } = splitChoices(text);
  const opts = questions[0]?.opts ?? [];
  const nav = useNavigate();
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 sm:items-center" onClick={() => onClose()}>
      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col bg-[#F4F5F7] px-5 pb-5 pt-4" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onClose()} className="absolute right-4 top-3 text-[22px] leading-none text-gray-400" aria-label="닫기">×</button>
        <div className="flex flex-none items-end gap-2">
          <img src="/images/mulkko.png" alt="물꼬" className="-mb-1 w-16 flex-none select-none" draggable="false" />
          <p className="mb-3 text-[13px] font-extrabold text-sm-orange">물꼬가 먼저 왔어요</p>
        </div>
        {/* 이번 달 할 일(체크 목록)을 맨 위에 — 처음 온 학생도 내가 할 일을 바로 보게 · 물꼬 말은 그 아래 */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <TaskChecklist plan={plan} onCheck={onCheck} onAsk={(q) => onClose(q)} />
          <div className="bg-white px-4 py-3.5 text-[14px] leading-relaxed text-gray-700 ring-1 ring-black/5">
            <Rich text={body} />
          </div>
          {plan?.months?.[0]?.tasks?.length > 0 && (
            window.location.pathname !== "/" && <button onClick={() => { onClose(); nav("/"); }} className="w-full py-1 text-center text-[12.5px] font-bold text-sm-navy">입시 로드맵에서 과목별로 보기 ›</button>
          )}
        </div>
        <div className="mt-3 flex flex-none flex-col gap-2">
          {opts.map((o, k) => (
            <button
              key={o.label}
              onClick={() => onClose(o.label)}
              className={`min-h-[46px] w-full px-4 py-2 text-[14px] font-extrabold ${k === 0 ? "text-white" : "bg-white ring-1 ring-sm-navy/20"}`}
              style={k === 0 ? { background: NAVY } : { color: NAVY }}
            >
              {o.label}
            </button>
          ))}
          <button onClick={() => onClose()} className="mt-1 text-[13px] font-bold text-gray-400">괜찮아, 그냥 둘러볼게</button>
        </div>
      </div>
    </div>
  );
}

/* 📌 내 입시 홈에 저장 — 물꼬 답을 내 입시 홈(/my/home)에 모아 둔다 (노트 앱에 복사할 필요 없게) */
function SaveToHome({ question, answer, chatId }) {
  const { user } = useAuth();
  const [state, setState] = useState("idle"); // idle | saving | saved | fail
  async function save() {
    if (!user || state === "saving" || state === "saved") return;
    setState("saving");
    const title = String(question || answer.split("\n")[0] || "물꼬 답").replace(/\s+/g, " ").trim().slice(0, 80);
    const { error } = await supabase.from("home_saves").insert({ user_id: user.id, title, body: answer.slice(0, 20000), chat_id: chatId ?? null });
    setState(error ? "fail" : "saved");
    if (!error) track("home_save");
  }
  return (
    <div className="mt-1.5 flex items-center gap-2 pl-1 text-[12.5px]">
      {state === "saved" ? (
        <>
          <span className="font-bold text-emerald-600">내 입시 홈에 저장했어요</span>
          <Link to="/my/home" className="font-bold text-gray-500 underline-offset-2 hover:underline">보러 가기 ›</Link>
        </>
      ) : (
        <button onClick={save} className="font-bold text-gray-400 hover:text-sm-navy">
          {state === "saving" ? "저장 중…" : state === "fail" ? "저장 못 했어요 · 다시 누르기" : "내 입시 홈에 저장"}
        </button>
      )}
    </div>
  );
}

export default function Agent() {
  const { user, loading } = useAuth();
  const [msgs, setMsgs] = useState([]); // [{ role, content }]
  const [chatId, setChatId] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState([]); // 생각하는 중 단계
  const [startedAt, setStartedAt] = useState(0);
  const [err, setErr] = useState("");
  const [usage, setUsage] = useState(null); // { pct, reset_at, paid_until, invite }
  const [grade, setGrade] = useState(null); // 물꼬가 보는 학년 (마이페이지 내 정보 → 가입 학년) · "" 이면 모름
  const [needPay, setNeedPay] = useState(false);
  const [limitPop, setLimitPop] = useState(false); // 다 썼을 때 가운데 안내창 (무료 전환 — 결제 대신)
  const [buy, setBuy] = useState(false); // 업그레이드 팝업 (false 또는 { reason, title, desc } 또는 true)
  const [closedCard, setClosedCard] = useState(false); // 질문 카드를 닫았는지 (새 답이 오면 다시 열림)
  const [pending, setPending] = useState(null); // 입금 확인 중인 이용권 주문
  const [uploading, setUploading] = useState(false); // 수행평가 안내문 사진 올리는 중
  const [opening, setOpening] = useState(""); // 물꼬가 먼저 거는 말 (팝업 · 지난번에 한 것 → 우리 학교 수행평가 → 이어서 할 순서)
  const [openPop, setOpenPop] = useState(false); // 먼저 말 걸기 팝업
  const [openPlan, setOpenPlan] = useState(null); // 팝업 안 이번 달 할 일 (agent month_plan)
  // 로드맵(첫 화면) 과목 칸에서 온 '그 과제만 하는 화면' — { kind: "sh" | "tp", subj } (주소 ?do=sh&subj=영어 · 새로고침해도 ?f=sh:영어 로 유지)
  const [focus, setFocus] = useState(null);
  const focusRef = useRef(null);
  const goRoad = useNavigate();
  async function checkTask(t) {
    const on = !t.checked;
    const set = (v) => setOpenPlan((p) => p && { ...p, months: p.months.map((m) => ({ ...m, tasks: m.tasks.map((x) => (x.id === t.id ? { ...x, checked: v, done: v } : x)) })) });
    set(on);
    const { error } = on
      ? await supabase.from("eval_checks").upsert({ eval_task_id: t.id }, { onConflict: "user_id,eval_task_id", ignoreDuplicates: true })
      : await supabase.from("eval_checks").delete().eq("eval_task_id", t.id);
    if (error) set(!on);
    else track(on ? "eval_check" : "eval_uncheck");
  }
  const openingPick = useRef(null); // 팝업에서 누른 버튼 (그 대화에만 물꼬가 먼저 건 말을 붙인다)
  function closeOpening(pick) {
    setOpenPop(false);
    try { localStorage.setItem(`sm_opening_${user.id}`, String(Date.now())); } catch { /* 넘어간다 */ }
    if (pick) {
      openingPick.current = pick;
      track("opening_pick");
      send(pick);
    }
  }
  const [myPlan, setMyPlan] = useState(null); // 내 입시 플랜이 있는지 (null = 모름) — 없으면 [[플랜]] 버튼이 '만들기'로
  useEffect(() => {
    if (!user) return;
    supabase.from("study_plans").select("id").limit(1).then(({ data, error }) => setMyPlan(error ? null : (data ?? []).length > 0));
  }, [user, msgs.length]);
  const [chats, setChats] = useState([]);
  const [showList, setShowList] = useState(false); // 휴대폰 대화 목록
  const [params, setParams] = useSearchParams();
  const endRef = useRef(null);
  // 맨 아래가 입력창에 가려 있으면 '맨 아래로' 버튼 (답이 길거나 카드가 밑에 붙었을 때 — 2026-11-06)
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = endRef.current;
      if (!el) return setBelow(false);
      setBelow(el.getBoundingClientRect().top > window.innerHeight - 110); // 입력창 높이만큼 위
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const t = setInterval(check, 800); // 답이 늘어나는 동안 · 카드가 펼쳐질 때
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); clearInterval(t); };
  }, []);
  const lastBotRef = useRef(null); // 마지막 AI 답의 첫머리 — 답이 오면 여기부터 보이게
  const askedRef = useRef(false); // 홈에서 넘어온 질문을 입력창에 한 번만 적기
  // 물꼬가 새로 기억한 것 — 답 아래 '물꼬가 기억했어요' 한 줄 (ChatGPT '메모리 업데이트됨'처럼)
  const memRef = useRef(null); // 마지막으로 본 물꼬 노트
  const [memNote, setMemNote] = useState(null); // { at: 답 번호, items: [...] }
  const readMem = () => supabase.from("agent_memory").select("facts,notes").maybeSingle().then(({ data }) => ({ facts: data?.facts ?? {}, notes: Array.isArray(data?.notes) ? data.notes : [] }));
  useEffect(() => { if (user) readMem().then((m) => { memRef.current = m; }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);
  function watchMemory(at) {
    // 서버가 답을 보낸 뒤 뒤에서 노트를 고친다 → 5초 · 10초 뒤에 달라진 것만 찾는다
    const before = memRef.current ?? { facts: {}, notes: [] };
    const check = async (last) => {
      const now = await readMem();
      const items = [
        ...MEM_KEYS.filter((k) => now.facts[k] && now.facts[k] !== before.facts?.[k]).map((k) => now.facts[k]),
        ...now.notes.filter((n) => n?.t && !(before.notes ?? []).some((b) => b.t === n.t)).map((n) => n.t),
      ];
      if (items.length) { memRef.current = now; setMemNote({ at, items: items.slice(0, 4) }); return; }
      if (!last) setTimeout(() => check(true), 5000);
      else memRef.current = now;
    };
    setTimeout(() => check(false), 5000);
  }

  const loadChats = () =>
    supabase.from("agent_chats").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(30).then(({ data }) => setChats(data ?? []));

  useEffect(() => {
    if (!user) return;
    track("agent_view"); // 관리자 '물꼬 · 면접' 탭의 들어온 학생 수
    supabase.functions.invoke("agent", { body: { action: "status" } }).then(({ data }) => {
      if (data?.usage) setUsage(data.usage);
      if (data && "grade" in data) setGrade(data.grade || "");
    });
    supabase.from("pay_orders").select("id,amount,depositor,created_at").in("product", PASS_PRODUCTS).eq("status", "pending").order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => setPending(data?.[0] ?? null));
    loadChats();
    const c = Number(params.get("c"));
    const q = (params.get("q") || "").trim();
    const sh = params.get("sh"); // 메뉴 '수행평가 완성' → 들어오자마자 채팅에서 시작
    const dox = ["sh", "tp"].includes(params.get("do")) ? params.get("do") : ""; // 로드맵 과목 칸 버튼
    const go = (params.get("go") || "").trim().slice(0, 300); // 로드맵 첫 팝업에서 누른 버튼 — 들어오자마자 보낸다
    const fp = String(params.get("f") || "").match(/^(sh|tp):(.*)$/);
    const fNow = dox ? { kind: dox, subj: (params.get("subj") || "").slice(0, 20) } : c && fp ? { kind: fp[1], subj: fp[2].slice(0, 20) } : null;
    if (fNow) { focusRef.current = fNow; setFocus(fNow); }
    // 물꼬가 먼저 말 걸기 — 팝업 (보던 대화를 여는 게 아닐 때 · 회원마다 · 닫으면 3시간 동안은 다시 안 뜸)
    let seen = false;
    try { seen = Date.now() - Number(localStorage.getItem(`sm_opening_${user.id}`) || 0) < OPENING_GAP; } catch { /* 저장소를 못 쓰면 띄운다 */ }
    if (!c && !q && !sh && !dox && !go && !seen) Promise.all([
      supabase.functions.invoke("agent", { body: { action: "opening" } }),
      supabase.functions.invoke("agent", { body: { action: "month_plan" } }).catch(() => ({ data: null })), // 이번 달 할 일 체크 목록
    ]).then(([{ data }, mp]) => {
      if (!data?.text) return;
      setOpenPlan(mp?.data ?? null);
      setOpening(data.text);
      setOpenPop(true);
      track("opening_view");
    });
    if (go && !askedRef.current) {
      askedRef.current = true;
      setParams({}, { replace: true });
      setTimeout(() => send(go), 200);
    } else if (dox && !askedRef.current) {
      // 새 대화로 그 과목 과제를 바로 시작 (하던 대화 · 과제와 섞이지 않게 — 서버 router ROAD_START)
      askedRef.current = true;
      setParams({}, { replace: true });
      track(`road_start_${dox}`);
      setTimeout(() => send(`(로드맵) ${fNow.subj} ${dox === "tp" ? "탐구" : "수행평가"} 하자`), 200);
    } else if (sh && !askedRef.current) {
      askedRef.current = true;
      setParams({}, { replace: true });
      setTimeout(() => send("수행평가 완성하기"), 200);
    } else if (q && !askedRef.current) {
      // 홈 화면 물꼬 입력창에서 넘어온 질문 — 바로 보내지 않고 아래 입력창에 다시 적어 둔다
      //   (처음 화면의 바로 가기 · 할 수 있는 일을 먼저 보고, 보내기를 누르면 그때 물어본다 · 주소에서 지워서 새로고침해도 두 번 안 감)
      askedRef.current = true;
      setParams({}, { replace: true });
      setInput(q);
    } else if (c) openChat(c); // 새로고침해도 보던 대화 그대로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 새 질문·생각 단계가 생기면 맨 아래로 — 입력창에 가리지 않게 여백(scroll-mb)을 두고,
  // 광고 그림이 늦게 떠서 밀리는 경우를 위해 조금 뒤에 한 번 더 내린다
  // AI 답이 오면 맨 아래(고르는 카드)가 아니라 그 답의 첫머리부터 보여 준다 — 내용을 읽고 아래 카드에서 고르게
  useEffect(() => {
    const answered = !busy && msgs.length > 0 && msgs[msgs.length - 1].role === "assistant";
    const go = () => (answered && lastBotRef.current
      ? lastBotRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
      : endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    go();
    const t = setTimeout(go, 400);
    return () => clearTimeout(t);
  }, [msgs, busy, steps.length]);

  const paidNow = !!usage?.paid_until;
  // 귀찮게 — 팝업이 알아서 뜬다 (무료만)
  //  ① 방금 받은 답에 이용권 안내([[이용권]])가 있으면
  //  ② 무료 사용량이 50% · 80%를 처음 넘을 때 (각각 한 번 · 브라우저에 기억)
  const popped = useRef(new Set());
  useEffect(() => {
    if (paidNow || busy || !msgs.length) return;
    const i = msgs.length - 1, m = msgs[i];
    if (m.role === "assistant" && /\[\[\s*이용권\s*\]\]/.test(m.content ?? "") && !popped.current.has(i) && m.at && Date.now() - m.at < 60000) {
      popped.current.add(i);
      setBuy({ reason: "answer" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.length, busy, paidNow]);
  useEffect(() => {
    if (FREE_OPEN || paidNow || !usage || usage.pct >= 100) return; // 무료로 연 동안은 사용량 팝업(요금제 안내)을 띄우지 않는다
    const step = usage.pct >= 80 ? 80 : usage.pct >= 50 ? 50 : 0;
    if (!step) return;
    const key = `sm_upgrade_${step}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return;
    }
    // 무료는 다 써도 새벽 5시에 다시 채워진다 — '더 못 쓴다'고 겁주지 않고, 기다리기 싫을 때 이용권
    const left = `${100 - usage.pct}%`; // 질문 개수가 아니라 실제 쓴 양(토큰) 기준
    setBuy(usage.free_once
      ? { reason: `usage${step}`, title: `무료 맛보기가 ${left} 남았어요`, desc: "맛보기를 다 쓰면 그다음부터는 매일 새벽 5시에 질문이 다시 채워져요. 기다리지 않고 바로 계속 쓰려면 이용권이에요 (한 달 10,900원부터)." }
      : { reason: `usage${step}`, title: `오늘 무료 사용량이 ${left} 남았어요`, desc: "다 써도 내일 새벽 5시에 다시 채워져요. 기다리지 않고 바로 계속 쓰려면 이용권이에요 (한 달 10,900원부터)." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usage?.pct, paidNow]);

  const [practice, setPractice] = useState(0); // 발표 연습 화면 (과제 번호)
  // 학교 · 학년을 바꾸면 (SchoolGate) 그 학교 평가계획으로 수행평가를 다시 시작한다
  const sendRef = useRef(null);
  sendRef.current = send;
  useEffect(() => {
    const on = () => sendRef.current?.("수행평가 완성하기");
    window.addEventListener("sm:school-saved", on);
    return () => window.removeEventListener("sm:school-saved", on);
  }, []);

  if (loading) return <div className="min-h-[60vh]" />;
  if (!user) return <LoginGate title="물꼬 입시 AI" desc="내 생기부 기록을 같이 보고 답해 드려요." />;

  // 📷 안내문 사진 → 저장소(school-task-files/<내 id>/chat/…)에 올리고 경로를 메시지로 보낸다 → 물꼬가 수행평가 완성을 시작
  async function uploadPhotos(e, prefix = "") {
    const files = [...(e.target.files ?? [])].filter((f) => /^image\/|pdf/.test(f.type)).slice(0, 6);
    e.target.value = "";
    if (!files.length || !user) return;
    setUploading(true);
    const paths = [];
    for (const f of files) {
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/chat/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await supabase.storage.from("school-task-files").upload(path, f, { contentType: f.type });
      if (!error) paths.push(path);
    }
    setUploading(false);
    if (!paths.length) return setErr("사진을 올리지 못했어요. 잠시 뒤 다시 해 주세요.");
    track("suhaeng_photo");
    send(`${prefix ? `${prefix}\n` : ""}안내문 사진 ${paths.length}장을 올렸어 [[사진: ${paths.join(" | ")}]]`);
  }

  async function send(text) {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    setErr("");
    setInput("");
    // 수행평가 질문도 서버로 보낸다 — 학교 평가계획이 있으면 물꼬가 그 학교 자료로 답하고, 없으면 서버가 '준비 중'을 돌려준다 (AI 안 부름)
    const withOpening = msgs.length === 0 && opening && text === openingPick.current ? opening : "";
    setMsgs((m) => [...(withOpening && !m.length ? [{ role: "assistant", content: withOpening, opening: true }] : []), ...m, { role: "user", content: q }]);
    setBusy(true);
    setSteps([]);
    setStartedAt(Date.now());
    let data = null, error = null;
    try {
      const r = await askAgent({ message: q, chat_id: chatId, ...(withOpening ? { opening: withOpening } : {}) }, (t) => setSteps((st) => (st[st.length - 1] === t ? st : [...st, t])));
      data = r.result;
      if (r.status >= 400) error = { status: r.status };
    } catch (e) {
      error = e;
    }
    setBusy(false);
    if (data?.usage) setUsage(data.usage);
    if (data?.need_pay) {
      setNeedPay(true);
      if (FREE_OPEN) setLimitPop(true);
      if (!FREE_OPEN) setBuy({ reason: "limit", title: "오늘 무료 사용량을 다 썼어요", desc: "새벽 5시에 다시 채워져요. 지금 바로 계속 쓰려면 이용권(한 달 10,900원부터)으로 물꼬를 무제한 · 광고 없이 써요." });
      setMsgs((m) => m.slice(0, withOpening ? -2 : -1));
      setInput(q);
      return;
    }
    if (error || !data?.answer) {
      const msg = data?.error;
      setErr(msg || "답을 받지 못했어요. 잠시 뒤 다시 물어봐 주세요.");
      setMsgs((m) => m.slice(0, withOpening ? -2 : -1));
      setInput(q);
      return;
    }
    setChatId(data.chat_id);
    if (String(data.chat_id) !== params.get("c")) setParams({ c: String(data.chat_id), ...(focusRef.current ? { f: `${focusRef.current.kind}:${focusRef.current.subj}` } : {}) }, { replace: true });
    setMsgs((m) => [...m, { role: "assistant", content: data.answer, at: Date.now() }]);
    watchMemory(msgs.length + (withOpening ? 2 : 1)); // 방금 받은 답의 번호 (내 질문 다음 칸)
    setClosedCard(false);
    loadChats();
  }

  async function openChat(id) {
    setMemNote(null);
    setShowList(false);
    const { data } = await supabase.from("agent_chats").select("id,messages").eq("id", id).maybeSingle();
    if (!data) return;
    setChatId(data.id);
    setMsgs((data.messages ?? []).map((m) => ({ role: m.role, content: m.content })));
    setErr("");
    setNeedPay(false);
    setClosedCard(false);
    setParams({ c: String(data.id) }, { replace: true });
  }
  function newChat() {
    setMemNote(null);
    setChatId(null);
    setMsgs([]);
    setErr("");
    setNeedPay(false);
    setShowList(false);
    setParams({}, { replace: true });
  }
  async function deleteChat(id) {
    if (!window.confirm("이 대화를 지울까요?")) return;
    await supabase.from("agent_chats").delete().eq("id", id);
    if (id === chatId) newChat();
    loadChats();
  }

  const paid = !!usage?.paid_until;

  const invite = usage?.invite ?? null;

  return (
    <div className="min-h-[80vh] bg-white">
     {practice > 0 && <PracticeRoom taskId={practice} onClose={() => setPractice(0)} onDone={(t) => send(t)} />}
     <div className="mx-auto flex max-w-6xl">
      {/* 컴퓨터: 왼쪽 대화 목록 */}
      <aside className={`${focus ? "hidden" : "hidden md:block"} w-[260px] shrink-0 border-r border-gray-100 px-3 py-5`}>
        <div className="sticky top-20 h-[calc(100vh-7rem)]">
          <ChatList chats={chats} chatId={chatId} onOpen={openChat} onNew={newChat} onDelete={deleteChat} top={<><UsageBar usage={usage} pending={pending} /><MemoryBox refreshKey={msgs.length} /></>} />
        </div>
      </aside>
      {/* 휴대폰: 버튼을 누르면 왼쪽에서 열림 */}
      {showList && (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setShowList(false)}>
          <div className="h-full w-[82%] max-w-[300px] bg-white px-3 py-5" onClick={(e) => e.stopPropagation()}>
            <ChatList chats={chats} chatId={chatId} onOpen={(id) => { setShowList(false); openChat(id); }} onNew={newChat} onDelete={deleteChat} top={<MemoryBox refreshKey={msgs.length} />} />
          </div>
        </div>
      )}

     <main className="min-w-0 flex-1">
      <div className={`${WIDTH} pb-6 pt-6`}>
        {focus ? (
          // 그 과제만 하는 화면 — 위에 '로드맵으로' · 과목 이름 (대화 목록 · 새 대화 · 바로 가기 없음)
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-3">
            <button onClick={() => goRoad("/")} className="h-9 flex-none border border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-700 hover:border-gray-500">‹ 로드맵으로</button>
            <p className="min-w-0 truncate text-[16px] font-black text-gray-900">
              {focus.subj && !/^(진로|기타)$/.test(focus.subj) ? `${focus.subj} ` : focus.subj === "진로" ? "진로 " : ""}{focus.kind === "tp" ? "탐구" : "수행평가"}
            </p>
            <span className="w-[86px] flex-none" />
          </div>
        ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[22px] font-extrabold" style={{ color: NAVY }}>물꼬 입시 AI</p>
          <div className="flex shrink-0 gap-1.5 md:hidden">
            <button onClick={() => setShowList(true)} className="h-9 rounded bg-white px-3 text-[12.5px] font-bold text-gray-600 ring-1 ring-gray-200">대화 목록</button>
            <button onClick={newChat} className="h-9 rounded px-3 text-[12.5px] font-extrabold text-white" style={{ background: NAVY }}>새 대화</button>
          </div>
        </div>
        )}

        {/* 사용량 — 컴퓨터는 왼쪽 목록 위 · 휴대폰은 위쪽 ☰ 전체 서비스 안 (components/Header) · 그 사이 폭(태블릿)만 여기 */}
        <div className={focus ? "mt-3" : "hidden sm:block md:hidden"}><UsageBar usage={usage} pending={pending} /></div>
        {openPop && opening && <OpeningPopup text={opening} onClose={closeOpening} plan={openPlan} onCheck={checkTask} />}
        {limitPop && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6" onClick={() => setLimitPop(false)}>
            <div className="w-full max-w-sm bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
              <p className="text-[17px] font-black text-gray-900">오늘 무료 사용량을 다 썼어요</p>
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
                {(() => { const h = new Date().getHours(); return h < 5 ? "오늘 새벽 5시" : "내일 새벽 5시"; })()}에 다시 채워져요.
                <br />보내려던 질문은 입력창에 그대로 남겨 뒀어요.
              </p>
              <button onClick={() => setLimitPop(false)} className="mt-5 h-11 w-full bg-sm-navy text-[14.5px] font-extrabold text-white">확인</button>
            </div>
          </div>
        )}
        <UpgradeModal
          open={Boolean(buy) && !paid}
          reason={buy?.reason ?? "button"}
          title={buy?.title}
          desc={buy?.desc}
          onClose={() => setBuy(false)}
        />
        {pending && !paid && (
          <p className="mt-2 rounded bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">
            이용권 입금 확인 중이에요 ({Number(pending.amount).toLocaleString()}원 · {pending.depositor}). 확인되면 바로 열려요.
          </p>
        )}


        {msgs.length === 0 && !focus && (
          <div className="mt-8 pb-10 sm:mt-10">
            {/* 바로 가기 주황 버튼 줄은 없앰 (2026-11-13) — 수행평가 · 탐구는 입시 로드맵 과목에서, 면접은 아래 탭 '면접'에서 */}
            {/* 물꼬 캐릭터 — 버튼과 인사 사이 (그림: public/images/mulkko.png) */}
            <img src="/images/mulkko.png" alt="물꼬" className="mx-auto mt-4 w-44 select-none sm:mt-6 sm:w-52" draggable="false" />

            {/* 인사 — 물꼬 그림 밑 */}
            <p className="mt-6 text-center text-[13.5px] leading-relaxed text-gray-600">
              <b className="font-extrabold text-gray-900">안녕하세요, 물꼬예요.</b>
              <br />
              모집요강·입결부터 내 생기부, 면접, 탐구주제까지 편하게 물어보세요.
            </p>

            {/* 이번 달에 많이 묻는 것 — 학년 × 달 (학년 모르면 고2 기준) */}
            {(() => {
              const mon = new Date().getMonth() + 1;
              const g = SEASON_Q[grade === "N수" ? "고3" : grade] ? (grade === "N수" ? "고3" : grade) : "고2";
              const qs = SEASON_Q[g][seasonKey(mon)] ?? [];
              return qs.length ? (
                <div className="mt-6">
                  <p className="text-center text-[12.5px] font-bold text-gray-500">{grade ? `${grade} · ` : ""}{mon}월에 많이 묻는 것</p>
                  <div className="mt-2 flex flex-col items-center gap-2">
                    {qs.map((q) => (
                      <button key={q} onClick={() => send(q)} className="rounded bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-700 ring-1 ring-gray-200 hover:ring-gray-400">{q}</button>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {msgs.map((m, i) => (m.role === "user" ? (
            <div key={i} className="ml-10 max-w-[80%] self-end whitespace-pre-line rounded bg-[#F2F3F5] px-4 py-2.5 text-[15px] leading-relaxed text-gray-900">{showUser(m.content)}</div>
          ) : (
            <div key={i} ref={i === msgs.length - 1 ? lastBotRef : undefined} className="mr-4 scroll-mt-24">
              {(() => {
                const { body, questions, pass, form, invite: inv, univReq, plan, routine, acts, senior, prep, note, voice, suhaeng, schoolChg, speech, pptTask, docFile, practiceTask, reportId, designTask, tamgu } = splitChoices(m.content);
                const last = i === msgs.length - 1;
                return (
                  <>
                    {/* [[PPT]] 자리(@@PPT@@)에 PPT 카드를 끼운다 — ① PPT 받기 → ② 대본 → ③ 연습 순서 그대로 */}
                    {body && body.split("@@PPT@@").map((part, pi, all) => (
                      <div key={`b${pi}`}>
                        {part.trim() && <div className="py-1 text-[15px] leading-[1.75] text-gray-800"><Rich text={part} /></div>}
                        {pi < all.length - 1 && pptTask > 0 && <PptButton taskId={pptTask} />}
                      </div>
                    ))}
                    {body && !m.opening && !(last && busy) && body.length > 300 && <SaveToHome question={msgs[i - 1]?.content} answer={body.replace(/\n?@@PPT@@\n?/g, "\n")} chatId={chatId} />}
                    {univReq && <UnivRequestCard key={`u${i}`} req={univReq} question={msgs[i - 1]?.content} />}
                    {routine && body && <RoutineSaveCard key={`r${i}`} text={body} onBuy={() => setBuy(true)} />}
                    {acts.map((id) => <ActionCard key={`a${id}`} id={id} onBuy={() => setBuy(true)} />)}
                    {senior && (
                      <Link to="/sb" className="mt-2 flex items-center justify-between gap-3 rounded bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">합격 선배 생기부 원본 보기</b>
                          <small className="text-[12.5px] text-gray-500">물꼬가 참고한 선배 생기부를 직접 열어 볼 수 있어요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>보러 가기 ›</span>
                      </Link>
                    )}
                    {voice && (
                      <Link to="/voice" state={{ from: "/agent" }} className="mt-2 flex items-center justify-between gap-3 rounded bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">건의함에 자료 요청하기</b>
                          <small className="text-[12.5px] text-gray-500">필요한 대학 · 자료를 남기면 먼저 넣어 드려요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">남기러 가기 ›</span>
                      </Link>
                    )}
                    {note && (
                      <Link to="/" className="mt-2 flex items-center justify-between gap-3 rounded bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">입시 로드맵에 지난 학년 활동 적기</b>
                          <small className="text-[12.5px] text-gray-500">과목을 눌러 그때 한 수행평가 · 탐구를 적으면 물꼬가 이어서 맞춰 줘요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">적으러 가기 ›</span>
                      </Link>
                    )}
                    {schoolChg && (
                      <button onClick={() => window.dispatchEvent(new Event("sm:school-change"))} disabled={busy} className="mt-2 flex w-full items-center justify-between gap-3 rounded bg-white p-4 text-left ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">학교 · 학년 바꾸기</b>
                          <small className="text-[12.5px] text-gray-500">바꾸면 그 학교 평가계획으로 다시 시작해요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>바꾸기 ›</span>
                      </button>
                    )}
                    {tamgu && (
                      <button onClick={() => send("탐구주제 하자")} disabled={busy} className="mt-2 flex w-full items-center justify-between gap-3 rounded border border-gray-200 bg-white p-4 text-left hover:border-gray-400">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">탐구 설계 시작하기</b>
                          <small className="text-[12.5px] text-gray-500">내 주제 · 흔한가 진단 · 추천 중 골라서 → 질문 4~5개 → 완성본 → 보고서 디자인</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-gray-800 px-3.5 text-[13px] font-extrabold text-white">시작 ›</span>
                      </button>
                    )}
                    {suhaeng && (
                      <button onClick={() => send("수행평가 완성하기")} disabled={busy} className="mt-2 flex w-full items-center justify-between gap-3 rounded bg-white p-4 text-left ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">수행평가 완성하기</b>
                          <small className="text-[12.5px] text-gray-500">여기서 바로 · 고르고 답하면 완성본 · 채점 · 세특까지</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">시작 ›</span>
                      </button>
                    )}
                    {prep && (
                      <Link to="/prep" state={{ from: "agent" }} className="mt-2 flex items-center justify-between gap-3 rounded bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">수시 면접 준비</b>
                          <small className="text-[12.5px] text-gray-500">지원 대학별 기출문제 · 생기부 예상질문 연습</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">연습하러 가기 ›</span>
                      </Link>
                    )}
                    {plan && myPlan !== true && last && !busy && (
                      <button onClick={() => send("내 입시 플랜 짜 줘")} className="mt-2 flex w-full items-center justify-between gap-3 rounded bg-white p-4 text-left ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">내 입시 플랜 만들기</b>
                          <small className="text-[12.5px] text-gray-500">학년 · 지금까지 한 것을 적으면 이번 주 미션까지 짜 드려요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>만들기 ›</span>
                      </button>
                    )}
                    {plan && myPlan === true && (
                      <Link to="/plan?tab=exam" state={{ from: "agent" }} className="mt-2 flex items-center justify-between gap-3 rounded bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">내 입시 플랜</b>
                          <small className="text-[12.5px] text-gray-500">이번 주 미션 체크 · 플랜은 저장되고 매주 새 미션</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>체크하러 가기 ›</span>
                      </Link>
                    )}
                    {pass && !paid && (pending
                      ? <p className="mt-2 rounded bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">이용권 입금 확인 중이에요. 확인되면 바로 광고가 없어져요.</p>
                      : <button onClick={() => setBuy({ reason: "card" })} className="mt-2 inline-flex h-9 items-center rounded bg-white px-4 text-[13px] font-extrabold ring-1 ring-sm-navy/30 hover:ring-sm-navy" style={{ color: NAVY }}>요금제 보기 ›</button>)}
                    {docFile && <DocButton taskId={docFile.id} kind={docFile.kind} paid={Boolean(paid)} onBuy={(b) => setBuy(b)} />}
                    {practiceTask > 0 && (
                      <button onClick={() => setPractice(practiceTask)} disabled={busy} className="mt-3 flex w-full items-center justify-between gap-3 rounded border border-gray-200 bg-white p-4 text-left hover:border-gray-400">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">발표 연습하러 가기</b>
                          <small className="text-[12.5px] text-gray-500">위에 슬라이드 · 아래에 표시된 대본 · 녹음하고 코칭 받기</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-gray-800 px-3.5 text-[13px] font-extrabold text-white">열기 ›</span>
                      </button>
                    )}
                    {reportId > 0 && (
                      <Link to={`/inquiry/${reportId}/report`} state={{ from: "agent" }} className="mt-3 flex items-center justify-between gap-3 rounded border border-gray-200 bg-white p-4 hover:border-gray-400">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">보고서 디자인하러 가기</b>
                          <small className="text-[12.5px] text-gray-500">디자인 30가지 · 사진 · 글씨체 · 색 바꾸기 · PDF 저장</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded bg-gray-800 px-3.5 text-[13px] font-extrabold text-white">열기 ›</span>
                      </Link>
                    )}
                    {speech > 0 && last && !busy && <SpeechCard minutes={speech} onDone={(t) => send(t)} />}
                    {form && last && !busy && !closedCard && (
                      <InputCard key={`f${i}`} form={form} onSubmit={(t) => send(t)} onClose={() => setClosedCard(true)} onPhotos={uploadPhotos} uploading={uploading} />
                    )}
                    {!form && questions.length > 0 && last && !busy && !closedCard && (
                      <QuestionCard key={i} questions={questions} onSubmit={(t) => send(t)} onClose={() => setClosedCard(true)} onPhotos={uploadPhotos} uploading={uploading} />
                    )}
                    {designTask > 0 && <DesignGo taskId={designTask} />}
                  </>
                );
              })()}
              {/* 무료 사용자: 답 아래 광고 (이용권이면 없음 · 답 2개마다) · 광고가 없으면 칸도 안 보인다 */}
              {memNote?.at === i && (
                <button onClick={() => setShowList(true)} className="mt-2 flex w-full items-start gap-2 rounded bg-[#EEF2FF] px-3.5 py-2.5 text-left">
                  <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-gray-700">
                    <b style={{ color: NAVY }}>물꼬가 기억했어요</b> · {memNote.items.join(" · ")}
                    <small className="mt-0.5 block text-[11.5px] text-gray-400">다음에 다시 안 물어봐요 · 틀린 건 「물꼬가 기억하는 나」에서 지울 수 있어요</small>
                  </span>
                </button>
              )}
              {/* 광고는 답 2개마다 한 번 (2번째 · 4번째 · 6번째 답 아래) */}
              {!paid && msgs.slice(0, i + 1).filter((x) => x.role === "assistant").length % 2 === 0 && (
                <AdSlot slot="home_top" variant="card" pick={msgs.slice(0, i + 1).filter((x) => x.role === "assistant").length / 2 - 1} onHide={FREE_OPEN ? undefined : () => setBuy(true)} className="mt-3" />
              )}
            </div>
          )))}
          {busy && <Thinking steps={steps} startedAt={startedAt} />}
          {err && <p className="text-[13px] font-semibold text-red-500">{err}</p>}
          {needPay && (
            <div className="rounded bg-white p-4 ring-1 ring-black/5">
              <p className="text-[15px] font-extrabold text-gray-900">오늘 무료 사용량을 다 썼어요</p>
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{FREE_OPEN ? "새벽 5시에 다시 채워져요. 그때 이어서 물어봐 주세요." : "새벽 5시에 다시 채워져요. 지금 바로 계속 쓰려면 이용권(한 달 10,900원부터)으로 물꼬를 무제한 · 광고 없이 써요."}</p>
              {FREE_OPEN ? null : pending
                ? <p className="mt-3 rounded bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">이용권 입금 확인 중이에요. 확인되면 바로 열려요.</p>
                : <button onClick={() => setBuy({ reason: "limit" })} className="mt-3 h-12 w-full rounded bg-sm-navy text-[14.5px] font-extrabold text-white">요금제 보기 ›</button>}
            </div>
          )}
          {/* 로드맵에서 온 과제를 끝냈으면 — 내 생기부에 들어갔으니 로드맵으로 */}
          {focus && !busy && msgs.some((m) => m.role === "assistant" && /내 입시 홈 → 내 생기부/.test(m.content ?? "")) && (
            <div className="mt-4 border border-sm-navy bg-[#EEF2FF] p-4">
              <p className="text-[14.5px] font-extrabold text-gray-900">내 생기부에 들어갔어요</p>
              <p className="mt-1 text-[13px] text-gray-600">로드맵 {focus.subj && !/^(기타)$/.test(focus.subj) ? `${focus.subj} 칸` : ""}에서 완성본 · PDF를 다시 볼 수 있어요. 여기서 계속 고치거나 발표 연습을 해도 돼요.</p>
              <button onClick={() => goRoad("/")} className="mt-3 h-11 w-full bg-sm-navy text-[14px] font-extrabold text-white">로드맵에서 보기 ›</button>
            </div>
          )}
          <div ref={endRef} className="h-2 scroll-mb-28" />
        </div>
      </div>

      <div className="sticky bottom-0 z-30 bg-white pb-[env(safe-area-inset-bottom)]">
        {below && msgs.length > 0 && (
          <div className="pointer-events-none absolute -top-14 left-0 right-0 flex justify-center">
            <button
              onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
              className="pointer-events-auto h-10 border border-gray-300 bg-white px-4 text-[13px] font-bold text-gray-700 shadow-md hover:border-gray-500"
            >
              맨 아래로
            </button>
          </div>
        )}
        {/* 무료 사용량이 절반을 넘으면 입력창 위에 계속 보인다 */}
        {!paid && usage?.pct >= 50 && (
          <button onClick={() => !FREE_OPEN && setBuy({ reason: "bar" })} className={`${WIDTH} flex w-full items-center justify-between gap-2 pt-2.5 text-left`}>
            <span className="text-[12.5px] font-bold" style={{ color: usage.pct >= 100 ? PINK : "#C2410C" }}>
              {usage.pct >= 100 ? "오늘 무료를 다 썼어요 · 새벽 5시에 다시 채워져요" : `무료 사용량이 ${Math.max(0, 100 - usage.pct)}% 남았어요`}
            </span>
            {!FREE_OPEN && <span className="flex-none text-[12.5px] font-extrabold" style={{ color: NAVY }}>요금제 보기 ›</span>}
          </button>
        )}
        <div className={`${WIDTH} flex items-end gap-2 py-3`}>
          {/* 📷 수행평가 안내문 사진 · PDF — 올리면 이 채팅에서 바로 수행평가 완성이 시작된다 */}
          <label title="수행평가 안내문 사진 올리기" className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded border border-gray-200 text-[13px] font-bold text-gray-600 ${busy || uploading ? "pointer-events-none opacity-40" : "hover:border-gray-400"}`}>
            {uploading ? "…" : "사진"}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={uploadPhotos} />
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1500))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="입시 · 수행평가 뭐든 물어보세요"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded border border-gray-200 px-3.5 py-2.5 text-[14px] leading-relaxed outline-none focus:border-gray-400"
          />
          <button onClick={() => send()} disabled={busy || !input.trim()} className="h-11 shrink-0 rounded bg-gray-800 px-4 text-[14px] font-extrabold text-white transition-colors hover:bg-gray-900 active:bg-black disabled:bg-gray-200 disabled:text-gray-400">보내기</button>
        </div>
      </div>
     </main>
     </div>
    </div>
  );
}