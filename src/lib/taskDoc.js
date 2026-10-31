/* 수행평가 완성본 → 제출 파일 (src/lib/taskDoc.js · 물꼬 Agent.jsx 의 DocButton 에서 쓴다)
 * 완성본(school_tasks.draft · 마크다운 # ## ### · - 목록 · **굵게** · | 표 |)을 학생 브라우저에서 바로 파일로 만든다 (AI 다시 안 부름 · 비용 없음)
 *   docx : 워드 · 구글 문서 (맑은 고딕 11pt)
 *   hwp  : 한글용 문서 (.docx 를 한글 기본 글꼴 함초롬바탕 10pt · 줄 간격 160%로 — 한글에서 열어 'HWP로 저장')
 *   pdf  : 인쇄 화면을 띄워 'PDF로 저장' (글꼴이 깨지지 않게 브라우저 인쇄를 쓴다)
 */
const BLANK = /\[\[\s*직접 입력\s*[:：]\s*([^\]]*)\]\]/g;

// 마크다운 → 블록 [{ t: "h1"|"h2"|"h3"|"p"|"li"|"ol"|"table", text, rows }]
export function parseMd(md) {
  const lines = String(md ?? "").replace(/\r/g, "").replace(BLANK, "[직접 입력: $1]").split("\n");
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push({ t: "p", text: para.join(" ") }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { flush(); continue; }
    if (l.startsWith("|")) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const r = lines[i].trim();
        if (!/^\|[\s:|-]+\|$/.test(r)) rows.push(r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      if (rows.length) out.push({ t: "table", rows });
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); out.push({ t: h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3", text: h[2] }); continue; }
    if (/^[-•*·]\s+/.test(l)) { flush(); out.push({ t: "li", text: l.replace(/^[-•*·]\s+/, "") }); continue; }
    if (/^\d+[.)]\s+/.test(l)) { flush(); out.push({ t: "ol", text: l, num: l.match(/^(\d+)/)[1] }); continue; }
    para.push(l);
  }
  flush();
  return out;
}
// **굵게** → [{ text, bold }]
export const runsOf = (s) => String(s ?? "").split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false }));
const fileName = (s) => String(s || "수행평가").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
}

