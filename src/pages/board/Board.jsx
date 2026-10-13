import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import Comments, { askReason } from "../../components/Comments";
import { checkLevel } from "../../components/LevelUp";

/*
 * 📣 옥상에서 외쳐! (예전 자유게시판 · 주소는 그대로 /board)
 *   /board      물꼬의 오늘의 외침 · 최신/인기 외침 · 나도 외치기(Lv.3부터)
 *               말머리는 우선 쓰지 않는다 (새 외침은 모두 '아무말'로 저장 · 글이 많아지면 다시 연다)
 *   /board/:id  외침 하나 — 반응 3개(나도 그래 · 응원해 · 웃겨) · 신고 · 내 외침 지우기 · 댓글(익명)
 * 완전 익명 — '고2 · 익명'으로만 보인다. 학교 이름 · 반 · 연락처 · 링크는 서버에서 막는다
 * 신고 3번이면 자동으로 가려지고 관리자가 확인한다
 */

const REACTS = [
  ["same", "💙", "나도 그래"],
  ["cheer", "🫶", "응원해"],
  ["lol", "😂", "웃겨"],
];

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const who = (a) => `${a?.grade ? `${a.grade} · ` : ""}익명`;

function useToast() {
  const [msg, setMsg] = useState("");
  const t = useRef();
  const show = (m) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 1800);
  };
  const node = msg ? (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-sm-navy/95 px-4 py-2.5 text-[13.5px] font-semibold text-white">{msg}</div>
  ) : null;
  return [node, show];
}

/* ───────── 나도 외치기 창 ───────── */

function WriteSheet({ prompt, onClose, onDone }) {
  const tag = "아무말"; // 말머리는 우선 하나로
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (title.trim().length < 2) return setErr("2자 넘게 외쳐 줘");
    setBusy(true);
    const { data, error } = await supabase.rpc("post_create", { p_tag: tag, p_title: title, p_body: body, p_prompt: prompt?.id ?? null });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B0F1F]/50 sm:items-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-center">
          <b className="text-[17px] font-extrabold text-gray-900">📣 나도 외치기</b>
          <button type="button" onClick={onClose} className="ml-auto text-[14px] text-gray-500">
            닫기
          </button>
        </div>
        {prompt && (
          <p className="mt-3 rounded-xl bg-[#F4F5F7] px-3.5 py-2.5 text-[13px] text-gray-700">
            <b className="text-sm-navy">물꼬의 오늘의 외침</b> · {prompt.text}
          </p>
        )}
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, "").slice(0, 60))}
          autoFocus
          rows={2}
          placeholder="야!!! 하고 싶은 말 한 줄 외쳐 봐"
          className="mt-3 w-full resize-none rounded-[12px] border border-gray-200 px-4 py-3 text-[18px] font-extrabold leading-snug outline-none placeholder:font-semibold focus:border-sm-navy"
        />
        <p className="text-right text-[11.5px] text-gray-400">{title.length}/60</p>
        {more ? (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 2000))}
            rows={5}
            placeholder="더 하고 싶은 말 (안 써도 돼)"
            className="mt-1 w-full resize-none rounded-[10px] border border-gray-200 px-3.5 py-3 text-[14.5px] leading-relaxed outline-none focus:border-sm-navy"
          />
        ) : (
          <button type="button" onClick={() => setMore(true)} className="text-[13px] font-semibold text-gray-500">
            + 더 하고 싶은 말 쓰기
          </button>
        )}
        <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-[12px] leading-relaxed text-[#C2410C]">
          완전 익명으로 올라가 (학년만 보여). 대신 이름 · 학교 · 반처럼 누군지 알 수 있는 내용, 특정 사람을 저격하는 글은 안 돼.
        </p>
        {err && <p className="mt-2 text-[13px] font-semibold text-red-600">{err}</p>}
        <button disabled={busy} className="mt-3 h-12 w-full rounded-[10px] bg-sm-navy text-[15px] font-bold text-white disabled:opacity-50">
          {busy ? "외치는 중…" : "외치기 · +3점"}
        </button>
      </form>
    </div>
  );
}

