import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { STYLES, PALETTES, recommend } from "../../lib/speechDeck";

/*
 * 발표 연습 화면 (src/pages/agent/PracticeRoom.jsx) — 물꼬 채팅의 '발표 연습하러 가기'([[연습화면: 과제번호]])로 전체 화면으로 연다
 *   위: 지금 장 슬라이드 (PPT 받기에서 고른 디자인 · 색 그대로 · lib/speechDeck)
 *   아래: 그 장 대본 — 멈춤( / · // ) · 억양(↗ ↘) · 힘주기(굵게)를 눈에 보이게 + 빠르기 · 시선 그림 · 권장 시간
 *   녹음: 브라우저 음성 인식 · 장을 넘길 때마다 장별 시간을 잰다 → 끝내면 채팅으로 "발표 연습 끝 [[발표: 초]] [[장시간: …]]" (코칭은 서버)
 *   모드: 대본 보며 연습 · 실전 연습(대본 숨기고 핵심 낱말만)
 * AI 를 부르지 않는다 (코칭 받을 때만 채팅에서)
 */
const SYL_PER_MIN = 280;
const NAVY = "#172554";
const clean = (t) => String(t ?? "").replace(/\*\*/g, "").replace(/\s*\/\/?/g, "").replace(/\s*[↗↘]/g, "").replace(/\s{2,}/g, " ").trim();
const target = (say) => Math.max(8, Math.round(((clean(say).match(/[가-힣a-zA-Z0-9]/g) ?? []).length / SYL_PER_MIN) * 60));
const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
const c = (x) => `#${x}`;

