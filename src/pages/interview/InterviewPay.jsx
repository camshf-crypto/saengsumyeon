import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import { BANK } from "../../lib/pass";

/*
 * 생기부 예상질문 결제 창 — 24,000원 (상품 interview6 · 대학 6곳까지, 대학마다 질문 따로)
 * 이용권(한 달 12,900원)과 따로 판다 — 이용권으로는 열리지 않는다
 * ① 계좌로 입금 (입금자명 자동) → ② '입금했어요' (서버 함수 order) → 관리자 승인 → interview_access 가 생기면 열림
 * 결제하면 나온 질문마다 5단계 학습(답변 → AI 피드백 → 2차 → 최종 → 꼬리질문)도 열린다
 * 금액을 바꾸면 서버 함수 supabase/functions/order 의 금액도 같이 바꿔야 한다
 */
const PRODUCT = { k: "interview6", label: "생기부 예상질문 · 수시 6곳", price: 24000 };
const PERKS = ["고1~고3 활동마다 예상 질문 1개", "대학 6곳까지 · 대학마다 질문 따로", "질문마다 답변 → AI 피드백 → 꼬리질문 연습", "대학별 PDF 저장"];

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => window.prompt("복사해 주세요", text))}
      className="shrink-0 rounded-md border border-sm-navy px-2.5 py-1 text-[12px] font-bold text-sm-navy"
    >
      {done ? "복사됨" : "복사"}
    </button>
  );
}

export default function InterviewPay({ open, onClose, onUnlocked }) {
  const { user, profile } = useAuth();
  const [depositor, setDepositor] = useState("");
  const [receipt, setReceipt] = useState("");
  const [sent, setSent] = useState(false); // '입금을 마쳤어요' 체크
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(null); // 확인 대기 중인 주문
  const [checking, setChecking] = useState(true);

  // 입금자명 기본값: 이름 + 4자리 번호 (같은 이름끼리 구분)
  const code = useMemo(() => String(Math.floor(1000 + Math.random() * 9000)), []);
  useEffect(() => {
    const name = (profile?.name ?? user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? "").replace(/\s/g, "").slice(0, 5);
    setDepositor(`${name || "생수면"}${code}`);
  }, [profile, user, code]);

  const isOpen = () => supabase.from("interview_access").select("user_id").maybeSingle().then(({ data }) => Boolean(data));

  // 창이 열리면 — 이미 결제됐으면 바로 열고, 아니면 확인 대기 주문을 불러온다
  useEffect(() => {
    if (!open || !user) return;
    setChecking(true);
    track("paywall_view", "interview");
    isOpen().then((ok) => {
      if (ok) return onUnlocked?.();
      supabase.from("pay_orders").select("*").eq("status", "pending").in("product", ["interview", "interview6"])
        .order("created_at", { ascending: false }).limit(1)
        .then(({ data }) => { setPending(data?.[0] ?? null); setChecking(false); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  // 입금 확인 중이면 — 관리자가 승인하는 순간 실시간으로 받아서 연다 (예비로 30초마다 확인)
  useEffect(() => {
    if (!open || !pending || !user) return;
    const check = () => isOpen().then((ok) => ok && onUnlocked?.());
    const ch = supabase
      .channel(`interview-order-${user.id}-${Date.now()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pay_orders", filter: `user_id=eq.${user.id}` }, (e) => {
        if (e.new?.status === "approved") check();
      })
      .subscribe();
    const t = setInterval(() => document.visibilityState === "visible" && check(), 30000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending, user]);

  if (!open || checking) return null;
  const eta = new Date().getHours() < 6 ? "오늘 오전 8시에" : "2시간 안에";

  async function submit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.functions.invoke("order", {
      body: { product: PRODUCT.k, depositor: depositor.trim(), receipt: receipt.trim() || null, inquiry_id: null },
    });
    setBusy(false);
    if (error || data?.error) {
      let m = data?.error;
      try { m = m ?? (await error?.context?.json?.())?.error; } catch { /* 무시 */ }
      return setErr(m ?? "주문을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    track("order_submit", PRODUCT.k);
    setPending({ product: PRODUCT.k, amount: PRODUCT.price, depositor: depositor.trim(), created_at: new Date().toISOString(), eta: data?.eta });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[12px] font-bold text-sm-orange">생기부 예상질문</p>
            <p className="mt-1 text-[19px] font-extrabold text-sm-navy">내 생기부로 면접 예상 질문 뽑기</p>
          </div>
          <button onClick={onClose} className="text-[22px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>

        <div className="mt-4 rounded-xl border-2 border-sm-navy bg-indigo-50 p-4">
          <div className="flex items-baseline justify-between">
            <b className="text-[14.5px] font-extrabold text-sm-navy">{PRODUCT.label}</b>
            <b className="text-[20px] font-black text-sm-navy">{PRODUCT.price.toLocaleString()}원</b>
          </div>
          <ul className="mt-2 grid gap-1">{PERKS.map((t) => <li key={t} className="text-[13px] text-gray-700">✓ {t}</li>)}</ul>
        </div>

        {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

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
          <div className="mt-5 space-y-5">
            <div>
              <p className="text-[13px] font-extrabold text-sm-navy">① 이 계좌로 입금해 주세요</p>
              <div className="mt-2 space-y-2 rounded-xl bg-gray-50 p-4 text-[13.5px]">
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">은행</span><b className="text-sm-navy">{BANK.name}</b></div>
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">계좌번호</span><span className="flex items-center gap-2"><b className="text-sm-navy">{BANK.number}</b><Copy text={BANK.number.replace(/-/g, "")} /></span></div>
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">예금주</span><b className="text-sm-navy">{BANK.holder}</b></div>
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">금액</span><b className="text-[16px] text-sm-orange">{PRODUCT.price.toLocaleString()}원</b></div>
              </div>
              <label className="mt-3 block text-[13px] font-bold text-sm-navy">
                입금자명 <span className="font-normal text-sm-orange">꼭 이대로 입금해 주세요</span>
                <div className="mt-1 flex gap-2">
                  <input value={depositor} onChange={(e) => setDepositor(e.target.value)} className="w-full rounded-lg border-2 border-sm-orange px-3 py-2 text-[16px] font-extrabold text-sm-navy outline-none" />
                  <Copy text={depositor} />
                </div>
              </label>
              <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">부모님이 입금해도 괜찮아요. 입금자명만 똑같이 적어 주세요.</p>
              <label className="mt-3 block text-[12.5px] font-bold text-gray-600">
                현금영수증 (선택) · 휴대폰 번호
                <input value={receipt} onChange={(e) => setReceipt(e.target.value.replace(/[^0-9-]/g, ""))} inputMode="numeric" placeholder="010-0000-0000" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] font-normal outline-none focus:border-sm-navy" />
              </label>
            </div>

            <div>
              <p className="text-[13px] font-extrabold text-sm-navy">② 입금을 마쳤으면 눌러주세요</p>
              <label className="mt-2 flex items-center gap-2 text-[13.5px] text-gray-700">
                <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} className="h-5 w-5" />
                {PRODUCT.price.toLocaleString()}원을 <b>{depositor || "입금자명"}</b>으로 입금했어요
              </label>
              <button onClick={submit} disabled={!sent || busy || depositor.trim().length < 2} className="mt-3 h-[52px] w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-40">
                {busy ? "접수하는 중…" : "입금했어요"}
              </button>
              <p className="mt-2 text-center text-[12px] leading-relaxed text-gray-500">
                입금을 확인하면 열어드려요 · 지금 누르면 <b>{eta}</b> 확인해요
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}