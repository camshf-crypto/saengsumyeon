import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const ym = (d) => new Date(d).toISOString().slice(0, 7);

// 기본 조회 구간: 이번 달 1일 ~ 오늘
function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: ymd(from), to: ymd(now) };
}

export default function AdminSales() {
  const [range, setRange] = useState(defaultRange);
  const [unit, setUnit] = useState("day"); // day | month
  const [orders, setOrders] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const fromISO = new Date(range.from + "T00:00:00").toISOString();
    const toISO = new Date(range.to + "T23:59:59").toISOString();

    const [{ data: paid }, { data: refunded }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, paid_amount, discount_amount, total_amount, paid_at, pg_method, order_items(name_snapshot)")
        .in("status", ["paid", "refunded"])
        .gte("paid_at", fromISO)
        .lte("paid_at", toISO)
        .order("paid_at"),
      supabase
        .from("refund_requests")
        .select("id, refund_amount, handled_at")
        .eq("status", "done")
        .gte("handled_at", fromISO)
        .lte("handled_at", toISO),
    ]);

    setOrders(paid ?? []);
    setRefunds(refunded ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [range.from, range.to]);

  const stat = useMemo(() => {
    const gross = orders.reduce((a, o) => a + (o.paid_amount ?? 0), 0);
    const discount = orders.reduce((a, o) => a + (o.discount_amount ?? 0), 0);
    const refund = refunds.reduce((a, r) => a + (r.refund_amount ?? 0), 0);

    // 기간별 집계
    const buckets = {};
    orders.forEach((o) => {
      const k = unit === "day" ? ymd(o.paid_at) : ym(o.paid_at);
      buckets[k] ??= { key: k, amount: 0, count: 0 };
      buckets[k].amount += o.paid_amount ?? 0;
      buckets[k].count += 1;
    });

    // 상품별 집계
    const byProduct = {};
    orders.forEach((o) => {
      (o.order_items ?? []).forEach((i) => {
        byProduct[i.name_snapshot] ??= { name: i.name_snapshot, count: 0 };
        byProduct[i.name_snapshot].count += 1;
      });
    });

    // 결제수단별
    const byMethod = {};
    orders.forEach((o) => {
      const k = o.pg_method === "VIRTUAL_ACCOUNT" ? "가상계좌" : "신용카드";
      byMethod[k] ??= { name: k, amount: 0, count: 0 };
      byMethod[k].amount += o.paid_amount ?? 0;
      byMethod[k].count += 1;
    });

    const series = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
    return {
      gross,
      discount,
      refund,
      net: gross - refund,
      count: orders.length,
      avg: orders.length ? Math.round(gross / orders.length) : 0,
      series,
      max: Math.max(...series.map((s) => s.amount), 1),
      byProduct: Object.values(byProduct).sort((a, b) => b.count - a.count),
      byMethod: Object.values(byMethod),
    };
  }, [orders, refunds, unit]);

  function preset(kind) {
    const now = new Date();
    if (kind === "thisMonth") return setRange(defaultRange());
    if (kind === "lastMonth") {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return setRange({ from: ymd(from), to: ymd(to) });
    }
    if (kind === "year") {
      return setRange({ from: `${now.getFullYear()}-01-01`, to: ymd(now) });
    }
  }

  function exportCsv() {
    const head = ["기간", "결제건수", "결제금액"];
    const body = stat.series.map((s) => [s.key, s.count, s.amount]);
    const csv = [head, ...body]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `생수면_매출_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const input =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sm-orange";

  return (
    <div>
      <div className="flex items-end justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">매출 · 정산</h1>
        <button
          onClick={exportCsv}
          className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold text-gray-600 hover:border-sm-orange hover:text-sm-orange"
        >
          엑셀 내보내기
        </button>
      </div>

      {/* 기간 */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
          className={input}
        />
        <span className="text-sm text-gray-400">~</span>
        <input
          type="date"
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
          className={input}
        />
        {[["thisMonth", "이번 달"], ["lastMonth", "지난 달"], ["year", "올해"]].map(([k, l]) => (
          <button
            key={k}
            onClick={() => preset(k)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-500 hover:border-sm-orange hover:text-sm-orange"
          >
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-32 text-center text-gray-400">불러오는 중…</div>
      ) : (
        <>
          {/* 요약 */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["결제 금액", won(stat.gross), `${stat.count}건`],
              ["환불 금액", "- " + won(stat.refund), `${refunds.length}건`],
              ["순 매출", won(stat.net), "결제 − 환불"],
              ["객단가", won(stat.avg), `쿠폰 할인 ${won(stat.discount)}`],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded-xl border border-gray-200 p-4">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="mt-1 text-lg font-extrabold text-sm-navy">{value}</p>
                <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>
              </div>
            ))}
          </div>

          {/* 추이 */}
          <section className="mt-8">
            <div className="flex items-end justify-between">
              <p className="text-sm font-extrabold text-sm-navy">기간별 매출</p>
              <div className="flex gap-1">
                {[["day", "일별"], ["month", "월별"]].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setUnit(k)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      unit === k
                        ? "border-sm-orange bg-orange-50 text-sm-orange"
                        : "border-gray-300 text-gray-500"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {stat.series.length === 0 ? (
              <p className="mt-3 rounded-xl border border-gray-200 py-16 text-center text-sm text-gray-400">
                해당 기간에 결제가 없습니다.
              </p>
            ) : (
              <div className="mt-3 rounded-xl border border-gray-200 p-5">
                <ul className="space-y-2">
                  {stat.series.map((s) => (
                    <li key={s.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-xs text-gray-500">{s.key}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                        <div
                          className="h-full rounded bg-sm-orange"
                          style={{ width: `${(s.amount / stat.max) * 100}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-xs text-gray-400">
                        {s.count}건
                      </span>
                      <b className="w-28 shrink-0 text-right text-xs font-extrabold text-sm-navy">
                        {won(s.amount)}
                      </b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* 상품별 · 결제수단별 */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <section>
              <p className="text-sm font-extrabold text-sm-navy">상품별 판매</p>
              <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {stat.byProduct.length === 0 && (
                  <li className="py-10 text-center text-sm text-gray-400">판매 없음</li>
                )}
                {stat.byProduct.map((p) => (
                  <li key={p.name} className="flex justify-between px-4 py-3 text-sm">
                    <span className="min-w-0 truncate text-gray-600">{p.name}</span>
                    <b className="ml-3 whitespace-nowrap text-sm-navy">{p.count}건</b>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <p className="text-sm font-extrabold text-sm-navy">결제수단별</p>
              <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {stat.byMethod.length === 0 && (
                  <li className="py-10 text-center text-sm text-gray-400">결제 없음</li>
                )}
                {stat.byMethod.map((m) => (
                  <li key={m.name} className="flex justify-between px-4 py-3 text-sm">
                    <span className="text-gray-600">
                      {m.name}
                      <span className="ml-2 text-xs text-gray-400">{m.count}건</span>
                    </span>
                    <b className="whitespace-nowrap text-sm-navy">{won(m.amount)}</b>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-gray-400">
            ※ 결제 금액은 결제일 기준, 환불 금액은 환불 처리일 기준으로 집계됩니다. 지난달에 결제한
            건을 이번 달에 환불하면 이번 달 순 매출에서 차감됩니다.
            <br />
            ※ 관리자가 직접 지급한 수강권은 결제 기록이 없어 매출에 잡히지 않습니다.
            <br />※ PG 수수료는 반영되지 않은 금액입니다. 실제 정산액은 포트원 정산 내역을 확인해
            주세요.
          </p>
        </>
      )}
    </div>
  );
}