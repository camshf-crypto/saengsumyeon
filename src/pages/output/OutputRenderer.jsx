// 생수면 · 탐구 결과물 그리기 (6-1)
// 경로: src/pages/output/OutputRenderer.jsx
// 편집 화면(OutputEdit)과 공유 화면(OutputShare)이 같이 씁니다.
// 필요 패키지: npm i mathjs   (시뮬레이터 수식을 안전하게 계산)
//
// <OutputRenderer output={{ output_type, theme, layout, content }} />

import { useMemo, useState } from 'react';
import { compile } from 'mathjs';
import { THEMES } from '../../data/outputCatalog';

// ── 공통 부품 ───────────────────────────────────────────────
function Panel({ th, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-3 p-4 ${className}`}
      style={{ background: th.panel, borderRadius: th.radius, border: `1px solid ${th.line}` }}>
      {children}
    </div>
  );
}

function Stat({ th, k, v }) {
  return (
    <div className="flex flex-col gap-0.5 p-2.5 text-center" style={{ background: th.chip, borderRadius: th.radius }}>
      <span className="text-[13px]" style={{ color: th.sub }}>{k}</span>
      <span className="text-2xl font-bold" style={{ color: th.accent }}>{v}</span>
    </div>
  );
}

function Pick({ th, on, onClick, children }) {
  return (
    <button onClick={onClick} className="min-h-[44px] px-4 text-left text-[15px]"
      style={{ borderRadius: th.radius, border: `2px solid ${on ? th.accent : th.line}`, background: on ? th.chip : 'transparent', color: th.ink, fontFamily: 'inherit' }}>
      {children}
    </button>
  );
}

// 숫자 배열 → 선 그래프 (svg)
function LineChart({ th, xs, ys, mark, point, xLabel, yLabel, bars = false }) {
  const W = 600, H = 300, L = 44, R = 16, T = 20, B = 36;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const finite = ys.filter(Number.isFinite);
  const ymin = Math.min(0, ...finite), ymax = Math.max(...finite, 1e-9);
  const X = (v) => L + ((v - xmin) / (xmax - xmin || 1)) * (W - L - R);
  const Y = (v) => H - B - ((v - ymin) / (ymax - ymin || 1)) * (H - T - B);
  const d = xs.map((x, i) => (Number.isFinite(ys[i]) ? `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(ys[i]).toFixed(1)}` : '')).join(' ');
  const bw = ((W - L - R) / xs.length) * 0.6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${xLabel}에 따른 ${yLabel}`}>
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={th.ink} strokeWidth="1.5" />
      <line x1={L} y1={T} x2={L} y2={H - B} stroke={th.ink} strokeWidth="1.5" />
      <text x={W - R} y={H - 10} fontSize="13" textAnchor="end" fill={th.sub}>{xLabel} →</text>
      <text x={L + 6} y={T + 2} fontSize="13" fill={th.sub}>{yLabel}</text>
      {bars
        ? xs.map((x, i) => (
          <rect key={i} x={X(x) - bw / 2} y={Y(ys[i])} width={bw} height={H - B - Y(ys[i])} rx="3"
            fill={mark?.index === i ? th.accent : th.chip} stroke={th.accent} strokeWidth="1" />
        ))
        : <path d={d} fill="none" stroke={th.accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}
      {mark && !bars && Number.isFinite(mark.x) && (
        <g>
          <line x1={X(mark.x)} y1={T} x2={X(mark.x)} y2={H - B} stroke={th.accent} strokeDasharray="5 5" />
          <text x={X(mark.x)} y={T - 4} fontSize="13" textAnchor="middle" fill={th.accent}>{mark.label}</text>
        </g>
      )}
      {point && Number.isFinite(point.y) && (
        <circle cx={X(point.x)} cy={Y(point.y)} r="9" fill={th.panel} stroke={th.ink} strokeWidth="3" />
      )}
      {xs.length <= 12 && xs.map((x, i) => (
        <text key={i} x={X(x)} y={H - B + 18} fontSize="12" textAnchor="middle" fill={th.sub}>{String(x)}</text>
      ))}
    </svg>
  );
}

