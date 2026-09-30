import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import StepBar from "./StepBar";
import Paywall from "./Paywall";
import { useStay } from "./useStay";
import InquirySwitcher from "./InquirySwitcher";

/*
 * 결과 분석 — /inquiry/:id/result
 * 결과를 어떻게 정리할지 고른다 → '내가 직접 하기' / 'AI가 해주기'
 *  - 문헌·사례·데이터 + AI: 2단계에서 찾은 자료 페이지를 AI가 읽고 비교표를 채운 뒤 분석
 *  - 설문·실험·관찰 + AI: 학생이 넣은 숫자로 AI가 분석
 *  - 직접 하기: 그래프는 자동, 해석은 학생이 씀. 막히면 'AI 도움 받기' (analysis_switched)
 * 어느 쪽이든 '내 생각 한 줄'은 필수 (세특·면접에서 설명할 수 있게)
 *
 * 화면 배치 (2단)
 *  - 왼쪽(넓게): 결과 입력 · 비교표 · 그래프
 *  - 오른쪽: 내 생각 한 줄(맨 위) → AI 분석 → 기억 문장 → 다음 단계 버튼
 */

const NUMERIC = ["exp", "obs", "data"]; // 숫자 표로 그래프를 그리는 방법


/* 서버가 보낸 실패 이유 꺼내기 */
async function callInquiry(body) {
  const { data, error } = await supabase.functions.invoke("inquiry", { body });
  if (!error) return data?.error ? { message: data.error, paywall: data.paywall } : { data };
  let message = "잠시 후 다시 시도해 주세요.";
  try {
    const payload = await error.context?.json?.();
    if (payload?.error) message = payload.error;
    if (payload?.paywall) return { message, paywall: true };
  } catch {
    // 무시
  }
  return { message };
}

/* 간단한 CSV 읽기 (구글 폼 응답 내보내기용) — 따옴표 안의 쉼표·줄바꿈 처리 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/* 방법에 맞는 빈 결과표 */
function emptyData(method, pack, sources) {
  const p = pack?.pack ?? {};
  if (method === "exp" || method === "obs") {
    const rows = p.record_table?.rows?.length ? p.record_table.rows : ["조건 1", "조건 2", "조건 3"];
    const cols = (p.record_table?.cols?.length ? p.record_table.cols : ["1회", "2회", "3회"]).filter((c) => c !== "평균");
    return { kind: "table", unit: p.record_table?.unit ?? "", rows, cols, cells: rows.map(() => cols.map(() => "")) };
  }
  if (method === "data") return { kind: "pairs", unit: "", rows: [{ label: "", value: "" }, { label: "", value: "" }, { label: "", value: "" }] };
  if (method === "survey") {
    const qs = (p.questions ?? []).filter((x) => x.options?.length).map((x) => ({ text: x.text, options: x.options, counts: x.options.map(() => "") }));
    return { kind: "survey", total: "", questions: qs };
  }
  // 문헌·사례 — 비교표 (글). AI가 찾은 자료 중 학생이 열어서 확인한 것은 제목을 미리 넣는다
  const checked = (sources?.list ?? []).filter((x) => x.selected).map((x) => x.title);
  const rows = checked.length
    ? checked
    : method === "lit"
    ? (p.sources ?? []).map((s, i) => `[자료 ${i + 1} · ${s.kind}]`)
    : (p.cases ?? []).map((c) => c.name);
  const cols = p.criteria?.length ? p.criteria : ["기준 1", "기준 2"];
  return { kind: "text", rows: rows.length ? rows : ["1", "2", "3"], cols, cells: (rows.length ? rows : [1, 2, 3]).map(() => cols.map(() => "")) };
}

/* 그래프로 그릴 값 — 숫자 표는 행마다 평균, 설문은 질문별 비율 */
function seriesOf(data, qIndex = 0) {
  if (data?.kind === "table") {
    return data.rows.map((r, i) => {
      const nums = data.cells[i].map(Number).filter((v) => Number.isFinite(v) && String(data.cells[i]).trim() !== "");
      const vals = data.cells[i].filter((v) => String(v).trim() !== "").map(Number).filter(Number.isFinite);
      return { label: r, value: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null, n: nums.length };
    });
  }
  if (data?.kind === "pairs") return data.rows.filter((r) => r.label).map((r) => ({ label: r.label, value: r.value === "" ? null : Number(r.value) }));
  if (data?.kind === "survey") {
    const q = data.questions[qIndex];
    if (!q) return [];
    const nums = q.counts.map((c) => Number(c) || 0);
    const sum = nums.reduce((a, b) => a + b, 0);
    return q.options.map((o, i) => ({ label: o, value: sum ? Math.round((nums[i] / sum) * 100) : null, unit: "%" }));
  }
  return [];
}

