import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import StepBar from "./StepBar";
import Paywall from "./Paywall";
import { isFreeInquiry } from "./freeInquiry";
import { useStay } from "./useStay";
import InquirySwitcher from "./InquirySwitcher";
import { A4, TEMPLATES, renderPages, emptyVoices } from "./templates";

/*
 * 보고서 디자인 — /inquiry/:id/report
 * ① 선생님 형식 / 자유형 고르기 → ② 보고서 내용 만들기(AI) → ③ (자유형) 디자인 고르기 → ④ 편집(4장) → PDF 저장
 * 선생님 형식은 조건을 먼저 받고 그 조건에 맞춰 내용을 만든다
 * 내용(report)과 디자인(template)은 따로 저장 — 디자인을 바꿔도 내용은 그대로
 */

const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Black+Han+Sans&family=Nanum+Myeongjo:wght@400;700;800&family=Gaegu:wght@400;700&family=Do+Hyeon&family=Jua&family=Gowun+Dodum&family=Nanum+Pen+Script&family=IBM+Plex+Sans+KR:wght@400;700&display=swap";


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

/*
 * 한 장에 맞추기 — 내용이 A4보다 길면 그 장 전체를 넘친 만큼만 줄인다
 * 줄인 비율 k로 '더 큰 가상 종이'(794/k × 1123/k)에 다시 그린 뒤 k배로 줄여서 A4에 딱 맞춘다
 * 글자·표·그림이 같은 비율로 줄어 디자인이 깨지지 않는다. 최소 70%까지만
 */
const MIN_FIT = 0.7;
function fitSheet(el) {
  let k = 1;
  for (let i = 0; i < 6; i++) {
    el.style.width = `${A4.w / k}px`;
    el.style.height = `${A4.h / k}px`;
    el.style.transform = `scale(${k})`;
    const need = el.scrollHeight, have = el.clientHeight;
    if (need <= have + 1) break;
    const next = Math.max(MIN_FIT, k * (have / need) * 0.995);
    if (next === k) break;
    k = next;
  }
  return k;
}

/* 글씨체·색 고르기 */
const FONT_CHOICES = [
  ["", "디자인 그대로"],
  ["'Noto Sans KR',sans-serif", "본고딕 (깔끔)"],
  ["'IBM Plex Sans KR',sans-serif", "플렉스 (단정)"],
  ["'Gowun Dodum',sans-serif", "고운돋움 (부드러움)"],
  ["'Nanum Myeongjo',serif", "나눔명조 (보고서)"],
  ["'Black Han Sans',sans-serif", "검은고딕 (굵은 제목)"],
  ["'Do Hyeon',sans-serif", "도현 (포스터)"],
  ["'Jua',sans-serif", "주아 (귀여움)"],
  ["'Gaegu',sans-serif", "개구 (손글씨)"],
  ["'Nanum Pen Script',cursive", "나눔펜 (필기)"],
];
const SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56];
const INK = ["#111827", "#1F2640", "#374151", "#6B7280", "#DC2626", "#EA580C", "#CA8A04", "#16A34A", "#0891B2", "#2563EB", "#7C3AED", "#DB2777"];
const PAPER = ["transparent", "#FFFFFF", "#F3F4F6", "#FEF2F2", "#FFF7ED", "#FEF9C3", "#ECFDF5", "#ECFEFF", "#EFF6FF", "#F5F3FF", "#FDF2F8", "#111827"];

/* 고른 상자 모양 바꾸기 → 그 상자와 안쪽 글자 전부에 적용되는 규칙 */
function styleRules(scope, styles, pageFont) {
  const q = (k) => `.${scope} [data-bk="${k}"]`;
  let css = pageFont ? `.${scope}, .${scope} * { font-family: ${pageFont} !important; }` : "";
  Object.entries(styles ?? {}).forEach(([k, st]) => {
    if (st.color) css += `${q(k)}, ${q(k)} * { color: ${st.color} !important; } ${q(k)} svg text { fill: ${st.color} !important; }`;
    if (st.bg) css += `${q(k)} { background: ${st.bg} !important; ${st.bg === "transparent" ? "box-shadow: none !important;" : ""} }`;
    if (st.font) css += `${q(k)}, ${q(k)} * { font-family: ${st.font} !important; }`;
    if (st.size) css += `${q(k)}, ${q(k)} *:not(svg):not(svg *) { font-size: ${st.size}px !important; line-height: 1.45 !important; } ${q(k)} svg text { font-size: ${Math.round(st.size * 0.85)}px !important; }`;
    if (st.zoom && st.zoom !== 1) css += `${q(k)} { zoom: ${st.zoom}; }`;
    // 모서리를 끌어서 바꾼 크기 — 사진 칸은 가로·세로 그대로, 글 상자는 가로 + 최소 높이
    if (st.w) css += `${q(k)} { width: ${st.w}px !important; max-width: none !important; flex: none !important; }`;
    if (st.h) css += st.photo
      ? `${q(k)} { height: ${st.h}px !important; max-height: none !important; } ${q(k)} img { width: 100% !important; height: 100% !important; object-fit: cover; }`
      : `${q(k)} { min-height: ${st.h}px !important; }`;
  });
  return css ? `<style>${css}</style>` : "";
}

/*
 * 옮길 수 있는 덩어리 찾기 — 종이 전체를 덮는 틀은 안으로 들어가고, 그 안의 상자·문장·표·사진 칸을 덩어리로 본다
 * 덩어리마다 위치 번호(data-bk, 예: "0-2-3")를 붙여서 옮긴 자리를 기억한다
 */
function markBlocks(root) {
  const base = root.getBoundingClientRect();
  const W = base.width, H = base.height;
  // 색·테두리·그림자가 있는 상자는 한 덩어리로, 없는 묶음은 안쪽으로
  const painted = (el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    return (bg && bg !== "transparent" && !/rgba\(0, 0, 0, 0\)/.test(bg)) || cs.backgroundImage !== "none" || cs.boxShadow !== "none" || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
  };
  // 모양 규칙(<style>)은 세지 않는다 — 색을 바꿔도 덩어리 번호가 밀리지 않게
  const walk = (el, key, depth) => {
    [...el.children].filter((c) => c.tagName !== "STYLE").forEach((ch, i) => {
      const k = key ? `${key}-${i}` : String(i);
      const r = ch.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const wide = r.width >= W * 0.9, tall = r.height >= H * 0.45, full = wide && r.height >= H * 0.9;
      if (full && ch.children.length === 0) return; // 바탕 무늬·배경 면은 옮기지 않는다
      if (depth < 4 && ch.children.length >= 2 && ((wide && tall) || (tall && !painted(ch)))) return walk(ch, k, depth + 1);
      ch.setAttribute("data-bk", k);
    });
  };
  root.querySelectorAll("[data-bk]").forEach((n) => n.removeAttribute("data-bk"));
  // 학생이 복사·추가한 상자는 이름표를 따로 (ex-아이디)
  const extras = [...root.querySelectorAll(":scope > [data-ex]")];
  extras.forEach((n) => n.remove());
  walk(root, "", 0);
  // 덩어리 안에 따로 떠 있는 장식(따옴표·도장·테이프·스티커)도 따로 옮길 수 있게
  root.querySelectorAll("[data-bk]").forEach((blk) => {
    const key = blk.getAttribute("data-bk");
    let n = 0;
    blk.querySelectorAll("*").forEach((d) => {
      if (d.hasAttribute("data-bk")) return;
      const cs = getComputedStyle(d);
      if (cs.position !== "absolute") return;
      const r = d.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || (r.width >= W * 0.9 && r.height >= H * 0.9)) return;
      d.setAttribute("data-bk", `${key}-d${n++}`);
    });
  });
  extras.forEach((n) => {
    n.setAttribute("data-bk", `ex-${n.getAttribute("data-ex")}`);
    root.appendChild(n);
  });
}

