import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/*
 * 📮 생수면 우체통 — 화면 오른쪽 아래에 떠 있는 의견함 버튼 (App 에 한 번만 둔다)
 * · 누르면 작은 창: [불편해요] [이런 기능 원해요] → 의견함으로 (보던 화면 주소를 같이 넘긴다)
 * · 생수면에 들어올 때마다(창을 새로 열 때마다) 3초 뒤 말풍선을 8초 동안 보여준다 (문구는 날마다 바뀜 · 말풍선을 눌러도 열린다)
 * · 옥상에서 외쳐!(나도 외치기 버튼이 있음) · 의견함 · 관리자 · 로그인/가입 · 탐구보고서 작업 화면에서는 숨긴다
 */
const HIDE = ["/board", "/voice", "/admin", "/login", "/signup", "/auth", "/inquiry/"];
const SEEN = "sm_voice_tip2"; // 이번에 들어와서 말풍선을 이미 보여줬는지 (창을 닫으면 지워짐)
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
  const [tip, setTip] = useState(false);
  const msg = TIPS[new Date().getDate() % TIPS.length];

  useEffect(() => setOpen(false), [pathname]);
  const hidden = HIDE.some((p) => pathname.startsWith(p));

  // 들어올 때마다 한 번 말풍선 — 실제로 보여줄 때 '봤다'고 적는다 (숨는 화면에서는 아낀다)
  useEffect(() => {
    if (hidden) return undefined;
    try {
      if (sessionStorage.getItem(SEEN)) return undefined;
    } catch {
      /* 저장소를 못 쓰면 그냥 보여준다 */
    }
    const a = setTimeout(() => {
      setTip(true);
      try {
        sessionStorage.setItem(SEEN, "1");
      } catch {
        /* 못 적어도 괜찮다 */
      }
    }, 3000);
    const b = setTimeout(() => setTip(false), 11000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [hidden]);

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