const fmt = (n) => (Number.isFinite(n) ? (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : Number(n.toFixed(2)).toString()) : '-');

// ── 유형별 그리기 ───────────────────────────────────────────

function Sim({ th, body, side }) {
  const vars = body.variables ?? [];
  const [vals, setVals] = useState(() => Object.fromEntries(vars.map((v) => [v.key, v.default ?? v.min])));
  const xKey = body.x ?? vars[0]?.key;
  const xVar = vars.find((v) => v.key === xKey) ?? vars[0];

  const f = useMemo(() => { try { return compile(body.formula); } catch { return null; } }, [body.formula]);
  const m = useMemo(() => { try { return body.marker?.formula ? compile(body.marker.formula) : null; } catch { return null; } }, [body.marker]);
  const calc = (scope) => { try { const r = f?.evaluate(scope); return typeof r === 'number' ? r : NaN; } catch { return NaN; } };

  if (!f || !xVar) return <Panel th={th}><span>수식을 읽지 못했어요. "말로 고치기"로 다시 만들어 주세요.</span></Panel>;

  const xs = Array.from({ length: 61 }, (_, i) => xVar.min + ((xVar.max - xVar.min) * i) / 60);
  const ys = xs.map((x) => calc({ ...vals, [xKey]: x }));
  const cur = calc(vals);
  const best = ys.reduce((bi, y, i) => (y > ys[bi] ? i : bi), 0);
  let markX = NaN;
  try { markX = m ? m.evaluate(vals) : NaN; } catch { /* 표시 안 함 */ }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: side ? 'minmax(200px,260px) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
      <Panel th={th} className={side ? '' : 'order-2'}>
        {vars.map((v) => (
          <label key={v.key} className="flex flex-col gap-1.5">
            <span className="flex justify-between text-[15px] font-bold">
              <span>{v.label}</span><span style={{ color: th.accent }}>{fmt(vals[v.key])}{v.unit ?? ''}</span>
            </span>
            <input type="range" min={v.min} max={v.max} step={v.step ?? (v.max - v.min) / 100}
              value={vals[v.key]} onChange={(e) => setVals((p) => ({ ...p, [v.key]: Number(e.target.value) }))}
              style={{ accentColor: th.accent }} />
          </label>
        ))}
        <span className="text-[13px] leading-relaxed" style={{ color: th.sub }}>모형: {body.formula}</span>
      </Panel>
      <Panel th={th}>
        <LineChart th={th} xs={xs} ys={ys} xLabel={xVar.label} yLabel={body.output?.label ?? '결과'}
          point={{ x: vals[xKey], y: cur }} mark={body.marker ? { x: markX, label: body.marker.label } : null} />
        <div className="grid grid-cols-3 gap-2">
          <Stat th={th} k={`현재 ${body.output?.label ?? '값'}`} v={fmt(cur)} />
          <Stat th={th} k="가장 클 때" v={`${fmt(xs[best])}${xVar.unit ?? ''}`} />
          <Stat th={th} k="최댓값 대비" v={ys[best] ? `${Math.round((cur / ys[best]) * 100)}%` : '-'} />
        </div>
      </Panel>
    </div>
  );
}

