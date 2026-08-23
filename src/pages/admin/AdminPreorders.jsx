import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { PREORDER as P } from "../preorder/preorderConfig";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const dt = (d) => (d ? new Date(d).toLocaleString("ko-KR") : "-");
const day = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");
const tel = (p) => (p ? p.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3") : "-");

const STATUS = {
  pending: ["입금 대기", "bg-gray-100 text-gray-500"],
  paid: ["입금 확인", "bg-orange-50 text-sm-orange"],
  cancelled: ["취소", "bg-gray-100 text-gray-400"],
  refunded: ["환불 완료", "bg-gray-100 text-gray-400"],
};

export default function AdminPreorders() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  async function load() {
    const { data, error } = await supabase
      .from("preorders")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("preorders", error);
    setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(r, next) {
    if (next === "refunded" && !confirm("환불 완료로 표시할까요?")) return;
    setBusy(r.id);
    const { error } = await supabase
      .from("preorders")
      .update({
        status: next,
        paid_at: next === "paid" ? new Date().toISOString() : r.paid_at,
      })
      .eq("id", r.id);
    setBusy(null);
    if (error) {
      console.error("update", error);
      alert("변경하지 못했습니다.");
      return;
    }
    load();
  }

  async function saveNote(r, text) {
    await supabase.from("preorders").update({ admin_note: text || null }).eq("id", r.id);
    load();
  }

  function exportCsv(list) {
    const head = ["신청일", "이름", "연락처", "이메일", "학교", "학년", "지원학과", "입금자명", "금액", "상태", "입금확인일", "메모"];
    const body = list.map((r) => [
      day(r.created_at), r.name, r.phone, r.email, r.school ?? "", r.grade ?? "", r.major ?? "",
      r.depositor, r.amount, STATUS[r.status]?.[0] ?? r.status,
      r.paid_at ? day(r.paid_at) : "", r.admin_note ?? "",
    ]);
    const csv = [head, ...body]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `생수면_사전신청_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  const paid = rows.filter((r) => r.status === "paid");
  const pending = rows.filter((r) => r.status === "pending");
  const keyword = q.trim().toLowerCase();

  const shown = rows.filter((r) => {
    if (tab !== "all" && r.status !== tab) return false;
    if (!keyword) return true;
    return (
      r.name.toLowerCase().includes(keyword) ||
      r.phone.includes(keyword) ||
      r.depositor.toLowerCase().includes(keyword) ||
      (r.school ?? "").toLowerCase().includes(keyword) ||
      (r.major ?? "").toLowerCase().includes(keyword)
    );
  });

  const rate = Math.min((paid.length / P.target) * 100, 100);

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">사전신청 관리</h1>
        <button
          onClick={() => exportCsv(shown)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold text-gray-600 hover:border-sm-orange hover:text-sm-orange"
        >
          엑셀 내보내기
        </button>
      </div>

      {/* 진행 현황 */}
      <div className="mt-5 rounded-xl border border-gray-200 p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-sm-navy">제작 확정까지</span>
          <span className="text-lg font-extrabold text-sm-orange">
            {paid.length} / {P.target}명
          </span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-sm-orange transition-all"
            style={{ width: `${rate}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-gray-400">
          입금 확인 기준 · 마감 {P.deadline} · 입금 대기 {pending.length}명
          {paid.length >= P.target && (
            <b className="ml-2 text-sm-orange">목표 인원을 달성했습니다.</b>
          )}
        </p>
      </div>

      {/* 요약 */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          ["총 신청", `${rows.length}명`],
          ["입금 확인", `${paid.length}명`],
          ["입금액", won(paid.reduce((a, r) => a + (r.amount ?? 0), 0))],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{l}</p>
            <p className="mt-1 text-lg font-extrabold text-sm-navy">{v}</p>
          </div>
        ))}
      </div>

      {/* 검색 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 연락처 · 입금자명 검색"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-sm-orange"
        />
        {[["all", "전체"], ["pending", "입금 대기"], ["paid", "입금 확인"], ["refunded", "환불"]].map(
          ([k, label]) => {
            const n = k === "all" ? rows.length : rows.filter((r) => r.status === k).length;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-lg border px-3 py-2 text-xs font-bold ${
                  tab === k
                    ? "border-sm-orange bg-orange-50 text-sm-orange"
                    : "border-gray-300 text-gray-500"
                }`}
              >
                {label} {n}
              </button>
            );
          }
        )}
      </div>

      {/* 목록 */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">신청일</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">이름</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">연락처</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">학교 · 학년</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">지원 학과</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">입금자명</th>
              <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">상태</th>
              <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">처리</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                  해당하는 신청이 없습니다.
                </td>
              </tr>
            )}

            {shown.map((r) => {
              const [label, cls] = STATUS[r.status] ?? ["-", "bg-gray-100 text-gray-400"];
              const nameMatch = r.name.trim() === r.depositor.trim();
              return (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 text-xs text-gray-400">{day(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-sm-navy">{r.name}</span>
                    <p className="mt-0.5 text-[11px] text-gray-400">{r.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{tel(r.phone)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {r.school || "-"} · {r.grade ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{r.major || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-sm-navy">{r.depositor}</span>
                    {!nameMatch && (
                      <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">
                        상이
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${cls}`}>
                      {label}
                    </span>
                    {r.paid_at && (
                      <p className="mt-1 text-[11px] text-gray-400">{day(r.paid_at)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.status === "pending" && (
                      <button
                        onClick={() => setStatus(r, "paid")}
                        disabled={busy === r.id}
                        className="rounded-lg bg-sm-orange px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-50"
                      >
                        입금 확인
                      </button>
                    )}
                    {r.status === "paid" && (
                      <button
                        onClick={() => setStatus(r, "refunded")}
                        disabled={busy === r.id}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-600 disabled:opacity-50"
                      >
                        환불 처리
                      </button>
                    )}
                    {r.status === "refunded" && (
                      <span className="text-xs text-gray-400">완료</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 메모가 있는 신청 */}
      {rows.some((r) => r.memo) && (
        <section className="mt-8">
          <p className="text-sm font-extrabold text-sm-navy">문의사항</p>
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {rows
              .filter((r) => r.memo)
              .map((r) => (
                <li key={r.id} className="px-5 py-4">
                  <p className="text-sm font-bold text-sm-navy">
                    {r.name}
                    <span className="ml-2 text-xs font-normal text-gray-400">{tel(r.phone)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] text-gray-600">{r.memo}</p>
                </li>
              ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-xs leading-relaxed text-gray-400">
        ※ 입금 내역은 은행에서 직접 확인한 뒤 「입금 확인」을 눌러 주세요. 입금자명이 신청자와 다른
        경우 「상이」 표시가 붙습니다.
        <br />※ 계약금 {won(P.deposit)} · 목표 {P.target}명 · 미달 시 {P.refundDate}까지 전액 환불
      </p>
    </div>
  );
}