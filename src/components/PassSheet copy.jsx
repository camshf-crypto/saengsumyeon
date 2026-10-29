import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { BANK, PASS_BENEFITS, PASS_PRODUCTS, PLANS, PLANS_ON_SALE, hasPass, perMonth } from "../lib/pass";

/*
 * 이용권 결제 창 — 생수면의 모든 유료 기능을 이 창 하나로 결제한다
 * 요금제는 src/lib/pass.js PLANS 중 sale: true 인 것만 보인다 (지금은 1년 이용권 79,000원 · 첫해 가격)
 * (물꼬 입시 에이전트 · 꼬리질문 · 탐구팩 · 로드맵 · 흔한가 진단 — 생기부 예상질문은 따로 24,000원: interview/InterviewPay)
 * 요금제 고르기 → ① 계좌로 입금 → ② 입금자명 → '입금했어요' (rpc agent_order) → 관리자 승인 → 기간만큼 열림
 * 입금 확인 중이면 그 상태를 보여 주고, 승인되는 순간 onUnlocked 를 부른다 (실시간 + 30초마다 확인)
 *
 * props
 *   open, onClose
 *   title     — 위 작은 글씨 (예: "생기부 예상질문") · 없으면 "생수면 이용권"
 *   headline  — 큰 제목 (예: "무료 꼬리질문 5개를 다 썼어요")
 *   onUnlocked — 이용권이 열렸을 때
 *   onOrdered  — 입금 신청을 접수했을 때 (주문 정보)
 */
