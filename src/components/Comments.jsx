import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";
import Avatar from "./Avatar";

/*
 * 댓글 (입시 칼럼 · 자유게시판이 같이 쓴다)
 *   kind: "column" | "post",  target: 칼럼 id 또는 글 id
 *   답글(한 단계) · 나도 그래(좋아요) · 내 댓글 지우기 · 나도 그래 3개 이상 1등은 베스트
 */

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function LvTag({ author }) {
  if (!author?.level) return null;
  return (
    <span className="inline-flex h-[18px] items-center gap-1 rounded border border-gray-200 px-1.5 text-[11px] font-bold text-gray-700">
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: author.color }} />
      Lv.{author.level}
    </span>
  );
}

export default function Comments({ kind, target, toast, onCount }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // 답글 다는 댓글 id
  const [replyText, setReplyText] = useState("");

  const load = () =>
    supabase.rpc("cmt_list", { p_kind: kind, p_target: String(target) }).then(({ data }) => {
      setList(data || []);
      onCount?.((data || []).filter((c) => !c.hidden).length);
    });

  useEffect(() => {
    load();
  }, [kind, target, user?.id]);

  async function post(body, parent) {
    if (!user) return nav("/signup");
    const v = body.trim();
    if (v.length < 2) return false;
    setBusy(true);
    const { error } = await supabase.rpc("cmt_create", { p_kind: kind, p_target: String(target), p_body: v, p_parent: parent });
    setBusy(false);
    if (error) {
      toast?.(error.message);
      return false;
    }
    toast?.(v.length >= 10 ? "댓글 등록 · +2점" : "댓글 등록 (10자 넘으면 +2점)");
    supabase.rpc("lv_check");
    load();
    return true;
  }

  async function submit(e) {
    e.preventDefault();
    if (await post(text, null)) setText("");
  }

  async function submitReply(e, parentId) {
    e.preventDefault();
    if (await post(replyText, parentId)) {
      setReplyText("");
      setReplyTo(null);
    }
  }

  async function like(c) {
    if (!user) return nav("/signup");
    const { data, error } = await supabase.rpc("like_toggle", { p_kind: "comment", p_id: String(c.id) });
    if (error) return toast?.(error.message);
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, liked: data.liked, likes: data.likes } : x)));
  }

  async function remove(c) {
    if (!window.confirm("댓글을 지울까요? 달린 답글도 같이 지워져요.")) return;
    await supabase.rpc("cmt_delete", { p_id: c.id });
    load();
  }

  // 베스트 댓글을 맨 위로, 답글은 각 댓글 아래로
  const roots = list.filter((c) => !c.parent_id).sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0));
  const repliesOf = (id) => list.filter((c) => c.parent_id === id);

  const Item = ({ c, reply }) =>
    c.hidden ? (
      <div className={`my-2 rounded-[10px] bg-[#F4F5F7] px-3.5 py-3 text-[12.5px] text-gray-400 ${reply ? "ml-0" : ""}`}>가려진 댓글이에요</div>
    ) : (
      <div className={reply ? "py-3" : ""}>
        <div className="flex items-center gap-1.5 text-[12.5px]">
          {c.best && <span className="mr-1 text-[11px] font-bold text-amber-700">베스트</span>}
          <Avatar src={c.author?.avatar} nick={c.author?.nick} color={c.author?.color} size={22} round />
          <LvTag author={c.author} />
          <b className="font-bold text-gray-900">{c.author?.nick}</b>
          <span className="text-gray-400">{ago(c.created_at)}</span>
          <span className="ml-auto flex gap-2.5 text-[11.5px] text-gray-400">
            {!reply && (
              <button
                onClick={() => {
                  if (!user) return nav("/signup");
                  setReplyTo((v) => (v === c.id ? null : c.id));
                  setReplyText("");
                }}
                className="font-semibold text-sm-navy"
              >
                답글
              </button>
            )}
            {c.mine && <button onClick={() => remove(c)}>지우기</button>}
          </span>
        </div>
        <p className={`my-1.5 whitespace-pre-line leading-relaxed text-gray-800 ${reply ? "text-[13.5px]" : "text-[14px]"}`}>{c.body}</p>
        <button
          onClick={() => like(c)}
          disabled={c.mine}
          className={`rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${c.liked ? "border-sm-orange bg-orange-50 text-sm-orange" : "border-gray-200 text-gray-500"}`}
        >
          나도 그래 {c.likes}
        </button>
      </div>
    );

  return (
    <section className="mt-10">
      <h3 className="text-[16px] font-bold text-gray-900">댓글 {list.filter((c) => !c.hidden).length}</h3>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder={user ? "10자 넘게 쓰면 +2점" : "로그인하고 댓글을 남겨 보세요"}
          className="min-w-0 flex-1 rounded-[10px] border border-gray-200 px-3.5 py-3 text-[14px] outline-none focus:border-sm-navy"
        />
        <button disabled={busy} className="flex-none rounded-[10px] bg-sm-navy px-4 text-[14px] font-bold text-white disabled:opacity-50">
          등록
        </button>
      </form>
      <p className="mt-1.5 text-[11.5px] text-gray-400">연락처 · SNS 아이디 · 링크는 쓸 수 없어요</p>

      <div className="mt-3">
        {roots.map((c) => {
          const replies = repliesOf(c.id);
          return (
            <div key={c.id} className={`border-b border-gray-100 py-3.5 ${c.best ? "my-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5" : ""}`}>
              <Item c={c} />
              {(replies.length > 0 || replyTo === c.id) && (
                <div className="ml-4 mt-2 border-l-2 border-gray-100 pl-3.5">
                  {replies.map((r) => (
                    <Item key={r.id} c={r} reply />
                  ))}
                  {replyTo === c.id && (
                    <form onSubmit={(e) => submitReply(e, c.id)} className="mt-2 flex gap-2 pb-1">
                      <input
                        autoFocus
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        maxLength={300}
                        placeholder={`${c.author?.nick ?? ""}에게 답글`}
                        className="min-w-0 flex-1 rounded-[10px] border border-gray-200 px-3 py-2.5 text-[13.5px] outline-none focus:border-sm-navy"
                      />
                      <button disabled={busy} className="flex-none rounded-[10px] bg-sm-navy px-3.5 text-[13px] font-bold text-white disabled:opacity-50">
                        답글
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}