/* ── 슬라이드 (HTML로 그린 미리보기 — PPT 와 같은 구성 · 크기는 화면 너비에 맞춰 늘고 준다) ── */
function SlideView({ s, no, P, style, title }) {
  const head = clean(s.head) || clean(s.title);
  const items = (s.items ?? []).filter((it) => it.label || it.text);
  let layout = s.layout || "bullets";
  if (layout === "big" && !s.big?.value) layout = "bullets";
  if (layout === "compare" && items.length < 2) layout = "bullets";
  const img = s.image?.what ? s.image : null;
  const bg = style === "board" ? P.surface : P.bg;
  const serif = style === "editorial" ? { fontFamily: "'Nanum Myeongjo','Batang',serif" } : {};
  const n = String(no).padStart(2, "0");
  const imgBox = img && layout !== "compare" && (
    <div className="flex flex-col items-center justify-center p-[2cqw] text-center" style={{ border: `0.2cqw dashed ${c(P.box)}`, background: c(style === "board" || style === "minimal" ? P.bg : P.surface), color: c(P.sub) }}>
      <b className="text-[1.6cqw]">사진 넣는 자리</b>
      <span className="mt-[0.5cqw] text-[1.6cqw]" style={{ color: c(P.ink) }}>{img.what}</span>
      {img.search && <span className="mt-[0.4cqw] text-[1.2cqw]">검색어: {img.search}</span>}
    </div>
  );
  const body = (() => {
    const list = items.length ? items : [{ label: "", text: clean(s.say).split(/(?<=[.?!])\s+/)[0] }];
    if (layout === "big") return (
      <div>
        <div className="text-[7cqw] font-black leading-none" style={{ color: c(style === "bold" ? P.title : P.accent), ...serif }}>{s.big.value}</div>
        <div className="mt-[1.5cqw] text-[2.1cqw]" style={{ color: c(P.ink) }}>{s.big.caption}</div>
      </div>
    );
    if (layout === "compare") return (
      <div className="grid grid-cols-2 gap-[2cqw]">
        {items.slice(0, 2).map((it, k) => (
          <div key={k} style={{ background: c(k ? P.soft : P.surface) }}>
            <div className="px-[1.5cqw] py-[1cqw] text-[1.9cqw] font-bold" style={{ background: c(k ? P.accent : P.primary), color: c(k ? P.onAccent : P.onPrimary) }}>{it.label}</div>
            <div className="px-[1.5cqw] py-[1.2cqw] text-[1.8cqw]" style={{ color: c(P.ink) }}>{it.text}</div>
          </div>
        ))}
      </div>
    );
    if (layout === "quote") {
      const q = items[0] ?? { text: head };
      return (
        <div className="pl-[2cqw]" style={{ borderLeft: `0.5cqw solid ${c(P.accent)}` }}>
          <div className="text-[2.7cqw] font-bold leading-snug" style={{ color: c(P.title), ...serif }}>{q.text}</div>
          {q.label && <div className="mt-[1cqw] text-[1.6cqw]" style={{ color: c(P.sub) }}>— {q.label}</div>}
        </div>
      );
    }
    if (layout === "steps" && !img) return (
      <div className="grid gap-[1.5cqw]" style={{ gridTemplateColumns: `repeat(${Math.min(list.length, 4)},1fr)` }}>
        {list.slice(0, 4).map((it, k) => (
          <div key={k} className="p-[1.4cqw]" style={{ background: c(style === "board" ? P.bg : P.surface), border: style === "minimal" ? `0.15cqw solid ${c(P.box)}` : "none" }}>
            <div className="flex h-[3.4cqw] w-[3.4cqw] items-center justify-center rounded-full text-[1.6cqw] font-bold" style={{ background: c(P.accent), color: c(P.onAccent) }}>{k + 1}</div>
            <div className="mt-[1cqw] text-[1.9cqw] font-bold" style={{ color: c(P.title) }}>{it.label}</div>
            <div className="mt-[0.5cqw] text-[1.5cqw]" style={{ color: c(P.ink) }}>{it.text}</div>
          </div>
        ))}
      </div>
    );
    return (
      <div className="space-y-[1.4cqw]">
        {list.map((it, k) => (
          <div key={k} className="flex gap-[1.2cqw]">
            <span className="mt-[0.7cqw] h-[1.1cqw] w-[1.1cqw] flex-none" style={{ background: c(P.accent) }} />
            <div>
              {it.label && <div className="text-[2cqw] font-bold" style={{ color: c(style === "bold" ? P.accent : P.title) }}>{it.label}</div>}
              <div className="text-[1.7cqw]" style={{ color: c(P.ink) }}>{it.text}</div>
            </div>
          </div>
        ))}
      </div>
    );
  })();

  // 디자인마다 다른 제목 자리
  const header = {
    classic: <div className="px-[5cqw] pt-[3cqw]"><div className="text-[1.3cqw]" style={{ color: c(P.sub) }}><b style={{ color: c(P.accent) }}>{n}</b> &nbsp;{clean(s.title)}</div><div className="mt-[0.6cqw] text-[2.8cqw] font-bold" style={{ color: c(P.title) }}>{head}</div><div className="mt-[1cqw] h-[0.6cqw] w-[7cqw]" style={{ background: c(P.accent) }} /></div>,
    minimal: <div className="px-[6cqw] pt-[3.5cqw]"><div className="text-[1.2cqw]" style={{ color: c(P.sub) }}>{n} — {clean(s.title)}</div><div className="mt-[0.8cqw] text-[3cqw]" style={{ color: c(P.title) }}>{head}</div><div className="mt-[1.4cqw] h-px" style={{ background: c(P.line) }} /></div>,
    sidebar: <div className="pl-[30cqw] pr-[4cqw] pt-[4cqw]"><div className="text-[2.6cqw] font-bold" style={{ color: c(P.title) }}>{head}</div><div className="mt-[1cqw] h-[0.5cqw] w-[5cqw]" style={{ background: c(P.accent) }} /></div>,
    board: <div className="px-[5cqw] py-[2.2cqw]" style={{ background: c(P.primary) }}><div className="text-[1.2cqw] opacity-75" style={{ color: c(P.onPrimary) }}>{n} · {clean(s.title)}</div><div className="mt-[0.4cqw] text-[2.6cqw] font-bold" style={{ color: c(P.onPrimary) }}>{head}</div></div>,
    bold: <div className="relative px-[7cqw] pt-[4cqw]"><span className="absolute right-[2cqw] top-[-2cqw] text-[15cqw] font-black leading-none" style={{ color: c(P.line) }}>{n}</span><span className="absolute left-[4.5cqw] top-[4.4cqw] h-[8cqw] w-[1cqw]" style={{ background: c(P.accent) }} /><div className="relative text-[1.3cqw] font-bold" style={{ color: c(P.accent) }}>{clean(s.title)}</div><div className="relative mt-[0.5cqw] w-[70%] text-[3.2cqw] font-black leading-tight" style={{ color: c(P.title) }}>{head}</div></div>,
    editorial: <div className="px-[8cqw] pt-[2.5cqw] text-center"><div className="mx-auto h-[0.5cqw]" style={{ borderTop: `1px solid ${c(P.primary)}`, borderBottom: `1px solid ${c(P.primary)}` }} /><div className="mt-[1.5cqw] text-[1.2cqw] tracking-widest" style={{ color: c(P.accent) }}>{n} &nbsp; {clean(s.title)}</div><div className="mt-[0.6cqw] text-[2.7cqw] font-bold" style={{ color: c(P.title), ...serif }}>{head}</div><div className="mx-auto mt-[1cqw] h-[0.15cqw] w-[7cqw]" style={{ background: c(P.accent) }} /></div>,
  }[style];

  return (
    <div className="relative w-full overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,.12)]" style={{ aspectRatio: "16 / 9", background: c(bg), containerType: "inline-size" }}>
      {style === "sidebar" && (
        <div className="absolute inset-y-0 left-0 flex w-[25cqw] flex-col justify-between p-[3cqw]" style={{ background: c(P.primary) }}>
          <span className="text-[5cqw] font-black leading-none" style={{ color: c(P.accent) }}>{n}</span>
          <span className="text-[1.4cqw]" style={{ color: c(P.onPrimary) }}>{clean(s.title)}</span>
        </div>
      )}
      {header}
      <div className={`absolute bottom-[5cqw] top-[24cqw] grid gap-[3cqw] ${style === "sidebar" ? "left-[30cqw] right-[4cqw]" : style === "editorial" ? "left-[8cqw] right-[8cqw]" : "left-[5cqw] right-[5cqw]"}`} style={{ gridTemplateColumns: imgBox ? "1.6fr 1fr" : "1fr" }}>
        <div className="min-w-0 overflow-hidden">{body}</div>
        {imgBox}
      </div>
      {style === "bold" && <div className="absolute bottom-0 left-0 h-[0.8cqw]" style={{ width: "100%", background: c(P.line) }} />}
      <div className="absolute bottom-[1.6cqw] right-[3cqw] text-[1cqw]" style={{ color: c(P.sub) }}>{title}</div>
    </div>
  );
}

