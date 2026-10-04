import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { getClientId } from "../../lib/clientId";
import NicknameEditor, { NicknameModal, fetchNickname, needsNickname } from "../../components/NicknameEditor";

/*
 * 물결 — 나만 그래?
 * 물꼬가 질문을 올리고, 학생은 [나도 그래] / [난 아닌데] 중 하나를 누른 뒤 결과를 보고 댓글을 단다.
 * 질문은 서버가 한국 날짜 기준으로 오늘까지 열린 것만 보내준다 (밤 12시에 자동으로 새 질문이 열림).
 */

const SHOW_COUNT_FROM = 20; // 참여 인원이 이보다 적으면 숫자를 숨긴다
const GRADE_KEY = "sm_grade"; // 학년은 한 번만 물어보고 브라우저에 기억
const GRADES = ["고1", "고2", "고3"];
const BLUE = "#1A5E9A"; // 나도 그래 · 물꼬
const SAND = "#B98A4E"; // 난 아닌데 · 모래
const WIDTH = "mx-auto max-w-xl px-4 sm:px-5"; // 배너·제목·카드가 같은 폭 (카드 폭에 사진을 맞춘다)

const CHAR = {
  mulggo: { name: "물꼬", mark: "꼬", bg: "#1A5E9A", soft: "#E4EFF8", text: "#10262F" },
  morae: { name: "모래", mark: "모", bg: "#B98A4E", soft: "#F7F1E6", text: "#3D2E1A" },
};

const num = (v) => Number(v ?? 0);
const pct = (a, b) => (num(b) ? Math.round((num(a) / num(b)) * 100) : 0);
const md = (day) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;
const ago = (t) => {
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};
const readGrade = () => {
  try {
    const g = localStorage.getItem(GRADE_KEY) || "";
    return ["고1", "고2", "고3"].includes(g) ? g : ""; // 예전에 고른 '기타'는 다시 묻는다
  } catch {
    return "";
  }
};

/* 캐릭터 동그라미 */
function Avatar({ who, size = 26 }) {
  const c = CHAR[who];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: c.bg, fontSize: size * 0.46 }}
    >
      {c.mark}
    </span>
  );
}

