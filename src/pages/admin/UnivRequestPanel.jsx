import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 '사람 › 대학 추가 요청' 탭 — 물꼬 입시 에이전트에서 학생이 보낸 대학 자료 추가 요청 (sql/sm_87 univ_requests)
 * 위: 많이 요청한 대학 순 (요청 수 · 원하는 자료별 수 · 학과) → 자료를 넣었으면 [추가함]
 * 아래: 요청 하나씩 (언제 · 대학 · 학과 · 자료 · 한마디 · 학생이 물어본 말)
 */
const NEEDS = ["면접 기출", "면접 방식", "인재상", "모집요강·전형", "입결"];
const day = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
// "한양대 에리카" · "한양대학교(ERICA)" 를 한 대학으로 묶는다
const key = (u) => String(u ?? "").replace(/\s|\(|\)/g, "").replace(/대학교|대학/g, "대").replace(/ERICA/gi, "에리카");

export default function UnivRequestPanel() {
  const [rows, setRows] = useState(null);
  const [show, setShow] = useState("open"); // open | done | all
  const [err, setErr] = useState("");

  async function load() {
    const { data, error } = await supabase.from("univ_requests").select("*").order("created_at", { ascending: false }).limit(2000);
    if (error) setErr(error.message.includes("does not exist") ? "sql/sm_87_univ_requests.sql 을 먼저 실행해 주세요." : error.message);
    setRows(data ?? []);
  }
  useEffect(() => { load(); }, []);

  const list = (rows ?? []).filter((r) => r.status !== "hidden" && (show === "all" || r.status === show));
  const groups = useMemo(() => {
    const m = {};
    for (const r of list) {
      const g = (m[key(r.university)] ??= { name: r.university, n: 0, users: new Set(), needs: {}, depts: {}, ids: [], last: r.created_at });
      g.n += 1;
      if (r.user_id) g.users.add(r.user_id);
      g.ids.push(r.id);
      (r.needs ?? []).forEach((x) => (g.needs[x] = (g.needs[x] ?? 0) + 1));
      if (r.department) g.depts[r.department] = (g.depts[r.department] ?? 0) + 1;
    }
    return Object.values(m).sort((a, b) => b.users.size - a.users.size || b.n - a.n);
  }, [list]);

  async function mark(ids, status) {
    const { error } = await supabase.from("univ_requests").update({ status }).in("id", ids);
    if (error) return setErr(error.message);
    load();
  }

  if (rows === null) return <p className="text-[13px] text-gray-400">불러오는 중…</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-extrabold text-sm-navy">대학 자료 추가 요청</h3>
          <p className="mt-0.5 text-[12.5px] text-gray-500">물꼬 채팅에서 자료가 없는 대학을 물은 학생이 보낸 요청이에요. 많이 요청한 대학부터 넣어 주세요.</p>
        </div>
        <div className="flex gap-1">
          {[["open", "받음"], ["done", "추가함"], ["all", "전체"]].map(([k, l]) => (
            <button key={k} onClick={() => setShow(k)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${show === k ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>
          ))}
        </div>
      </div>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

      {/* 대학별 */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="bg-gray-50 text-[12px] text-gray-500">
            <tr>
              <th className="px-3 py-2">대학</th>
              <th className="px-3 py-2">요청 학생</th>
              {NEEDS.map((n) => <th key={n} className="px-2 py-2 text-center">{n}</th>)}
              <th className="px-3 py-2">학과</th>
              <th className="px-3 py-2">마지막</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.name} className="border-t border-gray-100">
                <td className="px-3 py-2 font-bold text-gray-900">{g.name}</td>
                <td className="px-3 py-2"><b className="text-sm-orange">{g.users.size}명</b> <small className="text-gray-400">({g.n}건)</small></td>
                {NEEDS.map((n) => <td key={n} className="px-2 py-2 text-center text-gray-700">{g.needs[n] || ""}</td>)}
                <td className="max-w-[200px] truncate px-3 py-2 text-gray-500">{Object.entries(g.depts).sort((a, b) => b[1] - a[1]).map(([d, c]) => (c > 1 ? `${d} ${c}` : d)).join(", ")}</td>
                <td className="px-3 py-2 text-gray-400">{day(g.last)}</td>
                <td className="px-3 py-2 text-right">
                  {show !== "done" && <button onClick={() => mark(g.ids, "done")} className="rounded-lg bg-sm-navy px-3 py-1.5 text-[12px] font-bold text-white">추가함</button>}
                  {show === "done" && <button onClick={() => mark(g.ids, "open")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12px] font-bold text-gray-600">되돌리기</button>}
                </td>
              </tr>
            ))}
            {!groups.length && <tr><td colSpan={NEEDS.length + 5} className="px-3 py-6 text-center text-gray-400">아직 요청이 없어요</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 하나씩 */}
      <h4 className="mt-6 text-[14px] font-extrabold text-sm-navy">요청 하나씩</h4>
      <div className="mt-2 grid gap-2">
        {list.slice(0, 100).map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-gray-900">{r.university}</b>
              {r.department && <span className="text-gray-500">{r.department}</span>}
              {(r.needs ?? []).map((n) => <span key={n} className="rounded-full bg-[#EEF1FA] px-2 py-0.5 text-[11.5px] font-bold text-sm-navy">{n}</span>)}
              <span className="ml-auto text-[12px] text-gray-400">{day(r.created_at)}</span>
              <button onClick={() => mark([r.id], "hidden")} className="text-[12px] text-gray-400 underline">숨김</button>
            </div>
            {r.memo && <p className="mt-1.5 text-gray-700">“{r.memo}”</p>}
            {r.question && <p className="mt-1 text-[12px] text-gray-400">물어본 말 · {r.question}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}