function Exp({ th, body, side }) {
  const cols = body.columns ?? [];
  const rows = body.rows ?? [];
  const xc = cols.find((c) => c.key === body.x) ?? cols[0];
  const yc = cols.find((c) => c.key === body.y) ?? cols[1];
  if (!xc || !yc) return null;
  const xs = rows.map((r) => r[xc.key]);
  const ys = rows.map((r) => Number(r[yc.key]));
  const numericX = xs.every((x) => typeof x === 'number');
  const idx = body.highlight === 'min' ? ys.indexOf(Math.min(...ys)) : ys.indexOf(Math.max(...ys));

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: side ? 'minmax(200px,260px) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
      <Panel th={th} className={side ? '' : 'order-2'}>
        <div className="grid grid-cols-2 text-[13px]" style={{ color: th.sub }}>
          <span>{xc.label}{xc.unit ? ` (${xc.unit})` : ''}</span><span>{yc.label}{yc.unit ? ` (${yc.unit})` : ''}</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-2 py-1.5 text-[15px]" style={{ borderTop: `1px solid ${th.line}`, fontWeight: i === idx ? 700 : 400 }}>
            <span>{String(r[xc.key])}</span><span>{String(r[yc.key])}</span>
          </div>
        ))}
      </Panel>
      <Panel th={th}>
        <LineChart th={th} xs={numericX ? xs : xs.map((_, i) => i + 1)} ys={ys} xLabel={xc.label} yLabel={yc.label}
          bars={body.chart === 'bar' || !numericX} mark={{ index: idx }} point={body.chart === 'bar' || !numericX ? null : { x: xs[idx], y: ys[idx] }} />
        <div className="grid grid-cols-2 gap-2">
          <Stat th={th} k={body.highlight === 'min' ? '가장 작을 때' : '가장 클 때'} v={`${String(xs[idx])}${xc.unit ?? ''}`} />
          <Stat th={th} k={yc.label} v={`${fmt(ys[idx])}${yc.unit ?? ''}`} />
        </div>
      </Panel>
    </div>
  );
}

function Explain({ th, body, side }) {
  const steps = body.steps ?? [];
  const [k, setK] = useState(0);
  if (!steps.length) return null;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: side ? 'minmax(200px,280px) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
      <Panel th={th} className={side ? '' : 'order-2'}>
        {steps.map((s, i) => (
          <Pick key={i} th={th} on={i === k} onClick={() => setK(i)}>
            <b style={{ color: th.accent }}>{i + 1}단계</b> {s.title}
          </Pick>
        ))}
      </Panel>
      <Panel th={th} className="justify-between">
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-bold" style={{ color: th.accent }}>{k + 1} / {steps.length}</span>
          <span className="text-2xl font-bold" style={{ fontFamily: th.titleFont }}>{steps[k].title}</span>
          <span className="text-[17px] leading-relaxed">{steps[k].body}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setK(Math.max(0, k - 1))} className="min-h-[44px] px-4"
            style={{ borderRadius: th.radius, border: `1px solid ${th.line}`, color: th.ink, fontFamily: 'inherit' }}>이전 단계</button>
          <button onClick={() => setK(Math.min(steps.length - 1, k + 1))} className="min-h-[44px] px-4 font-bold"
            style={{ borderRadius: th.radius, background: th.accent, color: th.onAccent, fontFamily: 'inherit' }}>다음 단계</button>
        </div>
      </Panel>
    </div>
  );
}

