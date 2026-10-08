import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

/*
 * 합격 생기부 — /sb
 * 계열 고르기 → 학교 단계 고르기 → 학년·영역 퍼즐
 * 진짜 생기부 위에 퍼즐 조각이 덮여 있고, 궁금한 조각을 눌러 조각(코인)으로 연다.
 * 잠긴 문장은 서버가 보내지 않는다 — 연 조각이 덮던 줄만 본문이 온다.
 */

const AREAS = [
  { k: "cc", label: "창체", title: "창의적 체험활동상황" },
  { k: "sp", label: "세특", title: "세부능력 및 특기사항" },
  { k: "hb", label: "행특", title: "행동특성 및 종합의견" },
  { k: "gr", label: "성적", title: "교과학습발달상황" },
];
const MISSION_GO = {
  mg5: "/mulgyeol", mgc: "/mulgyeol", first_comment: "/mulgyeol",
  topic: "/topic", read: "/reading", motive: "/motive", iv: "/interview",
  nick: "/my", friend: "/my", wonder: null, quiz: null, plan: null,
};
const GRP = { day: "오늘", week: "이번 주", once: "한 번만", free: "언제든" };
const HALF = { att: true, mg5: true }; // 반 개씩 — 둘 다 하면 조각 1개
export const SB_RETURN = "sb_return"; // 미션 하러 갈 때 돌아올 퍼즐 자리
export const SB_MISSION = "sb_mission"; // 지금 하러 간 미션
const PICK_KEY = "sb_grade_pick"; // 마지막으로 본 학년 탭 (브라우저에 기억)
const readPick = () => {
  try {
    return Number(localStorage.getItem(PICK_KEY)) || 1;
  } catch {
    return 1;
  }
};
const savePick = (g) => {
  try {
    localStorage.setItem(PICK_KEY, String(g));
  } catch {
    /* 저장이 막혀도 이번에는 쓴다 */
  }
};
const MAX_W = 544; // 생기부 종이 최대 너비 (다른 화면 카드 폭과 같게)
const LABEL_W = 54; // 왼쪽 '자율 · 국어' 칸
const num = (v) => Number(v ?? 0);
const stars = (n) => "★".repeat(num(n));
const mdOf = (d) => (d ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : "");
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const futureDay = (d) => (d && d > kstToday() ? d : null); // 아직 안 온 날만 보여준다

/*
 * 생기부 표 배치 — 문장 한 줄 = 표 한 줄.
 * 조각 n 이 덮는 줄은 서버와 같은 규칙: floor(n × 줄 수 / 판 크기)
 * 그래서 한 줄을 덮는 조각들을 그 줄의 가로로 나란히 놓는다 (조각을 열면 바로 그 자리 문장이 보인다)
 */
function layout(lines, size, W) {
  const L = lines.length;
  if (!L || !size) return { rows: [], height: 0 };
  let y = 0;
  const rows = lines.map((l, j) => {
    const first = Math.ceil((j * size) / L);
    const next = Math.ceil(((j + 1) * size) / L);
    // 글자 수로 줄 높이를 정한다 (글자 칸 너비 ÷ 약 11px = 한 줄 글자 수, 줄 간격 17px)
    const perLine = Math.max(16, Math.floor((W - LABEL_W - 20) / 11));
    const textLines = Math.max(1, Math.ceil(Number(l.len ?? 0) / perLine));
    const h = Math.max(58, textLines * 17 + 14);
    const row = { ...l, first, count: Math.max(1, next - first), y, h, sameLabel: j > 0 && lines[j - 1].label === l.label };
    y += h;
    return row;
  });
  return { rows, height: y };
}

/* PDF 판 조각 모양 — 가로·세로 격자, 네 변 모두 볼록·오목이 맞물린다 */
const hSign = (i, j) => ((i * 7 + j * 3) % 2 ? 1 : -1); // 행 i 아래 변
const vSign = (i, j) => ((i * 5 + j * 11) % 2 ? 1 : -1); // 열 j 오른쪽 변
function gridPiece(i, j, cols, rows, w, h) {
  const r = Math.min(w, h) * 0.16;
  const edge = (x1, y1, x2, y2, sgn) => {
    if (!sgn) return ` L${x2} ${y2}`;
    const ax = x1 + (x2 - x1) * 0.37, ay = y1 + (y2 - y1) * 0.37, bx = x1 + (x2 - x1) * 0.63, by = y1 + (y2 - y1) * 0.63;
    return ` L${ax.toFixed(1)} ${ay.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 1 ${sgn > 0 ? 1 : 0} ${bx.toFixed(1)} ${by.toFixed(1)} L${x2} ${y2}`;
  };
  const top = i === 0 ? 0 : -hSign(i - 1, j);
  const right = j === cols - 1 ? 0 : vSign(i, j);
  const bottom = i === rows - 1 ? 0 : hSign(i, j);
  const left = j === 0 ? 0 : -vSign(i, j - 1);
  return `M0 0${edge(0, 0, w, 0, top)}${edge(w, 0, w, h, right)}${edge(w, h, 0, h, bottom)}${edge(0, h, 0, 0, left)} Z`;
}

