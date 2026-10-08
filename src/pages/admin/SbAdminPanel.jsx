import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/*
 * 관리자 [합격 생기부] 탭 — 생기부 넣기 · 공개하기
 * 계열 × 학교 단계마다 생기부 1개 → 학년 3 × 영역 4 = 판 12개
 * 판마다 문장을 한 줄에 하나씩 붙여 넣는다:  라벨 | 문장 | 이 문장에서 볼 것(선택)
 */

const AREAS = [
  { k: "cc", label: "창체" },
  { k: "sp", label: "세특" },
  { k: "hb", label: "행특" },
  { k: "gr", label: "성적" },
];
const AREA_LABEL = Object.fromEntries(AREAS.map((a) => [a.k, a.label]));
const STATUS = { draft: "준비 중", live: "공개", hidden: "숨김" };
const num = (v) => Number(v ?? 0);

// 영역 판 기본 크기 (서버 sb_area_size 와 같은 계산)
function areaSize(total, area) {
  const cc = Math.round(total * 0.3), sp = Math.round(total * 0.45), hb = Math.round(total * 0.1);
  return { cc, sp, hb, gr: total - cc - sp - hb }[area];
}

/* ───── PDF 판: 첫 장을 이미지로 그려서 조각으로 자른다 ───── */
const PAGE_PX = 1200; // 첫 장을 이 가로 크기로 그린다

async function renderFirstPage(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: PAGE_PX / v1.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return trimBlank(canvas);
}

/*
 * 아래쪽 빈 공간 잘라내기 — 내용이 짧은 장(행특 등)은 아래가 비어 있어서
 * 그대로 자르면 빈 조각만 잔뜩 생긴다. 내용이 끝난 뒤 큰 빈칸(장 높이의 8% 이상)이 나오면 거기서 자른다
 * (맨 아래 '○○고등학교 … 이름 ○○○' 줄은 빈칸 뒤에 있으니 같이 빠진다)
 */
function trimBlank(canvas) {
  const { width: w, height: h } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const ink = (y) => {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * 4;
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) return true;
    }
    return false;
  };
  const gap = Math.round(h * 0.08);
  let last = 0, blank = 0, cut = h;
  for (let y = 0; y < h; y++) {
    if (ink(y)) {
      last = y;
      blank = 0;
    } else if (last > 0 && ++blank >= gap) {
      cut = Math.min(h, last + Math.round(h * 0.02));
      break;
    }
  }
  if (cut >= h * 0.95) return canvas; // 꽉 찬 장은 그대로
  const out = document.createElement("canvas");
  out.width = w;
  out.height = cut;
  out.getContext("2d").drawImage(canvas, 0, 0, w, cut, 0, 0, w, cut);
  return out;
}

// 원하는 칸 수에 가깝고, 조각이 너무 길쭉하지 않은 가로×세로를 고른다
function pickGrid(target, w, h) {
  let best = null;
  for (let cols = 3; cols <= 9; cols++) {
    const rows = Math.max(1, Math.round(target / cols));
    const aspect = w / cols / (h / rows);
    const score = Math.abs(cols * rows - target) + Math.abs(Math.log(aspect)) * 8;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

const toBlob = (canvas) => new Promise((ok) => canvas.toBlob(ok, "image/webp", 0.86));

// "라벨 | 문장 | 볼 것" 줄들을 읽는다
function parseLines(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, body, insight] = l.split("|").map((x) => (x ?? "").trim());
      return body ? { label: label || "기타", body, insight: insight || "" } : { label: "기타", body: label, insight: "" };
    });
}
const toText = (lines) => lines.map((l) => [l.label, l.body, l.insight].filter((x, i) => i < 2 || x).join(" | ")).join("\n");

