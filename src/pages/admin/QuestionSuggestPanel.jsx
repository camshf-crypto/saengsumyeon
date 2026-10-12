import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 나만 그래? 질문 제안 — 관리자 첫 화면 '나만 그래?' 탭과 커뮤니티 관리 '질문 제안' 탭이 같이 쓴다
 * 학생이 제안한 질문 → 채택(학생에게 조각 +3) / 거절 · 학생에게 한마디
 */

function fmt(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const QS_TABS = [
  ["pending", "기다리는 중"],
  ["accepted", "채택"],
  ["rejected", "거절"],
  [null, "전체"],
];

export default function QuestionSuggestPanel() {
  const [st, setSt] = useState("pending");
  const [d, setD] = useState(null);
  const [note, setNote] = useState({}); // { 제안 id: 한마디 }
  const [msg, setMsg] = useState("");

  const load = () => supabase.rpc("q_suggest_admin_list", { p_status: st }).then(({ data, error }) => (error ? setMsg(error.message) : setD(data)));
  useEffect(() => {
    setD(null);
    load();
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(id, status) {
    const { error } = await supabase.rpc("q_suggest_admin_set", { p_id: id, p_status: status, p_note: note[id] || null });
    if (error) return setMsg(error.message);
    setMsg(status === "accepted" ? "채택했어요 · 학생에게 조각 +3" : status === "rejected" ? "거절했어요" : "기다리는 중으로 돌렸어요");
    load();
  }

  const c = d?.counts ?? {};
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {QS_TABS.map(([k, l]) => (
          <button
            key={l}
            onClick={() => setSt(k)}
            className={`h-9 rounded-full px-4 text-[13px] font-bold ${st === k ? "bg-sm-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}
          >
            {l}
            {k && c[k] ? <span className="ml-1 opacity-70">{c[k]}</span> : null}
          </button>
        ))}
        <span className="ml-2 text-[12px] text-gray-400">채택하면 학생에게 조각 +3 · 질문 등록은 나만 그래? 질문 관리에서 따로</span>
      </div>
      {msg && <p className="mt-3 text-[13px] font-bold text-sm-navy">{msg}</p>}
      {!d && <p className="py-16 text-center text-sm text-gray-400">불러오는 중…</p>}
      {d && !d.list.length && <p className="py-16 text-center text-sm text-gray-400">제안이 없어요</p>}
      <div className="mt-4 space-y-2">
        {(d?.list ?? []).map((q) => (
          <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
              <b className="text-gray-800">{q.author?.nick ?? "학생"}</b>
              {q.author?.stage && <span>{q.author.stage} · Lv.{q.author.level}</span>}
              {q.grade && <span>· {q.grade}</span>}
              <span>· {fmt(q.created_at)}</span>
              {q.status !== "pending" && <span className="font-bold text-sm-navy">· {q.status === "accepted" ? "채택" : "거절"}</span>}
            </div>
            <p className="mt-1.5 text-[16px] font-bold text-sm-navy">{q.title}</p>
            {q.sub && <p className="mt-0.5 text-[13.5px] text-gray-600">{q.sub}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={note[q.id] ?? q.admin_note ?? ""}
                onChange={(e) => setNote((x) => ({ ...x, [q.id]: e.target.value.slice(0, 80) }))}
                placeholder="학생에게 한마디 (선택) 예) 다음 주 화요일에 올려요"
                className="h-9 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-[13px] outline-none focus:border-sm-navy"
              />
              <button onClick={() => navigator.clipboard?.writeText(q.title)} className="h-9 rounded-lg border border-gray-300 px-3 text-[13px] font-bold text-gray-600">
                질문 복사
              </button>
              {q.status !== "accepted" && (
                <button onClick={() => decide(q.id, "accepted")} className="h-9 rounded-lg bg-sm-navy px-3 text-[13px] font-bold text-white">
                  채택 (+3조각)
                </button>
              )}
              {q.status !== "rejected" && (
                <button onClick={() => decide(q.id, "rejected")} className="h-9 rounded-lg border border-gray-300 px-3 text-[13px] font-bold text-gray-500">
                  거절
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}