/* 조각 모양 — 위아래는 평평, 옆은 볼록(+1)·오목(-1)이 맞물린다 */
function piecePath(w, h, left, right) {
  const r = Math.min(w, h) * 0.17;
  // 오른쪽 변: 위→아래로 그린다 / 왼쪽 변: 아래→위로 그린다
  const rightSide = right
    ? ` L${w} ${(h * 0.38).toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 1 ${right > 0 ? 1 : 0} ${w} ${(h * 0.62).toFixed(1)} L${w} ${h}`
    : ` L${w} ${h}`;
  const leftSide = left
    ? ` L0 ${(h * 0.62).toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 1 ${left > 0 ? 1 : 0} 0 ${(h * 0.38).toFixed(1)} L0 0`
    : " L0 0";
  return `M0 0 L${w} 0${rightSide} L0 ${h}${leftSide} Z`;
}

/* 짧은 알림 */
function useToast() {
  const [msg, setMsg] = useState("");
  const t = useRef(null);
  const show = useCallback((m) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 1800);
  }, []);
  return [msg, show];
}

export default function Sb() {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [toast, showToast] = useToast();

  const [view, setView] = useState("tracks"); // tracks | ladder | puzzle
  const [me, setMe] = useState(null);
  const [tracks, setTracks] = useState(null);
  const [track, setTrack] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [pick, setPick] = useState(null); // 고른 단계 { record_id, tier, schools, stars, grade_total }
  const [grade, setGrade] = useState(1);
  const [area, setArea] = useState("cc");
  const [board, setBoard] = useState(null);
  const [sheet, setSheet] = useState(null); // 누른 조각 번호
  const [celebrate, setCelebrate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gradeAsk, setGradeAsk] = useState(false);
  const [streak, setStreak] = useState(0); // 오늘까지 며칠 연속 출석했는지
  const [progress, setProgress] = useState([]); // 이어서 깨기 (내가 열던 생기부)
  const paperRef = useRef(null);
  const [paperW, setPaperW] = useState(0); // 화면 폭에 맞춘 생기부 종이 너비

  useEffect(() => {
    const el = paperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPaperW(Math.floor(el.clientWidth)));
    ro.observe(el);
    setPaperW(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [view, board]);

  // 내 정보 (처음이면 시작 보너스 +3) + 출석
  const loadMe = useCallback(async () => {
    if (!user) return setMe(null);
    const { data: ck } = await supabase.rpc("sb_checkin");
    setStreak(num(ck?.streak));
    const { data, error } = await supabase.rpc("sb_me");
    if (error) return console.warn("sb_me failed", error);
    setMe(data);
    if (data?.need_grade_confirm) setGradeAsk(true);
    if (num(data?.start_bonus) > 0) showToast(`처음 왔구나! 시작 조각 ${data.start_bonus}개를 줬어`);
  }, [user, showToast]);

  useEffect(() => {
    if (!authLoading) loadMe();
  }, [authLoading, loadMe]);

  // 화면을 다시 볼 때(다른 탭·앱에 갔다 오기, 하루 지나서 다시 열기) 오늘 미션을 새로 불러온다
  useEffect(() => {
    const again = () => document.visibilityState === "visible" && loadMe();
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [loadMe]);

  useEffect(() => {
    supabase.rpc("sb_tracks_list").then(({ data }) => setTracks(data ?? []));
  }, []);

  // 이어서 깨기 — 첫 화면에 올 때마다 새로
  useEffect(() => {
    if (!user || view !== "tracks") return;
    supabase.rpc("sb_my_progress").then(({ data }) => setProgress(Array.isArray(data) ? data : []));
  }, [user, view]);

  // 이어서 깨기 카드 → 그 퍼즐로 바로
  function resume(p) {
    setTrack(p.track_id);
    loadCatalog(p.track_id);
    setPick({ record_id: p.record_id, tier: p.tier, schools: p.schools, stars: p.stars, grade_total: p.grade_total });
    setGrade(p.grade || 1);
    setArea(p.area || "cc");
    setBoard(null);
    setView("puzzle");
  }

  // 학교 단계 목록
  const loadCatalog = useCallback(
    (t) => supabase.rpc("sb_catalog", { p_track: t }).then(({ data }) => setCatalog(data ?? [])),
    []
  );

  // 미션 하고 돌아왔으면 보던 퍼즐로 바로
  useEffect(() => {
    let back = null;
    try {
      back = JSON.parse(sessionStorage.getItem(SB_RETURN) || "null");
      sessionStorage.removeItem(SB_RETURN);
    } catch {
      back = null;
    }
    if (!back?.pick?.record_id) return;
    setTrack(back.track);
    loadCatalog(back.track);
    setPick(back.pick);
    setGrade(back.grade || 1);
    setArea(back.area || "cc");
    setView("puzzle");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 판 하나
  const loadBoard = useCallback(() => {
    if (!pick?.record_id) return;
    supabase.rpc("sb_board", { p_record: pick.record_id, p_grade: grade, p_area: area }).then(({ data, error }) => {
      if (error) return showToast(error.message);
      setBoard(data);
    });
  }, [pick?.record_id, grade, area, showToast]);
  useEffect(() => {
    if (view === "puzzle") loadBoard();
  }, [view, loadBoard]);

  // 화면·학교·학년·영역을 바꾸면 맨 위(생기부 첫 줄)부터 보여준다
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view, pick?.record_id, grade, area]);

  const myGrade = num(me?.grade) || 1;
  const balance = num(me?.balance);
  const cost = num(board?.tier?.cost) || 1;
  const size = num(board?.board?.size);
  const opened = useMemo(() => new Set(board?.opened ?? []), [board]);
  const isPdf = board?.board?.kind === "pdf";
  const [tileUrl, setTileUrl] = useState({}); // { "판id-조각": 주소 }

  // PDF 판: 연 조각 이미지 주소를 받아온다 (안 받은 것만)
  useEffect(() => {
    if (!isPdf || !board?.board?.id) return;
    const id = board.board.id;
    const need = (board.opened ?? []).filter((n) => !tileUrl[`${id}-${n}`]);
    if (!need.length) return;
    supabase.storage
      .from("sb-files")
      .createSignedUrls(need.map((n) => `boards/${id}/tiles/${n}.webp`), 3600)
      .then(({ data }) => {
        if (!data) return;
        setTileUrl((m) => {
          const next = { ...m };
          data.forEach((d, k) => d.signedUrl && (next[`${id}-${need[k]}`] = d.signedUrl));
          return next;
        });
      });
  }, [isPdf, board]); // eslint-disable-line react-hooks/exhaustive-deps

  // 다 깬 판: PDF 받기
  async function downloadPdf() {
    const id = board?.board?.id;
    if (!id) return;
    const name = `${pick?.schools ?? "합격"}_${grade}학년_${AREAS.find((a) => a.k === area)?.label}.pdf`;
    const { data, error } = await supabase.storage.from("sb-files").createSignedUrl(`boards/${id}/full.pdf`, 120, { download: name });
    if (error || !data?.signedUrl) return showToast("PDF를 받지 못했어. 잠시 후 다시 해 줘.");
    window.location.href = data.signedUrl;
  }
  const lines = board?.lines ?? [];

  async function open() {
    if (sheet === null || !board?.board) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("sb_open", { p_board: board.board.id, p_piece: sheet });
    setBusy(false);
    if (error) return showToast(error.message);
    setSheet(null);
    setMe((m) => (m ? { ...m, balance: data.balance } : m));
    if (data.completed) setCelebrate({ bonus: data.bonus, scoreUnlocked: data.score_unlocked });
    loadBoard();
    if (data.completed) loadMe();
  }

  /* ─── 화면 조각 ─── */

  const coin = user ? (
    <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-orange-50 px-3 text-[13.5px] font-black text-[#C2410C]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 3l7 4v10l-7 4-7-4V7z" /></svg>
      조각 {balance}
    </span>
  ) : (
    <Link to="/login" className="shrink-0 rounded-full bg-sm-orange px-3.5 py-2 text-[13px] font-bold text-white">로그인하고 조각 받기</Link>
  );

  const header = (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-5 sm:px-5">
        {view !== "tracks" && (
          <button
            onClick={() => setView(view === "puzzle" ? "ladder" : "tracks")}
            className="-ml-1 mb-1 flex items-center gap-0.5 py-1 text-[13px] font-bold text-gray-500 hover:text-sm-navy"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            {view === "puzzle" ? "학교 목록" : "계열 고르기"}
          </button>
        )}

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {view === "puzzle" && pick ? (
              <>
                <h1 className="text-[24px] font-extrabold tracking-tight text-sm-navy">{pick.schools} 합격 생기부</h1>
                <p className="mt-1 text-[13px] text-gray-500">
                  {tracks?.find((t) => t.id === track)?.name} 계열 · 난이도 <span className="text-[#C2410C]">{stars(pick.stars)}</span> · {pick.grade_total}칸
                </p>
              </>
            ) : (
              <>
                <h1 className="text-[24px] font-extrabold tracking-tight text-sm-navy">합격 생기부 퍼즐</h1>
                <p className="mt-1 text-[15px] font-bold text-sm-orange">조각을 모아 선배 생기부를 한 칸씩</p>
                <p className="mt-0.5 text-[13px] text-gray-500">나만 그래?·흔한가에 참여하면 조각을 받아. 궁금한 칸부터 열어봐.</p>
              </>
            )}
          </div>
          {coin}
        </div>

        {view === "puzzle" && pick && (
          <>
            {/* 학년 */}
            <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
              {[1, 2, 3].map((g) => {
                const lock = g > myGrade;
                const on = grade === g;
                return (
                  <button
                    key={g}
                    onClick={() => {
                      setGrade(g);
                      savePick(g);
                      setArea("cc");
                    }}
                    className={`flex h-11 flex-col items-center justify-center rounded-lg ${on ? "bg-white text-sm-navy shadow-sm" : lock ? "text-gray-400" : "text-gray-600"}`}
                  >
                    <span className="text-[13.5px] font-extrabold">{g}학년</span>
                    {lock && <span className="text-[10.5px]">고{g} 되면 열려</span>}
                  </button>
                );
              })}
            </div>
            {/* 영역 */}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {AREAS.map((a) => {
                const st = board?.areas?.find((x) => x.area === a.k);
                const on = area === a.k;
                const done = st && num(st.opened) >= num(st.size);
                return (
                  <button
                    key={a.k}
                    onClick={() => setArea(a.k)}
                    className={`flex h-11 flex-col items-center justify-center rounded-lg border ${on ? "border-sm-orange bg-sm-orange text-white" : "border-gray-300 bg-white text-sm-navy"}`}
                  >
                    <span className="text-[13px] font-extrabold">{a.label}</span>
                    <span className={`text-[10.5px] ${on ? "text-white/90" : "text-gray-500"}`}>{st ? (done ? "완성!" : `${num(st.opened)}/${num(st.size)}`) : "-"}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </header>
  );

  /* 1. 계열 */
  const tracksView = (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-5">
      {progress.length > 0 && (
        <section className="mb-7">
          <h2 className="text-[17px] font-extrabold text-sm-navy">이어서 깨기</h2>
          <div className="mt-3 space-y-2">
            {progress.slice(0, 3).map((p) => {
              const pct = num(p.total) ? (num(p.opened) / num(p.total)) * 100 : 0;
              return (
                <button
                  key={p.record_id}
                  onClick={() => resume(p)}
                  className="flex w-full items-center gap-3 rounded-2xl border-2 border-sm-orange bg-white px-4 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[16px] font-black text-sm-navy">{p.schools}</span>
                      <span className="text-[11px] font-bold text-[#C2410C]">{stars(p.stars)}</span>
                      <span className="text-[12px] text-gray-500">{p.track_name}</span>
                    </span>
                    <span className="mt-1.5 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <span className="block h-full bg-sm-orange" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="shrink-0 text-[11.5px] font-bold text-sm-navy">
                        {p.grade}학년 {AREAS.find((a) => a.k === p.area)?.label} · {num(p.opened)}/{num(p.total)}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-sm-orange px-3 py-2 text-[12.5px] font-bold text-white">이어서 하기</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <h2 className="text-[17px] font-extrabold text-sm-navy">어느 계열 선배 생기부를 볼래?</h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(tracks ?? []).map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTrack(t.id);
              setCatalog(null);
              loadCatalog(t.id);
              setView("ladder");
            }}
            className="flex h-28 flex-col justify-between rounded-2xl border border-gray-200 bg-white p-4 text-left"
          >
            <span className="block text-[17px] font-black text-sm-navy">{t.name}</span>
            <span className={`text-[11.5px] font-bold ${num(t.live) ? "text-[#C2410C]" : "text-gray-400"}`}>{num(t.live) ? `생기부 ${t.live}개 열림` : "곧 열려요"}</span>
          </button>
        ))}
      </div>
    </div>
  );

  /* 2. 학교 단계 */
  const ladderView = (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-5">
      <h2 className="text-[17px] font-extrabold text-sm-navy">{tracks?.find((t) => t.id === track)?.name} 계열 · 어느 학교까지 갈래?</h2>
      <p className="mt-1 text-[12.5px] text-gray-500">열리는 날짜 순서야. 별이 많은 학교일수록 칸이 많고, 서울대~한양대는 다른 학교에서 영역 하나를 다 열어야 열려.</p>
      <div className="mt-4 space-y-1.5">
        {!catalog && <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중…</p>}
        {[...(catalog ?? [])]
          // 열리는 순서대로: 이미 열린 학교 → 곧 열릴 학교(날짜 빠른 순) → 날짜 없는 학교
          .sort((x, y) => {
            const ox = x.status === "live" ? 0 : 1, oy = y.status === "live" ? 0 : 1;
            if (ox !== oy) return ox - oy;
            return (x.open_on || "9999") < (y.open_on || "9999") ? -1 : (x.open_on || "9999") > (y.open_on || "9999") ? 1 : x.tier - y.tier;
          })
          .map((c) => {
          const coming = c.status !== "live";
          const lock = c.locked;
          const pct = (num(c.opened) / num(c.grade_total)) * 100;
          return (
            <button
              key={c.tier}
              onClick={() => {
                if (coming) return showToast(futureDay(c.open_on) ? `${c.schools} 생기부는 ${mdOf(c.open_on)}에 열려요` : "이 학교 생기부는 곧 열려요");
                if (lock) return showToast("다른 학교에서 영역 하나(창체·세특 등)를 다 열면 열려");
                setPick({ record_id: c.record_id, tier: c.tier, schools: c.schools, stars: c.stars, grade_total: c.grade_total });
                setGrade(Math.min(readPick(), myGrade)); // 마지막으로 본 학년 (처음이면 1학년)
                setArea("cc");
                setBoard(null);
                  setView("puzzle");
              }}
              className={`w-full rounded-2xl border bg-white px-4 py-3 text-left ${coming || lock ? "border-gray-200 opacity-60" : "border-gray-200 hover:border-sm-orange"}`}
            >
              <span className="flex items-center gap-2">
                <span className="text-[16px] font-black text-sm-navy">{c.schools}</span>
                <span className="text-[11px] font-bold text-[#C2410C]">{stars(c.stars)}</span>
                <span className={`ml-auto shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${coming || lock ? "bg-gray-100 text-gray-500" : "bg-orange-50 text-[#C2410C]"}`}>
                  {coming ? (futureDay(c.open_on) ? `${mdOf(c.open_on)} 열려요` : "곧 열려요") : lock ? (futureDay(c.open_on) ? `잠김 · ${mdOf(c.open_on)}` : "잠김") : `${c.grade_total}칸`}
                </span>
              </span>
              {!coming && !lock && (
                <span className="mt-2 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full bg-sm-orange" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-[11.5px] font-bold text-sm-navy">{myGrade}학년 {num(c.opened)}/{c.grade_total}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  /* 3. 퍼즐 */
  const lock = board?.lock;
  const lockText = {
    coming: [futureDay(board?.tier?.open_on) ? `${mdOf(board.tier.open_on)}에 열려요` : "이 판은 곧 열려요", "선배 생기부를 정리하고 있어. 조금만 기다려 줘."],
    grade: [`${grade}학년 판은 고${grade}이 되면 열려`, `학년이 올라가면 같은 크기의 새 판이 열려. 지금은 ${myGrade}학년 판을 모아봐.`],
    tier: ["아직 잠긴 학교야", "다른 학교에서 창체·세특 같은 영역 하나를 다 열면 열려."],
    score: ["성적 판은 마지막에 열려", "창체 · 세특 · 행특 판을 모두 완성하면 이 선배의 성적을 볼 수 있어."],
  }[lock];
  const W = Math.min(MAX_W, paperW || 358);
  const lay = layout(lines, size, W);
  const areaInfo = AREAS.find((a) => a.k === area);
  const boardOpened = board?.opened?.length ?? 0;

  const puzzleView = (
    <div className="mx-auto max-w-xl px-4 py-5 sm:px-5">
      {!board && <p className="py-16 text-center text-[13px] text-gray-400">불러오는 중…</p>}

      {board && lockText && lock !== "login" && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
          <p className="text-[16px] font-black text-sm-navy">{lockText[0]}</p>
          <p className="text-[13px] leading-relaxed text-gray-600">{lockText[1]}</p>
        </div>
      )}

      {board && size > 0 && (!lock || lock === "login") && (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-bold text-gray-600">
              {grade}학년 {areaInfo.label} · {boardOpened} / {size}
            </span>
            <span className="text-[12px] text-gray-500">궁금한 조각을 눌러봐</span>
          </div>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-sm-orange" style={{ width: `${(boardOpened / size) * 100}%` }} />
          </div>

          {isPdf ? (
            <>
              <div ref={paperRef} className="overflow-hidden border border-gray-300 bg-white shadow-[0_6px_18px_rgba(24,34,79,0.10)]">
                {(() => {
                  const b0 = board.board;
                  const cols = num(b0.cols) || 1, rows = num(b0.rows) || 1;
                  const H = Math.round((W * num(b0.page_h)) / Math.max(1, num(b0.page_w)));
                  const cw = W / cols, ch = H / rows;
                  return (
                    <div className="relative" style={{ width: W, height: H }}>
                      {/* 연 조각: 생기부 첫 장 그 자리 이미지 */}
                      {[...opened].map((n) => {
                        const url = tileUrl[`${b0.id}-${n}`];
                        return url ? (
                          <img
                            key={`t${n}`}
                            src={url}
                            alt=""
                            className="absolute select-none"
                            draggable={false}
                            style={{ left: (n % cols) * cw, top: Math.floor(n / cols) * ch, width: cw + 0.5, height: ch + 0.5 }}
                          />
                        ) : null;
                      })}
                      {/* 잠긴 조각 */}
                      {Array.from({ length: cols * rows }, (_, n) => {
                        if (opened.has(n)) return null;
                        const i = Math.floor(n / cols), j = n % cols;
                        return (
                          <button
                            key={`p${n}`}
                            onClick={() => {
                              setSheet(n);
                              loadMe();
                            }}
                            aria-label={`${areaInfo.label} 조각`}
                            className="absolute p-0 transition-transform hover:-translate-y-0.5"
                            style={{ left: j * cw, top: i * ch, width: cw, height: ch }}
                          >
                            <svg width={cw} height={ch} viewBox={`0 0 ${cw} ${ch}`} className="absolute inset-0 overflow-visible">
                              <path d={gridPiece(i, j, cols, rows, cw, ch)} fill={(i + j) % 2 ? "#2B3A72" : "#18224F"} stroke="#FFFFFF" strokeWidth="2" />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-white/70">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              {board.board.done && (
                <button onClick={downloadPdf} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-sm-navy text-[15px] font-black text-white">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                  다 깼어! {grade}학년 {areaInfo.label} PDF 받기
                </button>
              )}
            </>
          ) : (
          <div ref={paperRef} className="overflow-hidden border border-gray-300 bg-white shadow-[0_6px_18px_rgba(24,34,79,0.10)]">
            <div className="border-b border-gray-200 px-3 py-2 text-center" style={{ fontFamily: "'Nanum Myeongjo', 'Batang', serif" }}>
              <p className="text-[14px] font-bold tracking-[2px] text-gray-900">학 교 생 활 기 록 부</p>
              <p className="text-[10px] text-gray-500">{grade}학년 · {areaInfo.title}</p>
            </div>

            <div className="relative" style={{ width: W, height: lay.height }}>
              {/* 진짜 생기부 표 — 연 줄만 글자가 온다 */}
              {lay.rows.map((r) => (
                <div
                  key={`r${r.line_no}`}
                  className="absolute left-0 flex border-b border-gray-300"
                  style={{ top: r.y, width: W, height: r.h, fontFamily: "'Nanum Myeongjo', 'Batang', serif" }}
                >
                  <span
                    className={`flex shrink-0 items-start justify-center border-r border-gray-300 bg-gray-50 px-1 pt-2 text-center text-[11px] font-bold ${r.sameLabel ? "text-transparent" : "text-gray-800"}`}
                    style={{ width: LABEL_W }}
                  >
                    {r.label}
                  </span>
                  <span className="flex-1 px-2 py-1.5 text-[11px] leading-[17px] text-gray-900">{r.open ? r.body : ""}</span>
                </div>
              ))}

              {/* 퍼즐 조각 — 한 줄을 덮는 조각들이 그 줄 가로로 나란히, 옆끼리 맞물린다 */}
              {lay.rows.flatMap((r, ri) =>
                Array.from({ length: r.count }, (_, k) => {
                  const n = r.first + k;
                  if (opened.has(n)) return null;
                  const w = W / r.count;
                  // 경계 k|k+1 의 모양: 왼쪽 조각 기준 +1 볼록 / -1 오목 → 오른쪽 조각은 반대
                  const sign = (b) => ((b + ri) % 2 ? 1 : -1);
                  const right = k === r.count - 1 ? 0 : sign(k);
                  const left = k === 0 ? 0 : -sign(k - 1);
                  return (
                    <button
                      key={`p${n}`}
                      onClick={() => {
                        setSheet(n);
                        loadMe();
                      }}
                      aria-label={`${r.label} 조각`}
                      className="absolute p-0 transition-transform hover:-translate-y-0.5"
                      style={{ left: k * w, top: r.y, width: w, height: r.h }}
                    >
                      <svg width={w} height={r.h} viewBox={`0 0 ${w} ${r.h}`} className="absolute inset-0 overflow-visible">
                        <path d={piecePath(w, r.h, left, right)} fill={(ri + k) % 2 ? "#2B3A72" : "#18224F"} stroke="#FFFFFF" strokeWidth="2" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-white/70">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" /></svg>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
          )}
          <p className="mt-3 text-center text-[11.5px] leading-relaxed text-gray-500">
            합격생 생기부를 바탕으로 재구성한 사례예요. 그대로 따라 쓰지 말고 흐름을 봐 줘.
          </p>
        </>
      )}
    </div>
  );

  /* 조각 창: 열기 + 미션 */
  const missions = me?.missions ?? [];
  const groups = ["day", "week", "once", "free"]
    .map((g) => ({ g, items: missions.filter((m) => m.grp === g) }))
    .filter((x) => x.items.length);
  const sheetLine = sheet !== null ? lay.rows.find((r) => sheet >= r.first && sheet < r.first + r.count) : null;

  const sheetView = sheet !== null && (
    <>
      <div className="fixed inset-0 z-40 bg-black/45" onClick={() => setSheet(null)} />
      <section className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85vh] max-w-xl overflow-y-auto rounded-t-3xl bg-white px-5 pb-6 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-[#C2410C]">{grade}학년 {areaInfo.label} · 잠긴 조각</span>
          <button onClick={() => setSheet(null)} aria-label="닫기" className="-mr-2 flex h-10 w-10 items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#18224F" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <h2 className="-mt-1 text-[19px] font-black text-sm-navy">{isPdf ? `${grade}학년 ${areaInfo.label}` : sheetLine?.label ?? ""} 조각</h2>

        {!user ? (
          <button onClick={() => nav("/login")} className="mt-3 h-12 w-full rounded-2xl bg-sm-orange text-[15px] font-black text-white">
            로그인하고 조각 받기
          </button>
        ) : (
          <>
            {balance >= cost ? (
              <button onClick={open} disabled={busy} className="mt-3 h-12 w-full rounded-2xl bg-sm-orange text-[15px] font-black text-white disabled:opacity-50">
                {busy ? "여는 중…" : `조각 ${cost}개로 열기 · ${balance}개 있어`}
              </button>
            ) : (
              <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-[13.5px] font-bold text-red-600">조각이 없어. 아래 미션으로 받을 수 있어</p>
            )}

            <p className="mt-4 text-[13.5px] font-black text-sm-navy">
              조각 받기
              <span className="ml-1.5 font-medium text-gray-500">
                오늘 {num(me?.today?.got)}/{num(me?.today?.cap)} · 이번 주 {num(me?.week?.got)}/{num(me?.week?.cap)}
              </span>
            </p>
            {groups.map(({ g, items }) => (
              <div key={g} className="mt-2">
                <p className="text-[12px] font-bold text-gray-500">
                  {GRP[g]}
                  {g === "day" && <span className="ml-1.5 font-medium text-gray-400">출석 + 오늘 질문 5개를 둘 다 하면 조각 1개</span>}
                </p>
                <div className="mt-1 overflow-hidden rounded-xl border border-gray-200">
                  {items.map((m, i) => {
                    const go = MISSION_GO[m.id];
                    const full = (g === "day" && num(me?.today?.got) >= num(me?.today?.cap)) || (g === "week" && num(me?.week?.got) >= num(me?.week?.cap));
                    const label = m.done ? "완료" : m.id === "att" || m.id === "streak7" ? "자동" : full ? "한도" : go ? "하러 가기" : "곧";
                    return (
                      <div key={m.id} className={`flex items-center gap-3 px-3 py-2.5 ${i ? "border-t border-gray-100" : ""}`}>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[13px] font-bold ${m.done ? "text-gray-400" : "text-sm-navy"}`}>
                            {m.title} <span className="text-[#C2410C]">+{HALF[m.id] ? "0.5" : m.reward}</span>
                          </span>
                          {m.id === "streak7" ? (
                            <span className="mt-1 flex items-center gap-1.5">
                              {Array.from({ length: 7 }, (_, d) => {
                                const on = d < (streak % 7 || (streak > 0 ? 7 : 0));
                                return <span key={d} className={`h-2 flex-1 rounded-full ${on ? "bg-sm-orange" : "bg-gray-200"}`} />;
                              })}
                              <span className="ml-1 shrink-0 text-[11px] font-bold text-gray-500">
                                {streak % 7 === 0 && streak > 0 ? "7일 달성!" : `${streak % 7}/7일 · ${7 - (streak % 7)}일 더`}
                              </span>
                            </span>
                          ) : (
                            m.note && <span className="block text-[11px] text-gray-500">{m.note}</span>
                          )}
                        </span>
                        <button
                          disabled={m.done || full || !go}
                          onClick={() => {
                            if (!go) return;
                            try {
                              sessionStorage.setItem(SB_RETURN, JSON.stringify({ track, pick, grade, area }));
                              sessionStorage.setItem(SB_MISSION, m.id);
                            } catch {
                              /* 기억 못 해도 미션은 할 수 있다 */
                            }
                            nav(go);
                          }}
                          className={`h-8 shrink-0 rounded-lg px-3 text-[12px] font-bold ${m.done || full || !go ? "bg-gray-100 text-gray-500" : "bg-sm-navy text-white"}`}
                        >
                          {label}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </section>
    </>
  );

  /* 판 완성 */
  const celebrateView = celebrate && (
    <>
      <div className="fixed inset-0 z-40 bg-black/55" />
      <section className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-40px)] max-w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white px-5 py-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange-50">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C2410C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
        </span>
        <p className="mt-3 text-[13px] font-bold text-[#C2410C]">{grade}학년 {areaInfo.label} · {size}칸</p>
        <h2 className="mt-1 text-[21px] font-black text-sm-navy">
          {area === "gr" ? `${grade}학년 생기부 완성!` : `${areaInfo.label} 판 완성!`}
          {num(celebrate.bonus) > 0 ? ` +${celebrate.bonus}조각` : ""}
        </h2>
        {celebrate.scoreUnlocked && (
          <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2.5 text-[13px] text-gray-700">창체 · 세특 · 행특을 다 봤으니, 이 선배의 {grade}학년 성적 판이 열렸어.</p>
        )}
        <button
          onClick={() => {
            setCelebrate(null);
            if (celebrate.scoreUnlocked) setArea("gr");
            else if (area === "gr") setView("ladder");
            else setArea(AREAS[Math.min(2, AREAS.findIndex((a) => a.k === area) + 1)].k);
          }}
          className="mt-4 h-12 w-full rounded-2xl bg-sm-orange text-[15px] font-black text-white"
        >
          {celebrate.scoreUnlocked ? "성적 판 열러 가기" : area === "gr" ? "다른 학교 보러 가기" : "다음 영역 열기"}
        </button>
      </section>
    </>
  );

  /* 새 학년 확인 */
  const gradeAskView = gradeAsk && (
    <>
      <div className="fixed inset-0 z-40 bg-black/55" />
      <section className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-xl rounded-t-3xl bg-white px-5 pb-7 pt-6">
        <p className="text-[18px] font-black text-sm-navy">
          {me?.grade_ask === "missing" ? "지금 몇 학년이야?" : "새 학년이 시작됐어! 지금 몇 학년이야?"}
        </p>
        <p className="mt-1 text-[13px] text-gray-500">
          {me?.grade_ask === "missing" ? "학년에 맞춰 1학년부터 지금 학년까지 판이 열려." : "학년이 올라가면 같은 학교의 다음 학년 판이 열려."}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              onClick={async () => {
                await supabase.rpc("sb_set_grade", { p_grade: g });
                setGradeAsk(false);
                loadMe();
              }}
              className="h-12 rounded-xl border border-gray-300 text-[15px] font-black text-sm-navy hover:border-sm-orange hover:bg-orange-50"
            >
              고{g}
            </button>
          ))}
        </div>
      </section>
    </>
  );

  return (
    <div className="min-h-screen bg-[#F3F7F9] pb-24">
      {header}
      {view === "tracks" && tracksView}
      {view === "ladder" && ladderView}
      {view === "puzzle" && puzzleView}
      {sheetView}
      {celebrateView}
      {gradeAskView}
      {toast && (
        <div className="fixed inset-x-4 bottom-5 z-[60] mx-auto max-w-[400px] rounded-xl bg-sm-navy px-4 py-3 text-[13.5px] font-bold text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}