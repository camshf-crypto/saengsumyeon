/*
 * 보고서 디자인 템플릿 — 편집기 미리보기와 PDF 출력이 같이 쓴다
 * 템플릿 = 1장(디자인마다 다른 '탐구의 얼굴') + 2~4장(그 디자인의 색·글씨체를 이어받는 공통 틀)
 * 모든 학생 입력은 esc()로 감싸서 넣는다
 */

export const A4 = { w: 794, h: 1123 };

const esc = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const P = (t, size, w = 400, c = "#1F2640", extra = "") =>
  `<p style="margin:0;font-size:${size}px;line-height:1.6;font-weight:${w};color:${c};${extra}">${t}</p>`;

/* 디자인 고르기 미리보기 중이면 '사례 예시 이미지'처럼 보여준다 (renderPages가 잠깐 켠다) */
let PREVIEW = null;

/* 사진 칸 — 올린 사진이 있으면 사진, 없으면 점선 안내 (미리보기는 예시 이미지) */
function photo(src, w, h, label, note, fg = "#6A7290", bd = "#B8BED0", bg = "#FAFBFD", radius = 8) {
  if (!src && PREVIEW)
    return `<div style="width:${w};height:${h}px;flex-shrink:0;box-sizing:border-box;border-radius:${radius}px;background:linear-gradient(135deg,#E5E7EB,#D1D5DB);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#6B7280">
<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#6B7280" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="9" cy="10" r="2"></circle><path d="M21 17l-5-5-8 8"></path></svg>
<span style="font-size:13px;font-weight:700">${esc(PREVIEW)} 예시 이미지</span></div>`;
  if (src)
    return `<div style="width:${w};height:${h}px;flex-shrink:0;border-radius:${radius}px;overflow:hidden;background:#EEE"><img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div>`;
  return `<div class="slot-photo" style="width:${w};height:${h}px;flex-shrink:0;box-sizing:border-box;border:1.5px dashed ${bd};border-radius:${radius}px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:${fg}">
<span style="font-size:12.5px;font-weight:700">${esc(label)}</span><span style="font-size:11px;opacity:.85">${esc(note)}</span></div>`;
}

/* 학생이 채워야 하는 칸 — 비어 있으면 안내 상자 */
function voice(text, slot, tok, size = 13.5) {
  if (text && String(text).trim()) return P(esc(text), size, 400, tok.body, "line-height:1.8");
  return `<div class="slot-todo" style="padding:12px 14px;border:1.5px dashed ${tok.accent};border-radius:8px;background:${tok.soft}">
${P(esc(slot?.guide ?? "내 말로 채워 주세요"), 12.5, 700, tok.accent)}${slot?.starter ? P("예) " + esc(slot.starter), 12, 400, tok.body, "margin-top:4px;opacity:.8") : ""}</div>`;
}