/* ── 대본 — 표시를 눈에 보이게 ── */
function ScriptView({ say }) {
  const parts = String(say ?? "").split(/(\*\*[^*]+\*\*|\s*\/\/\s*|\s*\/\s*|\s*↗|\s*↘)/g).filter((x) => x !== "" && x !== undefined);
  return (
    <p className="text-[17px] leading-[2.05] text-gray-900 xl:text-[19px]">
      {parts.map((p, i) => {
        const t = p.trim();
        if (t === "//") return <span key={i} className="mx-1.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 align-middle text-[12px] font-bold text-blue-700 ring-1 ring-blue-200">∥ 숨</span>;
        if (t === "/") return <span key={i} className="mx-1 inline-block h-5 w-[3px] rounded-full bg-gray-300 align-middle" title="짧게 쉬기" />;
        if (t === "↗") return <span key={i} className="mx-0.5 align-middle text-[16px] font-black text-orange-500" title="끝을 올려">↗</span>;
        if (t === "↘") return <span key={i} className="mx-0.5 align-middle text-[16px] font-black text-indigo-700" title="끝을 내려">↘</span>;
        if (t.startsWith("**")) return <b key={i} className="bg-amber-100 px-0.5 font-extrabold">{t.slice(2, -2)}</b>;
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}
// 시선 그림 (Z자 · M자 · 정면)
function GazeIcon({ g }) {
  const d = g === "M자" ? "M4 22 L4 6 L16 18 L28 6 L28 22" : g === "정면" ? null : "M4 6 L28 6 L4 22 L28 22";
  return (
    <svg viewBox="0 0 32 28" className="h-7 w-8">
      <rect x="1" y="2" width="30" height="24" rx="2" fill="#F3F4F6" />
      {d ? <path d={d} fill="none" stroke="#111827" strokeWidth="2" strokeLinejoin="round" /> : <><circle cx="16" cy="14" r="5" fill="none" stroke="#111827" strokeWidth="2" /><circle cx="16" cy="14" r="1.6" fill="#111827" /></>}
    </svg>
  );
}

export default function PracticeRoom({ taskId, onClose, onDone }) {
  const [task, setTask] = useState(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(0); // 지금 장
  const [mode, setMode] = useState("script"); // script · real
  const [rec, setRec] = useState("idle"); // idle · rec · done
  const [now, setNow] = useState(Date.now());
  const [said, setSaid] = useState("");
  const [live, setLive] = useState("");
  const startRef = useRef(0);
  const marksRef = useRef([]); // 장이 바뀐 시각
  const recRef = useRef(null);
  const keepRef = useRef(false);
  const finalRef = useRef("");

  useEffect(() => {
    supabase.from("school_tasks").select("id,title,subject,speech").eq("id", taskId).maybeSingle().then(({ data }) => {
      if (!data?.speech?.slides?.length) return setErr("발표 대본을 찾지 못했어요. 채팅에서 'PPT 만들어 줘'라고 다시 보내 주세요.");
      setTask(data);
    });
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; keepRef.current = false; recRef.current?.stop?.(); };
  }, [taskId, onClose]);
  useEffect(() => {
    if (rec !== "rec") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [rec]);
  // 키보드 ← → 로 장 넘기기
  useEffect(() => {
    const k = (e) => { if (e.target.tagName === "TEXTAREA") return; if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const sp = task?.speech;
  const slides = sp?.slides ?? [];
  const choice = useMemo(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`sm_ppt_${taskId}`) || "null"); } catch { /* 저장 안 됨 */ }
    const r = recommend(task?.subject);
    return { style: saved?.style || r.style, palette: saved?.palette || r.palette };
  }, [task, taskId]);
  const P = PALETTES.find((p) => p.key === choice.palette) ?? PALETTES[0];
  const style = STYLES.find((x) => x.key === choice.style)?.key ?? "classic";
  const s = slides[i];
  const elapsed = rec === "idle" ? 0 : Math.round(((rec === "rec" ? now : marksRef.current.at(-1) ?? now) - startRef.current) / 1000);
  const limit = (sp?.minutes ?? 3) * 60;
  const slideStart = marksRef.current.filter((m) => m.i === i).at(-1)?.t;
  const slideSec = rec === "rec" && slideStart ? Math.round((now - slideStart) / 1000) : 0;

  function go(d) {
    const n = Math.min(slides.length - 1, Math.max(0, i + d));
    if (n === i) return;
    if (rec === "rec") marksRef.current.push({ i: n, t: Date.now() });
    setI(n);
  }
  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = "ko-KR"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let k = e.resultIndex; k < e.results.length; k++) {
        if (e.results[k].isFinal) finalRef.current = `${finalRef.current} ${e.results[k][0].transcript}`.trim();
        else interim += e.results[k][0].transcript;
      }
      setSaid(finalRef.current); setLive(interim);
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { keepRef.current = false; setErr("마이크 사용을 허용해 주세요."); setRec("idle"); } };
    r.onend = () => { if (keepRef.current) { try { r.start(); } catch { /* 이미 켜짐 */ } } };
    recRef.current = r;
    r.start();
  }
  function start() {
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return setErr("이 브라우저는 음성 인식이 안 돼요. 크롬이나 사파리에서 해 주세요.");
    setErr(""); setSaid(""); setLive(""); finalRef.current = "";
    setI(0);
    const t = Date.now();
    startRef.current = t; marksRef.current = [{ i: 0, t }]; keepRef.current = true;
    setNow(t); setRec("rec");
    listen();
  }
  function stop() {
    keepRef.current = false;
    recRef.current?.stop?.();
    marksRef.current.push({ i: -1, t: Date.now() });
    setRec("done");
  }
  function perSlide() {
    const secs = slides.map(() => 0);
    const m = marksRef.current;
    for (let k = 0; k < m.length - 1; k++) if (m[k].i >= 0) secs[m[k].i] += Math.round((m[k + 1].t - m[k].t) / 1000);
    return secs;
  }
  function finish() {
    const total = Math.round(((marksRef.current.at(-1)?.t ?? Date.now()) - startRef.current) / 1000);
    onDone(`발표 연습 끝 [[발표: ${total}]] [[장시간: ${perSlide().join(",")}]]\n${said.slice(0, 3500)}`);
    onClose();
  }

  if (err && !task) return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-white p-6">
      <div className="text-center"><p className="text-[15px] text-gray-700">{err}</p><button onClick={onClose} className="mt-4 h-10 rounded bg-gray-800 px-5 text-[14px] font-bold text-white">닫기</button></div>
    </div>
  );
  if (!task) return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-white text-[14px] text-gray-400">연습 화면 여는 중…</div>;

  const keywords = [clean(s.head), ...(s.items ?? []).map((it) => it.label).filter(Boolean)].filter(Boolean);
  const tgt = target(s.say);
  return (
    <div className="fixed inset-0 z-[95] flex h-[100dvh] flex-col bg-[#F4F5F7]">
      {/* 위 막대 */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <b className="min-w-0 flex-1 truncate text-[14.5px] font-extrabold text-gray-900">발표 연습 · {clean(sp.deck_title || task.title)}</b>
        <div className="flex rounded border border-gray-300 p-0.5 text-[12.5px] font-bold">
          {[["script", "대본 보며 연습"], ["real", "실전 연습"]].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={`rounded-sm px-2.5 py-1 ${mode === k ? "bg-gray-800 text-white" : "text-gray-600"}`}>{l}</button>
          ))}
        </div>
        <button onClick={onClose} className="px-1 text-[22px] leading-none text-gray-400 hover:text-gray-700" aria-label="닫기">×</button>
      </div>

      {/* 가운데 — 한 화면에: 넓은 화면은 왼쪽 슬라이드 · 오른쪽 대본, 좁은 화면은 위아래 (대본 칸만 스크롤) */}
      <div className="min-h-0 flex-1">
        <div className="mx-auto grid h-full max-w-[1500px] grid-rows-[auto_minmax(0,1fr)] gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:grid-rows-1 lg:gap-5">
          {/* 왼쪽: 슬라이드 + 장 넘기기 */}
          <div className="flex min-h-0 flex-col justify-center">
            <div className="mx-auto w-full" style={{ maxWidth: "calc((100dvh - 250px) * 16 / 9)" }}>
              <SlideView s={s} no={i + 1} P={P} style={style} title={clean(sp.deck_title || task.title)} />
              <div className="mt-2.5 flex items-center justify-between">
                <button onClick={() => go(-1)} disabled={i === 0} className="h-9 rounded border border-gray-300 bg-white px-3.5 text-[13px] font-bold text-gray-700 disabled:opacity-30">← 이전 장</button>
                <div className="flex gap-1.5">{slides.map((_, k) => <span key={k} className={`h-2 w-2 rounded-full ${k === i ? "bg-gray-800" : "bg-gray-300"}`} />)}</div>
                <button onClick={() => go(1)} disabled={i === slides.length - 1} className="h-9 rounded border border-gray-300 bg-white px-3.5 text-[13px] font-bold text-gray-700 disabled:opacity-30">다음 장 →</button>
              </div>
            </div>
          </div>

          {/* 오른쪽: 이 장 말하는 법 + 대본 */}
          <div className="flex min-h-0 flex-col rounded border border-gray-200 bg-white">
            <div className="flex-none border-b border-gray-100 px-4 pb-2.5 pt-3">
              <p className="text-[13.5px] font-extrabold text-gray-900">{i + 1}장 · {clean(s.title)}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] font-bold">
                <span className={`rounded px-2 py-0.5 ${s.pace === "천천히" ? "bg-indigo-50 text-indigo-700" : s.pace === "빠르게" ? "bg-orange-50 text-orange-700" : "bg-gray-100 text-gray-600"}`}>빠르기 {s.pace || "보통"}</span>
                <span className="flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-gray-700"><GazeIcon g={s.gaze} /> 시선 {s.gaze || "Z자"}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">권장 {tgt}초{rec === "rec" && <b className={`ml-1 ${slideSec > tgt * 1.5 ? "text-red-500" : "text-gray-900"}`}>· 지금 {slideSec}초</b>}</span>
              </div>
              {s.pace_why && <p className="mt-1 text-[12px] text-gray-500">{s.pace_why}</p>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {mode === "script" ? <ScriptView say={s.say} /> : (
                <div>
                  <p className="text-[12.5px] font-bold text-gray-500">실전 연습 — 대본 없이 핵심 낱말만 보고 말해 봐요</p>
                  <div className="mt-2 flex flex-wrap gap-2">{keywords.map((k, n) => <span key={n} className="rounded bg-gray-100 px-3 py-1.5 text-[17px] font-bold text-gray-900">{k}</span>)}</div>
                </div>
              )}
            </div>
            {mode === "script" && (
              <p className="flex-none border-t border-gray-100 px-4 py-2 text-[11.5px] leading-relaxed text-gray-500">
                <span className="mr-1 inline-block h-3 w-[3px] rounded-full bg-gray-300 align-middle" /> 짧게 쉬기 · <b className="text-blue-700">∥ 숨</b> 1~2초 쉬고 숨 · <b className="text-orange-500">↗</b> 끝 올려 · <b className="text-indigo-700">↘</b> 끝 내려 · <b className="bg-amber-100 px-0.5 text-gray-900">굵게</b> 힘주어
              </p>
            )}
            {rec !== "idle" && (
              <p className="max-h-16 flex-none overflow-y-auto border-t border-gray-100 bg-[#F7F8FA] px-4 py-2 text-[12.5px] leading-relaxed text-gray-600">
                {`${said} ${live}`.trim() || (rec === "rec" ? "듣고 있어요… 말을 시작해 봐요" : "말한 내용이 잡히지 않았어요")}
              </p>
            )}
            {err && <p className="flex-none px-4 pb-2 text-[12.5px] font-semibold text-red-500">{err}</p>}
          </div>
        </div>
      </div>

      {/* 아래 녹음 막대 */}
      <div className="flex-none border-t border-gray-200 bg-white px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3">
          <div className="w-24 flex-none">
            <p className={`text-[18px] font-extrabold tabular-nums ${elapsed > limit ? "text-red-500" : "text-gray-900"}`}>{mmss(elapsed)}</p>
            <p className="text-[11.5px] text-gray-400">제한 {mmss(limit)}</p>
          </div>
          <div className="flex-1"><div className="h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full transition-all" style={{ width: `${Math.min(100, (elapsed / limit) * 100)}%`, background: elapsed > limit ? "#EF4444" : NAVY }} /></div>
            {rec === "idle" && <p className="mt-1 hidden text-[11.5px] text-gray-500 sm:block">녹음을 시작하면 1장부터 · 한 장을 다 말하면 '다음 장 →'(키보드 →) · 장마다 걸린 시간도 코칭에 들어가요</p>}
          </div>
          {rec === "idle" && <button onClick={start} className="h-11 flex-none rounded bg-gray-800 px-5 text-[14px] font-extrabold text-white hover:bg-gray-900">● 녹음 시작</button>}
          {rec === "rec" && <button onClick={stop} className="h-11 flex-none rounded bg-red-500 px-5 text-[14px] font-extrabold text-white">■ 끝내기</button>}
          {rec === "done" && (
            <>
              <button onClick={start} className="h-11 flex-none rounded border border-gray-300 px-4 text-[13.5px] font-bold text-gray-700">다시 하기</button>
              <button onClick={finish} disabled={said.replace(/\s/g, "").length < 20} className="h-11 flex-none rounded bg-gray-800 px-5 text-[14px] font-extrabold text-white disabled:opacity-40">코칭 받기</button>
            </>
          )}
        </div>
        
      </div>
    </div>
  );
}