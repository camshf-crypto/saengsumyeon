/* 발표 PPT 만들기 (src/lib/speechDeck.js · 물꼬 Agent.jsx 의 PPT 받기에서 쓴다) — 물꼬 발표 대본(school_tasks.speech)으로
 * 16:9 PPT를 학생 브라우저에서 바로 만든다 (AI 다시 안 부름 · 비용 없음)
 * 표지 → 목차 → 대본 슬라이드(내용 화면 5가지: bullets · big · compare · steps · quote) → 참고 자료 → 마무리
 * 발표자 노트에 대본(멈춤 · 억양 · 빠르기 · 시선 표시 그대로) · 사진은 '사진 넣는 자리' + 검색어
 *
 * 디자인(STYLES) 6개 — 표지 · 제목 자리 · 카드 · 번호 · 글꼴이 서로 다르다
 *   classic 클래식 · minimal 미니멀 · sidebar 사이드바 · board 보드 · bold 볼드 · editorial 에디토리얼
 * 색(PALETTES) 6개 — 어떤 디자인에도 입힐 수 있다 · 과목으로 디자인 · 색을 하나씩 추천(recommend)
 */
export const PALETTES = [
  { key: "navy", name: "네이비", primary: "172554", accent: "F97316", onPrimary: "FFFFFF", onAccent: "FFFFFF", bg: "FFFFFF", surface: "F3F4F6", soft: "FFF7ED", line: "E5E7EB", box: "CBD5E1", ink: "111827", sub: "6B7280", title: "172554" },
  { key: "mono", name: "블랙", primary: "111111", accent: "2563EB", onPrimary: "FFFFFF", onAccent: "FFFFFF", bg: "FFFFFF", surface: "F4F4F5", soft: "EFF6FF", line: "E4E4E7", box: "D4D4D8", ink: "1F2937", sub: "6B7280", title: "111111" },
  { key: "forest", name: "그린", primary: "14532D", accent: "65A30D", onPrimary: "FFFFFF", onAccent: "FFFFFF", bg: "FFFFFF", surface: "F0FDF4", soft: "F7FEE7", line: "DCFCE7", box: "BBF7D0", ink: "1C1917", sub: "57534E", title: "14532D" },
  { key: "warm", name: "브라운", primary: "7C2D12", accent: "D97706", onPrimary: "FFFBF5", onAccent: "FFFFFF", bg: "FFFBF5", surface: "F5EFE6", soft: "FEF3C7", line: "E7E0D6", box: "D6CBBB", ink: "292524", sub: "78716C", title: "7C2D12" },
  { key: "dark", name: "다크", primary: "020617", accent: "22D3EE", onPrimary: "FFFFFF", onAccent: "0F172A", bg: "0F172A", surface: "1E293B", soft: "1E293B", line: "334155", box: "475569", ink: "E2E8F0", sub: "94A3B8", title: "FFFFFF" },
  { key: "berry", name: "핑크", primary: "831843", accent: "EC4899", onPrimary: "FFFFFF", onAccent: "FFFFFF", bg: "FFFFFF", surface: "FDF2F8", soft: "FCE7F3", line: "FBCFE8", box: "F9A8D4", ink: "1F2937", sub: "6B7280", title: "831843" },
];
export const STYLES = [
  { key: "classic", name: "클래식", desc: "단정한 기본 · 색 띠 표지", palette: "navy" },
  { key: "minimal", name: "미니멀", desc: "여백 · 가는 선 · 테두리 카드", palette: "mono" },
  { key: "sidebar", name: "사이드바", desc: "왼쪽 색 기둥에 큰 번호", palette: "forest" },
  { key: "board", name: "보드", desc: "위 색 띠 · 그림자 카드", palette: "berry" },
  { key: "bold", name: "볼드", desc: "아주 큰 번호 · 굵은 글씨", palette: "dark" },
  { key: "editorial", name: "에디토리얼", desc: "가운데 정렬 · 명조 · 잡지 느낌", palette: "warm" },
];
export function recommend(subject = "") {
  const s = String(subject);
  if (/과학|물리|화학|생명|지구|환경|생태|세포|역학/.test(s)) return { style: "sidebar", palette: "forest" };
  if (/수학|미적분|기하|확률|대수|정보|인공지능|소프트웨어|프로그래밍/.test(s)) return { style: "bold", palette: "dark" };
  if (/국어|문학|화법|언어|독서|작문|역사|한국사|윤리|철학/.test(s)) return { style: "editorial", palette: "warm" };
  if (/미술|음악|예술|체육|영어|영미|일본어|중국어|프랑스어|스페인어|독일어/.test(s)) return { style: "board", palette: "berry" };
  return { style: "classic", palette: "navy" };
}