/* 결과 그래프(숫자) 또는 비교표(글) */
export function seriesOf(d) {
  if (!d) return [];
  if (d.kind === "table")
    return d.rows.map((r, i) => {
      const v = d.cells[i].filter((x) => String(x).trim() !== "").map(Number).filter(Number.isFinite);
      return { label: r, value: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null };
    });
  if (d.kind === "pairs") return d.rows.filter((r) => r.label).map((r) => ({ label: r.label, value: r.value === "" ? null : Number(r.value) }));
  if (d.kind === "survey") {
    const q = d.questions?.[0];
    if (!q) return [];
    const n = q.counts.map((c) => Number(c) || 0);
    const sum = n.reduce((a, b) => a + b, 0);
    return q.options.map((o, i) => ({ label: o, value: sum ? Math.round((n[i] / sum) * 100) : null, unit: "%" }));
  }
  return [];
}
function bars(series, w, h, cBase, cHi, fg, sub, unit = "") {
  const vals = series.map((s) => s.value).filter((v) => v != null);
  if (!vals.length) return "";
  const max = Math.max(...vals) * 1.18 || 1, base = h - 24, top = 18, slot = (w - 16) / series.length, bw = Math.min(46, slot * 0.62);
  let s = "";
  series.forEach((d, i) => {
    if (d.value == null) return;
    const x = 8 + i * slot + (slot - bw) / 2, hh = Math.round((d.value / max) * (base - top));
    s += `<rect x="${x}" y="${base - hh}" width="${bw}" height="${hh}" rx="3" fill="${i === series.length - 1 ? cHi : cBase}"></rect>`;
    s += `<text x="${x + bw / 2}" y="${base - hh - 5}" text-anchor="middle" font-size="12" font-weight="700" fill="${fg}">${d.value}${esc(d.unit ?? unit)}</text>`;
    s += `<text x="${x + bw / 2}" y="${base + 16}" text-anchor="middle" font-size="11" fill="${sub}">${esc(String(d.label).slice(0, 7))}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><line x1="4" y1="${base}" x2="${w - 4}" y2="${base}" stroke="${sub}" stroke-opacity=".4"></line>${s}</svg>`;
}
function table(d, ink, line, headBg, fs = 12, maxCols = 3) {
  if (!d?.rows?.length || !d.cols) return "";
  const cols = d.cols.slice(0, maxCols - 1);
  const th = [`자료`, ...cols].map((h) => `<th style="padding:7px 8px;border:1px solid ${line};background:${headBg};font-size:${fs}px;font-weight:700;color:${ink};text-align:left">${esc(h)}</th>`).join("");
  const tr = d.rows
    .map((r, i) => `<tr><td style="padding:7px 8px;border:1px solid ${line};font-size:${fs}px;font-weight:700;color:${ink}">${esc(r)}</td>${cols.map((_, j) => `<td style="padding:7px 8px;border:1px solid ${line};font-size:${fs}px;line-height:1.45">${esc(d.cells?.[i]?.[j] ?? "")}</td>`).join("")}</tr>`)
    .join("");
  return `<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/* 보고서 내용 → 템플릿이 쓰는 모양 */
export function toContent(inq) {
  const r = inq.report ?? {}, res = inq.results ?? {};
  const m = r.meta ?? {};
  return {
    r,
    name: { lit: "문헌 탐구", case: "사례 탐구", data: "데이터 탐구", survey: "설문조사 탐구", exp: "실험 탐구", obs: "관찰 탐구" }[inq.method] ?? "탐구",
    subj: m.subject ?? inq.subject ?? "",
    who: `${m.grade ?? inq.grade ?? ""} ${r.student ?? "○반 ○번 [이름]"}`,
    title: r.title ?? inq.suggestion,
    q: r.question ?? "",
    m1: r.memory?.l1 ?? "", m2: r.memory?.l2 ?? "",
    finding: r.results?.finding ?? "",
    steps: (r.method?.steps ?? []).slice(0, 4).map((x) => [x.title, x.detail]),
    think: r.mine || r.interpretation || "",
    limit: r.limits ?? "", nxt: r.next ?? "",
    data: res.data, series: seriesOf(res.data),
    photos: r.photos ?? {},
    surveyQs: (res.data?.kind === "survey" ? res.data.questions : []).map((q) => {
      const n = q.counts.map((x) => Number(x) || 0), sum = n.reduce((a, b) => a + b, 0);
      return { text: q.text, options: q.options.map((o, i) => ({ label: o, pct: sum ? Math.round((n[i] / sum) * 100) : null })) };
    }),
    total: res.data?.total ?? "",
    levels: inq.pack?.pack?.criteria ?? [],
    hypo: inq.pack?.pack?.hypothesis ?? "",
    vars: inq.pack?.pack?.variables ?? null,
    unit: res.data?.unit ?? "",
    photoNote: { lit: "찾은 자료의 첫 장 캡처", case: "현장 사진 · 상표는 가려요", data: "데이터 화면 캡처", survey: "설문 화면 캡처", exp: "실험 모습 · 결과 사진", obs: "관찰 기록 사진" }[inq.method] ?? "",
  };
}

/* ── 1장 디자인들 (문헌 탐구 5종 · 캔버스 디자인폼과 같은 콘셉트) ── */
const PAGE1 = {
  lit1: (c) => { // 도서 대출카드
    const ink = "#3B2F2A", red = "#B23A2E";
    return { bg: "#FBF5E6", tok: { ink, accent: red, body: ink, soft: "#FFF9EC", head: "'Nanum Myeongjo',serif", bg: "#FBF5E6", line: "#CBB99A" }, html: `
<div style="padding:46px 54px;display:flex;flex-direction:column;gap:16px;font-family:'Nanum Myeongjo',serif;color:${ink}">
<div style="display:flex;justify-content:space-between">${P("READING CARD · " + esc(c.name), 12, 800, red, "font-family:inherit;letter-spacing:.1em")}${P(esc(c.subj + " · " + c.who), 12, 400, ink, "font-family:inherit")}</div>
<p style="margin:0;font-size:26px;line-height:1.4;font-weight:800">${esc(c.title)}</p>
<div style="position:relative;padding:26px 30px;border:2px solid ${ink};background:#FFF9EC">
<div style="position:absolute;top:18px;right:22px;padding:6px 12px;border:3px solid ${red};color:${red};font-size:15px;font-weight:800;transform:rotate(-8deg)">핵심 발견</div>
<p style="margin:0;font-size:36px;line-height:1.25;font-weight:800">${esc(c.m1)}<br><span style="color:${red}">${esc(c.m2)}</span></p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.7">${esc(c.finding)}</p></div>
<div style="border:2px solid ${ink};background:#FFFDF5"><div style="padding:8px 12px;background:${ink};color:#FFF9EC;font-size:13px;font-weight:800;letter-spacing:.1em">대출 기록 · 내가 읽은 자료</div>
<div style="font-family:'Noto Sans KR',sans-serif">${table(c.data, ink, "#CBB99A", "#F3E6CC", 11.5)}</div></div>
<div style="display:flex;gap:16px">${photo(c.photos.p1, "40%", 160, "사진 넣는 곳", c.photoNote, "#8A7355", "#CBB99A", "#FFF9EC", 0)}
<div style="flex:1;display:flex;flex-direction:column;gap:8px">${P("읽고 나서 달라진 생각", 15, 800, ink, "font-family:inherit")}${P(esc(c.think), 13, 400, ink, "line-height:1.8;font-family:inherit")}</div></div>
<div style="display:flex;gap:12px;font-family:'Noto Sans KR',sans-serif">${P("<b>한계</b> " + esc(c.limit), 12, 400, ink, "flex:1;padding:10px;border:1px dashed #CBB99A")}${P("<b>다음에 읽을 질문</b> " + esc(c.nxt), 12, 400, ink, "flex:1;padding:10px;background:#F3E6CC")}</div>
</div>` };
  },
  lit2: (c) => { // 논문 초록형
    const ink = "#1A1A1A", acc = "#1F4E79";
    return { bg: "#FFFFFF", tok: { ink, accent: acc, body: "#1A1A1A", soft: "#EEF2F7", head: "'Nanum Myeongjo',serif", bg: "#FFFFFF", line: "#999" }, html: `
<div style="padding:52px 64px;display:flex;flex-direction:column;gap:14px;font-family:'Nanum Myeongjo',serif;color:${ink}">
<p style="margin:0;text-align:center;font-size:12px;letter-spacing:.2em;color:#555">${esc(c.subj)} · ${esc(c.name)} 보고서</p>
<p style="margin:0;text-align:center;font-size:24px;line-height:1.45;font-weight:800">${esc(c.title)}</p>
<p style="margin:0;text-align:center;font-size:13px;color:#444">${esc(c.who)}</p>
<div style="margin:6px 40px 0;padding:14px 18px;border-top:1px solid ${ink};border-bottom:1px solid ${ink}"><p style="margin:0;font-size:12.5px;font-weight:800;letter-spacing:.1em">초록</p><p style="margin:6px 0 0;font-size:13px;line-height:1.75">${esc(c.finding)} ${esc(c.limit)}</p></div>
<div style="margin:10px 0;padding:22px 0;border-top:4px solid ${acc};border-bottom:1px solid ${acc};text-align:center"><p style="margin:0;font-size:32px;line-height:1.3;font-weight:800">“${esc(c.m1)} <span style="color:${acc}">${esc(c.m2)}</span>”</p></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:26px">
<div style="display:flex;flex-direction:column;gap:8px">${P("1. 탐구 동기", 14, 800, acc, "font-family:inherit")}${P(esc(c.q), 13, 400, ink, "line-height:1.75;font-family:inherit")}${P("2. 탐구 방법", 14, 800, acc, "font-family:inherit")}${P(esc(c.steps.map((x) => x[0]).join(" → ")), 13, 400, ink, "line-height:1.75;font-family:inherit")}${photo(c.photos.p1, "100%", 150, "사진 넣는 곳", c.photoNote, "#666", "#AAA", "#FAFAFA", 0)}</div>
<div style="display:flex;flex-direction:column;gap:8px">${P("3. 자료 비교", 14, 800, acc, "font-family:inherit")}<div style="font-family:'Noto Sans KR',sans-serif">${table(c.data, ink, "#999", "#EEF2F7", 11)}</div>${P("4. 논의", 14, 800, acc, "font-family:inherit")}${P(esc(c.think), 12.5, 400, ink, "line-height:1.75;font-family:inherit")}${P("5. 후속 연구", 14, 800, acc, "font-family:inherit")}${P(esc(c.nxt), 12.5, 400, ink, "font-family:inherit")}</div>
</div></div>` };
  },
  lit3: (c) => { // 인용 하이라이트
    const g = "#14532D", lg = "#DCFCE7";
    return { bg: "#FFFFFF", tok: { ink: g, accent: g, body: "#374151", soft: lg, head: "'Noto Sans KR',sans-serif", bg: "#FFFFFF", line: "#86EFAC" }, html: `
<div style="position:absolute;top:0;bottom:0;left:0;width:16px;background:${g}"></div>
<div style="padding:50px 56px 0 70px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;gap:8px;align-items:center"><span style="padding:4px 10px;border-radius:999px;background:${lg};color:${g};font-size:12px;font-weight:700">${esc(c.name)}</span>${P(esc(c.subj + " · " + c.who), 12, 400, "#6B7280")}</div>
<p style="margin:0;font-size:24px;line-height:1.4;font-weight:900;color:#111827">${esc(c.title)}</p>
<div style="position:relative;margin-top:10px;padding:30px 30px 26px 34px;background:${lg};border-radius:4px">
<span style="position:absolute;top:-30px;left:10px;font-family:'Nanum Myeongjo',serif;font-size:110px;line-height:1;color:${g}">“</span>
<p style="margin:0;font-size:36px;line-height:1.25;font-weight:900;color:${g}">${esc(c.m1)}<br>${esc(c.m2)}</p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.7;font-weight:700;color:${g}">${esc(c.finding)}</p></div>
<div style="display:grid;grid-template-columns:1.1fr 1fr;gap:22px">
<div style="display:flex;flex-direction:column;gap:10px">${P("왜 이 질문을?", 15, 900, "#111827")}${P(esc(c.q), 13, 400, "#374151")}${P("생각의 변화", 15, 900, "#111827", "margin-top:6px")}${P(esc(c.think), 13, 400, "#374151", "line-height:1.75")}</div>
<div style="display:flex;flex-direction:column;gap:10px">${photo(c.photos.p1, "100%", 170, "사진 넣는 곳", c.photoNote, g, "#86EFAC", "#F7FEF9")}${P("다음 질문", 13, 900, g)}${P(esc(c.nxt), 12.5, 400, "#374151")}</div></div>
<div style="padding-top:12px;border-top:1px solid #D1D5DB">${P("비교한 자료", 12, 900, "#111827")}${table(c.data, g, "#D1D5DB", lg, 11)}${P(esc(c.limit), 11.5, 400, "#6B7280", "margin-top:6px")}</div>
</div>` };
  },
  lit4: (c) => { // 자료 지도
    const ink = "#1E1B4B", cols = ["#6366F1", "#EC4899", "#F59E0B", "#10B981"];
    const d = c.data ?? {};
    const cards = (d.rows ?? []).slice(0, 4).map((r, i) => `<div style="padding:14px;border-radius:12px;background:#fff;border-top:6px solid ${cols[i]};box-shadow:0 2px 8px rgba(30,27,75,.08)"><p style="margin:0;font-size:12.5px;font-weight:800;color:${cols[i]};line-height:1.4">${esc(String(r).slice(0, 28))}</p>${(d.cols ?? []).slice(0, 2).map((col, j) => `<p style="margin:5px 0 0;font-size:11.5px;color:#374151;line-height:1.45"><span style="color:#6B7280">${esc(String(col).slice(0, 10))}</span> · <b>${esc(d.cells?.[i]?.[j] ?? "")}</b></p>`).join("")}</div>`);
    while (cards.length < 4) cards.push(`<div style="padding:14px;border-radius:12px;border:1.5px dashed #C7D2FE;color:#A5B4FC;font-size:12px">자료 ${cards.length + 1}</div>`);
    return { bg: "#F8FAFC", tok: { ink, accent: "#6366F1", body: "#374151", soft: "#EEF2FF", head: "'Noto Sans KR',sans-serif", bg: "#F8FAFC", line: "#C7D2FE" }, html: `
<div style="padding:44px 50px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;justify-content:space-between">${P("SOURCE MAP · " + esc(c.name), 12, 900, "#6366F1", "letter-spacing:.1em")}${P(esc(c.subj + " · " + c.who), 12, 400, "#6B7280")}</div>
<p style="margin:0;font-size:23px;line-height:1.4;font-weight:900;color:${ink}">${esc(c.title)}</p>
<div style="display:grid;grid-template-columns:1fr 1.2fr 1fr;grid-template-rows:auto auto;gap:12px;align-items:center">
${cards[0]}<div style="grid-row:span 2;aspect-ratio:1;border-radius:50%;background:${ink};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center"><p style="margin:0;font-size:12px;font-weight:800;color:#A5B4FC">자료를 겹쳐 보니</p><p style="margin:8px 0 0;font-size:22px;line-height:1.3;font-weight:900;color:#fff">${esc(c.m1)}<br><span style="color:#FBBF24">${esc(c.m2)}</span></p></div>${cards[1]}
${cards[2]}${cards[3]}</div>
${P(esc(c.finding), 14, 700, ink, "padding:14px 16px;border-radius:10px;background:#EEF2FF")}
<div style="display:flex;gap:16px">${photo(c.photos.p1, "46%", 170, "사진 넣는 곳", c.photoNote, "#6366F1", "#C7D2FE", "#F8FAFF")}<div style="flex:1;display:flex;flex-direction:column;gap:8px">${P("자료를 겹쳐 보며 알게 된 것", 14, 900, ink)}${P(esc(c.think), 12.5, 400, "#374151", "line-height:1.75")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#374151", "padding:10px 12px;border-radius:10px;background:#F3F4F6")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#374151", "padding:10px 12px;border-radius:10px;border:1.5px solid #6366F1")}</div>
</div>` };
  },
  lit5: (c) => { // 책 표지형
    const sp = "#7C2D12", cream = "#FFF7ED";
    return { bg: "#FFFFFF", tok: { ink: sp, accent: "#EA580C", body: "#44403C", soft: cream, head: "'Black Han Sans',sans-serif", bg: "#FFFFFF", line: "#FDBA74" }, html: `
<div style="position:absolute;top:0;bottom:0;left:0;width:120px;background:${sp};display:flex;align-items:center;justify-content:center">
<p style="margin:0;transform:rotate(-90deg);white-space:nowrap;font-family:'Black Han Sans',sans-serif;font-size:32px;color:#FED7AA">${esc(c.name)} · ${esc(c.subj)}</p></div>
<div style="margin-left:120px;padding:48px 48px 0 44px;display:flex;flex-direction:column;gap:16px">
${P(esc(c.who), 12, 400, "#78716C")}
<p style="margin:0;font-family:'Black Han Sans',sans-serif;font-size:44px;line-height:1.18;color:${sp}">${esc(c.m1)}<br><span style="color:#EA580C">${esc(c.m2)}</span></p>
${P(esc(c.title), 17, 700, "#1C1917", "line-height:1.5")}
<div style="height:2px;width:80px;background:#EA580C"></div>
${P(esc(c.finding), 13.5, 400, "#44403C", "line-height:1.75")}
${table(c.data, sp, "#FDBA74", cream, 12)}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "48%", 170, "사진 넣는 곳", c.photoNote, "#9A3412", "#FDBA74", cream, 2)}<div style="flex:1;display:flex;flex-direction:column;gap:8px">${P("책장을 덮고 든 생각", 14, 900, sp)}${P(esc(c.think), 12.5, 400, "#44403C", "line-height:1.75")}</div></div>
${P("<b>다음 질문</b> " + esc(c.nxt) + " &#160; <b>한계</b> " + esc(c.limit), 11.5, 400, "#57534E", "padding:10px 12px;background:" + cream)}
</div>` };
  },
};

/* ── 2~4장: 1장 디자인의 색·글씨체를 이어받는 공통 틀 ── */
function inner(c, tok, pageNo, label, body) {
  return `<div style="position:absolute;inset:0;padding:52px 60px 40px;display:flex;flex-direction:column;gap:18px;background:${tok.bg}">
<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:2px solid ${tok.ink}">
<p style="margin:0;font-family:${tok.head};font-size:20px;font-weight:800;color:${tok.ink}">${label}</p>${P(esc(c.title), 11, 400, tok.body, "max-width:55%;text-align:right;opacity:.8")}</div>
${body}
<p style="margin:auto 0 0;text-align:center;font-size:11px;color:${tok.body};opacity:.6">${pageNo}</p></div>`;
}
const H = (t, tok) => `<p style="margin:0;font-family:${tok.head};font-size:16px;font-weight:800;color:${tok.ink}">${t}</p>`;

function page2(c, tok) {
  const r = c.r;
  const concepts = (r.concepts ?? []).map((x) => `<div style="padding:14px 16px;border-radius:8px;background:${tok.soft}">${P(esc(x.term), 14, 800, tok.ink)}${P(esc(x.explain), 13, 400, tok.body, "margin-top:4px")}</div>`).join("");
  return inner(c, tok, 2, "탐구 동기와 배경", `
${H("탐구 계기", tok)}${voice(r.motive?.text, r.motive, tok)}
<div style="padding:16px 18px;border-left:4px solid ${tok.accent};background:${tok.soft}">${P("출발 질문", 12, 700, tok.accent)}${P(esc(c.q), 16, 800, tok.ink, "margin-top:4px")}</div>
${H("알아야 할 개념", tok)}<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${concepts}</div>`);
}
function page3(c, tok) {
  const r = c.r;
  const steps = (r.method?.steps ?? []).map((x, i) => `<div style="display:flex;gap:12px"><span style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${tok.ink};color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</span><div>${P(esc(x.title), 14, 800, tok.ink)}${P(esc(x.detail), 13, 400, tok.body)}</div></div>`).join("");
  return inner(c, tok, 3, "탐구 방법과 과정", `
${P(esc(r.method?.summary ?? ""), 14, 400, tok.body, "line-height:1.8")}
<div style="display:flex;flex-direction:column;gap:12px">${steps}</div>
${photo(c.photos.p3, "100%", 230, "과정 사진 넣는 곳", c.photoNote, tok.accent, tok.line, tok.soft)}
${H("어려웠던 점과 해결", tok)}${voice(r.difficulty?.text, r.difficulty, tok)}`);
}
function page4(c, tok) {
  const r = c.r;
  const vis = c.series.some((s) => s.value != null) ? `<div style="display:flex;justify-content:center">${bars(c.series, 420, 190, tok.line, tok.accent, tok.ink, tok.body)}</div>` : table(c.data, tok.ink, tok.line, tok.soft, 11.5, 4);
  const refs = (r.references ?? []).map((x, i) => P(`${i + 1}. ${esc(x.title)}${x.publisher ? `, ${esc(x.publisher)}` : ""}${x.url ? ` <span style="opacity:.7">${esc(x.url)}</span>` : ""}`, 11, 400, tok.body, "word-break:break-all")).join("");
  return inner(c, tok, 4, "결과와 결론", `
${H("결과", tok)}${P(esc(r.results?.text ?? ""), 13.5, 400, tok.body, "line-height:1.8")}${vis}
${H("해석", tok)}${P(esc(r.interpretation ?? ""), 13.5, 400, tok.body, "line-height:1.8")}
<div style="padding:14px 16px;border-radius:8px;border:2px solid ${tok.accent}">${P("내 생각", 12, 800, tok.accent)}${voice(r.mine, { guide: "결과에서 가장 의외였던 점과 이유" }, tok, 14)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${P("<b>한계</b> " + esc(r.limits ?? ""), 12.5, 400, tok.body, `padding:12px;background:${tok.soft};border-radius:8px`)}${P("<b>다음 질문</b> " + esc(r.next ?? ""), 12.5, 400, tok.body, `padding:12px;border:1.5px solid ${tok.ink};border-radius:8px`)}</div>
${H("진로와의 연결", tok)}${voice(r.career?.text, r.career, tok)}
${refs ? `<div style="padding-top:10px;border-top:1px solid ${tok.line}">${P("참고 자료", 12, 800, tok.ink)}${refs}</div>` : ""}`);
}

/* ── 디자인별 속지 (2~4장) ──
 * kit = 그 디자인의 부품(틀·제목·본문·학생 칸·단계·개념·사진·참고자료)
 * 같은 내용을 kit마다 다른 모양으로 그린다
 */
function buildPages(c, kit) {
  const r = c.r;
  const vis = c.series.some((x) => x.value != null) ? kit.chart(c) : kit.table(c);
  return [
    kit.frame(2, "탐구 동기와 배경", [
      kit.h("탐구 계기"), kit.voice(r.motive?.text, r.motive),
      kit.question(c.q),
      kit.h("알아야 할 개념"), kit.concepts(r.concepts ?? []),
    ]),
    kit.frame(3, "탐구 방법과 과정", [
      kit.lead(r.method?.summary ?? ""),
      kit.steps(r.method?.steps ?? []),
      kit.photo(c.photos.p3, "과정 사진 넣는 곳", c.photoNote, 1),
      kit.h("어려웠던 점과 해결"), kit.voice(r.difficulty?.text, r.difficulty),
    ]),
    kit.frame(4, "결과와 결론", [
      kit.h("결과"), kit.para(r.results?.text ?? ""), vis,
      kit.h("해석"), kit.para(r.interpretation ?? ""),
      kit.mine(r.mine),
      kit.pair(r.limits ?? "", r.next ?? ""),
      kit.h("진로와의 연결"), kit.voice(r.career?.text, r.career),
      kit.refs(r.references ?? []),
    ]),
  ];
}

const KITS = {
  /* 도서 대출카드 — 줄 친 카드 속지, 빨간 도장 제목 */
  lit1: (c) => {
    const ink = "#3B2F2A", red = "#B23A2E", cream = "#FFF9EC", line = "#CBB99A", serif = "'Nanum Myeongjo',serif";
    const tok = { accent: red, body: ink, soft: cream };
    return {
      bg: "#FBF5E6",
      frame: (n, label, parts) => `<div style="position:absolute;inset:0;padding:44px 50px 36px;font-family:${serif};color:${ink}">
<div style="display:flex;justify-content:space-between;align-items:center">${P("READING CARD · " + n + " / 4", 12, 800, red, "font-family:inherit;letter-spacing:.12em")}${P(esc(c.who), 11.5, 400, ink, "font-family:inherit")}</div>
<div style="margin-top:12px;height:calc(100% - 40px);box-sizing:border-box;border:2px solid ${ink};background:${cream};background-image:repeating-linear-gradient(to bottom,transparent 0,transparent 33px,#EADFC8 33px,#EADFC8 34px);padding:26px 30px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center;gap:12px"><span style="padding:6px 14px;border:3px solid ${red};color:${red};font-size:18px;font-weight:800;transform:rotate(-3deg);display:inline-block">${label}</span></div>
${parts.join("")}</div></div>`,
      h: (t) => `<p style="margin:6px 0 0;font-size:16px;font-weight:800;color:${ink};border-bottom:2px solid ${ink};padding-bottom:4px;display:inline-block;align-self:flex-start">${t}</p>`,
      lead: (t) => P(esc(t), 14.5, 700, ink, "font-family:inherit;line-height:1.9"),
      para: (t) => P(esc(t), 13.5, 400, ink, "font-family:inherit;line-height:2"),
      voice: (t, slot) => voice(t, slot, tok, 13.5),
      question: (q) => `<div style="padding:14px 18px;background:#fff;border:1.5px solid ${ink}">${P("출발 질문", 11.5, 800, red, "font-family:inherit;letter-spacing:.1em")}${P(esc(q), 17, 800, ink, "font-family:inherit;margin-top:4px")}</div>`,
      concepts: (cs) => cs.map((x) => `<div style="display:grid;grid-template-columns:120px 1fr;border-top:1px solid ${line};padding-top:8px">${P(esc(x.term), 13.5, 800, red, "font-family:inherit")}${P(esc(x.explain), 13, 400, ink, "font-family:inherit")}</div>`).join(""),
      steps: (st) => st.map((x, i) => `<div style="display:grid;grid-template-columns:70px 1fr;gap:8px;border-top:1px dashed ${line};padding-top:8px">${P("No." + (i + 1), 13, 800, red, "font-family:inherit")}<div>${P(esc(x.title), 14, 800, ink, "font-family:inherit")}${P(esc(x.detail), 12.5, 400, ink, "font-family:inherit")}</div></div>`).join(""),
      photo: (src, l, n) => photo(src, "100%", 210, l, n, "#8A7355", line, "#fff", 0),
      chart: (c2) => `<div style="background:#fff;border:1px solid ${line};padding:10px;display:flex;justify-content:center">${bars(c2.series, 420, 180, "#D9C6A3", red, ink, "#8A7355")}</div>`,
      table: (c2) => `<div style="font-family:'Noto Sans KR',sans-serif;background:#fff">${table(c2.data, ink, line, "#F3E6CC", 11.5, 4)}</div>`,
      mine: (t) => `<div style="position:relative;padding:18px 20px;background:#fff;border:2px solid ${red}"><span style="position:absolute;top:-12px;left:14px;padding:0 8px;background:${cream};color:${red};font-size:13px;font-weight:800">내 생각</span>${voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, tok, 14)}</div>`,
      pair: (a, b) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-family:'Noto Sans KR',sans-serif">${P("<b>한계</b> " + esc(a), 12.5, 400, ink, "padding:10px;border:1px dashed " + line + ";background:#fff")}${P("<b>다음에 읽을 질문</b> " + esc(b), 12.5, 400, ink, "padding:10px;background:#F3E6CC")}</div>`,
      refs: (rs) => (rs.length ? `<div style="border-top:2px solid ${ink};padding-top:8px">${P("대출 목록 · 참고 자료", 12, 800, red, "font-family:inherit")}${rs.map((x, i) => P(`${i + 1}. ${esc(x.title)}${x.publisher ? ", " + esc(x.publisher) : ""}`, 11.5, 400, ink, "font-family:inherit")).join("")}</div>` : ""),
    };
  },

  /* 논문 초록 — 머리글·쪽번호, 2단 본문, 그림 캡션, 논문식 참고문헌 */
  lit2: (c) => {
    const ink = "#1A1A1A", acc = "#1F4E79", serif = "'Nanum Myeongjo',serif";
    const tok = { accent: acc, body: ink, soft: "#EEF2F7" };
    let fig = 0;
    return {
      bg: "#FFFFFF",
      frame: (n, label, parts) => `<div style="position:absolute;inset:0;padding:40px 64px 40px;font-family:${serif};color:${ink}">
<div style="display:flex;justify-content:space-between;border-bottom:1px solid ${ink};padding-bottom:6px">${P(esc(c.title), 10.5, 400, "#555", "font-family:inherit;font-style:italic;max-width:80%")}${P(String(n), 10.5, 700, ink, "font-family:inherit")}</div>
<p style="margin:22px 0 14px;font-size:18px;font-weight:800;color:${acc}">${n}. ${label}</p>
<div style="column-count:2;column-gap:26px;column-rule:1px solid #DDD;font-size:12.5px;line-height:1.85;height:calc(100% - 110px);column-fill:auto">${parts.join("")}</div></div>`,
      h: (t) => `<p style="margin:10px 0 4px;font-size:13.5px;font-weight:800;color:${acc};break-after:avoid">${t}</p>`,
      lead: (t) => `<p style="margin:0 0 8px;font-size:12.5px;line-height:1.85;text-indent:1em">${esc(t)}</p>`,
      para: (t) => `<p style="margin:0 0 8px;font-size:12.5px;line-height:1.85;text-indent:1em">${esc(t)}</p>`,
      voice: (t, slot) => `<div style="break-inside:avoid">${voice(t, slot, tok, 12.5)}</div>`,
      question: (q) => `<div style="break-inside:avoid;margin:8px 0;padding:10px 12px;border-top:2px solid ${acc};border-bottom:1px solid ${acc}">${P("연구 질문", 11, 800, acc, "font-family:inherit")}${P(esc(q), 13.5, 800, ink, "font-family:inherit")}</div>`,
      concepts: (cs) => cs.map((x) => `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.8;break-inside:avoid"><b>${esc(x.term)}</b> — ${esc(x.explain)}</p>`).join(""),
      steps: (st) => st.map((x, i) => `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.8;break-inside:avoid"><b>(${i + 1}) ${esc(x.title)}</b> ${esc(x.detail)}</p>`).join(""),
      photo: (src, l, n) => `<div style="break-inside:avoid;margin:8px 0">${photo(src, "100%", 170, l, n, "#666", "#AAA", "#FAFAFA", 0)}${P(`그림 ${++fig}. ${esc(l.replace(" 넣는 곳", ""))}`, 10.5, 400, "#555", "font-family:inherit;text-align:center;margin-top:4px")}</div>`,
      chart: (c2) => `<div style="break-inside:avoid;margin:8px 0">${bars(c2.series, 300, 160, "#9CB3CC", acc, ink, "#555")}${P(`그림 ${++fig}. 결과 비교`, 10.5, 400, "#555", "font-family:inherit;text-align:center")}</div>`,
      table: (c2) => `<div style="break-inside:avoid;margin:8px 0;font-family:'Noto Sans KR',sans-serif">${P("표 1. 자료 비교", 10.5, 700, "#555", "text-align:center;margin-bottom:4px")}${table(c2.data, ink, "#999", "#EEF2F7", 10, 3)}</div>`,
      mine: (t) => `<div style="break-inside:avoid;margin:8px 0;padding:10px 12px;background:#EEF2F7">${P("연구자 의견", 11, 800, acc, "font-family:inherit")}${voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, tok, 12.5)}</div>`,
      pair: (a, b) => `<p style="margin:0 0 6px;font-size:12.5px;line-height:1.8"><b>연구의 한계</b> ${esc(a)}</p><p style="margin:0 0 6px;font-size:12.5px;line-height:1.8"><b>후속 연구</b> ${esc(b)}</p>`,
      refs: (rs) => (rs.length ? `<div style="break-inside:avoid;margin-top:10px;border-top:1px solid ${ink};padding-top:6px">${P("참고문헌", 12, 800, ink, "font-family:inherit")}${rs.map((x) => P(`${esc(x.publisher || "")}${x.publisher ? ". " : ""}「${esc(x.title)}」.${x.url ? " " + esc(x.url) : ""}`, 10.5, 400, ink, "font-family:inherit;padding-left:1.5em;text-indent:-1.5em;word-break:break-all")).join("")}</div>` : ""),
    };
  },

  /* 인용 하이라이트 — 왼쪽 초록 띠, 학생 글은 큰 따옴표 인용 상자 */
  lit3: (c) => {
    const g = "#14532D", lg = "#DCFCE7";
    const tok = { accent: g, body: "#374151", soft: lg };
    const quoteBox = (inner) => `<div style="position:relative;padding:22px 22px 18px 30px;background:${lg};border-radius:4px"><span style="position:absolute;top:-22px;left:6px;font-family:'Nanum Myeongjo',serif;font-size:80px;line-height:1;color:${g}">“</span>${inner}</div>`;
    return {
      bg: "#FFFFFF",
      frame: (n, label, parts) => `<div style="position:absolute;top:0;bottom:0;left:0;width:16px;background:${g}"></div>
<div style="position:absolute;inset:0;padding:46px 56px 36px 70px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center;gap:10px"><span style="padding:4px 12px;border-radius:999px;background:${g};color:#fff;font-size:12.5px;font-weight:800">${n} · ${label}</span>${P(esc(c.title), 11, 400, "#6B7280")}</div>
${parts.join("")}<p style="margin:auto 0 0;text-align:right;font-size:11px;color:${g}">${n} / 4</p></div>`,
      h: (t) => `<p style="margin:6px 0 0;font-size:16px;font-weight:900;color:#111827"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g};margin-right:8px;vertical-align:middle"></span>${t}</p>`,
      lead: (t) => P(esc(t), 14, 700, "#111827", "line-height:1.8"),
      para: (t) => P(esc(t), 13.5, 400, "#374151", "line-height:1.85"),
      voice: (t, slot) => (t && String(t).trim() ? quoteBox(P(esc(t), 14, 700, g, "line-height:1.8")) : voice(t, slot, tok)),
      question: (q) => quoteBox(`${P("출발 질문", 11.5, 800, g)}${P(esc(q), 18, 900, g, "margin-top:4px;line-height:1.5")}`),
      concepts: (cs) => `<div style="display:flex;flex-direction:column;gap:8px">${cs.map((x) => `<div style="padding:10px 14px;border-left:4px solid ${g};background:#F7FEF9">${P(esc(x.term), 13.5, 800, g)}${P(esc(x.explain), 13, 400, "#374151")}</div>`).join("")}</div>`,
      steps: (st) => `<div style="display:flex;flex-direction:column;gap:10px">${st.map((x, i) => `<div style="display:flex;gap:12px"><span style="flex-shrink:0;font-size:24px;font-weight:900;color:${g};line-height:1">${String(i + 1).padStart(2, "0")}</span><div>${P(esc(x.title), 14, 800, "#111827")}${P(esc(x.detail), 13, 400, "#374151")}</div></div>`).join("")}</div>`,
      photo: (src, l, n) => photo(src, "100%", 220, l, n, g, "#86EFAC", "#F7FEF9"),
      chart: (c2) => `<div style="display:flex;justify-content:center;padding:10px;border-radius:8px;background:#F7FEF9">${bars(c2.series, 420, 180, "#86EFAC", g, "#111827", "#6B7280")}</div>`,
      table: (c2) => table(c2.data, g, "#D1D5DB", lg, 11.5, 4),
      mine: (t) => (t && String(t).trim() ? quoteBox(`${P("내 생각", 11.5, 800, g)}${P(esc(t), 16, 800, g, "margin-top:4px;line-height:1.6")}`) : voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, tok)),
      pair: (a, b) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${P("<b>한계</b> " + esc(a), 12.5, 400, "#374151", "padding:12px;background:#F3F4F6;border-radius:8px")}${P("<b>다음 질문</b> " + esc(b), 12.5, 400, g, "padding:12px;border:1.5px solid " + g + ";border-radius:8px")}</div>`,
      refs: (rs) => (rs.length ? `<div style="border-top:1px solid #D1D5DB;padding-top:8px">${P("참고한 자료", 12, 900, "#111827")}${rs.map((x, i) => P(`<sup style="color:${g};font-weight:700">${i + 1}</sup> ${esc(x.title)}${x.publisher ? " — " + esc(x.publisher) : ""}`, 11.5, 400, "#374151")).join("")}</div>` : ""),
    };
  },

  /* 자료 지도 — 색 띠 카드, 원형 번호, 개념은 가운데 원 중심 */
  lit4: (c) => {
    const ink = "#1E1B4B", cols = ["#6366F1", "#EC4899", "#F59E0B", "#10B981"];
    const tok = { accent: "#6366F1", body: "#374151", soft: "#EEF2FF" };
    const card = (inner, i = 0) => `<div style="padding:14px 16px;border-radius:12px;background:#fff;border-top:6px solid ${cols[i % 4]};box-shadow:0 2px 8px rgba(30,27,75,.08)">${inner}</div>`;
    return {
      bg: "#F8FAFC",
      frame: (n, label, parts) => `<div style="position:absolute;inset:0;padding:44px 50px 36px;display:flex;flex-direction:column;gap:14px;background:#F8FAFC">
<div style="display:flex;justify-content:space-between;align-items:center">${P("SOURCE MAP · " + n + " / 4", 12, 900, "#6366F1", "letter-spacing:.1em")}${P(esc(c.who), 11.5, 400, "#6B7280")}</div>
<p style="margin:0;font-size:24px;font-weight:900;color:${ink}">${label}</p>${parts.join("")}</div>`,
      h: (t) => `<p style="margin:4px 0 0;font-size:15px;font-weight:900;color:${ink}">${t}</p>`,
      lead: (t) => card(P(esc(t), 13.5, 700, ink, "line-height:1.8"), 0),
      para: (t) => P(esc(t), 13.5, 400, "#374151", "line-height:1.85"),
      voice: (t, slot) => card(voice(t, slot, tok), 1),
      question: (q) => `<div style="padding:16px 20px;border-radius:999px;background:${ink};text-align:center">${P(esc(q), 16, 800, "#fff")}</div>`,
      concepts: (cs) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${cs.map((x, i) => card(`${P(esc(x.term), 13.5, 900, cols[i % 4])}${P(esc(x.explain), 12.5, 400, "#374151", "margin-top:4px")}`, i)).join("")}</div>`,
      steps: (st) => `<div style="display:grid;grid-template-columns:repeat(${Math.min(4, st.length || 1)},1fr);gap:10px">${st.map((x, i) => `<div style="text-align:center"><span style="display:inline-flex;width:40px;height:40px;border-radius:50%;background:${cols[i % 4]};color:#fff;font-size:16px;font-weight:900;align-items:center;justify-content:center">${i + 1}</span>${P(esc(x.title), 13, 800, ink, "margin-top:6px")}${P(esc(x.detail), 11.5, 400, "#374151")}</div>`).join("")}</div>`,
      photo: (src, l, n) => photo(src, "100%", 210, l, n, "#6366F1", "#C7D2FE", "#fff", 12),
      chart: (c2) => card(`<div style="display:flex;justify-content:center">${bars(c2.series, 420, 180, "#C7D2FE", "#6366F1", ink, "#6B7280")}</div>`, 2),
      table: (c2) => card(table(c2.data, ink, "#C7D2FE", "#EEF2FF", 11, 4), 2),
      mine: (t) => `<div style="padding:18px;border-radius:16px;background:${ink}">${P("내 생각", 12, 800, "#FBBF24")}${t && String(t).trim() ? P(esc(t), 15, 800, "#fff", "margin-top:4px") : voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, { accent: "#FBBF24", body: "#fff", soft: "rgba(255,255,255,.08)" })}</div>`,
      pair: (a, b) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${card(P("<b>한계</b> " + esc(a), 12.5, 400, "#374151"), 3)}${card(P("<b>다음 질문</b> " + esc(b), 12.5, 400, "#374151"), 0)}</div>`,
      refs: (rs) => (rs.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${rs.map((x, i) => `<span style="padding:5px 10px;border-radius:999px;background:#fff;border:1.5px solid ${cols[i % 4]};font-size:11px;color:${ink}">${esc(String(x.title).slice(0, 40))}</span>`).join("")}</div>` : ""),
    };
  },

  /* 책 표지 — 책등 띠, CHAPTER 제목, 첫 글자 크게 */
  lit5: (c) => {
    const sp = "#7C2D12", or = "#EA580C", cream = "#FFF7ED";
    const tok = { accent: or, body: "#44403C", soft: cream };
    return {
      bg: "#FFFFFF",
      frame: (n, label, parts) => `<div style="position:absolute;top:0;bottom:0;left:0;width:44px;background:${sp};display:flex;align-items:flex-start;justify-content:center;padding-top:50px"><span style="font-family:'Black Han Sans',sans-serif;font-size:22px;color:#FED7AA">${n}</span></div>
<div style="position:absolute;inset:0;margin-left:44px;padding:46px 50px 36px 46px;display:flex;flex-direction:column;gap:14px">
${P("CHAPTER " + n, 12, 800, or, "letter-spacing:.2em")}<p style="margin:0;font-family:'Black Han Sans',sans-serif;font-size:34px;line-height:1.15;color:${sp}">${label}</p><div style="height:2px;width:70px;background:${or}"></div>
${parts.join("")}<p style="margin:auto 0 0;text-align:right;font-size:11px;color:#A8A29E">${esc(c.title)}</p></div>`,
      h: (t) => `<p style="margin:6px 0 0;font-family:'Black Han Sans',sans-serif;font-size:18px;color:${sp}">${t}</p>`,
      lead: (t) => {
        const s = String(t);
        return s ? `<p style="margin:0;font-size:14px;line-height:1.85;color:#44403C"><span style="float:left;font-family:'Black Han Sans',sans-serif;font-size:46px;line-height:.9;color:${or};margin:4px 8px 0 0">${esc(s[0])}</span>${esc(s.slice(1))}</p>` : "";
      },
      para: (t) => P(esc(t), 13.5, 400, "#44403C", "line-height:1.85"),
      voice: (t, slot) => voice(t, slot, tok),
      question: (q) => `<div style="padding:16px 20px;background:${cream};border-left:6px solid ${or}">${P(esc(q), 17, 800, sp)}</div>`,
      concepts: (cs) => cs.map((x) => `<div style="padding:10px 0;border-bottom:1px solid #FDBA74">${P(esc(x.term), 14, 800, sp)}${P(esc(x.explain), 13, 400, "#44403C")}</div>`).join(""),
      steps: (st) => st.map((x, i) => `<div style="display:flex;gap:14px;align-items:baseline"><span style="font-family:'Black Han Sans',sans-serif;font-size:28px;color:${or}">${i + 1}</span><div>${P(esc(x.title), 14, 800, sp)}${P(esc(x.detail), 13, 400, "#44403C")}</div></div>`).join(""),
      photo: (src, l, n) => photo(src, "100%", 220, l, n, "#9A3412", "#FDBA74", cream, 2),
      chart: (c2) => `<div style="display:flex;justify-content:center;padding:10px;background:${cream}">${bars(c2.series, 420, 180, "#FDBA74", sp, "#1C1917", "#78716C")}</div>`,
      table: (c2) => table(c2.data, sp, "#FDBA74", cream, 11.5, 4),
      mine: (t) => `<div style="padding:18px 20px;background:${sp}">${P("책장을 덮고 든 생각", 12, 800, "#FED7AA")}${t && String(t).trim() ? P(esc(t), 15, 800, "#fff", "margin-top:4px;line-height:1.6") : voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, { accent: "#FED7AA", body: "#fff", soft: "rgba(255,255,255,.08)" })}</div>`,
      pair: (a, b) => P("<b>한계</b> " + esc(a) + "<br><b>다음 질문</b> " + esc(b), 12.5, 400, "#57534E", "padding:12px 14px;background:" + cream),
      refs: (rs) => (rs.length ? `<div style="border-top:2px solid ${sp};padding-top:8px">${P("참고 도서·자료", 12, 800, sp)}${rs.map((x, i) => P(`${i + 1}. ${esc(x.title)}${x.publisher ? ", " + esc(x.publisher) : ""}`, 11.5, 400, "#44403C")).join("")}</div>` : ""),
    };
  },
};

