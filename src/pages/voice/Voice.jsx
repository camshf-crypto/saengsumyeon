import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

/*
 * 생수면 의견함 — /voice (샤오미처럼: 말하면 → 반영되고 → 반영됐다고 알려준다)
 * · 원하는 기능에 '나도 원해'만 누르면 된다 (많이 눌린 것부터 만든다)
 * · 원하는 게 없으면 새로 제안 (하루 2개) · 반영되면 제안한 학생에게 조각 +3
 * · 맨 위에는 최근 2주 안에 반영된 소식
 * · [불편해요] 탭 — 지금 서비스에서 불편한 점을 알려준다 (나만 보임 · 고치면 답장 + 조각 +1) · /voice?tab=fix
 */
const AREAS = ["홈", "물꼬 입시 AI", "수시 면접 준비", "나만 그래?", "옥상에서 외쳐!", "합격 생기부 퍼즐", "흔한가 진단", "생기부 예상질문", "내 생기부 노트", "레벨 · 조각", "로그인 · 가입", "기타"];
const FB_STATUS = {
  new: { label: "받았어", cls: "bg-gray-100 text-gray-600" },
  checking: { label: "확인 중", cls: "bg-orange-50 text-[#C2410C]" },
  fixed: { label: "고쳤어 · 조각 +1", cls: "bg-emerald-50 text-emerald-700" },
  keep: { label: "그대로 둘게", cls: "bg-gray-100 text-gray-500" },
};

