import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const day = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");
const phone = (p) =>
  p ? p.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3") : "-";

function daysLeft(expiresAt) {
  return Math.max(Math.ceil((new Date(expiresAt) - new Date()) / 86400000), 0);
}

export default function AdminMembers() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | paid | free
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({}); // user_id -> { enrollments, orders }
  const [busy, setBusy] = useState(false);
  const [courses, setCourses] = useState([]);

  async function load() {
    const [{ data: profiles }, { data: enrolls }, { data: orders }, { data: cs }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, name, phone, school, grade, role, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("enrollments")
          .select("user_id, course_id, expires_at, status, courses(slug, title)"),
        supabase.from("orders").select("user_id, paid_amount, status"),
        supabase.from("courses").select("id, slug, title").order("created_at"),
      ]);

    const eMap = {};
    (enrolls ?? []).forEach((e) => {
      (eMap[e.user_id] ??= []).push(e);
    });

    const oMap = {};
    (orders ?? [])
      .filter((o) => o.status === "paid")
      .forEach((o) => {
        oMap[o.user_id] = (oMap[o.user_id] ?? 0) + (o.paid_amount ?? 0);
      });

    setCourses(cs ?? []);
    setRows(
      (profiles ?? []).map((p) => {
        const list = (eMap[p.id] ?? []).filter(
          (e) => e.status === "active" && new Date(e.expires_at) > new Date()
        );
        return {
          ...p,
          enrollments: eMap[p.id] ?? [],
          activeCount: list.length,
          spent: oMap[p.id] ?? 0,
        };
      })
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function openDetail(m) {
    if (openId === m.id) return setOpenId(null);
    setOpenId(m.id);

    if (!detail[m.id]) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_no, status, paid_amount, paid_at, created_at, order_items(name_snapshot)")
        .eq("user_id", m.id)
        .order("created_at", { ascending: false });
      setDetail((d) => ({ ...d, [m.id]: { orders: orders ?? [] } }));
    }
  }

  // 수강권 수동 지급 (오프라인 결제, 이벤트 지급 등)
  async function grant(userId, courseId) {
    if (!courseId) return;
    setBusy(true);
    const { error } = await supabase.from("enrollments").insert({
      user_id: userId,
      course_id: courseId,
      starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
      status: "active",
    });
    setBusy(false);
    if (error) {
      console.error("grant", error);
      alert("지급하지 못했습니다. 이미 같은 수강권이 있는지 확인해 주세요.");
      return;
    }
    load();
  }

  async function revoke(userId, courseId) {
    if (!confirm("이 수강권을 회수할까요? 학생은 즉시 강의를 볼 수 없게 됩니다.")) return;
    setBusy(true);
    const { error } = await supabase
      .from("enrollments")
      .update({ status: "revoked" })
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("status", "active");
    setBusy(false);
    if (error) {
      console.error("revoke", error);
      alert("회수하지 못했습니다.");
      return;
    }
    load();
  }

  // 현재 화면에 보이는 목록을 CSV로 내려받는다 (엑셀에서 열기)
  function exportCsv(list) {
    const head = ["이름", "연락처", "학교", "학년", "가입일", "수강중", "누적결제액"];
    const body = list.map((m) => [
      m.name ?? "",
      m.phone ?? "",
      m.school ?? "",
      m.grade ?? "",
      day(m.created_at),
      m.activeCount,
      m.spent,
    ]);
    const csv = [head, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    // 엑셀에서 한글이 깨지지 않도록 BOM을 붙인다
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `생수면_회원_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  const keyword = q.trim().toLowerCase();
  const shown = rows.filter((m) => {
    if (filter === "paid" && m.spent === 0) return false;
    if (filter === "free" && m.spent > 0) return false;
    if (!keyword) return true;
    return (
      (m.name ?? "").toLowerCase().includes(keyword) ||
      (m.phone ?? "").includes(keyword) ||
      (m.school ?? "").toLowerCase().includes(keyword)
    );
  });

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">회원 관리</h1>
        <button
          onClick={() => exportCsv(shown)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold text-gray-600 hover:border-sm-orange hover:text-sm-orange"
        >
          엑셀 내보내기
        </button>
      </div>

      {/* 요약 */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          ["전체 회원", `${rows.length}명`],
          ["결제 회원", `${rows.filter((m) => m.spent > 0).length}명`],
          ["수강 중", `${rows.filter((m) => m.activeCount > 0).length}명`],
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
          placeholder="이름 · 휴대폰 · 학교 검색"
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-sm-orange"
        />
        {[["all", "전체"], ["paid", "결제 회원"], ["free", "미결제"]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-lg border px-3.5 py-2 text-xs font-bold ${
              filter === k
                ? "border-sm-orange bg-orange-50 text-sm-orange"
                : "border-gray-300 text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">이름</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">연락처</th>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">학교</th>
              <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">학년</th>
              <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">가입일</th>
              <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">수강중</th>
              <th className="border-b border-gray-200 px-4 py-3 text-right font-bold">결제액</th>
              <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">관리</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                  해당하는 회원이 없습니다.
                </td>
              </tr>
            )}

            {shown.map((m) => {
              const open = openId === m.id;
              const d = detail[m.id];
              const active = m.enrollments.filter(
                (e) => e.status === "active" && new Date(e.expires_at) > new Date()
              );

              return (
                <>
                  <tr key={m.id} className={`border-b border-gray-100 ${open ? "bg-orange-50" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="font-bold text-sm-navy">{m.name}</span>
                      {m.role === "master" && (
                        <span className="ml-2 rounded bg-sm-navy px-1.5 py-0.5 text-[11px] text-white">
                          관리자
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{phone(m.phone)}</td>
                    <td className="px-4 py-3 text-gray-600">{m.school || "-"}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{m.grade ?? "-"}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-400">
                      {day(m.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {m.activeCount > 0 ? (
                        <span className="rounded bg-orange-50 px-2 py-0.5 text-xs font-bold text-sm-orange">
                          {m.activeCount}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-extrabold text-sm-navy">
                      {m.spent > 0 ? won(m.spent) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openDetail(m)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-600 hover:border-sm-orange hover:text-sm-orange"
                      >
                        {open ? "닫기" : "상세"}
                      </button>
                    </td>
                  </tr>

                  {open && (
                    <tr key={`${m.id}-detail`}>
                      <td colSpan={8} className="bg-gray-50 px-5 py-5">
                        {/* 수강권 */}
                        <div className="rounded-lg bg-white p-4">
                          <p className="text-[13px] font-extrabold text-sm-navy">수강권</p>

                          {active.length === 0 ? (
                            <p className="mt-2 text-xs text-gray-400">유효한 수강권이 없습니다.</p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {active.map((e) => (
                                <li
                                  key={e.course_id}
                                  className="flex items-center justify-between gap-3 rounded bg-gray-50 px-3 py-2"
                                >
                                  <span className="min-w-0 truncate text-xs text-gray-600">
                                    {e.courses?.title}
                                    <span className="ml-2 text-gray-400">
                                      {daysLeft(e.expires_at)}일 남음
                                    </span>
                                  </span>
                                  <button
                                    onClick={() => revoke(m.id, e.course_id)}
                                    disabled={busy}
                                    className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                                  >
                                    회수
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}

                          <select
                            onChange={(e) => grant(m.id, e.target.value)}
                            value=""
                            disabled={busy}
                            className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-xs outline-none focus:border-sm-orange"
                          >
                            <option value="">수강권 직접 지급 (90일)</option>
                            {courses.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                          </select>
                          <p className="mt-2 text-[11px] text-gray-400">
                            오프라인 결제나 이벤트 지급용입니다. 결제 기록 없이 수강권만 생성됩니다.
                          </p>
                        </div>

                        {/* 결제 내역 */}
                        <div className="mt-4 rounded-lg bg-white p-4">
                          <p className="text-[13px] font-extrabold text-sm-navy">결제 내역</p>
                          {!d ? (
                            <p className="mt-2 text-xs text-gray-400">불러오는 중…</p>
                          ) : d.orders.length === 0 ? (
                            <p className="mt-2 text-xs text-gray-400">결제 내역이 없습니다.</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {d.orders.map((o) => (
                                <li
                                  key={o.id}
                                  className="flex items-center justify-between gap-3 text-xs"
                                >
                                  <span className="min-w-0 truncate text-gray-600">
                                    {o.order_items?.map((i) => i.name_snapshot).join(", ")}
                                  </span>
                                  <span className="whitespace-nowrap text-gray-400">
                                    {day(o.paid_at ?? o.created_at)} · {o.status}
                                  </span>
                                  <b className="whitespace-nowrap text-sm-navy">
                                    {won(o.paid_amount)}
                                  </b>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}