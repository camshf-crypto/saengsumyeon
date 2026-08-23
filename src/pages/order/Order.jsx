import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";

const METHODS = [
  { key: "CARD", label: "신용카드" },
  { key: "VIRTUAL_ACCOUNT", label: "가상계좌(무통장)" },
];

function Th({ children }) {
  return (
    <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-bold text-sm-navy">
      {children}
    </th>
  );
}

function Td({ children, className = "" }) {
  return (
    <td className={`border border-gray-200 px-3 py-2 align-top text-[11px] leading-relaxed text-gray-600 ${className}`}>
      {children}
    </td>
  );
}

export default function Order() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, profile, refreshProfile } = useAuth();

  // 장바구니에서 넘어온 경우엔 그 항목들로 결제하고, 아니면 상품을 고르게 한다
  const cartItemIds = loc.state?.cartItemIds ?? null;
  const preselect = loc.state?.productId ?? null;

  const [products, setProducts] = useState([]);   // 상품 선택 모드
  const [picked, setPicked] = useState(null);     // 선택한 product id
  const [cartRows, setCartRows] = useState([]);   // 장바구니 모드
  const [coupons, setCoupons] = useState([]);
  const [couponId, setCouponId] = useState("");
  const [method, setMethod] = useState("CARD");
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!user) return;

    (async () => {
      const { data: cps } = await supabase
        .from("user_coupons")
        .select("id, expires_at, coupons(name, discount_type, discount_value, min_amount)")
        .eq("user_id", user.id)
        .is("used_at", null);
      setCoupons((cps ?? []).filter((c) => !c.expires_at || new Date(c.expires_at) > new Date()));

      if (cartItemIds) {
        const { data: items } = await supabase
          .from("cart_items")
          .select("id, product_id, products(id, name, summary, price, access_days)")
          .eq("user_id", user.id)
          .in("id", cartItemIds);
        setCartRows(items ?? []);
      } else {
        const { data: prods } = await supabase
          .from("products")
          .select("*")
          .eq("is_published", true)
          .eq("is_upsell", false)
          .order("sort_order");
        setProducts(prods ?? []);
        setPicked(preselect ?? prods?.[0]?.id ?? null);
      }
      setLoading(false);
    })();
  }, [user]);

  // 결제 대상
  const selected = cartItemIds
    ? cartRows.map((r) => r.products).filter(Boolean)
    : products.filter((p) => p.id === picked);

  const subtotal = selected.reduce((s, p) => s + (p?.price ?? 0), 0);
  const coupon = coupons.find((c) => c.id === couponId);

  // 화면 표시용 계산. 실제 청구 금액은 서버가 다시 계산한다.
  let discount = 0;
  if (coupon && subtotal >= (coupon.coupons?.min_amount ?? 0)) {
    discount =
      coupon.coupons.discount_type === "percent"
        ? Math.floor((subtotal * coupon.coupons.discount_value) / 100)
        : coupon.coupons.discount_value;
  }
  const payAmount = Math.max(subtotal - discount, 0);

  async function pay() {
    if (!agree) return setErr("결제 진행에 동의해 주세요.");
    if (selected.length === 0) return setErr("주문할 상품을 선택해 주세요.");

    setBusy(true);
    setErr("");

    // 상품 선택 모드면 결제 직전에 장바구니에 담아 id를 얻는다
    let ids = cartItemIds;
    if (!ids) {
      const { data, error } = await supabase
        .from("cart_items")
        .upsert(
          { user_id: user.id, product_id: picked, qty: 1 },
          { onConflict: "user_id,product_id" }
        )
        .select("id")
        .single();
      if (error || !data) {
        setBusy(false);
        console.error("cart upsert", error);
        setErr("주문서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      ids = [data.id];
      await refreshProfile();
    }

    // 서버에서 pending 주문 생성 — 금액도 서버가 확정한다
    const { data, error } = await supabase.functions.invoke("create-order", {
      body: { cartItemIds: ids, userCouponId: couponId || null, method },
    });

    if (error || !data?.orderNo) {
      setBusy(false);
      const code = data?.error;
      setErr(
        code === "already_enrolled"
          ? "이미 수강 중인 강의입니다. 나의 강의실에서 확인해 주세요."
          : code === "invalid_coupon"
          ? "사용할 수 없는 쿠폰입니다."
          : "주문서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
      console.error("create-order", error, data);
      return;
    }

    // 포트원 결제창 (이니시스는 리다이렉트 방식)
    try {
      const res = await window.PortOne.requestPayment({
        storeId: import.meta.env.VITE_PORTONE_STORE_ID,
        channelKey: import.meta.env.VITE_PORTONE_CHANNEL_KEY,
        paymentId: data.orderNo,
        orderName: data.orderName,
        totalAmount: data.payAmount,
        currency: "CURRENCY_KRW",
        payMethod: method,
        customer: {
          customerId: user.id,
          fullName: profile?.name ?? "",
          phoneNumber: profile?.phone ?? "",
          email: user.email,
        },
        redirectUrl: `${window.location.origin}/payment/complete`,
      });

      if (res?.code) {
        setBusy(false);
        setErr(res.message ?? "결제가 취소되었습니다.");
        return;
      }
      nav(`/payment/complete?paymentId=${data.orderNo}`, { replace: true });
    } catch (e) {
      console.error("portone", e);
      setBusy(false);
      setErr("결제창을 열지 못했습니다.");
    }
  }

  if (loading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">수강신청</h1>

      {/* 상품 선택 */}
      <section className="mt-8">
        <h2 className="text-base font-extrabold text-sm-navy">
          {cartItemIds ? "주문내역" : "상품 선택"}
        </h2>

        {cartItemIds ? (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {cartRows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="font-bold tracking-tight text-sm-navy">{r.products?.name}</p>
                  <p className="mt-1 text-[13px] text-gray-500">{r.products?.summary}</p>
                </div>
                <b className="whitespace-nowrap font-extrabold text-sm-navy">
                  {won(r.products?.price)}
                </b>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-3 space-y-3">
            {products.map((p) => {
              const on = picked === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setPicked(p.id)}
                    className={`flex w-full items-start gap-4 rounded-xl border-2 p-5 text-left transition ${
                      on ? "border-sm-orange bg-orange-50" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span
                      className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        on ? "border-sm-orange" : "border-gray-300"
                      }`}
                    >
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-sm-orange" />}
                    </span>

                    <span className="flex-1">
                      <span className="flex items-center gap-2">
                        <b className="font-extrabold tracking-tight text-sm-navy">{p.name}</b>
                        {p.kind === "pack" && (
                          <span className="rounded bg-sm-orange px-1.5 py-0.5 text-[11px] font-bold text-white">
                            추천
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-gray-500">
                        {p.summary}
                      </span>
                    </span>

                    <b className="whitespace-nowrap text-lg font-extrabold text-sm-navy">
                      {won(p.price)}
                    </b>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 주문자 */}
      <section className="mt-8">
        <h2 className="text-base font-extrabold text-sm-navy">주문자 정보</h2>
        <div className="mt-3 space-y-1 rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
          <p>{profile?.name}</p>
          <p>{profile?.phone}</p>
          <p>{user?.email}</p>
          <p className="pt-2 text-xs text-gray-400">
            강의는 결제 즉시 이 계정의 「나의 강의실」에서 열립니다.
          </p>
        </div>
      </section>

      {/* 쿠폰 */}
      <section className="mt-8">
        <h2 className="text-base font-extrabold text-sm-navy">쿠폰</h2>
        {coupons.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 p-5 text-sm text-gray-400">
            사용 가능한 쿠폰이 없습니다.
          </p>
        ) : (
          <select
            value={couponId}
            onChange={(e) => setCouponId(e.target.value)}
            className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange"
          >
            <option value="">쿠폰 사용 안 함</option>
            {coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.coupons?.name}
                {c.coupons?.discount_type === "percent"
                  ? ` (${c.coupons.discount_value}%)`
                  : ` (${won(c.coupons.discount_value)})`}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* 결제수단 */}
      <section className="mt-8">
        <h2 className="text-base font-extrabold text-sm-navy">결제수단</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              className={`rounded-lg border py-3.5 text-sm font-bold transition ${
                method === m.key
                  ? "border-sm-orange bg-orange-50 text-sm-orange"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {method === "VIRTUAL_ACCOUNT" && (
          <p className="mt-2 text-xs text-gray-500">
            입금이 확인되면 강의가 열립니다. 입금 기한이 지나면 주문은 자동 취소됩니다.
          </p>
        )}
      </section>

      {/* 취소 · 환불 안내 */}
      <section className="mt-10">
        <h2 className="text-base font-extrabold text-sm-navy">취소 · 환불 안내</h2>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>기준</Th>
                <Th>환불액</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="font-bold text-sm-navy">청약철회</Td>
                <Td>결제일로부터 7일 이내, 강의를 1강도 재생하지 않고 교재도 내려받지 않은 경우</Td>
                <Td>결제금액 100% 환불</Td>
              </tr>
              <tr>
                <Td className="font-bold text-sm-navy" rowSpan={2}>수강 개시 후</Td>
                <Td>수강 기간 또는 수강한 강의 수 기준으로 이용한 비율 산정 (둘 중 큰 값 적용)</Td>
                <Td>결제금액 − 이용한 부분에 해당하는 금액</Td>
              </tr>
              <tr>
                <Td>전체 강의의 3분의 2 이상을 수강했거나 수강 기간이 종료된 경우</Td>
                <Td>환불 불가</Td>
              </tr>
              <tr>
                <Td className="font-bold text-sm-navy">교재(PDF)</Td>
                <Td>파일을 내려받은 경우</Td>
                <Td>교재 금액 환불 불가 (강의 금액은 위 기준 적용)</Td>
              </tr>
              <tr>
                <Td className="font-bold text-sm-navy">1단계 불합격</Td>
                <Td>학생부종합전형 1단계 발표 전 결제 + 지원한 모든 대학에서 1단계 불합격 + 발표일로부터 7일 이내 신청</Td>
                <Td>결제금액 100% 환불</Td>
              </tr>
              <tr>
                <Td className="font-bold text-sm-navy">가상계좌 미입금</Td>
                <Td>입금 기한까지 입금하지 않은 경우</Td>
                <Td>주문 자동 취소 (환불 절차 없음)</Td>
              </tr>
            </tbody>
          </table>
        </div>

        <ul className="mt-4 space-y-1.5 text-[11px] leading-relaxed text-gray-500">
          <li>· 환불 신청은 「나의 강의실 → 환불 신청」에서 하실 수 있으며, 접수 후 영업일 기준 3~5일 이내에 처리됩니다.</li>
          <li>· 신용카드로 결제한 경우 승인 취소로 처리되며, 카드사 사정에 따라 3~5영업일이 추가로 소요될 수 있습니다.</li>
          <li>· 수강 기간은 결제일로부터 자동으로 진행되며, 수강을 시작하지 않아도 기간은 경과합니다.</li>
          <li>· 강의 영상 및 교재의 무단 복제·배포가 확인되는 경우 이용이 제한되며 환불이 불가합니다.</li>
          <li>
            · 자세한 내용은{" "}
            <a href="/refund" target="_blank" rel="noreferrer" className="font-bold underline">
              환불 규정
            </a>
            을 확인해 주세요.
          </li>
        </ul>
      </section>

      {/* 금액 */}
      <section className="mt-8 rounded-xl bg-gray-50 p-6">
        <div className="flex justify-between text-sm text-gray-600">
          <span>총 주문금액</span>
          <span>{won(subtotal)}</span>
        </div>
        <div className="mt-2 flex justify-between text-sm text-gray-600">
          <span>쿠폰 할인</span>
          <span className="text-sm-orange">- {won(discount)}</span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
          <span className="font-bold text-sm-navy">총 결제금액</span>
          <b className="text-2xl font-extrabold text-sm-orange">{won(payAmount)}</b>
        </div>
      </section>

      {/* 동의 */}
      <label className="mt-6 flex cursor-pointer items-start gap-2 text-[13px] leading-relaxed text-gray-600">
        <input
          type="checkbox"
          checked={agree}
          onChange={() => setAgree(!agree)}
          className="mt-0.5 h-4 w-4 accent-orange-500"
        />
        <span>
          <b className="text-sm-navy">[필수]</b> 주문 내용과 위 취소·환불 안내를 확인했으며, 결제 진행에
          동의합니다.
        </span>
      </label>

      {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

      <button
        onClick={pay}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-50"
      >
        {busy ? "결제창을 여는 중…" : `${won(payAmount)} 결제하기`}
      </button>
    </div>
  );
}