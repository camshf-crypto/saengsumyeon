import { useEffect } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 체류 시간 기록 — 탐구 준비·결과 분석·보고서 디자인 화면이 같이 쓴다
 * 실제로 보고 있던 시간만 센다
 *  - 다른 탭으로 가거나 창을 내리면 멈춤
 *  - 5분 동안 아무 입력이 없으면 멈춤 (켜 두기만 한 시간은 빼기)
 * 화면을 나가거나 탭을 바꿀 때 그동안 쌓인 시간을 log_stay로 저장한다
 * page: "prepare" | "result" | "report"
 */
const IDLE_MS = 5 * 60 * 1000;

export function useStay(page, inquiryId) {
  useEffect(() => {
    if (!inquiryId) return;
    let since = document.visibilityState === "visible" ? Date.now() : null; // 지금 재는 중이면 시작 시각
    let acc = 0; // 아직 저장 안 한 시간(ms)
    let idle = null;

    const pause = () => {
      if (since) acc += Date.now() - since;
      since = null;
    };
    const flush = () => {
      pause();
      const sec = Math.round(acc / 1000);
      acc = 0;
      if (sec < 2) return; // 스치듯 지나간 건 빼기
      supabase
        .rpc("log_stay", { p_page: page, p_inquiry: inquiryId, p_seconds: sec })
        .then(({ error }) => error && console.warn("stay log failed", error));
    };
    const resume = () => {
      if (!since && document.visibilityState === "visible") since = Date.now();
      clearTimeout(idle);
      idle = setTimeout(pause, IDLE_MS);
    };
    const onVis = () => (document.visibilityState === "visible" ? resume() : flush());

    const acts = ["pointerdown", "keydown", "wheel", "pointermove"];
    acts.forEach((a) => window.addEventListener(a, resume, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    resume();

    return () => {
      acts.forEach((a) => window.removeEventListener(a, resume));
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      clearTimeout(idle);
      flush();
    };
  }, [page, inquiryId]);
}