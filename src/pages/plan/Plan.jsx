import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import LoginGate from "../../components/LoginGate";
import PassSheet from "../../components/PassSheet";

/*
 * 내 플랜 (/plan) — 탭 두 개
 *   [학습 플랜] 학습 다이어리 — 매일 할 루틴 체크 · 공부법 · 한 줄 일기 (sql/sm_91)
 *   [입시 플랜] 목표 대학 · 학과로 짠 큰 그림 + 이번 주 미션 (sql/sm_88 · 서버 agent)
 * 처음 열리는 탭: state.diary → 학습 / ?tab=exam · ?tab=study → 그 탭 / 그 외 → 마지막에 본 탭 (없으면 학습)
 *
 * 입시 플랜
 *   읽기 · 체크 전용 — 플랜은 물꼬 채팅에서 만든다 (입력 카드 '내 입시 플랜 짜기' → 서버가 바로 만듦)
 *   이번 주 미션 3~5개 체크 · 지난 미션 기록(주마다 쌓임) · 이번 학기 목표 · 월별 계획 · 다시 짜기는 채팅으로
 *   새 주가 되면 저절로 지난주에 한 것 · 못 한 것을 보고 이번 주 할 일을 다시 짠다 (plan_next_week)
 *   할 일을 누르면 그 기능으로 바로 (탐구주제 · 지원동기 · 독서 · 면접 기출 · 예상질문 · 꼬리질문 · 생기부 노트)
 *   AI 비용은 물꼬 주간 사용량에 들어간다 (다 쓰면 이용권)
 * 물꼬 채팅에서 "고1인데 뭐 해야 돼?" 같은 질문에 붙는 [[플랜]] 카드로도 들어온다
 */
// 할 일을 누르면 가는 곳
const LINKS = {
  topic: { label: "탐구주제 찾기", to: "/agent?q=" + encodeURIComponent("탐구주제 추천해 줘") },
  motive: { label: "지원동기 진단", to: "/agent?q=" + encodeURIComponent("내 지원동기 흔한가 진단해 줘") },
  reading: { label: "책 고르기", to: "/agent?q=" + encodeURIComponent("내 학과에 맞는 책 추천해 줘") },
  prep: { label: "면접 기출 연습", to: "/prep" },
  interview: { label: "생기부 예상질문", to: "/interview" },
  tail: { label: "꼬리질문 연습", to: "/tail" },
  note: { label: "생기부 노트 적기", to: "/my/note" },
};

async function call(body) {
  const { data, error } = await supabase.functions.invoke("agent", { body });
  if (!error) return data ?? {};
  try {
    return (await error.context?.json?.()) ?? { error: "잠시 후 다시 해 주세요" };
  } catch {
    return { error: "잠시 후 다시 해 주세요" };
  }
}
const weekLabel = (ws) => {
  if (!ws) return "이번 주";
  const d = new Date(`${ws}T00:00:00`);
  const e = new Date(d.getTime() + 6 * 86400000);
  return `${d.getMonth() + 1}/${d.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()}`;
};

// 플랜 만들기 · 다시 짜기는 물꼬 채팅에서 (입력 카드 '내 입시 플랜 짜기')
const ASK_NEW = "/agent?q=" + encodeURIComponent("내 입시 플랜 짜 줘");
const ASK_AGAIN = "/agent?q=" + encodeURIComponent("내 입시 플랜 다시 짜 줘");

// 탭 — 마지막에 본 탭을 기억 (이 브라우저에서만)
const TAB_KEY = "sm_plan_tab";
const VIEWS = [
  { id: "study", label: "학습 플랜" },
  { id: "exam", label: "입시 플랜" },
];
function firstView(loc) {
  if (loc.state?.diary) return "study";
  const q = new URLSearchParams(loc.search).get("tab");
  if (q === "study" || q === "exam") return q;
  try {
    const s = localStorage.getItem(TAB_KEY);
    if (s === "study" || s === "exam") return s;
  } catch {
    /* 저장소를 못 쓰는 브라우저 */
  }
  return "study";
}


/* ───────── 학습 다이어리 (sql/sm_91) — 매일 할 루틴 체크 · 공부법 · 한 줄 일기 ─────────
 * 루틴은 물꼬 채팅에서 짠 걸 [학습 다이어리에 넣기]로 가져온다 (서버 routine_save)
 * 체크 · 일기는 화면에서 바로 저장 (자기 것만 — RLS)
 */
const WD = ["월", "화", "수", "목", "금", "토", "일"];
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
const addDay = (day, n) => kst(new Date(new Date(`${day}T00:00:00+09:00`).getTime() + n * 86400000));
const wdOf = (day) => ((new Date(`${day}T12:00:00+09:00`).getUTCDay() + 6) % 7) + 1; // 1 월 ~ 7 일
const ASK_ROUTINE = "/agent?q=" + encodeURIComponent("이번 주 하루 공부 루틴 짜 줘");

/* ───────── 공부법 효과 시험 (sql/sm_94 · 서버 agent test_*) ─────────
 * 시작 시험 10문제 → 공부법대로 일주일 → 비슷한 문제로 다시 시험 → 몇 개 더 맞혔는지 보고 다음 주를 정한다
 * 과목 탭마다 하나 (매일 습관 탭에는 없음) · 정답은 서버에만 있고 낸 뒤에 해설을 보여 준다
 */
const TEST_SUBJECTS = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사"];
const RESULT_LABEL = { 늘리기: "거의 잡았어요", 유지: "효과 있어요", 한주더: "한 주 더", 교체: "공부법 바꾸기" };
const RESULT_COLOR = { 늘리기: "bg-emerald-50 text-emerald-700", 유지: "bg-emerald-50 text-emerald-700", 한주더: "bg-orange-50 text-sm-orange", 교체: "bg-red-50 text-red-600" };
const dLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
const md = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