/* ───────── 목록 ───────── */

// 학년 색 (관리자 통계와 같은 색)
const GCHIP = {
  고1: "bg-blue-50 text-blue-700",
  고2: "bg-teal-50 text-teal-700",
  고3: "bg-orange-50 text-[#C2410C]",
};

export function BoardList() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const nav = useNavigate();
  const tag = null; // 말머리는 우선 안 나눈다
  const [sort, setSort] = useState("new");
  const [onlyPrompt, setOnlyPrompt] = useState(false);
  const [list, setList] = useState(null);
  const [today, setToday] = useState(null);
  const [lv, setLv] = useState(null);
  const [writing, setWriting] = useState(null); // null | { prompt }
  const [toastNode, toast] = useToast();

  const load = () =>
    supabase
      .rpc("post_list", { p_tag: tag, p_sort: sort, p_limit: 50, p_prompt: onlyPrompt ? today?.id ?? null : null })
      .then(({ data }) => setList(data || []));

  useEffect(() => {
    supabase.rpc("shout_today").then(({ data }) => setToday(data || null));
  }, []);
  useEffect(() => {
    setList(null);
    load();
  }, [tag, sort, onlyPrompt, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!uid) return setLv(null);
    supabase.rpc("lv_me").then(({ data }) => setLv(data));
  }, [uid]);

  const canWrite = lv && lv.level >= 3;
  const needToWrite = lv && lv.level < 3 ? 8 - lv.points : null; // Lv.3 = 8점

  function openWrite(prompt = null) {
    if (!uid) return nav("/signup");
    if (!canWrite) return toast(`외치기는 Lv.3부터 · ${needToWrite}점 남았어`);
    setWriting({ prompt });
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10">
        {/* 노을 진 옥상 — 이 방만의 분위기 (아래 카드는 생수면 기본 흰 카드) */}
        <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(180deg,#2B2F5E_0%,#6B4A86_48%,#E58FA0_82%,#F6C1A8_100%)] px-5 pb-16 pt-6 text-white sm:px-8 sm:pb-24 sm:pt-9">
          <svg aria-hidden="true" viewBox="0 0 1200 120" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-12 w-full text-[#2A2440]/75 sm:h-20">
            <path fill="currentColor" d="M0 120V70h60V40h40v30h50V55h70v65h20V30h55v90h30V60h45V20h30v100h40V75h80V45h25v75h35V65h60V35h20V15h30v105h45V80h70V50h40v70h30V60h55v60h25V40h45v80h40V70h50v50Z" />
          </svg>
          <h1 className="relative text-[28px] font-black tracking-tight sm:text-[36px]">
            📣 옥상에서 <span className="text-[#FFD3E0]">외쳐!</span>
          </h1>
          <p className="relative mt-1.5 text-[13.5px] leading-relaxed text-white/85 sm:text-[15px]">
            같은 처지끼리, 여기서만큼은 솔직하게.
            <br />
            불안해도 괜찮아. 우리 다 비슷해 💜 · 완전 익명
          </p>

          {/* 물꼬의 오늘의 외침 */}
          {today && (
            <div className="relative mt-5 max-w-xl rounded-2xl bg-white/15 p-4 ring-1 ring-white/25 backdrop-blur-sm">
              <p className="text-[12px] font-bold text-white/75">물꼬의 오늘의 외침</p>
              <p className="mt-1 break-keep text-[18px] font-extrabold leading-snug">“{today.text}”</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => openWrite(today)} className="rounded-xl bg-white px-4 py-2.5 text-[14px] font-extrabold text-[#5B3F7A]">
                  오늘은 내 차례! 외치기
                </button>
                <button
                  onClick={() => setOnlyPrompt((v) => !v)}
                  className={`rounded-xl px-3.5 py-2.5 text-[13px] font-bold ${onlyPrompt ? "bg-white/25 text-white" : "text-white/85"}`}
                >
                  {onlyPrompt ? "전체 외침 보기" : `오늘 ${today.answers}명이 외쳤어 ›`}
                </button>
              </div>
            </div>
          )}
        </section>

        {uid && lv && !canWrite && (
          <div className="mt-4 rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-white px-4 py-3.5 text-center">
            <b className="text-[14px] text-sm-navy">외치기는 Lv.3부터 열려</b>
            <small className="mt-0.5 block text-[12.5px] text-gray-500">
              지금 Lv.{lv.level} · {needToWrite}점만 더 모으면 돼 (나만 그래? 응답 · 댓글로 금방 올라가)
            </small>
          </div>
        )}

        {/* 정렬 */}
        <div className="mt-6 flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[13px] font-bold text-gray-500">{sort === "hot" ? "이번 주 가장 큰 외침" : "방금 올라온 외침"}</p>
          <div className="flex shrink-0 gap-0.5 rounded-lg bg-[#E9EBEF] p-[3px]">
            {[
              ["new", "최신"],
              ["hot", "인기"],
            ].map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)} className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold ${sort === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* 외침 카드 — 폰 2개 · 태블릿 3개 · PC 4개 */}
        {list === null && <p className="py-12 text-center text-[14px] text-gray-500">불러오는 중…</p>}
        {list?.length === 0 && (
          <div className="mt-3 rounded-2xl bg-white py-12 text-center">
            <p className="text-[14px] text-gray-500">{sort === "hot" ? "이번 주 인기 외침이 아직 없어" : "아직 아무도 안 외쳤어. 첫 외침의 주인공이 돼 봐!"}</p>
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
          {list?.map((p) => (
            <Link
              key={p.id}
              to={`/board/${p.id}`}
              className="flex min-h-[168px] flex-col rounded-2xl bg-white p-3.5 ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:ring-gray-300 hover:shadow-[0_8px_18px_rgba(20,27,61,.08)] sm:min-h-[184px] sm:p-4"
            >
              <div className="flex items-center gap-1.5">
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${GCHIP[p.author?.grade] ?? "bg-gray-100 text-gray-600"}`}>{p.author?.grade || "익명"}</span>
                {p.prompt_id && <span className="truncate text-[11px] font-bold text-[#EA580C]">오늘의 외침</span>}
                {p.mine && <span className="ml-auto shrink-0 text-[11px] font-bold text-sm-navy">내 외침</span>}
              </div>
              <h3 className="mt-2.5 line-clamp-3 break-keep text-[15.5px] font-extrabold leading-snug text-gray-900 sm:text-[16.5px]">{p.title}</h3>
              {p.excerpt && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-gray-500">{p.excerpt}</p>}
              <div className="mt-auto flex items-center gap-2.5 whitespace-nowrap pt-3 text-[12px] font-semibold text-gray-500 sm:gap-3">
                <span>
                  <span className="text-[#EA580C]">♥</span> {Number(p.likes ?? 0)}
                </span>
                <span>💬 {Number(p.comments ?? 0)}</span>
                <span className="ml-auto hidden text-[11px] font-normal text-gray-400 sm:inline">{ago(p.created_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <button
        onClick={() => openWrite(null)}
        className="fixed bottom-6 right-5 z-40 flex h-[52px] items-center gap-1.5 rounded-full bg-sm-navy px-5 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(20,27,61,.3)] sm:right-6"
      >
        📣 나도 외치기
      </button>

      {writing && (
        <WriteSheet
          prompt={writing.prompt}
          onClose={() => setWriting(null)}
          onDone={(id) => {
            setWriting(null);
            checkLevel();
            nav(`/board/${id}`);
          }}
        />
      )}
      {toastNode}
    </div>
  );
}

/* ───────── 외침 하나 ───────── */

export function BoardPost() {
  const { id } = useParams();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [err, setErr] = useState("");
  const [toastNode, toast] = useToast();

  useEffect(() => {
    supabase.rpc("post_get", { p_id: Number(id) }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setP(data);
    });
  }, [id, uid]);

  async function react(kind) {
    if (!uid) return nav("/signup");
    const { data, error } = await supabase.rpc("post_react", { p_id: p.id, p_kind: kind });
    if (error) return toast(error.message);
    setP((x) => ({ ...x, reacts: data.reacts, my_react: data.my_react }));
  }

  async function report() {
    if (!uid) return nav("/signup");
    const reason = askReason();
    if (!reason) return;
    const { data, error } = await supabase.rpc("report_target", { p_kind: "post", p_id: String(p.id), p_reason: reason });
    if (error) return toast(error.message);
    if (data?.hidden) {
      window.alert("신고가 쌓여 이 외침은 가려졌어. 관리자가 확인할게.");
      return nav("/board", { replace: true });
    }
    toast(data?.already ? "이미 신고했어" : "신고했어 · 확인할게");
  }

  async function remove() {
    if (!window.confirm("외침을 지울까? 지우면 이 외침으로 받은 점수도 빠져.")) return;
    await supabase.rpc("post_delete", { p_id: p.id });
    nav("/board", { replace: true });
  }

  if (err)
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-[15px] text-gray-600">{err}</p>
        <Link to="/board" className="mt-4 inline-block font-bold text-sm-navy">
          옥상에서 외쳐!로
        </Link>
      </div>
    );
  if (!p) return <div className="py-24 text-center text-[14px] text-gray-500">불러오는 중…</div>;

  return (
    <div className="bg-white">
      <article className="mx-auto max-w-2xl px-5 pb-20 pt-6 sm:pt-10">
        <Link to="/board" className="text-[13px] font-semibold text-gray-500 hover:text-sm-navy">
          ‹ 옥상에서 외쳐!
        </Link>
        {p.prompt && <p className="mt-5 text-[12.5px] text-gray-500">물꼬의 외침 · {p.prompt}</p>}
        <h1 className="mt-4 text-[24px] font-extrabold leading-snug tracking-tight text-gray-900">{p.title}</h1>
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-gray-500">
          <span>{who(p.author)}</span>
          <span>· {ago(p.created_at)}</span>
          <span className="ml-auto flex gap-3">
            {p.mine ? (
              <button onClick={remove} className="text-gray-400 hover:text-red-600">
                지우기
              </button>
            ) : (
              <button onClick={report} className="text-gray-400 hover:text-red-600">
                신고
              </button>
            )}
          </span>
        </div>
        {p.body && <p className="mt-5 whitespace-pre-line text-[15.5px] leading-[1.8] text-gray-800">{p.body}</p>}

        {/* 반응 3개 */}
        <div className="mt-8 grid grid-cols-3 gap-2">
          {REACTS.map(([k, e, l]) => {
            const on = p.my_react === k;
            return (
              <button
                key={k}
                onClick={() => react(k)}
                disabled={p.mine}
                className={`flex h-16 flex-col items-center justify-center rounded-2xl border-[1.5px] text-[13px] font-bold transition disabled:opacity-60 ${
                  on ? "border-sm-navy bg-sm-navy text-white" : "border-gray-200 text-gray-700"
                }`}
              >
                <span className="text-[18px] leading-none">{e}</span>
                <span className="mt-1">
                  {l} {Number(p.reacts?.[k] ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
        {p.mine && <p className="mt-2 text-center text-[12px] text-gray-400">내 외침에는 반응을 누를 수 없어</p>}

        <Comments kind="post" target={p.id} toast={toast} />
      </article>
      {toastNode}
    </div>
  );
}