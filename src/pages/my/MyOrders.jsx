import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const day = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");

const STATUS = {
  pending: ["결제 대기", "bg-gray-100 text-gray-500"],
  paid: ["결제 완료", "bg-orange-50 text-sm-orange"],
  cancelled: ["취소", "bg-gray-100 text-gray-400"],
  refund_requested: ["환불 신청", "bg-blue-50 text-blue-600"],
  refunded: ["환불 완료", "bg-gray-100 text-gray-400"],
};


export default function MyOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);


  async function load() {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_no, status, total_amount, discount_amount, paid_amount, paid_at, created_at, " +
          "vbank_bank, vbank_num, vbank_holder, vbank_due_at, receipt_url, " +
          "order_items(name_snapshot, price_snapshot, access_days_snapshot)"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) console.error("orders", error);
    setOrders(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  if (loading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">주문 내역</h1>

      {orders.length === 0 ? (
        <div className="mt-10 rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-gray-500">주문 내역이 없습니다.</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {orders.map((o) => {
            const [label, cls] = STATUS[o.status] ?? ["-", "bg-gray-100 text-gray-400"];
            return (
              <li key={o.id} className="rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400">
                    {day(o.paid_at ?? o.created_at)} · 주문번호 {o.order_no}
                  </div>
                  <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span>
                </div>

                <ul className="mt-4 space-y-2">
                  {o.order_items?.map((it, i) => (
                    <li key={i} className="flex justify-between text-sm">
                      <span className="font-bold text-sm-navy">{it.name_snapshot}</span>
                      <span className="text-gray-500">{won(it.price_snapshot)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
                  <span className="text-sm text-gray-500">
                    결제금액
                    {o.discount_amount > 0 && (
                      <span className="ml-2 text-xs text-sm-orange">
                        (할인 -{won(o.discount_amount)})
                      </span>
                    )}
                  </span>
                  <b className="text-lg font-extrabold text-sm-navy">{won(o.paid_amount)}</b>
                </div>

                {/* 가상계좌 미입금 */}
                {o.status === "pending" && o.vbank_num && (
                  <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm">
                    <p className="font-bold text-sm-navy">입금 계좌</p>
                    <p className="mt-1 text-gray-600">
                      {o.vbank_bank} {o.vbank_num} ({o.vbank_holder})
                    </p>
                    {o.vbank_due_at && (
                      <p className="mt-1 text-xs text-gray-400">
                        입금기한 {new Date(o.vbank_due_at).toLocaleString("ko-KR")}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex gap-3 text-sm">
                  {o.receipt_url && (
                    <a
                      href={o.receipt_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-gray-400 underline"
                    >
                      매출전표
                    </a>
                  )}
                  {o.status === "paid" && (
                    <Link
                      to="/my/refund"
                      className="ml-auto font-semibold text-gray-400 hover:text-sm-orange"
                    >
                      환불 신청 →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}