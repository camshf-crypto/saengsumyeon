import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import { getClientId } from "../../lib/clientId";
import Avatar from "../../components/Avatar";
import { checkLevel } from "../../components/LevelUp";
import AdSlot from "../../components/AdSlot";

/*
 * 생수면 메인 (/)
 * 왼쪽: 물꼬 입시 에이전트 입력창(흔한가 진단 버튼 포함) → 옥상에서 외쳐! 배너 → 지금 많이 보는 글
 * 오른쪽: (회원) 내 레벨 + 오늘 할 일 / 오늘의 나만 그래? / (비회원) 가입 카드
 * 회원이 들어오면 출석을 찍고, 단계 보상을 확인해서 레벨업 팝업을 띄운다
 *
 * 주소가 지금 사이트와 다르면 아래 PATHS 만 고치면 된다
 */
const PATHS = {
  topic: "/topic",
  interview: "/interview",
  mg: "/mulgyeol",
  puzzle: "/sb",
  columns: "/columns",
  note: "/my/note",
  board: "/board",
  ladder: null, // 준비 중
  study: "/study",
  tail: "/tail",
  signup: "/signup",
  myLevel: "/my/level",
  agent: "/agent",
  prep: "/prep",
  plan: "/plan",
};

// 물꼬 입력창 아래 흔한가 진단 3종 — 누르면 물꼬 채팅에서 바로 진단을 시작한다
const AGENT_CHECKS = [
  { label: "내 탐구주제 흔한가?", q: "내 탐구주제 흔한가 진단해 줘" },
  { label: "지원동기 흔한가?", q: "내 지원동기 흔한가 진단해 줘" },
  { label: "독서 흔한가?", q: "내가 읽은 책 흔한가 진단해 줘" },
  { label: "생기부 예상질문", q: "내 생기부로 면접 예상질문 뽑아 줘" },
  { label: "면접 꼬리질문 연습", q: "면접 꼬리질문 연습하고 싶어" },
];

// 물꼬 입력창 아래 예시 — 누르면 바로 그 질문으로 물꼬에게 간다
const AGENT_EXAMPLES = [
  "내 생기부로 어떤 학과가 맞을까?",
  "가천대 2028 바뀐 점 알려줘",
];

const HOT_TABS = [
  { key: null, label: "전체" },
  { key: "mg", label: "나만 그래?" },
  { key: "post", label: "옥상에서 외쳐!" },
];

/* ───────── 작은 조각들 ───────── */

function Icon({ name, className = "h-[22px] w-[22px]" }) {
  const p = {
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
    scan: <><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" /><path d="M8 12h8M8 9h5M8 15h6" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>,
    poll: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    puzzle: <path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z" />,
    news: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
    note: <><path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6z" /><path d="M6 3v18M4 7h4M4 12h4M4 17h4M11 8h5M11 12h5" /></>,
    chat: <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />,
    ladder: <path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10" />,
    check: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    user: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 20a6.5 6.5 0 00-2.5-5.1" /></>,
    down: <path d="M6 9l6 6 6-6" />,
    bottle: <><path d="M10 3h4v3c0 1 3 2 3 5v8a2 2 0 01-2 2H9a2 2 0 01-2-2v-8c0-3 3-4 3-5z" /><path d="M7 14h10" /></>,
    book: <><path d="M4 5a2 2 0 012-2h5v17H6a2 2 0 00-2 2z" /><path d="M20 5a2 2 0 00-2-2h-5v17h5a2 2 0 012 2z" /></>,
    shout: <><path d="M3 10v4a1 1 0 001 1h3l5 4V5L7 9H4a1 1 0 00-1 1z" /><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12" /></>,
  }[name];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {p}
    </svg>
  );
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

/* ───────── 메인 ───────── */

