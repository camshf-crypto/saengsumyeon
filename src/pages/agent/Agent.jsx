import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import LoginGate from "../../components/LoginGate";
import AdSlot from "../../components/AdSlot";
import { refLink } from "../../lib/referral";
import PassSheet from "../../components/PassSheet"; // 이용권 결제 (모든 유료 기능 공통)
import { PASS_PRICE, PASS_PRODUCTS } from "../../lib/pass";
import { track } from "../../lib/track";

/*
 * 🤖 입시 상담 AI — /agent
 *   대학 입시 DB(모집요강·시행계획·입결·면접 스타일) + 내 생수면 기록(생기부 노트·진단·예상질문·지원동기·성적)을 보고 답한다
 *   사용량: 질문 개수가 아니라 실제 AI 비용으로 센다 — '이번 주 사용량 ○%' 막대 + 초기화 시각(매주 월요일 0시)
 *   무료 회원: 주간 한도 · 친구가 내 링크로 가입하면 한도가 늘어남 (4명까지) · 답 아래 광고
 *   · 무료로 받은 답 아래에는 광고 배너(AdSlot home_top 광고를 같이 씀)
 *   이용권(한 달·6개월·1년 — src/lib/pass.js PLANS)이 있으면 사용량 크게 · 광고 없음
 *   대화는 agent_chats 에 저장 — 왼쪽 대화 목록(휴대폰은 '대화 목록' 버튼)에서 다시 연다 · 주소 ?c=번호 로 새로고침해도 이어짐
 *   이용권 12,900원부터 — 계좌 입금 → '입금했어요' → 관리자 승인되면 바로 열림 (rpc agent_order, components/PassSheet)
 *   면접 예상질문 · 꼬리질문은 처음 화면 타일에서 뺐다 — 수시 면접 준비(/prep)에서 한다
 *   에이전트 (sql/sm_96): 물꼬가 기억하는 나(물꼬 노트 — 대화마다 물꼬가 스스로 고침) · 해 줄까요? 카드 [[할일:번호]] (면접 준비에 학교 넣기 · 효과 시험 만들기)
 * DB: sql/sm_76 · sm_77 · sm_78_agent.sql · sm_80_agent_order.sql · 서버 함수: supabase/functions/agent
 */

const NAVY = "#1E2A5A";
const PINK = "#FD1673";
const WIDTH = "mx-auto max-w-2xl px-4 sm:px-5";
/* 처음 화면 — 물꼬가 할 수 있는 일 (누르면 그 기능 예시 질문을 바로 보냄) */
const FEATURES = [
  { title: "모집요강·입결", desc: "37개 대학 2027·2028 전형·수능최저 · 일부 대학 입결", q: "경희대 2027이랑 2028 뭐가 달라져?" },
  { title: "흔한가 진단", desc: "내 탐구주제·지원동기·독서가 얼마나 흔한지", q: "내 탐구주제 흔한가 진단해 줘" },
  { title: "내 생기부 맞춤", desc: "생기부 노트·진단을 보고 학교·전형 추천", q: "내 생기부로 학종 쓰기 좋은 학교 추천해 줘" },
  { title: "학습법", desc: "성적·많이 틀리는 단원으로 내 공부법 진단 · 루틴 짜기", q: "내 공부법 진단해 줘" },
  { title: "세특·독서", desc: "희망 학과에 맞는 세특 방향 · 이어 읽을 책 추천", q: "내 학과에 맞는 세특 방향이랑 읽을 책 추천해 줘" },
  { title: "입시 플랜", desc: "목표 대학·학과로 과목·활동·이번 주 미션까지", q: "내 입시 플랜 짜 줘" },
  { title: "권장과목", desc: "29개 대학이 발표한 학과별 들어야 할 과목", q: "컴퓨터공학과 가려면 고등학교 때 무슨 과목 들어야 돼?" },
  { title: "탐구주제", desc: "학과별 실제 탐구 사례로 내 주제 찾기", q: "탐구주제 찾아 줘" },
  { title: "수행평가", desc: "과목 양식에 맞춰 수행평가 준비 돕기", soon: true },
];
// 수행평가는 준비 중 — 타일을 누르거나 채팅으로 물으면 서버에 보내지 않고 바로 안내 (AI 비용 없음)
//   '수행평가 주제' · '수행평가 탐구'처럼 주제를 찾는 질문은 그대로 물꼬가 답한다 (탐구주제로 돕기)
const SOON_TEXT = "**수행평가 도우미는 지금 준비 중이에요.**\n과목별 양식에 맞춰 도와줄 수 있게 만들고 있어요. 열리면 이 화면 타일에서 바로 쓸 수 있어요.\n\n수행평가 **주제**를 찾는 중이라면 지금도 도와줄 수 있어요. '수행평가 탐구주제 추천해 줘'처럼 물어봐 주세요.";
// 바로 가기 4개 — 메인 화면에 있던 타일(면접 준비 · 선배 생기부 · 생기부 진단 · 입시 플랜)을 물꼬 화면으로 옮겼다 · 누르면 그 화면으로 이동
const SHORTCUTS = [
  { to: "/prep", title: "수시 면접 준비", desc: "지원 대학별 면접 4단계" },
  { to: "/sb", title: "선배 생기부 보기", desc: "대학별 합격 사례" },
  { to: "/my/note", title: "내 생기부 진단", desc: "다 적으면 AI 입시 진단" },
  { to: "/plan", title: "내 입시 플랜", desc: "학년별 · 이번 주 할 일" },
];
const isSoon = (q) => /수행\s*평가/.test(q) && !/주제|탐구|발표/.test(q);
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
  const acts = [...new Set([...rest2.matchAll(/\[\[\s*할일\s*[:：]\s*(\d+)\s*\]\]/g)].map((x) => Number(x[1])))].slice(0, 3);
  return { body: rest2.replace(/\[\[\s*할일\s*[:：]\s*\d+\s*\]\]/g, "").replace(/\[\[\s*(이용권|친구초대|플랜|루틴저장|선배|면접준비|노트|건의함)\s*\]\]/g, "").trim(), questions: qs.slice(0, 3), pass, form, invite, univReq, plan, routine, acts, senior, prep, note, voice };
}