export default function SbAdminPanel() {
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState("");
  const [track, setTrack] = useState("eng");
  const [tier, setTier] = useState(8);
  const [form, setForm] = useState({ title: "", basis: "" });
  const [sel, setSel] = useState({ grade: 1, area: "cc" });
  const [board, setBoard] = useState(null);
  const [text, setText] = useState("");
  const [size, setSize] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openOn, setOpenOn] = useState({}); // 학교별 여는 날 { tierId: "YYYY-MM-DD" }
  const [pdf, setPdf] = useState(null); // { file, canvas, cols, rows, preview }
  const [upMsg, setUpMsg] = useState("");

  const loadOv = useCallback(() => {
    supabase.rpc("admin_sb_overview").then(({ data, error }) => {
      if (error) return setErr(error.message);
      setOv(data);
    });
  }, []);
  useEffect(loadOv, [loadOv]);

  // 학교별 여는 날
  const loadOpenOn = useCallback(() => {
    supabase.rpc("admin_sb_tiers").then(({ data }) => setOpenOn(Object.fromEntries((data ?? []).map((t) => [t.id, t.open_on ?? ""]))));
  }, []);
  useEffect(loadOpenOn, [loadOpenOn]);

  async function saveOpenOn(v) {
    const { error } = await supabase.rpc("admin_sb_set_open_on", { p_tier: tier, p_date: v || null });
    if (error) return setMsg(error.message);
    setMsg(v ? `${tierRow?.schools} 여는 날을 ${v}로 바꿨어요` : `${tierRow?.schools} 여는 날을 지웠어요 (공개 상태면 바로 열려요)`);
    loadOpenOn();
  }

  const tierRow = ov?.tiers?.find((t) => t.id === tier);
  const trackRow = ov?.tracks?.find((t) => t.id === track);
  const record = ov?.records?.find((r) => r.track_id === track && r.tier_id === tier);

  // 생기부를 바꾸면 제목 칸을 채운다
  useEffect(() => {
    if (record) setForm({ title: record.title, basis: record.basis ?? "" });
    else if (tierRow && trackRow)
      setForm({ title: `${trackRow.name} 계열 ${tierRow.schools.split(" · ")[0]}급 합격 사례`, basis: "합격 사례를 바탕으로 재구성" });
  }, [record?.id, tier, track, ov]); // eslint-disable-line react-hooks/exhaustive-deps

  // 판 불러오기
  const loadBoard = useCallback(() => {
    if (!record) return setBoard(null);
    supabase.rpc("admin_sb_board", { p_record: record.id, p_grade: sel.grade, p_area: sel.area }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setBoard(data);
      setText(toText(data?.lines ?? []));
      setSize(num(data?.size) || areaSize(tierRow?.grade_total ?? 0, sel.area));
    });
  }, [record?.id, sel.grade, sel.area, tierRow?.grade_total]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadBoard, [loadBoard]);

  const parsed = useMemo(() => parseLines(text), [text]);

  async function saveRecord() {
    setBusy(true);
    setMsg("");
    const { error } = await supabase.rpc("admin_sb_save_record", { p_track: track, p_tier: tier, p_title: form.title, p_basis: form.basis });
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg("생기부를 저장했어요. 판 12개가 기본 크기로 만들어졌어요.");
    loadOv();
  }

  async function setRecordStatus(status) {
    if (!record) return;
    if (status === "live" && !window.confirm("학생들에게 공개할까요? 공개한 판만 보여요.")) return;
    const { error } = await supabase.rpc("admin_sb_record_status", { p_record: record.id, p_status: status });
    if (error) return setMsg(error.message);
    loadOv();
  }

  async function saveBoard(status) {
    if (!record) return;
    setBusy(true);
    setMsg("");
    const { data, error } = await supabase.rpc("admin_sb_save_board", {
      p_record: record.id,
      p_grade: sel.grade,
      p_area: sel.area,
      p_size: Number(size),
      p_lines: parsed,
      p_status: status,
    });
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg(`${sel.grade}학년 ${AREA_LABEL[sel.area]} 판 저장 · 문장 ${data.lines}줄 · ${data.size}칸 · ${STATUS[data.status]}`);
    loadOv();
    loadBoard();
  }

  // PDF 고르기 → 첫 장 그리기 → 칸 나누기 미리보기
  async function pickPdf(file) {
    if (!file) return;
    setUpMsg("첫 장을 그리는 중…");
    try {
      const canvas = await renderFirstPage(file);
      // 기본 칸 수는 언제나 '학교 크기 × 영역 비율' (다른 판을 보다 와도 그 판 크기가 섞이지 않게)
      const target = areaSize(tierRow?.grade_total ?? 0, sel.area);
      const g = pickGrid(target, canvas.width, canvas.height);
      setPdf({ file, canvas, ...g, preview: canvas.toDataURL("image/jpeg", 0.6) });
      setUpMsg("");
    } catch (e) {
      console.error(e);
      setUpMsg("PDF를 읽지 못했어요. 다른 파일로 해 주세요.");
    }
  }

  // 이미 올린 PDF를 저장소에서 다시 불러와 미리보기 (파일을 다시 고르지 않아도 칸 수를 바꿀 수 있게)
  async function reloadPdf() {
    if (!record) return;
    setUpMsg("올라가 있는 PDF를 불러오는 중…");
    const { data: boardId } = await supabase.rpc("admin_sb_board_id", { p_record: record.id, p_grade: sel.grade, p_area: sel.area });
    const { data: blob, error } = await supabase.storage.from("sb-files").download(`boards/${boardId}/full.pdf`);
    if (error || !blob) return setUpMsg("올라가 있는 PDF를 찾지 못했어요. [파일 선택]으로 다시 골라 주세요.");
    await pickPdf(new File([blob], `${sel.grade}학년_${AREA_LABEL[sel.area]}.pdf`, { type: "application/pdf" }));
  }

  // 조각 이미지 + PDF 올리기 → 판 정보 저장
  async function uploadPdf(status) {
    if (!record || !pdf) return;
    setBusy(true);
    setUpMsg("");
    try {
      const { data: boardId, error: idErr } = await supabase.rpc("admin_sb_board_id", { p_record: record.id, p_grade: sel.grade, p_area: sel.area });
      if (idErr || !boardId) throw new Error(idErr?.message || "판을 찾지 못했어요");
      const store = supabase.storage.from("sb-files");
      const { cols, rows, canvas } = pdf;
      const tw = canvas.width / cols, th = canvas.height / rows;
      const tile = document.createElement("canvas");
      for (let n = 0; n < cols * rows; n++) {
        const x = (n % cols) * tw, y = Math.floor(n / cols) * th;
        tile.width = Math.round(tw);
        tile.height = Math.round(th);
        tile.getContext("2d").drawImage(canvas, x, y, tw, th, 0, 0, tile.width, tile.height);
        const blob = await toBlob(tile);
        const { error } = await store.upload(`boards/${boardId}/tiles/${n}.webp`, blob, { upsert: true, contentType: "image/webp" });
        if (error) throw error;
        setUpMsg(`조각 올리는 중… ${n + 1}/${cols * rows}`);
      }
      const { error: pdfErr } = await store.upload(`boards/${boardId}/full.pdf`, pdf.file, { upsert: true, contentType: "application/pdf" });
      if (pdfErr) throw pdfErr;
      const { error: setErr2 } = await supabase.rpc("admin_sb_set_pdf_board", {
        p_record: record.id, p_grade: sel.grade, p_area: sel.area,
        p_cols: cols, p_rows: rows, p_page_w: canvas.width, p_page_h: canvas.height, p_status: status,
      });
      if (setErr2) throw setErr2;
      setUpMsg(`올렸어요 · ${cols}×${rows} = ${cols * rows}칸 · ${STATUS[status]}`);
      setPdf(null);
      loadOv();
      loadBoard();
    } catch (e) {
      console.error(e);
      setUpMsg(`올리지 못했어요 · ${e.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">불러오지 못했어요 · {err} (sb_4_admin.sql 실행했는지 확인)</p>;
  if (!ov) return <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중…</p>;

  const chip = (on) =>
    `rounded-lg border px-3 py-1.5 text-[13px] font-bold transition ${on ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300 text-gray-600"}`;
  const boardOf = (g, a) => record?.boards?.find((b) => b.grade === g && b.area === a);
  const perLine = parsed.length ? (Number(size) / parsed.length).toFixed(1) : "-";

  return (
    <div>
      <h2 className="text-lg font-extrabold text-sm-navy">합격 생기부</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">계열 × 학교 단계마다 재구성한 생기부 하나. 공개한 생기부의 공개한 판만 학생에게 보여요.</p>

      {/* 계열 · 단계 고르기 */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {ov.tracks.map((t) => (
          <button key={t.id} onClick={() => setTrack(t.id)} className={chip(track === t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ov.tiers.map((t) => {
          const r = ov.records.find((x) => x.track_id === track && x.tier_id === t.id);
          return (
            <button key={t.id} onClick={() => setTier(t.id)} className={chip(tier === t.id)} title={t.schools}>
              ★{t.stars} {t.schools.split(" · ")[0]}
              {openOn[t.id] && <span className="ml-1 text-[11px] opacity-70">{Number(openOn[t.id].slice(5, 7))}/{Number(openOn[t.id].slice(8, 10))}</span>}
              {r && <span className="ml-1 text-[11px] opacity-80">· {STATUS[r.status]}</span>}
            </button>
          );
        })}
      </div>

      {/* 생기부 */}
      <div className="mt-4 rounded-xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px] text-gray-500">
            {trackRow?.name} 계열 · ★{tierRow?.stars} {tierRow?.schools} · 학년 판 {tierRow?.grade_total}칸
          </p>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-gray-600">
            {tierRow?.schools} 여는 날 (모든 계열 같이)
            <input
              type="date"
              value={openOn[tier] ?? ""}
              onChange={(e) => saveOpenOn(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-[13px]"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="제목 (예: 공학 계열 가천대급 합격 사례)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-sm-orange"
          />
          <input
            value={form.basis}
            onChange={(e) => setForm({ ...form, basis: e.target.value })}
            placeholder="근거 표시 (예: 합격생 312명의 생기부를 바탕으로 재구성)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-sm-orange"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={saveRecord} disabled={busy} className="rounded-lg bg-sm-navy px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
            {record ? "제목 저장" : "생기부 만들기"}
          </button>
          {record && (
            <>
              <span className="ml-2 text-[12.5px] text-gray-500">
                지금: <b className="text-sm-navy">{STATUS[record.status]}</b>
              </span>
              {["draft", "live", "hidden"].map((s) => (
                <button key={s} onClick={() => setRecordStatus(s)} className={chip(record.status === s)}>
                  {STATUS[s]}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 판 12개 */}
      {record && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
              <tr>
                <th className="px-4 py-2.5">학년</th>
                {AREAS.map((a) => (
                  <th key={a.k} className="px-4 py-2.5">{a.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((g) => (
                <tr key={g} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 font-bold text-sm-navy">{g}학년</td>
                  {AREAS.map((a) => {
                    const b = boardOf(g, a.k);
                    const on = sel.grade === g && sel.area === a.k;
                    return (
                      <td key={a.k} className="px-2 py-2">
                        <button
                          onClick={() => {
                            setSel({ grade: g, area: a.k });
                            setPdf(null);
                            setUpMsg("");
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-left ${on ? "border-sm-orange bg-orange-50" : "border-gray-200"}`}
                        >
                          <span className={`block text-[11.5px] font-bold ${b?.status === "live" ? "text-emerald-600" : "text-gray-400"}`}>
                            {b?.status === "live" ? "공개" : "준비 중"}
                          </span>
                          <span className="block text-[12.5px] text-sm-navy">
                            {b?.kind === "pdf" ? "PDF" : `${num(b?.lines)}줄`} · {num(b?.size)}칸
                          </span>
                          {num(b?.students) > 0 && <span className="block text-[11px] text-gray-400">학생 {b.students}명 여는 중</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PDF로 넣기 — 첫 장이 퍼즐, 다 깨면 PDF 받기 */}
      {record && (
        <div className="mt-4 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50/40 p-5">
          <p className="text-[15px] font-extrabold text-sm-navy">
            {sel.grade}학년 {AREA_LABEL[sel.area]} 판 · PDF로 넣기
          </p>
          <p className="mt-1 text-[12.5px] text-gray-500">
            PDF 첫 장이 퍼즐이 되고, 판을 다 깬 학생은 이 PDF를 받아요. 이름·학교·지역·선생님 이름은 가린 PDF로 올려 주세요.
          </p>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => pickPdf(e.target.files?.[0])}
            className="mt-3 block w-full text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-sm-navy file:px-4 file:py-2 file:text-[13px] file:font-bold file:text-white"
          />
          {!pdf && boardOf(sel.grade, sel.area)?.kind === "pdf" && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-white px-4 py-3 ring-1 ring-orange-200">
              <p className="text-[13px] text-gray-600">
                지금 이 판: PDF <b className="text-sm-navy">{num(boardOf(sel.grade, sel.area)?.size)}칸</b>
              </p>
              <button onClick={reloadPdf} disabled={busy} className="ml-auto rounded-lg bg-sm-orange px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
                칸 수 바꾸기
              </button>
            </div>
          )}

          {pdf && (
            <div className="mt-4 flex flex-wrap gap-5">
              {/* 미리보기: 첫 장 위에 칸 나눈 선 */}
              <div className="relative w-[260px] shrink-0 overflow-hidden border border-gray-300 bg-white">
                <img src={pdf.preview} alt="첫 장 미리보기" className="block w-full" />
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: `repeat(${pdf.cols}, 1fr)`, gridTemplateRows: `repeat(${pdf.rows}, 1fr)` }}
                >
                  {Array.from({ length: pdf.cols * pdf.rows }, (_, i) => (
                    <span key={i} className="border border-sm-orange/60" />
                  ))}
                </div>
              </div>
              <div className="min-w-[220px] flex-1">
                <p className="text-[13px] text-gray-600">파일: <b className="text-sm-navy">{pdf.file.name}</b></p>
                <p className="mt-2 text-[13px] text-gray-600">
                  칸 나누기: 가로 <b className="text-sm-navy">{pdf.cols}</b> × 세로 <b className="text-sm-navy">{pdf.rows}</b> ={" "}
                  <b className="text-sm-orange">{pdf.cols * pdf.rows}칸</b>
                  <span className="text-gray-400"> (기본 {areaSize(tierRow?.grade_total ?? 0, sel.area)}칸에 맞춤)</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    ["가로 −", () => setPdf((p) => ({ ...p, cols: Math.max(2, p.cols - 1) }))],
                    ["가로 +", () => setPdf((p) => ({ ...p, cols: Math.min(12, p.cols + 1) }))],
                    ["세로 −", () => setPdf((p) => ({ ...p, rows: Math.max(2, p.rows - 1) }))],
                    ["세로 +", () => setPdf((p) => ({ ...p, rows: Math.min(20, p.rows + 1) }))],
                  ].map(([l, f]) => (
                    <button key={l} onClick={f} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-bold text-gray-600">
                      {l}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={() => uploadPdf("draft")} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13px] font-bold text-gray-600 disabled:opacity-50">
                    준비 중으로 올리기
                  </button>
                  <button onClick={() => uploadPdf("live")} disabled={busy} className="rounded-lg bg-sm-orange px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
                    올리고 이 판 공개
                  </button>
                </div>
              </div>
            </div>
          )}
          {upMsg && <p className="mt-3 text-[12.5px] font-bold text-sm-navy">{upMsg}</p>}
        </div>
      )}

      {/* 판 편집 (글로 넣기) — PDF로 넣은 판에서는 숨긴다 */}
      {record && board && boardOf(sel.grade, sel.area)?.kind !== "pdf" && (
        <div className="mt-4 rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[15px] font-extrabold text-sm-navy">
              {sel.grade}학년 {AREA_LABEL[sel.area]} 판
            </p>
            <label className="ml-auto flex items-center gap-2 text-[13px] text-gray-600">
              판 크기
              <input
                type="number"
                min={Math.max(1, num(board.max_opened))}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-[14px]"
              />
              칸
            </label>
          </div>
          <p className="mt-1 text-[12px] text-gray-400">
            한 줄에 하나씩: <b className="text-gray-600">라벨 | 문장 | 이 문장에서 볼 것(선택)</b> · 예) 국어 | 소설 속 갈등 구조를… | 질문을 탐구로 이어간 부분
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={"자율 | 학급 환경부장으로 … | 생활 속 문제를 데이터로 본 점\n동아리 | (화학탐구반) … |"}
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed outline-none focus:border-sm-orange"
          />
          <p className="mt-1.5 text-[12.5px] text-gray-500">
            문장 <b className="text-sm-navy">{parsed.length}줄</b> · 판 <b className="text-sm-navy">{size}칸</b> · 한 줄에 조각 약 {perLine}개
            {parsed.length > Number(size) && <b className="ml-2 text-red-500">줄이 칸보다 많아요</b>}
            {num(board.students) > 0 && <span className="ml-2 text-orange-600">학생 {board.students}명이 여는 중 · 줄 수를 바꾸면 학생이 본 문장 위치가 달라질 수 있어요</span>}
          </p>

          {/* 미리보기 */}
          {parsed.length > 0 && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-gray-100">
              {parsed.slice(0, 50).map((l, i) => (
                <div key={i} className="flex gap-3 border-b border-gray-50 px-3 py-2 text-[12.5px] last:border-0">
                  <span className="w-6 shrink-0 text-gray-400">{i + 1}</span>
                  <span className="w-16 shrink-0 font-bold text-sm-navy">{l.label}</span>
                  <span className="flex-1 text-gray-700">{l.body}</span>
                  {l.insight && <span className="w-40 shrink-0 text-gray-400">{l.insight}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => saveBoard("draft")} disabled={busy} className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-bold text-gray-600 disabled:opacity-50">
              준비 중으로 저장
            </button>
            <button onClick={() => saveBoard("live")} disabled={busy || !parsed.length} className="rounded-lg bg-sm-orange px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
              저장하고 이 판 공개
            </button>
            {msg && <span className="text-[12.5px] font-bold text-sm-navy">{msg}</span>}
          </div>
          <p className="mt-2 text-[11.5px] text-gray-400">학생에게 보이려면 이 판 공개 + 위의 생기부도 '공개'여야 해요.</p>
        </div>
      )}
      {!record && msg && <p className="mt-3 text-[12.5px] font-bold text-sm-navy">{msg}</p>}
    </div>
  );
}