/* 문제 풀기 — 한 문제씩 넘기고, 다 고르면 제출 */
function Quiz({ title, questions, onSubmit, onClose, busy }) {
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState(() => questions.map(() => null));
  const q = questions[i];
  const all = picks.every((p) => p !== null);
  const pick = (k) => {
    setPicks((v) => v.map((x, j) => (j === i ? k : x)));
    if (i + 1 < questions.length) setTimeout(() => setI(i + 1), 180);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl bg-white sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <b className="text-[15px] font-extrabold text-gray-900">{title}</b>
          <button onClick={onClose} disabled={busy} className="text-[24px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>
        <div className="flex gap-1 px-5 pt-3">
          {questions.map((_, k) => (
            <button key={k} onClick={() => setI(k)} aria-label={`${k + 1}번`}
              className={`h-1.5 flex-1 rounded-full ${k === i ? "bg-sm-navy" : picks[k] !== null ? "bg-sm-orange" : "bg-gray-200"}`} />
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[12.5px] font-bold text-gray-400">{i + 1} / {questions.length}{q.type ? ` · ${q.type}` : ""}</p>
          <p className="mt-1.5 whitespace-pre-line text-[15.5px] font-bold leading-relaxed text-gray-900">{q.q}</p>
          <div className="mt-4 grid gap-2">
            {q.choices.map((c, k) => (
              <button key={k} onClick={() => pick(k)}
                className={`flex items-start gap-3 rounded-xl px-4 py-3 text-left text-[14.5px] ring-1 ${picks[i] === k ? "bg-[#EEF1FA] font-bold text-sm-navy ring-sm-navy" : "bg-white text-gray-800 ring-gray-200 hover:ring-gray-300"}`}>
                <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-extrabold ${picks[i] === k ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-500"}`}>{k + 1}</span>
                <span className="leading-relaxed">{c}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3">
          <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0 || busy} className="h-11 rounded-xl px-4 text-[14px] font-bold text-gray-500 disabled:opacity-30">‹ 이전</button>
          {i + 1 < questions.length
            ? <button onClick={() => setI(i + 1)} className="ml-auto h-11 rounded-xl bg-gray-100 px-5 text-[14px] font-bold text-gray-700">다음 ›</button>
            : <button onClick={() => all && onSubmit(picks)} disabled={!all || busy} className="ml-auto h-11 rounded-xl bg-sm-navy px-5 text-[14px] font-extrabold text-white disabled:opacity-40">
                {busy ? "채점하는 중…" : all ? "제출하고 채점" : `${picks.filter((p) => p === null).length}문제 남았어요`}
              </button>}
        </div>
      </div>
    </div>
  );
}

/* 채점 결과 — 맞은 수 · 문제별 정답과 해설 */
function Review({ review }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-bold text-gray-500 underline">{open ? "해설 접기" : "문제별 정답 · 해설 보기"}</button>
      {open && (
        <ol className="mt-2 grid gap-2">
          {review.map((r) => (
            <li key={r.no} className="rounded-xl bg-white px-3.5 py-3 text-[13px] leading-relaxed ring-1 ring-gray-200">
              <p className="font-bold text-gray-900"><span className={r.correct ? "text-emerald-600" : "text-red-500"}>{r.correct ? "○" : "✕"}</span> {r.no}. {r.q}</p>
              {!r.correct && <p className="mt-1 text-gray-500">내 답 {r.picked + 1}번 · <b className="text-gray-800">정답 {r.answer + 1}번 {r.choices[r.answer]}</b></p>}
              {r.why && <p className="mt-1 text-gray-600">{r.why}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* 공부법 카드 — 이번 주에 해 볼 방법 */
function TipList({ tips }) {
  if (!tips?.length) return null;
  return (
    <div className="mt-3 grid gap-2">
      {tips.map((t) => (
        <div key={t.id ?? t.title} className="rounded-xl bg-white px-3.5 py-3 ring-1 ring-gray-200">
          <small className="text-[11.5px] font-extrabold text-sm-orange">이번 주 공부법</small>
          <b className="mt-0.5 block text-[14px] font-extrabold text-gray-900">{t.title}</b>
          {Array.isArray(t.steps) && t.steps.length > 0 && (
            <ol className="mt-1 grid gap-0.5">{t.steps.slice(0, 3).map((x, k) => <li key={k} className="text-[12.5px] leading-relaxed text-gray-600">{k + 1}. {typeof x === "string" ? x : x?.text ?? ""}</li>)}</ol>
          )}
        </div>
      ))}
    </div>
  );
}

function TestBox({ subject }) {
  const [state, setState] = useState(null); // { open, done }
  const [unit, setUnit] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [quiz, setQuiz] = useState(null); // 풀고 있는 시험
  const [after, setAfter] = useState(null); // 방금 낸 결과 { review, tips, result, message, pre, post, total, kept, from }
  const load = () => call({ action: "test_status" }).then((r) => setState(r.error ? { open: [], done: [] } : r));
  useEffect(() => { setAfter(null); setErr(""); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [subject]);

  const cur = state?.open?.find((t) => t.subject === subject) ?? null;
  const last = state?.done?.find((t) => t.subject === subject) ?? null;

  async function make(fromId, u) {
    const name = (u ?? unit).trim();
    if (name.length < 2) return setErr("단원을 적어 주세요 (예: 이차함수, 비문학 독해)");
    setBusy("make"); setErr(""); setAfter(null);
    const r = await call({ action: "test_make", subject, unit: name, from_id: fromId });
    setBusy("");
    if (r.need_pay) return setErr("이번 주 물꼬 사용량을 다 썼어요. 월요일 0시에 다시 채워져요.");
    if (r.error || !r.test) return setErr(r.error ?? "문제를 만들지 못했어요");
    track("test_make");
    await load();
    setQuiz(r.test);
  }
  async function submit(picks) {
    setBusy("submit");
    const r = await call({ action: "test_submit", id: quiz.id, answers: picks });
    setBusy("");
    if (r.error) return setErr(r.error);
    const t = quiz;
    setQuiz(null);
    track(t.status === "pre" ? "test_pre" : "test_post");
    setAfter(t.status === "pre"
      ? { kind: "pre", review: r.review, tips: r.tips, score: r.test.pre_score, total: r.test.total, open: r.test.post_open_at }
      : { kind: "post", review: r.review, tips: r.tips, result: r.result, message: r.message, pre: r.pre_score, post: r.test.post_score, total: r.test.total, kept: r.kept, test: r.test });
    load();
  }

  if (!state) return null;
  const box = "mt-4 rounded-xl bg-[#F8F9FB] p-4";
  const head = <p className="flex items-center gap-2"><b className="text-[14.5px] font-extrabold text-gray-900">{subject} 공부법 효과 시험</b><small className="text-[11.5px] font-bold text-gray-400">10문제 · 일주일 뒤 다시</small></p>;

  return (
    <>
      {/* 방금 낸 다시 시험 결과 */}
      {after?.kind === "post" ? (
        <div className={box}>
          {head}
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[13px] font-bold text-gray-500">시작 {after.pre}/{after.total}</span>
            <span className="text-gray-300">→</span>
            <b className="text-[22px] font-black text-sm-navy">{after.post}<small className="text-[13px] font-bold text-gray-400">/{after.total}</small></b>
            <span className={`ml-auto rounded-full px-3 py-1 text-[12.5px] font-extrabold ${RESULT_COLOR[after.result] ?? ""}`}>{RESULT_LABEL[after.result] ?? after.result}</span>
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-700">{after.message}</p>
          {after.kept !== null && after.kept !== undefined && <p className="mt-1 text-[12px] text-gray-400">이번 주 {subject} 루틴 지킨 비율 {Math.round(after.kept * 100)}%</p>}
          {after.result === "교체" && <TipList tips={after.tips} />}
          <Review review={after.review} />
          <div className="mt-3 flex flex-wrap gap-2">
            {["한주더", "교체"].includes(after.result) && (
              <button onClick={() => make(after.test.id, after.test.unit)} disabled={Boolean(busy)} className="h-10 rounded-xl bg-sm-navy px-4 text-[13px] font-extrabold text-white disabled:opacity-40">
                {busy === "make" ? "새 시험지 만드는 중… (30초쯤)" : `${after.test.unit} 한 주 더 해 보기 ›`}
              </button>
            )}
            <button onClick={() => setAfter(null)} className="h-10 rounded-xl bg-white px-4 text-[13px] font-bold text-gray-600 ring-1 ring-gray-200">다른 단원 시험 보기</button>
          </div>
        </div>
      ) : cur?.status === "pre" ? (
        /* 시험지는 만들었는데 아직 안 풀었으면 */
        <div className={box}>
          {head}
          <p className="mt-1.5 text-[13px] text-gray-600"><b>{cur.unit}</b> 시작 시험 {cur.total}문제가 준비돼 있어요. 지금 실력을 먼저 재고 공부법을 시작해요.</p>
          <button onClick={() => setQuiz(cur)} className="mt-3 h-11 w-full rounded-xl bg-sm-navy text-[14px] font-extrabold text-white">시작 시험 풀기 ›</button>
        </div>
      ) : cur?.status === "studying" ? (
        /* 공부하는 중 — 일주일 뒤 다시 시험 */
        <div className={box}>
          {head}
          <div className="mt-2 flex items-center gap-3">
            <span className="text-[13px] text-gray-600"><b>{cur.unit}</b> 시작 점수</span>
            <b className="text-[18px] font-black text-sm-navy">{after?.kind === "pre" ? after.score : cur.pre_score}<small className="text-[12px] font-bold text-gray-400">/{cur.total}</small></b>
            <span className={`ml-auto rounded-full px-3 py-1 text-[12.5px] font-extrabold ${cur.post_ready ? "bg-sm-orange text-white" : "bg-white text-gray-500 ring-1 ring-gray-200"}`}>
              {cur.post_ready ? "다시 시험 열렸어요" : `다시 시험 D-${dLeft(cur.post_open_at)} · ${md(cur.post_open_at)}`}
            </span>
          </div>
          {after?.kind === "pre" && <p className="mt-2 text-[13px] leading-relaxed text-gray-700">틀린 유형을 보고 이번 주 공부법을 골랐어요. 이 방법대로 루틴을 지키고, 일주일 뒤 비슷한 문제로 다시 풀어 봐요.</p>}
          <TipList tips={after?.kind === "pre" ? after.tips : cur.tips} />
          {after?.kind === "pre" && <Review review={after.review} />}
          {cur.post_ready
            ? <button onClick={() => setQuiz(cur)} className="mt-3 h-11 w-full rounded-xl bg-sm-orange text-[14px] font-extrabold text-white">다시 시험 풀기 ({cur.total}문제) ›</button>
            : <p className="mt-3 text-[12px] text-gray-400">같은 유형 · 같은 난이도의 다른 문제로 다시 풀어요. 외워서 맞히는 게 아니라 공부법 효과를 보는 거예요.</p>}
        </div>
      ) : (
        /* 아직 시험이 없으면 — 단원 적고 시작 */
        <div className={box}>
          {head}
          <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">
            이 공부법이 나한테 맞는지 숫자로 확인해요. 지금 10문제를 풀고, 일주일 뒤 비슷한 문제를 다시 풀어 몇 개 더 맞히는지 봐요.
          </p>
          {last && (
            <p className="mt-2 text-[12.5px] text-gray-500">
              지난 시험 · {last.unit} {last.pre_score}/{last.total} → {last.post_score}/{last.total}
              {last.result && <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${RESULT_COLOR[last.result] ?? ""}`}>{RESULT_LABEL[last.result]}</span>}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <input value={unit} onChange={(e) => { setUnit(e.target.value.slice(0, 40)); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) make(); }}
              placeholder={subject === "수학" ? "단원 · 예: 이차함수, 미적분 극한" : subject === "국어" ? "단원 · 예: 비문학 과학 지문, 현대시" : "단원 · 예: 많이 틀리는 단원"}
              className="h-11 min-w-0 flex-1 rounded-xl bg-white px-3.5 text-[14px] outline-none ring-1 ring-gray-200 focus:ring-gray-300" />
            <button onClick={() => make()} disabled={Boolean(busy) || unit.trim().length < 2} className="h-11 flex-none rounded-xl bg-sm-navy px-4 text-[13.5px] font-extrabold text-white disabled:opacity-40">
              {busy === "make" ? "만드는 중…" : "시험 만들기"}
            </button>
          </div>
          {busy === "make" && <p className="mt-2 text-[12px] text-gray-400">문제 20개(지금 10 · 일주일 뒤 10)를 만들고 정답을 확인하는 중이에요. 30초~1분쯤 걸려요.</p>}
        </div>
      )}
      {err && <p className="mt-2 text-[12.5px] font-bold text-red-500">{err}</p>}
      {quiz && <Quiz title={`${quiz.subject} · ${quiz.unit} ${quiz.status === "pre" ? "시작 시험" : "다시 시험"}`} questions={quiz.questions} busy={busy === "submit"} onClose={() => setQuiz(null)} onSubmit={submit} />}
    </>
  );
}

function Diary({ userId, focus, initSubject = "" }) {
  const nav = useNavigate();
  const today = kst();
  const [day, setDay] = useState(today);
  const [routines, setRoutines] = useState(null);
  const [logs, setLogs] = useState({}); // `${routine_id}|${day}` → done
  const [memo, setMemo] = useState("");
  const [mins, setMins] = useState("");
  const [saved, setSaved] = useState("");
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState(-1);
  const [tab, setTab] = useState(initSubject); // 과목 탭 (비어 있으면 첫 과목) · 물꼬 카드에서 오면 그 과목
  const box = useRef(null);
  const monday = addDay(day, 1 - wdOf(day));
  const week = Array.from({ length: 7 }, (_, i) => addDay(monday, i));

  useEffect(() => {
    supabase.from("plan_routines").select("*").eq("active", true).order("sort").then(({ data }) => setRoutines(data ?? []));
    if (focus) setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  useEffect(() => {
    supabase.from("plan_logs").select("routine_id,day,done").gte("day", week[0]).lte("day", week[6]).then(({ data }) => {
      const m = {};
      (data ?? []).forEach((r) => { m[`${r.routine_id}|${r.day}`] = r.done; });
      setLogs(m);
    });
    supabase.from("plan_diary").select("memo,study_min").eq("day", day).maybeSingle().then(({ data }) => {
      setMemo(data?.memo ?? "");
      setMins(data?.study_min ? String(data.study_min) : "");
      setSaved("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, userId]);

  const ORDER = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사", "전과목", ""];
  const todays = (routines ?? []).filter((r) => (r.days ?? []).includes(wdOf(day)))
    .sort((a, b) => ORDER.indexOf(a.subject ?? "") - ORDER.indexOf(b.subject ?? "") || a.sort - b.sort);
  const doneN = todays.filter((r) => logs[`${r.id}|${day}`]).length;
  const subOf = (r) => (r.subject && r.subject !== "전과목" ? r.subject : "매일 습관");
  const TAB_ORDER = ["국어", "수학", "영어", "사회탐구", "과학탐구", "한국사", "매일 습관"];
  // 루틴이 있는 과목 + 물꼬 카드로 온 과목 (루틴이 없어도 효과 시험은 볼 수 있게)
  const tabs = TAB_ORDER.filter((t) => (routines ?? []).some((r) => subOf(r) === t) || t === initSubject);
  const cur = tabs.includes(tab) ? tab : (tabs[0] ?? "");
  const shown = todays.filter((r) => subOf(r) === cur);
  const rate = (d) => {
    const list = (routines ?? []).filter((r) => (r.days ?? []).includes(wdOf(d)));
    return list.length ? list.filter((r) => logs[`${r.id}|${d}`]).length / list.length : 0;
  };
  const future = day > today;

  async function check(r) {
    const k = `${r.id}|${day}`;
    const done = !logs[k];
    setLogs((m) => ({ ...m, [k]: done }));
    const { error } = await supabase.from("plan_logs").upsert({ user_id: userId, routine_id: r.id, day, done }, { onConflict: "routine_id,day" });
    if (error) setLogs((m) => ({ ...m, [k]: !done }));
    else if (done) track("diary_check");
  }
  async function saveDiary() {
    const { error } = await supabase.from("plan_diary").upsert({ user_id: userId, day, memo: memo.slice(0, 500), study_min: Math.max(0, Math.min(1440, Number(mins) || 0)), updated_at: new Date().toISOString() });
    setSaved(error ? "저장하지 못했어요" : "저장했어요");
    if (!error) track("diary_save");
  }
  async function remove(r) {
    setRoutines((list) => list.filter((x) => x.id !== r.id));
    await supabase.from("plan_routines").update({ active: false }).eq("id", r.id);
  }

  const label = (d) => { const x = new Date(`${d}T12:00:00+09:00`); return `${x.getUTCMonth() + 1}/${x.getUTCDate()} (${WD[wdOf(d) - 1]})`; };

  return (
    <section ref={box} className="mt-5 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[17px] font-extrabold text-gray-900">학습 다이어리</b>
        <div className="flex items-center gap-1">
          <button onClick={() => setDay(addDay(day, -1))} className="h-8 w-8 rounded-lg text-[16px] text-gray-500 hover:bg-gray-100" aria-label="전날">‹</button>
          <span className="min-w-[78px] text-center text-[14px] font-extrabold text-gray-800">{day === today ? "오늘 " : ""}{label(day)}</span>
          <button onClick={() => setDay(addDay(day, 1))} className="h-8 w-8 rounded-lg text-[16px] text-gray-500 hover:bg-gray-100" aria-label="다음 날">›</button>
          {day !== today && <button onClick={() => setDay(today)} className="ml-1 rounded-lg bg-gray-100 px-2.5 py-1 text-[12px] font-bold text-gray-600">오늘</button>}
        </div>
      </div>

      {/* 이번 주 — 날마다 얼마나 했는지 */}
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {week.map((d, i) => {
          const r = rate(d);
          return (
            <button key={d} onClick={() => setDay(d)} className={`flex flex-col items-center rounded-xl py-2 ${d === day ? "bg-[#EEF1FA]" : ""}`}>
              <small className={`text-[11.5px] font-bold ${d === today ? "text-sm-orange" : "text-gray-400"}`}>{WD[i]}</small>
              <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black text-white"
                style={{ background: r >= 1 ? "#F97316" : r > 0 ? `rgba(249,115,22,${0.25 + r * 0.5})` : "#E5E7EB" }}>{r >= 1 ? "✓" : ""}</span>
            </button>
          );
        })}
      </div>

      {routines === null && <p className="mt-4 text-[13.5px] text-gray-400">불러오는 중…</p>}
      {routines && !routines.length && (
        <div className="mt-4 rounded-xl bg-[#F8F9FB] px-4 py-5 text-center">
          <p className="text-[14px] font-bold text-gray-700">아직 매일 할 루틴이 없어요</p>
          <p className="mt-1 text-[12.5px] text-gray-500">물꼬에게 하루 공부 루틴을 짜 달라고 한 뒤 [학습 다이어리에 넣기]를 누르면 여기서 매일 체크해요.</p>
          <button onClick={() => nav(ASK_ROUTINE)} className="mt-3 h-10 rounded-xl bg-sm-navy px-5 text-[13.5px] font-extrabold text-white">물꼬에게 루틴 짜 달라기 ›</button>
        </div>
      )}

      {/* 과목 탭 — 루틴이 있는 과목만 */}
      {tabs.length > 0 && (
        <div className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {tabs.map((t) => {
            const list = todays.filter((r) => subOf(r) === t);
            const d = list.filter((r) => logs[`${r.id}|${day}`]).length;
            const on = cur === t;
            return (
              <button key={t} onClick={() => { setTab(t); setOpen(-1); }}
                className={`flex-none rounded-full px-3.5 py-1.5 text-[13px] font-bold ${on ? "bg-sm-navy text-white" : "bg-[#F1F3F8] text-gray-600 hover:bg-[#E7EAF2]"}`}>
                {t}
                {list.length > 0 && <small className={`ml-1 text-[11.5px] ${on ? "text-white/70" : d === list.length ? "text-emerald-600" : "text-gray-400"}`}>{d}/{list.length}</small>}
              </button>
            );
          })}
        </div>
      )}

      {routines?.length > 0 && todays.length > 0 && !shown.length && <p className="mt-4 text-[13.5px] text-gray-400">이날은 {cur} 루틴이 없어요.</p>}
      {shown.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <small className="text-[13px] font-bold text-gray-500">{future ? `이날 ${cur}` : `오늘 ${cur} ${shown.filter((r) => logs[`${r.id}|${day}`]).length}/${shown.length}`}</small>
            <button onClick={() => setEdit((v) => !v)} className="text-[12px] font-semibold text-gray-400 underline">{edit ? "다 했어요" : "루틴 빼기"}</button>
          </div>
          <ul className="mt-1 divide-y divide-gray-100">
            {shown.map((r, i) => {
              const done = Boolean(logs[`${r.id}|${day}`]);
              return (
                <li key={r.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <button onClick={() => !future && check(r)} disabled={future} aria-label={done ? "체크 풀기" : "했어요"}
                      className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border-2 text-[13px] font-black disabled:opacity-30 ${done ? "border-sm-orange bg-sm-orange text-white" : "border-gray-300 text-transparent hover:border-sm-orange"}`}>✓</button>
                    <button onClick={() => setOpen(open === i ? -1 : i)} className="min-w-0 flex-1 text-left">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {(r.time_label || r.minutes > 0) && <small className="rounded-md bg-[#EEF1FA] px-1.5 py-0.5 text-[11.5px] font-bold text-sm-navy">{[r.time_label, r.minutes ? `${r.minutes}분` : ""].filter(Boolean).join(" · ")}</small>}
                        <b className={`text-[15px] font-bold leading-snug ${done ? "text-gray-400 line-through" : "text-gray-900"}`}>{r.title}</b>
                      </span>
                      {r.how && (open === i
                        ? <p className="mt-1.5 rounded-lg bg-[#FFF7ED] px-3 py-2 text-[13px] leading-relaxed text-gray-700"><b className="text-sm-orange">어떻게</b> · {r.how}</p>
                        : <small className="mt-0.5 block text-[12px] text-gray-400">어떻게 하는지 보기 ›</small>)}
                    </button>
                    {edit && <button onClick={() => remove(r)} className="flex-none rounded-lg px-2 py-1 text-[12px] font-bold text-red-500 hover:bg-red-50">빼기</button>}
                  </div>
                </li>
              );
            })}
          </ul>
          {!future && doneN === todays.length && <p className="mt-2 rounded-xl bg-emerald-50 px-4 py-3 text-center text-[14px] font-extrabold text-emerald-700">오늘 루틴 완료! 내일도 이어 가요</p>}
        </>
      )}
      {routines?.length > 0 && !todays.length && <p className="mt-4 text-[13.5px] text-gray-400">이날은 정해 둔 루틴이 없어요.</p>}

      {/* 이 과목 공부법 효과 시험 */}
      {TEST_SUBJECTS.includes(cur) && <TestBox subject={cur} />}

      {/* 한 줄 일기 */}
      {!future && (
        <div className="mt-4 rounded-xl bg-[#F8F9FB] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <b className="text-[13.5px] font-extrabold text-gray-800">한 줄 일기</b>
            <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-gray-500">
              공부한 시간
              <input value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0"
                className="w-14 rounded-lg bg-white px-2 py-1 text-right text-[13px] text-gray-900 outline-none ring-1 ring-gray-200" />분
            </label>
          </div>
          <textarea value={memo} onChange={(e) => { setMemo(e.target.value.slice(0, 500)); setSaved(""); }} rows={2}
            placeholder="예: 수학 오답 3개 정리 · 비문학 시간이 모자랐음 · 내일은 일찍 시작하기"
            className="mt-2 w-full resize-none rounded-lg bg-white px-3 py-2 text-[13.5px] leading-relaxed outline-none ring-1 ring-gray-200 focus:ring-gray-300" />
          <div className="mt-1.5 flex items-center justify-end gap-2">
            {saved && <small className="text-[12px] font-bold text-emerald-600">{saved}</small>}
            <button onClick={saveDiary} className="h-9 rounded-lg bg-sm-navy px-4 text-[13px] font-extrabold text-white">저장</button>
          </div>
        </div>
      )}
      {routines?.length > 0 && <button onClick={() => nav(ASK_ROUTINE)} className="mt-3 text-[12.5px] font-semibold text-gray-400 underline">+ 물꼬에게 다른 과목 루틴 받기</button>}
    </section>
  );
}

export default function Plan() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [view, setView] = useState(() => firstView(loc)); // study 학습 플랜 · exam 입시 플랜
  const [data, setData] = useState(null); // { plan, tasks, week_start, profile, notes }
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [buy, setBuy] = useState(false);
  const [openMonth, setOpenMonth] = useState(0);

  function pick(v) {
    setView(v);
    try {
      localStorage.setItem(TAB_KEY, v);
    } catch {
      /* 저장소를 못 쓰는 브라우저 */
    }
  }

  async function load() {
    const r = await call({ action: "plan_status" });
    if (r.error) return setErr(r.error);
    setData(r);
    // 새 주 — 지난주를 보고 이번 주 할 일을 다시 짠다
    if (r.need_week) {
      setBusy("week");
      const w = await call({ action: "plan_next_week" });
      setBusy("");
      if (w.need_pay) return setBuy(true);
      if (w.tasks) setData((d) => ({ ...d, tasks: w.tasks }));
      else if (w.error) setErr(w.error);
    }
  }
  useEffect(() => {
    if (user) load();
    track("plan_view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function toggle(t) {
    const done = !t.done;
    setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done } : x)) }));
    const { error } = await supabase.from("plan_tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: !done } : x)) }));
    else if (done) track("plan_check");
  }

  async function reweek() {
    setBusy("week");
    setErr("");
    const w = await call({ action: "plan_next_week", force: true });
    setBusy("");
    if (w.need_pay) return setBuy(true);
    if (w.tasks) setData((d) => ({ ...d, tasks: w.tasks }));
    else setErr(w.error ?? "미션을 다시 짜지 못했어요");
  }

  if (loading) return <div className="min-h-[60vh]" />;
  if (!user) return <LoginGate title="내 플랜" desc="매일 할 공부를 체크하는 학습 플랜, 목표 대학까지 가는 입시 플랜을 한곳에서 볼 수 있어요." />;

  const plan = data?.plan;
  const P = plan?.plan ?? {};
  const tasks = data?.tasks ?? [];
  const doneN = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneN / tasks.length) * 100) : 0;

  const sub = view === "study"
    ? "매일 할 공부를 체크하고 한 줄 일기를 남겨요"
    : plan
      ? `${plan.grade}${plan.department ? ` · ${plan.department}` : ""} · 물꼬 입시 AI가 짠 계획`
      : "목표 대학 · 학과에 맞춰 지금 뭘 해야 할지 짜 드려요";

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight text-gray-900 sm:text-[30px]">내 플랜</h1>
            <p className="mt-1 text-[14px] text-gray-500">{sub}</p>
          </div>
          {view === "exam" && plan && <button onClick={() => nav(ASK_AGAIN)} className="h-10 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-bold text-gray-700 hover:border-gray-300">물꼬에게 다시 짜 달라기</button>}
        </div>

        {/* 탭 — 학습 플랜 · 입시 플랜 */}
        <div className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-gray-200">
          {VIEWS.map((v) => {
            const on = view === v.id;
            return (
              <button key={v.id} onClick={() => pick(v.id)} aria-pressed={on}
                className={`h-11 rounded-xl text-[15px] font-extrabold transition-colors ${on ? "bg-sm-navy text-white" : "text-gray-500 hover:bg-[#F1F3F8]"}`}>
                {v.label}
                {v.id === "exam" && tasks.length > 0 && <small className={`ml-1.5 text-[12px] font-bold ${on ? "text-white/70" : "text-gray-400"}`}>{doneN}/{tasks.length}</small>}
              </button>
            );
          })}
        </div>

        {/* ───── 학습 플랜 — 학습 다이어리 (입시 플랜이 없어도 매일 루틴은 체크할 수 있다) ───── */}
        {view === "study" && <Diary userId={user.id} focus={Boolean(loc.state?.diary) || Boolean(new URLSearchParams(loc.search).get("subject"))} initSubject={new URLSearchParams(loc.search).get("subject") || ""} />}

        {/* ───── 입시 플랜 ───── */}
        {view === "exam" && (
          <>
            {data === null && !err && <p className="mt-10 text-center text-[14px] text-gray-400">불러오는 중…</p>}
            {data === null && err && <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-center text-[13px] font-bold text-red-600">{err}</p>}

            {/* 아직 플랜이 없으면 — 물꼬 채팅에서 만든다 */}
            {data && !plan && (
              <div className="mt-5 flex flex-col items-center rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-200">
                <b className="text-[19px] font-extrabold text-gray-900">아직 내 입시 플랜이 없어요</b>
                <p className="mt-2 text-[14px] leading-relaxed text-gray-500">
                  물꼬 입시 AI에게 목표 대학 · 학과를 알려 주면
                  <br />
                  들을 과목 · 과목별 공부법 · 활동 · 이번 주 미션까지 짜 드려요.
                  {data.notes > 0 && <><br /><span className="text-emerald-600">생기부 노트에 적은 활동 {data.notes}개도 같이 봐요.</span></>}
                </p>
                <button onClick={() => { track("plan_ask"); nav(ASK_NEW); }} className="mt-6 h-[52px] rounded-xl bg-sm-navy px-7 text-[15.5px] font-extrabold text-white">물꼬에게 플랜 짜 달라기 ›</button>
                {err && <p className="mt-3 text-[13px] font-bold text-red-500">{err}</p>}
              </div>
            )}

            {plan && (
              <>
                {/* 목표 — 대학 · 학과 · 이 학과가 보는 것 · 전형 포인트 */}
                {P.target?.university && (
                  <section className="mt-5 rounded-2xl bg-sm-navy p-5 text-white sm:p-6">
                    <small className="text-[12px] font-bold text-white/60">내 목표</small>
                    <b className="mt-0.5 block text-[20px] font-extrabold">{P.target.university} {P.target.department}</b>
                    {P.target.note && <p className="mt-2 text-[14px] leading-relaxed text-white/85">{P.target.note}</p>}
                    {P.admission?.length > 0 && (
                      <ul className="mt-3 grid gap-2">
                        {P.admission.map((a, i) => (
                          <li key={i} className="rounded-xl bg-white/10 px-4 py-2.5 text-[13.5px] leading-relaxed">
                            <b className="text-sm-orange">{a.label}</b> · {a.point}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
                {P.summary && <p className="mt-4 rounded-2xl bg-[#EEF1FA] px-5 py-4 text-[14.5px] leading-relaxed text-gray-800">{P.summary}</p>}
                {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

                {/* 이번 주 할 일 */}
                <section className="mt-5 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <b className="text-[17px] font-extrabold text-gray-900">이번 주 미션</b>
                      <small className="ml-2 text-[12.5px] text-gray-400">{weekLabel(data.week_start)}</small>
                    </div>
                    <b className="text-[15px] font-extrabold text-sm-orange">{doneN}/{tasks.length}</b>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-sm-orange transition-all" style={{ width: `${Math.max(pct, tasks.length ? 3 : 0)}%` }} />
                  </div>
                  {busy === "week" && <p className="mt-4 text-[13.5px] text-gray-400">지난주를 보고 이번 주 미션을 짜는 중…</p>}
                  <ul className="mt-3 divide-y divide-gray-100">
                    {tasks.map((t) => {
                      const go = LINKS[t.link];
                      return (
                        <li key={t.id} className="flex items-start gap-3 py-3.5">
                          <button onClick={() => toggle(t)} aria-label={t.done ? "체크 풀기" : "했어요"}
                            className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md border-2 text-[13px] font-black ${t.done ? "border-sm-orange bg-sm-orange text-white" : "border-gray-300 text-transparent hover:border-sm-orange"}`}>✓</button>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[15px] font-bold leading-snug ${t.done ? "text-gray-400 line-through" : "text-gray-900"}`}>{t.title}</p>
                            {t.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">{t.detail}</p>}
                          </div>
                          {go && !t.done && (
                            <button onClick={() => nav(go.to)} className="flex-none rounded-lg bg-[#EEF1FA] px-3 py-1.5 text-[12.5px] font-bold text-sm-navy hover:bg-[#E3E7F3]">{go.label} ›</button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {!tasks.length && busy !== "week" && <p className="mt-3 text-[13.5px] text-gray-400">이번 주 미션이 아직 없어요.</p>}
                  {tasks.length > 0 && doneN === tasks.length && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-center text-[14px] font-extrabold text-emerald-700">이번 주 미션 완료! 다음 주 월요일에 새 미션이 나와요</p>}
                  <button onClick={reweek} disabled={Boolean(busy)} className="mt-3 text-[12.5px] font-semibold text-gray-400 underline disabled:opacity-40">이번 주 미션 다시 짜기</button>
                </section>

                {/* 들어 두면 좋은 과목 */}
                {P.subjects?.length > 0 && (
                  <section className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                    <b className="text-[16px] font-extrabold text-gray-900">들어 두면 좋은 과목</b>
                    <ul className="mt-3 grid gap-2">
                      {P.subjects.map((x, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-gray-800">
                          <span className={`mt-0.5 flex-none rounded-md px-2 py-0.5 text-[11.5px] font-extrabold ${x.kind === "핵심" ? "bg-sm-orange text-white" : x.kind === "권장" ? "bg-[#EEF1FA] text-sm-navy" : "bg-gray-100 text-gray-500"}`}>{x.kind || "추천"}</span>
                          <span><b className="font-extrabold">{x.name}</b> — {x.why}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* 과목별 공부법 — 선배 공부법 카드에서 */}
                {P.study?.length > 0 && (
                  <section className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                    <b className="text-[16px] font-extrabold text-gray-900">과목별 공부법</b>
                    <small className="ml-2 text-[12px] text-gray-400">선배들이 효과 본 방법</small>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                      {P.study.map((x, i) => (
                        <div key={i} className="rounded-xl bg-[#F8F9FB] px-4 py-3.5">
                          <small className="text-[12px] font-extrabold text-sm-orange">{x.subject}</small>
                          <b className="mt-0.5 block text-[14.5px] font-extrabold text-gray-900">{x.tip}</b>
                          <ol className="mt-1.5 grid gap-1">
                            {(x.how ?? []).map((h, j) => <li key={j} className="text-[13px] leading-relaxed text-gray-600">{j + 1}. {h}</li>)}
                          </ol>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* 활동 · 독서 방향 */}
                {P.activities?.length > 0 && (
                  <section className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                    <b className="text-[16px] font-extrabold text-gray-900">탐구 · 독서 · 활동 방향</b>
                    <ul className="mt-3 grid gap-2">
                      {P.activities.map((a, i) => <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-gray-800"><span className="text-sm-orange">●</span>{a}</li>)}
                    </ul>
                  </section>
                )}

                {/* 이번 학기 목표 */}
                {P.semester?.length > 0 && (
                  <section className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                    <b className="text-[16px] font-extrabold text-gray-900">이번 학기 목표</b>
                    <ol className="mt-3 grid gap-2">
                      {P.semester.map((g, i) => (
                        <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed text-gray-800">
                          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sm-navy text-[12px] font-bold text-white">{i + 1}</span>{g}
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {/* 월별 계획 */}
                {P.months?.length > 0 && (
                  <section className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                    <b className="text-[16px] font-extrabold text-gray-900">월별 계획</b>
                    <div className="mt-3 grid gap-2">
                      {P.months.map((m, i) => (
                        <div key={i} className="rounded-xl bg-[#F8F9FB]">
                          <button onClick={() => setOpenMonth(openMonth === i ? -1 : i)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                            <b className="w-12 flex-none text-[15px] font-extrabold text-sm-orange">{m.label}</b>
                            <span className="flex-1 text-[14px] font-semibold text-gray-800">{m.focus}</span>
                            <span className="text-[12px] text-gray-400">{openMonth === i ? "▲" : "▼"}</span>
                          </button>
                          {openMonth === i && (
                            <ul className="grid gap-1.5 px-4 pb-4 pl-[76px]">
                              {m.todo.map((t, k) => <li key={k} className="text-[13.5px] leading-relaxed text-gray-600">• {t}</li>)}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {/* 지난 미션 기록 — 주마다 쌓인다 */}
                {data.history?.length > 0 && (
                  <section className="mt-4 rounded-2xl bg-white p-5 ring-1 ring-gray-200 sm:p-6">
                    <b className="text-[16px] font-extrabold text-gray-900">지난 미션 기록</b>
                    <div className="mt-3 grid gap-2">
                      {data.history.map((w) => (
                        <details key={w.week_start} className="rounded-xl bg-[#F8F9FB] px-4 py-3">
                          <summary className="flex cursor-pointer list-none items-center gap-3">
                            <span className="w-[92px] flex-none text-[13px] font-bold text-gray-600">{weekLabel(w.week_start)}</span>
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200"><i className="block h-full rounded-full bg-sm-orange" style={{ width: `${w.total ? (w.done / w.total) * 100 : 0}%` }} /></span>
                            <b className={`w-10 flex-none text-right text-[13px] ${w.done === w.total ? "text-emerald-600" : "text-gray-700"}`}>{w.done}/{w.total}</b>
                          </summary>
                          <ul className="mt-2 grid gap-1 pl-[104px]">
                            {w.items.map((t, k) => <li key={k} className={`text-[13px] ${t.done ? "text-gray-500" : "text-gray-400 line-through decoration-gray-300"}`}>{t.done ? "✓" : "·"} {t.title}</li>)}
                          </ul>
                        </details>
                      ))}
                    </div>
                  </section>
                )}
                <p className="mt-4 text-center text-[12px] text-gray-400">플랜은 저장돼요 · 매주 월요일에 지난주에 한 것을 보고 새 미션을 드려요</p>
              </>
            )}
          </>
        )}
      </div>

      <PassSheet open={buy} title="물꼬 입시 AI" headline="이번 주 사용량을 다 썼어요" onClose={() => setBuy(false)} onUnlocked={() => { setBuy(false); load(); }} />
    </div>
  );
}