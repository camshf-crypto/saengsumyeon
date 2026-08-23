import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";

export default function PaymentComplete() {
  const [params] = useSearchParams();
  const { refreshProfile } = useAuth();

  // 이니시스 리다이렉트는 paymentId를 쿼리로 붙여서 돌아온다
  const paymentId = params.get("paymentId") ?? params.get("payment_id");
  const pgError = params.get("code") || params.get("message");

  const [state, setState] = useState("checking"); // checking | paid | vbank | failed | error
  const [order, setOrder] = useState(null);
  const [msg, setMsg] = useState("");
  const ran = useRef(false); // StrictMode 이중 실행 방지

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!paymentId) {
      setState("error");
      setMsg("결제 정보를 찾을 수 없습니다.");
      return;
    }

    (async () => {
      // 결제창에서 실패로 돌아온 경우
      if (pgError && params.get("code")) {
        setState("failed");
        setMsg(params.get("message") ?? "결제가 취소되었습니다.");
        return;
      }

      // 승인 확인은 서버가 한다. 여러 번 불려도 안전하게 짜여 있다.
      const { data, error } = await supabase.functions.invoke("confirm-payment", {
        body: { paymentId },
      });

      if (error) {
        console.error("confirm-payment", error);
        setState("error");
        setMsg("결제 확인 중 문제가 발생했습니다.");
        return;
      }

      // 주문 정보 표시용
      const { data: o } = await supabase
        .from("orders")
        .select("order_no, paid_amount, status, vbank_bank, vbank_num, vbank_holder, vbank_due_at")
        .eq("pg_payment_id", paymentId)
        .maybeSingle();
      setOrder(o ?? null);

      if (data?.status === "paid") {
        await refreshProfile(); // 장바구니 배지 갱신
        setState("paid");
      } else if (data?.status === "vbank_issued") {
        setState("vbank");
      } else if (data?.status === "cancelled") {
        setState("failed");
        setMsg("결제가 취소되었습니다.");
      } else {
        setState("error");
        setMsg(data?.error ?? "결제 상태를 확인하지 못했습니다.");
      }
    })();
  }, []);

  /* ── 확인 중 ─────────────────────────────────────────── */
  if (state === "checking") {
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center">
        <p className="text-lg font-bold text-sm-navy">결제를 확인하고 있습니다</p>
        <p className="mt-3 text-sm text-gray-500">창을 닫지 말고 잠시만 기다려 주세요.</p>
      </div>
    );
  }

  /* ── 결제 완료 ───────────────────────────────────────── */
  if (state === "paid") {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-2xl font-extrabold tracking-tight text-sm-navy">수강신청이 완료되었습니다</p>
        <p className="mt-3 text-sm text-gray-500">지금 바로 강의를 들으실 수 있습니다.</p>

        <div className="mt-8 space-y-2 rounded-xl bg-gray-50 p-6 text-left text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">주문번호</span>
            <span className="font-semibold">{order?.order_no}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">결제금액</span>
            <span className="font-extrabold text-sm-navy">{won(order?.paid_amount)}</span>
          </div>
        </div>

        <Link
          to="/my"
          className="mt-8 block rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white"
        >
          나의 강의실로 가기
        </Link>
        <Link to="/my/orders" className="mt-3 block text-sm text-gray-400 underline">
          주문 내역 보기
        </Link>
      </div>
    );
  }

  /* ── 가상계좌 발급 ───────────────────────────────────── */
  if (state === "vbank") {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-2xl font-extrabold tracking-tight text-sm-navy">입금 계좌가 발급되었습니다</p>
        <p className="mt-3 text-sm text-gray-500">
          입금이 확인되면 강의가 자동으로 열립니다.
        </p>

        <div className="mt-8 space-y-2 rounded-xl bg-gray-50 p-6 text-left text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">은행</span>
            <span className="font-semibold">{order?.vbank_bank ?? "-"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">계좌번호</span>
            <span className="font-extrabold text-sm-navy">{order?.vbank_num ?? "-"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">예금주</span>
            <span className="font-semibold">{order?.vbank_holder ?? "-"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">입금금액</span>
            <span className="font-extrabold text-sm-orange">{won(order?.paid_amount)}</span>
          </div>
          {order?.vbank_due_at && (
            <div className="flex justify-between">
              <span className="text-gray-500">입금기한</span>
              <span className="font-semibold">
                {new Date(order.vbank_due_at).toLocaleString("ko-KR")}
              </span>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-gray-400">
          기한까지 입금하지 않으면 주문이 자동으로 취소됩니다.
          <br />
          계좌 정보는 주문 내역에서 다시 확인하실 수 있습니다.
        </p>

        <Link
          to="/my/orders"
          className="mt-6 block rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white"
        >
          주문 내역으로
        </Link>
      </div>
    );
  }

  /* ── 실패 / 오류 ─────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-md px-5 py-24 text-center">
      <p className="text-2xl font-extrabold tracking-tight text-sm-navy">
        {state === "failed" ? "결제가 완료되지 않았습니다" : "결제 확인에 실패했습니다"}
      </p>
      <p className="mt-3 text-sm text-gray-500">{msg}</p>

      {state === "error" && (
        <p className="mt-4 rounded-lg bg-orange-50 p-4 text-xs leading-relaxed text-gray-600">
          카드사에서 결제가 되었는데 이 화면이 보인다면 중복 결제하지 마시고 고객센터로
          문의해 주세요. 주문번호 {order?.order_no ?? paymentId}
        </p>
      )}

      <Link
        to="/cart"
        className="mt-8 block rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white"
      >
        장바구니로 돌아가기
      </Link>
      <Link to="/" className="mt-3 block text-sm text-gray-400 underline">
        홈으로
      </Link>
    </div>
  );
}