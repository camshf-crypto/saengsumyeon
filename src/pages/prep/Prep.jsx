import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import LoginGate from "../../components/LoginGate";
import { refLink } from "../../lib/referral";
import PassSheet from "../../components/PassSheet";
import { PASS_PRICE } from "../../lib/pass";
import { track } from "../../lib/track";

/*
 * 수시 면접 준비 (/prep) — 비커스 '기출문제' 화면처럼
 *   위: 목표 학교 카드 (학교 · 학과 · 전형 · 삭제) — 가로로 넘긴다 · DB prep_targets (sql/sm_82_prep.sql)
 *   아래: 고른 학교의 기출 문제 카드 — 번호 · 기출 · 질문 · [답변 작성]
 *   탭 두 개: [기출문제] 그 학교 기출 · [생기부 예상질문] 내가 생기부 예상질문(/interview)에서 이 학교로 뽑은 질문
 *     예상질문 탭의 학습은 24,000원 결제한 학생만 (결제 전이면 생기부 예상질문 화면으로)
 *     누르면 '기출문제 학습' 화면 (비커스처럼 5단계): 첫 답변(음성 입력) → AI 피드백 → 2차 업그레이드 → 최종 피드백 → 꼬리 질문
 *     기출 = 대학별 면접 기출 표 univ_interview_questions (sql/sm_83 · 105개 대학) — 내 학과 질문을 많이 나온 순으로,
 *            내 학과 자료가 적으면 같은 대학 다른 학과 질문으로 채운다
 *            (그 표에 대학이 없으면 서버 agent 의 univ_brief → tail_examples 기출 · 공통 기출)
 *     예상 = 내가 생기부 예상질문에서 뽑은 그 대학 질문 (interview_queries)
 *   답변은 prep_answers 에 저장 → 'n/전체 문제 학습'
 *   기출은 무료 3문제 + 친구 1명이 내 링크로 가입할 때마다 5문제 (서버 agent studyQuota · sql/sm_86)
 *     친구 초대 대신 결제하면 무제한 — 기출만: 한 달 이용권 12,900원 · 기출 + 생기부 예상질문: 24,000원
 *     한 번 연 문제는 2차 피드백 · 꼬리질문까지 그대로 · 무료 문제를 다 쓰면 친구 초대 창(InviteSheet)
 *   예상 문제(생기부 예상질문)는 24,000원 결제한 학생만 — 학습 화면은 생기부 예상질문(/interview)에서도 같이 쓴다 (StudyView)
 */
// 생수면 색 — 남색 sm-navy(#172554) · 주황 sm-orange(#F97316) · 배경 #F4F5F7 (홈 화면과 같게) · 화면 배치는 비커스 기출문제처럼
const NAVY = "#172554";
const TRACKS = ["학생부종합", "학생부교과", "실기/실적"];
const MAIN_TYPES = ["자기소개", "지원동기", "생기부 질문", "공통·인성", "제시문"];
const norm = (s) => String(s ?? "").replace(/\s/g, "").replace(/대학교$/, "대").replace(/대학$/, "대");
// 대학 이름 맞추기 — "단국대학교(죽전)" · "단국대" · "단국대학교" 를 같은 대학으로
const base = (s) => norm(String(s ?? "").replace(/\(.*?\)/g, ""));
// 학과 이름 맞추기 — "외식조리학부 - 외식조리전공" · "간호학과" · "간호"
const dkey = (s) => String(s ?? "").replace(/\s|-|·/g, "").replace(/(학과|학부|전공|과)$/g, "");
const PAGE = 100000; // 문제는 처음부터 전부 보여 준다 (학교·학과마다 기출 수가 달라서 끊지 않는다)

// 표에서 전부 가져오기 — Supabase 는 한 번에 1,000줄까지만 주므로 1,000줄씩 나눠서 (큰 대학은 기출이 1,000개가 넘는다)
async function fetchAll(make, max = 10000) {
  let out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error || !data) break;
    out = out.concat(data);
    if (data.length < 1000) break;
  }
  return out;
}

// 서버 함수 부르기 — 실패해도 { error } 로 받는다
async function call(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (!error) return data ?? {};
  try {
    return (await error.context?.json?.()) ?? { error: "잠시 후 다시 해 주세요" };
  } catch {
    return { error: "잠시 후 다시 해 주세요" };
  }
}

/*
 * 답변 PDF — 답을 쓴 문제의 '질문 + 마지막 답변'만 (5문제 이상 쓰면 열림) · 기출문제 PDF / 생기부 예상질문 PDF 따로 (학교별로 묶음)
 * 새 창에 인쇄용 화면을 열고 인쇄 → 'PDF로 저장' (생기부 예상질문 PDF와 같은 방식)
 */