/* 입력 카드 — 원래 흔한가 화면처럼 학과·과목·주제를 직접 적어서 한 번에 보낸다 */
const HINT = {
  학년: "고1 · 고2 · 고3",
  학과: "예: 간호학과",
  과목: "예: 생명과학",
  탐구주제: "예: 노인 낙상 사고를 줄이는 병실 환경 조사",
  대학: "예: 가천대 · 안 정했으면 비워 두세요",
  지원동기: "지원동기를 30자 이상 그대로 붙여 넣어 주세요",
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
const LONG = /지원동기|탐구주제|주제|활동|면접 질문|내 답변|지금 공부 방법/;
const MIN = (name) => (/지원동기/.test(name) ? 30 : /내 답변/.test(name) ? 15 : 1);
function InputCard({ form, onSubmit, onClose }) {
  const [vals, setVals] = useState(() => form.fields.map((f) => f.value));
  const minOf = (f) => MIN(f.name);
  const ok = form.fields.every((f, k) => f.optional || vals[k].trim().length >= minOf(f));
  function submit() {
    if (!ok) return;
    onSubmit(form.fields.map((f, k) => `${f.name}: ${vals[k].trim() || "없음"}`).join("\n"));
  }
  return (
    <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/10">
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
                rows={long ? (/지원동기|내 답변|활동/.test(f.name) ? 5 : 2) : undefined}
                onChange={(e) => setVals((v) => v.map((x, j) => (j === k ? e.target.value.slice(0, /지원동기|내 답변|활동/.test(f.name) ? 1200 : 300) : x)))}
                onKeyDown={(e) => { if (!long && e.key === "Enter" && !e.nativeEvent.isComposing) submit(); }}
                placeholder={HINT[f.name] ?? ""}
                className="w-full resize-none rounded-lg bg-[#F8F9FB] px-3 py-2 text-[13.5px] leading-relaxed text-gray-900 outline-none ring-1 ring-transparent placeholder:text-gray-400 focus:ring-gray-300"
              />
              {CHIPS[f.name] && (
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {CHIPS[f.name].map((c) => {
                    const list = vals[k].split(/\s*,\s*/).filter(Boolean);
                    const on = list.includes(c);
                    return (
                      <button type="button" key={c}
                        onClick={() => setVals((v) => v.map((x, j) => (j === k ? (on ? list.filter((y) => y !== c) : [...list, c]).join(", ") : x)))}
                        className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ring-1 ${on ? "text-white ring-transparent" : "bg-white text-gray-600 ring-gray-200"}`}
                        style={on ? { background: NAVY } : undefined}>{c}</button>
                    );
                  })}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <button onClick={submit} disabled={!ok} className="mt-3 h-11 w-full rounded-xl text-[14px] font-extrabold text-white disabled:opacity-30" style={{ background: NAVY }}>
        보내기
      </button>
    </div>
  );
}

/*
 * 학습 다이어리에 넣기 — 물꼬가 짠 하루 · 주간 루틴을 /plan 다이어리로 (sql/sm_91 · 서버 routine_save)
 * 누르면 루틴 줄로 바꿔 저장하고 바로 다이어리 화면으로 넘어간다
 */
function RoutineSaveCard({ text }) {
  const nav = useNavigate();
  const [state, setState] = useState(""); // "" · busy · error 글
  async function save() {
    setState("busy");
    const { data, error } = await supabase.functions.invoke("agent", { body: { action: "routine_save", text } });
    let r = data;
    if (error) { try { r = await error.context?.json?.(); } catch { r = null; } }
    if (r?.count) return nav("/plan", { state: { from: "agent", diary: true } });
    setState(r?.error ?? "잠시 후 다시 해 주세요");
  }
  return (
    <div className="mt-2 rounded-2xl bg-white p-4 ring-1 ring-black/10">
      <b className="block text-[14.5px] font-extrabold text-gray-900">이 루틴을 내 학습 다이어리에 넣을까요?</b>
      <small className="mt-0.5 block text-[12.5px] leading-relaxed text-gray-500">매일 할 일을 체크하고, 어떻게 하는지 공부법도 같이 보여 줘요. 한 줄 일기 · 공부 시간도 남길 수 있어요.</small>
      <button onClick={save} disabled={state === "busy"} className="mt-3 h-11 w-full rounded-xl text-[14px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
        {state === "busy" ? "다이어리에 옮기는 중… (10초쯤)" : "학습 다이어리에 넣고 보러 가기 ›"}
      </button>
      {state && state !== "busy" && <p className="mt-2 text-[12.5px] font-bold text-red-500">{state}</p>}
    </div>
  );
}

/*
 * 해 줄까요? — 물꼬가 직접 해 주겠다고 제안한 일 (sql/sm_96 agent_actions · 서버 agent_action)
 * [네, 해 줘]를 눌러야 실행된다 · 한 번 정하면 대화를 다시 열어도 결과가 그대로 보인다
 */
const ACT_LABEL = { prep_school: "면접 준비", study_test: "효과 시험" };
function ActionCard({ id }) {
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
    if (r?.need_pay) return setErr("이번 주 물꼬 사용량을 다 썼어요. 월요일 0시에 다시 채워져요.");
    if (!r || r.error) return setErr(r?.error ?? "잠시 후 다시 해 주세요");
    setRow((x) => ({ ...x, status: r.status, result: r }));
  }
  if (!row) return null;
  const res = row.result ?? {};
  return (
    <div className={`mt-2 rounded-2xl p-4 ring-1 ${row.status === "done" ? "bg-[#ECFBF3] ring-[#0B8A5E]/20" : row.status === "pending" ? "bg-white ring-black/10" : "bg-[#F8F9FB] ring-black/5"}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex-none rounded-md px-2 py-0.5 text-[11px] font-extrabold text-white" style={{ background: row.status === "done" ? "#0B8A5E" : NAVY }}>{ACT_LABEL[row.kind] ?? "할 일"}</span>
        <div className="min-w-0 flex-1">
          <b className={`block text-[14px] font-extrabold leading-snug ${row.status === "cancelled" ? "text-gray-400 line-through" : "text-gray-900"}`}>{row.title}</b>
          {row.status === "pending" && <small className="mt-0.5 block text-[12px] text-gray-500">물꼬가 대신 해 둘까요?</small>}
          {row.status !== "pending" && res.message && <small className={`mt-0.5 block text-[12.5px] ${row.status === "done" ? "text-[#0B6B4A]" : "text-gray-400"}`}>{res.message}</small>}
        </div>
      </div>
      {row.status === "pending" && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => decide("run")} disabled={Boolean(busy)} className="h-10 flex-1 rounded-xl text-[13.5px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
            {busy === "run" ? (row.kind === "study_test" ? "문제 만드는 중… (30초~1분)" : "하는 중…") : "네, 해 줘"}
          </button>
          <button onClick={() => decide("cancel")} disabled={Boolean(busy)} className="h-10 rounded-xl bg-white px-4 text-[13.5px] font-bold text-gray-500 ring-1 ring-gray-200 disabled:opacity-50">아니요</button>
        </div>
      )}
      {row.status === "done" && res.link && (
        <button onClick={() => nav(res.link)} className="mt-3 h-10 w-full rounded-xl bg-white text-[13.5px] font-extrabold ring-1 ring-[#0B8A5E]/30" style={{ color: "#0B6B4A" }}>{res.link_label ?? "보러 가기"} ›</button>
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
    <div className="mt-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-black/5">
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
      <div className="mt-2 rounded-2xl bg-[#ECFBF3] px-4 py-3.5 text-[13.5px] leading-relaxed text-[#0B6B4A] ring-1 ring-[#0B8A5E]/20">
        <b>{univ} 자료 추가 요청을 받았어요.</b>
        <br />
        요청이 많은 대학부터 자료를 넣고 있어요. 들어오면 같은 질문으로 다시 물어봐 주세요.
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/10">
      <p className="text-[14.5px] font-extrabold text-gray-900">이 대학 자료를 추가해 드릴까요?</p>
      <p className="mt-0.5 text-[12.5px] text-gray-500">요청이 많은 대학부터 넣어요.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-bold text-gray-700">대학</span>
          <input value={univ} onChange={(e) => setUniv(e.target.value.slice(0, 40))} placeholder="예: 한양대 ERICA" className="w-full rounded-lg bg-[#F8F9FB] px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-gray-300" />
        </label>
        <label className="block">
          <span className="mb-1 flex gap-1.5 text-[12.5px] font-bold text-gray-700">학과 <small className="font-medium text-gray-400">선택</small></span>
          <input value={dept} onChange={(e) => setDept(e.target.value.slice(0, 40))} placeholder="예: 건축학과" className="w-full rounded-lg bg-[#F8F9FB] px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-gray-300" />
        </label>
      </div>
      <p className="mb-1.5 mt-3 text-[12.5px] font-bold text-gray-700">어떤 자료가 필요해요? <small className="font-medium text-gray-400">여러 개</small></p>
      <div className="flex flex-wrap gap-1.5">
        {NEEDS.map((n) => (
          <button key={n} type="button" onClick={() => toggle(n)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ring-1 ${needs.includes(n) ? "text-white ring-transparent" : "bg-white text-gray-600 ring-gray-200"}`} style={needs.includes(n) ? { background: NAVY } : undefined}>
            {needs.includes(n) ? "✓ " : ""}{n}
          </button>
        ))}
      </div>
      <input value={memo} onChange={(e) => setMemo(e.target.value.slice(0, 300))} placeholder="한마디 (선택) · 예: 수시 면접 준비 중이에요" className="mt-3 w-full rounded-lg bg-[#F8F9FB] px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-gray-300" />
      {state === "error" && <p className="mt-2 text-[12.5px] font-bold text-red-500">요청을 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.</p>}
      <button onClick={submit} disabled={univ.trim().length < 2 || !needs.length || state === "busy"} className="mt-3 h-11 w-full rounded-xl text-[14px] font-extrabold text-white disabled:opacity-30" style={{ background: NAVY }}>
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
function QuestionCard({ questions, onSubmit, onClose }) {
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
    <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14.5px] font-extrabold text-gray-900">{cur.q || "골라 주세요"}</p>
        <button onClick={onClose} className="text-[20px] leading-none text-gray-400" aria-label="닫기">×</button>
      </div>
      <div className="mt-3 flex flex-col">
        {cur.opts.map((o) => (
          <button key={o.label} onClick={() => (WRITE_OPT(o) ? (setWriting(o), setTimeout(() => inputRef.current?.focus(), 30)) : answer(o.label))} className={`flex items-start gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[#F8F9FB] ${writing?.label === o.label ? "bg-[#F8F9FB]" : ""}`}>
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
          className={`h-9 flex-1 rounded-lg bg-[#F8F9FB] px-3 text-[13px] outline-none ${writing ? "ring-2" : ""}`} style={writing ? { "--tw-ring-color": NAVY } : undefined} />
        {total > 1 && (
          <span className="flex items-center gap-1 text-[12px] text-gray-400">
            <button onClick={() => step > 0 && setStep(step - 1)} disabled={step === 0} className="px-1 disabled:opacity-30">‹</button>
            {step + 1}/{total}
            <button onClick={() => answers[step] && setStep(step + 1)} disabled={!answers[step] || step + 1 >= total} className="px-1 disabled:opacity-30">›</button>
          </span>
        )}
        <button onClick={() => answer(writing ? `${writing.label}: ${typed}` : typed)} disabled={!typed.trim()} className="flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-extrabold text-white disabled:opacity-30" style={{ background: NAVY }} aria-label="보내기">→</button>
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

function Rich({ text }) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const blocks = []; // { type: "p"|"h"|"table"|"item", ... }
  let item = null;
  const LIST = /^\s*([-•*·]|\d+[.)])\s+/;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    if (!l) { item = item && item.kids.length ? null : item; continue; }
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
          <div key={k} className={`flex gap-2.5 ${card ? "rounded-xl bg-[#F8F9FB] px-3.5 py-3" : ""}`}>
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
  const reset = new Date(usage.reset_at);
  const resetText = `${"일월화수목금토"[reset.getDay()]}요일 ${reset.getHours() === 0 ? "0시" : reset.toLocaleTimeString("ko-KR", { hour: "numeric" })}에 초기화`;
  const until = usage.paid_until ? new Date(usage.paid_until).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "";
  const full = usage.pct >= 100;
  return (
    <div className={`${className} rounded-2xl bg-white px-4 py-3 ring-1 ring-black/5`}>
      <div className="flex items-center justify-between gap-2 whitespace-nowrap text-[12.5px]">
        <p className="font-bold text-gray-800">이번 주 사용량</p>
        <p className="font-extrabold" style={{ color: full ? PINK : NAVY }}>{usage.pct}% 사용됨</p>
      </div>
      {usage.paid_until && <p className="mt-1 inline-block rounded-md bg-[#EEF2FF] px-1.5 py-0.5 text-[11px] font-bold" style={{ color: NAVY }}>이용권 · {until}까지</p>}
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
    <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <div>
        <p className="text-[13.5px] font-extrabold text-gray-900">{topic ? "친구 초대하면 탐구주제 흔한가 +3번" : `친구 초대하면 주간 사용량 +${invite.plus_pct}%`}</p>
        <p className="mt-0.5 text-[11.5px] text-gray-500">내 링크로 친구가 가입할 때마다 · 지금까지 {invite.friends}명 (최대 {invite.max}명)</p>
        {msg && <p className="mt-1 text-[11.5px] font-bold" style={{ color: PINK }}>{msg}</p>}
      </div>
      <button onClick={copy} disabled={!code} className="h-10 shrink-0 rounded-xl px-3.5 text-[13px] font-extrabold text-white disabled:opacity-40" style={{ background: PINK }}>링크 복사</button>
    </div>
  );
}

/* 대화 목록 — 컴퓨터는 왼쪽에 늘 보이고, 휴대폰은 버튼을 누르면 왼쪽에서 열린다 */
function ChatList({ chats, chatId, onOpen, onNew, onDelete, top = null }) {
  const today = new Date().toDateString();
  const groups = [["오늘", chats.filter((c) => new Date(c.updated_at).toDateString() === today)], ["이전", chats.filter((c) => new Date(c.updated_at).toDateString() !== today)]];
  return (
    <div className="flex h-full flex-col">
      <button onClick={onNew} className="flex h-11 items-center justify-center gap-1.5 rounded-xl text-[14px] font-extrabold text-white" style={{ background: NAVY }}>＋ 새 대화</button>
      {top}
      <div className="mt-4 flex-1 overflow-y-auto">
        {chats.length === 0 && <p className="px-2 text-[13px] text-gray-400">아직 대화가 없어요. 물어본 내용은 여기에 저장돼요.</p>}
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label} className="mb-4">
            <p className="px-2 pb-1.5 text-[11.5px] font-bold text-gray-400">{label}</p>
            {list.map((c) => (
              <div key={c.id} className={`group flex items-center rounded-lg ${c.id === chatId ? "bg-white ring-1 ring-black/5" : "hover:bg-white/70"}`}>
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
    <div className="mr-4 rounded-2xl rounded-bl-md bg-white px-4 py-3.5 ring-1 ring-black/5">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: PINK }} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: PINK }} />
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
                ? <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-gray-200" style={{ borderTopColor: NAVY }} />
                : <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] text-[#15803D]">✓</span>}
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
  const [buy, setBuy] = useState(false); // 이용권 사기 창
  const [closedCard, setClosedCard] = useState(false); // 질문 카드를 닫았는지 (새 답이 오면 다시 열림)
  const [pending, setPending] = useState(null); // 입금 확인 중인 이용권 주문
  const [myPlan, setMyPlan] = useState(null); // 내 입시 플랜이 있는지 (null = 모름) — 없으면 [[플랜]] 버튼이 '만들기'로
  useEffect(() => {
    if (!user) return;
    supabase.from("study_plans").select("id").limit(1).then(({ data, error }) => setMyPlan(error ? null : (data ?? []).length > 0));
  }, [user, msgs.length]);
  const [chats, setChats] = useState([]);
  const [showList, setShowList] = useState(false); // 휴대폰 대화 목록
  const [params, setParams] = useSearchParams();
  const endRef = useRef(null);
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
    if (q && !askedRef.current) {
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

  if (loading) return <div className="min-h-[60vh]" />;
  if (!user) return <LoginGate title="물꼬 입시 AI" desc="내 생기부 기록을 같이 보고 답해 드려요. 친구를 초대하면 사용량이 늘어나요." />;

  async function send(text) {
    const q = String(text ?? input).trim();
    if (!q || busy) return;
    setErr("");
    setInput("");
    if (isSoon(q)) {
      setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: SOON_TEXT }]);
      return;
    }
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    setSteps([]);
    setStartedAt(Date.now());
    let data = null, error = null;
    try {
      const r = await askAgent({ message: q, chat_id: chatId }, (t) => setSteps((st) => (st[st.length - 1] === t ? st : [...st, t])));
      data = r.result;
      if (r.status >= 400) error = { status: r.status };
    } catch (e) {
      error = e;
    }
    setBusy(false);
    if (data?.usage) setUsage(data.usage);
    if (data?.need_pay) {
      setNeedPay(true);
      setMsgs((m) => m.slice(0, -1));
      setInput(q);
      return;
    }
    if (error || !data?.answer) {
      const msg = data?.error;
      setErr(msg || "답을 받지 못했어요. 잠시 뒤 다시 물어봐 주세요.");
      setMsgs((m) => m.slice(0, -1));
      setInput(q);
      return;
    }
    setChatId(data.chat_id);
    if (String(data.chat_id) !== params.get("c")) setParams({ c: String(data.chat_id) }, { replace: true });
    setMsgs((m) => [...m, { role: "assistant", content: data.answer }]);
    watchMemory(msgs.length + 1); // 방금 받은 답의 번호 (내 질문 다음 칸)
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
    <div className="min-h-[80vh] bg-[#F4F5F7]">
     <div className="mx-auto flex max-w-6xl">
      {/* 컴퓨터: 왼쪽 대화 목록 */}
      <aside className="hidden w-[260px] shrink-0 border-r border-gray-200 px-3 py-5 md:block">
        <div className="sticky top-20 h-[calc(100vh-7rem)]">
          <ChatList chats={chats} chatId={chatId} onOpen={openChat} onNew={newChat} onDelete={deleteChat} top={<><UsageBar usage={usage} pending={pending} /><MemoryBox refreshKey={msgs.length} /></>} />
        </div>
      </aside>
      {/* 휴대폰: 버튼을 누르면 왼쪽에서 열림 */}
      {showList && (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setShowList(false)}>
          <div className="h-full w-[82%] max-w-[300px] bg-[#F4F5F7] px-3 py-5" onClick={(e) => e.stopPropagation()}>
            <ChatList chats={chats} chatId={chatId} onOpen={(id) => { setShowList(false); openChat(id); }} onNew={newChat} onDelete={deleteChat} top={<MemoryBox refreshKey={msgs.length} />} />
          </div>
        </div>
      )}

     <main className="min-w-0 flex-1">
      <div className={`${WIDTH} pb-6 pt-6`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[22px] font-extrabold" style={{ color: NAVY }}>물꼬 입시 AI</p>
          <div className="flex shrink-0 gap-1.5 md:hidden">
            <button onClick={() => setShowList(true)} className="h-9 rounded-lg bg-white px-3 text-[12.5px] font-bold text-gray-600 ring-1 ring-gray-200">대화 목록</button>
            <button onClick={newChat} className="h-9 rounded-lg px-3 text-[12.5px] font-extrabold text-white" style={{ background: NAVY }}>새 대화</button>
          </div>
        </div>

        {/* 사용량 — 컴퓨터는 왼쪽 목록 위 · 휴대폰은 위쪽 ☰ 전체 서비스 안 (components/Header) · 그 사이 폭(태블릿)만 여기 */}
        <div className="hidden sm:block md:hidden"><UsageBar usage={usage} pending={pending} /></div>
        <PassSheet
          open={buy}
          title="생수면 이용권"
          headline="물꼬 입시 AI · 꼬리질문 · 흔한가까지 전부"
          onClose={() => setBuy(false)}
          onOrdered={(o) => setPending(o)}
          onUnlocked={() => {
            setBuy(false);
            setPending(null);
            supabase.functions.invoke("agent", { body: { action: "status" } }).then(({ data }) => data?.usage && setUsage(data.usage));
          }}
        />
        {pending && !paid && (
          <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">
            이용권 입금 확인 중이에요 ({Number(pending.amount).toLocaleString()}원 · {pending.depositor}). 확인되면 바로 열려요.
          </p>
        )}

        {!paid && usage && usage.pct >= 60 && !needPay && <InviteCard invite={invite} />}

        {msgs.length === 0 && (
          <div className="mt-5">
            {/* 물꼬 첫인사 — 채팅 화면처럼 말풍선으로 시작 */}
            <div className="mr-4 rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[14px] leading-relaxed text-gray-800 ring-1 ring-black/5">
              <b className="font-extrabold text-gray-900">안녕하세요, 물꼬예요.</b>
              <br />
              모집요강·입결부터 내 생기부, 면접, 탐구주제까지 편하게 물어보세요.
              {grade !== null && (
                <Link to="/my" className="mt-2 flex items-center gap-1.5 text-[12.5px] font-bold" style={{ color: NAVY }}>
                  {grade
                    ? <>📌 {grade} 기준으로 답해요{({ 고1: " (2029학년도)", 고2: " (2028학년도)", 고3: " (2027학년도)" })[grade] ?? ""} <span className="font-semibold text-gray-400">· 학년 바꾸기 ›</span></>
                    : <>📌 학년을 알려 주면 학년에 맞춰 답해요 <span className="font-semibold text-gray-400">· 학년 정하기 ›</span></>}
                </Link>
              )}
            </div>

            {/* 바로 가기 — 생수면 주황 · 휴대폰은 옆으로 밀어서 보는 한 줄 (☰ 메뉴 '입시 준비'에도 같은 4개) */}
            {/* 가운데 정렬 — 한 줄에 다 들어가면 가운데, 넘치면 옆으로 밀어서 본다 */}
            <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0">
             <div className="mx-auto flex w-max gap-2">
              {SHORTCUTS.map((t) => (
                <Link key={t.to} to={t.to} className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-sm-orange px-4 py-2.5 text-[14px] font-extrabold text-white shadow-sm hover:bg-sm-orange-d sm:px-5 sm:py-3 sm:text-[15px]">
                  {t.title}
                  {t.badge && <small className="rounded-full bg-white/20 px-1.5 text-[10px] font-bold">{t.badge}</small>}
                  <span className="text-white/60">›</span>
                </Link>
              ))}
             </div>
            </div>

            {/* 물꼬가 할 수 있는 일 — 휴대폰에서는 제목만 작게 */}
            <p className="mt-5 text-[13.5px] font-extrabold text-gray-900">물꼬가 할 수 있는 일</p>
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-2">
              {FEATURES.map((f) => (
                <button key={f.title} onClick={() => (f.soon ? setMsgs([{ role: "user", content: "수행평가 도와줄 수 있어?" }, { role: "assistant", content: SOON_TEXT }]) : send(f.q))}
                  className={`rounded-xl px-2.5 py-2.5 text-left ring-1 ring-black/5 sm:rounded-2xl sm:p-3.5 ${f.soon ? "bg-white/60" : "bg-white hover:ring-gray-300"}`}>
                  <p className={`flex flex-wrap items-center gap-1 text-[12.5px] font-extrabold sm:text-[13.5px] ${f.soon ? "text-gray-400" : "text-gray-900"}`}>
                    {f.title}
                    {f.soon && <small className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">준비 중</small>}
                  </p>
                  <p className={`mt-0.5 hidden text-[11.5px] leading-snug sm:block ${f.soon ? "text-gray-400" : "text-gray-500"}`}>{f.desc}</p>
                </button>
              ))}
            </div>

            <p className="mt-5 text-[12.5px] font-bold text-gray-500">이렇게 물어보세요</p>
            <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => send(e)} className="flex-none whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 ring-1 ring-gray-200 hover:ring-gray-400">{e}</button>
              ))}
            </div>
            <p className="mt-4 text-[11.5px] leading-relaxed text-gray-400">
              내 생기부로 맞춤 답을 받으려면 <Link to="/my/note" className="font-bold underline" style={{ color: NAVY }}>생기부 노트</Link>에 활동을 먼저 적어 두세요. 입결은 일부 대학만 있어요.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {msgs.map((m, i) => (m.role === "user" ? (
            <div key={i} className="ml-10 self-end whitespace-pre-line rounded-2xl rounded-br-md px-4 py-3 text-[14px] leading-relaxed text-white" style={{ background: NAVY }}>{m.content}</div>
          ) : (
            <div key={i} ref={i === msgs.length - 1 ? lastBotRef : undefined} className="mr-4 scroll-mt-24">
              {(() => {
                const { body, questions, pass, form, invite: inv, univReq, plan, routine, acts, senior, prep, note, voice } = splitChoices(m.content);
                const last = i === msgs.length - 1;
                return (
                  <>
                    {body && <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[14px] leading-relaxed text-gray-700 ring-1 ring-black/5"><Rich text={body} /></div>}
                    {inv && !paid && last && <InviteCard invite={invite} topic />}
                    {univReq && <UnivRequestCard key={`u${i}`} req={univReq} question={msgs[i - 1]?.content} />}
                    {routine && body && <RoutineSaveCard key={`r${i}`} text={body} />}
                    {acts.map((id) => <ActionCard key={`a${id}`} id={id} />)}
                    {senior && (
                      <Link to="/sb" className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">합격 선배 생기부 원본 보기</b>
                          <small className="text-[12.5px] text-gray-500">물꼬가 참고한 선배 생기부를 직접 열어 볼 수 있어요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded-xl px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>보러 가기 ›</span>
                      </Link>
                    )}
                    {voice && (
                      <Link to="/voice" state={{ from: "/agent" }} className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">건의함에 자료 요청하기</b>
                          <small className="text-[12.5px] text-gray-500">필요한 대학 · 자료를 남기면 먼저 넣어 드려요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded-xl bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">남기러 가기 ›</span>
                      </Link>
                    )}
                    {note && (
                      <Link to="/my/note" state={{ from: "agent" }} className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">내 생기부 노트에 활동 적기</b>
                          <small className="text-[12.5px] text-gray-500">지난 학년 활동을 적어 두면 물꼬가 이어서 맞춰 줘요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded-xl bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">적으러 가기 ›</span>
                      </Link>
                    )}
                    {prep && (
                      <Link to="/prep" state={{ from: "agent" }} className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">수시 면접 준비</b>
                          <small className="text-[12.5px] text-gray-500">지원 대학별 기출문제 · 생기부 예상질문 연습</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded-xl bg-sm-orange px-3.5 text-[13px] font-extrabold text-white">연습하러 가기 ›</span>
                      </Link>
                    )}
                    {plan && myPlan !== true && last && !busy && (
                      <button onClick={() => send("내 입시 플랜 짜 줘")} className="mt-2 flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">내 입시 플랜 만들기</b>
                          <small className="text-[12.5px] text-gray-500">학년 · 지금까지 한 것을 적으면 이번 주 미션까지 짜 드려요</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded-xl px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>만들기 ›</span>
                      </button>
                    )}
                    {plan && myPlan === true && (
                      <Link to="/plan?tab=exam" state={{ from: "agent" }} className="mt-2 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/10 hover:ring-black/20">
                        <span>
                          <b className="block text-[14.5px] font-extrabold text-gray-900">내 입시 플랜</b>
                          <small className="text-[12.5px] text-gray-500">이번 주 미션 체크 · 플랜은 저장되고 매주 새 미션</small>
                        </span>
                        <span className="flex h-9 flex-none items-center rounded-xl px-3.5 text-[13px] font-extrabold text-white" style={{ background: NAVY }}>체크하러 가기 ›</span>
                      </Link>
                    )}
                    {pass && !paid && (pending
                      ? <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">이용권 입금 확인 중이에요. 확인되면 바로 광고가 없어져요.</p>
                      : <button onClick={() => setBuy(true)} className="mt-2 h-12 w-full rounded-xl text-[14.5px] font-extrabold text-white" style={{ background: PINK }}>이용권 {PASS_PRICE.toLocaleString()}원부터 · 광고 없이 쓰기</button>)}
                    {form && last && !busy && !closedCard && (
                      <InputCard key={`f${i}`} form={form} onSubmit={(t) => send(t)} onClose={() => setClosedCard(true)} />
                    )}
                    {!form && questions.length > 0 && last && !busy && !closedCard && (
                      <QuestionCard key={i} questions={questions} onSubmit={(t) => send(t)} onClose={() => setClosedCard(true)} />
                    )}
                  </>
                );
              })()}
              {/* 무료 사용자: 답 아래 광고 (이용권이면 없음) · 광고가 없으면 칸도 안 보인다 */}
              {memNote?.at === i && (
                <button onClick={() => setShowList(true)} className="mt-2 flex w-full items-start gap-2 rounded-xl bg-[#EEF2FF] px-3.5 py-2.5 text-left">
                  <span className="text-[13px]">📝</span>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-gray-700">
                    <b style={{ color: NAVY }}>물꼬가 기억했어요</b> · {memNote.items.join(" · ")}
                    <small className="mt-0.5 block text-[11.5px] text-gray-400">다음에 다시 안 물어봐요 · 틀린 건 「물꼬가 기억하는 나」에서 지울 수 있어요</small>
                  </span>
                </button>
              )}
              {!paid && <AdSlot slot="home_top" className="mt-2" />}
            </div>
          )))}
          {busy && <Thinking steps={steps} startedAt={startedAt} />}
          {err && <p className="text-[13px] font-semibold text-red-500">{err}</p>}
          {needPay && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
              <p className="text-[15px] font-extrabold text-gray-900">이번 주 무료 사용량을 다 썼어요</p>
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600">월요일 0시에 다시 채워져요. 지금 더 쓰려면 친구를 초대하거나 이용권을 쓰면 돼요.</p>
              <InviteCard invite={invite} />
              {pending
                ? <p className="mt-3 rounded-xl bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">이용권 입금 확인 중이에요. 확인되면 바로 열려요.</p>
                : <button onClick={() => setBuy(true)} className="mt-3 h-12 w-full rounded-xl text-[14.5px] font-extrabold text-white" style={{ background: PINK }}>이용권 {PASS_PRICE.toLocaleString()}원부터 · 광고 없이 쓰기</button>}
            </div>
          )}
          <div ref={endRef} className="h-2 scroll-mb-28" />
        </div>
      </div>

      <div className="sticky bottom-0 z-30 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className={`${WIDTH} flex items-end gap-2 py-3`}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1500))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="궁금한 대학·학과·전형을 물어보세요"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-gray-200 px-3.5 py-2.5 text-[14px] leading-relaxed outline-none focus:border-gray-400"
          />
          <button onClick={() => send()} disabled={busy || !input.trim()} className="h-11 shrink-0 rounded-xl px-4 text-[14px] font-extrabold text-white disabled:opacity-40" style={{ background: PINK }}>보내기</button>
        </div>
      </div>
     </main>
     </div>
    </div>
  );
}