function Dash({ th, body }) {
  const rows = body.rows ?? [];
  const g = body.group, v = body.value;
  const unit = (body.columns ?? []).find((c) => c.key === v)?.unit ?? '';
  const vals = rows.map((r) => Number(r[v]));
  const max = Math.max(...vals), min = Math.min(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const cards = { avg: ['평균', fmt(avg) + unit], max: ['가장 큰 곳', String(rows[vals.indexOf(max)]?.[g] ?? '-')], min: ['가장 작은 곳', String(rows[vals.indexOf(min)]?.[g] ?? '-')] };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
        {(body.cards ?? ['avg', 'max', 'min']).map((c) => cards[c] && <Stat key={c} th={th} k={cards[c][0]} v={cards[c][1]} />)}
      </div>
      <Panel th={th}>
        <div className="flex h-56 items-end gap-3">
          {rows.map((r, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-sm font-bold">{fmt(vals[i])}{unit}</span>
              <div className="w-full" style={{ height: `${(vals[i] / (max || 1)) * 150}px`, background: vals[i] === max ? th.accent : th.chip, borderRadius: '6px 6px 0 0' }} />
              <span className="text-sm" style={{ color: th.sub }}>{String(r[g])}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Survey({ th, body, side }) {
  const opts = body.options ?? [];
  const [counts, setCounts] = useState(() => opts.map((_, i) => Number(body.counts?.[i] ?? 0)));
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const top = Math.max(...counts);
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: side ? 'minmax(200px,260px) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
      <Panel th={th} className={side ? '' : 'order-2'}>
        <span className="text-[15px] font-bold">{body.question}</span>
        {opts.map((o, i) => (
          <Pick key={o} th={th} on={false} onClick={() => setCounts((c) => c.map((n, j) => (j === i ? n + 1 : n)))}>{o} 응답 +1</Pick>
        ))}
      </Panel>
      <Panel th={th}>
        <span className="text-sm" style={{ color: th.sub }}>응답 {counts.reduce((a, b) => a + b, 0)}명{body.target ? ` · ${body.target}` : ''}</span>
        {opts.map((o, i) => (
          <div key={o} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[15px]"><span>{o}</span><b>{Math.round((counts[i] / total) * 100)}%</b></div>
            <div className="h-5 overflow-hidden rounded-full" style={{ background: th.chip }}>
              <div className="h-full rounded-full" style={{ width: `${(counts[i] / total) * 100}%`, background: counts[i] === top ? th.accent : th.sub }} />
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Compare({ th, body }) {
  const items = body.items ?? [];
  const crits = body.criteria ?? [];
  const [c, setC] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {crits.map((label, i) => <Pick key={label} th={th} on={i === c} onClick={() => setC(i)}>{label}</Pick>)}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {items.map((name, ii) => (
          <Panel key={name} th={th}>
            <span className="text-2xl font-bold" style={{ fontFamily: th.titleFont, color: th.accent }}>{name}</span>
            {crits.map((label, ci) => (
              <div key={label} className="flex flex-col gap-0.5 px-3 py-2" style={{ background: ci === c ? th.chip : 'transparent', borderRadius: th.radius }}>
                <span className="text-[13px]" style={{ color: th.sub }}>{label}</span>
                <span className="text-[15px] leading-relaxed" style={{ fontWeight: ci === c ? 700 : 400 }}>{body.cells?.[ci]?.[ii] ?? '-'}</span>
              </div>
            ))}
          </Panel>
        ))}
      </div>
    </div>
  );
}

function Quiz({ th, body }) {
  const [pick, setPick] = useState(-1);
  const opts = body.options ?? [];
  return (
    <Panel th={th}>
      <span className="text-[17px] leading-relaxed">{body.scenario}</span>
      {opts.map((o, i) => <Pick key={i} th={th} on={pick === i} onClick={() => setPick(i)}>{o.label}</Pick>)}
      {pick >= 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
          <div className="flex flex-col gap-1 p-3.5" style={{ background: th.chip, borderRadius: th.radius }}>
            <span className="text-[13px]" style={{ color: th.sub }}>이 선택을 지지하는 관점</span>
            <span className="text-[15px] leading-relaxed">{opts[pick].pro}</span>
          </div>
          <div className="flex flex-col gap-1 p-3.5" style={{ background: th.chip, borderRadius: th.radius }}>
            <span className="text-[13px]" style={{ color: th.sub }}>반대하는 관점</span>
            <span className="text-[15px] leading-relaxed">{opts[pick].con}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function MapTimeline({ th, body, side }) {
  const evs = body.events ?? [];
  const [k, setK] = useState(evs.length - 1);
  if (!evs.length) return null;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: side ? 'minmax(200px,260px) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
      <Panel th={th} className={side ? '' : 'order-2'}>
        <span className="text-[15px]" style={{ color: th.sub }}>{String(evs[k].at)}</span>
        <span className="text-5xl font-bold leading-none" style={{ fontFamily: th.titleFont, color: th.accent }}>{evs[k].value}</span>
        <span className="text-[15px] leading-relaxed">{evs[k].note}</span>
        <input type="range" min={0} max={evs.length - 1} value={k} onChange={(e) => setK(Number(e.target.value))}
          style={{ accentColor: th.accent }} aria-label="시점 고르기" />
      </Panel>
      <Panel th={th}>
        {evs.map((e, i) => (
          <button key={i} onClick={() => setK(i)} className="flex items-start gap-3.5 text-left" style={{ opacity: i <= k ? 1 : 0.4, color: th.ink, fontFamily: 'inherit' }}>
            <span className="w-16 shrink-0 text-lg font-bold" style={{ color: i === k ? th.accent : th.sub }}>{String(e.at)}</span>
            <span className="flex flex-col gap-0.5 pl-3.5" style={{ borderLeft: `3px solid ${i === k ? th.accent : th.line}` }}>
              <span className="text-[17px] font-bold">{e.value}</span>
              <span className="text-sm leading-relaxed" style={{ color: th.sub }}>{e.note}</span>
            </span>
          </button>
        ))}
      </Panel>
    </div>
  );
}

const RENDER = { sim: Sim, exp: Exp, explain: Explain, dash: Dash, survey: Survey, compare: Compare, quiz: Quiz, map: MapTimeline };

// ── 전체 결과물 ─────────────────────────────────────────────
export default function OutputRenderer({ output }) {
  const base = THEMES[output.theme] ?? THEMES.textbook;
  const content = output.content ?? {};
  const dark = ['lab', 'glass'].includes(output.theme);
  const th = {
    ...base,
    accent: content.style?.accent ?? base.accent,
    line: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)',
    onAccent: dark ? '#0B1020' : '#FFFFFF',
  };
  const Body = RENDER[output.output_type];

  return (
    <div className="relative overflow-hidden rounded-[18px]" style={{ background: th.bg, color: th.ink, fontFamily: th.font }}>
      {th.blobs && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 -top-20 h-80 w-80 rounded-full opacity-70 blur-[60px]" style={{ background: '#6C8CFF' }} />
          <div className="absolute -right-10 top-32 h-72 w-72 rounded-full opacity-55 blur-[60px]" style={{ background: '#FF8FB1' }} />
        </div>
      )}
      {th.hills && (
        <svg aria-hidden="true" viewBox="0 0 800 260" preserveAspectRatio="none" className="pointer-events-none absolute left-0 top-0 h-[260px] w-full">
          <rect width="800" height="260" fill="#FFE9D2" />
          <circle cx="640" cy="70" r="38" fill="#FFC98B" opacity="0.8" />
          <path d="M0 170 C120 120 220 130 330 160 S560 120 800 150 V260 H0 Z" fill="#CFE3C4" />
          <path d="M0 210 C150 170 260 190 400 205 S640 180 800 200 V260 H0 Z" fill="#A9CFA0" />
        </svg>
      )}

      <div className="relative flex flex-col gap-5 p-7">
        <div className="flex flex-col gap-1.5" style={{ paddingBottom: th.hills ? 64 : 0 }}>
          <span className="text-[13px] font-bold tracking-wider" style={{ color: th.head ?? th.accent }}>탐구 결과물</span>
          <h1 className="m-0 text-3xl font-bold leading-tight" style={{ fontFamily: th.titleFont, color: th.head ?? th.ink }}>{content.title}</h1>
          {content.subtitle && <span className="text-[15px]" style={{ color: th.head ? 'rgba(255,255,255,0.9)' : th.sub }}>{content.subtitle}</span>}
        </div>

        {Body && content.body ? <Body th={th} body={content.body} side={output.layout !== 'stack'} /> : null}

        {content.sample && (
          <span className="text-xs" style={{ color: th.head ? 'rgba(255,255,255,0.85)' : th.sub }}>
            예시 값이 들어 있어요 · 직접 잰 값으로 바꾸면 보고서에 그대로 쓸 수 있어요
          </span>
        )}
      </div>
    </div>
  );
}