import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

/*
 * 안 깬 조각 알림 — 화면 왼쪽 아래 작은 알약
 * 미션으로 조각을 받고도 퍼즐에 안 오는 학생이 많아서,
 * 조각이 1개 이상 있으면 어느 화면에서든 "조각 N개 · 깨러 가기"를 보여준다.
 * 누르면 /sb?auto=1 → 하던 퍼즐로 바로 가서 조각을 자동으로 깬다.
 * ✕ 를 누르면 이번 접속(탭) 동안만 숨긴다.
 * 물꼬 채팅(/agent)에서는 입력창을 가려서 안 보인다.
 */

const HIDE = ["/sb", "/agent", "/admin", "/login", "/signup", "/auth", "/inquiry/", "/voice"];
const OFF_KEY = "sm_piece_nudge_off";

export default function PieceNudge() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const [off, setOff] = useState(() => {
    try {
      return sessionStorage.getItem(OFF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const hidden = HIDE.some((p) => pathname.startsWith(p));

  // 화면을 옮길 때마다 새로 센다 (미션을 마치고 다른 화면으로 가면 바로 늘어난 수가 보인다)
  useEffect(() => {
    if (!user || hidden || off) return;
    let alive = true;
    supabase.rpc("sb_balance").then(({ data }) => alive && setCount(Number(data?.balance ?? 0)));
    return () => {
      alive = false;
    };
  }, [user, pathname, hidden, off]);

  if (!user || hidden || off || count < 1) return null;

  return (
    <div className="fixed bottom-20 left-4 z-40 flex items-center gap-1 rounded-full bg-sm-navy py-1.5 pl-1.5 pr-1 text-white shadow-lg md:bottom-6 md:left-6">
      <Link to="/sb?auto=1" className="flex items-center gap-2 pr-1">
        <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-sm-orange px-2 text-[14px] font-black">{count}</span>
        <span className="text-[13px] font-extrabold">안 깬 조각 · 깨러 가기</span>
      </Link>
      <button
        aria-label="이번에는 숨기기"
        onClick={() => {
          setOff(true);
          try {
            sessionStorage.setItem(OFF_KEY, "1");
          } catch {
            // 무시
          }
        }}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}