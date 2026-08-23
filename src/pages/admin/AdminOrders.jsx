import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const dt = (d) => (d ? new Date(d).toLocaleString("ko-KR") : "-");

const ORDER_STATUS = {
  pending: ["결제 대기", "bg-gray-100 text-gray-500"],
  paid: ["결제 완료", "bg-orange-50 text-sm-orange"],
  cancelled: ["취소", "bg-gray-100 text-gray-400"],
  refund_requested: ["환불 신청", "bg-blue-50 text-blue-600"],
  refunded: ["환불 완료", "bg-gray-100 text-gray-400"],
};


export default function AdminOrders() {
  const { isMaster, loading: authLoading } = useAuth();

  const [filter, setFilter] = useState("all");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_no, user_id, status, paid_amount, discount_amount, paid_at, created_at, " +
          "pg_method, pg_tx_id, fail_reason, " +
          "profiles(name, phone), order_items(name_snapshot, price_snapshot)"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) console.error("admin orders", error);
    setOrders(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (isMaster) load();
    else if (!authLoading) setLoading(false);
  }, [isMaster, authLoading]);

  // 환불 신청 처리. 실제 결제 취소는 포트원 콘솔에서 수행한 뒤 여기서 상태를 맞춘다.
  if (authLoading || loading)
    return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  if (!isMaster) {
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center">
        <p className="text-xl font-extrabold text-sm-navy">접근 권한이 없습니다</p>
        <Link to="/" className="mt-6 inline-block text-sm text-gray-400 underline">
          홈으로
        </Link>
      </div>
    );
  }

  const shown = filter === "all" ? orders : orders.filter((o) => o.status === filter);
  const paidSum = orders
    .filter((o) => o.status === "paid")
    .reduce((s, o) => s + (o.paid_amount ?? 0), 0);

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">주문 관리</h1>
      </div>

      {/* 요약 */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          ["결제 완료", orders.filter((o) => o.status === "paid").length + "건"],
          ["누적 결제금액", won(paidSum)],
          ["환불", orders.filter((o) => o.status === "refunded").length + "건"],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">{l}</p>
            <p className="mt-1 text-lg font-extrabold text-sm-navy">{v}</p>
          </div>
        ))}
      </div>

      {/* 주문 */}
      <div className="mt-6">
          <div className="mt-5 flex flex-wrap gap-2">
            {[["all", "전체"], ...Object.entries(ORDER_STATUS).map(([k, v]) => [k, v[0]])].map(
              ([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                    filter === k
                      ? "border-sm-orange bg-orange-50 text-sm-orange"
                      : "border-gray-300 text-gray-500"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>

          <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {shown.length === 0 && (
              <li className="py-16 text-center text-sm text-gray-400">주문이 없습니다.</li>
            )}
            {shown.map((o) => {
              const [label, cls] = ORDER_STATUS[o.status] ?? ["-", "bg-gray-100 text-gray-400"];
              return (
                <li key={o.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-sm-navy">
                        {o.profiles?.name ?? "-"}
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          {o.profiles?.phone ?? ""}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {o.order_no} · {dt(o.paid_at ?? o.created_at)}
                        {o.pg_method ? ` · ${o.pg_method}` : ""}
                      </p>
                      <p className="mt-2 text-[13px] text-gray-600">
                        {o.order_items?.map((i) => i.name_snapshot).join(", ")}
                      </p>
                      {o.fail_reason && (
                        <p className="mt-1 text-xs text-red-500">{o.fail_reason}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${cls}`}>
                        {label}
                      </span>
                      <p className="mt-2 font-extrabold text-sm-navy">{won(o.paid_amount)}</p>
                      {o.discount_amount > 0 && (
                        <p className="text-xs text-sm-orange">-{won(o.discount_amount)}</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-gray-400">
        ※ 「환불 완료 처리」는 주문 상태와 수강권만 정리합니다. 실제 결제 취소는 포트원 콘솔에서 먼저
        진행한 뒤 이 버튼을 눌러 주세요.
      </p>
    </div>
  );
}