// 워드 · 한글용 문서
export async function makeDocx(D, task, kind = "docx") {
  const hwp = kind === "hwp";
  const FONT = hwp ? "함초롬바탕" : "맑은 고딕";
  const BODY = hwp ? 20 : 22; // half-point (10pt · 11pt)
  const LINE = hwp ? 384 : 360; // 160% · 150%
  const blocks = parseMd(task.draft);
  // 완성본 맨 위 # 제목이 있으면 그걸 문서 제목으로
  const firstH1 = blocks.findIndex((b) => b.t === "h1");
  const title = firstH1 === 0 ? blocks[0].text : task.title || "수행평가";
  const body = firstH1 === 0 ? blocks.slice(1) : blocks;
  const run = (r, o = {}) => new D.TextRun({ text: r.text, bold: r.bold || o.bold, size: o.size ?? BODY, font: FONT, color: o.color });
  const P = (children, o = {}) => new D.Paragraph({ children, spacing: { line: LINE, after: o.after ?? 120, before: o.before ?? 0 }, alignment: o.align, indent: o.indent });
  const kids = [
    P([new D.TextRun({ text: title.replace(/\*\*/g, ""), bold: true, size: hwp ? 32 : 34, font: FONT })], { align: D.AlignmentType.CENTER, after: 120 }),
    P([new D.TextRun({ text: [task.subject, "학번 ________  이름 ________"].filter(Boolean).join("     "), size: BODY - 2, font: FONT, color: "555555" })], { align: D.AlignmentType.RIGHT, after: 360 }),
  ];
  for (const b of body) {
    if (b.t === "h1" || b.t === "h2") kids.push(P([new D.TextRun({ text: b.text.replace(/\*\*/g, ""), bold: true, size: BODY + 4, font: FONT })], { before: 240, after: 120 }));
    else if (b.t === "h3") kids.push(P([new D.TextRun({ text: b.text.replace(/\*\*/g, ""), bold: true, size: BODY + 2, font: FONT })], { before: 160, after: 80 }));
    else if (b.t === "li") kids.push(P([new D.TextRun({ text: "· ", size: BODY, font: FONT }), ...runsOf(b.text).map((r) => run(r))], { indent: { left: 240, hanging: 160 }, after: 60 }));
    else if (b.t === "ol") kids.push(P(runsOf(b.text).map((r) => run(r)), { indent: { left: 240, hanging: 240 }, after: 60 }));
    else if (b.t === "table") {
      kids.push(new D.Table({
        width: { size: 100, type: D.WidthType.PERCENTAGE },
        rows: b.rows.map((row, ri) => new D.TableRow({
          children: row.map((c) => new D.TableCell({
            shading: ri === 0 ? { fill: "F1F3F8" } : undefined,
            children: [new D.Paragraph({ children: runsOf(c).map((r) => run(r, { bold: ri === 0, size: BODY - 2 })), spacing: { line: 300 } })],
          })),
        })),
      }));
      kids.push(P([], { after: 120 }));
    } else kids.push(P(runsOf(b.text).map((r) => run(r)), { indent: hwp ? { firstLine: 200 } : undefined }));
  }
  const doc = new D.Document({
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections: [{ properties: { page: { margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } }, children: kids }], // A4 · 여백 25mm
  });
  const blob = await D.Packer.toBlob(doc);
  downloadBlob(blob, `${fileName(title)}${hwp ? "_한글용" : ""}.docx`);
}

// PDF — 인쇄 화면 (학생이 'PDF로 저장'을 고른다)
export function printPdf(task) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) => runsOf(s).map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text))).join("");
  const blocks = parseMd(task.draft);
  const firstH1 = blocks.findIndex((b) => b.t === "h1");
  const title = firstH1 === 0 ? blocks[0].text : task.title || "수행평가";
  const body = (firstH1 === 0 ? blocks.slice(1) : blocks).map((b) => {
    if (b.t === "h1" || b.t === "h2") return `<h2>${inline(b.text)}</h2>`;
    if (b.t === "h3") return `<h3>${inline(b.text)}</h3>`;
    if (b.t === "li") return `<p class="li">· ${inline(b.text)}</p>`;
    if (b.t === "ol") return `<p class="li">${inline(b.text)}</p>`;
    if (b.t === "table") return `<table>${b.rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join("")}</tr>`).join("")}</table>`;
    return `<p>${inline(b.text)}</p>`;
  }).join("\n");
  const w = window.open("", "_blank");
  if (!w) return false; // 팝업이 막힘
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title.replace(/\*\*/g, ""))}</title>
<style>
@page { size: A4; margin: 22mm 20mm; }
body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: #111; font-size: 11pt; line-height: 1.75; margin: 0; }
h1 { text-align: center; font-size: 17pt; margin: 0 0 4mm; }
.meta { text-align: right; color: #555; font-size: 10pt; margin-bottom: 9mm; }
h2 { font-size: 13pt; margin: 7mm 0 2mm; } h3 { font-size: 12pt; margin: 5mm 0 1.5mm; }
p { margin: 0 0 2.5mm; } p.li { padding-left: 4mm; text-indent: -3mm; margin-bottom: 1mm; }
table { border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; font-size: 10pt; } th, td { border: 1px solid #bbb; padding: 1.5mm 2mm; text-align: left; } th { background: #f1f3f8; }
</style></head><body>
<h1>${inline(title)}</h1><div class="meta">${esc(task.subject || "")}&nbsp;&nbsp;&nbsp;학번 ________ 이름 ________</div>
${body}
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  w.document.close();
  return true;
}