export default function PassSheet({ open, onClose, title, headline, onUnlocked, onOrdered }) {
  const { user, profile } = useAuth();
  const [code] = useState(() => String(Math.floor(1000 + Math.random() * 9000)));
  const [depositor, setDepositor] = useState("");
  const [done, setDone] = useState(false); // '입금을 마쳤어요' 체크
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(null); // 확인 대기 중인 이용권 주문
  const [copied, setCopied] = useState("");
  // 파는 요금제 중 '추천'이 먼저 골라져 있다 (하나뿐이면 그것)
  const [plan, setPlan] = useState(() => (PLANS_ON_SALE.find((p) => p.tag) ?? PLANS_ON_SALE[0]).k);
  const picked = PLANS_ON_SALE.find((p) => p.k === plan) ?? PLANS_ON_SALE[0];

  // 입금자명 기본값: 이름 + 4자리 번호 (같은 이름끼리 구분)
  useEffect(() => {
    const name = (profile?.name ?? user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? "").replace(/\s/g, "").slice(0, 5);
    setDepositor(`${name || "생수면"}${code}`);
  }, [profile, user, code]);

  // 창이 열리면 — 이미 이용권이 있으면 바로 열고, 아니면 확인 대기 주문을 불러온다
  useEffect(() => {
    if (!open || !user) return;
    hasPass().then((ok) => ok && onUnlocked?.());
    supabase.from("pay_orders").select("id,product,amount,depositor,created_at").in("product", PASS_PRODUCTS).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(1)
      .then(({ data }) => setPending(data?.[0] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  // 입금 확인 중이면 — 관리자가 승인하는 순간 실시간으로 받아서 연다 (예비로 30초마다 확인)
  useEffect(() => {
    if (!open || !pending || !user) return;
    const check = () => hasPass().then((ok) => ok && onUnlocked?.());
    const ch = supabase
      .channel(`pass-${user.id}-${Date.now()}`)
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

  if (!open) return null;
  const eta = new Date().getHours() < 6 ? "오늘 오전 8시에" : "2시간 안에";
  const copy = (t, k) =>
    navigator.clipboard?.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1500); }).catch(() => window.prompt("복사해 주세요", t));

  async function submit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("agent_order", { p_depositor: depositor.trim(), p_plan: picked.k });
    setBusy(false);
    if (error || !data) return setErr(error?.message?.includes("입금자명") ? "입금자명을 적어 주세요." : "신청을 접수하지 못했어요. 잠시 후 다시 해 주세요.");
    setPending(data);
    onOrdered?.(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-sm-orange">{title || "생수면 이용권"}</p>
            <p className="mt-1 text-[19px] font-extrabold leading-snug text-sm-navy">{headline || "1년 이용권 하나로 생수면 전부 열기"}</p>
          </div>
          <button onClick={onClose} className="text-[24px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>

        {/* 요금제 고르기 */}
        <div className="mt-4 grid gap-2">
          {PLANS_ON_SALE.map((p) => (
            <button
              key={p.k}
              type="button"
              onClick={() => setPlan(p.k)}
              disabled={Boolean(pending)}
              className={`relative flex items-center justify-between rounded-2xl border-2 px-4 py-3 text-left ${plan === p.k ? "border-sm-navy bg-indigo-50/60" : "border-gray-200"} disabled:opacity-60`}
            >
              {p.tag && <span className="absolute -top-2 right-3 rounded-full bg-sm-orange px-2 py-0.5 text-[10.5px] font-bold text-white">{p.tag}</span>}
              <span className="flex items-center gap-2.5">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${plan === p.k ? "border-sm-navy" : "border-gray-300"}`}>
                  {plan === p.k && <i className="h-2 w-2 rounded-full bg-sm-navy" />}
                </span>
                <span>
                  <b className="block text-[14.5px] font-extrabold text-sm-navy">{p.label}</b>
                  <small className="text-[11.5px] text-gray-500">{p.days === 30 ? "30일" : p.days === 365 ? "1년 · 한 달 약 6,600원" : `한 달 약 ${perMonth(p).toLocaleString()}원`}</small>
                </span>
              </span>
              <b className="text-[18px] font-black text-sm-navy">{p.price.toLocaleString()}원</b>
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-[#F8F9FB] p-3.5">
          <p className="text-[12.5px] font-bold text-gray-700">1년 동안 전부 열려요</p>
          <ul className="mt-1.5 grid gap-1">
            {PASS_BENEFITS.map((t) => (
              <li key={t} className="flex items-start gap-2 text-[12.5px] text-gray-600">
                <span className="mt-[2px] text-[10px] font-black text-sm-navy">✓</span>
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-gray-400">승인된 날부터 1년 · 자동으로 다시 결제되지 않아요</p>
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

        {pending ? (
          <div className="mt-4 rounded-2xl bg-orange-50 p-5 text-center">
            <p className="text-[16px] font-extrabold text-orange-800">입금 확인 중이에요</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-orange-900">
              {PLANS.find((p) => p.k === pending.product)?.label ?? "이용권"} · {pending.depositor} · {Number(pending.amount ?? picked.price).toLocaleString()}원
              <br />
              <b>{eta}</b> 확인하고 열어 드려요.
            </p>
            <p className="mt-2 text-[12px] text-orange-700">밤 12시~아침 6시 입금은 오전 8시에 한꺼번에 확인해요. 확인되면 저절로 열려요.</p>
            <button onClick={onClose} className="mt-4 h-11 w-full rounded-xl bg-sm-navy text-[14px] font-bold text-white">확인</button>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl bg-[#F8F9FB] p-4 text-[13.5px]">
            <p className="flex items-baseline justify-between font-bold text-gray-800">
              ① 아래 계좌로 입금
              <b className="text-[16px] text-sm-orange">{picked.price.toLocaleString()}원</b>
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-gray-700">
                {BANK.name} <b>{BANK.number}</b>
                <br />
                <span className="text-[12px] text-gray-500">예금주 {BANK.holder}</span>
              </p>
              <button onClick={() => copy(BANK.number.replace(/-/g, ""), "bank")} className="shrink-0 rounded-md border border-sm-navy px-2.5 py-1 text-[12px] font-bold text-sm-navy">
                {copied === "bank" ? "복사됨" : "복사"}
              </button>
            </div>
            <p className="mt-4 font-bold text-gray-800">② 입금자명 <span className="font-normal text-sm-orange">꼭 이대로 보내 주세요</span></p>
            <input
              value={depositor}
              onChange={(e) => setDepositor(e.target.value.slice(0, 20))}
              className="mt-2 h-11 w-full rounded-xl border-2 border-sm-orange px-3 text-[15px] font-extrabold text-sm-navy outline-none"
            />
            <p className="mt-1 text-[11.5px] text-gray-500">부모님이 입금해도 괜찮아요. 입금자명만 똑같이 적어 주세요.</p>
            <label className="mt-4 flex items-center gap-2 font-bold text-gray-800">
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="h-4 w-4" />
              {picked.label} {picked.price.toLocaleString()}원을 입금했어요
            </label>
            <button
              onClick={submit}
              disabled={!done || busy || depositor.trim().length < 2}
              className="mt-3 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-40"
            >
              {busy ? "접수 중…" : "입금했어요"}
            </button>
            <p className="mt-2 text-center text-[11.5px] text-gray-400">확인되면 {eta} 열려요 · 마이페이지에서도 볼 수 있어요</p>
          </div>
        )}
      </div>
    </div>
  );
}