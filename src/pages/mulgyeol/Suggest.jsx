import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

/*
 * 나만 그래? 질문 제안 — /mulgyeol/suggest (💧물방울 Lv.6 부터)
 * 제안은 하루 1개 · 기다리는 제안은 3개까지. 채택되면 실제 질문으로 올라가고 조각 +3
 */
const BLUE = "#1A5E9A";
const STATUS = {
  pending: { label: "기다리는 중", cls: "bg-gray-100 text-gray-600" },
  accepted: { label: "채택 · 조각 +3", cls: "bg-[#E4EFF8] text-[#1A5E9A]" },
  rejected: { label: "다음 기회에", cls: "bg-gray-100 text-gray-400" },
};
const EXAMPLES = ["시험 기간만 되면 방 청소가 하고 싶어진다", "수행평가 조 편성 발표 날이 제일 떨린다", "생기부 세특 내용을 내가 직접 써 본 적 있다"];
const day = (d) => new Date(d).toLocaleDateString("ko-KR");

export default function Suggest() {
  const { user, loading } = useAuth();
  const uid = user?.id ?? null;
  const [me, setMe] = useState(null);
  const [title, setTitle] = useState("");
  const [sub, setSub] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const load = () => supabase.rpc("q_suggest_my").then(({ data }) => setMe(data || null));
  useEffect(() => {
    if (uid) load();
  }, [uid]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const { error } = await supabase.rpc("q_suggest_create", { p_title: title, p_sub: sub || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setTitle("");
    setSub("");
    setDone(true);
    load();
  }

  async function remove(id) {
    if (!window.confirm("이 제안을 지울까?")) return;
    await supabase.rpc("q_suggest_delete", { p_id: id });
    load();
  }

  const blocked = me && (me.today_done || me.pending >= 3);

  return (
    <div className="min-h-screen bg-[#F3F7F9] pb-16 text-[#10262F]">
      <div className="mx-auto max-w-xl px-4 pt-6 sm:px-5 sm:pt-10">
        <Link to="/mulgyeol" className="text-[13px] font-bold text-gray-500">
          ‹ 나만 그래?
        </Link>
        <h1 className="mt-2 text-[24px] font-extrabold tracking-tight">질문 제안하기</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-gray-600">
          “이거 나만 그래?” 궁금했던 걸 제안해 줘. 채택되면 진짜 질문으로 올라가고 <b style={{ color: BLUE }}>조각 +3</b>을 줘.
        </p>

        {loading ? null : !uid ? (
          <div className="mt-6 rounded-2xl bg-white p-6 text-center ring-1 ring-[#E1EAEE]">
            <p className="text-[15px] font-bold">로그인하면 제안할 수 있어</p>
            <Link to="/login" className="mt-4 inline-block rounded-xl px-5 py-2.5 text-[14px] font-bold text-white" style={{ background: BLUE }}>
              로그인하기
            </Link>
          </div>
        ) : !me ? (
          <p className="py-16 text-center text-[14px] text-gray-400">불러오는 중…</p>
        ) : !me.can ? (
          <div className="mt-6 rounded-2xl bg-white p-6 text-center ring-1 ring-[#E1EAEE]">
            <p className="text-[16px] font-extrabold">💧 물방울(Lv.6)부터 제안할 수 있어</p>
            <p className="mt-1 text-[13.5px] text-gray-500">지금 Lv.{me.level} · 나만 그래?에 답하고 댓글을 남기면 금방 올라가</p>
            <Link to="/my/level" className="mt-4 inline-block rounded-xl border border-[#D3DFE5] px-5 py-2.5 text-[14px] font-bold text-[#33505C]">
              내 레벨 보기
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-[#E1EAEE]">
            <label className="block text-[13px] font-bold text-gray-600">질문</label>
            <div className="relative mt-1.5">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value.slice(0, 40));
                  setErr("");
                }}
                placeholder="궁금한 걸 질문으로 써 줘"
                className="h-12 w-full rounded-xl border border-[#D3DFE5] px-4 pr-14 text-[15px] outline-none focus:border-[#1A5E9A]"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-gray-400">{title.length}/40</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setTitle(x)} className="rounded-full bg-[#E4EFF8] px-3 py-1 text-[12px] font-bold text-[#1A5E9A]">
                  {x}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-[13px] font-bold text-gray-600">
              한 줄 설명 <span className="font-normal text-gray-400">(선택)</span>
            </label>
            <input
              value={sub}
              onChange={(e) => setSub(e.target.value.slice(0, 80))}
              placeholder="어떤 상황인지 짧게 (80자)"
              className="mt-1.5 h-11 w-full rounded-xl border border-[#D3DFE5] px-4 text-[14px] outline-none focus:border-[#1A5E9A]"
            />

            <ul className="mt-4 space-y-1 rounded-xl bg-[#F3F7F9] px-4 py-3 text-[12.5px] leading-relaxed text-gray-600">
              <li>· ‘나도 그래 / 난 아닌데’로 답할 수 있는 질문이 잘 뽑혀</li>
              <li>· 특정 학교 · 선생님 · 친구를 가리키는 질문, 연락처 · 링크는 안 돼</li>
              <li>· 하루 1개 · 기다리는 제안은 3개까지</li>
            </ul>

            {err && <p className="mt-3 text-[13px] font-bold text-red-500">{err}</p>}
            {done && !err && <p className="mt-3 text-[13px] font-bold" style={{ color: BLUE }}>제안했어! 결과는 아래에서 확인할 수 있어</p>}

            <button
              disabled={busy || blocked || title.trim().length < 5}
              className="mt-4 h-12 w-full rounded-xl text-[15px] font-bold text-white disabled:opacity-40"
              style={{ background: BLUE }}
            >
              {busy ? "보내는 중…" : me.today_done ? "오늘은 이미 제안했어 · 내일 또 해 줘" : me.pending >= 3 ? "기다리는 제안이 3개야" : "제안하기"}
            </button>
          </form>
        )}

        {me?.list?.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[16px] font-extrabold">
              내 제안 <span className="text-[13px] font-medium text-gray-400">채택 {me.accepted}개</span>
            </h2>
            <div className="mt-3 space-y-2">
              {me.list.map((s) => (
                <div key={s.id} className="rounded-xl bg-white p-4 ring-1 ring-[#E1EAEE]">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[14.5px] font-bold leading-relaxed">{s.title}</p>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-bold ${STATUS[s.status]?.cls}`}>{STATUS[s.status]?.label}</span>
                  </div>
                  {s.sub && <p className="mt-0.5 text-[13px] text-gray-500">{s.sub}</p>}
                  {s.admin_note && <p className="mt-2 rounded-lg bg-[#F3F7F9] px-3 py-2 text-[12.5px] text-gray-600">물꼬: {s.admin_note}</p>}
                  <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-gray-400">
                    <span>{day(s.created_at)}</span>
                    {s.status === "pending" && (
                      <button onClick={() => remove(s.id)} className="px-1 hover:text-red-500">
                        지우기
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}