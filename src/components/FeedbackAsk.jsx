import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { track } from "../lib/track";

/*
 * 일을 끝낸 바로 그때 한 번 묻기 — "이거 쓸 만했어?" 좋아요 / 아쉬워요 (2026-11-13)
 *   학생은 누르기만 하면 된다 · '아쉬워요'를 누를 때만 한 줄 더 (안 써도 됨)
 *   같은 것(feature + ref)은 한 번만 묻는다 · 답은 sm_rating (sql/sm_126) — 관리자는 q_feedback.sql 로 본다
 *   feature: suhaeng_done(수행평가 완성본) · tamgu_done(탐구 완성본) · diagnosis(AI 입시 방향 진단) · report_pdf(보고서 PDF)
 */
const LABEL = {
  suhaeng_done: "이 완성본 쓸 만했어?",
  tamgu_done: "이 탐구 완성본 쓸 만했어?",
  diagnosis: "이 진단 도움이 됐어?",
  report_pdf: "보고서 디자인 쓸 만했어?",
};
const WHY = ["내 과제랑 안 맞아요", "너무 흔하거나 뻔해요", "글이 어색해요", "쓰기 어렵고 헷갈려요", "오래 걸려요"];

export default function FeedbackAsk({ feature, refId = "", onClose, className = "" }) {
  const key = `sm_fb_${feature}_${refId}`;
  const [state, setState] = useState(() => {
    try { return localStorage.getItem(key) ? "done" : "ask"; } catch { return "ask"; }
  }); // ask · why · sent · done(이미 답함 — 안 보임)
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState("");

  // 다른 기기에서 이미 답했으면 안 보이게
  useEffect(() => {
    if (state !== "ask") return;
    supabase.from("sm_rating").select("id").eq("feature", feature).eq("ref", String(refId)).maybeSingle()
      .then(({ data }) => { if (data) setState("done"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, refId]);

  async function save(good, text = "") {
    try { localStorage.setItem(key, "1"); } catch { /* 넘어간다 */ }
    track(good ? `fb_good_${feature}` : `fb_bad_${feature}`);
    await supabase.from("sm_rating").upsert(
      { feature, ref: String(refId), good, note: text.slice(0, 300) || null },
      { onConflict: "user_id,feature,ref" }
    );
  }

  if (state === "done") return null;
  if (state === "sent")
    return (
      <div className={`mt-3 border border-gray-200 bg-white px-4 py-3 text-[13px] text-gray-600 ${className}`}>
        고마워요. 남겨 준 말 보고 더 좋게 고칠게요.
        {onClose && <button onClick={onClose} className="ml-2 font-bold text-gray-900 underline underline-offset-4">닫기</button>}
      </div>
    );
  return (
    <div className={`mt-3 border border-gray-200 bg-white px-4 py-3 ${className}`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13.5px] font-bold text-gray-900">{LABEL[feature] ?? "쓸 만했어?"}</p>
        {state === "ask" && (
          <>
            <button onClick={() => { save(true); setState("sent"); }} className="h-9 flex-none border border-gray-900 bg-gray-900 px-3.5 text-[13px] font-bold text-white">좋아요</button>
            <button onClick={() => setState("why")} className="h-9 flex-none border border-gray-300 bg-white px-3.5 text-[13px] font-bold text-gray-700">아쉬워요</button>
          </>
        )}
        {onClose && state === "ask" && <button onClick={onClose} aria-label="닫기" className="h-9 flex-none px-1 text-[13px] text-gray-400">닫기</button>}
      </div>
      {state === "why" && (
        <div className="mt-2.5">
          <p className="text-[12.5px] text-gray-500">뭐가 아쉬웠어? (여러 개 골라도 돼요)</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WHY.map((w) => {
              const on = picked.includes(w);
              return (
                <button key={w} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== w) : [...p, w]))}
                  className={`h-8 px-3 text-[12.5px] font-bold ${on ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-700"}`}>{w}</button>
              );
            })}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="한 줄 더 남겨도 돼요 (안 써도 돼요)"
            className="mt-2 h-10 w-full border border-gray-300 px-3 text-[13px] outline-none focus:border-gray-900" />
          <button onClick={() => { save(false, [...picked, note.trim()].filter(Boolean).join(" · ")); setState("sent"); }}
            className="mt-2 h-10 w-full bg-gray-900 text-[13.5px] font-bold text-white">보내기</button>
        </div>
      )}
    </div>
  );
}