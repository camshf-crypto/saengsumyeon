import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getClientId } from "../lib/clientId";

/*
 * 머문 시간 재기 (App 에 한 번만 둔다 · 화면에는 아무것도 안 보인다)
 * · 화면을 보고 있을 때만 1초씩 센다 (다른 탭 · 앱으로 가면 멈춤)
 * · 1분 넘게 아무 손짓(스크롤 · 터치 · 클릭 · 키보드)이 없으면 멈춘다 — 켜 놓고 자리를 뜬 시간은 빼려고
 * · 15초마다, 그리고 화면을 떠날 때 서버로 보낸다 (sm_ping)
 * · 방문 = 이 탭에서 30분 안에 이어진 이용. 30분 넘게 쉬면 새 방문
 */
const IDLE_MS = 60 * 1000;
const GAP_MS = 30 * 60 * 1000;
const KEY = "sm_stay_session";

// 주소 → 메뉴 이름 (관리자 화면에서 이 이름으로 묶어 본다)
function sectionOf(path) {
  if (path === "/") return "home";
  const rules = [
    ["/mulgyeol", "mulgyeol"],
    ["/columns", "columns"],
    ["/board", "board"],
    ["/sb", "sb"],
    ["/my/note", "note"],
    ["/my/level", "level"],
    ["/my", "my"],
    ["/topic", "topic"],
    ["/result", "topic"],
    ["/reading", "reading"],
    ["/motive", "motive"],
    ["/interview", "interview"],
    ["/inquiry", "inquiry"],
    ["/ladder", "ladder"],
    ["/study", "study"],
    ["/tail", "tail"],
    ["/cards", "cards"],
    ["/login", "auth"],
    ["/signup", "auth"],
    ["/auth", "auth"],
  ];
  const hit = rules.find(([p]) => path === p || path.startsWith(p + "/"));
  return hit ? hit[1] : "etc";
}

// 이 탭의 방문 번호 — 30분 넘게 쉬었으면 새로 만든다
function sessionId() {
  const now = Date.now();
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (s?.id && now - s.last < GAP_MS) {
      sessionStorage.setItem(KEY, JSON.stringify({ id: s.id, last: now }));
      return s.id;
    }
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, JSON.stringify({ id, last: now }));
    return id;
  } catch {
    return `${now.toString(36)}-nostore`;
  }
}

export default function StayTracker() {
  const { pathname } = useLocation();
  const section = useRef(sectionOf(pathname));
  const bucket = useRef({}); // 아직 안 보낸 초 { home: 7, mulgyeol: 3 }
  const lastActive = useRef(Date.now());

  useEffect(() => {
    section.current = sectionOf(pathname);
    lastActive.current = Date.now(); // 화면을 옮긴 것도 손짓
  }, [pathname]);

  useEffect(() => {
    if (pathname.startsWith("/admin")) return undefined; // 관리자 화면은 세지 않는다

    const flush = () => {
      const parts = bucket.current;
      if (!Object.keys(parts).length) return;
      bucket.current = {};
      supabase.rpc("sm_ping", { p_session: sessionId(), p_client: getClientId(), p_parts: parts }).then(() => {});
    };
    const active = () => {
      lastActive.current = Date.now();
    };
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActive.current > IDLE_MS) return;
      const k = section.current;
      bucket.current[k] = (bucket.current[k] || 0) + 1;
    }, 1000);
    const send = setInterval(flush, 15000);
    const onHide = () => document.visibilityState === "hidden" && flush();

    const evs = ["scroll", "pointerdown", "keydown", "touchstart", "mousemove"];
    evs.forEach((e) => window.addEventListener(e, active, { passive: true }));
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      clearInterval(tick);
      clearInterval(send);
      evs.forEach((e) => window.removeEventListener(e, active));
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [pathname.startsWith("/admin")]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}