/* ── 실험·관찰용 부품 ── */
// 측정 기록표 (조건 × 회차 + 평균)
function recordTable(d, ink, line, headBg, fs = 12, fg = "#1F2640", font = "") {
  if (d?.kind !== "table" || !d.rows?.length) return table(d, ink, line, headBg, fs, 4);
  const cols = [...d.cols, "평균"];
  const avg = (i) => {
    const v = d.cells[i].filter((x) => String(x).trim() !== "").map(Number).filter(Number.isFinite);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : "";
  };
  const th = [d.unit ? `단위 ${esc(d.unit)}` : "", ...cols].map((h) => `<th style="padding:6px 8px;border:1px solid ${line};background:${headBg};font-size:${fs}px;color:${ink}">${esc(h)}</th>`).join("");
  const tr = d.rows.map((r, i) => `<tr><td style="padding:6px 8px;border:1px solid ${line};font-size:${fs}px;font-weight:700;color:${ink}">${esc(r)}</td>${d.cells[i].map((x) => `<td style="padding:6px 8px;border:1px solid ${line};font-size:${fs}px;text-align:center;color:${fg}">${esc(x)}</td>`).join("")}<td style="padding:6px 8px;border:1px solid ${line};font-size:${fs}px;text-align:center;font-weight:800;color:${ink}">${avg(i)}</td></tr>`).join("");
  return `<table style="width:100%;border-collapse:collapse;background:#fff;${font}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}
// 비커 모양 그래프
function beakers(series, w, color, ink, unit = "") {
  const vals = series.map((x) => x.value).filter((v) => v != null);
  if (!vals.length) return "";
  const n = series.length, max = Math.max(...vals) * 1.1, gap = w / n, bw = Math.min(110, gap * 0.62);
  let s = "";
  series.forEach((d, i) => {
    const x = i * gap + (gap - bw) / 2, fill = d.value == null ? 0 : Math.round((d.value / max) * 160);
    s += `<path d="M${x} 16 L${x} 196 Q${x} 214 ${x + 16} 214 L${x + bw - 16} 214 Q${x + bw} 214 ${x + bw} 196 L${x + bw} 16" fill="none" stroke="${ink}" stroke-width="3"></path>`;
    s += `<rect x="${x + 3}" y="${212 - fill}" width="${bw - 6}" height="${fill}" rx="6" fill="${color}" opacity="${0.55 + 0.45 * (i === n - 1 ? 1 : 0.5)}"></rect>`;
    if (d.value != null) s += `<text x="${x + bw / 2}" y="${204 - fill}" text-anchor="middle" font-size="15" font-weight="900" fill="${ink}">${d.value}${esc(unit)}</text>`;
    s += `<text x="${x + bw / 2}" y="238" text-anchor="middle" font-size="13" font-weight="700" fill="${ink}">${esc(String(d.label).slice(0, 8))}</text>`;
  });
  return `<svg viewBox="0 0 ${w} 248" width="100%" style="max-width:${w}px">${s}</svg>`;
}
// 변인 3칸
function varsBox(v, ink, soft, accent) {
  if (!v) return "";
  const cell = (l, t, bg) => `<div style="padding:10px 12px;border-radius:8px;background:${bg}">${P(l, 11.5, 700, accent)}${P(esc(t), 13, 800, ink, "margin-top:2px")}</div>`;
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${cell("바꾸는 것", v.change ?? "", soft)}${cell("재는 것", v.measure ?? "", soft)}${cell("같게 둘 것", (v.control ?? []).join(", "), soft)}</div>`;
}

/* 속지 기본 부품 — 디자인마다 필요한 것만 바꿔 쓴다 */
function baseKit(c, o) {
  const tok = { accent: o.accent, body: o.body, soft: o.soft };
  const k = {
    bg: o.bg,
    frame: (n, label, parts) => `<div style="position:absolute;inset:0;padding:48px 56px 36px;display:flex;flex-direction:column;gap:14px;background:${o.bg}">
${P(esc(label), 20, 900, o.ink)}${parts.join("")}<p style="margin:auto 0 0;text-align:right;font-size:11px;color:${o.body};opacity:.6">${n} / 4</p></div>`,
    h: (t) => P(t, 15.5, 900, o.ink, "margin-top:4px"),
    lead: (t) => P(esc(t), 14, 700, o.ink, "line-height:1.8"),
    para: (t) => P(esc(t), 13.5, 400, o.body, "line-height:1.85"),
    voice: (t, slot) => voice(t, slot, tok),
    question: (q) => `<div style="padding:14px 18px;border-left:5px solid ${o.accent};background:${o.soft}">${P("출발 질문", 11.5, 800, o.accent)}${P(esc(q), 16.5, 800, o.ink, "margin-top:3px")}</div>`,
    concepts: (cs) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${cs.map((x) => `<div style="padding:12px 14px;border-radius:8px;background:${o.soft}">${P(esc(x.term), 13.5, 800, o.ink)}${P(esc(x.explain), 12.5, 400, o.body, "margin-top:3px")}</div>`).join("")}</div>`,
    steps: (st) => st.map((x, i) => `<div style="display:flex;gap:12px"><span style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${o.ink};color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</span><div>${P(esc(x.title), 14, 800, o.ink)}${P(esc(x.detail), 12.5, 400, o.body)}</div></div>`).join(""),
    photo: (src, l, n) => photo(src, "100%", 210, l, n, o.accent, o.line, o.soft, 8),
    chart: (c2) => `<div style="display:flex;justify-content:center">${bars(c2.series, 420, 180, o.line, o.accent, o.ink, o.body, c2.unit)}</div>`,
    table: (c2) => recordTable(c2.data, o.ink, o.line, o.soft, 11.5, o.body),
    mine: (t) => `<div style="padding:14px 16px;border-radius:8px;border:2px solid ${o.accent}">${P("내 생각", 12, 800, o.accent)}${voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, tok, 14)}</div>`,
    pair: (a, b) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(a), 12.5, 400, o.body, `padding:12px;background:${o.soft};border-radius:8px`)}${P("<b>다음 질문</b> " + esc(b), 12.5, 400, o.body, `padding:12px;border:1.5px solid ${o.ink};border-radius:8px`)}</div>`,
    refs: (rs) => (rs.length ? `<div style="border-top:1px solid ${o.line};padding-top:8px">${P("참고 자료", 12, 800, o.ink)}${rs.map((x, i) => P(`${i + 1}. ${esc(x.title)}`, 11.5, 400, o.body)).join("")}</div>` : ""),
  };
  return k;
}

/* 실험 속지: 2장 개념 뒤에 가설·변인, 3장 방법 뒤에 기록표 */
function buildExpPages(c, kit) {
  const r = c.r;
  const vis = c.series.some((x) => x.value != null) ? kit.chart(c) : "";
  return [
    kit.frame(2, "탐구 동기와 가설", [
      kit.h("탐구 계기"), kit.voice(r.motive?.text, r.motive),
      kit.question(c.q),
      c.hypo ? kit.hypo(c.hypo) : "",
      kit.h("알아야 할 개념"), kit.concepts(r.concepts ?? []),
    ]),
    kit.frame(3, "실험 방법", [
      kit.vars(c.vars),
      kit.steps(r.method?.steps ?? []),
      kit.photo(c.photos.p3, "실험 사진 넣는 곳", c.photoNote, 1),
      kit.h("어려웠던 점과 해결"), kit.voice(r.difficulty?.text, r.difficulty),
    ]),
    kit.frame(4, "결과와 결론", [
      kit.h("측정 결과"), kit.table(c), vis,
      kit.para(r.results?.text ?? ""),
      kit.h("해석"), kit.para(r.interpretation ?? ""),
      kit.mine(r.mine),
      kit.pair(r.limits ?? "", r.next ?? ""),
      kit.h("진로와의 연결"), kit.voice(r.career?.text, r.career),
    ]),
  ];
}