export function buildDeck(pptx, sp, meta = {}) {
  const rec = recommend(meta.subject);
  const ST = STYLES.find((x) => x.key === meta.style)?.key ?? rec.style;
  const P = PALETTES.find((x) => x.key === meta.palette) ?? PALETTES.find((x) => x.key === (STYLES.find((s) => s.key === ST)?.palette ?? rec.palette)) ?? PALETTES[0];
  const SANS = "맑은 고딕";
  const SERIF = ST === "editorial" ? "바탕" : SANS; // 에디토리얼만 제목을 명조로
  const W = 13.333, H = 7.5;
  const R = pptx.ShapeType;
  const plain = (t) => String(t ?? "").replace(/\*\*/g, "").replace(/\s*\/\/?/g, "").replace(/\s*[↗↘]/g, "").replace(/\s{2,}/g, " ").trim();
  const sentences = (t) => plain(t).split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean);
  const title = sp.deck_title || meta.title || "발표";
  const slides = (sp.slides ?? []).filter((s) => s.say || s.head);
  const subLine = [meta.subject, sp.minutes ? `발표 ${sp.minutes}분` : ""].filter(Boolean).join("  ·  ");
  const rect = (s, x, y, w, h, fill, line) => s.addShape(R.rect, { x, y, w, h, fill: fill ? { color: fill } : { type: "none" }, line: line ? { color: line, width: 1 } : { type: "none" } });
  const txt = (s, text, o) => s.addText(text, { fontFace: SANS, color: P.ink, ...o });

  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.theme = { headFontFace: SERIF, bodyFontFace: SANS };

  const total = slides.length + 3 + (sp.sources?.length ? 1 : 0);
  let page = 0;
  const contentBg = ST === "board" ? P.surface : P.bg;
  const center = ST === "editorial";
  const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"];

  /* ── 디자인마다 다른 부품 ── */
  // 바닥글
  const footer = (s) => {
    page++;
    const pg = `${page} / ${total}`;
    if (ST === "classic") {
      s.addShape(R.line, { x: 0.7, y: 6.95, w: W - 1.4, h: 0, line: { color: P.line, width: 0.75 } });
      txt(s, title, { x: 0.7, y: 7.0, w: 8, h: 0.35, fontSize: 11, color: P.sub });
      txt(s, pg, { x: W - 2.7, y: 7.0, w: 2, h: 0.35, fontSize: 11, color: P.sub, align: "right" });
    } else if (ST === "minimal") {
      txt(s, String(page).padStart(2, "0"), { x: W - 1.9, y: 6.85, w: 1.0, h: 0.4, fontSize: 14, color: P.sub, align: "right" });
    } else if (ST === "sidebar") {
      txt(s, pg, { x: W - 2.7, y: 7.0, w: 2, h: 0.35, fontSize: 11, color: P.sub, align: "right" });
    } else if (ST === "board") {
      txt(s, `${title}  ·  ${pg}`, { x: 0.7, y: 7.0, w: W - 1.4, h: 0.35, fontSize: 11, color: P.sub, align: "right" });
    } else if (ST === "bold") {
      rect(s, 0, H - 0.12, (W * page) / total, 0.12, P.accent); // 진행 막대
    } else {
      s.addShape(R.line, { x: 0.6, y: 7.05, w: W - 1.2, h: 0, line: { color: P.primary, width: 0.75 } });
      txt(s, `— ${page} —`, { x: 0, y: 7.08, w: W, h: 0.35, fontSize: 11, color: P.sub, align: "center" });
    }
  };
  // 제목 자리 → 내용 영역 { x, w, top, bottom }
  const header = (s, no, small, head) => {
    const n = no ? String(no).padStart(2, "0") : "";
    if (ST === "classic") {
      if (n) txt(s, n, { x: 0.7, y: 0.45, w: 0.8, h: 0.45, fontSize: 16, bold: true, color: P.accent });
      txt(s, small, { x: n ? 1.35 : 0.7, y: 0.45, w: 10, h: 0.45, fontSize: 16, color: P.sub });
      txt(s, head, { x: 0.7, y: 0.95, w: W - 1.4, h: 1.0, fontSize: 32, bold: true, color: P.title, valign: "middle", fit: "shrink" });
      rect(s, 0.7, 2.0, 0.9, 0.08, P.accent);
      return { x: 0.7, w: W - 1.4, top: 2.45, bottom: 6.7 };
    }
    if (ST === "minimal") {
      txt(s, `${n ? `${n}  —  ` : ""}${small}`, { x: 0.9, y: 0.55, w: 10, h: 0.4, fontSize: 14, color: P.sub, charSpacing: 1 });
      txt(s, head, { x: 0.9, y: 1.0, w: W - 1.8, h: 1.0, fontSize: 36, color: P.title, valign: "middle", fit: "shrink" });
      s.addShape(R.line, { x: 0.9, y: 2.15, w: W - 1.8, h: 0, line: { color: P.line, width: 1 } });
      return { x: 0.9, w: W - 1.8, top: 2.6, bottom: 6.6 };
    }
    if (ST === "sidebar") {
      rect(s, 0, 0, 3.3, H, P.primary);
      if (n) txt(s, n, { x: 0.5, y: 0.6, w: 2.4, h: 1.3, fontSize: 66, bold: true, color: P.accent });
      txt(s, small, { x: 0.5, y: 5.3, w: 2.4, h: 1.4, fontSize: 18, color: P.onPrimary, valign: "bottom" });
      txt(s, head, { x: 3.9, y: 0.6, w: W - 4.5, h: 1.2, fontSize: 30, bold: true, color: P.title, valign: "middle", fit: "shrink" });
      rect(s, 3.9, 1.9, 0.6, 0.07, P.accent);
      return { x: 3.9, w: W - 4.5, top: 2.35, bottom: 6.8 };
    }
    if (ST === "board") {
      rect(s, 0, 0, W, 1.75, P.primary);
      txt(s, `${n ? `${n}  ·  ` : ""}${small}`, { x: 0.7, y: 0.3, w: 10, h: 0.4, fontSize: 14, color: P.onPrimary, transparency: 25 });
      txt(s, head, { x: 0.7, y: 0.7, w: W - 1.4, h: 0.85, fontSize: 30, bold: true, color: P.onPrimary, valign: "middle", fit: "shrink" });
      return { x: 0.7, w: W - 1.4, top: 2.2, bottom: 6.75 };
    }
    if (ST === "bold") {
      if (n) txt(s, n, { x: W - 5.2, y: -0.6, w: 5.0, h: 3.4, fontSize: 200, bold: true, color: P.line, align: "right", valign: "top" });
      rect(s, 0.6, 0.75, 0.14, 1.25, P.accent);
      txt(s, small, { x: 0.95, y: 0.55, w: 8, h: 0.4, fontSize: 15, bold: true, color: P.accent });
      txt(s, head, { x: 0.95, y: 0.95, w: W - 5.6, h: 1.15, fontSize: 38, bold: true, color: P.title, valign: "middle", fit: "shrink" });
      return { x: 0.95, w: W - 1.65, top: 2.55, bottom: 6.9 };
    }
    // editorial — 가운데 정렬 · 명조 · 위 겹줄
    s.addShape(R.line, { x: 0.6, y: 0.35, w: W - 1.2, h: 0, line: { color: P.primary, width: 0.75 } });
    s.addShape(R.line, { x: 0.6, y: 0.42, w: W - 1.2, h: 0, line: { color: P.primary, width: 0.75 } });
    txt(s, `${n ? `${n}   ` : ""}${small}`, { x: 0, y: 0.65, w: W, h: 0.4, fontSize: 14, color: P.accent, align: "center", charSpacing: 2 });
    txt(s, head, { x: 1.2, y: 1.05, w: W - 2.4, h: 1.0, fontFace: SERIF, fontSize: 32, bold: true, color: P.title, align: "center", valign: "middle", fit: "shrink" });
    s.addShape(R.line, { x: W / 2 - 0.5, y: 2.15, w: 1.0, h: 0, line: { color: P.accent, width: 1.5 } });
    return { x: 1.2, w: W - 2.4, top: 2.55, bottom: 6.8 };
  };
  // 카드 바탕
  const card = (s, x, y, w, h, k = 0) => {
    if (ST === "minimal") return rect(s, x, y, w, h, null, P.box);
    if (ST === "board") return s.addShape(R.rect, { x, y, w, h, fill: { color: P.bg }, line: { type: "none" }, shadow: { type: "outer", blur: 6, offset: 2, angle: 90, color: "000000", opacity: 0.12 } });
    if (ST === "bold") { rect(s, x, y, w, h, P.surface); return rect(s, x, y, 0.08, h, k === 1 ? P.primary : P.accent); }
    if (ST === "editorial") return s.addShape(R.line, { x, y, w, h: 0, line: { color: P.accent, width: 2 } });
    return rect(s, x, y, w, h, P.surface);
  };
  // 번호 표시 (steps)
  const numMark = (s, x, y, k, small = false) => {
    const d = small ? 0.5 : 0.7;
    if (ST === "minimal") return txt(s, String(k + 1).padStart(2, "0"), { x, y: y - 0.1, w: 1.2, h: d + 0.2, fontSize: small ? 20 : 30, color: P.accent });
    if (ST === "bold") return txt(s, String(k + 1), { x, y: y - 0.35, w: 1.2, h: d + 0.6, fontSize: small ? 30 : 54, bold: true, color: P.accent });
    if (ST === "editorial") return txt(s, ROMAN[k] ?? String(k + 1), { x, y: y - 0.05, w: small ? 0.7 : 1.0, h: d + 0.1, fontFace: SERIF, fontSize: small ? 20 : 28, color: P.accent });
    s.addShape(R.ellipse, { x, y, w: d, h: d, fill: { color: P.accent }, line: { type: "none" } });
    return txt(s, String(k + 1), { x, y, w: d, h: d, fontSize: small ? 15 : 20, bold: true, color: P.onAccent, align: "center", valign: "middle" });
  };
  // 목록 표시 (bullets)
  const dot = (s, x, y) => {
    if (ST === "minimal") return s.addShape(R.line, { x, y: y + 0.3, w: 0.3, h: 0, line: { color: P.accent, width: 2 } });
    if (ST === "editorial") return s.addShape(R.diamond, { x: x + 0.02, y: y + 0.22, w: 0.16, h: 0.16, fill: { color: P.accent }, line: { type: "none" } });
    if (ST === "bold") return rect(s, x, y + 0.1, 0.1, 0.5, P.accent);
    return rect(s, x + 0.05, y + 0.2, 0.18, 0.18, P.accent);
  };
  const imageBox = (s, img, x, y, w, h) => {
    if (ST === "editorial") s.addShape(R.rect, { x, y, w, h, fill: { color: P.surface }, line: { color: P.primary, width: 0.75 } });
    else s.addShape(R.rect, { x, y, w, h, fill: { color: ST === "minimal" || ST === "board" ? P.bg : P.surface }, line: { color: P.box, width: 1, dashType: "dash" } });
    s.addText([
      { text: "사진 넣는 자리", options: { bold: true, fontSize: 20, color: P.sub, breakLine: true } },
      { text: img.what || "", options: { fontSize: 20, color: P.ink, breakLine: true } },
      { text: img.search ? `검색어: ${img.search}` : "", options: { fontSize: 15, color: P.sub } },
    ], { x: x + 0.3, y, w: w - 0.6, h, fontFace: SANS, align: "center", valign: "middle", paraSpaceAfter: 6 });
  };

  /* ── 1) 표지 ── */
  {
    const s = pptx.addSlide();
    if (ST === "classic") {
      s.background = { color: P.primary };
      rect(s, 0.9, 2.35, 1.1, 0.1, P.accent);
      txt(s, title, { x: 0.9, y: 2.6, w: W - 1.8, h: 1.6, fontSize: 44, bold: true, color: P.onPrimary, valign: "top", fit: "shrink" });
      txt(s, subLine, { x: 0.9, y: 4.3, w: 10, h: 0.5, fontSize: 20, color: P.onPrimary, transparency: 25 });
      txt(s, "이름  ____________", { x: 0.9, y: 6.2, w: 6, h: 0.5, fontSize: 18, color: P.onPrimary });
    } else if (ST === "minimal") {
      s.background = { color: P.bg };
      txt(s, subLine, { x: 0.9, y: 0.8, w: 10, h: 0.5, fontSize: 18, color: P.sub, charSpacing: 1 });
      txt(s, title, { x: 0.9, y: 2.3, w: W - 1.8, h: 2.3, fontSize: 56, color: P.title, valign: "middle", fit: "shrink" });
      rect(s, 0.9, 4.85, 0.9, 0.06, P.accent);
      txt(s, "이름  ____________", { x: 0.9, y: 6.2, w: 6, h: 0.5, fontSize: 18, color: P.sub });
    } else if (ST === "sidebar") {
      s.background = { color: P.bg };
      rect(s, 0, 0, 5.4, H, P.primary);
      txt(s, title, { x: 0.6, y: 1.6, w: 4.3, h: 3.4, fontSize: 40, bold: true, color: P.onPrimary, valign: "middle", fit: "shrink" });
      rect(s, 0.6, 5.2, 0.9, 0.08, P.accent);
      txt(s, subLine, { x: 6.1, y: 2.9, w: 6.5, h: 0.6, fontSize: 22, color: P.title, bold: true });
      txt(s, "이름  ____________", { x: 6.1, y: 3.7, w: 6, h: 0.6, fontSize: 20, color: P.sub });
    } else if (ST === "board") {
      s.background = { color: P.primary };
      s.addShape(R.rect, { x: 1.2, y: 1.2, w: W - 2.4, h: H - 2.4, fill: { color: P.bg }, line: { type: "none" }, shadow: { type: "outer", blur: 10, offset: 4, angle: 90, color: "000000", opacity: 0.25 } });
      txt(s, subLine, { x: 1.8, y: 1.8, w: W - 3.6, h: 0.5, fontSize: 18, color: P.accent, bold: true });
      txt(s, title, { x: 1.8, y: 2.5, w: W - 3.6, h: 2.0, fontSize: 44, bold: true, color: P.title, valign: "middle", fit: "shrink" });
      txt(s, "이름  ____________", { x: 1.8, y: 5.2, w: 6, h: 0.5, fontSize: 18, color: P.sub });
    } else if (ST === "bold") {
      s.background = { color: P.primary };
      txt(s, title, { x: 0.8, y: 1.2, w: W - 3.0, h: 3.6, fontSize: 60, bold: true, color: P.onPrimary, valign: "bottom", fit: "shrink" });
      rect(s, 0.8, 5.0, 3.5, 0.16, P.accent);
      txt(s, subLine, { x: 0.8, y: 5.35, w: 8, h: 0.5, fontSize: 20, color: P.onPrimary, transparency: 30 });
      txt(s, "이름  ____________", { x: 0.8, y: 6.3, w: 6, h: 0.5, fontSize: 18, color: P.onPrimary });
      rect(s, W - 1.6, 0, 1.6, 1.6, P.accent);
    } else {
      s.background = { color: P.bg };
      for (const y of [0.6, 0.68, H - 0.68, H - 0.6]) s.addShape(R.line, { x: 0.8, y, w: W - 1.6, h: 0, line: { color: P.primary, width: 0.75 } });
      txt(s, subLine, { x: 0, y: 1.5, w: W, h: 0.5, fontSize: 16, color: P.accent, align: "center", charSpacing: 3 });
      txt(s, title, { x: 1.2, y: 2.3, w: W - 2.4, h: 2.4, fontFace: SERIF, fontSize: 48, bold: true, color: P.title, align: "center", valign: "middle", fit: "shrink" });
      s.addShape(R.line, { x: W / 2 - 0.6, y: 4.95, w: 1.2, h: 0, line: { color: P.accent, width: 1.5 } });
      txt(s, "이름  ____________", { x: 0, y: 5.4, w: W, h: 0.5, fontSize: 18, color: P.sub, align: "center" });
    }
    page++;
    s.addNotes(`[표지] 인사하고 이름 · 발표 제목을 말한다. 시선 Z자로 교실 전체를 한 번 훑는다.`);
  }

  /* ── 2) 목차 ── */
  {
    const s = pptx.addSlide();
    s.background = { color: contentBg };
    const a = header(s, 0, "CONTENTS", "목차");
    const n = slides.length, rowH = Math.min(0.85, (a.bottom - a.top) / Math.max(n, 1));
    slides.forEach((x, i) => {
      const y = a.top + i * rowH;
      const tx = center ? a.x + 2.0 : a.x;
      txt(s, center ? ROMAN[i] ?? String(i + 1) : String(i + 1).padStart(2, "0"), { x: tx, y, w: 1.0, h: rowH, fontFace: SERIF, fontSize: ST === "bold" ? 30 : 24, bold: ST !== "minimal" && !center, color: P.accent, valign: "middle" });
      txt(s, plain(x.title), { x: tx + 1.1, y, w: a.w - 1.2 - (center ? 4 : 0), h: rowH, fontSize: 24, valign: "middle" });
      if (ST === "minimal") s.addShape(R.line, { x: a.x, y: y + rowH, w: a.w, h: 0, line: { color: P.line, width: 0.75 } });
    });
    footer(s);
  }

  /* ── 3) 대본 슬라이드 ── */
  slides.forEach((x, i) => {
    const s = pptx.addSlide();
    s.background = { color: contentBg };
    const head = plain(x.head) || sentences(x.say)[0] || plain(x.title);
    const a = header(s, i + 1, plain(x.title), head);
    let items = (x.items ?? []).filter((it) => it.label || it.text);
    let layout = x.layout || "bullets";
    if (layout === "big" && !x.big?.value) layout = "bullets";
    if (layout === "compare" && items.length < 2) layout = "bullets";
    if ((layout === "bullets" || layout === "steps") && !items.length) {
      items = sentences(x.say).filter((t) => t !== head).slice(0, 3).map((t) => ({ label: "", text: t })); // 예전 대본 · 빈 칸 대비
    }
    const img = x.image?.what ? x.image : null;
    const { top, bottom } = a;
    const sideImg = img && layout !== "compare";
    const iw = ST === "sidebar" ? 3.4 : 4.4;
    const cw = sideImg ? a.w - iw - 0.4 : a.w;
    const cx = a.x;
    if (sideImg) imageBox(s, img, cx + cw + 0.4, top, iw, bottom - top);
    const al = center && !sideImg ? "center" : "left";

    if (layout === "big") {
      txt(s, x.big.value, { x: cx, y: top, w: cw, h: 2.3, fontFace: SERIF, fontSize: ST === "bold" ? 110 : 88, bold: true, color: ST === "bold" ? P.title : P.accent, valign: "bottom", align: al, fit: "shrink" });
      if (ST === "bold") rect(s, cx, top + 2.4, 2.2, 0.12, P.accent);
      txt(s, x.big.caption || "", { x: cx, y: top + 2.65, w: cw, h: 0.9, fontSize: 26, valign: "top", align: al });
      if (items[0]) txt(s, `${items[0].label ? `${items[0].label}  ` : ""}${items[0].text}`, { x: cx, y: top + 3.55, w: cw, h: 0.6, fontSize: 18, color: P.sub, align: al });
    } else if (layout === "compare") {
      const gap = 0.5, cardW = (a.w - gap) / 2, cardH = img ? 3.0 : 3.4;
      items.slice(0, 2).forEach((it, k) => {
        const bx = cx + k * (cardW + gap);
        const c = k === 0 ? P.primary : P.accent;
        const onc = k === 0 ? P.onPrimary : P.onAccent;
        if (ST === "classic" || ST === "sidebar") {
          rect(s, bx, top, cardW, 0.8, c);
          txt(s, it.label || (k ? "B" : "A"), { x: bx + 0.3, y: top, w: cardW - 0.6, h: 0.8, fontSize: 24, bold: true, color: onc, valign: "middle" });
          rect(s, bx, top + 0.8, cardW, cardH - 0.8, k === 0 ? P.surface : P.soft);
          txt(s, it.text, { x: bx + 0.3, y: top + 1.0, w: cardW - 0.6, h: cardH - 1.2, fontSize: 24, valign: "top" });
        } else if (ST === "bold") {
          rect(s, bx, top, cardW, cardH, k === 0 ? P.surface : P.accent);
          txt(s, it.label || (k ? "B" : "A"), { x: bx + 0.4, y: top + 0.3, w: cardW - 0.8, h: 0.8, fontSize: 28, bold: true, color: k === 0 ? P.accent : P.onAccent });
          txt(s, it.text, { x: bx + 0.4, y: top + 1.2, w: cardW - 0.8, h: cardH - 1.4, fontSize: 24, color: k === 0 ? P.ink : P.onAccent, valign: "top" });
        } else if (ST === "editorial") {
          if (k === 1) s.addShape(R.line, { x: cx + cardW + gap / 2, y: top, w: 0, h: cardH, line: { color: P.primary, width: 0.75 } });
          txt(s, it.label || (k ? "B" : "A"), { x: bx, y: top + 0.1, w: cardW, h: 0.8, fontFace: SERIF, fontSize: 26, bold: true, color: k ? P.accent : P.title, align: "center" });
          txt(s, it.text, { x: bx + 0.4, y: top + 1.0, w: cardW - 0.8, h: cardH - 1.1, fontSize: 22, align: "center", valign: "top" });
        } else {
          card(s, bx, top, cardW, cardH, k);
          txt(s, it.label || (k ? "B" : "A"), { x: bx + 0.4, y: top + 0.3, w: cardW - 0.8, h: 0.7, fontSize: 26, bold: true, color: k === 0 ? P.title : P.accent });
          if (ST === "minimal") s.addShape(R.line, { x: bx + 0.4, y: top + 1.05, w: 0.6, h: 0, line: { color: P.accent, width: 2 } });
          txt(s, it.text, { x: bx + 0.4, y: top + 1.25, w: cardW - 0.8, h: cardH - 1.5, fontSize: 22, valign: "top" });
        }
      });
      if (img) txt(s, `사진 넣는 자리: ${img.what}${img.search ? `  (검색어: ${img.search})` : ""}`, { x: cx, y: top + cardH + 0.25, w: a.w, h: 0.75, fontSize: 18, color: P.sub, fill: { color: ST === "board" ? P.bg : P.surface }, margin: 12, align: al });
    } else if (layout === "quote") {
      const q = items[0] ?? { label: "", text: sentences(x.say)[1] || head };
      if (ST === "bold") {
        rect(s, cx, top, cw, bottom - top - 0.3, P.accent);
        txt(s, q.text, { x: cx + 0.6, y: top + 0.4, w: cw - 1.2, h: 2.6, fontSize: 36, bold: true, color: P.onAccent, valign: "middle" });
        if (q.label) txt(s, `— ${q.label}`, { x: cx + 0.6, y: top + 3.1, w: cw - 1.2, h: 0.6, fontSize: 20, color: P.onAccent });
      } else if (ST === "editorial") {
        txt(s, "“", { x: 0, y: top - 0.1, w: W, h: 1.2, fontFace: "Georgia", fontSize: 100, color: P.accent, align: "center" });
        txt(s, q.text, { x: cx + 0.8, y: top + 1.0, w: a.w - 1.6, h: 2.0, fontFace: SERIF, fontSize: 32, bold: true, color: P.title, align: "center", valign: "middle" });
        if (q.label) txt(s, `— ${q.label}`, { x: cx, y: top + 3.15, w: a.w, h: 0.6, fontSize: 20, color: P.sub, align: "center" });
      } else {
        if (ST === "minimal") rect(s, cx, top + 0.4, 0.08, 2.6, P.accent);
        else txt(s, "“", { x: cx, y: top + 0.1, w: 1.2, h: 1.2, fontFace: "Georgia", fontSize: 110, bold: true, color: P.accent });
        txt(s, q.text, { x: cx + 0.9, y: top + 0.9, w: cw - 1.1, h: 2.1, fontSize: 34, color: P.title, bold: ST !== "minimal", valign: "middle" });
        if (q.label) txt(s, `— ${q.label}`, { x: cx + 0.9, y: top + 3.1, w: cw - 1.1, h: 0.6, fontSize: 22, color: P.sub });
      }
    } else if (layout === "steps" && !sideImg) {
      const n = Math.min(items.length, 4), gap = 0.35, bw = (a.w - gap * (n - 1)) / n, bh = 3.7;
      items.slice(0, 4).forEach((it, k) => {
        const bx = cx + k * (bw + gap);
        card(s, bx, top, bw, bh, k);
        const pad = ST === "editorial" ? 0 : 0.3;
        numMark(s, bx + pad, top + 0.35, k);
        txt(s, it.label, { x: bx + pad, y: top + 1.3, w: bw - pad * 2, h: 0.7, fontFace: SERIF, fontSize: 26, bold: true, color: P.title });
        txt(s, it.text, { x: bx + pad, y: top + 2.05, w: bw - pad * 2, h: 1.5, fontSize: 20, valign: "top" });
      });
    } else {
      // bullets (사진이 있는 steps 도 세로 목록으로)
      const n = Math.max(items.length, 1), rowH = Math.min(1.35, (bottom - top) / n);
      items.forEach((it, k) => {
        const y = top + k * rowH;
        if (layout === "steps") numMark(s, cx, y + 0.1, k, true);
        else dot(s, cx, y);
        if (ST === "minimal" && k < n - 1) s.addShape(R.line, { x: cx + 0.7, y: y + rowH - 0.12, w: cw - 0.7, h: 0, line: { color: P.line, width: 0.75 } });
        const runs = [];
        if (it.label) runs.push({ text: it.label, options: { bold: true, color: ST === "bold" ? P.accent : P.title, fontSize: 26, breakLine: true } });
        runs.push({ text: it.text, options: { color: P.ink, fontSize: it.label ? 20 : 24 } });
        s.addText(runs, { x: cx + 0.7, y, w: cw - 0.7, h: rowH - 0.1, fontFace: SANS, valign: "top", paraSpaceAfter: 4 });
      });
    }
    footer(s);
    const how = [x.pace ? `빠르기: ${x.pace}${x.pace_why ? ` (${x.pace_why})` : ""}` : "", x.gaze ? `시선: ${x.gaze}` : ""].filter(Boolean).join(" · ");
    s.addNotes(`${how}\n표시: / 짧게 멈춤 · // 길게 멈춤 · ↗ 상승조 · ↘ 하강조 · **굵게** 힘주어\n\n${String(x.say ?? "").trim()}`);
  });

  /* ── 4) 참고 자료 ── */
  if (sp.sources?.length) {
    const s = pptx.addSlide();
    s.background = { color: contentBg };
    const a = header(s, 0, "REFERENCES", "참고 자료");
    s.addText(sp.sources.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), { x: a.x, y: a.top, w: a.w, h: a.bottom - a.top, fontFace: SANS, fontSize: 18, color: P.ink, valign: "top", paraSpaceAfter: 10 });
    footer(s);
  }

  /* ── 5) 마무리 — 발표 뒤 질문 받기 ── */
  {
    const s = pptx.addSlide();
    const light = ST === "minimal" || ST === "editorial";
    s.background = { color: light ? P.bg : P.primary };
    const fg = light ? P.title : P.onPrimary;
    if (ST === "editorial") {
      for (const y of [0.6, 0.68, H - 0.68, H - 0.6]) s.addShape(R.line, { x: 0.8, y, w: W - 1.6, h: 0, line: { color: P.primary, width: 0.75 } });
      txt(s, "감사합니다", { x: 0, y: 2.6, w: W, h: 1.2, fontFace: SERIF, fontSize: 48, bold: true, color: fg, align: "center" });
      txt(s, "질문 있으신가요?", { x: 0, y: 4.0, w: W, h: 0.7, fontSize: 22, color: P.sub, align: "center" });
    } else {
      if (ST === "sidebar") rect(s, W - 0.5, 0, 0.5, H, P.accent);
      if (ST === "bold") rect(s, W - 1.6, H - 1.6, 1.6, 1.6, P.accent);
      txt(s, "감사합니다", { x: 0.9, y: 2.6, w: W - 1.8, h: 1.2, fontSize: ST === "bold" ? 60 : 48, bold: ST !== "minimal", color: fg });
      rect(s, 0.9, 3.9, 1.1, 0.1, P.accent);
      txt(s, "질문 있으신가요?", { x: 0.9, y: 4.2, w: 10, h: 0.7, fontSize: 24, color: light ? P.sub : fg, transparency: light ? 0 : 25 });
    }
    page++;
    const qs = (sp.questions ?? []).map((q) => `- ${q.q} → ${q.tip}`).join("\n");
    s.addNotes(`마지막 문장은 하강조로 끝내고 2초 쉰 뒤 '감사합니다'. 시선 정면.\n${qs ? `\n예상 질문\n${qs}` : ""}`);
  }
  return pptx;
}