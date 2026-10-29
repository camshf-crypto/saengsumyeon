import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { track } from "../lib/track";

/*
 * 업그레이드 팝업 — ChatGPT '플랜 업그레이드' 창처럼 화면 가운데 뜬다
 * [요금제 보기] → /pricing (요금제 화면에서 결제) · [나중에] → 닫기
 *
 * props
 *   open, onClose
 *   reason   — 왜 떴는지 (track 용 · 예: "limit", "usage50", "plan")
 *   title    — 큰 제목 (없으면 기본 문구)
 *   desc     — 제목 아래 한 줄
 */
const POINTS = [
  ["💬", "물꼬 입시 AI 무제한", "광고 없이 · 사용량 걱정 없이"],
  ["📝", "탐구 보고서 끝까지", "결과 분석 → 보고서 PDF 완성"],
  ["🎤", "면접 준비", "생기부 예상질문 · 기출 6곳 · 꼬리질문 무제한"],
  ["📅", "입시 플랜 · 학습 플랜", "매주 미션 · 학습 다이어리 · 자기주도학습법"],
];

export default function UpgradeModal({ open, onClose, reason = "", title, desc }) {
  const nav = useNavigate();
  useEffect(() => {
    if (open) track("upgrade_modal", reason);
  }, [open, reason]);
  if (!open) return null;

  function go() {
    track("upgrade_modal_go", reason);
    onClose?.();
    nav("/pricing");
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-[420px] rounded-t-3xl bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-7 shadow-2xl sm:rounded-3xl sm:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="닫기" className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[18px] text-gray-400 hover:bg-gray-100">
          ×
        </button>
        <span className="inline-block rounded-full bg-orange-50 px-2.5 py-1 text-[11.5px] font-extrabold text-sm-orange">생수면 1년 이용권</span>
        <p className="mt-3 text-[21px] font-black leading-snug text-sm-navy break-keep">{title || "물꼬를 끝까지 쓰려면 업그레이드하세요"}</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-500 break-keep">{desc || "무료는 맛보기까지예요. 이용권이면 생수면 전부가 1년 동안 열려요."}</p>

        <ul className="mt-5 grid gap-3">
          {POINTS.map(([icon, head, sub]) => (
            <li key={head} className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-[#F1F3F8] text-[17px]">{icon}</span>
              <span className="min-w-0">
                <b className="block text-[14px] font-extrabold text-gray-900">{head}</b>
                <small className="block text-[12.5px] text-gray-500">{sub}</small>
              </span>
            </li>
          ))}
        </ul>

        <button onClick={go} className="mt-6 h-[52px] w-full rounded-2xl bg-sm-navy text-[15.5px] font-extrabold text-white">
          요금제 보기 ›
        </button>
        <button onClick={onClose} className="mt-2 h-10 w-full text-[13px] font-bold text-gray-400">
          나중에
        </button>
      </div>
    </div>
  );
}