/* ── 실험 탐구 5종 ── */
const SANS = "'Noto Sans KR',sans-serif";
Object.assign(PAGE1, {
  exp1: (c) => { // 모눈 실험노트
    const ink = "#1E293B", red = "#DC2626", blue = "#2563EB";
    return { bg: "#FFFFFF", html: `
<div style="position:absolute;inset:0;background-image:linear-gradient(#DBEAFE 1px,transparent 1px),linear-gradient(90deg,#DBEAFE 1px,transparent 1px);background-size:20px 20px"></div>
<div style="position:relative;padding:40px 48px;display:flex;flex-direction:column;gap:12px;font-family:'Gaegu',sans-serif;color:${ink}">
<div style="display:flex;justify-content:space-between"><p style="margin:0;font-size:20px;font-weight:700;color:${blue}">실험 노트</p>${P(esc(c.subj + " · " + c.who), 12, 400, "#475569", "font-family:" + SANS)}</div>
<p style="margin:0;font-size:26px;line-height:1.3;font-weight:700">${esc(c.title)}</p>
${c.hypo ? `<p style="margin:0;font-size:18px"><b style="color:${blue}">가설:</b> ${esc(c.hypo)}</p>` : ""}
<p style="margin:4px 0 0;font-size:42px;line-height:1.15;font-weight:700">${esc(c.m1)}<br><span style="color:${red};background:linear-gradient(transparent 60%,#FEF08A 60%)">${esc(c.m2)}</span></p>
<div style="display:flex;gap:14px;align-items:flex-start;font-family:${SANS}"><div style="flex:1.2">${recordTable(c.data, ink, "#94A3B8", "#EFF6FF", 12)}</div><div style="flex:1;padding:8px;background:#fff;border:1px solid #94A3B8">${bars(c.series, 260, 170, "#93C5FD", red, ink, "#475569", c.unit)}</div></div>
${P(esc(c.finding), 13, 700, ink, "font-family:" + SANS)}
<div style="display:flex;gap:14px;font-family:${SANS}">${photo(c.photos.p1, "44%", 160, "실험 사진 넣는 곳", c.photoNote, blue, "#60A5FA", "rgba(255,255,255,.85)", 4)}<div style="flex:1">${P("실험 후 생각", 14, 900, ink)}${P(esc(c.think), 12.5, 400, "#334155", "line-height:1.7;margin-top:4px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-family:${SANS}">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#334155", "padding:10px;background:#fff;border:1px dashed #94A3B8")}${P("<b>다음 실험</b> " + esc(c.nxt), 12, 400, ink, "padding:10px;background:#FEF08A")}</div>
</div>` };
  },
  exp2: (c) => { // 학회 포스터
    const red = "#7F1D1D";
    const col = (h, body) => `<div style="display:flex;flex-direction:column;gap:8px"><p style="margin:0;padding:6px 10px;background:${red};color:#fff;font-size:13px;font-weight:900">${h}</p>${body}</div>`;
    return { bg: "#FFFFFF", html: `
<div style="padding:26px 34px;background:${red};color:#fff"><p style="margin:0;font-size:12px;letter-spacing:.1em;color:#FECACA">${esc(c.name)} · ${esc(c.subj)} · ${esc(c.who)}</p><p style="margin:8px 0 0;font-size:22px;line-height:1.35;font-weight:900">${esc(c.title)}</p></div>
<div style="padding:20px 34px;background:#FEF2F2;border-bottom:3px solid ${red}"><p style="margin:0;text-align:center;font-size:32px;line-height:1.25;font-weight:900;color:${red}">“${esc(c.m1)} ${esc(c.m2)}”</p></div>
<div style="padding:18px 34px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
${col("1. 도입", P(esc(c.q), 12.5, 700, "#1F2937") + (c.hypo ? P("가설: " + esc(c.hypo), 12, 400, "#374151", "line-height:1.7") : ""))}
${col("2. 방법", c.steps.map((x, i) => P(`${i + 1}) ${esc(x[0])} — ${esc(x[1])}`, 11.5, 400, "#374151", "line-height:1.55")).join("") + photo(c.photos.p1, "100%", 150, "실험 사진", c.photoNote))}
${col("3. 결과", bars(c.series, 200, 170, "#FCA5A5", red, "#1F2937", "#6B7280", c.unit) + P(esc(c.finding), 12, 700, "#1F2937"))}
</div>
<div style="margin:0 34px;display:grid;grid-template-columns:1.3fr 1fr;gap:16px">
${col("4. 결론 및 고찰", P(esc(c.think), 12.5, 400, "#374151", "line-height:1.7"))}
${col("5. 후속 연구", P(esc(c.nxt), 12.5, 400, "#374151") + P("한계: " + esc(c.limit), 11.5, 400, "#6B7280"))}</div>` };
  },
  exp3: (c) => { // 비커 그래프
    const cy = "#0E7490", dk = "#0C4A6E";
    return { bg: "#FFFFFF", html: `
<div style="padding:44px 50px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between">${P(esc(c.name) + " · " + esc(c.subj), 12, 900, cy)}${P(esc(c.who), 12, 400, "#64748B")}</div>
${P(esc(c.title), 21, 900, dk, "line-height:1.45")}
<p style="margin:0;font-size:38px;line-height:1.15;font-weight:900;color:${dk}">${esc(c.m1)} <span style="color:#EA580C">${esc(c.m2)}</span></p>
<div style="padding:16px;border-radius:18px;background:#ECFEFF;text-align:center">${beakers(c.series, 600, "#FB923C", dk, c.unit)}${P("비커 높이 = 측정값 평균", 12, 400, cy)}</div>
${P(esc(c.finding), 13.5, 700, dk)}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "46%", 170, "실험 사진 넣는 곳", c.photoNote, cy, "#67E8F9", "#F0FDFF", 14)}<div style="flex:1">${P("비커를 보며 알게 된 것", 14, 900, dk)}${P(esc(c.think), 12.5, 400, "#155E75", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#155E75", "padding:10px;background:#ECFEFF;border-radius:10px")}${P("<b>다음 실험</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:" + cy + ";border-radius:10px")}</div>
</div>` };
  },
  exp4: (c) => { // 다크 랩
    const mono = "font-family:'Courier New',monospace", lime = "#A3E635";
    const log = c.series.map((x) => `<p style="margin:0;${mono};font-size:13px;color:${lime}">&gt; ${esc(x.label)} : avg = ${x.value ?? "-"} ${esc(c.unit)}</p>`).join("");
    return { bg: "#0B0F19", html: `
<div style="padding:42px 46px;display:flex;flex-direction:column;gap:14px;color:#E5E7EB">
<div style="display:flex;justify-content:space-between;${mono};font-size:12px"><span style="color:${lime}">LAB_REPORT://${esc(c.name)}</span><span style="color:#9CA3AF">${esc(c.subj)} · ${esc(c.who)}</span></div>
${P(esc(c.title), 20, 700, "#F9FAFB", "line-height:1.45")}
<p style="margin:6px 0 0;font-size:40px;line-height:1.15;font-weight:900;color:#fff">${esc(c.m1)}<br><span style="color:${lime}">${esc(c.m2)}</span></p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
<div style="padding:16px;border-radius:10px;background:#111827;border:1px solid #374151;display:flex;flex-direction:column;gap:6px">${log}<p style="margin:6px 0 0;${mono};font-size:13px;color:#9CA3AF">&gt; status: OK</p></div>
<div style="padding:12px;border-radius:10px;background:#111827;border:1px solid #374151">${bars(c.series, 270, 170, "#374151", lime, "#F9FAFB", "#9CA3AF", c.unit)}</div></div>
${P(esc(c.finding), 13.5, 400, "#D1D5DB")}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "46%", 170, "실험 사진 넣는 곳", c.photoNote, "#9CA3AF", "#4B5563", "#111827")}<div style="flex:1">${P("// 해석", 14, 900, lime, mono)}${P(esc(c.think), 12.5, 400, "#D1D5DB", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#D1D5DB", "padding:10px;border:1px solid #374151;border-radius:8px")}${P("<b>NEXT</b> " + esc(c.nxt), 12, 400, "#0B0F19", "padding:10px;background:" + lime + ";border-radius:8px")}</div>
</div>` };
  },
  exp5: (c) => { // 플로우차트
    const pu = "#6D28D9", dk = "#1F1147";
    const v = c.vars ?? {};
    const boxes = [["가설", c.hypo || c.q], ["변인", `바꾸는 것: ${v.change ?? "-"} / 같게: ${(v.control ?? []).join(", ") || "-"}`], ["실험", c.steps.map((x) => x[0]).join(" → ")], ["결과", c.finding]];
    const flow = boxes.map(([h, b], i) => `<div style="padding:11px 14px;border-radius:12px;background:${i === 3 ? pu : "#F5F3FF"};border:2px solid ${pu};display:flex;gap:12px;align-items:center"><span style="width:52px;flex-shrink:0;font-size:14px;font-weight:900;color:${i === 3 ? "#fff" : pu}">${h}</span><span style="font-size:12.5px;line-height:1.5;color:${i === 3 ? "#fff" : dk}">${esc(b)}</span></div>${i < 3 ? `<p style="margin:0;text-align:center;font-size:16px;line-height:1;color:${pu}">▼</p>` : ""}`).join("");
    return { bg: "#FFFFFF", html: `
<div style="padding:42px 48px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between">${P(esc(c.name) + " · " + esc(c.subj), 12, 900, pu)}${P(esc(c.who), 12, 400, "#6B7280")}</div>
${P(esc(c.title), 20, 900, dk, "line-height:1.45")}
<div style="display:grid;grid-template-columns:1.15fr 1fr;gap:18px;align-items:start">
<div style="display:flex;flex-direction:column;gap:4px">${flow}</div>
<div style="display:flex;flex-direction:column;gap:10px"><div style="padding:20px;border-radius:16px;background:${dk}"><p style="margin:0;font-size:28px;line-height:1.2;font-weight:900;color:#fff">${esc(c.m1)}<br><span style="color:#C4B5FD">${esc(c.m2)}</span></p></div>${bars(c.series, 270, 170, "#DDD6FE", pu, dk, "#6B7280", c.unit)}</div></div>
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 170, "실험 사진 넣는 곳", c.photoNote, pu, "#C4B5FD", "#FAF8FF")}<div style="flex:1">${P("예상과 달랐던 점", 14, 900, dk)}${P(esc(c.think), 12.5, 400, "#3B0764", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#3B0764", "padding:10px;background:#F5F3FF;border-radius:8px")}${P("<b>다음 실험</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:" + pu + ";border-radius:8px")}</div>
</div>` };
  },
});