function printAnswers({ title, sub, groups }) {
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const body = groups.map((g) => {
    let n = 0;
    return `<section><h2>${esc(g.name)}</h2>${g.rows.map((r) => `<article><h3><span class="n">${++n}</span>${esc(r.q)}</h3><p>${esc(r.answer)}</p></article>`).join("")}</section>`;
  }).join("");
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 16mm; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; color: #111; margin: 0; }
header { border-bottom: 2px solid #172554; padding-bottom: 10px; margin-bottom: 6px; }
h1 { font-size: 20px; margin: 0; color: #172554; }
.sub { font-size: 12px; color: #555; margin-top: 4px; }
h2 { font-size: 14.5px; color: #172554; margin: 18px 0 4px; padding: 5px 10px; background: #EEF1FA; border-radius: 6px; }
article { padding: 10px 2px; border-bottom: 1px solid #E5E7EB; page-break-inside: avoid; }
h3 { font-size: 13.5px; margin: 0 0 6px; line-height: 1.5; display: flex; gap: 8px; }
.n { flex: none; width: 20px; color: #F97316; font-weight: 800; }
p { margin: 0 0 0 28px; font-size: 12.5px; line-height: 1.75; white-space: pre-line; color: #333; }
footer { margin-top: 16px; text-align: center; font-size: 11px; color: #888; }
</style></head><body><header><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></header>${body}
<footer>생수면 · 수시 면접 준비</footer></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return window.alert("팝업이 막혔어요. 주소창 오른쪽에서 팝업을 허용해 주세요.");
  w.document.open();
  w.document.write(html);
  w.document.close();
  let done = false;
  const go = () => { if (done) return; done = true; w.focus(); w.print(); };
  w.onload = go;
  setTimeout(go, 700);
}

/* 목표 학교 카드 */
function SchoolCard({ t, active, onClick, onDelete, locked = false }) {
  return (
    <div
      role="button"
      onClick={onClick}
      className={`relative flex h-[150px] w-[230px] flex-none cursor-pointer flex-col justify-between rounded-2xl bg-white p-4 text-left sm:w-[260px] ${active ? "border-2 border-sm-navy shadow-[0_6px_16px_rgba(20,27,61,.08)]" : "border border-gray-200 hover:border-gray-300"}`}
    >
      <div className="flex items-start gap-3 pr-6">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#F4F5F7] text-[14px] font-extrabold text-sm-navy">{t.university.slice(0, 1)}</span>
        <div className="min-w-0">
          <b className="block truncate text-[14.5px] font-bold text-gray-900">{t.university}</b>
          <small className="block truncate text-[12.5px] text-gray-500">{t.department || "학과 미정"}</small>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <small className="text-[12.5px] font-semibold text-gray-500">{t.track || "전형 미정"}</small>
        {locked && <small className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-500">🔒 결제 후 열림</small>}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute right-3 top-3 p-1 text-gray-300 hover:text-red-500"
        aria-label="목표 학교 빼기"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
      </button>
    </div>
  );
}

/* 목표 학교 추가 창 */
function AddSheet({ open, onClose, onAdd, univs, major }) {
  const [u, setU] = useState("");
  const [d, setD] = useState("");
  const [tr, setTr] = useState("학생부종합");
  const [focus, setFocus] = useState(false);
  const [dfocus, setDfocus] = useState(false);
  const [udepts, setUdepts] = useState([]); // 고른 대학의 기출 학과 [{ name, n }]
  // 창을 새로 열 때마다 빈 칸으로 (지난번에 적던 대학·학과가 남지 않게)
  useEffect(() => {
    if (!open) return;
    setU("");
    setD(major || ""); // 내 희망 학과를 미리 넣어 둔다 (지우고 다른 학과를 골라도 됨)
    setTr("학생부종합");
    setUdepts([]);
  }, [open]);
  const hits = useMemo(() => {
    const v = u.replace(/\s/g, "");
    return v && focus ? univs.filter((x) => x.replace(/\s/g, "").includes(v)).slice(0, 6) : [];
  }, [u, focus, univs]);
  // 대학을 고르면 — 그 대학 기출이 있는 학과 목록 (기출 많은 순)
  useEffect(() => {
    const name = univs.find((x) => x === u.trim());
    if (!name) return setUdepts([]);
    let alive = true;
    fetchAll(() => supabase.from("univ_interview_questions").select("department,track").eq("university", name)).then((data) => {
      if (!alive) return;
      const m = {};
      for (const r of data ?? []) {
        if (!r.department) continue;
        const x = (m[r.department] ??= { n: 0, tracks: {} });
        x.n += 1;
        if (r.track) x.tracks[r.track] = (x.tracks[r.track] ?? 0) + 1;
      }
      // 학과마다 기출이 있는 전형 (많은 순) — 학교마다 전형 이름이 달라서 엑셀 그대로
      setUdepts(Object.entries(m).map(([name, x]) => ({ name, n: x.n, tracks: Object.entries(x.tracks).sort((a, b) => b[1] - a[1]).map(([t]) => t) })).sort((a, b) => b.n - a.n));
    });
    return () => { alive = false; };
  }, [u, univs]);
  // 학과 자동 완성 — 이 대학에서 기출이 있는 학과만
  const dhits = useMemo(() => {
    if (!dfocus) return [];
    const v = d.replace(/\s/g, "");
    // 아무것도 안 쳤으면 이 대학 학과 전부 (스크롤), 치면 맞는 것만
    // 기출이 있는 학과만 (숫자가 붙은 것만)
    return udepts.filter((x) => !v || x.name.replace(/\s/g, "").includes(v)).slice(0, 100).map((x) => ({ name: x.name, sub: `기출 ${x.n}개` }));
  }, [d, dfocus, udepts]);
  // 전형 — 학과를 정해야 나온다. 그 학교·학과 기출에 있는 전형으로 (자료가 없으면 기본 3개)
  const deptHit = d.trim() ? udepts.find((x) => x.name === d.trim()) : null;
  const trackOpts = deptHit?.tracks?.length ? deptHit.tracks : TRACKS;
  useEffect(() => {
    if (d.trim() && !trackOpts.includes(tr)) setTr(trackOpts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, udepts]);
  if (!open) return null;
  const ok = u.trim().length >= 2 && d.trim().length >= 2;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <b className="text-[17px] font-extrabold" style={{ color: NAVY }}>목표 학교 추가</b>
          <button onClick={onClose} className="text-[24px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>
        <p className="mt-3 text-[12.5px] font-bold text-gray-500">대학</p>
        <div className="relative mt-1">
          <input value={u} onChange={(e) => setU(e.target.value.slice(0, 30))} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
            placeholder="예: 호서대학교" className="h-11 w-full rounded-xl border border-gray-200 px-3 text-[14px] outline-none focus:border-sm-navy" />
          {hits.length > 0 && !(hits.length === 1 && hits[0] === u) && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
              {hits.map((h) => (
                <li key={h}><button type="button" onMouseDown={() => setU(h)} className="block w-full px-3 py-2 text-left text-[13.5px] hover:bg-gray-50">{h}</button></li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-3 text-[12.5px] font-bold text-gray-500">학과</p>
        <div className="relative mt-1">
          <input value={d} onChange={(e) => setD(e.target.value.slice(0, 30))} onFocus={() => setDfocus(true)} onBlur={() => setTimeout(() => setDfocus(false), 150)}
            placeholder="예: 간호학과"
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-[14px] outline-none focus:border-sm-navy" />
          {dhits.length > 0 && !(dhits.length === 1 && dhits[0].name === d) && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
              {dhits.map((h) => (
                <li key={h.name}>
                  <button type="button" onMouseDown={() => setD(h.name)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13.5px] hover:bg-gray-50">
                    <span>{h.name}</span>{h.sub && <small className="text-[11.5px] font-bold text-sm-orange">{h.sub}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {udepts.length > 0 && !d && <p className="mt-1 text-[11.5px] text-gray-400">학과 칸을 누르면 이 대학 기출이 있는 학과가 나와요</p>}
        {u.trim().length >= 2 && d.trim().length >= 2 && (
          <>
            <p className="mt-3 text-[12.5px] font-bold text-gray-500">전형 {deptHit?.tracks?.length ? <small className="font-medium text-gray-400">· {u.trim()} {d.trim()} 기출에 있는 전형</small> : null}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {trackOpts.map((x) => (
                <button key={x} onClick={() => setTr(x)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-bold ${tr === x ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-500"}`}>{x}</button>
              ))}
            </div>
          </>
        )}
        <button
          disabled={!ok}
          onClick={() => { onAdd({ university: u.trim(), department: d.trim(), track: tr }); setU(""); setD(""); }}
          className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          추가하기
        </button>
      </div>
    </div>
  );
}

/* ───── 기출문제 학습 (문제를 누르면 열리는 화면) — 비커스처럼 5단계
 *   Step 1 첫 답변 작성 (음성 입력 가능) → Step 2 답변 피드백 (AI)
 *   → Step 3 2차 업그레이드 (마지막 수정 — 답은 2번까지) → Step 4 최종 피드백 (AI) → Step 5 꼬리 질문 1개
 *   꼬리질문을 더 하고 싶으면 면접 꼬리질문 화면(/tail)으로 (대학·학과를 채워서)
 *   단계마다 prep_answers 에 저장 (sql/sm_84_prep_steps.sql) — 다시 열면 하던 단계부터 */
const STEPS = [
  { n: 1, t: "첫 답변 작성", icon: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" },
  { n: 2, t: "답변 피드백", icon: "M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" },
  { n: 3, t: "2차 업그레이드", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" },
  { n: 4, t: "최종 피드백", icon: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4" },
  { n: 5, t: "꼬리 질문", icon: "M6 4v8a4 4 0 004 4h9M15 12l4 4-4 4" },
];

/* 레이더 — 학교 평가요소 축 (3개 이상일 때) · 0~100 */
function Radar({ axes }) {
  const n = axes.length, R = 92, C = 130;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v];
  };
  const ring = (v) => axes.map((_, i) => pt(i, v).join(",")).join(" ");
  return (
    <svg viewBox="-60 -6 380 272" className="mx-auto w-full max-w-[340px]">
      {[0.25, 0.5, 0.75, 1].map((v) => <polygon key={v} points={ring(v)} fill="none" stroke="#E5E7EB" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#E5E7EB" />; })}
      {/* 목표선 70점 — 내 모양이 어디까지 왔는지 비교 */}
      <polygon points={ring(0.7)} fill="none" stroke="#F97316" strokeDasharray="4 4" strokeOpacity=".55" />
      <polygon points={axes.map((a, i) => pt(i, Math.max(0.04, a.score / 100)).join(",")).join(" ")} fill="rgba(52,211,153,.35)" stroke="#10B981" strokeWidth="1.5" />
      {/* 꼭짓점 점 (점수 숫자는 오른쪽 막대에) */}
      {axes.map((a, i) => {
        const [x, y] = pt(i, Math.max(0.04, a.score / 100));
        return <circle key={`d${i}`} cx={x} cy={y} r="3.2" fill="#10B981" />;
      })}
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1.2);
        return <text key={a.name} x={x} y={y} textAnchor={Math.abs(x - C) < 8 ? "middle" : x > C ? "start" : "end"} dominantBaseline="middle" fontSize="11.5" fill="#4B5563">{a.name}</text>;
      })}
    </svg>
  );
}

/* AI 피드백 — 학교별 답변 분석 기준 (univ_answer_guides)
 *   답변 정합성 분석(학교 평가요소 축) · 사유하는 질문 · AI 종합 분석 · 강점 포인트 · 개선 포인트 */
function Feedback({ fb, title, school }) {
  if (!fb) return null;
  const axes = Array.isArray(fb.axes) ? fb.axes : [];
  const strengths = fb.strengths ?? fb.good ?? [];
  const improvements = fb.improvements ?? fb.fix ?? [];
  const criteria = fb.criteria ?? fb.summary ?? "";
  const Head = ({ t, sub, badge }) => (
    <div>
      <p className="flex items-center gap-2 text-[16px] font-extrabold text-gray-900"><i className="h-2 w-2 rounded-full bg-sm-navy" />{t}{badge && <span className="rounded-full bg-[#EEF1FA] px-2 py-0.5 text-[11.5px] font-bold text-sm-navy">{badge}</span>}</p>
      {sub && <p className="mt-0.5 pl-4 text-[12.5px] text-gray-400">{sub}</p>}
    </div>
  );
  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[13px] font-bold text-gray-500">{title}{(fb.school || school) && <span className="ml-1 text-gray-400">· {fb.school || school} 기준</span>}</p>
        <b className="text-[28px] font-black leading-none text-sm-orange">{fb.score}<small className="text-[13px] font-bold text-gray-400">점</small></b>
      </div>
      {fb.changed && <p className="rounded-xl bg-emerald-50 p-3 text-[13.5px] font-bold text-emerald-700">나아진 점 · {fb.changed}</p>}

      {axes.length > 0 && (
        <section className="rounded-2xl border border-gray-200 p-4 sm:p-5">
          <Head t="답변 정합성 분석" badge={`${axes.length}축`} sub={`작성한 답변을 ${fb.school || school || "학교"} 핵심 평가 기준에 맞춰 분석한 결과예요.`} />
          <div className={`mt-3 grid items-center gap-4 ${axes.length >= 3 ? "sm:grid-cols-[1fr_1.1fr]" : ""}`}>
            {axes.length >= 3 && <div><Radar axes={axes} /><p className="text-center text-[11.5px] text-gray-400"><span className="text-emerald-600">● 내 답변</span> · <span className="text-sm-orange">--- 목표 70점</span></p></div>}
            <div className="grid gap-3">
              {axes.map((a) => (
                <div key={a.name}>
                  <div className="flex items-baseline justify-between text-[13.5px]">
                    <span className="text-gray-700">{a.name} <small className="text-[11.5px] text-gray-400">비중 {a.weight}%</small></span>
                    <b className="tabular-nums text-gray-500">{a.score}</b>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-gray-100"><i className="block h-full rounded-full bg-emerald-400" style={{ width: `${a.score}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {fb.questions?.length > 0 && (
        <section className="rounded-2xl border border-gray-200 p-4 sm:p-5">
          <Head t="사유하는 질문" sub="분석한 답변의 핵심 역량을 전략적으로 보완할 가이드예요." />
          <ol className="mt-3 grid gap-2">
            {fb.questions.map((q, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl bg-[#F3F6FD] px-3.5 py-3 text-[14px] leading-relaxed text-gray-800">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-sm-navy text-[12px] font-extrabold text-white">{i + 1}</span>{q}
              </li>
            ))}
          </ol>
        </section>
      )}

      {criteria && (
        <section>
          <Head t="AI 종합 분석" sub="평가 관점에서 본 답변의 정합성과 개선 방향이에요." />
          <div className="mt-3 rounded-2xl border border-gray-200 bg-[#F8F9FB] p-4">
            <p className="text-[13.5px] font-extrabold text-gray-900">평가 기준 요약</p>
            <p className="mt-1.5 text-[14px] leading-relaxed text-gray-700">{criteria}</p>
          </div>
        </section>
      )}

      {strengths.length > 0 && (
        <section className="rounded-2xl border border-gray-200 p-4">
          <p className="text-[14px] font-extrabold text-sm-navy">강점 포인트</p>
          <div className="mt-2 grid gap-1.5">{strengths.map((t, i) => <p key={i} className="text-[14px] leading-relaxed text-gray-700">“{t}”</p>)}</div>
        </section>
      )}
      {improvements.length > 0 && (
        <section className="rounded-2xl border border-gray-200 p-4">
          <p className="text-[14px] font-extrabold text-red-500">개선 포인트</p>
          <div className="mt-2 grid gap-1.5">{improvements.map((t, i) => <p key={i} className="text-[14px] leading-relaxed text-gray-700">“{t}”</p>)}</div>
        </section>
      )}
    </div>
  );
}

/*
 * 친구 초대 창 — 무료 기출 문제를 다 쓰면 (또는 '친구 초대'를 누르면)
 * 친구 1명이 내 추천 링크(?ref=코드)로 가입할 때마다 기출 5문제가 더 열린다
 * 친구 초대가 싫으면 결제: 기출문제만 = 한 달 이용권 12,900원(30일 무제한) · 생기부 예상질문까지 = 24,000원
 */
function InviteSheet({ open, onClose, quota, onRefresh, onBuyPass, onBuyInterview }) {
  const [code, setCode] = useState(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!open) return;
    setMsg("");
    onRefresh?.();
    supabase.rpc("get_my_referral").then(({ data }) => setCode((Array.isArray(data) ? data[0] : data)?.my_code ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const per = quota?.per_friend ?? 5;
  const link = code ? refLink(code) : "";
  const text = `수시 면접 대학별 기출문제, AI가 학교 기준으로 답변 피드백까지 해 줘요. 같이 준비하자!`;
  async function share() {
    track("prep_invite", code);
    if (navigator.share) {
      try { await navigator.share({ title: "생수면 면접 준비", text, url: link }); return; } catch { /* 취소하면 복사로 */ }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${link}`);
      setMsg("링크가 복사됐어요. 카톡이나 DM에 붙여넣어 친구에게 보내 주세요.");
    } catch {
      window.prompt("이 링크를 복사해 친구에게 보내 주세요", link);
    }
  }
  const empty = quota && quota.left <= 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-7 pt-6 text-center sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[13px] font-bold text-sm-orange">기출문제 학습</p>
        <p className="mt-1 text-[20px] font-extrabold text-sm-navy">{empty ? "무료 문제를 다 풀었어요" : `무료 문제 ${quota?.left ?? 0}개 남았어요`}</p>
        <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">
          친구 1명이 내 링크로 가입할 때마다
          <br />
          <b className="text-sm-orange">기출 {per}문제</b>가 더 열려요.
        </p>
        <button onClick={share} disabled={!link} className="mt-6 h-[56px] w-full rounded-xl bg-sm-orange text-[16.5px] font-extrabold text-white disabled:opacity-40">
          친구에게 공유하고 +{per}문제 받기
        </button>
        {msg && <p className="mt-3 text-[13.5px] font-bold text-sm-orange">{msg}</p>}
        <p className="mt-5 text-[13px] text-gray-500">
          가입한 친구 <b className="text-sm-navy">{quota?.friends ?? 0}명</b> · 지금까지 연 문제 {quota?.used ?? 0}/{quota?.limit ?? 3}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-400">
          친구가 가입하면 바로 열려요. 이미 연 문제는 2차 피드백 · 꼬리질문까지 계속 할 수 있어요.
        </p>

        {/* 친구 초대 대신 결제 */}
        <div className="mt-6 flex items-center gap-3 text-[12.5px] font-bold text-gray-400"><i className="h-px flex-1 bg-gray-200" />친구 초대 없이 바로 하기<i className="h-px flex-1 bg-gray-200" /></div>
        <div className="mt-3 grid gap-2 text-left">
          <button onClick={() => { track("prep_buy", "pass"); onBuyPass?.(); }} className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-gray-200 px-4 py-3 text-left hover:border-sm-navy">
            <span><b className="block text-[14.5px] font-extrabold text-gray-900">기출문제만</b><small className="text-[12.5px] text-gray-500">한 달 동안 기출 무제한</small></span>
            <b className="flex-none text-[16px] font-black text-sm-navy">{PASS_PRICE.toLocaleString()}원</b>
          </button>
          <button onClick={() => { track("prep_buy", "interview"); onBuyInterview?.(); }} className="relative flex items-center justify-between gap-3 rounded-xl border-2 border-sm-navy bg-[#EEF1FA] px-4 py-3 text-left">
            <span className="absolute -top-2.5 right-3 rounded-full bg-sm-orange px-2 py-0.5 text-[10.5px] font-bold text-white">추천</span>
            <span><b className="block text-[14.5px] font-extrabold text-gray-900">기출 + 생기부 예상질문</b><small className="text-[12.5px] text-gray-500">기출 무제한 · 내 생기부 질문 · 질문마다 답변 연습</small></span>
            <b className="flex-none text-[16px] font-black text-sm-navy">24,000원</b>
          </button>
        </div>
        <button onClick={onClose} className="mt-4 h-10 w-full text-[13.5px] font-semibold text-gray-500">닫기</button>
      </div>
    </div>
  );
}

/*
 * 학교 결제 창 — 기출문제 학습은 학교 1곳만 무료 (처음 AI 피드백을 받은 학교) · 결제하면 6곳까지
 *   목표 학교를 더 넣으려 하거나, 무료가 아닌 학교의 기출을 열 때
 */
function SchoolPaySheet({ open, onClose, freeUniv, univ, onBuyPass, onBuyInterview }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-7 pt-6 text-center sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[13px] font-bold text-sm-orange">기출문제 학습</p>
        <p className="mt-1 text-[20px] font-extrabold text-sm-navy">무료는 학교 1곳이에요</p>
        <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">
          {freeUniv ? <><b className="text-gray-900">{freeUniv}</b> 1곳은 무료로 연습할 수 있어요.<br /></> : null}
          {univ ? <><b className="text-gray-900">{univ}</b> 기출은 결제하면 열려요.</> : "목표 학교를 더 넣으려면 결제가 필요해요."}
          <br />
          결제하면 <b className="text-sm-orange">학교 6곳까지</b> 기출을 무제한으로 연습해요.
        </p>
        <div className="mt-6 grid gap-2 text-left">
          <button onClick={() => { track("prep_buy", "school_pass"); onBuyPass?.(); }} className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-gray-200 px-4 py-3 text-left hover:border-sm-navy">
            <span><b className="block text-[14.5px] font-extrabold text-gray-900">기출문제만</b><small className="text-[12.5px] text-gray-500">한 달 · 학교 6곳 · 기출 무제한</small></span>
            <b className="flex-none text-[16px] font-black text-sm-navy">{PASS_PRICE.toLocaleString()}원</b>
          </button>
          <button onClick={() => { track("prep_buy", "school_interview"); onBuyInterview?.(); }} className="relative flex items-center justify-between gap-3 rounded-xl border-2 border-sm-navy bg-[#EEF1FA] px-4 py-3 text-left">
            <span className="absolute -top-2.5 right-3 rounded-full bg-sm-orange px-2 py-0.5 text-[10.5px] font-bold text-white">추천</span>
            <span><b className="block text-[14.5px] font-extrabold text-gray-900">기출 + 생기부 예상질문</b><small className="text-[12.5px] text-gray-500">학교 6곳 · 기출 무제한 · 내 생기부 질문 연습</small></span>
            <b className="flex-none text-[16px] font-black text-sm-navy">24,000원</b>
          </button>
        </div>
        <button onClick={onClose} className="mt-4 h-10 w-full text-[13.5px] font-semibold text-gray-500">닫기</button>
      </div>
    </div>
  );
}

/*
 * 문제 학습 5단계 — 기출문제 학습(/prep)과 생기부 예상질문(/interview)이 같이 쓴다
 *   source: "past"(기출 · 무료 문제 수) | "interview"(생기부 예상질문 · 결제한 학생)
 *   onNeedInvite: 무료 문제를 다 썼을 때 · onNeedPay: 예상질문인데 결제 전 · onQuota: 남은 문제 수가 바뀌었을 때
 */
export function StudyView({ item, target, row, onSaved, onBack, onNeedInvite, onNeedPay, onNeedSchoolPay, onQuota, source = "past" }) {
  const [step, setStep] = useState(Math.min(5, Math.max(1, row?.step ?? 1)));
  const [reached, setReached] = useState(Math.min(5, Math.max(1, row?.step ?? 1)));
  const [d1, setD1] = useState(row?.draft1 ?? row?.answer ?? "");
  const [fb1, setFb1] = useState(row?.feedback1 ?? null);
  const [d2, setD2] = useState(row?.draft2 ?? row?.draft1 ?? row?.answer ?? "");
  const [fb2, setFb2] = useState(row?.feedback2 ?? null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [listening, setListening] = useState(false);
  const [tailQ, setTailQ] = useState(row?.feedback2?.tail ?? null); // 꼬리질문 1개 { q, why, tip } — 최종 피드백에 같이 저장
  const [tailDone, setTailDone] = useState(false);
  const nav = useNavigate();
  const [reply, setReply] = useState("");
  const recRef = useRef(null);

  useEffect(() => () => recRef.current?.stop?.(), []);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // 음성 입력 — 브라우저 음성 인식 (크롬·엣지·사파리) · 말한 내용을 지금 칸 끝에 붙인다
  function voice(setter) {
    if (listening) { recRef.current?.stop?.(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return setErr("이 브라우저는 음성 입력이 안 돼요. 크롬이나 사파리에서 해 주세요");
    const rec = new SR();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
      if (t.trim()) setter((v) => (v.trim() ? `${v.trim()} ${t.trim()}` : t.trim()).slice(0, 1500));
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") setErr("마이크 사용을 허용해 주세요"); };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setErr("");
    setListening(true);
    rec.start();
  }

  async function save(patch) {
    const body = { university: target.university, question: item.q, updated_at: new Date().toISOString(), ...patch };
    const { error } = await supabase.from("prep_answers").upsert(body, { onConflict: "user_id,university,question" });
    if (error) {
      // sm_84 를 아직 안 돌렸으면 기본 칸만 저장
      if (patch.answer) await supabase.from("prep_answers").upsert({ university: target.university, question: item.q, answer: patch.answer, updated_at: body.updated_at }, { onConflict: "user_id,university,question" });
    }
    onSaved({ ...(row ?? {}), ...body });
  }

  async function feedback(round) {
    const answer = (round === 1 ? d1 : d2).trim();
    if (answer.length < 15) return setErr("실제로 말하듯 15자 이상 적어 주세요");
    if ((answer.match(/[가-힣a-zA-Z]/g) ?? []).length < 10) return setErr("실제로 말하듯 문장으로 답해 주세요 (자음·모음만 쓴 답은 볼 수 없어요)");
    recRef.current?.stop?.();
    setBusy(round === 1 ? "AI가 답변을 읽고 피드백을 쓰는 중…" : "AI가 고친 답변을 다시 보는 중…");
    setErr("");
    const r = await call("agent", { action: "answer_feedback", source, university: target.university, department: target.department, question: item.q, kind: item.kind, answer, round, prev: round === 2 ? fb1 : undefined });
    setBusy("");
    if (r.quota) onQuota?.(r.quota);
    if (r.need_invite) return onNeedInvite?.();
    if (r.need_school_pay) return onNeedSchoolPay?.();
    if (r.need_interview_pay) return onNeedPay?.();
    if (r.error || !r.feedback) return setErr(r.error ?? "피드백을 만들지 못했어요");
    if (round === 1) {
      setFb1(r.feedback);
      if (!d2.trim() || d2 === row?.draft1) setD2(answer);
      await save({ answer, draft1: answer, feedback1: r.feedback, step: 2 });
      setReached((n) => Math.max(n, 2));
      setStep(2);
    } else {
      setFb2(r.feedback);
      await save({ answer, draft2: answer, feedback2: r.feedback, step: 4 });
      setReached((n) => Math.max(n, 4));
      setStep(4);
    }
  }

  async function startTail() {
    setStep(5);
    setReached(5);
    if (tailQ) return; // 꼬리질문은 문제마다 1개 — 이미 받았으면 그대로 보여 준다
    const answer = (d2 || d1).trim();
    setBusy(`${target.university} 면접관이 꼬리질문을 고르는 중…`);
    setErr("");
    const mainType = MAIN_TYPES.includes(item.tail_type) ? item.tail_type : MAIN_TYPES.includes(item.kind) ? item.kind : "생기부 질문";
    // 문제마다 꼬리질문 1개 — 서버 agent 가 tail 을 대신 불러 꼬리질문 무료 개수를 쓰지 않는다
    const r = await call("agent", { action: "study_tail", source, univ: target.university, department: target.department || "미정", main_type: mainType, main_q: item.q, answer });
    setBusy("");
    if (r.need_interview_pay) return onNeedPay?.();
    const t = (r.turns ?? []).find((x) => x.q) ?? r.turn;
    if (r.error || !t?.q) return setErr(r.error ?? "꼬리질문을 만들지 못했어요");
    const tq = { q: t.q, why: t.why ?? "", tip: t.tip ?? "" };
    setTailQ(tq);
    save({ step: 5, feedback2: { ...(fb2 ?? {}), tail: tq } });
  }

  const head = "flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4";
  const mic = (setter) => (
    <button onClick={() => voice(setter)} className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-extrabold text-white ${listening ? "bg-red-500" : "bg-emerald-500 hover:bg-emerald-600"}`}>
      {listening ? <><i className="h-2 w-2 animate-pulse rounded-full bg-white" />멈추기</> : <>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>음성 입력</>}
    </button>
  );
  const box = (value, setter, ph) => (
    <>
      <textarea value={value} onChange={(e) => setter(e.target.value.slice(0, 1500))} placeholder={ph}
        className="min-h-[300px] w-full flex-1 resize-none rounded-xl border border-gray-200 p-4 text-[15px] leading-relaxed outline-none focus:border-sm-navy" />
      <p className="mt-1.5 text-right text-[12px] text-gray-400">{value.trim().length}자 · 1분 답변은 보통 250~350자{listening ? " · 듣고 있어요…" : ""}</p>
    </>
  );

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-9">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-extrabold tracking-tight text-gray-900 sm:text-[28px]">{source === "interview" ? "예상질문 학습" : "기출문제 학습"}</h1>
            <p className="mt-1 text-[13.5px] text-gray-500">{target.university} {target.department}</p>
          </div>
          <button onClick={onBack} className="flex h-10 items-center gap-1 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-bold text-gray-700 hover:border-gray-300">‹ 목록으로</button>
        </div>

        {/* 단계 */}
        <div className="relative mt-7 grid grid-cols-5">
          <div className="absolute left-[10%] right-[10%] top-6 h-px bg-gray-200" />
          {STEPS.map((s) => {
            const on = s.n === step, ok = s.n <= reached;
            return (
              <button key={s.n} disabled={!ok} onClick={() => (s.n === 5 ? startTail() : setStep(s.n))} className="relative flex flex-col items-center text-center disabled:cursor-default">
                <span className={`flex h-12 w-12 items-center justify-center rounded-full ${on ? "bg-sm-navy text-white" : ok ? "bg-orange-50 text-sm-orange" : "bg-gray-100 text-gray-400"}`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
                </span>
                <b className={`mt-2 text-[13px] sm:text-[15px] ${on ? "text-gray-900" : "text-gray-400"}`}>Step {s.n}</b>
                <small className={`hidden text-[13px] sm:block ${on ? "text-gray-700" : "text-gray-400"}`}>{s.t}</small>
              </button>
            );
          })}
        </div>

        {/* 질문 */}
        <div className="mt-6 rounded-2xl border border-[#E3E7F3] bg-[#EEF1FA] px-5 py-4">
          <p className="text-[13px] font-bold text-sm-navy">⚑ 질문 <span className="ml-1 font-semibold text-gray-500">{item.badge}{item.kind ? ` · ${item.kind}` : ""}</span></p>
          <p className="mt-1.5 text-[17px] font-extrabold leading-snug text-gray-900 sm:text-[19px]">{item.q}</p>
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

        {/* 답변은 2번 (첫 답변 · 2차 업그레이드) → 최종 피드백 → 꼬리질문 1개 */}
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white">
          {step === 1 && (
            <>
              <div className={head}>
                <b className="text-[15px] font-bold text-gray-900">답변 작성 <small className="ml-1 font-semibold text-gray-400">1/2</small></b>
                {!fb1 && mic(setD1)}
              </div>
              <div className="flex flex-col p-5">
                {fb1 ? (
                  <><p className="mb-2 text-[12.5px] font-bold text-gray-400">이미 피드백을 받은 첫 답변이에요</p><p className="whitespace-pre-line rounded-xl bg-[#F8F9FB] p-4 text-[15px] leading-relaxed text-gray-800">{d1}</p></>
                ) : (
                  <>
                    {box(d1, setD1, "답변을 작성해 주세요. (음성 입력을 누르고 말해도 돼요)")}
                    <button onClick={() => feedback(1)} disabled={Boolean(busy) || d1.trim().length < 15} className="mt-3 h-12 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                      {busy || "AI 피드백 받기"}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className={head}><b className="text-[15px] font-bold text-gray-900">답변 피드백</b></div>
              <div className="flex flex-col p-5">
                <p className="mb-4 whitespace-pre-line rounded-xl bg-[#F8F9FB] p-4 text-[14px] leading-relaxed text-gray-700"><b className="text-gray-900">내 첫 답변</b> · {d1}</p>
                <Feedback fb={fb1} title="AI 1차 피드백" />
                {!fb2 && <button onClick={() => { setStep(3); setReached((n) => Math.max(n, 3)); }} className="mt-5 h-12 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white transition-opacity hover:opacity-90">2차 답변 쓰기 (마지막 수정)</button>}
              </div>
            </>
          )}
          {step === 3 && (
            <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-gray-100">
              {/* 왼쪽: 1차 AI 피드백을 보면서 */}
              <div className="border-b border-gray-100 lg:border-b-0">
                <div className={head}><b className="text-[15px] font-bold text-gray-900">1차 AI 피드백 <small className="ml-1 font-semibold text-gray-400">보면서 고쳐 쓰세요</small></b></div>
                <div className="p-5 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
                  <p className="mb-4 whitespace-pre-line rounded-xl bg-[#F8F9FB] p-4 text-[14px] leading-relaxed text-gray-700"><b className="text-gray-900">내 첫 답변</b> · {d1}</p>
                  {fb1 ? <Feedback fb={fb1} title="AI 1차 피드백" /> : <p className="text-[13.5px] text-gray-400">1차 피드백이 아직 없어요.</p>}
                </div>
              </div>
              {/* 오른쪽: 2차 답변 작성 */}
              <div className="lg:sticky lg:top-4 lg:self-start">
              <div className={head}>
                <b className="text-[15px] font-bold text-gray-900">2차 업그레이드 <small className="ml-1 font-semibold text-gray-400">2/2 · 마지막 수정</small></b>
                {!fb2 && mic(setD2)}
              </div>
              <div className="flex flex-col p-5">
                {fb2 ? (
                  <><p className="mb-2 text-[12.5px] font-bold text-gray-400">이미 제출한 2차 답변이에요</p><p className="whitespace-pre-line rounded-xl bg-[#F8F9FB] p-4 text-[15px] leading-relaxed text-gray-800">{d2}</p></>
                ) : (
                  <>
                    {box(d2, setD2, "피드백을 보며 답을 고쳐 써 보세요. 이번이 마지막 수정이에요.")}
                    <button onClick={() => feedback(2)} disabled={Boolean(busy) || d2.trim().length < 15} className="mt-3 h-12 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                      {busy || "최종 피드백 받기"}
                    </button>
                  </>
                )}
              </div>
              </div>
            </div>
          )}
          {step === 4 && (
            <>
              <div className={head}><b className="text-[15px] font-bold text-gray-900">최종 피드백</b>{fb1 && fb2 && <small className="text-[12.5px] font-bold text-gray-500">{fb1.score}점 → <b className="text-sm-orange">{fb2.score}점</b></small>}</div>
              <div className="flex flex-col p-5">
                <p className="mb-4 whitespace-pre-line rounded-xl bg-[#F8F9FB] p-4 text-[14px] leading-relaxed text-gray-700"><b className="text-gray-900">내 최종 답변</b> · {d2}</p>
                <Feedback fb={fb2} title="AI 최종 피드백" />
                <button onClick={startTail} className="mt-5 h-12 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white transition-opacity hover:opacity-90">꼬리 질문 받기</button>
              </div>
            </>
          )}
          {step === 5 && (
            <>
              <div className={head}><b className="text-[15px] font-bold text-gray-900">꼬리 질문 <small className="ml-1 font-semibold text-gray-400">1개</small></b>{tailQ && !tailDone && mic(setReply)}</div>
              <div className="flex flex-col p-5">
                <p className="mb-4 whitespace-pre-line rounded-xl bg-[#F8F9FB] p-4 text-[14px] leading-relaxed text-gray-700"><b className="text-gray-900">내 최종 답변</b> · {d2 || d1}</p>
                {busy && <p className="text-[13px] text-gray-400">{busy}</p>}
                {tailQ && (
                  <div className="rounded-xl border border-[#E3E7F3] bg-[#EEF1FA] p-4">
                    <small className="text-[11.5px] font-bold text-sm-navy">{target.university} 면접관</small>
                    <p className="mt-0.5 text-[16px] font-bold leading-snug text-gray-900">{tailQ.q}</p>
                    {tailQ.why && <p className="mt-1.5 text-[12.5px] text-gray-600"><b>확인하려는 것</b> · {tailQ.why}</p>}
                    {tailQ.tip && <p className="mt-0.5 text-[12.5px] text-gray-600"><b>답할 때</b> · {tailQ.tip}</p>}
                  </div>
                )}
                {tailQ && !tailDone && (
                  <>
                    <textarea value={reply} onChange={(e) => setReply(e.target.value.slice(0, 1200))} rows={4} placeholder="꼬리질문에 실제로 말하듯 답해 보세요"
                      className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-3 text-[15px] leading-relaxed outline-none focus:border-sm-navy" />
                    <button onClick={() => { if (reply.trim().length < 15) return setErr("실제로 말하듯 15자 이상 적어 주세요"); recRef.current?.stop?.(); setErr(""); setTailDone(true); }}
                      disabled={reply.trim().length < 15} className="mt-2 h-12 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                      답변 완료
                    </button>
                  </>
                )}
                {tailDone && (
                  <div className="mt-3 rounded-xl bg-emerald-50 p-4 text-center">
                    <p className="text-[15px] font-extrabold text-emerald-700">이 문제 연습 끝!</p>
                    {reply && <p className="mt-2 whitespace-pre-line text-left text-[13.5px] leading-relaxed text-gray-700"><b>내 꼬리질문 답</b> · {reply}</p>}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={onBack} className="h-11 rounded-xl border-[1.5px] border-sm-navy text-[14px] font-extrabold text-sm-navy">다른 문제 풀기</button>
                      <button onClick={() => nav(`/tail?univ=${encodeURIComponent(target.university)}&dept=${encodeURIComponent(target.department ?? "")}`)} className="h-11 rounded-xl bg-sm-navy text-[14px] font-extrabold text-white">꼬리질문 더 연습하기</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default function Prep() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const major = user?.user_metadata?.major ?? "";
  const [targets, setTargets] = useState(null); // null = 불러오는 중
  const [cur, setCur] = useState(0);
  const [univs, setUnivs] = useState([]);
  const [bankUnivs, setBankUnivs] = useState(null); // 기출 표에 있는 대학 이름
  const [bank, setBank] = useState({}); // 목표 학교 → 기출 표 질문들 | "load"
  const [shown, setShown] = useState(PAGE); // 화면에 보이는 문제 수 ('더 보기')
  const [tab, setTab] = useState("past"); // past = 기출문제 · mine = 생기부 예상질문
  const [brief, setBrief] = useState({}); // 대학 → { past, rules, style, tracks } | "load"
  const [mine, setMine] = useState([]); // 내 예상질문 결과 [{ university, title, questions }]
  const [answers, setAnswers] = useState({}); // "대학|질문" → { answer, draft1, feedback1, draft2, feedback2, step }
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null); // 답변 창 { ...item, tail }
  const [info, setInfo] = useState(false); // '이 대학 면접 한눈에' 펼침
  const [quota, setQuota] = useState(null); // 기출 무료 문제 { used, limit, left, friends, per_friend, interview_paid }
  const [invite, setInvite] = useState(false); // 친구 초대 창
  const [buy, setBuy] = useState(false); // 이용권 결제 창 (기출 무제한)
  const [schoolPay, setSchoolPay] = useState(null); // 학교 결제 창 { univ } — 무료는 학교 1곳
  const [notice, setNotice] = useState("");
  const [pdfHint, setPdfHint] = useState(false); // PDF 안내 창 (5문제 이상 쓰면 열림)
  const rowRef = useRef(null);

  // 처음 — 목표 학교 · 내 예상질문 · 답변 · 이용권
  useEffect(() => {
    if (!user) return;
    // 자동 완성 — 기출 표에 있는 대학 + 꼬리질문 자료가 있는 대학
    Promise.all([supabase.from("univ_interview_univs").select("university").limit(500), supabase.rpc("tail_univs")]).then(([a, t]) => {
      const names = (a.data ?? []).map((r) => r.university);
      setBankUnivs(names);
      setUnivs([...new Set([...names, ...(t.data ?? [])])]);
    });
    loadQuota();
    (async () => {
      const [tg, iq, an] = await Promise.all([
        supabase.from("prep_targets").select("id,university,department,track").order("created_at"),
        supabase.from("interview_queries").select("university,department,targets,result,status").neq("status", "failed").order("created_at", { ascending: false }).limit(30),
        supabase.from("prep_answers").select("*"),
      ]);
      // 내가 뽑은 예상질문 (대학별)
      const my = [];
      for (const q of iq.data ?? []) {
        const rs = q.result?.results ?? (q.result?.groups ? [q.result] : []);
        for (const r of rs) for (const g of r?.groups ?? []) my.push({ university: r.university ?? q.university, department: r.department ?? q.department ?? "", title: g.title, questions: g.questions ?? [] });
      }
      setMine(my);
      setAnswers(Object.fromEntries((an.data ?? []).map((a) => [`${a.university}|${a.question}`, a])));
      let list = tg.data ?? [];
      // 처음 오면 — 예전에 예상질문을 뽑은 대학을 목표 학교로 넣어 둔다
      if (!tg.error && !list.length) {
        const seen = new Set();
        const seed = [];
        for (const q of iq.data ?? []) {
          for (const t of q.targets?.length ? q.targets : [{ university: q.university, department: q.department }]) {
            if (t?.university && !seen.has(t.university) && seed.length < 6) {
              seen.add(t.university);
              seed.push({ university: t.university, department: t.department ?? "", track: "학생부종합" });
            }
          }
        }
        if (seed.length) {
          const { data } = await supabase.from("prep_targets").insert(seed).select("id,university,department,track");
          list = data ?? seed;
        }
      }
      setTargets(list);
      // 목표 학교 추가 창은 처음 한 번만 저절로 뜬다 (그 뒤로는 '+ 목표 학교 추가'를 눌렀을 때만)
      let first = true;
      try {
        first = !localStorage.getItem("sm_prep_add_seen");
        localStorage.setItem("sm_prep_add_seen", "1");
      } catch {
        first = false;
      }
      if (!list.length && first) setAdding(true);
    })();
  }, [user]);

  const sel = targets?.[cur] ?? null;

  // 고른 학교의 기출 (기출 표 · 한 번만)
  useEffect(() => {
    if (!sel || bankUnivs === null) return;
    const key = sel.university;
    if (bank[key]) return;
    setShown(PAGE);
    const canon = bankUnivs.find((u) => u === key) ?? bankUnivs.find((u) => base(u) === base(key)) ?? bankUnivs.find((u) => base(u).startsWith(base(key)) || base(key).startsWith(base(u)));
    if (!canon) return setBank((m) => ({ ...m, [key]: [] }));
    setBank((m) => ({ ...m, [key]: "load" }));
    fetchAll(() => supabase.from("univ_interview_questions").select("department,track,question,kind,tail_type,cnt").eq("university", canon).order("cnt", { ascending: false }).order("id"))
      .then((data) => setBank((m) => ({ ...m, [key]: data })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.university, bankUnivs]);
  useEffect(() => setShown(PAGE), [cur]);

  // 고른 학교의 기출·면접 정보 (한 번만)
  useEffect(() => {
    if (!sel || brief[sel.university]) return;
    setBrief((b) => ({ ...b, [sel.university]: "load" }));
    call("agent", { action: "univ_brief", university: sel.university, department: sel.department }).then((d) =>
      setBrief((b) => ({ ...b, [sel.university]: d && !d.error ? d : { past: [], error: true } }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.university]);

  const b = sel ? brief[sel.university] : null;

  // 문제 목록 = 내 학과 기출(많이 나온 순) + 내 예상질문 + (모자라면) 같은 대학 다른 학과 기출
  //   기출 표에 이 대학이 없으면 서버가 준 기출(tail_examples) · 공통 기출
  const rowsOf = sel ? bank[sel.university] : null;
  const items = useMemo(() => {
    if (!sel || rowsOf === "load" || rowsOf === undefined) return [];
    const out = [];
    const seen = new Set();
    const push = (it) => {
      const k = String(it.q).replace(/[\s?.!~]/g, "");
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(it);
    };
    const times = (n) => (n > 1 ? `${n}번 나옴` : "");
    const rows = Array.isArray(rowsOf) ? rowsOf : [];
    // 내 학과 기출만 — 이름이 딱 맞는 학과 먼저, 없으면 비슷한 이름 (다른 학과 · 공통 기출로 채우지 않는다)
    const dk = dkey(sel.department);
    let mineRows = dk ? rows.filter((r) => dkey(r.department) === dk) : [];
    if (dk && !mineRows.length) mineRows = rows.filter((r) => { const d = dkey(r.department); return d && (d.includes(dk) || dk.includes(d)); });
    for (const r of mineRows) push({ q: r.question, kind: r.kind, tail_type: r.tail_type, badge: "기출", sub: [times(r.cnt), r.track].filter(Boolean).join(" · ") });
    return out;
  }, [sel, rowsOf]);
  // 생기부 예상질문 탭 — 위 카드는 '예상질문을 뽑은 학교'로 바뀐다 (목표 학교와 따로 · 24,000원 상품)
  const mineSchools = useMemo(() => {
    const m = new Map();
    for (const g of mine) {
      const k = `${base(g.university)}|${g.department ?? ""}`;
      const x = m.get(k) ?? { university: g.university, department: g.department ?? "", n: 0, qs: new Set() };
      for (const q of g.questions) x.qs.add(String(q).replace(/[\s?.!~]/g, ""));
      x.n = x.qs.size;
      m.set(k, x);
    }
    return [...m.values()];
  }, [mine]);
  const [mineCur, setMineCur] = useState(0);
  const mineSel = mineSchools[mineCur] ?? mineSchools[0] ?? null;
  const mineItems = useMemo(() => {
    if (!mineSel) return [];
    const seen = new Set();
    const out = [];
    for (const g of mine.filter((x) => base(x.university) === base(mineSel.university) && (x.department ?? "") === mineSel.department)) {
      for (const q of g.questions) {
        const k = String(q).replace(/[\s?.!~]/g, "");
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push({ q, kind: "생기부 질문", tail_type: "생기부 질문", badge: "예상", sub: g.title, target: { university: mineSel.university, department: mineSel.department } });
      }
    }
    return out;
  }, [mine, mineSel]);
  const mineCount = mineSchools.reduce((n, x) => n + x.n, 0);
  const myDeptCount = items.filter((it) => it.badge === "기출" && !it.other).length;
  const list = tab === "mine" ? mineItems : items;
  const interviewPaid = Boolean(quota?.interview_paid);
  // 학교 — 무료는 1곳 (처음 AI 피드백을 받은 학교 · 아직 없으면 첫 목표 학교), 결제하면 6곳까지
  const freeUniv = quota?.free_university ?? targets?.[0]?.university ?? null;
  const schoolLocked = (u) => Boolean(quota && !quota.unlimited && freeUniv && base(u) !== base(freeUniv));
  const selLocked = Boolean(sel && schoolLocked(sel.university));
  function onAddSchool() {
    setNotice("");
    const n = targets?.length ?? 0;
    if (quota && !quota.unlimited && n >= 1) { track("prep_school_pay"); return setSchoolPay({ univ: "" }); }
    if (quota?.unlimited && n >= (quota.school_limit ?? 6)) return setNotice(`목표 학교는 ${quota.school_limit ?? 6}곳까지 넣을 수 있어요. 하나를 빼고 넣어 주세요.`);
    setAdding(true);
  }
  useEffect(() => setShown(PAGE), [tab]);
  // 예상질문 탭을 열 때마다 새로 불러온다 (다른 화면에서 방금 뽑은 질문도 바로 보이게)
  useEffect(() => {
    if (tab !== "mine" || !user) return;
    supabase.from("interview_queries").select("university,department,result,status").neq("status", "failed").order("created_at", { ascending: false }).limit(30).then(({ data }) => {
      const my = [];
      for (const q of data ?? []) {
        const rs = q.result?.results ?? (q.result?.groups ? [q.result] : []);
        for (const r of rs) for (const g of r?.groups ?? []) my.push({ university: r.university ?? q.university, department: r.department ?? q.department ?? "", title: g.title, questions: g.questions ?? [] });
      }
      setMine(my);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user]);

  // 'n/m 문제 학습' — 지금 화면에 보이는 문제 기준 ('더 보기'를 누르면 m 이 늘어난다)
  const visible = list.slice(0, shown);
  // 완성한 답변 (최종 피드백까지) — 지금 탭 종류(기출 / 생기부 예상질문)로 모든 학교에서
  //   예상질문 = 내가 뽑은 예상질문에 있는 질문, 나머지는 기출
  const mineKeys = new Set(mine.flatMap((g) => g.questions.map((q) => `${base(g.university)}|${q}`)));
  //   최종까지 못 했어도 답을 쓴 문제는 넣는다 (가장 마지막에 쓴 답) · 5문제 이상 쓰면 열린다
  const PDF_MIN = 5;
  const completed = Object.values(answers).filter((r) => (r?.draft2 || r?.draft1 || r?.answer) && (tab === "mine") === mineKeys.has(`${base(r.university)}|${r.question}`));
  function downloadPdf() {
    if (completed.length < PDF_MIN) return setPdfHint(true); // 아직이면 안내 창
    track("prep_pdf", tab);
    const by = new Map();
    for (const r of completed) {
      const t = (targets ?? []).find((x) => base(x.university) === base(r.university)) ?? mineSchools.find((x) => base(x.university) === base(r.university));
      const name = [r.university, t?.department].filter(Boolean).join(" ");
      if (!by.has(name)) by.set(name, []);
      by.get(name).push({ q: r.question, answer: (r.feedback2 ? r.draft2 : r.feedback1 ? r.draft1 : "") || r.draft2 || r.draft1 || r.answer });
    }
    const kind = tab === "mine" ? "생기부 예상질문" : "기출문제";
    printAnswers({
      title: `${kind} 답변 노트`,
      sub: `답변 ${completed.length}개 · 학교 ${by.size}곳 · ${new Date().toLocaleDateString("ko-KR")}`,
      groups: [...by.entries()].map(([name, rows]) => ({ name, rows })),
    });
  }
  const learned = visible.filter((it) => answers[`${it.target?.university ?? sel?.university}|${it.q}`]?.answer).length;

  // 기출 무료 문제 수 (서버가 셈)
  function loadQuota() {
    call("agent", { action: "study_quota" }).then((r) => r?.quota && setQuota(r.quota));
  }
  // 이 문제를 열 수 있나 — 한 번 피드백 받은 문제 · 예상 문제는 그대로, 새 기출은 남은 수가 있어야
  const unlocked = (it) => Boolean(answers[`${sel?.university}|${it.q}`]?.feedback1);
  function openItem(it) {
    if (it.badge !== "예상" && selLocked) return setSchoolPay({ univ: sel.university });
    // 예상질문은 24,000원 결제한 학생만 — 결제 전이면 생기부 예상질문 화면(결제 창)으로
    if (it.badge === "예상" && quota && !interviewPaid) return nav("/interview", { state: { university: it.target?.university ?? sel?.university, department: it.target?.department ?? sel?.department } });
    if (it.badge !== "예상" && !unlocked(it) && quota && quota.left <= 0) {
      track("prep_quota_empty");
      return setInvite(true);
    }
    setOpen(it);
  }

  async function addTarget(t) {
    setAdding(false);
    const { data, error } = await supabase.from("prep_targets").upsert(t, { onConflict: "user_id,university,department" }).select("id,university,department,track").single();
    const row = error ? t : data;
    setTargets((list) => {
      const next = [...(list ?? []).filter((x) => !(x.university === row.university && x.department === row.department)), row];
      setCur(next.length - 1);
      return next;
    });
    setTimeout(() => rowRef.current?.scrollTo({ left: 99999, behavior: "smooth" }), 50);
  }
  async function removeTarget(i) {
    const t = targets[i];
    if (!window.confirm(`${t.university} ${t.department}을(를) 목표 학교에서 뺄까요?`)) return;
    if (t.id) await supabase.from("prep_targets").delete().eq("id", t.id);
    setTargets((list) => list.filter((_, k) => k !== i));
    setCur(0);
  }

  if (loading) return <div className="min-h-[60vh]" />;
  if (!user) return <LoginGate title="수시 면접 준비는 회원 전용이에요" desc="목표 학교를 추가하면 학교별 기출문제로 답변을 쓰고 꼬리질문까지 연습할 수 있어요." />;

  const inviteSheet = (
    <>
      <InviteSheet
        open={invite}
        onClose={() => setInvite(false)}
        quota={quota}
        onRefresh={loadQuota}
        onBuyPass={() => { setInvite(false); setBuy(true); }}
        onBuyInterview={() => nav("/interview", { state: { university: sel?.university, department: sel?.department, openPay: true } })}
      />
      <SchoolPaySheet
        open={Boolean(schoolPay)}
        onClose={() => setSchoolPay(null)}
        freeUniv={freeUniv}
        univ={schoolPay?.univ}
        onBuyPass={() => { setSchoolPay(null); setBuy(true); }}
        onBuyInterview={() => nav("/interview", { state: { university: sel?.university, department: sel?.department, openPay: true } })}
      />
      <PassSheet
        open={buy}
        title="기출문제 학습"
        headline="한 달 동안 학교 6곳 기출문제 무제한"
        onClose={() => setBuy(false)}
        onUnlocked={() => { setBuy(false); loadQuota(); }}
      />
    </>
  );

  // 문제를 누르면 — 기출문제 학습 화면
  if (open && (open.target || sel)) {
    const tgt = open.target ?? sel; // 예상질문은 그 질문을 뽑은 대학으로
    const key = `${tgt.university}|${open.q}`;
    return (
      <>
        <StudyView
          key={key}
          item={open}
          target={tgt}
          row={answers[key]}
          source={open.badge === "예상" ? "interview" : "past"}
          onSaved={(r) => setAnswers((m) => ({ ...m, [key]: r }))}
          onBack={() => { setOpen(null); loadQuota(); }}
          onQuota={setQuota}
          onNeedInvite={() => setInvite(true)}
          onNeedSchoolPay={() => { setOpen(null); setSchoolPay({ univ: tgt.university }); }}
          onNeedPay={() => nav("/interview", { state: { university: tgt.university, department: tgt.department } })}
        />
        {inviteSheet}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6 sm:pt-9">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight text-gray-900 sm:text-[30px]">수시 면접 준비</h1>
            <p className="mt-1 text-[14px] text-gray-500">{tab === "mine" ? "내 생기부로 뽑은 학교별 예상질문으로 면접을 준비해요." : "목표 학교를 추가하고, 학교별 기출문제로 면접을 준비해요."}</p>
          </div>
          {tab === "past" && quota && quota.limit < 9999 && (
            <button onClick={() => setInvite(true)} className="rounded-full bg-[#EEF1FA] px-3 py-1.5 text-[12.5px] font-bold text-sm-navy hover:bg-[#E3E7F3]">
              무료 기출 {quota.left}문제 남음 · 친구 초대 +{quota.per_friend}
            </button>
          )}
        </div>

        {/* 탭 — 기출문제 · 생기부 예상질문 (위 학교 카드도 탭에 따라 바뀐다) */}
        <div className="mt-6 flex gap-1 border-b border-gray-200">
          {[["past", "기출문제", items.length], ["mine", "생기부 예상질문", mineCount]].map(([k, label, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-[3px] px-4 pb-3 text-[16px] font-extrabold sm:text-[17px] ${tab === k ? "border-sm-navy text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
              {label}<span className={`ml-1.5 text-[13px] font-bold ${tab === k ? "text-sm-orange" : "text-gray-400"}`}>{n}</span>
            </button>
          ))}
        </div>

        {/* 예상질문 탭 — 예상질문을 뽑은 학교 */}
        {tab === "mine" && (
          <div className="-mx-4 mt-5 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
            {mineSchools.map((t, i) => (
              <div key={`${t.university}-${t.department}`} role="button" onClick={() => setMineCur(i)}
                className={`relative flex h-[150px] w-[230px] flex-none cursor-pointer flex-col justify-between rounded-2xl bg-white p-4 text-left sm:w-[260px] ${mineSel === t ? "border-2 border-sm-navy shadow-[0_6px_16px_rgba(20,27,61,.08)]" : "border border-gray-200 hover:border-gray-300"}`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#EEF1FA] text-[14px] font-extrabold text-sm-navy">{t.university.slice(0, 1)}</span>
                  <div className="min-w-0">
                    <b className="block truncate text-[14.5px] font-bold text-gray-900">{t.university}</b>
                    <small className="block truncate text-[12.5px] text-gray-500">{t.department || "학과 미정"}</small>
                  </div>
                </div>
                <small className="text-[12.5px] font-semibold text-gray-500">예상질문 <b className="text-sm-orange">{t.n}</b>개</small>
              </div>
            ))}
            <button onClick={() => nav("/interview", { state: { university: sel?.university, department: sel?.department } })} className="flex h-[150px] w-[160px] flex-none flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gray-300 bg-white text-[13.5px] font-bold text-gray-500 hover:border-sm-navy hover:text-sm-navy">
              <span className="text-[24px] leading-none">+</span>예상질문 뽑기
            </button>
          </div>
        )}

        {/* 목표 학교 (기출문제 탭) */}
        {tab === "past" && (
        <div className="relative mt-5">
          <div ref={rowRef} className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
            {(targets ?? []).map((t, i) => (
              <SchoolCard key={`${t.university}-${t.department}`} t={t} active={i === cur} locked={schoolLocked(t.university)} onClick={() => setCur(i)} onDelete={() => removeTarget(i)} />
            ))}
            <button onClick={onAddSchool} className="flex h-[150px] w-[160px] flex-none flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gray-300 bg-white text-[13.5px] font-bold text-gray-500 hover:border-sm-navy hover:text-sm-navy">
              <span className="text-[24px] leading-none">+</span>목표 학교 추가
            </button>
          </div>
          {(targets?.length ?? 0) > 3 && (
            <button onClick={() => rowRef.current?.scrollBy({ left: 280, behavior: "smooth" })} className="absolute -right-3 top-[52px] hidden h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-[18px] text-gray-500 shadow-sm sm:flex" aria-label="다음 학교">
              ›
            </button>
          )}
        </div>
        )}

        {notice && <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-[13px] font-bold text-sm-orange">{notice}</p>}
        {/* PDF 안내 창 — 아직 5문제가 안 됐을 때 */}
        {pdfHint && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setPdfHint(false)}>
            <div className="w-full max-w-sm rounded-t-3xl bg-white px-6 pb-7 pt-6 text-center sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-[13px] font-bold text-sm-orange">{tab === "mine" ? "생기부 예상질문" : "기출문제"} 답변 PDF</p>
              <p className="mt-1 text-[19px] font-extrabold text-sm-navy">답변을 {PDF_MIN}문제 이상 쓰면 받을 수 있어요</p>
              <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
                지금 <b className="text-gray-900">{completed.length}문제</b> 썼어요. <b className="text-sm-orange">{PDF_MIN - completed.length}문제</b>만 더 쓰면
                <br />질문과 내 답변을 PDF로 받을 수 있어요.
              </p>
              <div className="mx-auto mt-4 flex max-w-[220px] gap-1.5">
                {Array.from({ length: PDF_MIN }).map((_, k) => <i key={k} className={`h-2 flex-1 rounded-full ${k < completed.length ? "bg-sm-orange" : "bg-gray-200"}`} />)}
              </div>
              <button onClick={() => setPdfHint(false)} className="mt-6 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">답변 더 쓰러 가기</button>
            </div>
          </div>
        )}
        {(tab === "mine" || sel) && (
          <section className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[20px] font-extrabold text-gray-900 sm:text-[22px]">{tab === "mine" ? "내 생기부 예상질문" : "대학 기출문제"}</h2>
                <p className="mt-1 text-[13.5px] text-gray-500">{tab === "mine" ? (mineSel ? `${mineSel.university} ${mineSel.department} · 내 활동에서 나올 질문` : "내 활동에서 나올 질문") : `${sel.university} ${sel.department} 기출 경향`}</p>
                {tab === "mine" && mineCount > 0 && !interviewPaid && quota && (
                  <p className="mt-1 text-[12.5px] text-sm-orange">질문마다 답변 → AI 피드백 → 꼬리질문 연습은 생기부 예상질문(24,000원)을 결제하면 열려요.</p>
                )}
              </div>
              {list.length > 0 && !(tab === "past" && selLocked) && (
                <div className="flex items-center gap-3">
                  <b className="text-[16px] font-extrabold text-sm-orange">{learned}/{visible.length} 문제 학습</b>
                  <button onClick={downloadPdf}
                    className={`flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[12.5px] font-bold hover:border-sm-navy ${completed.length < PDF_MIN ? "text-gray-400" : "text-gray-700"}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                    {tab === "mine" ? "예상질문" : "기출"} 답변 PDF{completed.length >= PDF_MIN ? ` (${completed.length})` : ` · ${completed.length}/${PDF_MIN}문제`}
                  </button>
                </div>
              )}
            </div>

            {/* 이 대학 면접 한눈에 */}
            {tab === "past" && b && b !== "load" && (b.rules?.length > 0 || b.style) && (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white">
                <button onClick={() => setInfo((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                  <b className="text-[14px] font-bold text-gray-900">이 대학 면접 한눈에</b>
                  <span className="text-[12.5px] font-semibold text-gray-400">{info ? "접기 ▲" : "펼치기 ▼"}</span>
                </button>
                {info && (
                  <div className="grid gap-2 border-t border-gray-100 px-4 py-3 text-[13px] leading-relaxed text-gray-700">
                    {(b.rules ?? []).slice(0, 4).map((r, i) => (
                      <p key={i}><b className="text-gray-900">{r.track}</b>{r.interview_ratio ? ` · 면접 ${r.interview_ratio}` : ""}{r.interview_type ? ` · ${r.interview_type}` : ""}{r.interview ? ` — ${r.interview}` : ""}</p>
                    ))}
                    {b.style?.view && <p><b className="text-gray-900">면접관이 보는 것</b> · {b.style.view}</p>}
                    {b.style?.question_style && <p><b className="text-gray-900">질문 스타일</b> · {b.style.question_style}</p>}
                    {b.style?.best_answer && <p><b className="text-gray-900">점수 잘 받는 답</b> · {b.style.best_answer}</p>}
                  </div>
                )}
              </div>
            )}

            {/* 문제 카드 */}
            {tab === "mine" && !mineCount ? (
              <div className="mt-4 flex flex-col items-center rounded-2xl border-2 border-dashed border-gray-300 bg-white px-5 py-12 text-center">
                <b className="text-[17px] font-extrabold text-gray-900">아직 뽑은 예상질문이 없어요</b>
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">내 생기부 활동을 넣으면 이 학교 면접 스타일로 나올 질문을 뽑아 드려요.</p>
                <button onClick={() => nav("/interview", { state: { university: sel?.university, department: sel?.department } })} className="mt-5 h-12 rounded-xl bg-sm-navy px-6 text-[15px] font-extrabold text-white">내 생기부로 예상질문 뽑기</button>
              </div>
            ) : tab === "past" && selLocked ? (
              <div className="mt-4 flex flex-col items-center rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center">
                <span className="text-[30px]">🔒</span>
                <b className="mt-2 text-[17px] font-extrabold text-gray-900">{sel.university} 기출은 결제하면 열려요</b>
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
                  무료는 학교 1곳{freeUniv ? ` (${freeUniv})` : ""}이에요. 결제하면 학교 6곳까지 기출을 무제한으로 연습해요.
                  <br />이 학교 기출 {items.length}개가 준비돼 있어요.
                </p>
                <button onClick={() => setSchoolPay({ univ: sel.university })} className="mt-5 h-12 rounded-xl bg-sm-navy px-6 text-[15px] font-extrabold text-white">이 학교 열기</button>
              </div>
            ) : tab === "past" && (rowsOf === "load" || rowsOf === undefined) ? (
              <p className="mt-6 text-[14px] text-gray-400">{sel.university} 기출 문제를 불러오는 중…</p>
            ) : tab === "past" && !items.length ? (
              <div className="mt-4 flex flex-col items-center rounded-2xl border-2 border-dashed border-gray-300 bg-white px-5 py-12 text-center">
                <b className="text-[17px] font-extrabold text-gray-900">{sel.university} {sel.department} 기출은 아직 없어요</b>
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
                  목표 학교를 추가할 때 학과 칸을 누르면 기출이 있는 학과가 숫자와 함께 나와요.
                  <br />이 학교를 지우고, 기출 수가 나오는 학과로 다시 추가해 보세요.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {visible.map((it, i) => {
                  const done = Boolean(answers[`${it.target?.university ?? sel?.university}|${it.q}`]?.answer);
                  const locked = it.badge === "예상" ? quota && !interviewPaid : !unlocked(it) && quota && quota.left <= 0;
                  return (
                    <div key={it.q} className="flex min-h-[230px] flex-col rounded-2xl border border-gray-200 bg-white p-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-100 px-2 text-[12.5px] font-bold text-gray-500">{i + 1}</span>
                        <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${it.badge === "예상" ? "bg-[#EEF1FA] text-sm-navy" : "bg-orange-50 text-sm-orange"}`}>{it.badge}</span>
                        {done ? <span className="ml-auto text-[12px] font-bold text-emerald-600">✓ 답변 완료</span> : locked && <span className="ml-auto text-[12px] font-bold text-gray-400">{it.badge === "예상" ? "🔒 결제 후 연습" : "🔒 친구 초대로 열기"}</span>}
                      </div>
                      <p className="mt-3 line-clamp-3 text-[14px] font-bold leading-relaxed text-gray-900">{it.q}</p>
                      <p className="mt-2 line-clamp-2 text-[12.5px] text-gray-400">{it.badge === "예상" ? [[it.target?.university, it.target?.department].filter(Boolean).join(" ") || "내 생기부", it.sub ?? "예상질문"].join(" · ") : [it.kind, it.sub].filter(Boolean).join(" · ")}</p>
                      <div className="mt-auto flex gap-2 pt-4">
                        <button onClick={() => openItem(it)} className={`h-10 rounded-lg px-4 text-[13px] font-extrabold transition-opacity hover:opacity-90 ${done ? "border-[1.5px] border-sm-navy text-sm-navy" : "bg-sm-navy text-white"}`}>
                          {done ? "답변 고치기" : "답변 작성"}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* 예상질문 탭 끝 — 더 뽑기 */}
                {tab === "mine" && (
                  <button
                    onClick={() => nav("/interview", { state: { university: mineSel?.university ?? sel?.university, department: mineSel?.department ?? sel?.department } })}
                    className="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-white p-4 text-center hover:border-sm-navy"
                  >
                    <span className="text-[26px] leading-none text-gray-400">+</span>
                    <b className="text-[14px] font-bold text-gray-700">내 생기부로 예상질문 더 뽑기</b>
                    <small className="text-[12px] text-gray-400">활동을 더 넣으면 질문이 늘어나요</small>
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* 친구 초대 — 무료 기출 문제 늘리기 */}
        {tab === "past" && quota && quota.limit < 9999 && (
          <div className="mt-8 flex flex-col gap-3 rounded-2xl bg-sm-navy p-5 text-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <b className="block text-[16px] font-bold">기출문제 학습은 결제 없이 — 친구 1명 가입할 때마다 +{quota.per_friend}문제</b>
            </div>
            <button onClick={() => setInvite(true)} className="h-11 flex-none rounded-xl bg-orange-400 px-5 text-[14px] font-extrabold text-sm-navy">친구 초대하기</button>
          </div>
        )}
      </div>

      <AddSheet open={adding && targets !== null} onClose={() => setAdding(false)} onAdd={addTarget} univs={univs} major={major} />

      {inviteSheet}
    </div>
  );
}