function Bars({ series, unit }) {
  const vals = series.map((s) => s.value).filter((v) => v != null);
  if (!vals.length) return <p className="py-10 text-center text-[13px] text-gray-400">숫자를 넣으면 그래프가 그려져요</p>;
  const max = Math.max(...vals) * 1.15 || 1;
  const w = 520, h = 220, base = h - 30, top = 20;
  const slot = (w - 20) / series.length;
  const bw = Math.min(60, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="결과 그래프">
      <line x1="6" y1={base} x2={w - 6} y2={base} stroke="#C9CEDA" />
      {series.map((s, i) => {
        const x = 10 + i * slot + (slot - bw) / 2;
        const bh = s.value == null ? 0 : (s.value / max) * (base - top);
        return (
          <g key={i}>
            <rect x={x} y={base - bh} width={bw} height={bh} rx="4" fill={i === series.length - 1 ? "#C2461D" : "#18224F"} opacity={s.value == null ? 0 : 1} />
            {s.value != null && (
              <text x={x + bw / 2} y={base - bh - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="#18224F">
                {s.value}{s.unit ?? unit ?? ""}
              </text>
            )}
            <text x={x + bw / 2} y={base + 18} textAnchor="middle" fontSize="12" fill="#4A5270">
              {String(s.label).length > 8 ? String(s.label).slice(0, 8) + "…" : s.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* 막힌 자료 — 학생이 본문을 붙여넣으면 AI가 그 글로 칸을 채운다 */
function PasteBox({ onSubmit }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2.5">
        <p className="text-[12.5px] leading-relaxed text-amber-900">사이트가 자동 접속을 막아서 AI가 못 읽었어요. 원문을 열어 필요한 부분을 복사해 주세요.</p>
        <button onClick={() => setOpen(true)} className="mt-2 rounded-lg bg-sm-navy px-3 py-1.5 text-[12.5px] font-bold text-white">
          본문 붙여넣고 AI가 읽기
        </button>
      </div>
    );
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-3">
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="원문에서 복사한 본문을 붙여넣어요 (100자 이상)"
        className="w-full resize-none rounded-lg border border-amber-200 bg-white p-2.5 text-[12.5px] outline-none focus:border-sm-navy"
      />
      <div className="flex gap-2">
        <button
          disabled={busy || text.trim().length < 100}
          onClick={async () => {
            setBusy(true);
            const ok = await onSubmit(text);
            setBusy(false);
            if (ok) setOpen(false);
          }}
          className="rounded-lg bg-sm-navy px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
        >
          {busy ? "읽는 중…" : "AI가 읽고 채우기"}
        </button>
        <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold text-gray-500">닫기</button>
      </div>
    </div>
  );
}

/* 비교표 입력 — 기준 고치기(모든 자료 공통) · 카드로 쓰기 · 표로 비교하기 */
const NONE = "자료에 없음";
function CompareInput({ data, onChange, onPaste }) {
  const [view, setView] = useState("card"); // card | table
  const [newCol, setNewCol] = useState("");
  const isNone = (v) => !v || String(v).trim() === NONE || String(v).startsWith("직접 확인 필요");

  const set = (i, j, v) => onChange({ ...data, cells: data.cells.map((r, k) => (k === i ? r.map((x, m) => (m === j ? v : x)) : r)) });
  const setRow = (i, v) => onChange({ ...data, rows: data.rows.map((r, k) => (k === i ? v : r)) });
  const renameCol = (j, v) => onChange({ ...data, cols: data.cols.map((c, k) => (k === j ? v : c)) });
  const dropCol = (j) =>
    onChange({
      ...data,
      cols: data.cols.filter((_, k) => k !== j),
      cells: data.cells.map((r) => r.filter((_, k) => k !== j)),
      evidence: data.evidence?.map((r) => r.filter((_, k) => k !== j)),
    });
  const dropRow = (i) => {
    if (data.rows.length <= 1) return;
    if (!window.confirm(`‘${data.rows[i] || `자료 ${i + 1}`}’ 카드를 지울까요?`)) return;
    const cut = (arr) => (arr ? arr.filter((_, k) => k !== i) : arr);
    onChange({ ...data, rows: cut(data.rows), cells: cut(data.cells), evidence: cut(data.evidence), urls: cut(data.urls), blocked: cut(data.blocked) });
  };

  const addCol = () => {
    const name = newCol.trim();
    if (!name) return;
    onChange({ ...data, cols: [...data.cols, name], cells: data.cells.map((r) => [...r, ""]), evidence: data.evidence?.map((r) => [...r, ""]) });
    setNewCol("");
  };

  return (
    <div className="space-y-3">
      {/* 기준 — 한 번만 */}
      <div className="rounded-xl bg-gray-50 p-3">
        <p className="text-[12.5px] font-extrabold text-sm-navy">비교 기준 <span className="font-normal text-gray-500">모든 자료에 똑같이 적용돼요</span></p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.cols.map((c, j) => (
            <span key={j} className="group relative flex items-center gap-1 rounded-full border border-gray-300 bg-white pl-2.5 pr-1">
              <input
                value={c}
                onChange={(e) => renameCol(j, e.target.value)}
                className="w-[12em] truncate bg-transparent py-1 text-[12.5px] font-bold text-sm-navy outline-none"
              />
              {/* 마우스를 올리면 기준 전체 내용을 보여준다 (고치는 중에는 숨김) */}
              {c.trim() && (
                <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 hidden max-w-[22em] rounded-lg bg-sm-navy px-3 py-1.5 text-[12px] font-bold leading-snug text-white shadow-lg group-hover:block group-focus-within:!hidden">
                  {c}
                </span>
              )}
              <button type="button" onClick={() => dropCol(j)} className="px-1 text-[14px] text-gray-400 hover:text-red-500" aria-label={`${c} 기준 빼기`}>×</button>
            </span>
          ))}
          {(
            <span className="flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white pl-2.5 pr-1">
              <input value={newCol} onChange={(e) => setNewCol(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCol()} placeholder="기준 추가" className="w-[6.5em] bg-transparent py-1 text-[12.5px] outline-none" />
              <button type="button" onClick={addCol} className="px-1 text-[14px] font-bold text-sm-navy">+</button>
            </span>
          )}
        </div>
      </div>

      {/* 보기 전환 */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
        {[["card", "카드로 쓰기"], ["table", "표로 비교하기"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`h-9 rounded-md text-[13px] font-bold ${view === k ? "bg-white text-sm-navy shadow-sm" : "text-gray-500"}`}>{l}</button>
        ))}
      </div>

      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="border border-gray-200 bg-gray-50 px-2 py-2 text-left text-gray-500">자료</th>
                {data.cols.map((c) => <th key={c} className="border border-gray-200 bg-gray-50 px-2 py-2 text-left text-gray-500">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className="border border-gray-200 px-2 py-2 font-bold text-sm-navy">{r || `자료 ${i + 1}`}</td>
                  {data.cols.map((_, j) => {
                    const v = data.cells[i]?.[j];
                    return <td key={j} className={`border border-gray-200 px-2 py-2 ${isNone(v) ? "text-gray-300" : "text-gray-800"}`}>{v || "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11.5px] text-gray-400">고치려면 ‘카드로 쓰기’에서 고쳐요. 흐린 칸은 자료에 없는 내용이에요.</p>
        </div>
      ) : (
        <>
          {data.rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-start gap-2 border-b border-gray-200 pb-2">
                <input
                  value={r}
                  onChange={(e) => setRow(i, e.target.value)}
                  placeholder="자료(사례) 이름 — 직접 찾은 제목을 적어요"
                  className="min-w-0 flex-1 text-[14px] font-bold text-sm-navy outline-none"
                />
                {data.rows.length > 1 && (
                  <button type="button" onClick={() => dropRow(i)} className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-bold text-gray-400 hover:text-red-500">
                    삭제
                  </button>
                )}
              </div>
              {data.urls?.[i] && (
                <a href={data.urls[i]} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] font-bold text-sm-orange">원문 열기 ↗</a>
              )}
              {data.blocked?.[i] && onPaste ? (
                <PasteBox onSubmit={(t) => onPaste(i, t)} />
              ) : (
                <div className="mt-3 space-y-2">
                  {data.cols.map((c, j) => {
                    const v = data.cells[i]?.[j] ?? "";
                    const ev = data.evidence?.[i]?.[j];
                    return (
                      <label key={j} className="grid grid-cols-[11em_1fr] items-start gap-3">
                        <span className="pt-2 text-[12px] font-bold leading-snug text-gray-500">{c}</span>
                        <span>
                          <input
                            value={v}
                            onChange={(e) => set(i, j, e.target.value)}
                            placeholder={NONE}
                            className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-sm-navy ${isNone(v) ? "text-gray-400" : "text-gray-900"}`}
                          />
                          {ev && !isNone(v) && ev !== NONE && <span className="mt-0.5 block text-[11.5px] leading-snug text-gray-400">근거 · “{ev}”</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...data, rows: [...data.rows, ""], cells: [...data.cells, data.cols.map(() => "")], evidence: data.evidence ? [...data.evidence, data.cols.map(() => "")] : undefined })}
            className="text-[13px] font-bold text-sm-navy"
          >
            + 자료 추가
          </button>
        </>
      )}
    </div>
  );
}

/* ① 결과 입력 */
function DataInput({ data, onChange, onCsv, onPaste }) {
  const cell = "w-full rounded border border-gray-200 px-2 py-1.5 text-center text-[13px] outline-none focus:border-sm-navy";

  // 문헌·사례 — 같은 기준으로 자료를 비교하는 표. 기준은 위에서 한 번만 고치고, 카드로 쓰거나 표로 비교한다
  if (data.kind === "text") {
    return <CompareInput data={data} onChange={onChange} onPaste={onPaste} />;
  }

  if (data.kind === "table") {
    const set = (i, j, v) => {
      const cells = data.cells.map((r) => [...r]);
      cells[i][j] = v;
      onChange({ ...data, cells });
    };
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left text-gray-500">{data.unit ? `단위 ${data.unit}` : ""}</th>
              {data.cols.map((c) => <th key={c} className="border border-gray-200 bg-gray-50 px-3 py-2 text-gray-500">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                <td className="border border-gray-200 px-3 py-2 font-bold text-sm-navy">{r}</td>
                {data.cols.map((c, j) => (
                  <td key={c} className="border border-gray-200 p-1">
                    <input
                      value={data.cells[i][j]}
                      onChange={(e) => set(i, j, e.target.value)}
                      inputMode="decimal"
                      className={cell}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (data.kind === "pairs") {
    const set = (i, k, v) => onChange({ ...data, rows: data.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
    return (
      <div className="space-y-2">
        {data.rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input value={r.label} onChange={(e) => set(i, "label", e.target.value)} placeholder="기준 (예: 15분 이내)" className={`${cell} text-left`} />
            <input value={r.value} onChange={(e) => set(i, "value", e.target.value)} placeholder="값" inputMode="decimal" className={`${cell} w-32`} />
          </div>
        ))}
        <button onClick={() => onChange({ ...data, rows: [...data.rows, { label: "", value: "" }] })} className="text-[13px] font-bold text-sm-navy">
          + 줄 추가
        </button>
      </div>
    );
  }

  // survey
  const setCount = (qi, oi, v) =>
    onChange({ ...data, questions: data.questions.map((q, i) => (i === qi ? { ...q, counts: q.counts.map((c, j) => (j === oi ? v : c)) } : q)) });
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-5 text-[13.5px] font-bold text-gray-500 hover:border-sm-navy">
        구글 폼 응답 CSV 올리기 (자동으로 셉니다)
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
      </label>
      <p className="text-center text-[12px] text-gray-400">또는 아래에 보기별 응답 수를 직접 적어요</p>
      {data.questions.map((q, qi) => (
        <div key={qi} className="rounded-xl border border-gray-200 p-4">
          <p className="text-[13.5px] font-bold text-sm-navy">{q.text}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {q.options.map((o, oi) => (
              <label key={oi} className="flex items-center gap-2 text-[13px]">
                <span className="flex-1 text-gray-600">{o}</span>
                <input value={q.counts[oi]} onChange={(e) => setCount(qi, oi, e.target.value)} inputMode="numeric" placeholder="명" className={`${cell} w-20`} />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function InquiryResult() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [inq, setInq] = useState(null);
  useStay("result", inq?.id); // 체류 시간
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(""); // "" | "fill" | "analyze"
  const [qIndex, setQIndex] = useState(0); // 설문: 그래프로 볼 질문
  const [answers, setAnswers] = useState({ notable: "", unexpected: "", why: "", mine: "" });
  const [memory, setMemory] = useState({ l1: "", l2: "" });
  const [aiOpen, setAiOpen] = useState(false); // AI 분석은 'AI 분석 받기'를 눌러야 보인다 (들어왔을 때는 숨김)

  // 불러오기
  useEffect(() => {
    if (authLoading || !user) return;
    supabase.from("inquiries").select("*").eq("id", id).maybeSingle().then(({ data: row, error }) => {
      if (error || !row) return setErr("탐구를 찾지 못했어요.");
      setInq(row);
      setData(row.results?.data ?? emptyData(row.method, row.pack, row.sources));
      setAnswers({ notable: "", unexpected: "", why: "", mine: "", ...(row.results?.answers ?? {}) });
      setMemory(row.results?.memory ?? { l1: "", l2: "" });
      if (row.stage === "prepare" || row.stage === "doing")
        supabase.from("inquiries").update({ stage: "analyze" }).eq("id", row.id).then(({ error: e }) => e && console.warn(e));
    });
  }, [authLoading, user, id]);

  // 결과·답·기억 문장 자동 저장 (입력을 멈추고 1초 뒤)
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!inq || !data) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      supabase
        .from("inquiries")
        .update({ results: { ...(inq.results ?? {}), data, answers, memory } })
        .eq("id", id)
        .then(({ error }) => error && console.warn("save failed", error));
    }, 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, answers, memory]);

  const series = useMemo(() => (data ? seriesOf(data, qIndex) : []), [data, qIndex]);
  const research = ["lit", "case", "data"].includes(inq?.method);
  const hasSources = (inq?.sources?.list ?? []).some((x) => x.selected && x.url);
  // 결과 정리는 늘 AI가 한다 — '내가 직접 하기 / AI가 해주기' 고르기 없음
  const mode = inq ? "ai" : null;
  const ai = inq?.results?.ai;
  const show = aiOpen && Boolean(ai); // 지금 화면에 AI 분석을 보여주는지

  // AI가 자료를 읽고 비교표 채우기
  async function runFill() {
    setBusy("fill");
    setErr("");
    const { data: res, message } = await callInquiry({ action: "fill", inquiry_id: id, cols: data?.cols });
    setBusy("");
    if (message) {
      setErr(message);
      return null;
    }
    setInq(res.inquiry);
    setData(res.inquiry.results.data);
    return res.inquiry.results.data;
  }

  // AI 분석 (d: 방금 채운 표가 있으면 그걸로)
  async function runAi(d = data) {
    setBusy("analyze");
    setErr("");
    const mine = (answers.mine || `${answers.notable} ${answers.why}`).trim();
    const { data: res, message } = await callInquiry({ action: "analyze", inquiry_id: id, data: d, mine });
    setBusy("");
    if (message) return setErr(message);
    setInq(res.inquiry);
    setAiOpen(true);
    // 가장 임팩트 있는 후보(첫 번째)로 기억 문장 칸을 채운다 — 학생이 직접 쓴 게 있으면 그대로 둔다
    const first = res.inquiry.results?.ai?.memory?.[0];
    if (first && !memory.l1 && !memory.l2) setMemory({ l1: first.l1, l2: first.l2 });
  }

  // AI가 해주기 — 자료 탐구면 먼저 자료를 읽고, 그다음 분석
  async function runAiAll() {
    let d = data;
    if (research && hasSources && data?.filled_by !== "ai") {
      d = await runFill();
      if (!d) return;
    }
    await runAi(d);
  }

  // 'AI 분석 받기' — 이미 받아 둔 분석이 있으면 다시 돈 쓰지 않고 펼치기만, 없으면 새로 분석
  function openAi() {
    if (ai) return setAiOpen(true);
    runAiAll();
  }


  // 직접 하다가 AI 도움 받기
  async function helpFromAi() {
    track("analyze_switch", inq.method);
    if (!inq.analysis_switched) {
      const { data: row } = await supabase.from("inquiries").update({ analysis_switched: true }).eq("id", id).select("*").single();
      if (row) setInq(row);
    }
    openAi();
  }

  // 막힌 자료 — 붙여넣은 본문으로 채우기
  async function pasteFill(index, text) {
    setErr("");
    const { data: res, message } = await callInquiry({ action: "fill_one", inquiry_id: id, index, text });
    if (message) {
      setErr(message);
      return false;
    }
    setInq(res.inquiry);
    setData(res.inquiry.results.data);
    return true;
  }

  // CSV → 보기별 응답 수
  async function onCsv(file) {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return setErr("CSV에서 응답을 찾지 못했어요.");
    const [head, ...body] = rows;
    const questions = data.questions.map((q) => {
      const col = head.findIndex((h) => h.trim() && (h.includes(q.text.slice(0, 12)) || q.text.includes(h.trim().slice(0, 12))));
      if (col < 0) return q;
      const counts = q.options.map((o) => body.filter((r) => (r[col] ?? "").trim() === o.trim()).length);
      return { ...q, counts: counts.map(String) };
    });
    setData({ ...data, total: String(body.length), questions });
  }

  // 넘어갈 수 있는지 — 기억 문장 + 학생 생각
  const mine = mode === "self" ? `${answers.notable} ${answers.why}`.trim() : answers.mine.trim();
  const mineOk = mine.length >= 10;
  const ready = memory.l1 && memory.l2 && mineOk;
  // 기억 문장 칸은 AI 분석을 받은 뒤에 열린다 (이미 써 둔 기억 문장이 있으면 그대로 보여준다)
  const memoryOpen = show || Boolean(memory.l1 || memory.l2);

  function toDesign() {
    supabase
      .from("inquiries")
      .update({ stage: "design", results: { ...(inq?.results ?? {}), data, answers, memory } })
      .eq("id", id)
      .then(() => nav(`/inquiry/${id}/report`));
  }

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (user) supabase.rpc("is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, [user]);
  // 무료 체험 탐구인지 — 2단계에서 학생이 무료 체험을 쓰기로 한 탐구 (보고서 디자인까지 무료, PDF 저장만 이용권)
  const free = inq ? Boolean(inq.free_trial) : null;
  const locked = inq && !inq.paid && !isAdmin && free === false; // 무료 체험 탐구는 열어 둔다

  // 3단계에 들어오면 AI가 바로 결과를 정리한다 (한 번만)
  //  - 문헌·사례·데이터: 2단계에서 고른 자료를 읽고 비교표를 채운다 (비교표가 비어 있을 때만 — 학생이 채운 칸은 덮어쓰지 않음)
  //  - 실험·설문·관찰: 학생이 직접 모은 숫자를 넣어야 해서 채우기는 없음
  //  분석·기억 문장 후보는 학생이 '내 생각 한 줄'을 쓰고 'AI 분석 받기'를 누를 때
  const autoFilled = useRef(false);
  useEffect(() => {
    if (!inq || !data || autoFilled.current || busy) return;
    if (!(inq.paid || isAdmin || free === true)) return; // 무료 체험 확인 전이거나 이용권이 필요한 탐구면 기다린다
    autoFilled.current = true;
    if (!inq.analysis_mode) {
      track("analyze_ai", inq.method);
      track("results_upload");
      supabase.from("inquiries").update({ analysis_mode: "ai" }).eq("id", id).then(({ error }) => error && console.warn(error));
    }
    const empty = data.kind === "text" && !(data.cells ?? []).flat().some((v) => String(v ?? "").trim());
    if (research && hasSources && data.filled_by !== "ai" && empty) runFill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inq?.id, Boolean(data), inq?.paid, isAdmin, free]);

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <div className="py-40 text-center text-gray-500">로그인이 필요합니다.</div>;

  const field = "w-full resize-none rounded-lg border border-gray-300 p-3 text-[13.5px] leading-relaxed outline-none focus:border-sm-navy";
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="flex h-[60px] items-center gap-6 border-b border-gray-200 bg-white px-6">
        <button onClick={() => nav("/")} className="text-[20px] font-extrabold text-sm-navy">
          생수면<span className="text-sm-orange">.</span>
        </button>
        <div className="hidden md:block"><StepBar active={2} id={inq?.id ?? id} stage={inq?.stage} /></div>
        <div className="ml-auto flex items-center gap-4">
          {inq && (
            <button onClick={() => nav(`/inquiry/${id}`)} className="text-[13px] font-bold text-gray-500">
              ← 탐구팩 다시 보기
            </button>
          )}
          <InquirySwitcher currentId={inq?.id} />
        </div>
      </header>

      {err && <p className="mx-auto mt-5 max-w-3xl rounded-lg bg-red-50 px-4 py-3 text-center text-[14px] font-bold text-red-600">{err}</p>}
      {!inq && !err && <p className="py-40 text-center text-gray-400">불러오는 중…</p>}

      {inq && data && mode && (
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-5 lg:flex-row lg:items-start">
          {/* 왼쪽(넓게) — 결과 입력 · 그래프 */}
          <div className="min-w-0 flex-1 space-y-5">
            <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-[12px] font-bold text-sm-orange">
                {data.filled_by === "ai" ? "① AI가 자료를 읽고 채웠어요 · 확인하고 고쳐요" : "① 내 결과 넣기"}
              </p>
              <h2 className="text-[16px] font-extrabold leading-snug text-sm-navy">{inq.suggestion}</h2>
              {busy === "fill" ? (
                <p className="rounded-xl bg-indigo-50 px-4 py-8 text-center text-[14px] font-bold text-sm-navy">AI가 자료 페이지를 읽고 비교표를 채우고 있어요… (30초~1분)</p>
              ) : (
                <DataInput data={data} onChange={setData} onCsv={onCsv} onPaste={pasteFill} />
              )}
              <p className="text-[12px] text-gray-400">
                {data.filled_by === "ai" ? "‘근거’ 문장이 원문에 실제로 있는지 ‘원문 열기’로 꼭 확인해요." : "직접 모은 결과만 넣어요. 없는 숫자는 만들지 않아요."}
              </p>
            </section>

            {/* 그래프 (숫자 결과) */}
            {!research || inq.method === "data" ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-3">
                  <p className="text-[15px] font-extrabold text-sm-navy">내 결과 그래프</p>
                  {inq.method === "survey" && data.questions?.length > 1 && (
                    <select value={qIndex} onChange={(e) => setQIndex(Number(e.target.value))} className="ml-auto max-w-[60%] rounded-lg border border-gray-300 px-2 py-1.5 text-[12.5px]">
                      {data.questions.map((q, i) => <option key={i} value={i}>{q.text}</option>)}
                    </select>
                  )}
                </div>
                <Bars series={series} unit={data.unit} />
              </div>
            ) : null}
          </div>

          {/* 오른쪽 — 내 생각(맨 위) → AI 분석 → 기억 문장 → 다음 단계 */}
          <aside className="space-y-5 lg:w-[420px] lg:shrink-0">
            {/* 학생이 쓰는 칸 */}
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
              {mode === "self" ? (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-extrabold text-sm-navy">내 말로 해석하기</p>
                    {!show && (
                      <button onClick={helpFromAi} disabled={!!busy} className="ml-auto rounded-lg border border-sm-navy px-3 py-1.5 text-[12.5px] font-bold text-sm-navy disabled:opacity-50">
                        {busy ? "AI가 정리하는 중…" : "AI 도움 받기"}
                      </button>
                    )}
                  </div>
                  {[
                    ["notable", "가장 눈에 띈 점은?", research ? "자료들을 비교했을 때 가장 큰 차이" : "그래프에서 가장 큰 차이나 변화를 숫자와 함께"],
                    ["unexpected", "예상과 다른 점은?", "처음 생각과 달랐던 결과"],
                    ["why", "왜 그랬을까?", "내가 생각하는 이유 (확실하지 않아도 괜찮아요)"],
                  ].map(([k, q, ph]) => (
                    <label key={k} className="block">
                      <span className="text-[13px] font-bold text-sm-navy">{q}</span>
                      <textarea rows={3} value={answers[k]} onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })} placeholder={ph} className={`${field} mt-1`} />
                    </label>
                  ))}
                </>
              ) : (
                <>
                  <p className="text-[15px] font-extrabold text-sm-navy">
                    내 생각 한 줄 <span className="text-[12px] text-sm-orange">꼭 써주세요</span>
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-gray-500">
                    결과에서 가장 의외였던 점과, 왜 그렇다고 생각하는지 내 말로 한 줄.
                    <br />
                    선생님이 세특에 옮기는 건 이런 내 해석이에요.
                  </p>
                  <textarea rows={3} value={answers.mine} onChange={(e) => setAnswers({ ...answers, mine: e.target.value })} className={field} />
                  {!show && !busy && (
                    <>
                      <button
                        onClick={openAi}
                        disabled={!mineOk}
                        className="h-11 w-full rounded-lg bg-sm-navy text-[14px] font-bold text-white disabled:opacity-40"
                      >
                        {research && hasSources && data.filled_by !== "ai" ? "AI가 자료 읽고 분석하기" : "AI 분석 받기"}
                      </button>
                      {!mineOk && <p className="text-center text-[12px] text-gray-400">내 생각을 한 줄(10자 이상) 쓰면 AI 분석을 받을 수 있어요</p>}
                    </>
                  )}
                </>
              )}
              {show && (
                <button onClick={() => runAi()} disabled={!!busy} className="text-[12.5px] font-bold text-gray-500 underline disabled:opacity-50">
                  {busy === "analyze" ? "다시 분석하는 중…" : "결과를 고쳤다면 다시 분석하기"}
                </button>
              )}
            </div>

            {/* AI 분석 + 기억 문장 */}
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
              {busy === "analyze" && <p className="py-6 text-center text-[14px] font-bold text-sm-orange">내 결과로 분석하고 있어요…</p>}
              {show && busy !== "analyze" && (
                <div className="space-y-2">
                  <p className="text-[15px] font-extrabold text-sm-navy">AI 분석 · 내 결과 기준</p>
                  {[["눈에 띈 점", ai.notable], ["예상과 다른 점", ai.unexpected], ["조심할 점", ai.caution], ["핵심 발견", ai.finding]].map(([l, v]) => (
                    <div key={l} className="rounded-lg bg-gray-50 p-3">
                      <p className="text-[12px] font-bold text-gray-500">{l}</p>
                      <p className="mt-0.5 text-[13.5px] leading-relaxed text-sm-navy">{v}</p>
                    </div>
                  ))}
                </div>
              )}

              {!memoryOpen ? (
                <div>
                  <p className="text-[15px] font-extrabold text-sm-navy">기억 문장</p>
                  <div className="mt-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-center">
                    <p className="text-[13px] font-bold text-gray-500">🔒 내 생각을 먼저 써 주세요</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-400">
                      내 생각 한 줄을 쓰고 ‘AI 분석 받기’를 누르면,
                      <br />
                      AI가 결과·내 생각·자료에서 임팩트 있는 문장을 찾아 여기에 채워 줘요.
                    </p>
                  </div>
                </div>
              ) : (
              <div className={show ? "border-t border-gray-100 pt-3" : ""}>
                <p className="text-[15px] font-extrabold text-sm-navy">기억 문장</p>
                <p className="text-[12px] text-gray-500">
                  보고서 가운데 가장 크게 들어갈 한 문장이에요.{" "}
                  {show ? "AI가 결과·내 생각·자료에서 임팩트 있는 문장을 찾았어요. 골라서 다듬어요." : "‘AI 분석 받기’를 누르면 AI가 결과·내 생각·자료에서 임팩트 있는 문장을 찾아 채워 줘요."}
                </p>
                {show && ai?.memory?.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {ai.memory.map((m, i) => {
                      const on = m.l1 === memory.l1 && m.l2 === memory.l2;
                      return (
                        <button key={i} onClick={() => setMemory({ l1: m.l1, l2: m.l2 })} className={`w-full rounded-lg border px-3 py-2 text-left text-[14px] font-extrabold ${on ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300 text-sm-navy"}`}>
                          {m.from && (
                            <span className={`mr-1.5 rounded px-1.5 py-0.5 align-middle text-[10.5px] font-bold ${on ? "bg-white/20 text-white" : "bg-orange-50 text-sm-orange"}`}>
                              {m.from === "학생 말" ? "내 생각에서" : m.from === "자료" ? "자료에서" : "결과에서"}
                            </span>
                          )}
                          {m.l1} {m.l2}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input value={memory.l1} onChange={(e) => setMemory({ ...memory, l1: e.target.value })} placeholder="첫 줄 (예상)" className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-sm-navy" />
                  <input value={memory.l2} onChange={(e) => setMemory({ ...memory, l2: e.target.value })} placeholder="둘째 줄 (결과)" className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-sm-navy" />
                </div>
              </div>
              )}

              <button onClick={toDesign} disabled={!ready} className="h-[52px] w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-40">
                기억나는 보고서로 만들기 →
              </button>
              {!ready && (
                <p className="text-center text-[12px] text-gray-400">
                  {!mineOk ? "내 생각 한 줄 → AI 분석 받기 → 기억 문장 순서로 채우면 넘어갈 수 있어요" : "기억 문장 두 줄을 채우면 넘어갈 수 있어요"}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
      <Paywall
        open={Boolean(locked)}
        reason="result"
        inquiryId={inq?.id}
        onClose={() => nav(`/inquiry/${id}`)}
        onUnlocked={() => supabase.from("inquiries").select("*").eq("id", id).maybeSingle().then(({ data }) => data && setInq(data))}
      />
    </div>
  );
}