import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const dt = (d) => (d ? new Date(d).toLocaleString("ko-KR") : "-");

export default function AdminHome() {
  const [s, setS] = useState(null);
  const [recent, setRecent] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [paid, monthPaid, pending, waitRefund, members, lectures, ords, reqs] =
        await Promise.all([
          supabase.from("orders").select("paid_amount").eq("status", "paid"),
          supabase
            .from("orders")
            .select("paid_amount")
            .eq("status", "paid")
            .gte("paid_at", monthStart.toISOString()),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase
            .from("refund_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "requested"),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("lectures").select("id", { count: "exact", head: true }),
          supabase
            .from("orders")
            .select("id, order_no, status, paid_amount, paid_at, created_at, profiles(name), order_items(name_snapshot)")
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("refund_requests")
            .select("id, reason, requested_at, profiles(name), orders(order_no, paid_amount)")
            .eq("status", "requested")
            .order("requested_at", { ascending: false })
            .limit(5),
        ]);

      setS({
        total: (paid.data ?? []).reduce((a, o) => a + (o.paid_amount ?? 0), 0),
        totalCount: (paid.data ?? []).length,
        month: (monthPaid.data ?? []).reduce((a, o) => a + (o.paid_amount ?? 0), 0),
        monthCount: (monthPaid.data ?? []).length,
        pending: pending.count ?? 0,
        waitRefund: waitRefund.count ?? 0,
        members: members.count ?? 0,
        lectures: lectures.count ?? 0,
      });
      setRecent(ords.data ?? []);
      setRefunds(reqs.data ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">대시보드</h1>

      {/* 처리 필요 */}
      {(s.waitRefund > 0 || s.lectures === 0) && (
        <div className="mt-5 space-y-2">
          {s.waitRefund > 0 && (
            <Link
              to="/admin/refunds"
              className="block rounded-xl bg-orange-50 p-4 text-sm font-bold text-sm-orange"
            >
              환불 신청 {s.waitRefund}건이 처리를 기다리고 있습니다 →
            </Link>
          )}
          {s.lectures === 0 && (
            <Link
              to="/admin/lectures"
              className="block rounded-xl bg-gray-50 p-4 text-sm font-bold text-gray-600"
            >
              등록된 강의가 없습니다. 강의를 먼저 등록해 주세요 →
            </Link>
          )}
        </div>
      )}

      {/* 숫자 */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["이번 달 매출", won(s.month), `${s.monthCount}건`],
          ["누적 매출", won(s.total), `${s.totalCount}건`],
          ["결제 대기", `${s.pending}건`, "가상계좌 미입금 포함"],
          ["회원", `${s.members}명`, `강의 ${s.lectures}편 등록`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-extrabold text-sm-navy">{value}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      {/* 환불 대기 */}
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <p className="text-sm font-extrabold text-sm-navy">환불 처리 대기</p>
          <Link to="/admin/refunds" className="text-xs font-semibold text-gray-400 hover:text-sm-orange">
            전체 보기
          </Link>
        </div>
        {refunds.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 py-10 text-center text-sm text-gray-400">
            대기 중인 환불 신청이 없습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {refunds.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-sm-navy">{r.profiles?.name ?? "-"}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {r.orders?.order_no} · {dt(r.requested_at)}
                  </p>
                </div>
                <b className="whitespace-nowrap text-sm text-sm-navy">{won(r.orders?.paid_amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 최근 주문 */}
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <p className="text-sm font-extrabold text-sm-navy">최근 주문</p>
          <Link to="/admin/orders" className="text-xs font-semibold text-gray-400 hover:text-sm-orange">
            전체 보기
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 py-10 text-center text-sm text-gray-400">
            주문이 없습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-sm-navy">
                    {o.profiles?.name ?? "-"}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {o.order_items?.map((i) => i.name_snapshot).join(", ")}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {o.order_no} · {dt(o.paid_at ?? o.created_at)}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs text-gray-400">{o.status}</span>
                <b className="whitespace-nowrap text-sm text-sm-navy">{won(o.paid_amount)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}