Object.assign(KITS, {
  exp1: (c) => {
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#1E293B", accent: "#DC2626", body: "#334155", soft: "#EFF6FF", line: "#93C5FD" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;background-image:linear-gradient(#DBEAFE 1px,transparent 1px),linear-gradient(90deg,#DBEAFE 1px,transparent 1px);background-size:20px 20px"></div>
<div style="position:absolute;inset:0;padding:44px 52px 34px;display:flex;flex-direction:column;gap:13px">
<p style="margin:0;font-family:'Gaegu',sans-serif;font-size:28px;font-weight:700;color:#1E293B">${label} <span style="font-size:16px;color:#2563EB">p.${n}</span></p>${parts.join("")}</div>`;
    k.h = (t) => `<p style="margin:4px 0 0;font-family:'Gaegu',sans-serif;font-size:21px;font-weight:700;color:#1E293B"><span style="background:linear-gradient(transparent 60%,#FEF08A 60%)">${t}</span></p>`;
    k.hypo = (t) => `<p style="margin:0;font-family:'Gaegu',sans-serif;font-size:19px"><b style="color:#2563EB">가설:</b> ${esc(t)}</p>`;
    k.vars = (v) => varsBox(v, "#1E293B", "rgba(255,255,255,.9)", "#2563EB");
    k.table = (c2) => `<div style="position:relative;padding:14px 12px 10px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.08)"><div style="position:absolute;top:-9px;left:40%;width:70px;height:18px;background:rgba(254,240,138,.85);transform:rotate(-3deg)"></div>${recordTable(c2.data, "#1E293B", "#94A3B8", "#EFF6FF", 12)}</div>`;
    return k;
  },
  exp2: (c) => {
    const red = "#7F1D1D";
    const k = baseKit(c, { bg: "#FFFFFF", ink: red, accent: red, body: "#374151", soft: "#FEF2F2", line: "#FCA5A5" });
    let sec = 0;
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;display:flex;flex-direction:column">
<div style="padding:18px 34px;background:${red};color:#fff;display:flex;justify-content:space-between;align-items:center"><p style="margin:0;font-size:18px;font-weight:900">${label}</p>${P(esc(c.title), 11, 400, "#FECACA", "max-width:60%;text-align:right")}</div>
<div style="padding:22px 34px;display:flex;flex-direction:column;gap:12px">${parts.join("")}</div></div>`;
    k.h = (t) => `<p style="margin:4px 0 0;padding:5px 10px;background:${red};color:#fff;font-size:13px;font-weight:900;align-self:flex-start">${++sec}. ${t}</p>`;
    k.hypo = (t) => P("<b>가설</b> " + esc(t), 13.5, 400, "#1F2937", "padding:10px 12px;border:1.5px solid " + red);
    k.vars = (v) => varsBox(v, "#1F2937", "#FEF2F2", red);
    return k;
  },
  exp3: (c) => {
    const cy = "#0E7490", dk = "#0C4A6E";
    const k = baseKit(c, { bg: "#FFFFFF", ink: dk, accent: cy, body: "#155E75", soft: "#ECFEFF", line: "#67E8F9" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:44px 50px 34px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;align-items:center;gap:10px"><span style="width:34px;height:34px;border-radius:50%;background:${cy};color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center">${n}</span>${P(label, 21, 900, dk)}</div>${parts.join("")}</div>`;
    k.hypo = (t) => `<div style="padding:14px 16px;border-radius:14px;background:#ECFEFF">${P("가설", 12, 800, cy)}${P(esc(t), 14.5, 800, dk)}</div>`;
    k.vars = (v) => varsBox(v, dk, "#ECFEFF", cy);
    k.chart = (c2) => `<div style="padding:12px;border-radius:18px;background:#ECFEFF;text-align:center">${beakers(c2.series, 560, "#FB923C", dk, c2.unit)}</div>`;
    return k;
  },
  exp4: (c) => {
    const lime = "#A3E635", mono = "font-family:'Courier New',monospace";
    const k = baseKit(c, { bg: "#0B0F19", ink: "#F9FAFB", accent: lime, body: "#D1D5DB", soft: "#111827", line: "#374151" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:42px 46px 34px;display:flex;flex-direction:column;gap:13px;background:#0B0F19">
<p style="margin:0;${mono};font-size:12px;color:${lime}">LAB_REPORT://page_${n}</p>${P(label, 22, 900, "#fff")}${parts.join("")}</div>`;
    k.h = (t) => P("// " + t, 14.5, 900, lime, mono + ";margin-top:4px");
    k.hypo = (t) => `<p style="margin:0;${mono};font-size:13.5px;color:${lime}">&gt; hypothesis: <span style="color:#E5E7EB">${esc(t)}</span></p>`;
    k.vars = (v) => varsBox(v, "#F9FAFB", "#111827", lime);
    k.question = (q) => `<div style="padding:14px 16px;border:1px solid #374151;border-radius:10px">${P("QUESTION", 11, 800, lime, mono)}${P(esc(q), 16, 800, "#fff", "margin-top:3px")}</div>`;
    k.table = (c2) => `<div style="border-radius:10px;overflow:hidden">${recordTable(c2.data, "#0B0F19", "#374151", "#A3E635", 12)}</div>`;
    k.chart = (c2) => `<div style="display:flex;justify-content:center;padding:10px;border:1px solid #374151;border-radius:10px">${bars(c2.series, 420, 180, "#374151", lime, "#F9FAFB", "#9CA3AF", c2.unit)}</div>`;
    return k;
  },
  exp5: (c) => {
    const pu = "#6D28D9", dk = "#1F1147";
    const k = baseKit(c, { bg: "#FFFFFF", ink: dk, accent: pu, body: "#3B0764", soft: "#F5F3FF", line: "#C4B5FD" });
    k.hypo = (t) => `<div style="padding:12px 16px;border-radius:12px;border:2px solid ${pu};background:#F5F3FF">${P("가설", 12, 900, pu)}${P(esc(t), 14, 800, dk)}</div>`;
    k.vars = (v) => varsBox(v, dk, "#F5F3FF", pu);
    k.steps = (st) => st.map((x, i) => `<div style="padding:10px 14px;border-radius:12px;border:2px solid ${pu};background:${i === st.length - 1 ? pu : "#F5F3FF"}">${P(esc(x.title), 13.5, 900, i === st.length - 1 ? "#fff" : dk)}${P(esc(x.detail), 12, 400, i === st.length - 1 ? "#EDE9FE" : "#3B0764")}</div>${i < st.length - 1 ? `<p style="margin:0;text-align:center;font-size:15px;line-height:1;color:${pu}">▼</p>` : ""}`).join("");
    return k;
  },
});

/* ── 관찰 탐구 5종 ── */
// 값 → 색 단계 (행·칸 값의 최소~최대를 5단계로)
function levelColor(v, min, max, pal) {
  if (v == null || !Number.isFinite(v)) return "#F3F4F6";
  const k = max > min ? Math.min(4, Math.floor(((v - min) / (max - min)) * 5)) : 2;
  return pal[k];
}
function heatGrid(d, pal, ink) {
  if (d?.kind !== "table" || !d.rows?.length) return "";
  const nums = d.cells.flat().map(Number).filter(Number.isFinite);
  const min = Math.min(...nums), max = Math.max(...nums);
  const head = `<div></div>` + d.cols.map((c) => `<p style="margin:0;text-align:center;font-size:12px;font-weight:700;color:${ink}">${esc(String(c).slice(0, 6))}</p>`).join("");
  const body = d.rows.map((r, i) => `<p style="margin:0;font-size:12px;font-weight:700;color:${ink};align-self:center">${esc(String(r).slice(0, 8))}</p>` + d.cells[i].map((x) => {
    const v = String(x).trim() === "" ? null : Number(x);
    const bg = levelColor(v, min, max, pal);
    return `<div style="height:44px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:${bg === pal[4] || bg === pal[3] ? "#fff" : ink}">${v ?? ""}</div>`;
  }).join("")).join("");
  return `<div style="display:grid;grid-template-columns:70px repeat(${d.cols.length},1fr);gap:6px">${head}${body}</div>`;
}
function buildObsPages(c, kit) {
  const r = c.r;
  const vis = c.series.some((x) => x.value != null) ? kit.chart(c) : "";
  return [
    kit.frame(2, "관찰 동기와 배경", [
      kit.h("관찰 계기"), kit.voice(r.motive?.text, r.motive),
      kit.question(c.q),
      kit.h("알아야 할 개념"), kit.concepts(r.concepts ?? []),
    ]),
    kit.frame(3, "관찰 방법", [
      kit.levels(c.levels),
      kit.steps(r.method?.steps ?? []),
      kit.photo(c.photos.p3, "관찰 사진 넣는 곳", c.photoNote, 1),
      kit.h("어려웠던 점과 해결"), kit.voice(r.difficulty?.text, r.difficulty),
    ]),
    kit.frame(4, "관찰 결과와 결론", [
      kit.h("관찰 기록"), kit.table(c), vis,
      kit.para(r.results?.text ?? ""),
      kit.h("해석"), kit.para(r.interpretation ?? ""),
      kit.mine(r.mine),
      kit.pair(r.limits ?? "", r.next ?? ""),
      kit.h("진로와의 연결"), kit.voice(r.career?.text, r.career),
    ]),
  ];
}
function levelsBox(lv, ink, soft, accent) {
  if (!lv?.length) return "";
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${lv.map((x) => `<div style="padding:9px 12px;border-radius:8px;background:${soft}">${P(esc(x.level ?? x), 12.5, 800, accent)}${x.desc ? P(esc(x.desc), 12, 400, ink) : ""}</div>`).join("")}</div>`;
}

Object.assign(PAGE1, {
  obs1: (c) => { // 관찰 달력
    const g = "#15803D", dk = "#14532D", pal = ["#DCFCE7", "#BBF7D0", "#FDE68A", "#FDBA74", "#F87171"];
    const vals = c.series.map((x) => x.value).filter((v) => v != null), min = Math.min(...vals), max = Math.max(...vals);
    const cells = c.series.map((x) => `<div style="padding:10px;border-radius:10px;background:${levelColor(x.value, min, max, pal)}"><p style="margin:0;font-size:12px;font-weight:700;color:#374151">${esc(String(x.label).slice(0, 8))}</p><p style="margin:0;font-size:24px;font-weight:900;color:#111827">${x.value ?? "-"}</p></div>`).join("");
    return { bg: "#FFFFFF", html: `
<div style="padding:42px 48px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between">${P(esc(c.name) + " · " + esc(c.subj), 12, 900, g)}${P(esc(c.who), 12, 400, "#6B7280")}</div>
${P(esc(c.title), 21, 900, dk, "line-height:1.45")}
<p style="margin:0;font-size:36px;line-height:1.2;font-weight:900;color:${dk}">${esc(c.m1)}<br><span style="color:#DC2626">${esc(c.m2)}</span></p>
<div style="padding:16px;border-radius:16px;background:#F9FAFB;border:1px solid #E5E7EB"><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">${cells}</div>${P("색이 붉을수록 값이 커요 · 날짜(회차)별 평균", 11.5, 400, "#6B7280", "margin-top:8px")}</div>
${P(esc(c.finding), 13.5, 700, dk)}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 160, "관찰 사진 넣는 곳", c.photoNote, g, "#86EFAC", "#F0FDF4", 12)}<div style="flex:1">${P("달력을 채우며 알게 된 것", 14, 900, dk)}${P(esc(c.think), 12.5, 400, "#166534", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#166534", "padding:10px;background:#F0FDF4;border-radius:8px")}${P("<b>다음 관찰</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:" + g + ";border-radius:8px")}</div>
</div>` };
  },
  obs2: (c) => { // 필드노트
    const ink = "#3F2D1C", am = "#B45309";
    const tape = (l, r) => `<div style="position:absolute;top:-10px;left:${l};width:80px;height:20px;background:rgba(255,255,255,.55);transform:rotate(${r}deg)"></div>`;
    return { bg: "#C9A77C", html: `
<div style="padding:40px 46px;display:flex;flex-direction:column;gap:16px;font-family:'Gaegu',sans-serif;color:${ink}">
<div style="display:flex;justify-content:space-between"><p style="margin:0;font-size:24px;font-weight:700">FIELD NOTE · ${esc(c.name)}</p>${P(esc(c.subj + " · " + c.who), 12, 400, "#6B4F32", "font-family:" + SANS)}</div>
<p style="margin:0;font-size:27px;line-height:1.3;font-weight:700">${esc(c.title)}</p>
<div style="position:relative;padding:22px 24px;background:#FFFBF2;transform:rotate(-1deg);box-shadow:0 3px 8px rgba(0,0,0,.15)">${tape("40%", -4)}
<p style="margin:0;font-size:40px;line-height:1.15;font-weight:700">${esc(c.m1)}<br><span style="color:${am}">${esc(c.m2)}</span></p>${P(esc(c.finding), 13, 400, ink, "margin-top:8px;font-family:" + SANS)}</div>
<div style="display:flex;gap:16px">
<div style="position:relative;flex:1;padding:14px;background:#FFFBF2;transform:rotate(1deg);box-shadow:0 3px 8px rgba(0,0,0,.15)">${tape("30%", 3)}${bars(c.series, 280, 170, "#D6B98C", am, ink, "#6B4F32", c.unit)}</div>
<div style="flex:1;transform:rotate(-1.5deg)">${photo(c.photos.p1, "100%", 210, "관찰 사진 넣는 곳", c.photoNote, "#6B4F32", "#8B6B45", "rgba(255,251,242,.85)", 0)}</div></div>
<div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px"><div><p style="margin:0;font-size:22px;font-weight:700">관찰하며 적은 생각</p>${P(esc(c.think), 12.5, 400, ink, "margin-top:6px;line-height:1.75;font-family:" + SANS)}</div>
<div style="padding:14px;background:#FDE68A;transform:rotate(2deg);box-shadow:0 3px 8px rgba(0,0,0,.15)"><p style="margin:0;font-size:19px;font-weight:700">다음에 볼 것</p>${P(esc(c.nxt), 12, 400, ink, "margin-top:4px;font-family:" + SANS)}</div></div>
${P("<b>한계</b> " + esc(c.limit), 11.5, 400, "#6B4F32", "font-family:" + SANS)}
</div>` };
  },
  obs3: (c) => { // 클립보드
    const red = "#DC2626";
    const checks = (c.levels.length ? c.levels : [{ level: "관찰 기준 1" }, { level: "관찰 기준 2" }, { level: "관찰 기준 3" }]).slice(0, 5)
      .map((x, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #E5E7EB"><span style="width:20px;height:20px;border:2px solid #334155;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:${red}">${i === 0 ? "✓" : ""}</span><span style="font-size:13px;color:#1F2937">${esc(x.level ?? x)}${x.desc ? ` — <span style="color:#6B7280">${esc(x.desc)}</span>` : ""}</span></div>`).join("");
    return { bg: "#E5E7EB", html: `
<div style="position:absolute;top:18px;left:50%;width:160px;height:46px;margin-left:-80px;border-radius:12px;background:#9CA3AF;box-shadow:inset 0 -4px 0 #6B7280"></div>
<div style="position:absolute;top:40px;left:36px;right:36px;bottom:30px;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)"></div>
<div style="position:relative;padding:84px 70px 0;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between">${P("관찰 기록지 · " + esc(c.name), 12, 900, red)}${P(esc(c.subj + " · " + c.who), 12, 400, "#6B7280")}</div>
${P(esc(c.title), 20, 900, "#111827", "line-height:1.45")}
<p style="margin:0;font-size:34px;line-height:1.2;font-weight:900;color:#111827">${esc(c.m1)}<br><span style="color:${red}">${esc(c.m2)}</span></p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px"><div>${P("관찰 기준", 13, 900, "#334155")}${checks}</div><div>${bars(c.series, 270, 180, "#CBD5E1", red, "#111827", "#6B7280", c.unit)}</div></div>
${P(esc(c.finding), 13.5, 700, "#111827", "padding:12px 14px;background:#FEF2F2;border-radius:10px")}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 150, "관찰 사진 넣는 곳", c.photoNote)}<div style="flex:1">${P("관찰 소감", 14, 900, "#111827")}${P(esc(c.think), 12.5, 400, "#374151", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#374151", "padding:10px;background:#F3F4F6;border-radius:8px")}${P("<b>다음 관찰</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:#334155;border-radius:8px")}</div>
</div>` };
  },
  obs4: (c) => { // 히트맵
    const or = "#C2410C", dk = "#431407", pal = ["#FFF7ED", "#FED7AA", "#FB923C", "#EA580C", "#9A3412"];
    return { bg: "#FFFFFF", html: `
<div style="padding:46px 52px;display:flex;flex-direction:column;gap:16px">
${P(esc(c.name) + " · " + esc(c.subj) + " · " + esc(c.who), 12, 700, or)}
${P(esc(c.title), 21, 900, dk, "line-height:1.45")}
<p style="margin:0;font-size:38px;line-height:1.15;font-weight:900;color:${dk}">${esc(c.m1)} <span style="color:#EA580C">${esc(c.m2)}</span></p>
<div style="padding:18px;border-radius:16px;background:#FFFBF7;border:1px solid #FED7AA">${heatGrid(c.data, pal, dk) || bars(c.series, 600, 180, "#FDBA74", "#9A3412", dk, "#7C2D12", c.unit)}
<div style="margin-top:10px;display:flex;align-items:center;gap:6px">${P("적음", 11, 400, "#7C2D12")}${pal.map((x) => `<span style="width:28px;height:12px;background:${x}"></span>`).join("")}${P("많음", 11, 400, "#7C2D12")}</div></div>
${P(esc(c.finding), 13.5, 700, dk)}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 170, "관찰 사진 넣는 곳", c.photoNote, or, "#FDBA74", "#FFF7ED")}<div style="flex:1">${P("색을 보며 든 생각", 14, 900, dk)}${P(esc(c.think), 12.5, 400, "#7C2D12", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#7C2D12", "padding:10px;background:#FFF7ED;border-radius:8px")}${P("<b>다음 관찰</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:#9A3412;border-radius:8px")}</div>
</div>` };
  },
  obs5: (c) => { // 사진 에세이
    const red = "#B91C1C", my = "'Nanum Myeongjo',serif";
    return { bg: "#FFFFFF", html: `
<div style="padding:40px 44px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;justify-content:space-between">${P("PHOTO ESSAY · " + esc(c.name), 12, 900, "#111", "letter-spacing:.12em")}${P(esc(c.subj + " · " + c.who), 12, 400, "#555")}</div>
${photo(c.photos.p1, "100%", 290, "대표 사진 넣는 곳", "가장 인상적인 관찰 장면", "#555", "#999", "#F4F4F4", 0)}
<p style="margin:6px 0 0;font-family:${my};font-size:38px;line-height:1.2;font-weight:800;color:#111">${esc(c.m1)}<br><i style="color:${red}">${esc(c.m2)}</i></p>
${P(esc(c.title), 15, 700, "#333", "line-height:1.5")}
<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">${photo(c.photos.p1b, "100%", 130, "사진 2", "", "#666", "#AAA", "#F7F7F7", 0)}${photo(c.photos.p1c, "100%", 130, "사진 3", "", "#666", "#AAA", "#F7F7F7", 0)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<p style="margin:0;font-family:${my};font-size:13.5px;line-height:1.85;color:#222"><b>${esc(c.finding)}</b> ${esc(c.think)}</p>
<div style="display:flex;flex-direction:column;gap:8px">${bars(c.series, 300, 140, "#D4D4D4", red, "#111", "#555", c.unit)}${P("<b>다음 관찰</b> " + esc(c.nxt), 12, 400, "#222", "padding:10px;border:1px solid #111")}${P("<b>한계</b> " + esc(c.limit), 11, 400, "#555")}</div></div>
</div>` };
  },
});

Object.assign(KITS, {
  obs1: (c) => {
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#14532D", accent: "#15803D", body: "#166534", soft: "#F0FDF4", line: "#86EFAC" });
    k.levels = (lv) => levelsBox(lv, "#166534", "#F0FDF4", "#15803D");
    k.table = (c2) => heatGrid(c2.data, ["#DCFCE7", "#BBF7D0", "#FDE68A", "#FDBA74", "#F87171"], "#14532D");
    return k;
  },
  obs2: (c) => {
    const ink = "#3F2D1C";
    const k = baseKit(c, { bg: "#C9A77C", ink, accent: "#B45309", body: ink, soft: "#FFFBF2", line: "#D6B98C" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:40px 46px 30px;background:#C9A77C">
<div style="position:relative;height:100%;box-sizing:border-box;padding:26px 28px;background:#FFFBF2;box-shadow:0 3px 8px rgba(0,0,0,.15);display:flex;flex-direction:column;gap:12px">
<div style="position:absolute;top:-10px;left:42%;width:90px;height:22px;background:rgba(255,255,255,.6);transform:rotate(-3deg)"></div>
<p style="margin:0;font-family:'Gaegu',sans-serif;font-size:28px;font-weight:700;color:${ink}">${label}</p>${parts.join("")}</div></div>`;
    k.h = (t) => `<p style="margin:4px 0 0;font-family:'Gaegu',sans-serif;font-size:21px;font-weight:700;color:${ink}">${t}</p>`;
    k.levels = (lv) => levelsBox(lv, ink, "#F5E9D3", "#B45309");
    return k;
  },
  obs3: (c) => {
    const k = baseKit(c, { bg: "#E5E7EB", ink: "#111827", accent: "#DC2626", body: "#374151", soft: "#F3F4F6", line: "#CBD5E1" });
    k.frame = (n, label, parts) => `<div style="position:absolute;top:18px;left:50%;width:160px;height:46px;margin-left:-80px;border-radius:12px;background:#9CA3AF;box-shadow:inset 0 -4px 0 #6B7280;z-index:1"></div>
<div style="position:absolute;top:40px;left:36px;right:36px;bottom:30px;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18)"></div>
<div style="position:absolute;top:40px;left:36px;right:36px;bottom:30px;padding:48px 34px 20px;display:flex;flex-direction:column;gap:12px">
${P("관찰 기록지 · " + n + " / 4", 12, 900, "#DC2626")}${P(label, 20, 900, "#111827")}${parts.join("")}</div>`;
    k.levels = (lv) => `<div>${(lv ?? []).map((x) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #E5E7EB"><span style="width:18px;height:18px;border:2px solid #334155;border-radius:4px"></span><span style="font-size:13px;color:#1F2937"><b>${esc(x.level ?? x)}</b>${x.desc ? " — " + esc(x.desc) : ""}</span></div>`).join("")}</div>`;
    return k;
  },
  obs4: (c) => {
    const pal = ["#FFF7ED", "#FED7AA", "#FB923C", "#EA580C", "#9A3412"];
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#431407", accent: "#C2410C", body: "#7C2D12", soft: "#FFF7ED", line: "#FDBA74" });
    k.levels = (lv) => levelsBox(lv, "#7C2D12", "#FFF7ED", "#C2410C");
    k.table = (c2) => `<div style="padding:14px;border-radius:14px;background:#FFFBF7;border:1px solid #FED7AA">${heatGrid(c2.data, pal, "#431407")}</div>`;
    return k;
  },
  obs5: (c) => {
    const my = "'Nanum Myeongjo',serif";
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#111111", accent: "#B91C1C", body: "#222222", soft: "#F4F4F4", line: "#BBBBBB" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:44px 50px 34px;display:flex;flex-direction:column;gap:13px">
<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:6px">${P("PHOTO ESSAY", 11, 900, "#111", "letter-spacing:.14em")}${P(String(n), 11, 700, "#111")}</div>
<p style="margin:0;font-family:${my};font-size:26px;font-weight:800;color:#111">${label}</p>${parts.join("")}</div>`;
    k.h = (t) => `<p style="margin:6px 0 0;font-family:${my};font-size:17px;font-weight:800;color:#111">${t}</p>`;
    k.para = (t) => `<p style="margin:0;font-family:${my};font-size:13.5px;line-height:1.9;color:#222">${esc(t)}</p>`;
    k.levels = (lv) => levelsBox(lv, "#222", "#F4F4F4", "#B91C1C");
    k.photo = (src, l, n) => photo(src, "100%", 300, l, n, "#555", "#999", "#F4F4F4", 0);
    return k;
  },
});

/* ── 설문조사 탐구 5종 ── */
// 문항별 결과 (보기별 %)
function surveyList(qs, ink, bar, soft, fs = 12.5) {
  return qs.map((q, i) => `<div style="padding:12px 14px;border-radius:10px;background:${soft}">${P(`Q${i + 1}. ${esc(q.text)}`, fs + 0.5, 800, ink)}
${q.options.map((o) => `<div style="display:flex;align-items:center;gap:8px;margin-top:5px"><span style="width:38%;font-size:${fs}px;color:${ink}">${esc(o.label)}</span><span style="flex:1;height:10px;border-radius:5px;background:#fff;overflow:hidden"><span style="display:block;height:100%;width:${o.pct ?? 0}%;background:${bar}"></span></span><b style="width:42px;text-align:right;font-size:${fs}px;color:${ink}">${o.pct ?? "-"}%</b></div>`).join("")}</div>`).join("");
}
function buildSurveyPages(c, kit) {
  const r = c.r;
  return [
    kit.frame(2, "조사 동기와 배경", [
      kit.h("조사 계기"), kit.voice(r.motive?.text, r.motive),
      kit.question(c.q),
      kit.h("알아야 할 개념"), kit.concepts(r.concepts ?? []),
    ]),
    kit.frame(3, "설문 방법", [
      kit.lead(r.method?.summary ?? ""),
      kit.steps(r.method?.steps ?? []),
      kit.photo(c.photos.p3, "설문 화면 캡처 넣는 곳", c.photoNote, 1),
      kit.h("어려웠던 점과 해결"), kit.voice(r.difficulty?.text, r.difficulty),
    ]),
    kit.frame(4, "응답 결과와 결론", [
      kit.h(`응답 결과${c.total ? ` · ${esc(c.total)}명` : ""}`), kit.survey(c),
      kit.para(r.results?.text ?? ""),
      kit.h("해석"), kit.para(r.interpretation ?? ""),
      kit.mine(r.mine),
      kit.pair(r.limits ?? "", r.next ?? ""),
      kit.h("진로와의 연결"), kit.voice(r.career?.text, r.career),
    ]),
  ];
}
const q0 = (c) => c.surveyQs[0] ?? { text: "", options: [] };

Object.assign(PAGE1, {
  survey1: (c) => { // 말풍선
    const g = "#16A34A";
    const bub = (txt, side, bg, fg) => `<div style="display:flex;justify-content:${side === "l" ? "flex-start" : "flex-end"}"><p style="margin:0;max-width:72%;padding:12px 16px;border-radius:18px;border-${side === "l" ? "bottom-left" : "bottom-right"}-radius:4px;background:${bg};color:${fg};font-size:13.5px;line-height:1.5">${txt}</p></div>`;
    const q = q0(c), top = [...q.options].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
    return { bg: "#FFFFFF", html: `
<div style="padding:42px 48px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;justify-content:space-between">${P(esc(c.name) + " · " + esc(c.subj), 12, 900, g)}${P(esc(c.who), 12, 400, "#6B7280")}</div>
${P(esc(c.title), 20, 900, "#111827", "line-height:1.45")}
<div style="padding:18px;border-radius:20px;background:#F3F4F6;display:flex;flex-direction:column;gap:10px">
${bub(esc(q.text || c.q), "r", g, "#fff")}
${q.options.slice(0, 2).map((o) => bub(`${esc(o.label)} <b>${o.pct ?? "-"}%</b>`, "l", "#fff", "#111827")).join("")}
${top ? bub(`응답${c.total ? ` ${esc(c.total)}명` : ""} 중 <b>${top.pct}%</b>가 ‘${esc(top.label)}’를 골랐어요`, "r", g, "#fff") : ""}</div>
<p style="margin:6px 0 0;font-family:'Do Hyeon',sans-serif;font-size:42px;line-height:1.15;color:#111827">${esc(c.m1)} <span style="color:${g}">${esc(c.m2)}</span></p>
<div style="display:flex;gap:18px;align-items:center">${bars(c.series, 270, 170, "#BBF7D0", g, "#111827", "#6B7280")}${P(esc(c.finding), 13.5, 700, "#111827", "flex:1")}</div>
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 150, "설문 화면 넣는 곳", c.photoNote, "#15803D", "#86EFAC", "#F0FDF4", 14)}<div style="flex:1">${P("응답을 보고 달라진 생각", 14, 900, "#111827")}${P(esc(c.think), 12.5, 400, "#374151", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#374151", "padding:10px;background:#F3F4F6;border-radius:12px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:" + g + ";border-radius:12px")}</div>
</div>` };
  },
  survey2: (c) => { // 투표 결과판
    const q = q0(c);
    const rows = q.options.map((o, i) => `<div style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:center"><p style="margin:0;font-size:14px;font-weight:900;color:#fff">${esc(String(o.label).slice(0, 10))}</p>
<div style="height:38px;border-radius:6px;overflow:hidden;background:#1E293B"><div style="width:${o.pct ?? 0}%;height:100%;background:${i % 2 ? "#3B82F6" : "#EF4444"};display:flex;align-items:center;padding-left:10px;font-size:15px;font-weight:900;color:#fff">${o.pct ?? 0}%</div></div></div>`).join("");
    return { bg: "#0F172A", html: `
<div style="padding:44px 48px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between">${P("설문 개표 결과 · " + esc(c.name), 12, 900, "#FCA5A5", "letter-spacing:.1em")}${P(esc(c.subj + " · " + c.who), 12, 400, "#94A3B8")}</div>
${P(esc(c.title), 20, 700, "#F1F5F9", "line-height:1.45")}
<p style="margin:4px 0 0;font-family:'Black Han Sans',sans-serif;font-size:48px;line-height:1.12;color:#fff">${esc(c.m1)}<br><span style="color:#EF4444">${esc(c.m2)}</span></p>
<div style="padding:18px;border-radius:14px;background:#0B1120;display:flex;flex-direction:column;gap:10px">${P(esc(q.text) + (c.total ? ` (응답 ${esc(c.total)}명)` : ""), 12.5, 700, "#94A3B8")}${rows}</div>
${P(esc(c.finding), 13.5, 400, "#CBD5E1")}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 160, "설문 화면 넣는 곳", c.photoNote, "#94A3B8", "#475569", "#1E293B")}<div style="flex:1">${P("결과를 보고", 14, 900, "#fff")}${P(esc(c.think), 12.5, 400, "#CBD5E1", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#CBD5E1", "padding:10px;border:1px solid #334155;border-radius:8px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:#B91C1C;border-radius:8px")}</div>
</div>` };
  },
  survey3: (c) => { // 영수증
    const mono = "font-family:'Courier New',monospace";
    const line = (l, r, b = false) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;${b ? "font-weight:700;" : ""}"><span>${l}</span><span>${r}</span></div>`;
    const items = c.surveyQs.slice(0, 2).map((q) => `<p style="margin:4px 0 2px;font-size:11.5px;font-weight:700">${esc(String(q.text).slice(0, 26))}</p>` + q.options.map((o) => line(esc(String(o.label).slice(0, 16)), `${o.pct ?? "-"}%`)).join("")).join('<div style="border-top:1px dashed #111;margin:4px 0"></div>');
    return { bg: "#F5F0E8", html: `
<div style="padding:44px 40px;display:flex;gap:26px">
<div style="width:330px;flex-shrink:0;padding:26px 22px 30px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.12);${mono};color:#111;display:flex;flex-direction:column;gap:6px;clip-path:polygon(0 0,100% 0,100% 97%,95% 100%,90% 97%,85% 100%,80% 97%,75% 100%,70% 97%,65% 100%,60% 97%,55% 100%,50% 97%,45% 100%,40% 97%,35% 100%,30% 97%,25% 100%,20% 97%,15% 100%,10% 97%,5% 100%,0 97%)">
<p style="margin:0;text-align:center;font-size:16px;font-weight:700">*** 탐구 영수증 ***</p>
<p style="margin:0;text-align:center;font-size:11px">${esc(c.subj)} · ${esc(c.who)}</p>
<div style="border-top:1px dashed #111"></div>${line("응답 인원", c.total ? esc(c.total) + "명" : "-")}<div style="border-top:1px dashed #111"></div>
${items}
<div style="border-top:2px solid #111;margin-top:4px"></div>
<p style="margin:0;font-size:12.5px;line-height:1.6">${esc(c.finding)}</p>
<p style="margin:6px 0 0;text-align:center;font-size:11px">▌▌▌▌ ▌▌ ▌▌▌ ▌ ▌▌▌▌</p>
<p style="margin:0;text-align:center;font-size:11px">다음 주문: ${esc(c.nxt)}</p></div>
<div style="flex:1;display:flex;flex-direction:column;gap:14px">
${P(esc(c.name), 12, 900, "#EA580C")}${P(esc(c.title), 18, 900, "#1C1917", "line-height:1.45")}
<p style="margin:0;font-family:'Do Hyeon',sans-serif;font-size:38px;line-height:1.15;color:#1C1917">${esc(c.m1)}<br><span style="color:#EA580C">${esc(c.m2)}</span></p>
${photo(c.photos.p1, "100%", 170, "설문 화면 넣는 곳", c.photoNote, "#9A3412", "#FDBA74", "#FFF7ED")}
${P("영수증을 뽑고 든 생각", 14, 900, "#1C1917")}${P(esc(c.think), 12.5, 400, "#44403C", "line-height:1.75")}
${P("<b>한계</b> " + esc(c.limit), 11.5, 400, "#57534E", "padding:10px;background:#fff;border-radius:8px")}
</div></div>` };
  },
  survey4: (c) => { // 팝 포스터
    const q = q0(c), bgs = ["#FFFFFF", "#3DD6D0", "#FF5DA2", "#FFE14D"];
    const cards = q.options.slice(0, 3).map((o, i) => `<div style="flex:1;padding:14px;border:3px solid #111;border-radius:16px;background:${bgs[i]};box-shadow:5px 5px 0 #111"><p style="margin:0;font-size:12.5px;font-weight:900">${esc(String(o.label).slice(0, 12))}</p><p style="margin:4px 0 0;font-family:'Black Han Sans',sans-serif;font-size:40px;line-height:1">${o.pct ?? "-"}%</p></div>`).join("");
    return { bg: "#FFE14D", html: `
<div style="position:absolute;top:-80px;right:-80px;width:300px;height:300px;border-radius:50%;background:#FF5DA2"></div>
<div style="position:absolute;bottom:120px;left:-60px;width:180px;height:180px;border-radius:50%;background:#3DD6D0"></div>
<div style="position:relative;padding:44px 48px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;gap:8px">${P(esc(c.name), 13, 900, "#111", "padding:5px 12px;background:#fff;border:2px solid #111;border-radius:999px")}${P(esc(c.subj + " · " + c.who), 12, 700, "#111", "padding:5px 12px")}</div>
<p style="margin:10px 0 0;font-family:'Black Han Sans',sans-serif;font-size:60px;line-height:1.05;color:#111">${esc(c.m1)}<br><span style="padding:0 8px;background:#111;color:#FFE14D">${esc(c.m2)}</span></p>
${P(esc(c.title), 16, 700, "#111", "line-height:1.5;max-width:560px")}
<div style="display:flex;gap:12px">${cards}</div>
${P(esc(q.text) + (c.total ? ` · 응답 ${esc(c.total)}명` : ""), 12, 700, "#111")}
${P(esc(c.finding), 14, 700, "#111", "padding:12px 14px;background:#fff;border:2px solid #111;border-radius:12px")}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 160, "설문 화면 넣는 곳", c.photoNote, "#111", "#111", "#fff", 16)}<div style="flex:1">${P("그래서!", 16, 900, "#111")}${P(esc(c.think), 12.5, 400, "#111", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#111", "padding:10px;background:#fff;border-radius:10px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#FFE14D", "padding:10px;background:#111;border-radius:10px")}</div>
</div>` };
  },
  survey5: (c) => { // 설문지
    const iv = "#4338CA", dk = "#1E1B4B";
    const qs = c.surveyQs.slice(0, 2).map((q, i) => `<div style="padding:14px 16px;border-radius:12px;background:#fff;border:1px solid #E0E7FF;display:flex;flex-direction:column;gap:7px">${P(`Q${i + 1}. ${esc(q.text)}`, 13.5, 700, dk)}
${q.options.map((o) => { const top = o.pct === Math.max(...q.options.map((x) => x.pct ?? 0)); return `<div style="display:flex;align-items:center;gap:8px;font-size:13px"><span style="width:16px;height:16px;border:2px solid ${iv};border-radius:4px;background:${top ? iv : "#fff"}"></span><span style="flex:1">${esc(o.label)}</span><b style="color:${iv}">${o.pct ?? "-"}%</b></div>`; }).join("")}</div>`).join("");
    return { bg: "#EEF2FF", html: `
<div style="height:12px;background:${iv}"></div>
<div style="padding:32px 48px;display:flex;flex-direction:column;gap:12px">
<div style="padding:18px 20px;border-radius:12px;background:#fff;border-top:8px solid ${iv}">${P(esc(c.name) + " · " + esc(c.subj) + " · " + esc(c.who), 12, 700, iv)}${P(esc(c.title), 20, 900, dk, "margin-top:6px;line-height:1.4")}</div>
${qs}
<div style="padding:20px 22px;border-radius:12px;background:${dk}">${P(`응답${c.total ? ` ${esc(c.total)}개` : ""}를 모아 보니`, 12, 700, "#A5B4FC")}<p style="margin:6px 0 0;font-size:32px;line-height:1.2;font-weight:900;color:#fff">${esc(c.m1)} <span style="color:#FBBF24">${esc(c.m2)}</span></p>${P(esc(c.finding), 13, 400, "#C7D2FE", "margin-top:6px")}</div>
<div style="display:flex;gap:14px">${photo(c.photos.p1, "44%", 150, "설문 화면 넣는 곳", c.photoNote, iv, "#A5B4FC", "#fff", 12)}<div style="flex:1;padding:14px;border-radius:12px;background:#fff">${P("응답을 읽고", 14, 900, dk)}${P(esc(c.think), 12, 400, "#312E81", "line-height:1.7;margin-top:4px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#312E81", "padding:10px;background:#fff;border-radius:10px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:" + iv + ";border-radius:10px")}</div>
</div>` };
  },
});

Object.assign(KITS, {
  survey1: (c) => {
    const g = "#16A34A";
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#111827", accent: g, body: "#374151", soft: "#F0FDF4", line: "#86EFAC" });
    k.question = (q) => `<div style="display:flex;justify-content:flex-end"><p style="margin:0;max-width:80%;padding:14px 18px;border-radius:18px;border-bottom-right-radius:4px;background:${g};color:#fff;font-size:16px;font-weight:800">${esc(q)}</p></div>`;
    k.survey = (c2) => surveyList(c2.surveyQs, "#111827", g, "#F3F4F6");
    return k;
  },
  survey2: (c) => {
    const k = baseKit(c, { bg: "#0F172A", ink: "#F8FAFC", accent: "#EF4444", body: "#CBD5E1", soft: "#1E293B", line: "#334155" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:44px 48px 34px;display:flex;flex-direction:column;gap:13px;background:#0F172A">
${P("설문 개표 결과 · " + n + " / 4", 12, 900, "#FCA5A5", "letter-spacing:.1em")}<p style="margin:0;font-family:'Black Han Sans',sans-serif;font-size:30px;color:#fff">${label}</p>${parts.join("")}</div>`;
    k.survey = (c2) => surveyList(c2.surveyQs, "#F8FAFC", "#EF4444", "#1E293B");
    return k;
  },
  survey3: (c) => {
    const mono = "font-family:'Courier New',monospace";
    const k = baseKit(c, { bg: "#F5F0E8", ink: "#1C1917", accent: "#EA580C", body: "#44403C", soft: "#FFFFFF", line: "#D6D3D1" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:40px 60px 30px;background:#F5F0E8">
<div style="height:100%;box-sizing:border-box;padding:26px 30px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:12px">
<p style="margin:0;${mono};text-align:center;font-size:14px;font-weight:700">*** ${label} ***</p><div style="border-top:1px dashed #111"></div>${parts.join("")}
<p style="margin:auto 0 0;${mono};text-align:center;font-size:11px">— ${n} / 4 —</p></div></div>`;
    k.h = (t) => `<p style="margin:4px 0 0;${mono};font-size:14px;font-weight:700;color:#1C1917">▶ ${t}</p>`;
    k.survey = (c2) => `<div style="${mono}">${surveyList(c2.surveyQs, "#1C1917", "#EA580C", "#FAFAF9", 12)}</div>`;
    return k;
  },
  survey4: (c) => {
    const k = baseKit(c, { bg: "#FFE14D", ink: "#111111", accent: "#FF5DA2", body: "#111111", soft: "#FFFFFF", line: "#111111" });
    k.frame = (n, label, parts) => `<div style="position:absolute;top:-70px;right:-70px;width:220px;height:220px;border-radius:50%;background:#FF5DA2"></div>
<div style="position:absolute;inset:0;padding:44px 48px 34px;display:flex;flex-direction:column;gap:13px">
<p style="margin:0;font-family:'Black Han Sans',sans-serif;font-size:40px;line-height:1.1;color:#111"><span style="padding:0 8px;background:#111;color:#FFE14D">${label}</span></p>${parts.join("")}</div>`;
    k.h = (t) => P(t, 16, 900, "#111", "margin-top:4px");
    k.voice = (t, slot) => `<div style="padding:12px 14px;border:2px solid #111;border-radius:12px;background:#fff">${voice(t, slot, { accent: "#111", body: "#111", soft: "#fff" })}</div>`;
    k.survey = (c2) => `<div style="padding:12px;border:3px solid #111;border-radius:16px;background:#fff;box-shadow:5px 5px 0 #111">${surveyList(c2.surveyQs, "#111", "#FF5DA2", "#FFFBEA")}</div>`;
    return k;
  },
  survey5: (c) => {
    const iv = "#4338CA", dk = "#1E1B4B";
    const k = baseKit(c, { bg: "#EEF2FF", ink: dk, accent: iv, body: "#312E81", soft: "#FFFFFF", line: "#A5B4FC" });
    k.frame = (n, label, parts) => `<div style="position:absolute;top:0;left:0;right:0;height:12px;background:${iv}"></div>
<div style="position:absolute;inset:0;padding:34px 48px 30px;display:flex;flex-direction:column;gap:12px;background:#EEF2FF">
<div style="margin-top:8px;padding:14px 18px;border-radius:12px;background:#fff;border-top:6px solid ${iv}">${P(label, 19, 900, dk)}</div>${parts.join("")}</div>`;
    k.survey = (c2) => surveyList(c2.surveyQs, dk, iv, "#FFFFFF");
    return k;
  },
});

/* ── 데이터 탐구 5종 ── */
function pairsTable(d, ink, line, headBg, fs = 12) {
  if (d?.kind !== "pairs") return table(d, ink, line, headBg, fs, 5);
  const rows = d.rows.filter((r) => r.label);
  return `<table style="width:100%;border-collapse:collapse;background:#fff"><thead><tr><th style="padding:7px 10px;border:1px solid ${line};background:${headBg};font-size:${fs}px;color:${ink};text-align:left">기준</th><th style="padding:7px 10px;border:1px solid ${line};background:${headBg};font-size:${fs}px;color:${ink}">값</th></tr></thead><tbody>${rows.map((r) => `<tr><td style="padding:7px 10px;border:1px solid ${line};font-size:${fs}px;color:${ink}">${esc(r.label)}</td><td style="padding:7px 10px;border:1px solid ${line};font-size:${fs}px;text-align:center;font-weight:800;color:${ink}">${esc(r.value)}</td></tr>`).join("")}</tbody></table>`;
}
function hbars(series, w, cBase, cHi, fg, sub, row = 40) {
  const vals = series.map((x) => x.value).filter((v) => v != null);
  if (!vals.length) return "";
  const max = Math.max(...vals) * 1.1, lw = 110, h = series.length * row + 4;
  const top = Math.max(...vals);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">${series.map((d, i) => {
    const y = i * row + 4, bw = d.value == null ? 0 : Math.round((d.value / max) * (w - lw - 70));
    return `<text x="0" y="${y + row / 2 + 2}" font-size="13" fill="${sub}">${esc(String(d.label).slice(0, 9))}</text><rect x="${lw}" y="${y + 6}" width="${bw}" height="${row - 14}" rx="4" fill="${d.value === top ? cHi : cBase}"></rect><text x="${lw + bw + 8}" y="${y + row / 2 + 3}" font-size="13.5" font-weight="700" fill="${fg}">${d.value ?? ""}</text>`;
  }).join("")}</svg>`;
}
const extremes = (c) => {
  const v = c.series.filter((x) => x.value != null);
  if (!v.length) return [null, null];
  const hi = v.reduce((a, b) => (b.value > a.value ? b : a)), lo = v.reduce((a, b) => (b.value < a.value ? b : a));
  return [hi, lo];
};

Object.assign(PAGE1, {
  data1: (c) => { // 빅넘버
    const [hi, lo] = extremes(c);
    const big = (x, bg, fg) => `<div style="padding:20px;border-radius:18px;background:${bg};text-align:center"><p style="margin:0;font-size:78px;line-height:1;font-weight:900;color:${fg}">${x?.value ?? "-"}<span style="font-size:30px">${esc(c.unit)}</span></p>${P(esc(x?.label ?? ""), 14, 700, fg, "margin-top:6px")}</div>`;
    return { bg: "#FFFFFF", html: `
<div style="padding:44px 50px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between">${P(esc(c.name) + " · " + esc(c.subj), 12, 900, "#0EA5E9", "letter-spacing:.08em")}${P(esc(c.who), 12, 400, "#64748B")}</div>
${P(esc(c.title), 20, 900, "#0F172A", "line-height:1.45")}
<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin-top:6px">${big(hi, "#E0F2FE", "#0369A1")}<p style="margin:0;font-size:28px;font-weight:900;color:#94A3B8">vs</p>${big(lo, "#F1F5F9", "#64748B")}</div>
<p style="margin:6px 0 0;font-size:34px;line-height:1.2;font-weight:900;color:#0F172A;text-align:center">${esc(c.m1)} <span style="color:#0284C7">${esc(c.m2)}</span></p>
${P(esc(c.finding), 13.5, 400, "#334155", "text-align:center")}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px"><div>${P("숫자가 바꾼 생각", 14, 900, "#0F172A")}${P(esc(c.think), 12.5, 400, "#334155", "line-height:1.75;margin-top:6px")}</div>${photo(c.photos.p1, "100%", 180, "데이터 화면 넣는 곳", c.photoNote, "#0369A1", "#7DD3FC", "#F0F9FF")}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#334155", "padding:10px;background:#F1F5F9;border-radius:8px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:#0369A1;border-radius:8px")}</div>
</div>` };
  },
  data2: (c) => { // 점 그래프
    const vio = "#7C3AED", dk = "#2E1065";
    const v = c.series.filter((x) => x.value != null), max = Math.max(1, ...v.map((x) => x.value)), min = Math.min(0, ...v.map((x) => x.value));
    const w = 620, h = 280, gap = (w - 80) / Math.max(1, v.length);
    const dots = v.map((x, i) => { const cx = 60 + gap * i + gap / 2, cy = 230 - ((x.value - min) / (max - min || 1)) * 190; return `<line x1="${cx}" y1="230" x2="${cx}" y2="${cy}" stroke="#E9D5FF" stroke-width="2"></line><circle cx="${cx}" cy="${cy}" r="12" fill="${x.value === max ? vio : "#C4B5FD"}" stroke="#4C1D95"></circle><text x="${cx}" y="${cy - 18}" text-anchor="middle" font-size="13" font-weight="700" fill="${dk}">${x.value}</text><text x="${cx}" y="252" text-anchor="middle" font-size="12" fill="#6D28D9">${esc(String(x.label).slice(0, 7))}</text>`; }).join("");
    return { bg: "#FFFFFF", html: `
<div style="padding:44px 50px;display:flex;flex-direction:column;gap:14px">
${P(esc(c.name) + " · " + esc(c.subj) + " · " + esc(c.who), 12, 700, vio)}
${P(esc(c.title), 21, 900, dk, "line-height:1.45")}
<p style="margin:0;font-size:34px;line-height:1.2;font-weight:900;color:${dk}">${esc(c.m1)}<br><span style="color:${vio}">${esc(c.m2)}</span></p>
<div style="padding:16px;border-radius:16px;background:#FAF5FF"><svg viewBox="0 0 ${w} ${h}" width="100%"><line x1="40" y1="230" x2="${w - 10}" y2="230" stroke="#D8B4FE"></line>${dots}</svg></div>
${P(esc(c.finding), 13.5, 700, dk)}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div>${P("점들이 말해준 것", 14, 900, dk)}${P(esc(c.think), 12.5, 400, "#3B0764", "line-height:1.75;margin-top:6px")}</div>${photo(c.photos.p1, "100%", 170, "데이터 화면 넣는 곳", c.photoNote, "#6D28D9", "#D8B4FE", "#FDFAFF")}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#3B0764", "padding:10px;background:#F3E8FF;border-radius:8px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#3B0764", "padding:10px;border:1.5px solid " + vio + ";border-radius:8px")}</div>
</div>` };
  },
  data3: (c) => { // 미니멀 차트
    return { bg: "#FFFFFF", html: `
<div style="padding:64px 70px;display:flex;flex-direction:column;gap:22px">
<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:10px">${P("Data Inquiry", 13, 700, "#111", "letter-spacing:.06em")}${P(esc(c.subj + " · " + c.who), 12, 400, "#555")}</div>
<p style="margin:0;font-size:42px;line-height:1.15;font-weight:300;color:#111;letter-spacing:-.02em">${esc(c.m1)}<br><b style="font-weight:900">${esc(c.m2)}</b></p>
${P(esc(c.title), 15, 400, "#444", "line-height:1.6")}
<div style="padding:20px 0;border-top:1px solid #DDD;border-bottom:1px solid #DDD">${hbars(c.series, 650, "#D4D4D4", "#111", "#111", "#555", 44)}</div>
${P(esc(c.finding), 14, 700, "#111")}
<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:26px">${P(esc(c.think), 13, 400, "#333", "line-height:1.85")}${photo(c.photos.p1, "100%", 170, "데이터 화면 넣는 곳", c.photoNote, "#777", "#BBB", "#FAFAFA", 0)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:26px;border-top:1px solid #111;padding-top:12px">${P("<b>Limit</b><br>" + esc(c.limit), 12, 400, "#333")}${P("<b>Next</b><br>" + esc(c.nxt), 12, 400, "#333")}</div>
</div>` };
  },
  data4: (c) => { // 블루프린트
    return { bg: "#0B3D91", html: `
<div style="position:absolute;inset:0;background-color:#0B3D91;background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px);background-size:24px 24px"></div>
<div style="position:relative;padding:44px 48px;display:flex;flex-direction:column;gap:14px;color:#fff">
<div style="display:flex;justify-content:space-between;border:1px solid rgba(255,255,255,.6);padding:8px 12px">${P("BLUEPRINT · " + esc(c.name), 12, 700, "#fff", "letter-spacing:.12em;font-family:'Courier New',monospace")}${P(esc(c.subj + " · " + c.who), 12, 400, "#BFDBFE")}</div>
${P(esc(c.title), 20, 700, "#fff", "line-height:1.45")}
<p style="margin:0;font-size:36px;line-height:1.2;font-weight:900">${esc(c.m1)}<br><span style="color:#FDE047">${esc(c.m2)}</span></p>
<div style="border:1px dashed rgba(255,255,255,.7);padding:16px;display:flex;gap:18px;align-items:center"><div>${bars(c.series, 300, 190, "rgba(255,255,255,.35)", "#FDE047", "#fff", "#BFDBFE", c.unit)}</div><div style="flex:1">${P("분석 순서", 13, 700, "#FDE047")}${c.steps.map((x, i) => P(`${i + 1}. ${esc(x[0])} — ${esc(x[1])}`, 12, 400, "#E0E7FF", "margin-top:4px")).join("")}</div></div>
${P(esc(c.finding), 13.5, 700, "#fff")}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div>${P("설계자의 메모", 14, 700, "#FDE047")}${P(esc(c.think), 12.5, 400, "#E0E7FF", "line-height:1.75;margin-top:6px")}</div>${photo(c.photos.p1, "100%", 170, "데이터 화면 넣는 곳", c.photoNote, "#BFDBFE", "rgba(255,255,255,.6)", "rgba(255,255,255,.05)", 0)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#E0E7FF", "padding:10px;border:1px solid rgba(255,255,255,.5)")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#0B3D91", "padding:10px;background:#FDE047")}</div>
</div>` };
  },
  data5: (c) => { // 흐름도
    const em = "#059669", dk = "#064E3B";
    const flow = c.steps.slice(0, 4).map(([a, b], i, arr) => `<div style="flex:1;padding:12px;border-radius:12px;background:${i === arr.length - 1 ? em : "#ECFDF5"};color:${i === arr.length - 1 ? "#fff" : dk}"><p style="margin:0;font-size:11.5px;font-weight:900">STEP ${i + 1}</p><p style="margin:3px 0 0;font-size:15px;font-weight:900">${esc(a)}</p><p style="margin:3px 0 0;font-size:11.5px">${esc(b)}</p></div>${i < arr.length - 1 ? `<span style="align-self:center;font-size:20px;color:${em}">→</span>` : ""}`).join("");
    return { bg: "#FFFFFF", html: `
<div style="padding:44px 48px;display:flex;flex-direction:column;gap:16px">
${P(esc(c.name) + " · " + esc(c.subj) + " · " + esc(c.who), 12, 700, em)}
${P(esc(c.title), 21, 900, dk, "line-height:1.45")}
<div style="display:flex;gap:6px">${flow}</div>
<div style="display:flex;gap:20px;align-items:center;padding:20px;border-radius:16px;border:2px solid ${em}"><div style="flex:1"><p style="margin:0;font-size:32px;line-height:1.2;font-weight:900;color:${dk}">${esc(c.m1)}<br><span style="color:${em}">${esc(c.m2)}</span></p>${P(esc(c.finding), 13, 400, "#065F46", "margin-top:8px")}</div><div>${bars(c.series, 250, 170, "#A7F3D0", em, dk, "#047857", c.unit)}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div>${P("흐름을 따라가며 든 생각", 14, 900, dk)}${P(esc(c.think), 12.5, 400, "#065F46", "line-height:1.75;margin-top:6px")}</div>${photo(c.photos.p1, "100%", 180, "데이터 화면 넣는 곳", c.photoNote, "#047857", "#6EE7B7", "#F0FDF8")}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#065F46", "padding:10px;background:#ECFDF5;border-radius:8px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:" + dk + ";border-radius:8px")}</div>
</div>` };
  },
});

Object.assign(KITS, {
  data1: (c) => {
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#0F172A", accent: "#0284C7", body: "#334155", soft: "#E0F2FE", line: "#7DD3FC" });
    k.table = (c2) => pairsTable(c2.data, "#0F172A", "#BAE6FD", "#E0F2FE");
    k.question = (q) => `<div style="padding:18px;border-radius:18px;background:#E0F2FE;text-align:center">${P(esc(q), 18, 900, "#0369A1")}</div>`;
    return k;
  },
  data2: (c) => {
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#2E1065", accent: "#7C3AED", body: "#3B0764", soft: "#FAF5FF", line: "#D8B4FE" });
    k.table = (c2) => pairsTable(c2.data, "#2E1065", "#E9D5FF", "#FAF5FF");
    k.steps = (st) => st.map((x, i) => `<div style="display:flex;gap:12px;align-items:center"><span style="width:26px;height:26px;border-radius:50%;background:#C4B5FD;border:2px solid #4C1D95;flex-shrink:0"></span><div>${P(esc(x.title), 14, 800, "#2E1065")}${P(esc(x.detail), 12.5, 400, "#3B0764")}</div></div>`).join("");
    return k;
  },
  data3: (c) => {
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#111111", accent: "#111111", body: "#333333", soft: "#F5F5F5", line: "#D4D4D4" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:60px 70px 40px;display:flex;flex-direction:column;gap:18px">
<div style="display:flex;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:8px">${P(label, 13, 700, "#111", "letter-spacing:.06em")}${P(String(n).padStart(2, "0"), 13, 700, "#111")}</div>${parts.join("")}</div>`;
    k.h = (t) => P(t, 20, 300, "#111", "margin-top:4px;letter-spacing:-.01em");
    k.chart = (c2) => hbars(c2.series, 650, "#D4D4D4", "#111", "#111", "#555", 40);
    k.table = (c2) => pairsTable(c2.data, "#111", "#DDD", "#FAFAFA");
    k.mine = (t) => `<div style="border-left:3px solid #111;padding-left:16px">${P("내 생각", 12, 700, "#111")}${voice(t, { guide: "결과에서 가장 의외였던 점과 이유" }, { accent: "#111", body: "#333", soft: "#F5F5F5" }, 15)}</div>`;
    return k;
  },
  data4: (c) => {
    const k = baseKit(c, { bg: "#0B3D91", ink: "#FFFFFF", accent: "#FDE047", body: "#E0E7FF", soft: "rgba(255,255,255,.08)", line: "rgba(255,255,255,.5)" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;background-color:#0B3D91;background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px);background-size:24px 24px"></div>
<div style="position:absolute;inset:0;padding:44px 48px 34px;display:flex;flex-direction:column;gap:13px">
<div style="border:1px solid rgba(255,255,255,.6);padding:8px 12px">${P(`SHEET ${n} / 4 · ${label}`, 13, 700, "#fff", "font-family:'Courier New',monospace;letter-spacing:.08em")}</div>${parts.join("")}</div>`;
    k.chart = (c2) => `<div style="display:flex;justify-content:center;border:1px dashed rgba(255,255,255,.7);padding:10px">${bars(c2.series, 420, 180, "rgba(255,255,255,.35)", "#FDE047", "#fff", "#BFDBFE", c2.unit)}</div>`;
    k.table = (c2) => pairsTable(c2.data, "#0B3D91", "#BFDBFE", "#FDE047");
    k.photo = (src, l, n) => photo(src, "100%", 210, l, n, "#BFDBFE", "rgba(255,255,255,.6)", "rgba(255,255,255,.05)", 0);
    return k;
  },
  data5: (c) => {
    const em = "#059669", dk = "#064E3B";
    const k = baseKit(c, { bg: "#FFFFFF", ink: dk, accent: em, body: "#065F46", soft: "#ECFDF5", line: "#6EE7B7" });
    k.steps = (st) => `<div style="display:flex;gap:6px">${st.slice(0, 4).map((x, i, a) => `<div style="flex:1;padding:12px;border-radius:12px;background:${i === a.length - 1 ? em : "#ECFDF5"};color:${i === a.length - 1 ? "#fff" : dk}"><p style="margin:0;font-size:11px;font-weight:900">STEP ${i + 1}</p><p style="margin:3px 0 0;font-size:14px;font-weight:900">${esc(x.title)}</p><p style="margin:3px 0 0;font-size:11.5px">${esc(x.detail)}</p></div>${i < a.length - 1 ? `<span style="align-self:center;font-size:18px;color:${em}">→</span>` : ""}`).join("")}</div>`;
    k.table = (c2) => pairsTable(c2.data, dk, "#A7F3D0", "#ECFDF5");
    return k;
  },
});

/* ── 사례 탐구 5종 ── */
function caseCards(d, colors, ink, fs = 12) {
  if (!d?.rows?.length) return "";
  return d.rows.slice(0, 3).map((r, j) => `<div style="border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.08);border:1px solid #E5E7EB"><div style="padding:12px;background:${colors[j % colors.length]};font-family:'Black Han Sans',sans-serif;font-size:19px;color:#fff;text-align:center">${esc(String(r).slice(0, 14))}</div><div style="padding:6px 12px 10px">${(d.cols ?? []).slice(0, 4).map((col, i) => `<p style="margin:0;padding:6px 0;border-bottom:1px solid #F3F4F6;font-size:${fs}px"><span style="color:#6B7280">${esc(col)}</span><br><b style="color:${ink}">${esc(d.cells?.[j]?.[i] ?? "")}</b></p>`).join("")}</div></div>`).join("");
}

Object.assign(PAGE1, {
  case1: (c) => { // 대결 카드
    const cols = ["#2563EB", "#DC2626", "#16A34A"];
    return { bg: "#F9FAFB", html: `
<div style="padding:42px 46px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;justify-content:space-between">${P("CASE BATTLE · " + esc(c.name), 12, 900, "#DC2626", "letter-spacing:.1em")}${P(esc(c.subj + " · " + c.who), 12, 400, "#6B7280")}</div>
${P(esc(c.title), 21, 900, "#111827", "line-height:1.4")}
<p style="margin:0;font-family:'Black Han Sans',sans-serif;font-size:42px;line-height:1.15;color:#111827">${esc(c.m1)} <span style="color:#DC2626">${esc(c.m2)}</span></p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">${caseCards(c.data, cols, "#111827")}</div>
${P(esc(c.finding), 14, 700, "#111827", "padding:12px 14px;background:#FEF9C3;border-radius:10px")}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "45%", 150, "사례 사진 넣는 곳", c.photoNote)}<div style="flex:1">${P("사례를 비교하며", 14, 900, "#111827")}${P(esc(c.think), 12.5, 400, "#374151", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#374151", "padding:10px;background:#F3F4F6;border-radius:8px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#374151", "padding:10px;border:1.5px solid #111827;border-radius:8px")}</div>
</div>` };
  },
  case2: (c) => { // 비교 히트맵
    const tints = ["#FEE2E2", "#FECACA", "#FCA5A5", "#FDE68A", "#FED7AA"];
    const d = c.data ?? {};
    const th = ["사례", ...(d.cols ?? [])].map((h) => `<th style="padding:10px;font-size:12.5px;color:#fff;background:#0F172A;text-align:center">${esc(h)}</th>`).join("");
    const tr = (d.rows ?? []).map((r, i) => `<tr><td style="padding:12px 10px;font-size:12.5px;font-weight:700;background:#E2E8F0;color:#0F172A;border:3px solid #fff">${esc(r)}</td>${(d.cells?.[i] ?? []).map((x, j) => `<td style="padding:12px 10px;font-size:12.5px;text-align:center;background:${tints[(i + j) % tints.length]};color:#0F172A;border:3px solid #fff">${esc(x)}</td>`).join("")}</tr>`).join("");
    return { bg: "#FFFFFF", html: `
<div style="padding:44px 48px;display:flex;flex-direction:column;gap:16px">
${P(esc(c.name) + " · " + esc(c.subj) + " · " + esc(c.who), 12, 700, "#64748B")}
${P(esc(c.title), 21, 900, "#0F172A", "line-height:1.4")}
<p style="margin:0;font-size:34px;line-height:1.2;font-weight:900;color:#0F172A">${esc(c.m1)}<br><span style="color:#DC2626">${esc(c.m2)}</span></p>
<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
${P(esc(c.finding), 13.5, 700, "#0F172A")}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><div>${P("표가 말해준 것", 14, 900, "#0F172A")}${P(esc(c.think), 12.5, 400, "#334155", "line-height:1.75;margin-top:6px")}</div>${photo(c.photos.p1, "100%", 180, "사례 사진 넣는 곳", c.photoNote)}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#334155", "padding:10px;background:#F1F5F9")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#fff", "padding:10px;background:#0F172A")}</div>
</div>` };
  },
  case3: (c) => { // 무드보드
    const pk = "#BE185D";
    const tags = (c.data?.cols ?? []).slice(0, 4).map((t) => `<span style="padding:6px 12px;border-radius:999px;background:#FCE7F3;font-size:13px;font-weight:700;color:${pk}">#${esc(String(t).slice(0, 10))}</span>`).join("");
    return { bg: "#FFFFFF", html: `
<div style="padding:40px 44px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;justify-content:space-between;align-items:center"><p style="margin:0;font-family:'Do Hyeon',sans-serif;font-size:22px;color:${pk}">사례 무드보드</p>${P(esc(c.subj + " · " + c.who), 12, 400, "#6B7280")}</div>
${P(esc(c.title), 19, 900, "#1F2937", "line-height:1.45")}
<div style="display:grid;grid-template-columns:1.3fr 1fr;grid-template-rows:175px 175px;gap:10px">
<div style="grid-row:span 2">${photo(c.photos.p1, "100%", 360, "사례 사진 1", c.data?.rows?.[0] ?? "", "#9D174D", "#F9A8D4", "#FFF1F7", 14)}</div>
${photo(c.photos.p1b, "100%", 175, "사례 사진 2", c.data?.rows?.[1] ?? "", "#9D174D", "#F9A8D4", "#FFF1F7", 14)}${photo(c.photos.p1c, "100%", 175, "사례 사진 3", c.data?.rows?.[2] ?? "", "#9D174D", "#F9A8D4", "#FFF1F7", 14)}</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">${tags}</div>
<div style="padding:18px 20px;border-radius:16px;background:#1F2937"><p style="margin:0;font-family:'Do Hyeon',sans-serif;font-size:34px;line-height:1.2;color:#fff">${esc(c.m1)} <span style="color:#F472B6">${esc(c.m2)}</span></p>${P(esc(c.finding), 13, 400, "#E5E7EB", "margin-top:8px")}</div>
${table(c.data, "#831843", "#FBCFE8", "#FDF2F8", 11.5, 4)}
<div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px">${P(esc(c.think), 12.5, 400, "#374151", "line-height:1.7")}${P("<b>다음 질문</b><br>" + esc(c.nxt) + "<br><br><b>한계</b> " + esc(c.limit), 11.5, 400, "#374151", "padding:12px;border-radius:12px;background:#FDF2F8")}</div>
</div>` };
  },
  case4: (c) => { // 케이스 파일
    const mono = "font-family:'Courier New','Nanum Myeongjo',monospace", ink = "#3A2E1F";
    return { bg: "#D6C39C", html: `
<div style="position:absolute;top:40px;left:40px;width:200px;height:40px;background:#E7C98A;border-radius:12px 12px 0 0"></div>
<div style="position:absolute;top:76px;left:40px;right:40px;bottom:40px;background:#F1D9A5;border-radius:0 12px 12px 12px;box-shadow:0 6px 18px rgba(0,0,0,.12)"></div>
<div style="position:relative;padding:50px 64px 0;display:flex;flex-direction:column;gap:14px;color:${ink}">
<p style="margin:0;${mono};font-size:14px;font-weight:700">CASE FILE · ${esc(c.name)}</p>
<div style="margin-top:20px;padding:24px 26px;background:#FFFDF6;box-shadow:0 2px 6px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:12px">
<div style="display:flex;justify-content:space-between">${P(esc(c.subj + " · " + c.who), 12, 400, "#6B5B45")}<span style="padding:4px 10px;border:3px solid #B91C1C;color:#B91C1C;font-weight:900;font-size:14px;transform:rotate(6deg)">결론 확인</span></div>
${P(esc(c.title), 19, 900, ink, "line-height:1.45")}
<p style="margin:0;${mono};font-size:29px;line-height:1.3;font-weight:700">${esc(c.m1)}<br><span style="background:#FDE047">${esc(c.m2)}</span></p>
${P(esc(c.finding), 13, 400, ink, "line-height:1.7")}
${table(c.data, ink, "#C9B38A", "#F7EBCF", 11.5, 4)}
<div style="display:flex;gap:14px">${photo(c.photos.p1, "42%", 150, "증거 사진", c.photoNote, "#6B5B45", "#C9B38A", "#FBF3E1", 0)}<div style="flex:1"><p style="margin:0;${mono};font-size:14px;font-weight:700">수사 메모</p>${P(esc(c.think), 12, 400, ink, "line-height:1.7")}</div></div>
<p style="margin:0;${mono};font-size:12px;line-height:1.6">▶ 다음 수사: ${esc(c.nxt)}<br>▶ 한계: ${esc(c.limit)}</p>
</div></div>` };
  },
  case5: (c) => { // 스포트라이트
    const d = c.data ?? {};
    const cards = (d.rows ?? []).slice(0, 3).map((r, j) => `<div style="padding:14px;border-radius:12px;background:${j === 0 ? "#FDE047" : "#27272A"};color:${j === 0 ? "#18181B" : "#E4E4E7"}"><p style="margin:0;font-size:15px;font-weight:900">${esc(String(r).slice(0, 14))}</p>${(d.cols ?? []).slice(0, 3).map((col, i) => `<p style="margin:6px 0 0;font-size:12px">${esc(col)} · <b>${esc(d.cells?.[j]?.[i] ?? "")}</b></p>`).join("")}</div>`).join("");
    return { bg: "#09090B", html: `
<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 30%,#3F3F46 0%,#09090B 60%)"></div>
<div style="position:relative;padding:46px 50px;display:flex;flex-direction:column;gap:16px;color:#FAFAFA">
<div style="display:flex;justify-content:space-between">${P("SPOTLIGHT · " + esc(c.name), 12, 900, "#FDE047", "letter-spacing:.12em")}${P(esc(c.subj + " · " + c.who), 12, 400, "#A1A1AA")}</div>
${P(esc(c.title), 18, 700, "#E4E4E7", "line-height:1.45;text-align:center")}
<p style="margin:14px 0 0;text-align:center;font-family:'Black Han Sans',sans-serif;font-size:50px;line-height:1.15;color:#fff">${esc(c.m1)}<br><span style="color:#FDE047">${esc(c.m2)}</span></p>
${P(esc(c.finding), 14, 400, "#D4D4D8", "text-align:center;padding:0 40px")}
<div style="margin-top:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${cards}</div>
<div style="display:flex;gap:14px">${photo(c.photos.p1, "45%", 160, "사례 사진 넣는 곳", c.photoNote, "#A1A1AA", "#52525B", "#18181B")}<div style="flex:1">${P("무대 뒤 이야기", 14, 900, "#FDE047")}${P(esc(c.think), 12.5, 400, "#D4D4D8", "line-height:1.7;margin-top:6px")}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${P("<b>한계</b> " + esc(c.limit), 12, 400, "#D4D4D8", "padding:10px;border:1px solid #3F3F46;border-radius:8px")}${P("<b>다음 질문</b> " + esc(c.nxt), 12, 400, "#18181B", "padding:10px;background:#FDE047;border-radius:8px")}</div>
</div>` };
  },
});

Object.assign(KITS, {
  case1: (c) => {
    const k = baseKit(c, { bg: "#F9FAFB", ink: "#111827", accent: "#DC2626", body: "#374151", soft: "#FFFFFF", line: "#E5E7EB" });
    k.table = (c2) => `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${caseCards(c2.data, ["#2563EB", "#DC2626", "#16A34A"], "#111827", 11.5)}</div>`;
    return k;
  },
  case2: (c) => {
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#0F172A", accent: "#DC2626", body: "#334155", soft: "#F1F5F9", line: "#CBD5E1" });
    k.table = (c2) => table(c2.data, "#0F172A", "#fff", "#E2E8F0", 12, 5);
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;display:flex;flex-direction:column"><div style="padding:18px 48px;background:#0F172A">${P(label, 19, 900, "#fff")}</div><div style="padding:24px 48px;display:flex;flex-direction:column;gap:13px">${parts.join("")}</div></div>`;
    return k;
  },
  case3: (c) => {
    const pk = "#BE185D";
    const k = baseKit(c, { bg: "#FFFFFF", ink: "#1F2937", accent: pk, body: "#374151", soft: "#FDF2F8", line: "#F9A8D4" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;padding:40px 44px 32px;display:flex;flex-direction:column;gap:13px"><p style="margin:0;font-family:'Do Hyeon',sans-serif;font-size:30px;color:${pk}">${label}</p>${parts.join("")}</div>`;
    k.h = (t) => `<span style="align-self:flex-start;padding:5px 12px;border-radius:999px;background:#FCE7F3;font-size:13px;font-weight:800;color:${pk}">#${t}</span>`;
    k.table = (c2) => table(c2.data, "#831843", "#FBCFE8", "#FDF2F8", 11.5, 5);
    k.photo = (src, l, n) => photo(src, "100%", 220, l, n, "#9D174D", "#F9A8D4", "#FFF1F7", 14);
    return k;
  },
  case4: (c) => {
    const mono = "font-family:'Courier New','Nanum Myeongjo',monospace", ink = "#3A2E1F";
    const k = baseKit(c, { bg: "#D6C39C", ink, accent: "#B91C1C", body: ink, soft: "#FBF3E1", line: "#C9B38A" });
    k.frame = (n, label, parts) => `<div style="position:absolute;top:40px;left:40px;width:200px;height:40px;background:#E7C98A;border-radius:12px 12px 0 0"></div>
<div style="position:absolute;top:76px;left:40px;right:40px;bottom:40px;background:#F1D9A5;border-radius:0 12px 12px 12px"></div>
<div style="position:absolute;top:96px;left:60px;right:60px;bottom:60px;padding:22px 24px;background:#FFFDF6;box-shadow:0 2px 6px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:12px">
<p style="margin:0;${mono};font-size:15px;font-weight:700;color:${ink}">CASE FILE · ${n} / 4 — ${label}</p>${parts.join("")}</div>`;
    k.h = (t) => `<p style="margin:4px 0 0;${mono};font-size:14px;font-weight:700;color:${ink}">▶ ${t}</p>`;
    k.table = (c2) => table(c2.data, ink, "#C9B38A", "#F7EBCF", 11.5, 5);
    return k;
  },
  case5: (c) => {
    const k = baseKit(c, { bg: "#09090B", ink: "#FAFAFA", accent: "#FDE047", body: "#D4D4D8", soft: "#18181B", line: "#3F3F46" });
    k.frame = (n, label, parts) => `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 20%,#3F3F46 0%,#09090B 60%)"></div>
<div style="position:absolute;inset:0;padding:44px 48px 34px;display:flex;flex-direction:column;gap:13px">
${P("SPOTLIGHT · " + n + " / 4", 12, 900, "#FDE047", "letter-spacing:.12em")}<p style="margin:0;font-family:'Black Han Sans',sans-serif;font-size:32px;color:#fff">${label}</p>${parts.join("")}</div>`;
    k.table = (c2) => table(c2.data, "#18181B", "#3F3F46", "#FDE047", 12, 5).replace(/<td style="/g, '<td style="color:#E4E4E7;');
    return k;
  },
});

/* ── 학교 양식: 선생님이 정한 글꼴·크기, 장식 없음, 기억 문장만 굵게 ── */
function school(c, spec = {}) {
  const font = { 함초롬바탕: "'Nanum Myeongjo',serif", 바탕: "'Nanum Myeongjo',serif", 함초롬돋움: "'Noto Sans KR',sans-serif", "맑은 고딕": "'Noto Sans KR',sans-serif" }[spec.font] ?? "'Nanum Myeongjo',serif";
  const pt = Number(spec.size) || 11, px = Math.round(pt * 1.333 * 10) / 10, lh = (Number(spec.lineHeight) || 160) / 100;
  const tok = { ink: "#000", accent: "#000", body: "#000", soft: "#F5F5F5", head: font, bg: "#FFFFFF", line: "#999" };
  const r = c.r;
  const sec = (t) => `<p style="margin:14px 0 4px;font-family:${font};font-size:${px + 2}px;font-weight:700">${t}</p>`;
  const txt = (t) => `<p style="margin:0;font-family:${font};font-size:${px}px;line-height:${lh}">${esc(t)}</p>`;
  const v = (t, slot) => (t ? txt(t) : `<p class="slot-todo" style="margin:0;padding:6px 8px;border:1px dashed #888;font-family:${font};font-size:${px}px;color:#666">${esc(slot?.guide ?? "내 말로 채워 주세요")}</p>`);
  // 사진 — 넣었을 때만 그림 번호와 함께 (없으면 빈칸 없이)
  let fig = 0;
  const pic = (src, cap) =>
    src
      ? `<div style="margin:10px 0 4px;text-align:center"><img src="${src}" alt="" style="max-width:100%;max-height:300px;object-fit:contain;display:inline-block"><p style="margin:4px 0 0;font-family:${font};font-size:${px - 1}px">그림 ${++fig}. ${esc(cap)}</p></div>`
      : "";
  const pg = (n, body) => `<div style="position:absolute;inset:0;padding:70px 72px 50px;background:#fff">${body}<p style="position:absolute;bottom:30px;left:0;right:0;text-align:center;font-size:11px">${n}</p></div>`;
  return [
    pg(1, `<p style="margin:0 0 6px;text-align:center;font-family:${font};font-size:${px + 8}px;font-weight:700">${esc(c.title)}</p>
<p style="margin:0 0 18px;text-align:center;font-family:${font};font-size:${px}px">${esc(c.subj)} · ${esc(c.who)}</p>
${sec("Ⅰ. 탐구 계기")}${v(r.motive?.text, r.motive)}${txt("출발 질문: " + (c.q ?? ""))}
${sec("Ⅱ. 핵심 발견")}<p style="margin:0;font-family:${font};font-size:${px + 4}px;font-weight:700;line-height:1.5">${esc(c.m1)} ${esc(c.m2)}</p>${txt(c.finding)}${pic(c.photos.p1, "탐구 대표 사진")}
${sec("Ⅲ. 알아야 할 개념")}${(r.concepts ?? []).map((x) => txt(`· ${x.term}: ${x.explain}`)).join("")}`),
    pg(2, `${sec("Ⅳ. 탐구 방법")}${txt(r.method?.summary ?? "")}${(r.method?.steps ?? []).map((x, i) => txt(`${i + 1}) ${x.title} — ${x.detail}`)).join("")}${pic(c.photos.p3, "탐구 과정")}
${sec("Ⅴ. 어려웠던 점과 해결")}${v(r.difficulty?.text, r.difficulty)}`),
    pg(3, `${sec("Ⅵ. 결과")}${txt(r.results?.text ?? "")}<div style="margin:10px 0">${table(c.data, "#000", "#999", "#F5F5F5", px - 1, 4) || bars(c.series, 420, 180, "#999", "#000", "#000", "#333")}</div>
${sec("Ⅶ. 해석과 내 생각")}${txt(r.interpretation ?? "")}${v(r.mine, { guide: "결과에서 가장 의외였던 점과 이유" })}`),
    pg(4, `${sec("Ⅷ. 한계와 다음 질문")}${txt(r.limits ?? "")}${txt("다음 질문: " + (r.next ?? ""))}
${sec("Ⅸ. 진로와의 연결")}${v(r.career?.text, r.career)}
${sec("참고 자료")}${(r.references ?? []).map((x, i) => txt(`${i + 1}. ${x.title}${x.publisher ? `, ${x.publisher}` : ""}${x.url ? `, ${x.url}` : ""}`)).join("")}`),
  ].map((html) => ({ bg: "#FFFFFF", html }));
}

/* ── 잉크 절약 — 바탕을 통째로 칠한 디자인을 흰 종이 + 테두리·글자 강조로 ──
 * 인쇄하면 잉크를 너무 먹어서 종이가 말린다. 디자인 모양은 두고 색 면만 바꾼다
 *  bg: 칠한 면 → 흰색(필요하면 안쪽 테두리) / fg: 흰 글자 → 진한 글자 / raw: 그대로 바꿀 문자열
 */
const OUTLINE = (c, w = 1.5) => `#FFFFFF;box-shadow:inset 0 0 0 ${w}px ${c}`;
const INK_SAVER = {
  survey2: {
    raw: [],
    bg: { "#0F172A": "#FFFFFF", "#0B1120": OUTLINE("#0F172A", 2), "#1E293B": "#F1F5F9", "#B91C1C": OUTLINE("#B91C1C", 2) },
    fg: { "#fff": "#0F172A", "#FFFFFF": "#0F172A", "#F1F5F9": "#0F172A", "#F8FAFC": "#0F172A", "#CBD5E1": "#334155", "#94A3B8": "#475569", "#FCA5A5": "#DC2626" },
    border: { "#334155": "#CBD5E1" },
  },
  exp4: {
    bg: { "#0B0F19": "#FFFFFF", "#111827": OUTLINE("#D1D5DB"), "#A3E635": "#ECFCCB" },
    fg: { "#fff": "#111827", "#FFFFFF": "#111827", "#F9FAFB": "#111827", "#E5E7EB": "#1F2937", "#D1D5DB": "#374151", "#9CA3AF": "#6B7280", "#A3E635": "#4D7C0F", "#0B0F19": "#1A2E05" },
    fill: { "#F9FAFB": "#111827", "#374151": "#D9F99D", "#A3E635": "#65A30D", "#9CA3AF": "#6B7280" },
    border: { "#374151": "#D1D5DB", "#4B5563": "#D1D5DB" },
  },
  case5: {
    raw: [["radial-gradient(ellipse at 50% 30%,#3F3F46 0%,#09090B 60%)", "#FFFFFF"], ["radial-gradient(ellipse at 50% 20%,#3F3F46 0%,#09090B 60%)", "#FFFFFF"]],
    bg: { "#09090B": "#FFFFFF", "#27272A": OUTLINE("#D4D4D8"), "#18181B": "#F4F4F5", "#FDE047": "#FEF9C3" },
    fg: { "#fff": "#18181B", "#FFFFFF": "#18181B", "#FAFAFA": "#18181B", "#E4E4E7": "#27272A", "#D4D4D8": "#3F3F46", "#A1A1AA": "#52525B", "#FDE047": "#A16207" },
    border: { "#3F3F46": "#D4D4D8", "#52525B": "#D4D4D8" },
  },
  data4: {
    raw: [["background-color:#0B3D91;background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)", "background-color:#FFFFFF;background-image:linear-gradient(rgba(11,61,145,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(11,61,145,.07) 1px,transparent 1px)"],
          ["rgba(255,255,255,.6)", "rgba(11,61,145,.5)"], ["rgba(255,255,255,.7)", "rgba(11,61,145,.5)"], ["rgba(255,255,255,.5)", "rgba(11,61,145,.4)"], ["rgba(255,255,255,.35)", "#BFDBFE"], ["rgba(255,255,255,.05)", "#F8FAFC"], ["rgba(255,255,255,.08)", "#F8FAFC"]],
    bg: { "#0B3D91": "#FFFFFF", "#FDE047": "#FEF3C7" },
    fg: { "#fff": "#0B3D91", "#FFFFFF": "#0B3D91", "#BFDBFE": "#1E40AF", "#E0E7FF": "#1E3A8A", "#FDE047": "#B45309" },
    fill: { "#FDE047": "#F59E0B", "#fff": "#0B3D91", "#BFDBFE": "#1E40AF" },
  },
  survey4: {
    raw: [
      ["width:300px;height:300px;border-radius:50%;background:#FF5DA2", "width:300px;height:300px;border-radius:50%;box-sizing:border-box;border:10px solid #FF5DA2"],
      ["width:180px;height:180px;border-radius:50%;background:#3DD6D0", "width:180px;height:180px;border-radius:50%;box-sizing:border-box;border:8px solid #3DD6D0"],
      ["width:220px;height:220px;border-radius:50%;background:#FF5DA2", "width:220px;height:220px;border-radius:50%;box-sizing:border-box;border:8px solid #FF5DA2"],
    ],
    bg: { "#FFE14D": "#FFFFFF", "#3DD6D0": "#CCFBF1", "#FF5DA2": "#FCE7F3" },
  },
  survey3: { bg: { "#F5F0E8": "#FFFFFF" }, raw: [["box-shadow:0 6px 20px rgba(0,0,0,.12)", "box-shadow:0 0 0 1.5px #D6D3D1"], ["box-shadow:0 6px 20px rgba(0,0,0,.1)", "box-shadow:0 0 0 1.5px #D6D3D1"]] },
  case4: { bg: { "#D6C39C": "#FFFFFF", "#E7C98A": OUTLINE("#C9A96E", 2), "#F1D9A5": OUTLINE("#C9A96E", 2) } },
  obs2: { bg: { "#C9A77C": "#FFFFFF" }, raw: [["rgba(255,255,255,.55)", "rgba(253,224,71,.7)"], ["rgba(255,255,255,.6)", "rgba(253,224,71,.7)"], ["box-shadow:0 3px 8px rgba(0,0,0,.15)", "box-shadow:0 0 0 1.5px #D6B98C"]] },
  obs3: { bg: { "#E5E7EB": "#FFFFFF" }, raw: [["box-shadow:0 8px 24px rgba(0,0,0,.18)", "box-shadow:0 0 0 2px #9CA3AF"]] },
  lit1: { bg: { "#FBF5E6": "#FFFFFF" } },
  lit5: {
    raw: [["width:120px;background:#7C2D12", "width:120px;background:#FFFFFF;box-shadow:inset -5px 0 0 #7C2D12"], ["width:44px;background:#7C2D12", "width:44px;background:#FFFFFF;box-shadow:inset -4px 0 0 #7C2D12"],
          ["padding:18px 20px;background:#7C2D12", "padding:18px 20px;background:#FFF7ED;box-shadow:inset 0 0 0 2px #7C2D12"]],
    fg: { "#FED7AA": "#9A3412", "#fff": "#1C1917" },
  },
};

// 속성 값만 정확히 바꾼다 (배경은 배경끼리, 글자는 글자끼리)
function inkSave(html, cfg) {
  const re = (hex) => hex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let h = html;
  for (const [a, b] of cfg.raw ?? []) h = h.split(a).join(b);
  for (const [a, b] of Object.entries(cfg.bg ?? {})) h = h.replace(new RegExp(`(background(?:-color)?:\\s*)${re(a)}(?![0-9A-Fa-f])`, "g"), `$1${b}`);
  for (const [a, b] of Object.entries(cfg.fg ?? {})) h = h.replace(new RegExp(`((?:^|[;"\\s])color:\\s*)${re(a)}(?![0-9A-Fa-f])`, "g"), `$1${b}`);
  for (const [a, b] of Object.entries(cfg.fill ?? {})) h = h.replace(new RegExp(`fill="${re(a)}"`, "g"), `fill="${b}"`);
  for (const [a, b] of Object.entries(cfg.border ?? {})) h = h.replace(new RegExp(`(border(?:-[a-z]+)?:\\s*[0-9.]+px\\s+(?:solid|dashed)\\s+)${re(a)}`, "g"), `$1${b}`);
  return h;
}

/* ── 목록과 렌더 ── */
export const TEMPLATES = [
  { id: "school", name: "학교 양식", method: "all", desc: "선생님이 정한 글꼴·크기 그대로" },
  { id: "lit1", name: "도서 대출카드", method: "lit" },
  { id: "lit2", name: "논문 초록", method: "lit" },
  { id: "lit3", name: "인용 하이라이트", method: "lit" },
  { id: "lit4", name: "자료 지도", method: "lit" },
  { id: "lit5", name: "책 표지", method: "lit" },
  { id: "exp1", name: "모눈 실험노트", method: "exp" },
  { id: "exp2", name: "학회 포스터", method: "exp" },
  { id: "exp3", name: "비커 그래프", method: "exp" },
  { id: "exp4", name: "다크 랩", method: "exp" },
  { id: "exp5", name: "플로우차트", method: "exp" },
  { id: "obs1", name: "관찰 달력", method: "obs" },
  { id: "obs2", name: "필드노트", method: "obs" },
  { id: "obs3", name: "클립보드", method: "obs" },
  { id: "obs4", name: "히트맵", method: "obs" },
  { id: "obs5", name: "사진 에세이", method: "obs" },
  { id: "survey1", name: "말풍선", method: "survey" },
  { id: "survey2", name: "투표 결과판", method: "survey" },
  { id: "survey3", name: "영수증", method: "survey" },
  { id: "survey4", name: "팝 포스터", method: "survey" },
  { id: "survey5", name: "설문지", method: "survey" },
  { id: "data1", name: "빅넘버", method: "data" },
  { id: "data2", name: "점 그래프", method: "data" },
  { id: "data3", name: "미니멀 차트", method: "data" },
  { id: "data4", name: "블루프린트", method: "data" },
  { id: "data5", name: "흐름도", method: "data" },
  { id: "case1", name: "대결 카드", method: "case" },
  { id: "case2", name: "비교 히트맵", method: "case" },
  { id: "case3", name: "무드보드", method: "case" },
  { id: "case4", name: "케이스 파일", method: "case" },
  { id: "case5", name: "스포트라이트", method: "case" },
];

/* 4장 모두 → [{ bg, html }] */
export function renderPages(tplId, inq, opts = {}) {
  if (!opts.preview) return renderInner(tplId, inq);
  // 미리보기: 내 사진 대신 '○○ 예시 이미지' — 디자인이 어느 유형용인지로 이름을 붙인다
  const kind = { lit: "문헌", case: "사례", data: "데이터", survey: "설문", exp: "실험", obs: "관찰", all: "탐구" }[TEMPLATES.find((t) => t.id === tplId)?.method] ?? "탐구";
  PREVIEW = kind;
  try {
    return renderInner(tplId, { ...inq, report: { ...(inq.report ?? {}), photos: {} } });
  } finally {
    PREVIEW = null;
  }
}

function renderInner(tplId, inq) {
  const pages = renderRaw(tplId, inq);
  const cfg = INK_SAVER[tplId];
  // 모든 디자인: 종이 바탕은 흰색. 바탕을 칠한 디자인은 색 면을 테두리로
  return pages.map((p) => ({ bg: "#FFFFFF", html: cfg ? inkSave(p.html, cfg) : p.html }));
}

function renderRaw(tplId, inq) {
  const c = toContent(inq);
  if (tplId === "school") return school(c, inq.format_spec ?? {});
  const p1 = (PAGE1[tplId] ?? PAGE1.lit1)(c);
  // 디자인 전용 속지가 있으면 그걸로, 없으면 공통 틀
  if (KITS[tplId]) {
    const kit = KITS[tplId](c);
    const inner = tplId.startsWith("exp") ? buildExpPages(c, kit)
      : tplId.startsWith("obs") ? buildObsPages(c, kit)
      : tplId.startsWith("survey") ? buildSurveyPages(c, kit)
      : buildPages(c, kit);
    return [{ bg: p1.bg, html: p1.html }, ...inner.map((html) => ({ bg: kit.bg, html }))];
  }
  return [{ bg: p1.bg, html: p1.html }, { bg: p1.tok.bg, html: page2(c, p1.tok) }, { bg: p1.tok.bg, html: page3(c, p1.tok) }, { bg: p1.tok.bg, html: page4(c, p1.tok) }];
}

/* 비어 있는 학생 칸 수 (출력 전에 알려주기) */
export function emptyVoices(inq) {
  const r = inq.report ?? {};
  return [r.motive?.text, r.difficulty?.text, r.mine, r.career?.text].filter((x) => !x || !String(x).trim()).length;
}