/* 학년 고르기 — 처음 답할 때 한 번만 */
function GradeAsk({ onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Avatar who="mulggo" />
          <p className="text-[15px] font-bold text-[#10262F]">몇 학년이야?</p>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
          같은 학년끼리 비교해서 보여줄게. 한 번만 물어보고 다음부터는 안 물어봐.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => onPick(g)}
              className="h-12 rounded-xl border border-[#D3DFE5] text-[15px] font-bold text-[#10262F] hover:border-[#1A5E9A] hover:bg-[#E4EFF8]"
            >
              {g}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* 답한 뒤 보이는 결과 */
function Result({ q, grade, onChange }) {
  const r = q.result ?? {};
  const total = num(r.total);
  const same = q.my_answer === "yes" ? num(r.yes) : num(r.no);
  const mine = (r.by_grade ?? []).find((x) => x.grade === grade);
  const mineSame = mine ? (q.my_answer === "yes" ? num(mine.yes) : num(mine.total) - num(mine.yes)) : 0;
  const showGrade = mine && num(mine.total) >= 5;
  const yesPct = pct(r.yes, total);

  return (
    <div className="mt-1 rounded-xl bg-[#F3F7F9] p-4">
      <p className="text-[15px] font-bold text-[#10262F]">
        {showGrade ? (
          <>
            {grade} 중 <span style={{ color: BLUE }}>{pct(mineSame, mine.total)}%</span>가 너랑 같아
          </>
        ) : (
          <>
            답한 사람 중 <span style={{ color: BLUE }}>{pct(same, total)}%</span>가 너랑 같아
          </>
        )}
      </p>

      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-[#DCE5EA]">
        {yesPct > 0 && <span style={{ width: `${yesPct}%`, background: BLUE }} />}
        {yesPct < 100 && <span style={{ width: `${100 - yesPct}%`, background: SAND }} />}
      </div>
      <div className="mt-1.5 flex justify-between text-[12.5px] font-bold">
        <span style={{ color: BLUE }}>나도 그래 {yesPct}%</span>
        <span style={{ color: SAND }}>난 아닌데 {100 - yesPct}%</span>
      </div>

      {(r.by_grade ?? []).filter((x) => num(x.total) >= 5).length > 1 && (
        <p className="mt-2 text-[12.5px] text-gray-500">
          {(r.by_grade ?? [])
            .filter((x) => num(x.total) >= 5)
            .map((x) => `${x.grade} ${pct(x.yes, x.total)}%`)
            .join(" · ")}
          <span className="text-gray-400"> (나도 그래 비율)</span>
        </p>
      )}

      <div className="mt-2 flex items-center justify-between text-[12px] text-gray-400">
        <span>{total >= SHOW_COUNT_FROM ? `${total.toLocaleString()}명 참여` : "아직 모이는 중"}</span>
        <button onClick={onChange} className="underline-offset-2 hover:underline">
          답 바꾸기
        </button>
      </div>
    </div>
  );
}

/* 댓글 */
function Comments({ q, grade, user, onCount }) {
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nick, setNick] = useState(null); // 내 닉네임 상태
  const [askNick, setAskNick] = useState(false); // 처음 남길 때 닉네임 팝업

  useEffect(() => {
    if (user) fetchNickname().then(setNick);
  }, [user]);

  const load = useCallback(() => {
    supabase.rpc("mulgyeol_comments_list", { p_question_id: q.id }).then(({ data, error }) => {
      if (error) console.warn("comments failed", error);
      setList(error ? [] : data ?? []);
    });
  }, [q.id]);

  useEffect(() => {
    load();
  }, [load]);

  // 댓글 남기기 — 아직 닉네임이 없으면 팝업에서 먼저 정하고, 정하면 바로 이어서 남긴다
  function send() {
    if (!body.trim() || busy) return;
    if (needsNickname(nick)) {
      setAskNick(true);
      return;
    }
    post();
  }

  async function post() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.rpc("mulgyeol_comment_add", {
      p_question_id: q.id,
      p_body: text,
      p_grade: grade || null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message || "댓글을 남기지 못했어요");
      return;
    }
    setBody("");
    onCount(1);
    load();
  }

  async function remove(id) {
    if (!window.confirm("이 댓글을 지울까?")) return;
    await supabase.rpc("mulgyeol_comment_delete", { p_comment_id: id });
    onCount(-1);
    load();
  }

  async function report(id) {
    if (!user) return nav("/login");
    if (!window.confirm("이 댓글을 신고할까? 신고가 쌓이면 자동으로 가려져.")) return;
    await supabase.rpc("mulgyeol_comment_report", { p_comment_id: id });
    window.alert("신고했어. 고마워!");
  }

  const students = (list ?? []).filter((c) => !c.author);

  return (
    <div className="mt-3 border-t border-[#E1EAEE] pt-3">
      {!list && <p className="py-3 text-[13px] text-gray-400">댓글을 불러오는 중…</p>}

      <ul className="space-y-2.5">
        {(list ?? []).map((c) =>
          c.author ? (
            <li key={c.id} className="flex gap-2.5 rounded-xl p-3" style={{ background: CHAR[c.author].soft }}>
              <Avatar who={c.author} />
              <div className="min-w-0">
                <p className="text-[12px] font-bold" style={{ color: CHAR[c.author].bg }}>
                  {CHAR[c.author].name}
                </p>
                <p className="mt-0.5 text-[14px] leading-relaxed" style={{ color: CHAR[c.author].text }}>
                  {c.body}
                </p>
              </div>
            </li>
          ) : (
            <li key={c.id} className="rounded-xl border border-[#E1EAEE] bg-white p-3">
              <div className="flex items-center gap-1.5 text-[12px]">
                <span className="font-bold text-[#10262F]">{c.nickname || "고등학생"}</span>
                {c.grade && <span className="text-gray-500">· {c.grade}</span>}
                {c.answer && (
                  <span className={c.answer === "yes" ? "font-bold text-[#1A5E9A]" : "text-gray-500"}>
                    · {c.answer === "yes" ? "나도 그래" : "난 아닌데"}
                  </span>
                )}
                <span className="text-gray-400">· {ago(c.created_at)}</span>
                <span className="ml-auto">
                  {c.mine ? (
                    <button onClick={() => remove(c.id)} className="text-gray-400 hover:text-red-500">
                      지우기
                    </button>
                  ) : (
                    <button onClick={() => report(c.id)} className="text-gray-300 hover:text-gray-500">
                      신고
                    </button>
                  )}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-[#10262F]">{c.body}</p>
            </li>
          )
        )}
      </ul>

      {list && !students.length && (
        <p className="mt-3 text-center text-[13px] text-gray-400">아직 학생 댓글이 없어. 첫 물방울을 남겨봐!</p>
      )}

      {user ? (
        <div className="mt-3">
          {/* 닉네임 — 정한 뒤에는 입력칸 위에 보이고 바로 바꿀 수 있다 */}
          {!needsNickname(nick) && <NicknameEditor key={nick?.nickname} compact onChange={load} />}
          <div className="flex gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="너는 어때? 한 줄이면 충분해"
              className="min-h-[48px] flex-1 resize-none rounded-xl border border-[#D3DFE5] bg-[#F7FAFB] px-3 py-2.5 text-[14px] outline-none focus:border-[#1A5E9A]"
            />
            <button
              onClick={send}
              disabled={!body.trim() || busy}
              className="shrink-0 rounded-xl px-4 text-[14px] font-bold text-white disabled:opacity-40"
              style={{ background: BLUE }}
            >
              {busy ? "…" : "남기기"}
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-gray-400">
            닉네임과 학년만 보여. 학교 이름·전화번호·SNS 아이디는 자동으로 가려져.
          </p>
          {err && <p className="mt-1 text-[12.5px] font-bold text-red-500">{err}</p>}
          {askNick && (
            <NicknameModal
              onClose={() => setAskNick(false)}
              onDone={(d) => {
                setNick(d);
                setAskNick(false);
                post();
              }}
            />
          )}
        </div>
      ) : (
        <button
          onClick={() => nav("/login")}
          className="mt-3 h-11 w-full rounded-xl border border-[#1A5E9A] text-[14px] font-bold text-[#1A5E9A]"
        >
          로그인하고 댓글 남기기
        </button>
      )}
    </div>
  );
}

/* 질문 카드 */
function Card({ q, grade, user, onAnswer, onCount }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const answered = q.my_answer && !changing;

  async function pick(a) {
    await onAnswer(q, a);
    setChanging(false);
  }

  return (
    <article className="rounded-2xl border border-[#E1EAEE] bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Avatar who="mulggo" size={24} />
        <span className="text-[12px] font-bold text-[#33505C]">물꼬</span>
        <span className="ml-auto text-[11.5px] text-gray-400">{q.area}</span>
      </div>

      <h3 className="mt-2.5 text-[17px] font-bold leading-snug text-[#10262F]">{q.title}</h3>
      {q.sub && <p className="mt-1 text-[14px] leading-relaxed text-[#33505C]">{q.sub}</p>}

      <div className="mt-3">
        {answered ? (
          <Result q={q} grade={grade} onChange={() => setChanging(true)} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => pick("yes")}
                className="h-12 rounded-full text-[15px] font-bold text-white"
                style={{ background: BLUE }}
              >
                나도 그래
              </button>
              <button
                onClick={() => pick("no")}
                className="h-12 rounded-full border border-[#D3DFE5] bg-white text-[15px] font-bold text-[#33505C]"
              >
                난 아닌데
              </button>
            </div>
            <p className="mt-1.5 text-center text-[12px] text-gray-400">
              {num(q.total) >= SHOW_COUNT_FROM ? `${num(q.total).toLocaleString()}명이 답했어 · ` : ""}누르면 결과가 보여
            </p>
          </>
        )}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-3 flex items-center gap-1.5 text-[13px] font-bold text-[#33505C]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {num(q.comments) ? `댓글 ${num(q.comments)}` : "첫 물방울 남기기"}
        <span className="text-gray-400">{open ? "▴" : "▾"}</span>
      </button>

      {open && <Comments q={q} grade={grade} user={user} onCount={(d) => onCount(q.id, d)} />}
    </article>
  );
}

export default function Mulgyeol() {
  const { user, loading: authLoading } = useAuth();
  const [feed, setFeed] = useState(null);
  const [err, setErr] = useState("");
  const [grade, setGrade] = useState(readGrade);
  const [asking, setAsking] = useState(null); // 학년을 먼저 물어봐야 할 때 기다리는 답 { q, a }
  const [showOld, setShowOld] = useState(10); // 지난 질문은 10개씩
  const clientId = useMemo(() => getClientId(), []);

  // 회원은 가입할 때 고른 학년을 쓴다 (따로 묻지 않음)
  useEffect(() => {
    const g = user?.user_metadata?.grade;
    if (!grade && GRADES.includes(g)) setGrade(g);
  }, [user, grade]);

  const load = useCallback(() => {
    supabase.rpc("mulgyeol_feed", { p_client_id: clientId }).then(({ data, error }) => {
      if (error) {
        console.error("mulgyeol feed failed", error);
        setErr("물결을 불러오지 못했어. 잠시 후 다시 들어와 줘.");
        return;
      }
      setFeed(data);
    });
  }, [clientId]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, user, load]);

  function patch(id, fn) {
    setFeed((f) => (f ? { ...f, questions: f.questions.map((x) => (x.id === id ? fn(x) : x)) } : f));
  }

  async function send(q, a, g) {
    const { data, error } = await supabase.rpc("mulgyeol_answer", {
      p_question_id: q.id,
      p_answer: a,
      p_client_id: clientId,
      p_grade: g || null,
    });
    if (error) {
      window.alert(error.message || "답을 저장하지 못했어");
      return;
    }
    patch(q.id, (x) => ({ ...x, my_answer: data.my_answer, result: data, total: num(data.total) }));
  }

  async function answer(q, a) {
    if (!grade) {
      setAsking({ q, a });
      return;
    }
    await send(q, a, grade);
  }

  function pickGrade(g) {
    try {
      localStorage.setItem(GRADE_KEY, g);
    } catch {
      /* 저장이 막혀도 이번에는 쓴다 */
    }
    setGrade(g);
    const wait = asking;
    setAsking(null);
    if (wait) send(wait.q, wait.a, g);
  }

  const questions = feed?.questions ?? [];
  const today = questions.filter((q) => q.is_today);
  const old = questions.filter((q) => !q.is_today);
  const trending = feed?.trending ?? []; // 최근 7일 질문 중 가장 많이 답한 5개

  function jump(id) {
    document.getElementById(`q-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-[#F3F7F9] pb-16 text-[#10262F]">
      <header className="border-b border-[#E1EAEE] bg-white">
        {/* 물꼬·모래 배너 — 아래 카드들과 같은 폭. 휴대폰에서는 가운데 두 캐릭터가 보이게 양옆을 자른다 */}
        <div className={`${WIDTH} pt-4 sm:pt-6`}>
          <img
            src="/mulgyeol-banner.webp"
            alt="물꼬와 모래가 함께 노트북으로 고등학생들의 이야기를 보고 있는 그림"
            className="block aspect-[16/9] w-full rounded-2xl object-cover object-center sm:aspect-[3/1]"
          />
        </div>
        <div className={`${WIDTH} py-5`}>
          <h1 className="text-[26px] font-extrabold tracking-tight">나만 그래?</h1>
          <p className="mt-1 text-[15px] font-bold" style={{ color: BLUE }}>
            고등 생활 이야기
          </p>
          <p className="mt-0.5 text-[13.5px] text-gray-500">다른 고등학생들도 그런지 확인해봐. 매일 밤 12시에 새 질문이 열려.</p>
        </div>
      </header>

      <main className={WIDTH}>
        {err && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-[14px] font-bold text-red-600">{err}</p>}
        {!feed && !err && <p className="py-20 text-center text-[14px] text-gray-400">물결을 불러오는 중…</p>}

        {feed && (
          <>
            {/* 지금 뜨는 물결 — 가장 인기 있는 질문 5개 (숫자는 20명이 넘을 때만) */}
            {trending.length > 0 && (
              <section className="mt-6">
                <h2 className="text-[17px] font-extrabold">지금 뜨는 물결</h2>
                <div className="mt-2.5 overflow-hidden rounded-2xl border border-[#E1EAEE] bg-white">
                  {trending.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => jump(t.id)}
                      className="flex w-full items-center gap-3 border-b border-[#EDF2F4] px-4 py-3 text-left last:border-0 hover:bg-[#F7FAFB]"
                    >
                      <span className="w-4 text-[15px] font-extrabold" style={{ color: BLUE }}>
                        {i + 1}
                      </span>
                      <span className="flex-1 text-[14px] font-medium">{t.title}</span>
                      {num(t.total) >= SHOW_COUNT_FROM && (
                        <span className="shrink-0 text-[12px] text-gray-500">{num(t.total).toLocaleString()}명 이야기 중</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 오늘 질문 */}
            <section className="mt-7">
              <h2 className="text-[17px] font-extrabold">물꼬가 물어봤어요</h2>
              {feed.today && <p className="mt-0.5 text-[12.5px] text-gray-500">{md(feed.today)} 질문</p>}
              <div className="mt-3 space-y-3">
                {today.map((q) => (
                  <div key={q.id} id={`q-${q.id}`} className="scroll-mt-4">
                    <Card
                      q={q}
                      grade={grade}
                      user={user}
                      onAnswer={answer}
                      onCount={(id, d) => patch(id, (x) => ({ ...x, comments: Math.max(0, num(x.comments) + d) }))}
                    />
                  </div>
                ))}
                {!today.length && <p className="rounded-2xl bg-white p-6 text-center text-[14px] text-gray-400">오늘 질문은 곧 열려!</p>}
              </div>
            </section>

            {/* 지난 물결 */}
            {old.length > 0 && (
              <section className="mt-9">
                <h2 className="text-[17px] font-extrabold">지난 물결</h2>
                <p className="mt-0.5 text-[12.5px] text-gray-500">지난 질문도 지금 답할 수 있어</p>
                <div className="mt-3 space-y-3">
                  {old.slice(0, showOld).map((q, i, arr) => (
                    <div key={q.id} id={`q-${q.id}`} className="scroll-mt-4">
                      {(i === 0 || arr[i - 1].open_date !== q.open_date) && (
                        <p className="mb-2 mt-4 text-[12.5px] font-bold text-gray-500">{md(q.open_date)}</p>
                      )}
                      <Card
                        q={q}
                        grade={grade}
                        user={user}
                        onAnswer={answer}
                        onCount={(id, d) => patch(id, (x) => ({ ...x, comments: Math.max(0, num(x.comments) + d) }))}
                      />
                    </div>
                  ))}
                </div>
                {old.length > showOld && (
                  <button
                    onClick={() => setShowOld((n) => n + 10)}
                    className="mt-4 h-11 w-full rounded-xl border border-[#D3DFE5] bg-white text-[14px] font-bold text-[#33505C]"
                  >
                    지난 질문 더 보기
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {asking && <GradeAsk onPick={pickGrade} onClose={() => setAsking(null)} />}
    </div>
  );
}