import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/*
 * 📮 생수면 우체통 — 화면 오른쪽 아래에 떠 있는 의견함 버튼 (App 에 한 번만 둔다)
 * · 누르면 작은 창: [불편해요] [이런 기능 원해요] → 의견함으로 (보던 화면 주소를 같이 넘긴다)
 * · 말풍선 문구는 늘 떠 있다 (문구는 날마다 바뀜 · 눌러도 열린다 · ✕ 누르면 이번 방문 동안만 숨김)
 * · 옥상에서 외쳐!(나도 외치기 버튼이 있음) · 의견함 · 관리자 · 로그인/가입 · 탐구보고서 작업 화면에서는 숨긴다
 */
const HIDE = ["/board", "/voice", "/admin", "/login", "/signup", "/auth", "/inquiry/"];
const OFF = "sm_voice_tip_off"; // 말풍선 ✕ 누름 (창을 닫으면 다시 보인다)
const TIPS = [
  "불편한 점 있어? 여기다 넣어 줘",
  "이런 기능 있으면 좋겠다? 말만 해",
  "생수면한테 하고 싶은 말, 여기로!",
  "써 보니 별로인 거 있어? 알려 줘",
];

export default function VoiceButton() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(() => {
    try {
      return !sessionStorage.getItem(OFF);
    } catch {
      return true;
    }
  });
  const closeTip = () => {
    setTip(false);
    try {
      sessionStorage.setItem(OFF, "1");
    } catch {
      /* 못 적어도 괜찮다 */
    }
  };
  const msg = TIPS[new Date().getDate() % TIPS.length];

  useEffect(() => setOpen(false), [pathname]);
  const hidden = HIDE.some((p) => pathname.startsWith(p));


  if (hidden) return null;

  const go = (tab) => nav(tab === "fix" ? "/voice?tab=fix" : "/voice", { state: { from: pathname } });

  return (
    <div className="fixed bottom-5 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {open && (
        <div className="w-56 overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgba(20,27,61,.2)] ring-1 ring-gray-200">
          <p className="px-4 pb-1 pt-3 text-[12px] font-bold text-gray-500">생수면 우체통</p>
          <button onClick={() => go("fix")} className="block w-full px-4 py-3 text-left hover:bg-[#F4F5F7]">
            <b className="block text-[14px] text-sm-navy">😣 불편해요</b>
            <small className="text-[12px] text-gray-500">이 화면에서 불편한 점 알려주기</small>
          </button>
          <button onClick={() => go("idea")} className="block w-full border-t border-gray-100 px-4 py-3 text-left hover:bg-[#F4F5F7]">
            <b className="block text-[14px] text-sm-navy">💡 이런 기능 원해요</b>
            <small className="text-[12px] text-gray-500">원하는 기능에 나도 원해</small>
          </button>
        </div>
      )}
      {tip && !open && (
        <div className="flex items-center rounded-xl bg-sm-navy text-white shadow-lg">
          <button onClick={() => setOpen(true)} className="py-2 pl-3 pr-1 text-[12.5px] font-bold">
            {msg}
          </button>
          <button onClick={closeTip} aria-label="말풍선 닫기" className="px-2 py-2 text-[12px] text-white/60 hover:text-white">
            ✕
          </button>
        </div>
      )}
      <button
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-label="생수면 우체통 (의견함)"
        className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white text-[24px] shadow-[0_8px_20px_rgba(20,27,61,.18)] ring-1 ring-gray-200 transition hover:-translate-y-0.5"
      >
        {open ? <span className="text-[20px] text-gray-500">✕</span> : "📮"}
      </button>
    </div>
  );
}