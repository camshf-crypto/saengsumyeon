import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/*
 * 오픈 안내 팝업 — 메인(/)에 들어오면 한 번 뜬다
 * '오늘 하루 보지 않기'를 누르면 그날은 다시 안 뜬다 (이 브라우저 기준)
 * 안내를 바꿔서 다시 모두에게 보여주려면 KEY 뒤 날짜를 바꾼다
 */

const KEY = "launch-popup-inquiry-2026-09";

function hiddenToday() {
  try {
    return localStorage.getItem(KEY) === new Date().toDateString();
  } catch {
    return false;
  }
}

export default function LaunchPopup() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  // 첫 화면이 그려진 뒤 살짝 늦게 띄운다
  useEffect(() => {
    if (hiddenToday()) return;
    const t = setTimeout(() => setOpen(true), 400);
    return () => clearTimeout(t);
  }, []);

  // Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function hideToday() {
    try {
      localStorage.setItem(KEY, new Date().toDateString());
    } catch {
      // 저장이 막힌 브라우저면 이번만 닫는다
    }
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-title"
        className="w-full max-w-[400px] overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 위 — 남색 띠 */}
        <div className="relative bg-sm-navy px-7 pb-7 pt-8 text-white">
          <button onClick={() => setOpen(false)} className="absolute right-4 top-3 text-[26px] leading-none text-indigo-200 hover:text-white" aria-label="닫기">
            ×
          </button>
          <span className="inline-block rounded-full bg-sm-orange px-3 py-1 text-[12px] font-extrabold"></span>
          <p id="launch-title" className="mt-3 text-[26px] font-black leading-tight">
            기억에 남는
            <br />
            탐구보고서
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-indigo-100">
            흔한 주제로 흔한 보고서를 쓰면
            <br />
            선생님 기억에 남지 않아요.
          </p>
        </div>

        {/* 아래 — 네 단계 · 가격 · 버튼 */}
        <div className="px-7 pb-6 pt-6">
          <ol className="space-y-2.5">
            {[
              ["주제 진단", "내 주제를 상위 1% 주제로"],
              ["탐구 준비", "AI가 탐구 방법·자료까지"],
              ["결과 분석", "비교표와 기억에 남는 한 문장"],
              ["보고서 디자인", "30가지 디자인으로 PDF까지"],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[12px] font-extrabold text-sm-navy">{i + 1}</span>
                <p className="text-[14px]">
                  <b className="text-sm-navy">{t}</b> <span className="text-gray-500">· {d}</span>
                </p>
              </li>
            ))}
          </ol>

          <button
            onClick={() => {
              setOpen(false);
              nav("/inquiry");
            }}
            className="mt-6 h-[52px] w-full rounded-xl bg-sm-navy text-[16px] font-extrabold text-white"
          >
            탐구보고서 만들러 가기
          </button>
          <div className="mt-3 flex justify-between text-[12.5px] text-gray-400">
            <button onClick={hideToday} className="hover:text-gray-600">오늘 하루 보지 않기</button>
            <button onClick={() => setOpen(false)} className="hover:text-gray-600">닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}