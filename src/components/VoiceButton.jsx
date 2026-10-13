import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/*
 * 📮 생수면 우체통 — 화면 오른쪽 아래에 떠 있는 의견함 버튼 (App 에 한 번만 둔다)
 * · 누르면 작은 창: [불편해요] [이런 기능 원해요] → 의견함으로 (보던 화면 주소를 같이 넘긴다)
 * · 하루에 한 번, 들어오고 3초 뒤 말풍선을 8초 동안 보여준다 (문구는 날마다 바뀜 · 말풍선을 눌러도 열린다)
 * · 옥상에서 외쳐!(나도 외치기 버튼이 있음) · 의견함 · 관리자 · 로그인/가입 · 탐구보고서 작업 화면에서는 숨긴다
 */
const HIDE = ["/board", "/voice", "/admin", "/login", "/signup", "/auth", "/inquiry/"];
const SEEN = "sm_voice_tip"; // 마지막으로 말풍선을 보여준 날
const TIPS = [
  "불편한 점 있어? 여기다 넣어 줘",
  "이런 기능 있으면 좋겠다? 말만 해",
  "생수면한테 하고 싶은 말, 여기로!",
  "써 보니 별로인 거 있어? 알려 줘",
];
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export default function VoiceButton() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const msg = TIPS[new Date().getDate() % TIPS.length];

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN) === today()) return undefined;
      localStorage.setItem(SEEN, today());
    } catch {
      return undefined;
    }
    const a = setTimeout(() => setTip(true), 3000);
    const b = setTimeout(() => setTip(false), 11000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  if (HIDE.some((p) => pathname.startsWith(p))) return null;

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
        <button
          onClick={() => {
            setOpen(true);
            setTip(false);
          }}
          className="rounded-xl bg-sm-navy px-3 py-2 text-[12.5px] font-bold text-white shadow-lg"
        >
          {msg}
        </button>
      )}
      <button
        onClick={() => {
          setOpen((v) => !v);
          setTip(false);
        }}
        aria-label="생수면 우체통 (의견함)"
        className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white text-[24px] shadow-[0_8px_20px_rgba(20,27,61,.18)] ring-1 ring-gray-200 transition hover:-translate-y-0.5"
      >
        {open ? <span className="text-[20px] text-gray-500">✕</span> : "📮"}
      </button>
    </div>
  );
}