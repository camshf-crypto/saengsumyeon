import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import { hasPass } from "../../lib/pass";
import PassSheet from "../../components/PassSheet";

/*
 * 결제 팝업 — 탐구 준비·결과 분석·보고서 화면, 그리고 생기부 예상질문(kind="interview") 화면이 같이 쓴다
 * 이제 상품은 생수면 이용권 하나 — 한 달 12,900원 · 6개월 59,900원 · 1년 99,900원 (components/PassSheet). 이용권이 있으면 모두 열린다
 * 예전에 산 탐구 이용권(credits)이 남아 있으면 그걸로 이 탐구를 바로 열 수 있다
 */
export default function Paywall({ open, onClose, inquiryId, reason, onUnlocked, kind = "inquiry" }) {
  const { user } = useAuth();
  const isInterview = kind === "interview";
  const [checking, setChecking] = useState(true); // 이미 열렸는지 확인 중
  const [balance, setBalance] = useState(0); // 예전에 산 탐구 이용권
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 이용권으로 열린 경우 — 탐구 화면은 이용권 여부를 처음 열 때 읽으므로 새로 불러온다
  // (서버가 아직 이용권을 모르면 같은 화면이 다시 막히므로 한 번만 새로 부른다)
  const passOpened = () => {
    if (isInterview) return onUnlocked?.();
    let again = false;
    try {
      again = Date.now() - Number(sessionStorage.getItem("sm_pass_reload") || 0) < 15000;
      sessionStorage.setItem("sm_pass_reload", String(Date.now()));
    } catch {
      again = true;
    }
    if (again) return onUnlocked?.();
    window.location.reload();
  };

  // 팝업이 뜨기 전에 — 이미 열렸으면(예전 결제 · 이용권) 팝업 없이 바로 연다
  useEffect(() => {
    if (!open || !user) return;
    setChecking(true);
    track("paywall_view", reason ?? kind);
    (async () => {
      if (await hasPass()) return passOpened();
      if (isInterview) {
        const { data } = await supabase.from("interview_access").select("user_id").maybeSingle();
        if (data) return onUnlocked?.();
      } else if (inquiryId) {
        const { data } = await supabase.from("inquiries").select("paid").eq("id", inquiryId).maybeSingle();
        if (data?.paid) return onUnlocked?.();
        const { data: cr } = await supabase.from("credits").select("balance").maybeSingle();
        setBalance(cr?.balance ?? 0);
      }
      setChecking(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, inquiryId]);

  if (!open || checking) return null;

  // 예전 이용권으로 바로 열기
  async function useCredit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("unlock_inquiry", { p_inquiry: inquiryId });
    setBusy(false);
    if (error || !data) return setErr("이용권으로 열지 못했어요. 다시 시도해 주세요.");
    onUnlocked?.();
  }

  if (balance > 0 && inquiryId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
          <p className="text-[17px] font-extrabold text-sm-navy">남은 탐구 이용권 {balance}개</p>
          <p className="mt-1 text-[13px] text-gray-500">예전에 산 이용권으로 이 탐구를 열 수 있어요.</p>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}
          <button onClick={useCredit} disabled={busy} className="mt-4 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-50">
            이용권 1개로 이 탐구 열기
          </button>
          <button onClick={onClose} className="mt-2 h-10 w-full text-[13px] font-semibold text-gray-500">닫기</button>
        </div>
      </div>
    );
  }

  const headline = isInterview
    ? "내 생기부로 대학별 면접 예상질문 뽑기"
    : reason === "start" ? "무료 탐구 1건을 다 썼어요" : reason === "pdf" ? "이 보고서를 PDF로 저장하려면" : "탐구를 끝까지 이어가려면";

  return (
    <PassSheet
      open
      onClose={onClose}
      title={isInterview ? "생기부 예상질문" : "탐구팩"}
      headline={headline}
      onUnlocked={passOpened}
      onOrdered={() => track("order_submit", "agent30")}
    />
  );
}