import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

/*
 * 합격 생기부 조각 알림 — 사이트 어디서든
 * · 하루 한 번 출석 조각 (sb_checkin)
 * · 화면을 옮기거나, 다른 화면이 'sb:check' 를 알리면 새로 받은 조각이 있는지 확인해서
 *   "조각 +1 받았어! · 나만 그래? 댓글" 알림을 아래에 띄운다
 * 다른 화면에서 알리는 법:  window.dispatchEvent(new Event(SB_CHECK))
 */
export const SB_CHECK = "sb:check";
const SEEN_KEY = "sb_seen_at"; // 마지막으로 확인한 서버 시각
const DAY_KEY = "sb_checkin_day"; // 출석을 부른 날 (한국 날짜)
const MISSION_KEY = "sb_mission"; // 합격 생기부에서 [하러 가기]로 온 미션 (Sb.jsx 와 같은 이름)

const kstDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 저장이 막혀도 괜찮다 */
  }
};

export default function SbNotice() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [note, setNote] = useState(null); // { total, titles, big }
  const timer = useRef(null);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (!user || busy.current) return;
    busy.current = true;
    try {
      // 하루 한 번 출석
      if (read(DAY_KEY) !== kstDay()) {
        await supabase.rpc("sb_checkin");
        write(DAY_KEY, kstDay());
      }
      const since = read(SEEN_KEY);
      const { data, error } = await supabase.rpc("sb_recent", { p_since: since || null });
      if (error || !data) return;
      write(SEEN_KEY, data.now);
      const got = data.earned ?? [];
      // 처음 확인하는 브라우저는 예전 기록을 알리지 않는다
      if (since && got.length) {
        const total = got.reduce((a, x) => a + Number(x.amount ?? 0), 0);
        const titles = [...new Set(got.map((x) => x.title))].join(" · ");
        let big = false;
        try {
          big = !!sessionStorage.getItem(MISSION_KEY); // 퍼즐에서 미션 하러 온 길이면 큰 팝업
        } catch {
          big = false;
        }
        setNote({ total, titles, balance: data.balance, big });
        clearTimeout(timer.current);
        if (!big) timer.current = setTimeout(() => setNote(null), 5000);
      }
    } finally {
      busy.current = false;
    }
  }, [user]);

  // 로그인했을 때 · 화면을 옮길 때
  useEffect(() => {
    check();
  }, [check, pathname]);

  // 퍼즐에서 [하러 가기]로 온 동안에는 화면이 안 바뀌어도(진단 결과가 같은 화면에 뜨는 경우) 8초마다 확인
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      let on = false;
      try {
        on = !!sessionStorage.getItem(MISSION_KEY);
      } catch {
        on = false;
      }
      if (on && document.visibilityState === "visible") check();
    }, 8000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, check]);

  // 다른 화면이 알릴 때 (나만 그래? 답·댓글 등) — 서버가 지급할 시간을 조금 기다린다
  useEffect(() => {
    const on = () => setTimeout(check, 400);
    window.addEventListener(SB_CHECK, on);
    return () => window.removeEventListener(SB_CHECK, on);
  }, [check]);

  // 합격 생기부 화면에서는 위쪽 조각 숫자로 충분하다
  if (!note || pathname.startsWith("/sb")) return null;

  const clearMission = () => {
    try {
      sessionStorage.removeItem(MISSION_KEY);
    } catch {
      /* 괜찮다 */
    }
  };

  // 퍼즐에서 [하러 가기]로 와서 미션을 끝낸 경우 — 크게 알리고 퍼즐로 돌아가기
  if (note.big) {
    return (
      <>
        <div className="fixed inset-0 z-50 bg-black/45" onClick={() => setNote(null)} />
        <section className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-40px)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white px-5 py-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-50">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C2410C" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l7 4v10l-7 4-7-4V7z" />
            </svg>
          </span>
          <p className="mt-3 text-[13px] font-bold text-[#C2410C]">미션 완료!</p>
          <h2 className="mt-1 text-[21px] font-black text-sm-navy">합격 생기부 조각 +{note.total}</h2>
          <p className="mt-1.5 text-[13px] text-gray-500">{note.titles} · 지금 {note.balance}개</p>
          <button
            onClick={() => {
              clearMission();
              setNote(null);
              nav("/sb");
            }}
            className="mt-5 h-12 w-full rounded-2xl bg-sm-orange text-[15px] font-black text-white"
          >
            생기부 퍼즐 열러 가기
          </button>
          <button
            onClick={() => {
              clearMission();
              setNote(null);
            }}
            className="mt-2 h-10 w-full text-[13.5px] font-bold text-gray-500"
          >
            여기서 더 둘러보기
          </button>
        </section>
      </>
    );
  }

  return (
    <div className="fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-sm-navy px-4 py-3 text-white shadow-[0_10px_28px_rgba(24,34,79,0.35)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sm-orange">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 4v10l-7 4-7-4V7z" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-extrabold">합격 생기부 조각 +{note.total}</span>
        <span className="block truncate text-[12px] text-gray-300">{note.titles} · 지금 {note.balance}개</span>
      </span>
      <Link
        to="/sb"
        onClick={() => setNote(null)}
        className="shrink-0 rounded-lg bg-white px-3 py-2 text-[12.5px] font-bold text-sm-navy"
      >
        퍼즐 열기
      </Link>
    </div>
  );
}