import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => n.toLocaleString("ko-KR") + "원";

export default function Cart() {
  const nav = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [rows, setRows] = useState([]);
  const [checked, setChecked] = useState([]); // cart_items.id 배열
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data, error } = await supabase
      .from("cart_items")
      .select("id, product_id, products(id, name, summary, price, list_price, access_days)")
      .eq("user_id", user.id)
      .order("created_at");
    if (error) console.error("cart load", error);
    const list = data ?? [];
    setRows(list);
    setChecked(list.map((r) => r.id)); // 기본 전체 선택
    setLoading(false);
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function remove(ids) {
    if (ids.length === 0) return;
    const { error } = await supabase.from("cart_items").delete().in("id", ids);
    if (error) {
      console.error("cart delete", error);
      return;
    }
    await refreshProfile();
    load();
  }

  const selected = rows.filter((r) => checked.includes(r.id));
  const total = selected.reduce((s, r) => s + (r.products?.price ?? 0), 0);
  const listTotal = selected.reduce(
    (s, r) => s + Math.max(r.products?.list_price ?? 0, r.products?.price ?? 0),
    0
  );
  const saved = listTotal - total;
  const allChecked = rows.length > 0 && checked.length === rows.length;

  function goOrder() {
    if (selected.length === 0) return;
    // 선택한 항목만 주문서로 넘긴다
    nav("/order", { state: { cartItemIds: selected.map((r) => r.id) } });
  }

  if (loading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">장바구니</h1>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-gray-500">장바구니가 비어 있습니다.</p>
          <Link
            to="/"
            className="mt-5 inline-block rounded-lg bg-sm-orange px-6 py-3 text-sm font-extrabold text-white"
          >
            강의 보러 가기
          </Link>
        </div>
      ) : (
        <>
          {/* 전체 선택 / 선택 삭제 */}
          <div className="mt-6 flex items-center justify-between border-b border-gray-200 pb-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-gray-700">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={() => setChecked(allChecked ? [] : rows.map((r) => r.id))}
                className="h-4 w-4 accent-orange-500"
              />
              전체 선택 ({checked.length}/{rows.length})
            </label>
            <button
              onClick={() => remove(checked)}
              className="text-sm font-semibold text-gray-400 hover:text-red-500"
            >
              선택 삭제
            </button>
          </div>

          {/* 목록 */}
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const p = r.products;
              const on = checked.includes(r.id);
              return (
                <li key={r.id} className="flex items-start gap-4 py-5">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setChecked(on ? checked.filter((x) => x !== r.id) : [...checked, r.id])
                    }
                    className="mt-1 h-4 w-4 accent-orange-500"
                  />
                  <div className="flex-1">
                    <p className="font-bold tracking-tight text-sm-navy">{p?.name}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{p?.summary}</p>
                    <p className="mt-1 text-xs text-gray-400">수강 기간 {p?.access_days}일</p>
                  </div>
                  <div className="text-right">
                    {p?.list_price > p?.price && (
                      <del className="block text-xs text-gray-400">{won(p.list_price)}</del>
                    )}
                    <b className="text-lg font-extrabold text-sm-navy">{won(p?.price ?? 0)}</b>
                    <button
                      onClick={() => remove([r.id])}
                      className="mt-2 block w-full text-xs text-gray-400 hover:text-red-500"
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 금액 */}
          <div className="mt-6 rounded-xl bg-gray-50 p-6">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>총 주문금액</span>
              <span>{won(listTotal)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
              <span>할인금액</span>
              <span className="text-sm-orange">- {won(saved)}</span>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
              <span className="font-bold text-sm-navy">총 결제금액</span>
              <b className="text-2xl font-extrabold text-sm-orange">{won(total)}</b>
            </div>
            <p className="mt-3 text-xs text-gray-400">쿠폰 할인은 다음 단계에서 적용됩니다.</p>
          </div>

          <button
            onClick={goOrder}
            disabled={selected.length === 0}
            className="mt-6 w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-40"
          >
            {selected.length}건 주문하기
          </button>
        </>
      )}
    </div>
  );
}