/* 불편해요 — 고르기 + 한두 줄 */
function FixPanel({ uid }) {
  const { state } = useLocation();
  const [area, setArea] = useState("");
  const [body, setBody] = useState("");
  const [mine, setMine] = useState([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const load = () => uid && supabase.rpc("feedback_my").then(({ data }) => setMine(data || []));
  useEffect(() => {
    load();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e) {
    e.preventDefault();
    setErr("");
    let { error } = await supabase.rpc("feedback_create", { p_area: area, p_body: body, p_path: state?.from ?? null });
    // 서버가 새 칸(물꼬 입시 AI 등)을 아직 모르면 '기타'로 보내고 앞에 칸 이름을 붙인다
    if (error && area !== "기타") ({ error } = await supabase.rpc("feedback_create", { p_area: "기타", p_body: `[${area}] ${body}`, p_path: state?.from ?? null }));
    if (error) return setErr(error.message);
    setBody("");
    setArea("");
    setDone(true);
    load();
  }

  if (!uid)
    return (
      <p className="mt-6 rounded-2xl bg-white p-6 text-center text-[14px] text-gray-600 ring-1 ring-gray-200">
        <Link to="/login" className="font-bold text-sm-navy underline">
          로그인
        </Link>
        하면 불편한 점을 알려줄 수 있어
      </p>
    );

  return (
    <div className="mt-5">
      <form onSubmit={send} className="rounded-2xl bg-white p-5 ring-1 ring-gray-200">
        <p className="text-[14px] font-bold text-sm-navy">어디가 불편해?</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AREAS.map((a) => (
            <button
              type="button"
              key={a}
              onClick={() => setArea(a)}
              className={`rounded-full px-3.5 py-2 text-[13px] font-bold ${area === a ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-700"}`}
            >
              {a}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          rows={3}
          placeholder={area === "물꼬 입시 AI"
            ? "뭐가 불편했고, 어떻게 바뀌면 좋겠어? (예: 답이 너무 길어요 / 같은 걸 또 물어봐요 / 이런 것도 물어보고 싶어요)"
            : "뭐가 불편했어? 한두 줄이면 돼 (예: 댓글 쓰면 화면이 맨 위로 올라가요)"}
          className="mt-3 w-full resize-none rounded-xl border border-gray-300 px-4 py-3 text-[14px] outline-none focus:border-sm-navy"
        />
        {err && <p className="mt-1 text-[13px] font-bold text-red-500">{err}</p>}
        {done && !err && <p className="mt-1 text-[13px] font-bold text-sm-navy">고마워! 확인하고 답장할게</p>}
        <button disabled={!area || body.trim().length < 4} className="mt-3 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-bold text-white disabled:opacity-40">
          알려주기
        </button>
        <p className="mt-2 text-center text-[11.5px] text-gray-400">나만 볼 수 있어 · 고치면 답장이랑 조각 +1</p>
      </form>

      {mine.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[15px] font-extrabold text-sm-navy">내가 알린 불편함</h2>
          <div className="mt-2 space-y-2">
            {mine.map((f) => (
              <div key={f.id} className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
                <div className="flex items-center gap-2">
                  <b className="text-[12.5px] text-gray-500">{f.area}</b>
                  <span className={`ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-bold ${FB_STATUS[f.status]?.cls}`}>{FB_STATUS[f.status]?.label}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-[14px] text-gray-800">{f.body}</p>
                {f.reply && <p className="mt-2 rounded-lg bg-[#F4F5F7] px-3 py-2 text-[13px] text-gray-700">생수면: {f.reply}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
const STATUS = {
  open: null,
  review: { label: "검토 중", cls: "bg-gray-100 text-gray-600" },
  making: { label: "만드는 중", cls: "bg-orange-50 text-[#C2410C]" },
  done: { label: "반영됨", cls: "bg-emerald-50 text-emerald-700" },
};
const FILTERS = [
  [null, "전체"],
  ["making", "만드는 중"],
  ["done", "반영됨"],
];
const md = (d) => {
  const x = new Date(d);
  return `${x.getMonth() + 1}월 ${x.getDate()}일`;
};

export default function Voice() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "fix" ? "fix" : "idea";
  const [sort, setSort] = useState("top");
  const [status, setStatus] = useState(null);
  const [d, setD] = useState(null);
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState("");
  const [sub, setSub] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => supabase.rpc("idea_list", { p_sort: sort, p_status: status }).then(({ data }) => setD(data || { list: [], news: [] }));
  useEffect(() => {
    load();
  }, [sort, status, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function vote(it) {
    if (!uid) return setMsg("로그인하면 누를 수 있어");
    // 바로 바뀐 것처럼 보이고, 서버 결과로 맞춘다
    setD((x) => ({ ...x, list: x.list.map((i) => (i.id === it.id ? { ...i, mine: !i.mine, votes: i.votes + (i.mine ? -1 : 1) } : i)) }));
    const { data, error } = await supabase.rpc("idea_vote", { p_id: it.id });
    if (error) return load();
    setD((x) => ({ ...x, list: x.list.map((i) => (i.id === it.id ? { ...i, mine: data.on, votes: data.votes } : i)) }));
  }

  async function create(e) {
    e.preventDefault();
    setErr("");
    const { error } = await supabase.rpc("idea_create", { p_title: title, p_sub: sub || null });
    if (error) return setErr(error.message);
    setTitle("");
    setSub("");
    setWriting(false);
    setSort("new");
    setStatus(null);
    setMsg("올렸어! 친구들이 '나도 원해'를 누르면 위로 올라가");
    load();
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] pb-20">
      <div className="mx-auto max-w-2xl px-4 pt-6 sm:px-5 sm:pt-10">
        <h1 className="text-[24px] font-extrabold tracking-tight text-sm-navy">생수면 의견함</h1>

        {/* 원하는 기능 · 불편해요 */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-200/70 p-1">
          {[
            ["idea", "원하는 기능"],
            ["fix", "불편해요"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setParams(k === "fix" ? { tab: "fix" } : {}, { replace: true })}
              className={`h-10 rounded-lg text-[14px] font-bold ${tab === k ? "bg-white text-sm-navy shadow-sm" : "text-gray-500"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === "fix" ? (
          <FixPanel uid={uid} />
        ) : (
        <>
        <p className="mt-1 text-[14px] leading-relaxed text-gray-600">
          원하는 기능에 <b className="text-sm-navy">‘나도 원해’</b>만 눌러 줘. 많이 눌린 것부터 만들어.
          <br />
          매주 목요일, 반영된 걸 여기에 알려 줄게.
        </p>

        {/* 반영 소식 */}
        {d?.news?.length > 0 && (
          <section className="mt-5 rounded-2xl bg-sm-navy p-4 text-white">
            <p className="text-[12.5px] font-bold text-white/70">학생 의견으로 바뀐 것</p>
            <ul className="mt-2 space-y-2">
              {d.news.map((n) => (
                <li key={n.id} className="flex gap-2 text-[14px]">
                  <span className="mt-0.5 text-emerald-300">✓</span>
                  <span className="min-w-0">
                    <b>{n.title}</b>
                    <span className="ml-1.5 text-[12px] text-white/60">{md(n.done_at)}</span>
                    {n.note && <span className="block text-[12.5px] text-white/80">{n.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 정렬 · 상태 */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {[
            ["top", "많이 원하는 순"],
            ["new", "최신순"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`h-9 rounded-full px-3.5 text-[13px] font-bold ${sort === k ? "bg-sm-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}
            >
              {l}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-gray-300" />
          {FILTERS.map(([k, l]) => (
            <button
              key={l}
              onClick={() => setStatus(k)}
              className={`h-9 rounded-full px-3.5 text-[13px] font-bold ${status === k ? "bg-gray-800 text-white" : "border border-gray-300 bg-white text-gray-600"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {msg && <p className="mt-3 text-[13px] font-bold text-sm-navy">{msg}</p>}

        {/* 목록 */}
        <div className="mt-3 space-y-2">
          {!d && <p className="py-16 text-center text-[14px] text-gray-400">불러오는 중…</p>}
          {d?.list?.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-gray-200">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[15px] font-bold text-sm-navy">{it.title}</p>
                  {STATUS[it.status] && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${STATUS[it.status].cls}`}>{STATUS[it.status].label}</span>}
                </div>
                {it.sub && <p className="mt-0.5 text-[12.5px] text-gray-500">{it.sub}</p>}
                {it.note && it.status !== "done" && <p className="mt-1 text-[12px] text-[#C2410C]">생수면: {it.note}</p>}
                {it.author && <p className="mt-1 text-[11.5px] text-gray-400">{it.by_me ? "내가 제안" : `${it.author} 제안`}</p>}
              </div>
              <button
                onClick={() => vote(it)}
                className={`flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-xl text-[12px] font-bold transition ${
                  it.mine ? "bg-sm-navy text-white" : "border border-gray-300 text-gray-600"
                }`}
              >
                <span className="text-[17px] font-black leading-none">{it.votes}</span>
                <span className="mt-1">나도 원해</span>
              </button>
            </div>
          ))}
        </div>

        {/* 새로 제안 */}
        <div className="mt-5">
          {!writing ? (
            <button
              onClick={() => (uid ? setWriting(true) : setMsg("로그인하면 제안할 수 있어"))}
              className="h-12 w-full rounded-2xl border border-dashed border-gray-400 bg-white text-[14px] font-bold text-gray-600"
            >
              원하는 게 없어? 새로 제안하기
            </button>
          ) : (
            <form onSubmit={create} className="rounded-2xl bg-white p-4 ring-1 ring-gray-200">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 40))}
                autoFocus
                placeholder="이런 기능 만들어 줘 (40자)"
                className="h-11 w-full rounded-xl border border-gray-300 px-4 text-[14.5px] outline-none focus:border-sm-navy"
              />
              <input
                value={sub}
                onChange={(e) => setSub(e.target.value.slice(0, 80))}
                placeholder="한 줄 설명 (안 써도 돼)"
                className="mt-2 h-11 w-full rounded-xl border border-gray-300 px-4 text-[13.5px] outline-none focus:border-sm-navy"
              />
              {err && <p className="mt-2 text-[13px] font-bold text-red-500">{err}</p>}
              <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
                <button type="button" onClick={() => setWriting(false)} className="h-11 rounded-xl border border-gray-300 text-[14px] font-bold text-gray-500">
                  취소
                </button>
                <button disabled={title.trim().length < 4} className="h-11 rounded-xl bg-sm-navy text-[14px] font-bold text-white disabled:opacity-40">
                  제안하기
                </button>
              </div>
              <p className="mt-2 text-[11.5px] text-gray-400">반영되면 조각 +3 · 하루 2개까지</p>
            </form>
          )}
        </div>

        {!uid && (
          <p className="mt-4 text-center text-[13px] text-gray-500">
            <Link to="/login" className="font-bold text-sm-navy underline">
              로그인
            </Link>
            하면 ‘나도 원해’를 누를 수 있어
          </p>
        )}
        </>
        )}
      </div>
    </div>
  );
}