import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

/*
 * 생수면 3문항 설문 팝업 (App 에 한 번만 둔다)
 * · 회원이 2일째 들어오면 한 번 뜬다 · 전부 누르기만 (직접 쓰기는 '기타'를 눌렀을 때만)
 * · 고3은 '대학생 되면' 질문을 먼저
 * · '나중에'를 누르면 3일 뒤에 다시 · 끝내면 조각 +2
 */
const Q1 = ["수행평가 도와주기", "내신 공부법", "대학 · 학과 정보", "선배 생기부 더 보기", "면접 연습", "같이 공부 인증", "진로 · 직업 알아보기", "기타"];
const Q2 = ["뭘 해야 할지 모르겠어", "매일 올 이유가 없어", "화면이 불편해", "정보가 부족해", "딱히 없어", "기타"];
const Q3 = ["가고 싶은 기업 · 직무 준비", "학과 선배랑 이야기", "대외활동 · 공모전", "자소서 · 면접", "과제 · 학점 관리", "대학생 커뮤니티", "안 쓸 것 같아", "기타"];
const SNOOZE = "sm_survey_later";
const SKIP_PATHS = ["/admin", "/signup", "/login", "/auth", "/inquiry/"];

const QUESTIONS = {
  q1: { title: "생수면에 이런 게 있으면 좋겠어", hint: "여러 개 골라도 돼", opts: Q1, multi: true },
  q2: { title: "지금 생수면에서 제일 아쉬운 건?", hint: "하나만 골라 줘", opts: Q2, multi: false },
  q3: { title: "대학생이 되면, 생수면에 이게 있으면 계속 쓸 거야", hint: "여러 개 골라도 돼", opts: Q3, multi: true },
};

export default function SurveyPopup() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(["q1", "q2", "q3"]);
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState({ q1: [], q2: [], q3: [] });
  const [etc, setEtc] = useState({ q1: "", q2: "", q3: "" });
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // 받은 조각 수

  useEffect(() => {
    if (!uid || SKIP_PATHS.some((p) => pathname.startsWith(p))) return;
    if (!user?.user_metadata?.school) return; // 학교 입력 팝업(SchoolGate)과 겹치지 않게 — 학교를 넣은 뒤에 뜬다
    try {
      if (Number(localStorage.getItem(SNOOZE) || 0) > Date.now()) return;
    } catch {
      /* 저장소를 못 쓰면 그냥 확인 */
    }
    let alive = true;
    // 다른 팝업(레벨업 등)과 겹치지 않게 조금 늦게
    const t = setTimeout(() => {
      supabase.rpc("survey_status").then(({ data }) => {
        if (!alive || !data?.show) return;
        if (data.grade === "고3") setOrder(["q3", "q1", "q2"]);
        setOpen(true);
      });
    }, 4000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [uid, user?.user_metadata?.school]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const key = order[step];
  const Q = QUESTIONS[key];
  const chosen = pick[key];
  const last = step === order.length - 1;
  const ok = chosen.length > 0 && (!chosen.includes("기타") || etc[key].trim());

  function toggle(o) {
    setPick((p) => {
      if (!Q.multi) return { ...p, [key]: [o] };
      const has = p[key].includes(o);
      return { ...p, [key]: has ? p[key].filter((x) => x !== o) : [...p[key], o] };
    });
  }

  function later() {
    try {
      localStorage.setItem(SNOOZE, String(Date.now() + 3 * 86400000));
    } catch {
      /* 못 쓰면 다음에 또 뜬다 */
    }
    setOpen(false);
  }

  async function submit() {
    setBusy(true);
    const { data, error } = await supabase.rpc("survey_submit", {
      p_q1: pick.q1,
      p_q1_etc: etc.q1 || null,
      p_q2: pick.q2[0] ?? null,
      p_q2_etc: etc.q2 || null,
      p_q3: pick.q3,
      p_q3_etc: etc.q3 || null,
      p_memo: memo || null,
    });
    setBusy(false);
    if (error) return window.alert(error.message);
    setDone(Number(data?.piece ?? 0));
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/45 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-5 pb-6 pt-5 sm:rounded-3xl">
        {done !== null ? (
          <div className="py-6 text-center">
            <p className="text-[40px]">💧</p>
            <p className="mt-2 text-[19px] font-extrabold text-sm-navy">고마워! 꼭 반영할게</p>
            <p className="mt-1 text-[13.5px] text-gray-500">
              {done > 0 ? `조각 +${done} 줬어 · ` : ""}의견함에서 다른 친구들 의견에도 '나도 원해'를 눌러 봐
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setOpen(false)} className="h-12 rounded-xl border border-gray-300 text-[14.5px] font-bold text-gray-600">
                닫기
              </button>
              <Link to="/voice" onClick={() => setOpen(false)} className="flex h-12 items-center justify-center rounded-xl bg-sm-navy text-[14.5px] font-bold text-white">
                의견함 가기
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-[12.5px] font-bold text-sm-orange">생수면이 물어볼게 · 10초면 끝 · 조각 +2</p>
              <button onClick={later} className="ml-auto px-1 text-[12.5px] text-gray-400">
                나중에
              </button>
            </div>
            {/* 진행 */}
            <div className="mt-3 grid grid-cols-3 gap-1">
              {order.map((k, i) => (
                <span key={k} className={`h-1.5 rounded-full ${i <= step ? "bg-sm-navy" : "bg-gray-200"}`} />
              ))}
            </div>

            <h2 className="mt-4 text-[19px] font-extrabold leading-snug text-sm-navy">{Q.title}</h2>
            <p className="mt-0.5 text-[12.5px] text-gray-400">{Q.hint}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {Q.opts.map((o) => {
                const on = chosen.includes(o);
                return (
                  <button
                    key={o}
                    onClick={() => toggle(o)}
                    className={`rounded-full px-4 py-2.5 text-[14px] font-bold transition ${on ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>

            {chosen.includes("기타") && (
              <input
                value={etc[key]}
                onChange={(e) => setEtc((x) => ({ ...x, [key]: e.target.value.slice(0, 100) }))}
                autoFocus
                placeholder="뭐가 있으면 좋겠어? 짧게 써 줘"
                className="mt-3 h-11 w-full rounded-xl border border-gray-300 px-4 text-[14px] outline-none focus:border-sm-navy"
              />
            )}

            {last && (
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value.slice(0, 300))}
                placeholder="더 하고 싶은 말 (안 써도 돼)"
                className="mt-4 h-11 w-full rounded-xl border border-dashed border-gray-300 px-4 text-[13.5px] outline-none focus:border-sm-navy"
              />
            )}

            <div className="mt-5 grid grid-cols-[1fr_2fr] gap-2">
              <button
                onClick={() => (step ? setStep(step - 1) : later())}
                className="h-12 rounded-xl border border-gray-300 text-[14.5px] font-bold text-gray-500"
              >
                {step ? "이전" : "나중에"}
              </button>
              <button
                disabled={!ok || busy}
                onClick={() => (last ? submit() : setStep(step + 1))}
                className="h-12 rounded-xl bg-sm-navy text-[14.5px] font-bold text-white disabled:opacity-40"
              >
                {busy ? "보내는 중…" : last ? "보내고 조각 받기" : "다음"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}