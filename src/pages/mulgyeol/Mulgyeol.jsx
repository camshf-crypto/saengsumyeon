import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { getClientId } from "../../lib/clientId";
import NicknameEditor, {
  NicknameModal,
  fetchNickname,
  needsNickname,
} from "../../components/NicknameEditor";
const GRADE_KEY = "sm_grade";
const GRADES = ["고1", "고2", "고3"];
const BLUE = "#1A5E9A";
const SAND = "#EA580C";
const WIDTH = "mx-auto max-w-xl px-4 sm:px-5";
const CHAR = {
  mulggo: {
    name: "물꼬",
    mark: "꼬",
    bg: "#1A5E9A",
    soft: "#E4EFF8",
    text: "#10262F",
  },
  morae: {
    name: "모래",
    mark: "모",
    bg: "#B98A4E",
    soft: "#F7F1E6",
    text: "#3D2E1A",
  },
};
const num = (v) => Number(v ?? 0);
const pct = (a, b) => {
  const total = num(b);
  if (!total) return 0;
  return Math.round((num(a) / total) * 100);
};
// 날짜가 문자열이 아니어도(Date, 숫자 등) 터지지 않게 처리
const md = (day) => {
  if (!day) return "";
  const s = typeof day === "string" ? day : new Date(day).toISOString();
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!m || !d) return "";
  return `${m}월 ${d}일`;
};
const ago = (t) => {
  if (!t) return "";
  const time = new Date(t).getTime();
  if (Number.isNaN(time)) return "";
  const s = Math.floor((Date.now() - time) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};
const readGrade = () => {
  try {
    const g = localStorage.getItem(GRADE_KEY) || "";
    return GRADES.includes(g) ? g : "";
  } catch {
    return "";
  }
};
// Supabase RPC는 객체/배열/null 중 무엇이든 돌려줄 수 있어서 통일해서 꺼냄
const unwrap = (data) => (Array.isArray(data) ? data[0] : data);
// fetchNickname이 Promise를 안 돌려줘도 안전하게
const getNick = () => Promise.resolve().then(() => fetchNickname());
function Avatar({ who, size = 26 }) {
  const c = CHAR[who];
  if (!c) return null;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        background: c.bg,
        fontSize: size * 0.46,
      }}
    >
      {c.mark}
    </span>
  );
}
function GradeAsk({ onPick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Avatar who="mulggo" />
          <p className="text-[15px] font-bold text-[#10262F]">몇 학년이야?</p>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
          같은 학년끼리 비교해서 보여줄게. 한 번만 물어보고 다음부터는 안
          물어봐.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
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
function Result({ q, grade, onChange }) {
  const r = q.result ?? {};
  const total = num(r.total);
  const same = q.my_answer === "yes" ? num(r.yes) : num(r.no);
  const byGrade = Array.isArray(r.by_grade) ? r.by_grade : [];
  const mine = byGrade.find((x) => x.grade === grade);
  const mineSame = mine
    ? q.my_answer === "yes"
      ? num(mine.yes)
      : num(mine.total) - num(mine.yes)
    : 0;
  const showGrade = mine && num(mine.total) >= 5;
  const yesPct = pct(r.yes, total);
  const gradeResults = byGrade.filter((x) => num(x.total) >= 5);
  return (
    <div className="mt-1 rounded-xl bg-[#F3F7F9] p-4">
      <p className="text-[15px] font-bold text-[#10262F]">
        {showGrade ? (
          <>
            {grade} 중{" "}
            <span style={{ color: BLUE }}>{pct(mineSame, mine.total)}%</span>가
            너랑 같아
          </>
        ) : (
          <>
            답한 사람 중{" "}
            <span style={{ color: BLUE }}>{pct(same, total)}%</span>가 너랑
            같아
          </>
        )}
      </p>
      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-[#DCE5EA]">
        {yesPct > 0 && (
          <span
            style={{
              width: `${yesPct}%`,
              background: BLUE,
            }}
          />
        )}
        {yesPct < 100 && (
          <span
            style={{
              width: `${100 - yesPct}%`,
              background: SAND,
            }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[12.5px] font-bold">
        <span style={{ color: BLUE }}>나도 그래 {yesPct}%</span>
        <span style={{ color: SAND }}>난 아닌데 {100 - yesPct}%</span>
      </div>
      {gradeResults.length > 1 && (
        <p className="mt-2 text-[12.5px] text-gray-500">
          {gradeResults
            .map((x) => `${x.grade} ${pct(x.yes, x.total)}%`)
            .join(" · ")}
          <span className="text-gray-400"> (나도 그래 비율)</span>
        </p>
      )}
      <div className="mt-2 flex items-center justify-between text-[12px] text-gray-400">
        <span>{num(q.display_count).toLocaleString()}명 참여</span>
        <button
          type="button"
          onClick={onChange}
          className="underline-offset-2 hover:underline"
        >
          답 바꾸기
        </button>
      </div>
    </div>
  );
}
function Comments({ q, grade, user, onCount }) {
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [nick, setNick] = useState(null);
  const [askNick, setAskNick] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  useEffect(() => {
    if (!user) {
      setNick(null);
      return;
    }
    let alive = true;
    getNick()
      .then((data) => {
        if (alive) setNick(data);
      })
      .catch((error) => console.warn("nickname failed", error));
    return () => {
      alive = false;
    };
  }, [user]);
  const load = useCallback(() => {
    return supabase
      .rpc("mulgyeol_comments_list", { p_question_id: q.id })
      .then(({ data, error }) => {
        if (error) {
          console.warn("comments failed", error);
          setList([]);
          return;
        }
        setList(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.warn("comments failed", error);
        setList([]);
      });
  }, [q.id]);
  useEffect(() => {
    load();
  }, [load]);
  const post = async (parentId = null) => {
    const isReply = parentId !== null;
    const text = (isReply ? replyBody : body).trim();
    if (!text || busy) return;
    setBusy(true);
    setErr("");
    try {
      const { error } = await supabase.rpc("mulgyeol_comment_add", {
        p_question_id: q.id,
        p_body: text,
        p_grade: grade || null,
        p_parent_id: parentId,
      });
      if (error) {
        setErr(error.message || "댓글을 남기지 못했어요");
        return;
      }
      if (isReply) {
        setReplyBody("");
        setReplyTo(null);
      } else {
        setBody("");
      }
      onCount(1);
      await load();
    } catch (e) {
      setErr(e?.message || "댓글을 남기지 못했어요");
    } finally {
      setBusy(false);
    }
  };
  const send = (parentId = null) => {
    const text = (parentId !== null ? replyBody : body).trim();
    if (!text || busy) return;
    if (!user) {
      nav("/login");
      return;
    }
    if (needsNickname(nick)) {
      setAskNick(true);
      return;
    }
    post(parentId);
  };
  const remove = async (id) => {
    if (!window.confirm("이 댓글을 지울까?")) return;
    const { error } = await supabase.rpc("mulgyeol_comment_delete", {
      p_comment_id: id,
    });
    if (error) {
      window.alert(error.message || "댓글을 지우지 못했어");
      return;
    }
    load();
  };
  const report = async (id) => {
    if (!user) {
      nav("/login");
      return;
    }
    if (!window.confirm("이 댓글을 신고할까? 신고가 쌓이면 자동으로 가려져.")) return;
    const { error } = await supabase.rpc("mulgyeol_comment_report", {
      p_comment_id: id,
    });
    if (error) {
      window.alert(error.message || "신고하지 못했어");
      return;
    }
    window.alert("신고했어. 고마워!");
  };
  const comments = list ?? [];
  const roots = comments.filter((c) => !c.parent_id);
  const repliesOf = (id) => comments.filter((c) => Number(c.parent_id) === Number(id));
  const displayName = (c) => {
    if (c.author) return CHAR[c.author]?.name ?? c.author;
    return c.nickname || "고등학생";
  };
  const Meta = ({ c, reply = false }) => (
    <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
      <span className="max-w-[120px] truncate font-bold text-[#10262F]">{displayName(c)}</span>
      {!c.author && c.grade && <span className="text-gray-500">· {c.grade}</span>}
      <span className="text-gray-400">· {ago(c.created_at)}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {!reply && (
          <button
            type="button"
            onClick={() => {
              setReplyTo((v) => (v === c.id ? null : c.id));
              setReplyBody("");
            }}
            className="font-medium text-[#1A5E9A]"
          >
            댓글
          </button>
        )}
        {c.mine ? (
          <button type="button" onClick={() => remove(c.id)} className="text-gray-400 hover:text-red-500">
            지우기
          </button>
        ) : !c.author ? (
          <button type="button" onClick={() => report(c.id)} className="text-gray-300 hover:text-gray-500">
            신고
          </button>
        ) : null}
      </span>
    </div>
  );
  return (
    <div className="mt-3 border-t border-[#E1EAEE] pt-3">
      {!list && <p className="py-3 text-[13px] text-gray-400">댓글을 불러오는 중…</p>}
      <ul className="divide-y divide-[#E7ECEF]">
        {roots.map((c) => {
          const replies = repliesOf(c.id);
          return (
            <li key={c.id} className="py-4 first:pt-1 last:pb-1">
              <Meta c={c} />
              <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-[#10262F]">{c.body}</p>
              {replies.length > 0 && (
                <ul className="mt-3 ml-5 divide-y divide-[#EEF2F4] border-l border-[#DCE5EA] pl-4">
                  {replies.map((r) => (
                    <li key={r.id} className="py-3 first:pt-1 last:pb-0">
                      <Meta c={r} reply />
                      <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-[#10262F]">
                        {r.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {replyTo === c.id && (
                <div className="mt-3 ml-5 border-l border-[#DCE5EA] pl-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-bold text-[#33505C]">
                      {displayName(c)}에게 댓글
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTo(null);
                        setReplyBody("");
                      }}
                      className="text-[12px] text-gray-400"
                    >
                      취소
                    </button>
                  </div>
                  {user ? (
                    <div className="flex gap-2">
                      <textarea
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value.slice(0, 300))}
                        rows={2}
                        autoFocus
                        placeholder="댓글을 남겨봐"
                        className="min-h-[46px] flex-1 resize-none rounded-xl border border-[#D3DFE5] bg-white px-3 py-2.5 text-[14px] outline-none focus:border-[#1A5E9A]"
                      />
                      <button
                        type="button"
                        onClick={() => send(c.id)}
                        disabled={!replyBody.trim() || busy}
                        className="shrink-0 rounded-xl px-4 text-[13px] font-bold text-white disabled:opacity-40"
                        style={{ background: BLUE }}
                      >
                        {busy ? "…" : "댓글"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => nav("/login")}
                      className="h-10 w-full rounded-xl border border-[#1A5E9A] bg-white text-[13px] font-bold text-[#1A5E9A]"
                    >
                      로그인하고 댓글 남기기
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {list && !roots.length && (
        <p className="mt-3 text-center text-[13px] text-gray-400">아직 댓글이 없어. 첫 물방울을 남겨봐!</p>
      )}
      {user ? (
        <div className="mt-3">
          {!needsNickname(nick) && (
            <NicknameEditor
              key={nick?.nickname || "nickname"}
              compact
              onChange={() => {
                getNick().then(setNick).catch(() => {});
                load();
              }}
            />
          )}
          <div className="flex gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="너는 어때? 한 줄이면 충분해"
              className="min-h-[48px] flex-1 resize-none rounded-xl border border-[#D3DFE5] bg-[#F7FAFB] px-3 py-2.5 text-[14px] outline-none focus:border-[#1A5E9A]"
            />
            <button
              type="button"
              onClick={() => send(null)}
              disabled={!body.trim() || busy}
              className="shrink-0 rounded-xl px-4 text-[14px] font-bold text-white disabled:opacity-40"
              style={{ background: BLUE }}
            >
              {busy ? "…" : "남기기"}
            </button>
          </div>
          {err && <p className="mt-1 text-[12.5px] font-bold text-red-500">{err}</p>}
          {askNick && (
            <NicknameModal
              onClose={() => setAskNick(false)}
              onDone={(d) => {
                setNick(d);
                setAskNick(false);
              }}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => nav("/login")}
          className="mt-3 h-11 w-full rounded-xl border border-[#1A5E9A] text-[14px] font-bold text-[#1A5E9A]"
        >
          로그인하고 댓글 남기기
        </button>
      )}
    </div>
  );
}
function Card({ q, grade, user, onAnswer, onCount }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const answered = Boolean(q.my_answer) && !changing;
  const pick = async (answer) => {
    const ok = await onAnswer(q, answer);
    if (ok) setChanging(false);
  };
  return (
    <article className="rounded-2xl border border-[#E1EAEE] bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Avatar who="mulggo" size={24} />
        <span className="text-[12px] font-bold text-[#33505C]">물꼬</span>
        <span className="ml-auto text-[11.5px] text-gray-400">{q.area}</span>
      </div>
      <h3 className="mt-2.5 text-[17px] font-bold leading-snug text-[#10262F]">
        {q.title}
      </h3>
      {q.sub && (
        <p className="mt-1 text-[14px] leading-relaxed text-[#33505C]">
          {q.sub}
        </p>
      )}
      <div className="mt-3">
        {answered ? (
          <Result
            q={q}
            grade={grade}
            onChange={() => {
              setChanging(true);
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => pick("yes")}
                className="h-12 rounded-full text-[15px] font-bold text-white"
                style={{ background: BLUE }}
              >
                나도 그래
              </button>
              <button
                type="button"
                onClick={() => pick("no")}
                className="h-12 rounded-full border border-[#D3DFE5] bg-white text-[15px] font-bold text-[#33505C]"
              >
                난 아닌데
              </button>
            </div>
            <p className="mt-1.5 text-center text-[12px] text-gray-400">
              {num(q.display_count).toLocaleString()}
              명이 답했어 · 누르면 결과가 보여
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="mt-3 flex items-center gap-1.5 text-[13px] font-bold text-[#33505C]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {num(q.comments) ? `댓글 ${num(q.comments)}` : "첫 물방울 남기기"}
        <span className="text-gray-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <Comments
          q={q}
          grade={grade}
          user={user}
          onCount={(d) => {
            onCount(q.id, d);
          }}
        />
      )}
    </article>
  );
}
export default function Mulgyeol() {
  const { user, loading: authLoading } = useAuth();
  const [feed, setFeed] = useState(null);
  const [err, setErr] = useState("");
  const [grade, setGrade] = useState(readGrade);
  const [asking, setAsking] = useState(null);
  const [showOld, setShowOld] = useState(10);
  const clientId = useMemo(() => getClientId(), []);
  useEffect(() => {
    const g = user?.user_metadata?.grade;
    if (!grade && GRADES.includes(g)) {
      setGrade(g);
      try {
        localStorage.setItem(GRADE_KEY, g);
      } catch {
        console.warn("학년 정보를 localStorage에 저장하지 못했습니다.");
      }
    }
  }, [user, grade]);
  const load = useCallback(() => {
    supabase
      .rpc("mulgyeol_feed", {
        p_client_id: clientId,
      })
      .then(({ data, error }) => {
        if (error) {
          console.error("mulgyeol feed failed", error);
          setErr("물결을 불러오지 못했어. 잠시 후 다시 들어와 줘.");
          return;
        }
        setErr("");
        setFeed(unwrap(data) ?? { questions: [], trending: [] });
      })
      .catch((error) => {
        console.error("mulgyeol feed failed", error);
        setErr("물결을 불러오지 못했어. 잠시 후 다시 들어와 줘.");
      });
  }, [clientId]);
  useEffect(() => {
    if (!authLoading) {
      load();
    }
  }, [authLoading, user, load]);
  // 한국 시간 밤 12시가 지나면 피드를 다시 불러와 새 질문을 자동으로 보여준다.
  useEffect(() => {
    if (authLoading) return;
    const now = new Date();
    const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const nextMidnight = new Date(kstNow);
    nextMidnight.setHours(24, 0, 2, 0);
    const delay = Math.max(1000, nextMidnight.getTime() - kstNow.getTime());
    const timer = setTimeout(() => load(), delay);
    return () => clearTimeout(timer);
  }, [authLoading, load]);
  // 방문 기록 — 들어올 때 한 번 (하루에 한 사람 1줄, 다시 오면 횟수만 늘어난다)
  useEffect(() => {
    if (authLoading) return;
    supabase.rpc("mulgyeol_log_visit", { p_client_id: clientId }).then(({ error }) => error && console.warn("visit log failed", error));
  }, [authLoading, user, clientId]);
  const patch = (id, fn) => {
    setFeed((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: (current.questions ?? []).map((question) =>
          question.id === id ? fn(question) : question
        ),
      };
    });
  };
  const sendAnswer = async (q, value, g) => {
    const isFirstAnswer = !q.my_answer;
    let res;
    try {
      const { data, error } = await supabase.rpc("mulgyeol_answer", {
        p_question_id: q.id,
        p_answer: value,
        p_client_id: clientId,
        p_grade: g || null,
      });
      if (error) {
        window.alert(error.message || "답을 저장하지 못했어");
        return false;
      }
      res = unwrap(data);
    } catch (e) {
      window.alert(e?.message || "답을 저장하지 못했어");
      return false;
    }
    if (!res) {
      window.alert("답을 저장하지 못했어");
      return false;
    }
    const nextDisplayCount = num(q.display_count) + (isFirstAnswer ? 1 : 0);
    setFeed((current) => {
      if (!current) return current;
      return {
        ...current,
        questions: (current.questions ?? []).map((x) =>
          x.id === q.id
            ? {
                ...x,
                my_answer: res.my_answer ?? value,
                result: res,
                total: num(res.total),
                display_count: nextDisplayCount,
              }
            : x
        ),
        trending: (current.trending ?? []).map((t) =>
          t.id === q.id ? { ...t, display_count: nextDisplayCount } : t
        ),
      };
    });
    return true;
  };
  const answer = async (q, value) => {
    if (!grade) {
      setAsking({
        q,
        a: value,
      });
      return false;
    }
    return sendAnswer(q, value, grade);
  };
  const pickGrade = (g) => {
    try {
      localStorage.setItem(GRADE_KEY, g);
    } catch {
      console.warn("학년 정보를 localStorage에 저장하지 못했습니다.");
    }
    setGrade(g);
    const pending = asking;
    setAsking(null);
    if (pending) {
      sendAnswer(pending.q, pending.a, g);
    }
  };
  const questions = feed?.questions ?? [];
  const trending = feed?.trending ?? [];
  const todayRaw = questions.filter((q) => q.is_today);
  const todayById = new Map(todayRaw.map((q) => [String(q.id), q]));
  const today = [
    ...trending
      .map((t) => todayById.get(String(t.id)))
      .filter(Boolean),
    ...todayRaw.filter(
      (q) => !trending.some((t) => String(t.id) === String(q.id))
    ),
  ];
  const old = questions.filter((q) => !q.is_today);
  const jump = (id) => {
    document.getElementById(`q-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const bumpComments = (id, d) => {
    patch(id, (x) => ({
      ...x,
      comments: Math.max(0, num(x.comments) + d),
    }));
  };
  return (
    <div className="min-h-screen bg-[#F3F7F9] pb-16 text-[#10262F]">
      <header className="border-b border-[#E1EAEE] bg-white">
        <div className={`${WIDTH} pt-4 sm:pt-6`}>
          <img
            src="/mulgyeol-banner.webp"
            alt="물꼬와 모래가 함께 노트북으로 고등학생들의 이야기를 보고 있는 그림"
            className="block aspect-[16/9] w-full rounded-2xl object-cover object-center sm:aspect-[3/1]"
          />
        </div>
        <div className={`${WIDTH} py-5`}>
          <h1 className="text-[26px] font-extrabold tracking-tight">
            나만 그래?
          </h1>
          <p className="mt-1 text-[15px] font-bold" style={{ color: BLUE }}>
            고등 생활 이야기
          </p>
          <p className="mt-0.5 text-[13.5px] text-gray-500">
            다른 고등학생들도 그런지 확인해봐. 매일 밤 12시에 새 질문이 열려.
          </p>
        </div>
      </header>
      <main className={WIDTH}>
        {err && (
          <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-[14px] font-bold text-red-600">
            {err}
          </p>
        )}
        {!feed && !err && (
          <p className="py-20 text-center text-[14px] text-gray-400">
            물결을 불러오는 중…
          </p>
        )}
        {feed && (
          <>
            <section className="mt-7">
              <h2 className="text-[17px] font-extrabold">물꼬가 물어봤어요</h2>
              <div className="mt-3 space-y-3">
                {today.map((q, i) => (
                  <div key={q.id} id={`q-${q.id}`} className="scroll-mt-4">
                    <Card
                      q={q}
                      grade={grade}
                      user={user}
                      onAnswer={answer}
                      onCount={bumpComments}
                    />
                  </div>
                ))}
              </div>
            </section>
            {old.length > 0 && (
              <section className="mt-9">
                <div className="mt-3 space-y-3">
                  {old.slice(0, showOld).map((q) => (
                    <div key={q.id} id={`q-${q.id}`} className="scroll-mt-4">
                      <Card
                        q={q}
                        grade={grade}
                        user={user}
                        onAnswer={answer}
                        onCount={bumpComments}
                      />
                    </div>
                  ))}
                </div>
                {old.length > showOld && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowOld((n) => n + 10);
                    }}
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
      {asking && (
        <GradeAsk
          onPick={pickGrade}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}