/* 학생이 쓴 글 상자 — 위험한 것(스크립트·on 속성) 빼고 저장 */
function cleanHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script,iframe,object,embed,link,style").forEach((n) => n.remove());
  t.content.querySelectorAll("*").forEach((n) =>
    [...n.attributes].forEach((a) => (/^on/i.test(a.name) || /javascript:/i.test(a.value)) && n.removeAttribute(a.name))
  );
  return t.innerHTML;
}

/* A4 한 장 — 비율대로 줄여서 보여준다
 * offsets: 옮긴 자리 { 덩어리: [x, y] } · extras: 학생이 복사·추가한 상자 · hidden: 숨긴 덩어리
 * movable: 옮기기 켜짐 · selected: 고른 덩어리 · onSelect(정보) · onMove(덩어리, [x, y]) · onEditExtra(아이디, html)
 */
function Sheet({ page, scale = 1, onFit, offsets, extras, hidden, styles, texts, pageFont, movable = false, selected, selectedKeys = [], selBox, toolbar, onSelect, onMove, onEditExtra, onEditText, onResize }) {
  const inner = useRef(null);
  const scope = useRef(`sh${Math.random().toString(36).slice(2, 8)}`).current; // 이 장에만 적용되는 이름
  const kRef = useRef(1);
  const [kNow, setKNow] = useState(1); // 도구막대 자리 계산용

  // 페이지 + 학생이 추가한 상자
  const html = useMemo(
    () =>
      styleRules(scope, styles, pageFont) +
      page.html +
      (extras ?? [])
        .map((x) => `<div data-ex="${x.id}" style="position:absolute;left:${x.x}px;top:${x.y}px;width:${x.w}px;z-index:5">${x.html}</div>`)
        .join(""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.html, extras, JSON.stringify(styles ?? {}), pageFont]
  );

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const run = () => {
      el.style.width = `${A4.w}px`;
      el.style.height = `${A4.h}px`;
      el.style.transform = "none";
      markBlocks(el);
      // 두 번 클릭해서 고친 글 — 그 상자의 내용을 학생이 고친 글로 바꾸고, 안쪽 장식 번호를 다시 붙인다
      const edited = Object.entries(texts ?? {});
      if (edited.length) {
        edited.forEach(([key, h]) => {
          const n = el.querySelector(`[data-bk="${key}"]`);
          if (n && n.innerHTML !== h) n.innerHTML = h;
        });
        markBlocks(el);
      }
      el.querySelectorAll("[data-bk]").forEach((n) => {
        const key = n.getAttribute("data-bk");
        const o = offsets?.[key];
        n.style.translate = o ? `${o[0]}px ${o[1]}px` : "";
        n.style.visibility = hidden?.includes(key) ? "hidden" : "";
        n.classList.toggle("bk-sel", movable && (key === selected || selectedKeys.includes(key)));
      });
      const k = fitSheet(el);
      kRef.current = k;
      setKNow(k);
      onFit?.(k);
    };
    run();
    document.fonts?.ready?.then(run);
    [...el.querySelectorAll("img")].filter((i) => !i.complete).forEach((i) => i.addEventListener("load", run, { once: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, JSON.stringify(offsets ?? {}), JSON.stringify(hidden ?? []), JSON.stringify(texts ?? {}), selected, JSON.stringify(selectedKeys), movable]);

  // 끌어서 옮기기 · 한 번 클릭하면 고르기 · Shift+클릭하면 여러 개 고르기
  // 여러 개를 고른 상태에서 그중 하나를 끌면 고른 상자가 함께 움직인다
  function onPointerDown(e) {
    if (!movable) return;
    if (e.target.closest('[contenteditable="true"]')) return; // 글 쓰는 중
    const shift = e.shiftKey;
    const blk = e.target.closest("[data-bk]");
    if (!blk || !inner.current.contains(blk)) return shift ? undefined : onSelect?.(null);
    e.preventDefault();
    const key = blk.getAttribute("data-bk");
    const group = !shift && selectedKeys.length > 1 && selectedKeys.includes(key) ? selectedKeys : [key];
    const items = group
      .map((k) => [k, inner.current.querySelector(`[data-bk="${k}"]`), offsets?.[k] ?? [0, 0]])
      .filter(([, n]) => n);
    const sx = e.clientX, sy = e.clientY;
    const ratio = scale * kRef.current; // 화면 1px = 종이 몇 px
    let d = [0, 0], moved = false;
    items.forEach(([, n]) => n.classList.add("bk-drag"));
    const move = (ev) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
      d = [Math.round((ev.clientX - sx) / ratio), Math.round((ev.clientY - sy) / ratio)];
      if (moved) items.forEach(([, n, s]) => (n.style.translate = `${s[0] + d[0]}px ${s[1] + d[1]}px`));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      items.forEach(([, n]) => n.classList.remove("bk-drag"));
      if (moved) onMove?.(items.map(([k, , s]) => [k, [s[0] + d[0], s[1] + d[1]]]), d);
      if (moved && items.length > 1) return; // 여러 개를 함께 옮겼으면 고른 상태 그대로
      // 고른 덩어리 정보 (복사할 때 쓴다): 종이 위 자리·너비·모양
      const base = inner.current.getBoundingClientRect(), r = blk.getBoundingClientRect();
      const clone = blk.cloneNode(true);
      clone.removeAttribute("data-bk");
      clone.removeAttribute("data-ex");
      clone.classList.remove("bk-sel", "bk-drag");
      clone.style.translate = "";
      clone.style.visibility = "";
      if (!key.startsWith("ex-")) {
        // 원래 자리의 크기 규칙(비율 너비·flex)을 빼고, 복사본 상자 너비에 꽉 차게
        clone.style.position = "relative";
        clone.style.inset = "auto";
        clone.style.width = "100%";
        clone.style.maxWidth = "none";
        clone.style.flex = "none";
        clone.style.margin = "0";
        clone.style.transform = clone.style.transform?.includes("rotate") ? clone.style.transform : "";
      }
      onSelect?.({
        key,
        x: Math.round((r.left - base.left) / ratio),
        y: Math.round((r.top - base.top) / ratio),
        w: Math.round(r.width / ratio),
        h: Math.round(r.height / ratio),
        html: key.startsWith("ex-") ? blk.innerHTML : clone.outerHTML,
      }, { shift });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // 고른 상자 오른쪽 아래 모서리를 끌어서 크기 바꾸기 (사진 칸은 가로·세로 모두, 글 상자는 가로 + 높이)
  function onResizeDown(e) {
    if (!movable || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    const blk = inner.current?.querySelector(`[data-bk="${selected}"]`);
    if (!blk) return;
    const ratio = scale * kRef.current;
    const r0 = blk.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(blk).zoom) || 1; // '상자 크기'로 키운 만큼은 빼고 계산
    const w0 = r0.width / ratio / zoom, h0 = r0.height / ratio / zoom;
    // 사진 칸 = 칸 자체가 사진이거나, 사진이 들어 있고 글은 거의 없는 칸 (글+사진 섞인 큰 덩어리는 글 상자로 본다)
    const photo = Boolean(
      blk.matches(".slot-photo, img") || (blk.querySelector("img, .slot-photo") && (blk.textContent ?? "").trim().length < 40)
    );
    const sx = e.clientX, sy = e.clientY;
    let w = w0, h = h0;
    const move = (ev) => {
      w = Math.max(40, Math.round(w0 + (ev.clientX - sx) / ratio / zoom));
      h = Math.max(24, Math.round(h0 + (ev.clientY - sy) / ratio / zoom));
      blk.style.setProperty("width", `${w}px`, "important");
      blk.style.setProperty("max-width", "none", "important");
      blk.style.setProperty("flex", "none", "important");
      blk.style.setProperty(photo ? "height" : "min-height", `${h}px`, "important");
      if (photo) blk.style.setProperty("max-height", "none", "important");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResize?.(selected, { w, h, photo }, { w: Math.round(w * zoom), h: Math.round(h * zoom) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // 상자를 두 번 클릭하면 글 고치기 — 복사·추가한 상자도, 디자인에 원래 있던 상자도
  function onDoubleClick(e) {
    if (!movable) return;
    const ex = e.target.closest("[data-ex]");
    const blk = ex ?? e.target.closest("[data-bk]");
    if (!blk || !inner.current.contains(blk)) return;
    // 사진만 있는 칸은 글이 없으니 고치지 않는다 (사진은 오른쪽 '사진 올리기'로)
    if (!ex && !(blk.textContent ?? "").trim()) return;
    const key = blk.getAttribute("data-bk");
    blk.contentEditable = "true";
    blk.focus();
    // 두 번 클릭한 자리에 글자 커서를 둔다
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (range) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const done = () => {
      blk.contentEditable = "false";
      if (ex) return onEditExtra?.(ex.getAttribute("data-ex"), cleanHtml(ex.innerHTML));
      // 안쪽 장식 번호·선택 표시·옮긴 자리는 빼고 글만 저장
      const c = blk.cloneNode(true);
      c.querySelectorAll("[data-bk]").forEach((n) => {
        n.removeAttribute("data-bk");
        n.classList.remove("bk-sel", "bk-drag");
        n.style.translate = "";
        n.style.visibility = "";
      });
      onEditText?.(key, cleanHtml(c.innerHTML));
    };
    blk.addEventListener("blur", done, { once: true });
  }

  const r = scale * kNow;
  return (
    <div style={{ width: A4.w * scale, height: A4.h * scale, flexShrink: 0, overflow: "hidden", position: "relative" }}>
      {movable && selBox && toolbar && (
        <div
          data-keep-select
          style={{ position: "absolute", zIndex: 20, left: Math.max(4, selBox.x * r), top: Math.max(4, selBox.y * r - 40) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {toolbar}
        </div>
      )}
      {movable && selBox?.h > 0 && onResize && (
        <div
          data-keep-select
          title="끌어서 크기 바꾸기"
          onPointerDown={onResizeDown}
          style={{ position: "absolute", zIndex: 21, left: (selBox.x + selBox.w) * r - 9, top: (selBox.y + selBox.h) * r - 9, touchAction: "none" }}
          className="h-[18px] w-[18px] cursor-nwse-resize rounded-[4px] border-2 border-white bg-indigo-600 shadow-md"
        />
      )}
      <div
        className={`a4-sheet${movable ? " a4-movable" : ""}`}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        style={{ width: A4.w, height: A4.h, position: "relative", overflow: "hidden", background: page.bg, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <div
          ref={inner}
          className={scope}
          style={{ position: "absolute", top: 0, left: 0, width: A4.w, height: A4.h, transformOrigin: "top left", fontFamily: "'Noto Sans KR', sans-serif", color: "#1F2640" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

/*
 * 사진 → 긴 변 1600px JPEG 파일로 줄인다 (A4 한 칸에 선명한 크기)
 * 줄인 파일은 Supabase Storage(report-photos)에 올리고, 보고서에는 파일 위치만 적는다
 * 아이폰 HEIC처럼 브라우저가 못 여는 형식이면 이유를 알려준다
 */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
      return reject(new Error("아이폰 HEIC 사진은 PC에서 열 수 없어요. 폰에서 바로 올리거나, JPG로 바꿔서 올려 주세요."));
    }
    if (!file.type.startsWith("image/")) return reject(new Error("사진 파일(JPG·PNG)만 올릴 수 있어요."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; // 투명 PNG가 검게 나오지 않게
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("사진을 줄이지 못했어요."))), "image/jpeg", 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이 사진을 열지 못했어요. JPG나 PNG로 다시 올려 주세요."));
    };
    img.src = url;
  });
}

/* 장마다 고칠 칸 */
const FIELDS = {
  0: [
    ["title", "제목", "input"],
    ["question", "출발 질문", "input"],
    ["memory.l1", "기억 문장 첫 줄", "input"],
    ["memory.l2", "기억 문장 둘째 줄", "input"],
    ["results.finding", "핵심 발견", "area"],
    ["mine", "내 생각 (1장 '생각' 칸에도 들어가요)", "area"],
    ["photos.p1", "1장 사진", "photo"],
    // 사진이 여러 장 들어가는 디자인만
    ["photos.p1b", "1장 사진 2", "photo", ["case3", "obs5"]],
    ["photos.p1c", "1장 사진 3", "photo", ["case3", "obs5"]],
  ],
  1: [
    ["motive.text", "탐구 계기 · 내가 쓸 곳", "area"],
    ["question", "출발 질문", "input"],
  ],
  2: [
    ["method.summary", "방법 요약", "area"],
    ["difficulty.text", "어려웠던 점과 해결 · 내가 쓸 곳", "area"],
    ["photos.p3", "과정 사진", "photo"],
  ],
  3: [
    ["results.text", "결과", "area"],
    ["interpretation", "해석", "area"],
    ["mine", "내 생각", "area"],
    ["limits", "한계", "area"],
    ["next", "다음 질문", "input"],
    ["career.text", "진로와의 연결 · 내가 쓸 곳", "area"],
  ],
};
/* 학교 양식은 쪽마다 들어가는 내용이 달라서 칸 목록도 따로 */
const SCHOOL_FIELDS = {
  0: [
    ["title", "제목", "input"],
    ["motive.text", "Ⅰ. 탐구 계기 · 내가 쓸 곳", "area"],
    ["question", "출발 질문", "input"],
    ["memory.l1", "Ⅱ. 핵심 발견 — 기억 문장 첫 줄", "input"],
    ["memory.l2", "Ⅱ. 핵심 발견 — 기억 문장 둘째 줄", "input"],
    ["results.finding", "핵심 발견 설명", "area"],
    ["photos.p1", "1쪽 사진 (그림 1)", "photo"],
  ],
  1: [
    ["method.summary", "Ⅳ. 탐구 방법 요약", "area"],
    ["photos.p3", "과정 사진 (그림 2)", "photo"],
    ["difficulty.text", "Ⅴ. 어려웠던 점과 해결 · 내가 쓸 곳", "area"],
  ],
  2: [
    ["results.text", "Ⅵ. 결과", "area"],
    ["interpretation", "Ⅶ. 해석", "area"],
    ["mine", "Ⅶ. 내 생각", "area"],
  ],
  3: [
    ["limits", "Ⅷ. 한계", "area"],
    ["next", "Ⅷ. 다음 질문", "input"],
    ["career.text", "Ⅸ. 진로와의 연결 · 내가 쓸 곳", "area"],
  ],
};

const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => {
  const [k, ...rest] = p.split(".");
  return { ...(o ?? {}), [k]: rest.length ? setPath(o?.[k], rest.join("."), v) : v };
};

export default function InquiryReport() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, profile, refreshProfile, loading: authLoading } = useAuth();

  const [inq, setInq] = useState(null);
  useStay("report", inq?.id); // 체류 시간
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [picking, setPicking] = useState(false); // 디자인 다시 고르기
  const [uploading, setUploading] = useState(""); // 사진 올리는 칸
  const [fit, setFit] = useState({}); // 장마다 줄인 비율 (1 = 줄이지 않음)
  const [moving, setMoving] = useState(false); // 끌어서 옮기기 켜짐
  const [showMissing, setShowMissing] = useState(false); // 필수 칸 빨간 표시

  // 학생 정보 (필수) — 비어 있으면 회원 정보·진단 학년으로 미리 채운다
  const STUDENT_KEYS = ["school", "grade", "class_no", "student_no", "name"];
  const student = {
    school: profile?.school ?? "",
    grade: ["고1", "고2", "고3"].includes(inq?.grade) ? inq.grade : "",
    class_no: profile?.class_no ?? "",
    student_no: profile?.student_no ?? "",
    name: profile?.name ?? "",
    ...(inq?.report?.student_info ?? {}),
  };
  const missing = STUDENT_KEYS.filter((k) => !String(student[k] ?? "").trim());

  // 학생 정보 저장: 보고서 + 탐구(학교 통계용) + 회원 정보(다음 보고서 자동 채우기)
  const profTimer = useRef(null);
  function setStudent(patch) {
    const next = { ...student, ...patch };
    update({ report: { ...inq.report, student_info: next }, school: next.school?.trim() || null });
    clearTimeout(profTimer.current);
    profTimer.current = setTimeout(() => {
      supabase
        .from("profiles")
        .update({ school: next.school?.trim() || null, class_no: next.class_no || null, student_no: next.student_no || null })
        .eq("id", user.id)
        .then(({ error }) => (error ? console.warn("profile save failed", error) : refreshProfile?.()));
    }, 1000);
  }
  const [tab, setTab] = useState("all"); // 디자인 목록 탭: all | lit | case | data | survey | exp | obs
  const [spec, setSpec] = useState({ font: "함초롬바탕", size: 11, lineHeight: 160, pages: 4, submit: "hwp" });

  // 글꼴
  useEffect(() => {
    if (document.getElementById("report-fonts")) return;
    const l = document.createElement("link");
    l.id = "report-fonts";
    l.rel = "stylesheet";
    l.href = FONTS_URL;
    document.head.appendChild(l);
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    supabase.from("inquiries").select("*").eq("id", id).maybeSingle().then(({ data, error }) => {
      if (error || !data) return setErr("탐구를 찾지 못했어요.");
      setInq(data);
      if (data.format_spec) setSpec((s) => ({ ...s, ...data.format_spec }));
      track("report_open");
    });
  }, [authLoading, user, id]);

  // 저장 (입력을 멈추고 0.8초 뒤)
  const timer = useRef(null);
  function update(patch) {
    setInq((x) => ({ ...x, ...patch }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      supabase.from("inquiries").update(patch).eq("id", id).then(({ error }) => {
        if (!error) return;
        console.warn("save failed", error);
        setErr("저장하지 못했어요. 사진이 너무 크면 다른 사진으로 바꿔 주세요.");
      });
    }, 800);
  }
  const setField = (path, v) => update({ report: setPath(inq.report, path, v) });

  // 옮긴 자리 — report.layout[디자인][장] = { 덩어리: [x, y] }
  const layoutOf = (tpl, pg) => inq?.report?.layout?.[tpl]?.[pg] ?? {};
  const extrasOf = (tpl, pg) => inq?.report?.extras?.[tpl]?.[pg] ?? [];
  const hiddenOf = (tpl, pg) => inq?.report?.hidden?.[tpl]?.[pg] ?? [];
  // 고른 상자들 [{ key, x, y, w, h, html }] — Shift+클릭으로 여러 개. 마지막에 고른 것이 기준(도구막대·크기 조절)
  const [sels, setSels] = useState([]);
  const sel = sels[sels.length - 1] ?? null;
  const selKeys = sels.map((x) => x.key);
  // 하나만 고르기 / 비우기 (예전 코드와 같은 모양으로 쓴다)
  function setSel(v) {
    if (typeof v === "function") {
      return setSels((a) => {
        const nv = v(a[a.length - 1] ?? null);
        return nv ? [...a.slice(0, -1), nv] : [];
      });
    }
    setSels(v ? [v] : []);
  }
  // Sheet에서 고를 때 — Shift면 더하거나 빼고, 아니면 그것 하나만
  function selectBlock(info, opts) {
    if (!info) return setSels([]);
    if (opts?.shift) return setSels((a) => (a.some((x) => x.key === info.key) ? a.filter((x) => x.key !== info.key) : [...a, info]));
    setSels([info]);
  }

  // report[field][디자인][장] 한 칸만 바꾸기
  // ── 이전 되돌리기 (Ctrl+Z) — 편집기에서 바꾸기 직전 모습을 쌓아 두고 하나씩 꺼낸다
  // 옮긴 자리·추가한 상자·숨긴 상자·색·글씨·고친 글·전체 글씨체만 되돌린다 (오른쪽 칸 글은 그대로)
  const EDIT_KEYS = ["layout", "extras", "hidden", "styles", "texts", "font"];
  const history = useRef([]);
  const lastPush = useRef(0);
  const [undoCount, setUndoCount] = useState(0);
  function pushHistory() {
    const now = Date.now();
    // 색 고르기처럼 짧은 시간에 연달아 바뀌는 건 한 번으로 친다
    if (now - lastPush.current < 400 && history.current.length) return (lastPush.current = now);
    lastPush.current = now;
    const r = inq?.report ?? {};
    history.current.push(Object.fromEntries(EDIT_KEYS.map((k) => [k, r[k] ?? null])));
    if (history.current.length > 50) history.current.shift();
    setUndoCount(history.current.length);
  }
  function undo() {
    const snap = history.current.pop();
    setUndoCount(history.current.length);
    if (!snap) return;
    lastPush.current = 0;
    const next = { ...inq.report };
    EDIT_KEYS.forEach((k) => (snap[k] == null ? delete next[k] : (next[k] = snap[k])));
    update({ report: next });
    setSel(null);
  }

  function setPageData(field, pg, value) {
    pushHistory();
    const all = inq.report?.[field] ?? {};
    update({ report: { ...inq.report, [field]: { ...all, [inq.template]: { ...(all[inq.template] ?? {}), [pg]: value } } } });
  }
  // 상자 모양 — report.styles[디자인][장][상자] = { color, bg, font, zoom } · 전체 글씨체 report.font[디자인]
  const stylesOf = (tpl, pg) => inq?.report?.styles?.[tpl]?.[pg] ?? {};
  const fontOf = (tpl) => inq?.report?.font?.[tpl] ?? "";
  function styleBlock(patch) {
    if (!sels.length) return;
    const cur = stylesOf(inq.template, page);
    const next = { ...cur };
    sels.forEach((x) => (next[x.key] = { ...(cur[x.key] ?? {}), ...patch }));
    setPageData("styles", page, next);
  }
  // 모서리로 끌어서 바꾼 크기 저장 → 고른 상자 표시(손잡이 자리)도 새 크기로
  function resizeBlock(key, size, box) {
    const cur = stylesOf(inq.template, page);
    setPageData("styles", page, { ...cur, [key]: { ...(cur[key] ?? {}), ...size } });
    setSel((x) => (x && x.key === key ? { ...x, w: box.w, h: box.h } : x));
  }
  function setPageFont(f) {
    pushHistory();
    update({ report: { ...inq.report, font: { ...(inq.report?.font ?? {}), [inq.template]: f } } });
  }

  // 편집 중 A4 바깥을 누르거나 Esc를 누르면 고른 상자 해제
  // 위쪽 모양 팔레트·편집 버튼·상자 위 말풍선(data-keep-select)은 눌러도 유지
  useEffect(() => {
    if (!moving) return;
    const onDown = (e) => {
      if (e.target.closest?.("[data-edit-sheet], [data-keep-select]")) return;
      setSel(null);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      document.activeElement?.blur?.(); // 글 쓰는 중이면 글쓰기도 끝내기
      setSel(null);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moving]);

  // Ctrl+D(맥은 Cmd+D)로 고른 상자 복사
  useEffect(() => {
    if (!moving || !sel) return;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && !e.target.closest?.("input,textarea,[contenteditable='true']")) {
        e.preventDefault();
        copyBlock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, sels]);

  function copyBlock() {
    if (!sels.length) return;
    const t = Date.now().toString(36);
    const copies = sels.map((x, i) => ({ id: `${t}${i}`, x: x.x + 24, y: x.y + 24, w: Math.max(120, x.w), html: x.html }));
    setPageData("extras", page, [...extrasOf(inq.template, page), ...copies]);
    setSel(null);
  }
  function addTextBox() {
    const id = Date.now().toString(36);
    const html = `<p style="margin:0;padding:10px 12px;font-size:15px;line-height:1.6;color:#1F2640;background:#fff;border:1.5px dashed #A5B4FC;border-radius:8px">여기를 두 번 눌러 글을 써요</p>`;
    setPageData("extras", page, [...extrasOf(inq.template, page), { id, x: 120, y: 160, w: 320, html }]);
  }
  function hideOrDelete() {
    if (sels.length) pushHistory();
    if (!sels.length) return;
    // 추가한 상자는 지우고, 원래 상자는 숨긴다 — 한 번에 저장
    const exIds = sels.filter((x) => x.key.startsWith("ex-")).map((x) => x.key.slice(3));
    const hideKeys = sels.filter((x) => !x.key.startsWith("ex-")).map((x) => x.key);
    const r = inq.report, T = inq.template;
    const ex = r.extras ?? {}, hd = r.hidden ?? {};
    update({
      report: {
        ...r,
        extras: { ...ex, [T]: { ...(ex[T] ?? {}), [page]: extrasOf(T, page).filter((x) => !exIds.includes(x.id)) } },
        hidden: { ...hd, [T]: { ...(hd[T] ?? {}), [page]: [...new Set([...hiddenOf(T, page), ...hideKeys])] } },
      },
    });
    setSel(null);
  }
  // 디자인에 원래 있던 상자의 글을 두 번 클릭해서 고친 것 — report.texts[디자인][장][상자] = html
  const textsOf = (tpl, pg) => inq?.report?.texts?.[tpl]?.[pg] ?? {};
  function editText(key, html) {
    const cur = textsOf(inq.template, page);
    if (cur[key] === html) return;
    setPageData("texts", page, { ...cur, [key]: html });
  }
  function editExtra(id, html) {
    setPageData("extras", page, extrasOf(inq.template, page).map((x) => (x.id === id ? { ...x, html } : x)));
  }
  // 옮긴 자리 저장 — 여러 개를 함께 옮겨도 한 번에. 원래 상자는 layout에, 추가한 상자는 자리(x, y)를 바로 바꾼다
  function moveMany(pg, list, d) {
    pushHistory();
    const r = inq.report, T = inq.template;
    const lay = r.layout ?? {}, ex = r.extras ?? {};
    const pl = { ...(lay[T]?.[pg] ?? {}) };
    let exs = extrasOf(T, pg);
    list.forEach(([key, xy]) => {
      if (!key.startsWith("ex-")) return (pl[key] = xy);
      const id = key.slice(3);
      exs = exs.map((x) => (x.id === id ? { ...x, x: x.x + xy[0], y: x.y + xy[1] } : x));
    });
    update({
      report: {
        ...r,
        layout: { ...lay, [T]: { ...(lay[T] ?? {}), [pg]: pl } },
        extras: { ...ex, [T]: { ...(ex[T] ?? {}), [pg]: exs } },
      },
    });
    // 함께 옮긴 상자들의 고른 자리도 같이 옮긴다 (도구막대·복사 위치)
    if (d && list.length > 1) setSels((a) => a.map((x) => (list.some(([k]) => k === x.key) ? { ...x, x: x.x + d[0], y: x.y + d[1] } : x)));
  }

  // Ctrl+Z(맥은 Cmd+Z) — 이전 되돌리기. 글 쓰는 중·입력칸에서는 그 칸의 글자 되돌리기가 그대로 동작
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if (e.target.closest?.("input,textarea,select,[contenteditable='true']")) return;
      if (!history.current.length) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function makeReport(formatSpec) {
    setBusy(true);
    setErr("");
    const { data, message } = await callInquiry({ action: "report", inquiry_id: id, spec: formatSpec ?? inq?.format_spec ?? null });
    setBusy(false);
    if (message) return setErr(message);
    setInq(data.inquiry);
  }

  // 저장소에 올린 사진은 위치만 적혀 있다 → 화면·PDF용 임시 주소(7일)로 바꿔서 그린다
  const [photoUrls, setPhotoUrls] = useState({}); // 위치 → 임시 주소
  const photoPaths = Object.values(inq?.report?.photos ?? {}).filter((v) => v && !v.startsWith("data:"));
  useEffect(() => {
    const need = photoPaths.filter((pth) => !photoUrls[pth]);
    if (!need.length) return;
    supabase.storage.from("report-photos").createSignedUrls(need, 60 * 60 * 24 * 7).then(({ data, error }) => {
      if (error) return console.warn("signed url failed", error);
      setPhotoUrls((m) => ({ ...m, ...Object.fromEntries((data ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl])) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoPaths.join("|")]);

  const viewInq = useMemo(() => {
    if (!inq?.report) return inq;
    const ph = Object.fromEntries(Object.entries(inq.report.photos ?? {}).map(([k, v]) => [k, !v ? "" : v.startsWith("data:") ? v : photoUrls[v] ?? ""]));
    return { ...inq, report: { ...inq.report, photos: ph } };
  }, [inq, photoUrls]);

  const pages = useMemo(() => (viewInq?.report && viewInq?.template ? renderPages(viewInq.template, viewInq) : []), [viewInq]);

  // 사진 올리기 → 저장소에 파일로, 보고서엔 위치만
  async function uploadPhoto(path, file) {
    const blob = await shrinkImage(file);
    const slot = path.split(".").pop();
    const where = `${user.id}/${id}/${slot}-${Date.now()}.jpg`;
    // 파일 이름이 매번 달라서 덮어쓰기(upsert)는 필요 없다 — upsert를 켜면 수정 권한까지 있어야 해서 막힐 수 있다
    const { error } = await supabase.storage.from("report-photos").upload(where, blob, { contentType: "image/jpeg" });
    if (error) {
      console.error("photo upload failed", error);
      throw new Error(`사진을 올리지 못했어요. (${error.message ?? "저장소 오류"})`);
    }
    const old = getPath(inq.report, path);
    if (old && !old.startsWith("data:")) supabase.storage.from("report-photos").remove([old]);
    setField(path, where);
  }

  function print() {
    if (missing.length) {
      setShowMissing(true);
      setPage(0);
      setMoving(false);
      return window.alert("학생 정보(학교·학년·반·번호·이름)를 모두 채워야 PDF로 저장할 수 있어요.");
    }
    const n = emptyVoices(inq);
    if (n && !window.confirm(`아직 비어 있는 '내가 쓸 곳'이 ${n}개 있어요. 그래도 저장할까요?`)) return;
    // 무료 체험 탐구는 보고서 디자인까지 무료, PDF 저장은 이용권
    if (!inq.paid && !isAdmin) {
      track("pdf_paywall", inq.template);
      return setPdfWall(true);
    }
    track("export_pdf", inq.template);
    window.print();
  }

  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (user) supabase.rpc("is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, [user]);
  // 무료 체험 탐구인지 (null = 확인 중) — 보고서 디자인까지 무료, PDF 저장만 이용권
  const [free, setFree] = useState(null);
  useEffect(() => {
    if (!user || !inq?.id) return;
    isFreeInquiry(user.id, inq.id).then(setFree);
  }, [user, inq?.id, Boolean(inq?.pack)]);
  const locked = inq && !inq.paid && !isAdmin && free === false; // 무료 체험이 아닌 미결제 탐구는 화면부터 막는다
  const [pdfWall, setPdfWall] = useState(false); // PDF 저장을 눌렀을 때 결제 창

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <div className="py-40 text-center text-gray-500">로그인이 필요합니다.</div>;

  const r = inq?.report;
  // 디자인 목록 — 30개 전부. 전체 보기에서는 내 탐구 유형을 맨 위에
  const designs = TEMPLATES.filter((t) => t.id !== "school");
  const KIND = { lit: "문헌", case: "사례", data: "데이터", survey: "설문조사", exp: "실험", obs: "관찰" };
  const order = [inq?.method, ...Object.keys(KIND).filter((k) => k !== inq?.method)].filter(Boolean);
  const groups = (tab === "all" ? order : [tab]).map((k) => ({ k, items: designs.filter((t) => t.method === k) }));
  const TABS = [["all", `전체 ${designs.length}`], ...Object.entries(KIND).map(([k, l]) => [k, l])];

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 인쇄할 때는 A4 네 장만 */}
      <style>{`
        .a4-movable [data-bk] { cursor: move; }
        .a4-movable [data-bk]:hover { outline: 2px dashed #6366F1; outline-offset: 2px; }
        .a4-movable .bk-drag { outline: 2px solid #6366F1 !important; opacity: .9; }
        .a4-movable .bk-sel { outline: 2.5px solid #6366F1 !important; outline-offset: 2px; }
        .a4-movable [contenteditable="true"] { outline: 2.5px solid #F59E0B !important; cursor: text; }
        .a4-movable img { pointer-events: none; }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden !important; }
          #print-area, #print-area * { visibility: visible !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          #print-area { position: absolute !important; left: 0 !important; top: 0 !important; display: block !important; }
          #print-area .print-page { page-break-after: always; }
          .slot-photo { border-color: transparent !important; }
        }
      `}</style>

      <header className="flex h-[60px] items-center gap-6 border-b border-gray-200 bg-white px-6">
        <button onClick={() => nav("/")} className="text-[20px] font-extrabold text-sm-navy">생수면<span className="text-sm-orange">.</span></button>
        <div className="hidden md:block"><StepBar active={3} id={inq?.id ?? id} stage={inq?.stage} /></div>
        <div className="ml-auto flex items-center gap-2">
        {inq?.template && r && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { update({ format_mode: null, template: null }); setPicking(false); setPage(0); }}
              className="h-9 rounded-lg border border-gray-300 px-3 text-[13px] font-bold text-gray-600"
            >
              {inq.format_mode === "school" ? "자유형으로 바꾸기" : "선생님 형식으로 바꾸기"}
            </button>
            {inq.format_mode === "free" && (
              <button onClick={() => setPicking(true)} className="h-9 rounded-lg border border-gray-300 px-3 text-[13px] font-bold text-sm-navy">디자인 바꾸기</button>
            )}
            {free && !inq.paid && !isAdmin && (
              <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[12px] font-bold text-sm-orange">무료 체험 중 · PDF 저장은 이용권</span>
            )}
            <button onClick={print} className="h-9 rounded-lg bg-sm-navy px-4 text-[13px] font-bold text-white">PDF로 저장</button>
          </div>
        )}
          <InquirySwitcher currentId={inq?.id} />
        </div>
      </header>

      {err && <p className="mx-auto mt-5 max-w-3xl rounded-lg bg-red-50 px-4 py-3 text-center text-[14px] font-bold text-red-600">{err}</p>}
      {!inq && !err && <p className="py-40 text-center text-gray-400">불러오는 중…</p>}

      {/* ① 형식 고르기 — 버튼 두 개 */}
      {inq && !inq.format_mode && (
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-gray-200 bg-white p-7">
          <p className="text-[20px] font-extrabold text-sm-navy">보고서 형식을 골라주세요</p>
          <p className="mt-1 text-[13px] text-gray-500">고르면 1~3단계에서 모은 내용으로 4장 분량을 채워요. 결과·자료는 내가 넣은 것만 쓰고, ‘내가 쓸 곳’은 비워 둬요.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button onClick={() => update({ format_mode: "school" })} className="rounded-2xl border-2 border-gray-200 p-5 text-left hover:border-sm-navy">
              <p className="text-[17px] font-extrabold text-sm-navy">선생님 형식</p>
              <p className="mt-2 text-[13px] text-gray-600">선생님이 정한 목차·글자 수·글꼴 그대로 만들어요</p>
            </button>
            <button
              onClick={() => {
                update({ format_mode: "free" });
                setPicking(true);
                if (!r) makeReport(null);
              }}
              className="rounded-2xl border-2 border-sm-navy bg-sm-navy p-5 text-left text-white"
            >
              <p className="text-[17px] font-extrabold">자유형</p>
              <p className="mt-2 text-[13px] text-indigo-100">몇 달 뒤에도 기억나는 디자인으로 만들어요</p>
            </button>
          </div>
        </div>
      )}

      {/* ② 보고서 내용 만드는 중 · 실패하면 다시 시도 */}
      {inq && inq.format_mode && !r && (busy || inq.template || inq.format_mode === "free") && (
        <div className="mx-auto mt-16 max-w-xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-[20px] font-extrabold text-sm-navy">{busy ? "보고서 내용을 채우고 있어요" : "보고서 내용을 만들지 못했어요"}</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
            {busy ? "30초~1분 걸려요. 결과·자료는 내가 넣은 것만 쓰고, ‘내가 쓸 곳’은 비워 둬요." : "잠시 후 다시 시도해 주세요."}
          </p>
          {!busy && (
            <button onClick={() => makeReport(null)} className="mt-5 h-[52px] w-72 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">
              다시 만들기
            </button>
          )}
        </div>
      )}

      {/* 학교 양식 — 형식 입력 */}
      {inq && inq.format_mode === "school" && !inq.template && !busy && (
        <div className="mx-auto mt-10 max-w-2xl space-y-4 rounded-2xl border border-gray-200 bg-white p-7">
          <p className="text-[18px] font-extrabold text-sm-navy">선생님이 정한 형식을 알려주세요</p>
          <div className="grid grid-cols-2 gap-3 text-[13.5px]">
            <label>글꼴<select value={spec.font} onChange={(e) => setSpec({ ...spec, font: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2">{["함초롬바탕", "함초롬돋움", "맑은 고딕", "바탕"].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>글자 크기 (pt)<select value={spec.size} onChange={(e) => setSpec({ ...spec, size: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2">{[10, 10.5, 11, 12].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>줄간격 (%)<select value={spec.lineHeight} onChange={(e) => setSpec({ ...spec, lineHeight: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2">{[130, 160, 180, 200].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label>제출 방식<select value={spec.submit} onChange={(e) => setSpec({ ...spec, submit: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2"><option value="hwp">한글 파일</option><option value="pdf">PDF</option><option value="print">인쇄해서 제출</option><option value="handwrite">손글씨</option></select></label>
          </div>
          <p className="text-[12px] text-gray-400">모르면 그대로 두세요. 한글 기본 형식이에요.</p>
          <button
            onClick={() => {
              update({ format_spec: spec, template: "school" });
              if (!r) makeReport(spec);
            }}
            className="h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white"
          >
            이 형식으로 만들기
          </button>
        </div>
      )}

      {/* ③ 디자인 고르기 */}
      {inq && r && inq.format_mode === "free" && (picking || !inq.template) && (
        <div className="mx-auto mt-8 max-w-[1300px] rounded-2xl border border-gray-200 bg-white p-7">
          <div className="flex items-center gap-3">
            <p className="text-[20px] font-extrabold text-sm-navy">어떤 디자인으로 만들까요? <span className="text-[14px] font-bold text-gray-400">{designs.length}개</span></p>
            {inq.template && <button onClick={() => setPicking(false)} className="ml-auto text-[13px] font-bold text-gray-500">닫기</button>}
          </div>
          <p className="mt-1 text-[13px] text-gray-500">내 탐구 내용이 들어간 모습이에요. 골라도 언제든 바꿀 수 있어요.</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {TABS.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${tab === k ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {groups.map((g) => (
            <section key={g.k} className="mt-6">
              <p className="text-[14px] font-extrabold text-sm-navy">
                {g.k === inq.method ? `내 탐구에 추천 · ${KIND[g.k]} 탐구` : `${KIND[g.k]} 탐구`}
                <span className="ml-1.5 text-[12px] font-bold text-gray-400">{g.items.length}개</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-5">
                {g.items.map((t) => {
              const preview = renderPages(t.id, viewInq, { preview: true })[0]; // 미리보기는 내 사진 대신 예시 이미지
              const on = inq.template === t.id;
              return (
                <button key={t.id} onClick={() => { update({ template: t.id }); setPicking(false); setPage(0); }} className={`rounded-xl border-2 p-2 text-left ${on ? "border-sm-navy" : "border-transparent hover:border-gray-300"}`}>
                  <Sheet page={preview} scale={0.28} />
                  <p className="mt-2 text-[13.5px] font-bold text-sm-navy">{t.name}</p>
                  <p className="text-[11.5px] text-gray-400">
                    {{ lit: "문헌", case: "사례", data: "데이터", survey: "설문", exp: "실험", obs: "관찰" }[t.method]} 탐구용
                    {t.method === inq.method ? " · 추천" : ""}
                  </p>
                  {t.desc && <p className="text-[11.5px] text-gray-500">{t.desc}</p>}
                </button>
              );
            })}
              </div>
            </section>
          ))}
          <p className="mt-6 text-[12.5px] text-gray-400">어떤 디자인을 골라도 내 내용이 그대로 들어가요. 골라도 언제든 바꿀 수 있어요.</p>
        </div>
      )}

      {/* ④ 편집기 */}
      {inq && r && inq.template && !(picking && inq.format_mode === "free") && pages.length > 0 && (
        <div className="flex gap-5 p-5">
          {/* 왼쪽 — 장 넘기기 */}
          <aside className="w-[150px] shrink-0 space-y-3">
            {pages.map((pg, i) => (
              <button key={i} onClick={() => { setPage(i); setSel(null); }} className={`block rounded-lg border-2 p-1 ${page === i ? "border-sm-navy" : "border-transparent"}`}>
                <Sheet page={pg} scale={0.16} offsets={layoutOf(inq.template, i)} extras={extrasOf(inq.template, i)} hidden={hiddenOf(inq.template, i)} styles={stylesOf(inq.template, i)} texts={textsOf(inq.template, i)} pageFont={fontOf(inq.template)} />
                <p className="mt-1 text-center text-[12px] font-bold text-sm-navy">{i + 1}장</p>
              </button>
            ))}
          </aside>

          {/* 가운데 — A4 */}
          <main className="flex min-w-0 flex-1 justify-center">
            <div className="flex flex-col items-center gap-3">
              {/* 위에 고정: ① 고른 상자 모양 ② 편집 버튼 — 눌러도 고른 상자가 풀리지 않게 data-keep-select */}
              <div data-keep-select className="sticky top-0 z-30 w-full max-w-[980px] space-y-2 bg-gray-100/95 pb-2 pt-2 backdrop-blur">
                {(() => {
                  const on = moving && sel;
                  const st = (sel && stylesOf(inq.template, page)[sel.key]) || {};
                  const dot = (c, active, onClick, label) => (
                    <button
                      key={c}
                      type="button"
                      onClick={onClick}
                      title={label ?? c}
                      aria-label={label ?? c}
                      className={`h-6 w-6 rounded-full border ${active ? "ring-2 ring-indigo-500 ring-offset-1" : "border-gray-300"}`}
                      style={{ background: c === "transparent" ? "repeating-conic-gradient(#E5E7EB 0 25%, #fff 0 50%) 0 0/8px 8px" : c }}
                    />
                  );
                  return (
                    <div className="rounded-xl border border-indigo-200 bg-white px-3 py-2 shadow-sm">
                      <p className="mb-1.5 text-[12px] font-bold text-indigo-700">
                        {on ? (sels.length > 1 ? `고른 상자 ${sels.length}개 모양` : "고른 상자 모양") : moving ? "상자를 한 번 클릭해서 고르면 색·글씨를 바꿀 수 있어요" : "아래 ‘편집 켜기’를 누르고 상자를 고르면 색·글씨를 바꿀 수 있어요"}
                      </p>
                      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${on ? "" : "pointer-events-none opacity-40"}`}>
                        <div className="flex items-center gap-1">
                          <span className="mr-1 text-[12px] font-bold text-gray-600">글자색</span>
                          {INK.map((c) => dot(c, st.color === c, () => styleBlock({ color: c })))}
                          <input type="color" value={st.color ?? "#1F2640"} onChange={(e) => styleBlock({ color: e.target.value })} className="h-6 w-7 cursor-pointer rounded border border-gray-300" title="직접 고르기" />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="mr-1 text-[12px] font-bold text-gray-600">바탕색</span>
                          {PAPER.map((c) => dot(c, st.bg === c, () => styleBlock({ bg: c }), c === "transparent" ? "바탕 없음" : c))}
                          <input type="color" value={st.bg && st.bg !== "transparent" ? st.bg : "#FFFFFF"} onChange={(e) => styleBlock({ bg: e.target.value })} className="h-6 w-7 cursor-pointer rounded border border-gray-300" title="직접 고르기" />
                        </div>
                        <label className="flex items-center gap-1 text-[12px] font-bold text-gray-600">
                          글씨체
                          <select value={st.font ?? ""} onChange={(e) => styleBlock({ font: e.target.value })} className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[12.5px]">
                            {FONT_CHOICES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-[12px] font-bold text-gray-600">
                          글씨 크기
                          <select value={st.size ?? ""} onChange={(e) => styleBlock({ size: e.target.value ? Number(e.target.value) : undefined })} className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-[12.5px]">
                            <option value="">디자인 그대로</option>
                            {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <button type="button" onClick={() => styleBlock({ size: Math.max(8, (st.size ?? 14) - 1) })} className="h-8 w-8 rounded-lg border border-gray-300 bg-white text-[12px]" title="글씨 작게">가-</button>
                          <button type="button" onClick={() => styleBlock({ size: Math.min(72, (st.size ?? 14) + 1) })} className="h-8 w-8 rounded-lg border border-gray-300 bg-white text-[13px] font-bold" title="글씨 크게">가+</button>
                        </label>
                        <div className="flex items-center gap-1 text-[12px] font-bold text-gray-600">
                          상자 크기
                          <button type="button" onClick={() => styleBlock({ zoom: Math.max(0.6, Math.round(((st.zoom ?? 1) - 0.1) * 10) / 10) })} className="h-8 w-8 rounded-lg border border-gray-300 bg-white text-[15px]">－</button>
                          <span className="w-10 text-center">{Math.round((st.zoom ?? 1) * 100)}%</span>
                          <button type="button" onClick={() => styleBlock({ zoom: Math.min(2, Math.round(((st.zoom ?? 1) + 0.1) * 10) / 10) })} className="h-8 w-8 rounded-lg border border-gray-300 bg-white text-[15px]">＋</button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = { ...stylesOf(inq.template, page) };
                            selKeys.forEach((k) => delete cur[k]);
                            setPageData("styles", page, cur);
                          }}
                          className="text-[12px] text-gray-500 underline"
                        >
                          이 상자 모양 되돌리기
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ② 편집 버튼 */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => { setMoving((m) => !m); setSel(null); }}
                    className={`h-9 rounded-lg px-4 text-[13px] font-bold ${moving ? "bg-indigo-600 text-white" : "border border-indigo-300 bg-white text-indigo-700"}`}
                  >
                    {moving ? "편집 끄기" : "편집 켜기"}
                  </button>
                  <button onClick={addTextBox} disabled={!moving} className="h-9 rounded-lg border border-indigo-300 bg-white px-3 text-[13px] font-bold text-indigo-700 disabled:opacity-30">+ 글 상자</button>
                  <button onClick={copyBlock} disabled={!moving || !sel} className="h-9 rounded-lg bg-indigo-600 px-3 text-[13px] font-bold text-white disabled:opacity-30">복사</button>
                  <button onClick={hideOrDelete} disabled={!moving || !sel} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-600 disabled:opacity-30">
                    {sels.length && sels.every((x) => x.key.startsWith("ex-")) ? "삭제" : "숨기기"}
                  </button>
                  <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-gray-600">
                    전체 글씨체
                    <select value={fontOf(inq.template)} onChange={(e) => setPageFont(e.target.value)} className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-[12.5px]">
                      {FONT_CHOICES.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <button
                    onClick={undo}
                    disabled={!undoCount}
                    title="방금 한 것을 되돌려요 (Ctrl+Z)"
                    className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-600 disabled:opacity-30"
                  >
                    ↶ 이전 되돌리기
                  </button>
                  {moving && (
                    <span className="w-full text-center text-[12px] text-gray-500">
                      상자를 끌어서 옮기고, 한 번 클릭해서 고르면 복사·숨기기·색 바꾸기 · 고른 상자 오른쪽 아래 ■를 끌면 크기 조절 · 상자를 두 번 클릭하면 글 고치기 · Ctrl+D 복사 · Shift+클릭으로 여러 개 고르기 · Ctrl+Z 이전 되돌리기 · 바깥을 누르거나 Esc로 선택 풀기
                    </span>
                  )}
                </div>
              </div>
              {/* 가운데 큰 A4 — 여기 안을 누르면 Sheet가 고르기/풀기를 직접 처리 */}
              <div className="shadow-xl" data-edit-sheet>
                <Sheet
                  page={pages[page]}
                  scale={0.78}
                  offsets={layoutOf(inq.template, page)}
                  extras={extrasOf(inq.template, page)}
                  hidden={hiddenOf(inq.template, page)}
                  styles={stylesOf(inq.template, page)}
                  pageFont={fontOf(inq.template)}
                  movable={moving}
                  selected={sel?.key}
                  selectedKeys={selKeys}
                  selBox={sel}
                  toolbar={
                    <div className="flex gap-1 rounded-lg bg-indigo-600 p-1 shadow-lg">
                      <button onClick={copyBlock} className="rounded-md px-2.5 py-1 text-[12.5px] font-bold text-white hover:bg-indigo-500">복사</button>
                      <button onClick={hideOrDelete} className="rounded-md px-2.5 py-1 text-[12.5px] font-bold text-indigo-100 hover:bg-indigo-500">
                        {sels.length && sels.every((x) => x.key.startsWith("ex-")) ? "삭제" : "숨기기"}
                      </button>
                    </div>
                  }
                  onSelect={selectBlock}
                  onResize={sels.length === 1 ? resizeBlock : undefined}
                  onEditExtra={editExtra}
                  onEditText={editText}
                  texts={textsOf(inq.template, page)}
                  onMove={(list, d) => moveMany(page, list, d)}
                  onFit={(k) => setFit((f) => (f[page] === k ? f : { ...f, [page]: k }))}
                />
              </div>
            </div>
          </main>

          {/* 오른쪽 — 칸 고치기 */}
          <aside className="w-[340px] shrink-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-[15px] font-extrabold text-sm-navy">{page + 1}{inq.template === "school" ? "쪽" : "장"} 고치기</p>
            {fit[page] < 0.99 && (
              <p className={`rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${fit[page] <= MIN_FIT + 0.001 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
                {fit[page] <= MIN_FIT + 0.001
                  ? "글이 너무 많아 한 장에 다 들어가지 않아요. 아래 칸의 글을 조금 줄여 주세요."
                  : `글이 많아 이 장의 글자를 ${Math.round(fit[page] * 100)}% 크기로 줄였어요. 글을 줄이면 원래 크기로 돌아와요.`}
              </p>
            )}
            {page === 0 && (() => {
              const st = student;
              const bad = (k) => showMissing && !String(st[k] ?? "").trim();
              const box = (k) =>
                `mt-1 w-full rounded-lg border px-3 py-2 text-[13.5px] font-normal outline-none focus:border-sm-navy ${bad(k) ? "border-red-400 bg-red-50" : "border-gray-300"}`;
              const Req = () => <span className="text-red-500"> *</span>;
              return (
                <div className="space-y-2 rounded-xl border border-gray-200 p-3">
                  <p className="text-[12.5px] font-extrabold text-sm-navy">학생 정보 <span className="font-bold text-red-500">(필수)</span></p>
                  <label className="block text-[12px] font-bold text-gray-600">
                    학교<Req />
                    <input value={st.school ?? ""} onChange={(e) => setStudent({ school: e.target.value })} placeholder="예) 인천가정고등학교" className={box("school")} />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block text-[12px] font-bold text-gray-600">
                      학년<Req />
                      <select value={st.grade ?? ""} onChange={(e) => setStudent({ grade: e.target.value })} className={box("grade")}>
                        <option value="">선택</option>
                        {["고1", "고2", "고3"].map((g) => <option key={g}>{g}</option>)}
                      </select>
                    </label>
                    <label className="block text-[12px] font-bold text-gray-600">
                      반<Req />
                      <input value={st.class_no ?? ""} onChange={(e) => setStudent({ class_no: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} inputMode="numeric" placeholder="3" className={box("class_no")} />
                    </label>
                    <label className="block text-[12px] font-bold text-gray-600">
                      번호<Req />
                      <input value={st.student_no ?? ""} onChange={(e) => setStudent({ student_no: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} inputMode="numeric" placeholder="32" className={box("student_no")} />
                    </label>
                  </div>
                  <label className="block text-[12px] font-bold text-gray-600">
                    이름<Req />
                    <input value={st.name ?? ""} onChange={(e) => setStudent({ name: e.target.value.slice(0, 20) })} placeholder="홍길동" className={box("name")} />
                  </label>
                  {showMissing && missing.length > 0 && <p className="text-[12px] font-bold text-red-600">빨간 칸을 채워야 PDF로 저장할 수 있어요.</p>}
                </div>
              );
            })()}
            {page === 0 && r.titles?.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-[12.5px] font-bold text-gray-600">제목 후보</p>
                {r.titles.map((t) => (
                  <button key={t} onClick={() => setField("title", t)} className={`block w-full rounded-lg border px-3 py-2 text-left text-[13px] font-bold ${r.title === t ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300 text-sm-navy"}`}>{t}</button>
                ))}
              </div>
            )}
            {((inq.template === "school" ? SCHOOL_FIELDS : FIELDS)[page] ?? []).filter(([, , , only]) => !only || only.includes(inq.template)).map(([path, label, type]) => (
              <label key={path} className="block text-[12.5px] font-bold text-gray-600">
                {label}
                {type === "input" && (
                  <input value={getPath(r, path) ?? ""} onChange={(e) => setField(path, e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[13.5px] font-normal outline-none focus:border-sm-navy" />
                )}
                {type === "area" && (
                  <textarea rows={4} value={getPath(r, path) ?? ""} onChange={(e) => setField(path, e.target.value)} placeholder={getPath(r, path.replace(".text", ".starter")) ?? ""} className="mt-1 w-full resize-none rounded-lg border border-gray-300 p-3 text-[13px] font-normal leading-relaxed outline-none focus:border-sm-navy" />
                )}
                {type === "photo" && (
                  <>
                    <div className="mt-1 flex gap-2">
                      <span className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-400 text-[13px] text-gray-600">
                        {uploading === path ? "사진 올리는 중…" : getPath(r, path) ? "다른 사진으로 바꾸기" : "사진 올리기"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.target.value = ""; // 같은 사진을 다시 골라도 반응하게
                            if (!f) return;
                            setErr("");
                            setUploading(path);
                            try {
                              await uploadPhoto(path, f);
                            } catch (x) {
                              setErr(x.message);
                            } finally {
                              setUploading("");
                            }
                          }}
                        />
                      </span>
                      {getPath(r, path) && (
                        <button type="button" onClick={(e) => { e.preventDefault(); setField(path, ""); }} className="text-[12px] text-gray-500 underline">
                          지우기
                        </button>
                      )}
                    </div>
                    {getPath(viewInq.report, path) && <img src={getPath(viewInq.report, path)} alt="" className="mt-2 h-20 w-full rounded-lg object-cover" />}
                  </>
                )}
              </label>
            ))}
            <p className="text-[11.5px] leading-relaxed text-gray-400">고친 내용은 자동으로 저장돼요. 디자인을 바꿔도 내용은 그대로예요.</p>
          </aside>
        </div>
      )}

      {/* 인쇄용 — 화면에는 숨김 */}
      <div id="print-area" aria-hidden="true" style={{ position: "fixed", left: -100000, top: 0 }}>
        {pages.map((pg, i) => (
          <div key={i} className="print-page"><Sheet page={pg} scale={1} offsets={layoutOf(inq?.template, i)} extras={extrasOf(inq?.template, i)} hidden={hiddenOf(inq?.template, i)} styles={stylesOf(inq?.template, i)} texts={textsOf(inq?.template, i)} pageFont={fontOf(inq?.template)} /></div>
        ))}
      </div>
      <Paywall
        open={Boolean(locked) || pdfWall}
        reason={pdfWall && !locked ? "pdf" : "report"}
        inquiryId={inq?.id}
        onClose={() => (locked ? nav(`/inquiry/${id}`) : setPdfWall(false))}
        onUnlocked={() => {
          setPdfWall(false);
          supabase.from("inquiries").select("*").eq("id", id).maybeSingle().then(({ data }) => data && setInq(data));
        }}
      />
    </div>
  );
}