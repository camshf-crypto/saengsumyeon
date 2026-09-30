import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";

/*
 * 결제 팝업 — 탐구 준비·결과 분석·보고서 화면, 그리고 생기부 예상질문(kind="interview") 화면이 같이 쓴다
 * ① 상품 고르기 → ② 계좌로 입금 (입금자명 자동) → ③ '입금했어요' → 관리자 승인 후 열림
 * 이용권이 남아 있으면 결제 없이 '이용권 1개로 열기'
 * 금액을 바꾸면 서버 함수 supabase/functions/order 의 금액도 같이 바꿔야 한다
 */

const BANK = { name: "국민은행", number: "649301-04-159726", holder: "세움러닝(김지윤)" };
// 파는 상품 — 탐구 쪽은 10건, 예상질문 쪽은 예상질문 하나
const PRODUCTS_BY_KIND = {
  inquiry: [{ k: "ten", label: "탐구 10건", price: 29000, sub: "1건당 2,900원 · 탐구보고서 10건" }],
  interview: [{ k: "interview", label: "생기부 예상질문", price: 19000, sub: "" }],
};

function Copy({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => window.prompt("복사해 주세요", text))}
      className="shrink-0 rounded-md border border-sm-navy px-2.5 py-1 text-[12px] font-bold text-sm-navy"
    >
      {done ? "복사됨" : label ?? "복사"}
    </button>
  );
}