export default function Home() {
  const { user } = useAuth();
  const uid = user?.id ?? null; // 로그인한 사람이 바뀔 때만 다시 불러온다
  const nav = useNavigate();

  const [ask, setAsk] = useState(""); // 물꼬에게 물어볼 말
  const [members, setMembers] = useState(null);
  const [shout, setShout] = useState(null); // 물꼬의 오늘의 외침
  const [hot, setHot] = useState([]);
  const [hotTab, setHotTab] = useState(null);
  const [qs, setQs] = useState([]);
  const [lv, setLv] = useState(null);
  const [today, setToday] = useState(null);
  const [nick, setNick] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [answering, setAnswering] = useState(false);
  const [photo, setPhoto] = useState(null);

  // 모두에게 보이는 것
  useEffect(() => {
    supabase.rpc("main_numbers").then(({ data }) => data && setMembers(data.members));
    supabase.rpc("shout_today").then(({ data }) => setShout(data || null));
    supabase.rpc("mg_stats").then(({ data }) => setQs(data || []));
  }, [uid]);

  useEffect(() => {
    supabase.rpc("main_hot", { p_kind: hotTab, p_limit: 5 }).then(({ data }) => setHot(data || []));
  }, [hotTab, uid]);

  // 회원: 출석 → 단계 보상 확인 → 오늘 할 일
  useEffect(() => {
    if (!user) {
      setLv(null);
      setToday(null);
      return;
    }
    let alive = true;
    (async () => {
      await supabase.rpc("sb_checkin");
      const chk = await checkLevel(); // 레벨이 올랐으면 공통 팝업이 뜬다
      const { data: t } = await supabase.rpc("lv_today");
      const { data: p } = await supabase.rpc("my_profile");
      if (!alive) return;
      if (chk) setLv(chk.info);
      setToday(t);
      setNick(p?.nickname || "");
      setPhoto(p?.avatar_url || null);
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  const answered = qs.filter((q) => q.my_answer).length;
  const allDone = qs.length > 0 && answered === qs.length;
  // 아직 안 답한 질문을 먼저, 다 답했으면 첫 질문 결과
  const firstQ = qs.find((q) => !q.my_answer) || qs[0];
  const todo = useMemo(() => {
    if (!today) return [];
    return [
      { label: "출석", done: today.att, right: today.att ? "+2 완료" : "+2" },
      { label: `나만 그래? 응답 ${Math.min(today.answers, 3)}/3`, done: today.answers >= 3, right: "+1씩" },
      { label: "댓글 1개 (10자 이상)", done: today.comments >= 1, right: "+2" },
    ];
  }, [today]);
  const todoDone = todo.filter((t) => t.done).length;

  function toast(m) {
    setToastMsg(m);
    setTimeout(() => setToastMsg(""), 1800);
  }

  // 오늘의 나만 그래? — 회원은 여기서 바로 답한다, 비회원은 가입으로
  async function answerQ(q, value) {
    if (!user) return nav(PATHS.signup);
    if (answering) return;
    setAnswering(true);
    let grade = user.user_metadata?.grade || null;
    try {
      grade = localStorage.getItem("sm_grade") || grade;
    } catch {
      /* 저장소를 못 쓰면 가입 정보 학년 */
    }
    const { error } = await supabase.rpc("mulgyeol_answer", {
      p_question_id: q.id,
      p_answer: value,
      p_client_id: getClientId(),
      p_grade: grade,
    });
    setAnswering(false);
    if (error) return toast(error.message || "답을 저장하지 못했어요");
    const [{ data: st }, chk, { data: t }] = await Promise.all([
      supabase.rpc("mg_stats"),
      checkLevel(),
      supabase.rpc("lv_today"),
    ]);
    setQs(st || []);
    if (t) setToday(t);
    if (chk) {
      setLv(chk.info);
      if (!chk.level_up && !(chk.rewards || []).length) toast("+1점");
    }
  }

  // 물꼬 입력창 — 에이전트 화면으로 넘어가서 바로 답한다
  function goAgent(text) {
    const v = String(text ?? "").trim();
    nav(v ? `${PATHS.agent}?q=${encodeURIComponent(v)}` : PATHS.agent);
  }

  function openHot(h) {
    if (h.kind === "post") nav(`${PATHS.board}/${h.id}`);
    else nav(PATHS.mg);
  }

  /* 오른쪽 카드들 */
  const levelCard = lv && (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <Avatar src={photo} nick={nick} color={lv.color} />
        <div className="min-w-0">
          <b className="block truncate text-[16px] font-bold text-gray-900">{nick || "닉네임 없음"}</b>
          <small className="text-[12px] text-gray-500">합격 생기부 조각은 퍼즐에서 확인</small>
        </div>
        <div className="ml-auto text-right">
          <b className="text-[20px] font-extrabold tabular-nums text-sm-navy">Lv.{lv.level}</b>
          <small className="block text-[11.5px] font-bold" style={{ color: lv.color }}>
            {lv.name || lv.stage}
          </small>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <i className="block h-full rounded-full bg-sm-navy" style={{ width: `${lv.pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-gray-500">
        <span>{lv.points}{lv.next ? ` / ${lv.next}점` : "점"}</span>
        {!lv.max && (
          <span>
            Lv.{lv.level + 1}까지 <b className="text-gray-900">{lv.need}점</b>
          </span>
        )}
      </div>
      {todo.length > 0 && (
        <div className="mt-3.5 border-t border-gray-100 pt-2.5">
          {todo.map((t) => (
            <div key={t.label} className="flex items-center gap-2.5 py-1.5 text-[13.5px] text-gray-700">
              <span className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] text-[11px] font-black ${t.done ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300"}`}>
                {t.done ? "✓" : ""}
              </span>
              {t.label}
              <small className="ml-auto text-[12px] tabular-nums text-gray-500">{t.right}</small>
            </div>
          ))}
        </div>
      )}
      <Link to={PATHS.myLevel} className="mt-3 block text-center text-[13px] font-semibold text-gray-500 hover:text-sm-navy">
        단계 혜택 보기 ›
      </Link>
    </div>
  );

  const mgCard = firstQ && (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-1.5 text-[13px] font-bold text-gray-700">
        <i className="h-1.5 w-1.5 rounded-full bg-sm-orange" />
        오늘의 나만 그래?
        <small className="ml-auto text-[12px] font-medium text-gray-500">
          {(firstQ.total || 0).toLocaleString()}명 응답
        </small>
      </div>
      <h3 className="mb-4 mt-3 text-[19px] font-bold leading-snug tracking-tight text-gray-900">{firstQ.title}</h3>
      {firstQ.my_answer ? (
        <div>
          <div className="mb-1.5 flex justify-between text-[13px] font-semibold text-gray-700">
            <span>나도 그래</span>
            <b className="text-[15px] tabular-nums text-sm-orange">{firstQ.yes_pct ?? 0}%</b>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
            <i className="block h-full rounded-full bg-sm-orange" style={{ width: `${firstQ.yes_pct ?? 0}%` }} />
          </div>
          {firstQ.dept_yes_pct != null && (
            <p className="mt-2.5 text-[12.5px] text-gray-500">
              {firstQ.dept} 지망생에서는 <b className="text-gray-900">{firstQ.dept_yes_pct}%</b>가 '나도 그래'라고 답했어요.
            </p>
          )}
          {firstQ.minority && <p className="mt-1.5 text-[12.5px] font-semibold text-indigo-600">소수 의견이에요 · 이유를 댓글로 남겨 보세요</p>}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => answerQ(firstQ, "yes")}
              disabled={answering}
              className="h-12 flex-1 rounded-[10px] border border-gray-200 text-[14.5px] font-semibold text-gray-700 hover:border-sm-navy hover:text-sm-navy disabled:opacity-50"
            >
              나도 그래
            </button>
            <button
              onClick={() => answerQ(firstQ, "no")}
              disabled={answering}
              className="h-12 flex-1 rounded-[10px] border border-gray-200 text-[14.5px] font-semibold text-gray-700 hover:border-sm-navy hover:text-sm-navy disabled:opacity-50"
            >
              난 아닌데
            </button>
          </div>
          {!user && <p className="mt-2 text-center text-[12px] text-gray-500">가입하면 바로 답하고 결과를 볼 수 있어요</p>}
        </>
      )}
      <div className="mt-4 flex items-center gap-2.5">
        <div className="flex flex-1 gap-1">
          {qs.map((q) => (
            <i key={q.id} className={`h-[3px] flex-1 rounded-full ${q.my_answer ? "bg-sm-navy" : "bg-gray-200"}`} />
          ))}
        </div>
        <small className="flex-none text-[12px] tabular-nums text-gray-500">오늘 {answered}/{qs.length}</small>
      </div>
      {allDone ? (
        <Link to={PATHS.mg} className="mt-3 block rounded-[10px] bg-[#F4F5F7] py-2.5 text-center text-[13px] font-semibold text-gray-600">
          오늘 질문 끝 · 밤 12시에 새 질문이 열려요 ›
        </Link>
      ) : (
        answered > 0 && (
          <Link to={PATHS.mg} className="mt-3 block text-center text-[12.5px] font-semibold text-gray-500 hover:text-sm-navy">
            남은 질문 {qs.length - answered}개 답하러 가기 ›
          </Link>
        )
      )}
    </div>
  );

  const joinCard = !user && (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <b className="block text-[17px] font-bold tracking-tight text-gray-900">내 기록을 저장하고 이어서 보세요</b>
      <p className="mb-3.5 mt-1.5 text-[13px] text-gray-500">가입하면 Lv.2에서 시작해요.</p>
      <ul className="mb-4 grid gap-2">
        {["흔한가 진단 결과 보관", "같은 학과 지망생 응답 비교", "내 생기부 노트에 활동 기록", "생기부 예상질문 5개 무료"].map((t) => (
          <li key={t} className="flex items-center gap-2 text-[13px] text-gray-700">
            <span className="flex h-4 w-4 flex-none items-center justify-center rounded bg-orange-50 text-[11px] font-extrabold text-sm-orange">✓</span>
            {t}
          </li>
        ))}
      </ul>
      <Link to={PATHS.signup} className="block rounded-[10px] bg-[#FEE500] py-3 text-center text-[14.5px] font-bold text-[#191919]">
        카카오로 시작하기
      </Link>
    </div>
  );

  return (
    <div className="bg-[#F4F5F7]">
      <div className="mx-auto grid max-w-6xl gap-5 px-4 pb-16 pt-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7 lg:pt-9">
        {/* ── 왼쪽 */}
        <div className="min-w-0">
          {/* 광고 — 맨 위 3칸 (광고가 없으면 안 보임) */}
          <AdSlot slot="home_top" className="mb-4" />

          {/* 물꼬 입시 에이전트 — 입시 궁금한 건 여기서 물어보기 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            <div className="mb-3 flex items-baseline gap-2 pl-0.5">
              <b className="flex-none whitespace-nowrap text-[16.5px] font-bold tracking-tight text-gray-900 sm:text-[18px]">물꼬 입시 AI</b>
              <small className="hidden truncate text-[12.5px] text-gray-500 sm:inline">모집요강 · 내 생기부 · 면접 · 탐구주제까지</small>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                goAgent(ask);
              }}
              className="flex h-14 items-center gap-3 rounded-[12px] border-2 border-sm-navy bg-white pl-4 pr-2"
            >
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="입시 궁금한 걸 물어보세요"
                enterKeyHint="send"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400 sm:text-[16px]"
              />
              <button aria-label="물꼬에게 물어보기" className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-sm-navy text-white">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
            </form>
            <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
              {/* 흔한가 진단 3종 — 물꼬 채팅에서 바로 진단 */}
              {AGENT_CHECKS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => goAgent(c.q)}
                  className="flex-none whitespace-nowrap rounded-full border border-gray-200 bg-[#F8F9FB] px-3 py-1.5 text-[12.5px] font-medium text-gray-600 hover:border-sm-navy hover:text-sm-navy"
                >
                  {c.label}
                </button>
              ))}
              {AGENT_EXAMPLES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => goAgent(t)}
                  className="flex-none whitespace-nowrap rounded-full border border-gray-200 bg-[#F8F9FB] px-3 py-1.5 text-[12.5px] font-medium text-gray-600 hover:border-sm-navy hover:text-sm-navy"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 pl-1 text-[12.5px] text-gray-500">
            <span className="flex items-center gap-1.5"><i className="h-[5px] w-[5px] rounded-full bg-sm-orange" />탐구주제 데이터 <b className="text-gray-700">9,780건</b></span>
            <span className="flex items-center gap-1.5"><i className="h-[5px] w-[5px] rounded-full bg-sm-orange" />대학 면접 분석 <b className="text-gray-700">140개교</b></span>
            {members != null && (
              <span className="flex items-center gap-1.5"><i className="h-[5px] w-[5px] rounded-full bg-sm-orange" />가입 학생 <b className="text-gray-700">{members.toLocaleString()}명</b></span>
            )}
          </div>

          {/* 회원 · 휴대폰: 레벨 한 줄 */}
          {lv && (
            <Link to={PATHS.myLevel} className="mt-3.5 flex items-center gap-3 rounded-[14px] border border-gray-200 bg-white px-4 py-3.5 lg:hidden">
              <Avatar src={photo} nick={nick} color={lv.color} size={40} />
              <div className="min-w-0 flex-1">
                <b className="text-[14.5px] font-bold text-gray-900">
                  Lv.{lv.level} {lv.stage}{!lv.max && ` · Lv.${lv.level + 1}까지 ${lv.need}점`}
                </b>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <i className="block h-full rounded-full bg-sm-navy" style={{ width: `${lv.pct}%` }} />
                </div>
                {todo.length > 0 && <small className="mt-1.5 block text-[12px] text-gray-500">오늘 할 일 {todoDone}/{todo.length}</small>}
              </div>
            </Link>
          )}

          {/* 옥상에서 외쳐! 배너 — 물꼬의 오늘의 외침 (두 줄만) */}
          <Link
            to={PATHS.board}
            className="relative mt-6 flex flex-col gap-3 overflow-hidden rounded-2xl bg-sm-navy px-6 py-4 text-white sm:flex-row sm:items-center sm:px-8 sm:py-5"
          >
            <div className="relative min-w-0 flex-1">
              <small className="text-[12px] font-bold text-orange-300">📣 옥상에서 외쳐! · 물꼬의 오늘의 외침</small>
              <b className="mt-1.5 block text-[19px] font-bold leading-snug tracking-tight sm:text-[22px]">
                {shout ? `“${shout.text}”` : "학교에서 못 한 말, 여기서 외쳐!"}
              </b>
            </div>
            <span className="relative shrink-0 self-start rounded-xl bg-white px-4 py-2.5 text-[14px] font-extrabold text-sm-navy sm:self-center">
              나도 외치기 ›
            </span>
          </Link>

          {/* 지금 많이 보는 글 */}
          <section className="mt-9">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-2 pl-1">
              <h2 className="text-[19px] font-bold tracking-tight text-gray-900">지금 많이 보는 글</h2>
              <small className="text-[12.5px] text-gray-500">{hotTab ? "최근 7일 · 5개" : "탭별 1위"}</small>
              <div className="flex w-full gap-0.5 rounded-lg bg-[#E9EBEF] p-[3px] sm:ml-auto sm:w-auto">
                {HOT_TABS.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => setHotTab(t.key)}
                    className={`flex-1 rounded-md px-2.5 py-1 text-[12.5px] font-semibold sm:flex-none ${hotTab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-1 sm:px-[22px]">
              {hot.length === 0 && <p className="py-10 text-center text-[14px] text-gray-500">아직 올라온 글이 없어요</p>}
              {hot.map((h, i) => (
                <button key={`${h.kind}-${h.id}`} onClick={() => openHot(h)} className="flex w-full items-center gap-4 border-b border-gray-100 py-[18px] text-left last:border-0">
                  <span className={`w-5 flex-none text-[17px] font-bold tabular-nums ${i < 3 ? "text-sm-orange" : "text-gray-900"}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <span className={`mb-1 block text-[11.5px] font-bold ${h.kind === "mg_result" ? "text-sm-orange" : h.kind === "post" ? "text-teal-700" : "text-indigo-700"}`}>
                      {h.kind === "post" ? "옥상에서 외쳐!" : h.category}
                    </span>
                    <h3 className="text-[15.5px] font-semibold leading-snug text-gray-900 sm:text-[16px]">{h.title}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[12.5px] text-gray-500">
                      {h.kind === "mg_result" && (
                        <>
                          <span className="flex items-center gap-1"><Icon name="user" className="h-3.5 w-3.5" />{Number(h.total).toLocaleString()}명 응답</span>
                          <span className="flex items-center gap-1"><Icon name="chat" className="h-3.5 w-3.5" />{h.comments}</span>
                          {h.best?.body && <span className="truncate">베스트 · "{h.best.body}"</span>}
                        </>
                      )}
                      {h.kind === "post" && (
                        <>
                          <span>{h.author?.grade ? `${h.author.grade} · ` : ""}익명 · {ago(h.created_at)}</span>
                          <span className="flex items-center gap-1"><Icon name="chat" className="h-3.5 w-3.5" />{h.comments}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {h.kind === "mg_result" && (
                    <span className="flex h-[60px] w-[72px] flex-none flex-col items-center justify-center rounded-[10px] bg-orange-50 text-[11.5px] font-semibold text-gray-700 sm:h-[72px] sm:w-24">
                      <b className="text-[18px] font-extrabold tabular-nums text-sm-orange sm:text-[22px]">{h.yes_pct ?? 0}%</b>
                      나도 그래
                    </span>
                  )}
                  {h.kind === "post" && (
                    <span className="flex h-[60px] w-[72px] flex-none flex-col items-center justify-center rounded-[10px] bg-[#F4F5F7] text-[11.5px] font-semibold text-gray-700 sm:h-[72px] sm:w-24">
                      <b className="text-[18px] font-extrabold tabular-nums text-gray-900 sm:text-[22px]">{h.comments}</b>
                      댓글
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* ── 오른쪽 (휴대폰에서는 아래로) */}
        <aside className="grid content-start gap-3.5">
          {levelCard && <div className="hidden lg:block">{levelCard}</div>}
          {mgCard}
          {joinCard}
          {/* 광고 — 띠 배너 여러 개 + 큰 배너 (광고가 없으면 안 보임) */}
          <AdSlot slot="home_right" />
        </aside>
      </div>

      {toastMsg && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-sm-navy/95 px-4 py-2.5 text-[13.5px] font-semibold text-white md:bottom-8">
          {toastMsg}
        </div>
      )}
    </div>
  );
}