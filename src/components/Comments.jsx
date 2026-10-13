import { useEffect, useState } from "react";
import { checkLevel } from "./LevelUp";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";
import Avatar from "./Avatar";

/*
 * 댓글 (입시 칼럼 · 옥상에서 외쳐!가 같이 쓴다)
 *   kind: "column" | "post",  target: 칼럼 id 또는 외침 id
 *   답글(한 단계) · 나도 그래(좋아요) · 내 댓글 지우기 · 나도 그래 3개 이상 1등은 베스트
 *   옥상(post) 댓글은 완전 익명 — '익명 · 고2', 글쓴이 댓글은 '글쓴이' · 신고 (3번 쌓이면 가려짐)
 */

// 익명 글쓴이 이름 — 옥상은 '글쓴이' / '익명', 칼럼은 닉네임
const nameOf = (a) => (a?.anon ? (a.op ? "글쓴이" : "익명") : a?.nick ?? "");
const REPORT_REASONS = ["누군지 알 수 있는 내용 (이름 · 학교)", "특정 사람 저격 · 괴롭힘", "욕설 · 혐오", "광고 · 도배", "기타"];

// 신고 사유 고르기 (번호로 고른다) — 고르지 않으면 신고하지 않는다
export function askReason() {
  const v = window.prompt(`신고 이유를 번호로 골라 줘\n${REPORT_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n")}`, "1");
  const i = Number(v) - 1;
  return REPORT_REASONS[i] ?? null;
}

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
      {author.stage ?? `Lv.${author.level}`}
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
    checkLevel();
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

  async function report(c) {
    if (!user) return nav("/signup");
    const reason = askReason();
    if (!reason) return;
    const { data, error } = await supabase.rpc("report_target", { p_kind: "comment", p_id: String(c.id), p_reason: reason });
    if (error) return toast?.(error.message);
    toast?.(data?.already ? "이미 신고했어요" : "신고했어요 · 확인할게요");
    if (data?.hidden) load();
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
          {c.author?.anon ? (
            <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${c.author.op ? "bg-sm-orange" : "bg-gray-400"}`}>
              {c.author.op ? "글" : "익"}
            </span>
          ) : (
            <Avatar src={c.author?.avatar} nick={c.author?.nick} color={c.author?.color} size={22} round />
          )}
          <LvTag author={c.author} />
          <b className={`font-bold ${c.author?.op ? "text-sm-orange" : "text-gray-900"}`}>{nameOf(c.author)}</b>
          {c.author?.anon && c.author.grade && <span className="text-gray-400">· {c.author.grade}</span>}
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
            {!c.mine && kind === "post" && <button onClick={() => report(c)}>신고</button>}
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
                        placeholder={`${nameOf(c.author)}에게 답글`}
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