export default function Paywall({ open, onClose, inquiryId, reason, onUnlocked, kind = "inquiry" }) {
  const { user, profile } = useAuth();
  const PRODUCTS = PRODUCTS_BY_KIND[kind];
  const isInterview = kind === "interview";
  const [product, setProduct] = useState(PRODUCTS[0].k);
  const [depositor, setDepositor] = useState("");
  const [receipt, setReceipt] = useState("");
  const [paid, setPaid] = useState(false); // '입금을 마쳤어요' 체크
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [balance, setBalance] = useState(0);
  const [pending, setPending] = useState(null); // 확인 대기 중인 주문

  // 입금자명 기본값: 이름 + 4자리 번호 (같은 이름끼리 구분)
  const code = useMemo(() => String(Math.floor(1000 + Math.random() * 9000)), []);
  useEffect(() => {
    const name = (profile?.name ?? user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? "").replace(/\s/g, "").slice(0, 5);
    setDepositor(`${name || "생수면"}${code}`);
  }, [profile, user, code]);

  const [checking, setChecking] = useState(true); // 이미 열렸는지 확인 중

  // 팝업이 뜨기 전에 — 관리자가 이미 승인해서 열린 탐구면 팝업 없이 바로 연다
  useEffect(() => {
    if (!open || !user) return;
    if (isInterview) {
      setChecking(true);
      supabase.from("interview_access").select("user_id").maybeSingle().then(({ data }) => {
        if (data) return onUnlocked?.();
        setChecking(false);
      });
      return;
    }
    if (!inquiryId) return setChecking(false);
    setChecking(true);
    supabase.from("inquiries").select("paid").eq("id", inquiryId).maybeSingle().then(({ data }) => {
      if (data?.paid) return onUnlocked?.();
      setChecking(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, inquiryId]);

  // 남은 이용권 · 확인 대기 주문
  useEffect(() => {
    if (!open || !user) return;
    track("paywall_view", reason);
    if (!isInterview) supabase.from("credits").select("balance").maybeSingle().then(({ data }) => setBalance(data?.balance ?? 0));
    let q = supabase.from("pay_orders").select("*").eq("status", "pending");
    q = isInterview ? q.eq("product", "interview") : q.neq("product", "interview");
    q.order("created_at", { ascending: false }).limit(1).then(({ data }) => setPending(data?.[0] ?? null));
  }, [open, user, reason]);

  // 입금 확인 중이면 — 관리자가 승인하는 순간 실시간으로 받아서 저절로 연다 (예비로 30초마다 확인)
  useEffect(() => {
    if (!open || !pending || !user || (!inquiryId && !isInterview)) return;
    const check = () =>
      isInterview
        ? supabase.from("interview_access").select("user_id").maybeSingle().then(({ data }) => {
            if (data) onUnlocked?.();
          })
        : supabase.from("inquiries").select("paid").eq("id", inquiryId).maybeSingle().then(({ data }) => {
            if (data?.paid) onUnlocked?.();
          });
    const ch = supabase
      .channel(`my-order-${user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pay_orders", filter: `user_id=eq.${user.id}` }, (e) => {
        if (e.new?.status === "approved") check();
      })
      .subscribe();
    const t = setInterval(() => document.visibilityState === "visible" && check(), 30000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, inquiryId, user]);

  if (!open || checking) return null;

  const price = PRODUCTS.find((p) => p.k === product).price;
  const eta = new Date().getHours() < 6 ? "오늘 오전 8시에" : "2시간 안에";

  // 이용권으로 바로 열기
  async function useCredit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("unlock_inquiry", { p_inquiry: inquiryId });
    setBusy(false);
    if (error || !data) return setErr("이용권으로 열지 못했어요. 다시 시도해 주세요.");
    onUnlocked?.();
  }

  // 입금했어요
  async function submit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.functions.invoke("order", {
      body: { product, depositor: depositor.trim(), receipt: receipt.trim() || null, inquiry_id: inquiryId ?? null },
    });
    setBusy(false);
    if (error || data?.error) {
      let m = data?.error;
      try { m = m ?? (await error?.context?.json?.())?.error; } catch { /* 무시 */ }
      return setErr(m ?? "주문을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    track("order_submit", product);
    setPending({ product, amount: price, depositor: depositor.trim(), created_at: new Date().toISOString(), eta: data.eta });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[12px] font-bold text-sm-orange">{isInterview ? "생기부 예상질문" : "이용권이 필요해요"}</p>
            <p className="mt-1 text-[19px] font-extrabold text-sm-navy">
              {isInterview
                ? "내 생기부로 면접 예상 질문 뽑기"
                : reason === "start" ? "무료 탐구 1건을 다 썼어요" : reason === "pdf" ? "이 보고서를 PDF로 저장하려면" : "탐구를 끝까지 이어가려면"}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
              {isInterview ? (
                <><b>생기부 정리 가이드 PDF</b>와 <b>생기부 예상 질문 · PDF 저장</b>이 열려요. </>
              ) : reason === "pdf" ? (
                <>무료 체험으로 만든 보고서예요. <b>이용권 1개</b>로 이 보고서를 PDF로 저장할 수 있어요.</>
              ) : (
                <>이용권 1개로 탐구 1건의 <b>AI 자료 찾기 · 결과 분석 · 보고서 디자인 · PDF 저장</b>이 모두 열려요.</>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-[22px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>

        {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

        {/* 이용권이 남아 있으면 바로 열기 */}
        {balance > 0 && inquiryId && (
          <div className="mt-5 rounded-xl border-2 border-sm-navy bg-indigo-50 p-4">
            <p className="text-[14.5px] font-extrabold text-sm-navy">남은 이용권 {balance}개</p>
            <button onClick={useCredit} disabled={busy} className="mt-3 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-50">
              이용권 1개로 이 탐구 열기
            </button>
          </div>
        )}
        {balance > 0 && !inquiryId && (
          <p className="mt-5 rounded-xl bg-indigo-50 p-4 text-[13.5px] font-bold text-sm-navy">남은 이용권 {balance}개 · 새 탐구를 시작하면 1개가 쓰여요. 창을 닫고 다시 시도해 주세요.</p>
        )}

        {/* 확인 대기 중 */}
        {pending ? (
          <div className="mt-5 rounded-xl bg-orange-50 p-5 text-center">
            <p className="text-[16px] font-extrabold text-orange-800">입금 확인 중이에요</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-orange-900">
              {pending.depositor} · {Number(pending.amount).toLocaleString()}원
              <br />
              <b>{pending.eta ?? eta}</b> 확인하고 열어드려요.
            </p>
            <p className="mt-2 text-[12px] text-orange-700">밤 12시~아침 6시에 입금하면 오전 8시에 한꺼번에 확인해요.</p>
            <p className="mt-2 text-[12px] font-bold text-orange-800">확인되면 이 화면이 저절로 열려요. 새로고침하지 않아도 돼요.</p>
            <button onClick={onClose} className="mt-4 h-11 w-full rounded-lg bg-sm-navy text-[14px] font-bold text-white">확인</button>
          </div>
        ) : (
          balance === 0 && (
            <div className="mt-5 space-y-5">
              {/* ① 상품 */}
              <div>
                <p className="text-[13px] font-extrabold text-sm-navy">① {PRODUCTS.length > 1 ? "이용권 고르기" : "상품"}</p>
                <div className={`mt-2 grid gap-2 ${PRODUCTS.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {PRODUCTS.map((p) => (
                    <button key={p.k} onClick={() => setProduct(p.k)} className={`relative rounded-xl border-2 p-3 text-left ${product === p.k ? "border-sm-navy bg-indigo-50" : "border-gray-200"}`}>
                      {p.best && <span className="absolute -top-2 right-2 rounded-full bg-sm-orange px-2 py-0.5 text-[10.5px] font-bold text-white">할인</span>}
                      <p className="text-[14px] font-extrabold text-sm-navy">{p.label}</p>
                      <p className="text-[17px] font-black text-sm-navy">{p.price.toLocaleString()}원</p>
                      <p className="text-[11.5px] text-gray-500">{p.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* ② 입금 */}
              <div>
                <p className="text-[13px] font-extrabold text-sm-navy">② 이 계좌로 입금해 주세요</p>
                <div className="mt-2 space-y-2 rounded-xl bg-gray-50 p-4 text-[13.5px]">
                  <div className="flex items-center justify-between gap-2"><span className="text-gray-500">은행</span><b className="text-sm-navy">{BANK.name}</b></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-gray-500">계좌번호</span><span className="flex items-center gap-2"><b className="text-sm-navy">{BANK.number}</b><Copy text={BANK.number.replace(/-/g, "")} /></span></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-gray-500">예금주</span><b className="text-sm-navy">{BANK.holder}</b></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-gray-500">금액</span><b className="text-[16px] text-sm-orange">{price.toLocaleString()}원</b></div>
                </div>
                <label className="mt-3 block text-[13px] font-bold text-sm-navy">
                  입금자명 <span className="font-normal text-sm-orange">꼭 이대로 입금해 주세요</span>
                  <div className="mt-1 flex gap-2">
                    <input value={depositor} onChange={(e) => setDepositor(e.target.value)} className="w-full rounded-lg border-2 border-sm-orange px-3 py-2 text-[16px] font-extrabold text-sm-navy outline-none" />
                    <Copy text={depositor} />
                  </div>
                </label>
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">부모님이 입금해도 괜찮아요. 입금자명만 똑같이 적어 주세요. 이 이름으로 누구의 입금인지 확인해요.</p>
                <label className="mt-3 block text-[12.5px] font-bold text-gray-600">
                  현금영수증 (선택) · 휴대폰 번호
                  <input value={receipt} onChange={(e) => setReceipt(e.target.value.replace(/[^0-9-]/g, ""))} inputMode="numeric" placeholder="010-0000-0000" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] font-normal outline-none focus:border-sm-navy" />
                </label>
              </div>

              {/* ③ 입금했어요 */}
              <div>
                <p className="text-[13px] font-extrabold text-sm-navy">③ 입금을 마쳤으면 눌러주세요</p>
                <label className="mt-2 flex items-center gap-2 text-[13.5px] text-gray-700">
                  <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-5 w-5" />
                  {price.toLocaleString()}원을 <b>{depositor || "입금자명"}</b>으로 입금했어요
                </label>
                <button onClick={submit} disabled={!paid || busy || depositor.trim().length < 2} className="mt-3 h-[52px] w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-40">
                  {busy ? "접수하는 중…" : "입금했어요"}
                </button>
                <p className="mt-2 text-center text-[12px] leading-relaxed text-gray-500">
                  입금을 확인하면 열어드려요 · 지금 누르면 <b>{eta}</b> 확인해요
                  <br />
                  (밤 12시~아침 6시 입금은 오전 8시에 한꺼번에 확인)
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}