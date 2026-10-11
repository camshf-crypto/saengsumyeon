import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import Comments, { LvTag } from "../../components/Comments";
import { checkLevel } from "../../components/LevelUp";
import Avatar from "../../components/Avatar";

/*
 * 자유게시판
 *   /board      목록 — 말머리(질문·고민·수다) · 최신/인기 · 글쓰기(Lv.3부터)
 *   /board/:id  글 — 나도 그래 · 내 글 지우기 · 댓글
 * 글 3점(하루 1개), 나도 그래 받기 2점(하루 6점). 연락처·링크는 서버에서 막는다
 */

const TAGS = ["질문", "고민", "수다"];
const TAG_COLOR = { 질문: "text-indigo-700", 고민: "text-teal-700", 수다: "text-sm-orange" };

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function useToast() {
  const [msg, setMsg] = useState("");
  const t = useRef();
  const show = (m) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 1800);
  };
  const node = msg ? (
    <div className="fixed bottom-40 left-1/2 md:bottom-24 z-50 -translate-x-1/2 rounded-[10px] bg-sm-navy/95 px-4 py-2.5 text-[13.5px] font-semibold text-white">{msg}</div>
  ) : null;
  return [node, show];
}

/* ───────── 글쓰기 창 ───────── */

function WriteSheet({ onClose, onDone }) {
  const [tag, setTag] = useState("질문");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (title.trim().length < 2) return setErr("제목을 2자 넘게 적어 주세요");
    if (!body.trim()) return setErr("내용을 적어 주세요");
    setBusy(true);
    const { data, error } = await supabase.rpc("post_create", { p_tag: tag, p_title: title, p_body: body });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0B0F1F]/50 sm:items-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <div className="flex items-center">
          <b className="text-[17px] font-bold text-gray-900">글쓰기</b>
          <button type="button" onClick={onClose} className="ml-auto text-[14px] text-gray-500">닫기</button>
        </div>
        <div className="mt-4 flex gap-1.5">
          {TAGS.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTag(t)}
              className={`rounded-full border px-4 py-1.5 text-[13.5px] font-semibold ${tag === t ? "border-sm-navy bg-sm-navy text-white" : "border-gray-200 text-gray-600"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="제목"
          className="mt-3 w-full rounded-[10px] border border-gray-200 px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-sm-navy"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={7}
          placeholder="고민이나 궁금한 걸 편하게 적어 주세요"
          className="mt-2 w-full resize-none rounded-[10px] border border-gray-200 px-3.5 py-3 text-[14.5px] leading-relaxed outline-none focus:border-sm-navy"
        />
        <p className="mt-1 text-[11.5px] text-gray-400">연락처 · SNS 아이디 · 링크 · 홍보 글은 올라가지 않아요.</p>
        {err && <p className="mt-2 text-[13px] font-semibold text-red-600">{err}</p>}
        <button disabled={busy} className="mt-3 h-12 w-full rounded-[10px] bg-sm-navy text-[15px] font-bold text-white disabled:opacity-50">
          {busy ? "올리는 중…" : "올리기 · +3점"}
        </button>
      </form>
    </div>
  );
}

/* ───────── 목록 ───────── */

export function BoardList() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const nav = useNavigate();
  const [tag, setTag] = useState(null);
  const [sort, setSort] = useState("new");
  const [list, setList] = useState(null);
  const [lv, setLv] = useState(null);
  const [writing, setWriting] = useState(false);
  const [toastNode, toast] = useToast();

  const load = () => supabase.rpc("post_list", { p_tag: tag, p_sort: sort, p_limit: 50 }).then(({ data }) => setList(data || []));

  useEffect(() => {
    setList(null);
    load();
  }, [tag, sort, uid]);

  useEffect(() => {
    if (!uid) return setLv(null);
    supabase.rpc("lv_me").then(({ data }) => setLv(data));
  }, [uid]);

  const canWrite = lv && lv.level >= 3;
  const needToWrite = lv && lv.level < 3 ? 8 - lv.points : null; // Lv.3 = 8점

  function openWrite() {
    if (!uid) return nav("/signup");
    if (!canWrite) return toast(`글쓰기는 Lv.3부터 · ${needToWrite}점 남았어요`);
    setWriting(true);
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
        <div className="flex items-end">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-sm-navy">자유게시판</h1>
            <p className="mt-1 text-[13px] text-gray-500">질문 · 고민 · 수다 · 글 하나 +3점</p>
          </div>
        </div>

        {uid && lv && !canWrite && (
          <div className="mt-4 rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-white px-4 py-3.5 text-center">
            <b className="text-[14px] text-sm-navy">글쓰기는 Lv.3부터 열려요</b>
            <small className="mt-0.5 block text-[12.5px] text-gray-500">
              지금 Lv.{lv.level} · {needToWrite}점만 더 모으면 돼요 (댓글 10자 이상 1개 = 2점)
            </small>
          </div>
        )}

        <div className="mt-4 flex items-center gap-1.5">
          {[null, ...TAGS].map((t) => (
            <button
              key={t ?? "all"}
              onClick={() => setTag(t)}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${tag === t ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-600"}`}
            >
              {t ?? "전체"}
            </button>
          ))}
          <div className="ml-auto flex gap-0.5 rounded-lg bg-[#E9EBEF] p-[3px]">
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

        <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 sm:px-5">
          {list === null && <p className="py-12 text-center text-[14px] text-gray-500">불러오는 중…</p>}
          {list?.length === 0 && <p className="py-12 text-center text-[14px] text-gray-500">{sort === "hot" ? "이번 주 인기글이 아직 없어요" : "첫 글을 남겨 보세요"}</p>}
          {list?.map((p) => (
            <Link key={p.id} to={`/board/${p.id}`} className="block border-b border-gray-100 py-4 last:border-0">
              <span className={`text-[11.5px] font-bold ${TAG_COLOR[p.tag]}`}>{p.tag}</span>
              <h3 className="mt-0.5 text-[15.5px] font-semibold leading-snug text-gray-900">
                {p.title}
                {p.comments > 0 && <span className="ml-1.5 text-[13px] font-bold text-sm-orange">[{p.comments}]</span>}
              </h3>
              <p className="mt-1 truncate text-[13px] text-gray-500">{p.excerpt}</p>
              <div className="mt-2 flex items-center gap-2 text-[12px] text-gray-500">
                <Avatar src={p.author?.avatar} nick={p.author?.nick} color={p.author?.color} size={20} round />
                <LvTag author={p.author} />
                <span>{p.author?.nick}</span>
                <span>· {ago(p.created_at)}</span>
                <span className="ml-auto">나도 그래 {p.likes}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <button
        onClick={openWrite}
        className="fixed bottom-20 right-5 z-40 md:bottom-6 flex h-[52px] items-center gap-1.5 rounded-full bg-sm-navy px-5 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(20,27,61,.3)] sm:right-[max(20px,calc(50%-380px))]"
      >
        <span className="text-[20px] leading-none">+</span> 글쓰기
      </button>

      {writing && (
        <WriteSheet
          onClose={() => setWriting(false)}
          onDone={(id) => {
            setWriting(false);
            checkLevel();
            nav(`/board/${id}`);
          }}
        />
      )}
      {toastNode}
    </div>
  );
}

/* ───────── 글 ───────── */

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

  async function like() {
    if (!uid) return nav("/signup");
    const { data, error } = await supabase.rpc("like_toggle", { p_kind: "post", p_id: String(p.id) });
    if (error) return toast(error.message);
    setP((x) => ({ ...x, liked: data.liked, likes: data.likes }));
  }


  async function remove() {
    if (!window.confirm("글을 지울까요? 지우면 이 글로 받은 점수도 빠져요.")) return;
    await supabase.rpc("post_delete", { p_id: p.id });
    nav("/board", { replace: true });
  }

  if (err)
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-[15px] text-gray-600">{err}</p>
        <Link to="/board" className="mt-4 inline-block font-bold text-sm-navy">자유게시판으로</Link>
      </div>
    );
  if (!p) return <div className="py-24 text-center text-[14px] text-gray-500">불러오는 중…</div>;

  return (
    <div className="bg-white">
      <article className="mx-auto max-w-2xl px-5 pb-20 pt-6 sm:pt-10">
        <Link to="/board" className="text-[13px] font-semibold text-gray-500 hover:text-sm-navy">‹ 자유게시판</Link>
        <span className={`mt-5 block text-[12px] font-bold ${TAG_COLOR[p.tag]}`}>{p.tag}</span>
        <h1 className="mt-1 text-[22px] font-bold leading-snug tracking-tight text-gray-900">{p.title}</h1>
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-gray-500">
          <Avatar src={p.author?.avatar} nick={p.author?.nick} color={p.author?.color} size={30} round />
          <LvTag author={p.author} />
          <b className="font-bold text-gray-800">{p.author?.nick}</b>
          <span>{ago(p.created_at)}</span>
          <span className="ml-auto">
            {p.mine && (
              <button onClick={remove} className="text-gray-400 hover:text-red-600">지우기</button>
            )}
          </span>
        </div>
        <p className="mt-6 whitespace-pre-line text-[15.5px] leading-[1.8] text-gray-800">{p.body}</p>

        <div className="mt-8 flex justify-center">
          <button
            onClick={like}
            disabled={p.mine}
            className={`rounded-full border-[1.5px] px-6 py-2.5 text-[14.5px] font-bold ${p.liked ? "border-sm-orange bg-orange-50 text-sm-orange" : "border-gray-200 text-gray-600"}`}
          >
            나도 그래 {p.likes}
          </button>
        </div>

        <Comments kind="post" target={p.id} toast={toast} />
      </article>
      {toastNode}
    </div>
  );
}