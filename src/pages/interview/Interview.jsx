import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import { getClientId } from "../../lib/clientId";
import { UNIVERSITIES, DEPARTMENTS } from "../motive/Motive";
import Paywall from "../inquiry/Paywall";

/*
 * 내 생기부 면접 예상 질문 — /interview
 * 결제 전 (회원·비회원): 대학별 질문 성향을 먼저 보여주고 → 지원 대학·학과 + 걱정되는 활동 1개(최대 4개) → 질문은 활동 수 + 1개
 *   무료는 계정 1번 + 기기 1번 (처음 한 번만)
 *   비회원: 1개(5개면 2개)만 또렷하게, 나머지는 흐리게 → 가입하면 그 자리에서 전부 (다시 뽑지 않음)
 *   회원: 전부 보이고 + [전체 열기] 결제
 * 결제 후: 질문 만들기는 서버가 뒤에서 돌린다 — job 번호를 받아 3초마다 확인 (다른 화면에 다녀와도 이어서 기다린다)
 * 결제 후: 가이드 PDF(Supabase 비공개 버킷 guides — 서버가 10분짜리 링크를 준다)로 생기부를 ChatGPT에 넣어 엑셀로 정리 → 엑셀 올리기(화면에서 바로 읽음) → 활동마다 질문 1개
 *   1곳 상품(19,000원): 처음 뽑은 대학으로 고정 / 6곳 상품(24,000원): 대학 6곳까지, 대학마다 질문 따로
 *   하루 3번, 대학별 PDF
 * 쓰는 내용은 이 브라우저에 자동 저장 (로그인하러 다녀와도 남는다)
 */

const DRAFT_KEY = "sm_interview_draft";
const JOB_KEY = "sm_interview_job"; // 결제 후 만들고 있는 질문의 job 번호 — 다른 화면에 갔다 와도 이어서 확인한다
const GUEST_KEY = "sm_interview_guest"; // 비회원으로 질문을 뽑았다는 표시 — 가입하고 돌아오면 기록을 계정으로 옮긴다
const BASE = "고3 1학기"; // 결제 전에 채우는 학기
const MAX_EXCEL = 80; // 엑셀에서 읽는 활동 최대 수 (서버와 같게)
const emptyTerm = () => ({ subjects: [{ subject: "", content: "" }], club: "", career: "", autonomy: "" });
const newFree = () => ({ kind: "subject", subject: "", grade: "", content: "" });
const GRADES = ["고1", "고2", "고3"]; // 활동마다 고르는 학년 (세특·동아리·진로·자율봉사)
const EMPTY = { university: "", department: "", rec: { [BASE]: emptyTerm() }, free: [newFree()], excel: null, targets: [{ university: "", department: "" }] };
const KIND_CHIPS = [
  ["subject", "세특"],
  ["club", "동아리"],
  ["career", "진로"],
  ["autonomy", "자율"],
];
const FREE_MAX = 4; // 결제 전 활동은 최대 4개
// 고른 칩(세특·동아리·진로·자율)에 맞춰 바뀌는 예시 문구 — 빈칸 안에 회색 글씨로 보인다
const FREE_PH = {
  subject: "예) 생명과학 시간에 천연 추출물의 항균 효과를 실험하고 결과를 비교해서 발표했어요",
  club: "예) 보건 동아리에서 미세먼지가 몸에 주는 영향을 조사해서 발표했어요",
  career: "예) 진로 시간에 간호사 인터뷰 영상을 보고 하는 일을 정리해서 발표했어요",
  autonomy: "예) 학급 자치회에서 게시판 관리를 맡아 공지와 행사 정보를 정리했어요",
};
// 맨 위 비교 — 같은 활동을 두 대학이 어떻게 다르게 묻는지 (직접 쓴 예시, 여기만 고치면 화면이 바뀐다)
//   stat·desc는 지금 화면에 안 쓴다 (나중에 다시 쓸 수 있어서 남겨 둠)
const COMPARE_ACTIVITY = "천연 추출물의 항균 효과를 실험하고 억제 정도를 비교함";
const COMPARE = [
  {
    univ: "가천대",
    label: "개념 꼬리질문형",
    q: "추출물이 세균을 억제하는 원리, 설명해 볼래요?",
    follow: "그럼 항생제와는 작용 방식이 뭐가 다를까요?",
    title: "가천대는 이렇게 파고들어요",
    stat: "① 52% · ③ 22%",
    qs: ["추출물이 세균을 억제하는 원리를 설명해 볼래요?", "그럼 항생제와는 작용 방식이 어떻게 달라요?", "억제 정도는 어떻게 비교했어요? 통계는 직접 계산했어요?"],
    desc: "개념 하나를 잡고 모를 때까지 두세 단계 더 파고들어요.",
  },
  {
    univ: "경희대",
    label: "과정 확인형",
    q: "그 실험, 어떻게 진행했는지 말해 줄래요?",
    follow: "실험에 쓴 균주는 뭐였어요?",
    title: "경희대는 이렇게 확인해요",
    stat: "③ 43%",
    qs: ["이 실험, 어떻게 진행했는지 설명해 줄래요?", "실험에 사용한 균주는 무엇이었어요?", "결과가 예상과 다르게 나온 부분은 왜 그렇다고 생각해요?"],
    desc: "서류에 적힌 활동을 실제로 어떻게 했는지 짚어요.",
  },
];
// 대학을 고르면 카드에 보여주는 생기부 질문 성향 (생수면 면접 후기 분석 · 생기부 질문 10개 이상인 대학만)
const UNIV_STATS = {
  가천대학교: "① 개념 52% · ③ 과정 22%",
  서울여자대학교: "③ 과정 50% · ① 개념 29%",
  중앙대학교: "① 개념 57% · ③ 과정 14%",
  한국외국어대학교: "① 개념 21% · ④ 역할 21% · ⑥ 주장 21%",
  서울시립대학교: "① 개념 52% · ③ 과정 19%",
  이화여자대학교: "③ 과정 42% · ④ 역할 25%",
  건국대학교: "① 개념 48% · ③ 과정 21%",
  동국대학교: "① 개념 44% · ③ 과정 20%",
  숙명여자대학교: "① 개념 48% · ③ 과정 25%",
  국민대학교: "③ 과정 33% · ① 개념 26%",
  숭실대학교: "③ 과정 44% · ① 개념 28%",
  세종대학교: "③ 과정 53% · ① 개념 25%",
  광운대학교: "① 개념 46% · ③ 과정 32%",
  명지대학교: "④ 역할 28% · ③ 과정 25%",
};
const CHANNEL = "#7C3AED"; // 면접 예상질문 색
// 지금 면접 성향·꼬리질문 예시를 준비한 대학 (우선 인서울 24곳) — 대학 칸 자동완성에서 맨 위에 먼저 보여준다
const SERVICE_UNIVS = [
  "서울대학교", "성균관대학교", "한양대학교", "중앙대학교", "경희대학교", "한국외국어대학교", "서울시립대학교", "이화여자대학교",
  "건국대학교", "동국대학교", "숙명여자대학교", "국민대학교", "숭실대학교", "세종대학교", "광운대학교", "명지대학교",
  "상명대학교", "서울과학기술대학교", "성신여자대학교", "동덕여자대학교", "덕성여자대학교", "서울여자대학교", "삼육대학교", "성공회대학교",
];
// 대학 설명은 길어서 앞의 한두 문장만 (최대 n자)
const brief = (t, n = 110) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const parts = s.split(/(?<=[.다요])\s/);
  let out = "";
  for (const x of parts) {
    if ((out + " " + x).trim().length > n) break;
    out = (out + " " + x).trim();
  }
  return out || s.slice(0, n) + "…";
};

// 예전 저장본(고3 1학기 4칸)도 지금 구조로 옮긴다 — 이미 써 둔 내용이 사라지지 않게
function migrate(saved) {
  const base = saved.rec?.[BASE] ?? {
    subjects: [{ subject: saved.subject ?? "", content: saved.subj ?? "" }],
    club: saved.club ?? "",
    career: saved.career ?? "",
    autonomy: saved.autonomy ?? "",
  };
  return {
    university: saved.university ?? "",
    department: saved.department ?? "",
    rec: { [BASE]: { ...emptyTerm(), ...base } },
    free: Array.isArray(saved.free) && saved.free.length ? saved.free.map((a) => ({ ...a, content: String(a.content ?? "").replace(/[\s\u200B-\u200D\uFEFF]/g, "") ? a.content : "" })) : fromBase(base),
    excel: saved.excel?.acts?.length ? saved.excel : null,
    targets: Array.isArray(saved.targets) && saved.targets.length ? saved.targets : [{ university: saved.university ?? "", department: saved.department ?? "" }],
  };
}

// 예전 4칸 저장본 → 결제 전 활동 목록 (채운 칸만, 없으면 빈 칸 하나)
function fromBase(t) {
  const s = t?.subjects?.[0] ?? {};
  const list = [
    ...(String(s.content ?? "").trim() ? [{ kind: "subject", subject: s.subject ?? "", content: s.content }] : []),
    ...["club", "career", "autonomy"].filter((k) => String(t?.[k] ?? "").trim()).map((k) => ({ kind: k, subject: "", content: t[k] })),
  ];
  return list.length ? list : [newFree()];
}

// 고3 1학기 4칸을 서버로 보낼 모양으로 (세특은 첫 칸만)
function baseActivities(t) {
  if (!t) return [];
  const s = t.subjects?.[0] ?? { subject: "", content: "" };
  return [
    ...(s.subject.trim() && s.content.trim() ? [{ grade: "고3", term: "1학기", kind: "subject", subject: s.subject, content: s.content }] : []),
    ...["club", "career", "autonomy"].filter((kind) => t[kind].trim()).map((kind) => ({ grade: "고3", term: "1학기", kind, content: t[kind] })),
  ];
}

/* 가이드 엑셀 → 활동 목록
 * 열: 학년 | 출처 | 과목/활동영역 | 활동명 | 한 활동 | 학과와 닿는 지점 | 면접질문
 * 열 이름으로 찾아서, 열 순서가 바뀌거나 시트가 여러 개여도 읽는다 */
const kindOf = (src) => {
  const s = String(src ?? "");
  if (/세특|교과/.test(s)) return "subject";
  if (/동아리/.test(s)) return "club";
  if (/진로/.test(s)) return "career";
  return "autonomy"; // 자율·봉사·행동특성
};
const gradeOf = (g) => {
  const m = String(g ?? "").match(/[123]/);
  return m ? `고${m[0]}` : "";
};
async function readExcel(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const acts = [];
  wb.SheetNames.forEach((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const hi = rows.findIndex((r) => r.some((c) => String(c).replace(/\s/g, "") === "한활동"));
    if (hi < 0) return;
    const head = rows[hi].map((c) => String(c).replace(/\s/g, ""));
    const col = (...keys) => head.findIndex((h) => keys.some((k) => h.includes(k)));
    const c = { grade: col("학년"), src: col("출처", "구분"), area: col("과목", "활동영역"), title: col("활동명", "제목"), content: col("한활동"), link: col("학과와닿는", "학과") };
    rows.slice(hi + 1).forEach((r) => {
      const cell = (i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
      const content = cell(c.content);
      if (!content) return;
      const kind = kindOf(cell(c.src));
      const area = cell(c.area);
      acts.push({
        grade: gradeOf(cell(c.grade)),
        term: "",
        kind,
        subject: kind === "subject" ? area : "",
        title: [kind === "subject" ? "" : area, cell(c.title)].filter(Boolean).join(" · "),
        content: content.slice(0, 600),
        link: cell(c.link).slice(0, 600),
        raw: [cell(c.grade), cell(c.src), area, cell(c.title)], // 엑셀로 돌려줄 때 원래 칸 그대로 쓴다
      });
    });
  });
  return acts.slice(0, MAX_EXCEL);
}
const KIND_NAME = { subject: "세특", club: "동아리", career: "진로", autonomy: "자율" };

/* 뽑은 질문을 올린 엑셀과 같은 모양으로 — 면접질문 열을 채워서 내려받는다 (대학마다 시트 하나) */
async function downloadExcel(list, acts) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set();
  list.forEach((r) => {
    const byAct = acts.map(() => []);
    const extra = [];
    (r.groups ?? []).forEach((g) =>
      g.questions.forEach((q, i) => {
        const a = g.acts?.[i];
        if (a != null && a >= 0 && a < acts.length) byAct[a].push(q);
        else extra.push(q);
      })
    );
    const rows = [
      ["학년", "출처", "과목/활동영역", "활동명", "한 활동", "학과와 닿는 지점", "면접질문"],
      ...acts.map((a, i) => [...(a.raw ?? [a.grade, KIND_NAME[a.kind], a.subject, a.title]), a.content, a.link ?? "", byAct[i].join("\n")]),
      ...extra.map((q) => ["", "", "", "", "", "", q]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 7 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 60 }, { wch: 28 }, { wch: 50 }];
    let name = `${r.university} ${r.department}`.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
    while (used.has(name)) name = name.slice(0, 29) + "_" + used.size;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  const file = list.length === 1 ? `${list[0].university}_${list[0].department}_면접예상질문.xlsx` : `면접예상질문_${list.length}개대학.xlsx`;
  XLSX.writeFile(wb, file.replace(/\s/g, ""));
}

const norm = (s) => s.replace(/\s/g, "").toLowerCase();
const univKey = (n) => norm(n).replace(/\(.*?\)/g, "").replace(/대학교/g, "대").replace(/대학/g, "대");
function suggest(q, options) {
  const n = norm(q);
  if (!n) return [];
  const hits = options.filter((o) => norm(o).includes(n));
  if (hits.length === 1 && hits[0] === q) return [];
  return hits.sort((a, b) => Number(norm(b).startsWith(n)) - Number(norm(a).startsWith(n))).slice(0, 6);
}
function SuggestList({ items, onPick }) {
  if (!items.length) return null;
  return (
    <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-white py-1 text-left shadow-lg ring-1 ring-black/10">
      {items.map((it) => (
        <li key={it}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it);
            }}
            className="block w-full px-4 py-2.5 text-left text-[14.5px] text-gray-800 hover:bg-violet-50"
          >
            {it}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* 뽑은 질문을 A4로 인쇄 → 'PDF로 저장' (여러 대학이면 대학마다 새 쪽) */
export function printPdf(list) {
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pages = list
    .map((r, idx) => {
      let n = 0;
      const groups = r.groups
        .map(
          (g) => `<section><h2>${esc(g.title)}</h2><ol>${g.questions
            .map((q) => `<li><span class="n">${++n}</span><span class="q">${esc(q)}</span></li>`)
            .join("")}</ol></section>`
        )
        .join("");
      return `<div class="page${idx ? " brk" : ""}"><header><h1>${esc(r.university)} ${esc(r.department)} 면접 예상 질문</h1>
<div class="sub">내 생활기록부 기준 · 예상 질문 ${r.total}개${r.has_univ_data ? " · 생수면 대학별 면접 분석 데이터 반영" : ""}</div></header>${groups}</div>`;
    })
    .join("");
  const title = list.length === 1 ? `${list[0].university} ${list[0].department} 면접 예상 질문` : `면접 예상 질문 (${list.length}개 대학)`;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 16mm; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; color: #111; margin: 0; }
.brk { page-break-before: always; }
header { border-bottom: 2px solid #18224F; padding-bottom: 10px; margin-bottom: 14px; }
h1 { font-size: 20px; margin: 0; color: #18224F; }
.sub { font-size: 12px; color: #555; margin-top: 4px; }
h2 { font-size: 14.5px; color: #18224F; margin: 18px 0 8px; padding: 5px 10px; background: #EEF1FA; border-radius: 6px; }
ol { list-style: none; padding: 0; margin: 0; }
li { display: flex; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #E5E7EB; font-size: 13px; line-height: 1.55; page-break-inside: avoid; }
.n { flex: none; width: 22px; font-weight: 700; color: #EA580C; }
footer { margin-top: 18px; text-align: center; font-size: 11px; color: #888; }
</style></head><body>${pages}
<footer>생수면 · 예상 질문은 참고용이에요. 실제 면접 질문과 다를 수 있어요.</footer>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return window.alert("팝업이 막혔어요. 주소창 오른쪽에서 팝업을 허용해 주세요.");
  w.document.open();
  w.document.write(html);
  w.document.close();
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    w.focus();
    w.print();
  };
  w.onload = go;
  setTimeout(go, 700);
}

/* 기다리는 화면 — 막대는 천천히 오르다 99%에서 기다리고, 결과가 오면 100% */
function Waiting({ university, done, full }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setSec((Date.now() - t0) / 1000), 200);
    return () => clearInterval(t);
  }, []);
  const p = done ? 100 : Math.min(99, Math.round(100 * (1 - Math.exp(-sec / (full ? 30 : 9)))));
  const titles = full
    ? ["올린 활동을 읽고 있어요", `${university} 면접 스타일과 맞춰 보고 있어요`, "활동마다 예상 질문을 정리하고 있어요"]
    : ["내 활동을 읽고 있어요", `${university} 면접 스타일과 맞춰 보고 있어요`, "나올 가능성이 큰 질문을 고르고 있어요"];
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 px-6 py-9 text-center" role="status" aria-live="polite">
      <p className="text-[17px] font-extrabold text-sm-navy">{titles[Math.min(2, Math.floor(p / 34))]}</p>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${p}%`, background: CHANNEL }} />
      </div>
      <p className="mt-3 text-[24px] font-black text-sm-navy">{p}%</p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
        내 활동을 <b className="text-sm-navy">{university} 면접 스타일</b>에 맞춰 보고 있어요
      </p>
      <p className="mt-1 text-[12px] text-gray-400">
        {full ? "보통 1~2분 걸려요 · 다른 화면에 다녀와도 계속 만들어져요" : "보통 15~30초 걸려요 · 이 화면을 닫지 마세요"}
      </p>
    </div>
  );
}

/* 질문 목록 */
function Questions({ groups, start = 0 }) {
  let n = start;
  return groups.map((g) => (
    <section key={g.title} className="mt-4">
      <h2 className="rounded-lg bg-indigo-50 px-3 py-2 text-[14.5px] font-extrabold text-sm-navy">{g.title}</h2>
      <ol className="mt-1">
        {g.questions.map((q) => (
          <li key={q} className="flex gap-2.5 border-b border-gray-100 px-1 py-3 text-[14.5px] leading-relaxed text-gray-800">
            <span className="w-6 shrink-0 font-extrabold text-sm-orange">{++n}</span>
            {q}
          </li>
        ))}
      </ol>
    </section>
  ));
}

/* 결제 전 고3 1학기 4칸 — 세특 1개 · 동아리 · 진로 · 자율 */
const PH = {
  subj: "예) CT 촬영 때 몸속 금속 때문에 생기는 영상 왜곡이 궁금해, 적분으로 왜곡을 보정하는 원리를 조사해 발표함",
  club: "예) 보건 동아리에서 '탄소가 인체에 미치는 영향'을 주제로 블랙카본이 몸에 주는 영향과 줄이는 방법을 조사해 발표함",
  career: "예) X-ray·MRI에 쓰이는 파장의 특성과 의료에서 쓰이는 방식을 비교하는 '의료 파장 연구'를 진행함",
  autonomy: "예) 학급 자치회에서 게시판 관리를 맡아 공지사항과 동아리 활동 정보를 정리해 친구들이 쉽게 보게 함",
};
function BaseFields({ t, field, area, onTerm, onSubj }) {
  const s = t.subjects?.[0] ?? { subject: "", content: "" };
  return (
    <>
      <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
        <p className="text-[13px] font-extrabold text-sm-navy">세특 (교과 활동) 1개</p>
        <input value={s.subject} onChange={(e) => onSubj("subject", e.target.value)} placeholder="과목 (예: 수학Ⅱ)" className={`${field} mt-2 bg-white`} />
        <textarea value={s.content} onChange={(e) => onSubj("content", e.target.value)} placeholder={PH.subj} className={`${area} bg-white`} />
      </div>
      {[
        ["club", "동아리"],
        ["career", "진로"],
        ["autonomy", "자율 · 봉사"],
      ].map(([k, label]) => (
        <div key={k} className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
          <p className="text-[13px] font-extrabold text-sm-navy">{label}</p>
          <textarea value={t[k]} onChange={(e) => onTerm(k, e.target.value)} placeholder={PH[k]} className={`${area} bg-white`} />
        </div>
      ))}
    </>
  );
}

// 결제 전 흐림 처리에 쓰는 자리 문장 (실제 질문이 아니다 — 실제 질문은 결제 후에 뽑는다)
const LOCKED_SAMPLE = [
  { title: "전공과 가까운 활동", questions: ["이 활동에서 조사한 내용 중 전공 공부와 비슷하다고 느낀 부분은 무엇인가요?", "활동하면서 생긴 궁금증을 어떻게 더 알아봤나요?"] },
  { title: "생기부 활동 확인", questions: ["동아리에서 맡은 역할과 그 결과를 구체적으로 말해 주세요.", "이 활동을 하면서 가장 크게 달라진 생각은 무엇인가요?"] },
];

export default function Interview() {
  const nav = useNavigate();
  const { state } = useLocation();
  const { user, loading: authLoading } = useAuth();

  // 쓰는 내용 — 브라우저에 자동 저장 (지원동기 결과에서 넘어오면 대학·학과를 채운다)
  const [d, setD] = useState(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") ?? {};
    } catch {
      saved = {};
    }
    const m = { ...EMPTY, ...migrate(saved) };
    if (state?.university) m.university = state.university;
    if (state?.department) m.department = state.department;
    return m;
  });
  const [agree, setAgree] = useState(false);
  const [focus, setFocus] = useState(null);
  const [view, setView] = useState("input"); // input | loading | result
  const [done, setDone] = useState(false);
  const [running, setRunning] = useState(null); // 지금 뽑는 중인 종류 preview | full
  const [result, setResult] = useState(null); // 결제 전 결과
  const [results, setResults] = useState([]); // 결제 후 결과 (대학별)
  const [ri, setRi] = useState(0); // 결제 후 결과에서 보고 있는 대학
  const [isPreview, setIsPreview] = useState(true);
  const [isGuest, setIsGuest] = useState(false); // 비회원 결과 (2개만 보임)
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(""); // 결제 직후 안내
  const [paid, setPaid] = useState(false);
  const [plan, setPlan] = useState({ plan: "one", max: 1, used: [] }); // 결제 상품 · 이미 뽑은 대학
  const [payOpen, setPayOpen] = useState(false);
  const [univInfo, setUnivInfo] = useState(null); // 고른 대학의 생기부 면접 성향 (결제 전 화면 위에 보여준다)
  const [isAdmin, setIsAdmin] = useState(false); // 관리자 — 화면 맨 아래에 대학 예시 만들기 버튼
  const [genLog, setGenLog] = useState(""); // 예시 만들기 진행 상황
  const [genBusy, setGenBusy] = useState(false);
  const pollRef = useRef(null); // 결제 후 job 확인 타이머
  const [xlsErr, setXlsErr] = useState(""); // 엑셀 읽기 오류
  const [xlsBusy, setXlsBusy] = useState(false);

  useEffect(() => {
    track("interview_view");
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      // 무시
    }
  }, [d]);

  // 결제 상품과 이미 뽑은 대학 — 1곳 상품이면 그 대학을 칸에 고정해서 채운다
  async function loadPlan() {
    const { data } = await supabase.functions.invoke("interview", { body: { action: "status" } });
    if (!data?.paid) return;
    const used = data.used ?? [];
    setPlan({ plan: data.plan ?? "one", max: data.max ?? 1, used });
    if (data.plan !== "six" && used.length) {
      setD((x) => ({ ...x, targets: [{ university: used[0], department: x.targets?.[0]?.department || x.department }] }));
    }
  }

  // 결제 여부, 그리고 결제 전에 이미 본 질문 5개가 있으면 그 화면으로
  // (비회원일 때 뽑아 둔 질문이 있으면 먼저 계정으로 옮긴다)
  useEffect(() => {
    if (!user) return setPaid(false);
    let alive = true;
    const claim = (() => {
      try {
        return localStorage.getItem(GUEST_KEY) ? supabase.functions.invoke("interview", { body: { action: "claim", client_id: getClientId() } }) : Promise.resolve(null);
      } catch {
        return Promise.resolve(null);
      }
    })();
    claim.then(() => {
      try {
        localStorage.removeItem(GUEST_KEY);
      } catch {
        // 무시
      }
      if (!alive) return;
      setIsGuest(false);
      return Promise.all([
        supabase.from("interview_access").select("user_id").maybeSingle(),
        supabase.rpc("is_admin"),
        supabase.from("interview_queries").select("result").eq("preview", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]).then(([a, b, prev]) => {
        if (!alive) return;
        const p = Boolean(a.data) || Boolean(b.data);
        setPaid(p);
        setIsAdmin(Boolean(b.data));
        if (p) {
          // 만들던 질문이 있으면 이어서 기다린다 (다른 화면에 다녀온 경우)
          try {
            const job = localStorage.getItem(JOB_KEY);
            if (job) watchJob(job);
          } catch {
            // 무시
          }
          return loadPlan();
        }
        const r = prev.data?.result?.results?.[0];
        if (r) {
          setResult(r);
          setIsPreview(true);
          setView("result");
        }
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));

  // 관리자 — 서비스 대학 24곳의 꼬리질문 예시를 만든다 (12곳씩 두 번, force면 이미 있는 대학도 다시)
  async function genSamples(force) {
    setGenBusy(true);
    setGenLog("만드는 중… 1~2분 걸려요");
    const out = [];
    for (let i = 0; i < SERVICE_UNIVS.length; i += 12) {
      const names = SERVICE_UNIVS.slice(i, i + 12);
      const { data, error } = await supabase.functions.invoke("interview", { body: { action: "gen_samples", names, force } });
      if (error || data?.error) {
        out.push(`오류: ${data?.error ?? error?.message ?? "알 수 없음"}`);
        break;
      }
      out.push(`만듦 ${data.made.length}곳 · 건너뜀 ${data.skipped.length}곳${data.skipped.length ? ` (${data.skipped.join(", ")})` : ""}`);
      setGenLog(out.join("\n"));
    }
    setGenLog(out.join("\n") + "\n끝났어요. 건너뛴 대학은 univ_profiles에 이름이 다르거나 데이터가 비어 있는 곳이에요.");
    setGenBusy(false);
  }

  // 대학 이름을 쓰면 그 대학의 면접 성향을 불러온다 — 잠깐 멈춘 뒤 한 번만
  useEffect(() => {
    const name = (d.university ?? "").trim();
    if (paid || name.length < 2) return setUnivInfo(null);
    const t = setTimeout(async () => {
      const { data } = await supabase.functions.invoke("interview", { body: { action: "univ", university: name } });
      if (data?.found) {
        setUnivInfo(data);
        track("interview_univ", data.name);
      } else setUnivInfo(null);
    }, 500);
    return () => clearTimeout(t);
  }, [d.university, paid]);

  // 결제 전 4칸 고치기
  const b = d.rec?.[BASE] ?? emptyTerm();
  const setTerm = (key, v) => setD((x) => ({ ...x, rec: { ...x.rec, [BASE]: { ...(x.rec?.[BASE] ?? emptyTerm()), [key]: v } } }));
  const setSubj = (key, v) =>
    setD((x) => {
      const t = x.rec?.[BASE] ?? emptyTerm();
      const s = { ...(t.subjects?.[0] ?? { subject: "", content: "" }), [key]: v };
      return { ...x, rec: { ...x.rec, [BASE]: { ...t, subjects: [s, ...(t.subjects ?? []).slice(1)] } } };
    });

  // 결제 후 대학·학과 칸 고치기
  const targets = d.targets?.length ? d.targets : [{ university: "", department: "" }];
  const lockedUniv = paid && plan.plan !== "six" && plan.used.length ? plan.used[0] : null; // 1곳 상품은 처음 뽑은 대학으로 고정
  const setTarget = (i, key, v) => setD((x) => ({ ...x, targets: targets.map((t, j) => (j === i ? { ...t, [key]: v } : t)) }));
  const addTarget = () => setD((x) => ({ ...x, targets: [...targets, { university: "", department: "" }] }));
  const delTarget = (i) => setD((x) => ({ ...x, targets: targets.filter((_, j) => j !== i) }));
  const filledTargets = targets.filter((t) => t.university.trim() && t.department.trim());
  // 6곳 상품 — 이미 뽑은 대학과 새 대학을 합쳐 6곳까지
  const newCount = filledTargets.filter((t) => !plan.used.some((u) => univKey(u) === univKey(t.university))).length;
  const overMax = paid && plan.used.length + newCount > plan.max;

  // 결제 전 활동 — 걱정되는 활동 1개 필수, 최대 4개
  const free = d.free?.length ? d.free : [newFree()];
  const setFree = (i, key, v) => setD((x) => ({ ...x, free: free.map((a, j) => (j === i ? { ...a, [key]: v } : a)) }));
  const addFree = () => free.length < FREE_MAX && setD((x) => ({ ...x, free: [...free, { ...newFree(), kind: ["club", "career", "autonomy", "subject"][free.length % 4] }] }));
  const delFree = (i) => setD((x) => ({ ...x, free: free.length > 1 ? free.filter((_, j) => j !== i) : [newFree()] }));
  const freeActs = free
    .filter((a) => String(a.content ?? "").trim())
    .map((a) => {
      const g = a.grade || "";
      return { grade: g || "고3", term: g ? "" : "1학기", kind: a.kind, subject: a.kind === "subject" ? a.subject : "", content: a.content };
    });
  const filled = freeActs.length;
  const excelActs = d.excel?.acts ?? [];
  // 엑셀 올리기 — 화면에서 바로 읽어 활동 목록으로 바꾼다 (파일은 서버에 올리지 않는다)
  async function onExcel(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setXlsErr("");
    setXlsBusy(true);
    try {
      const acts = await readExcel(file);
      if (!acts.length) setXlsErr("엑셀에서 활동을 찾지 못했어요. 가이드대로 만든 파일인지 확인해 주세요. ('한 활동' 열이 있어야 해요)");
      else {
        set("excel", { name: file.name, acts });
        track("interview_excel", String(acts.length));
      }
    } catch {
      setXlsErr("엑셀 파일을 읽지 못했어요. .xlsx 파일인지 확인해 주세요.");
    }
    setXlsBusy(false);
  }

  // 결제 전 입력 단계 기록 — 0: 칸을 처음 누름, 1~4: 채운 칸 수 (어디서 그만두는지 보려고, 단계마다 한 번씩)
  const tracked = useRef(-1);
  const markFill = (n) => {
    if (paid || n <= tracked.current) return;
    tracked.current = n;
    track("interview_fill", String(n));
  };
  useEffect(() => {
    if (filled > 0) markFill(filled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filled, paid]);
  const ok = paid
    ? filledTargets.length > 0 && excelActs.length > 0 && !overMax && agree
    : d.university.trim() && d.department.trim() && filled >= 1 && agree;

  // 결제 후 job 확인 — 3초마다 상태를 보고, 끝나면 결과를 보여준다 (서버는 화면과 상관없이 끝까지 만든다)
  function watchJob(id) {
    clearInterval(pollRef.current);
    setErr("");
    setDone(false);
    setRunning("full");
    setView("loading");
    const t0 = Date.now();
    const finish = (fn) => {
      clearInterval(pollRef.current);
      try {
        localStorage.removeItem(JOB_KEY);
      } catch {
        // 무시
      }
      fn();
    };
    const check = async () => {
      const { data } = await supabase.from("interview_queries").select("status, result, error").eq("id", id).maybeSingle();
      if (data?.status === "done" && data.result?.results?.length) {
        finish(() => {
          setDone(true);
          setTimeout(() => {
            setResults(data.result.results);
            setRi(0);
            setIsPreview(false);
            if (data.result.failed?.length) setErr(`${data.result.failed.join(", ")}은(는) 질문을 뽑지 못했어요. 잠시 후 그 대학만 다시 뽑아 주세요.`);
            setRunning(null);
            setView("result");
            loadPlan();
            window.scrollTo(0, 0);
          }, 450);
        });
      } else if (data?.status === "failed" || (!data && Date.now() - t0 > 15000)) {
        finish(() => {
          setRunning(null);
          setErr(data?.error ?? "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요.");
          setView("input");
        });
      } else if (Date.now() - t0 > 8 * 60 * 1000) {
        finish(() => {
          setRunning(null);
          setErr("시간이 오래 걸리고 있어요. 잠시 후 이 화면을 다시 열어 주세요.");
          setView("input");
        });
      }
    };
    pollRef.current = setInterval(check, 3000);
    check();
  }
  useEffect(() => () => clearInterval(pollRef.current), []);

  async function run(mode) {
    if (!user && mode === "full") return nav("/login"); // 쓴 내용은 저장돼 있어서 돌아오면 그대로 남는다
    if (mode === "full" && (!filledTargets.length || !excelActs.length)) {
      setView("input");
      setErr("지원 대학·학과를 적고, 가이드대로 정리한 엑셀 파일을 올려 주세요.");
      return;
    }
    if (mode === "preview" && (filled < 1 || !d.university.trim() || !d.department.trim())) {
      setView("input");
      setErr("지원 대학·학과와 걱정되는 활동 하나를 적어 주세요.");
      return;
    }
    setErr("");
    setNotice("");
    setDone(false);
    setRunning(mode);
    setView("loading");
    window.scrollTo(0, 0);
    const body =
      mode === "full"
        ? { targets: filledTargets, activities: excelActs, agreed: true, mode, client_id: getClientId() }
        : { university: d.university, department: d.department, activities: freeActs, agreed: true, mode, client_id: getClientId() };
    const { data, error } = await supabase.functions.invoke("interview", { body });
    if (error || data?.error) {
      let m = data?.error;
      let pay = data?.paywall;
      try {
        const j = data ?? (await error?.context?.json?.());
        m = m ?? j?.error;
        pay = pay ?? j?.paywall;
      } catch {
        // 무시
      }
      setRunning(null);
      if (pay) {
        setView(result ? "result" : "input");
        return setPayOpen(true);
      }
      setErr(m ?? "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요.");
      return setView(mode === "preview" && result ? "result" : "input");
    }
    if (mode === "full" && data?.job) {
      try {
        localStorage.setItem(JOB_KEY, data.job);
      } catch {
        // 무시
      }
      return watchJob(data.job);
    }
    setDone(true);
    setTimeout(() => {
      if (mode === "full") {
        setResults(data.results?.length ? data.results : [data.result]);
        setRi(0);
        setIsPreview(false);
        if (data.failed?.length) setErr(`${data.failed.join(", ")}은(는) 질문을 뽑지 못했어요. 잠시 후 그 대학만 다시 뽑아 주세요.`);
        loadPlan();
      } else {
        setResult(data.result);
        setIsPreview(true);
        setIsGuest(Boolean(data.guest));
        if (data.guest) {
          try {
            localStorage.setItem(GUEST_KEY, "1");
          } catch {
            // 무시
          }
        }
      }
      setRunning(null);
      setView("result");
      window.scrollTo(0, 0);
    }, 450);
  }

  // 결제 후 — 붙여 넣기 화면으로 (지원 대학·학과는 결제 전에 쓴 걸 첫 칸에 넣어 둔다)
  const goFullInput = (msg) => {
    setErr("");
    setNotice(msg ?? "");
    setD((x) => (x.targets?.some((t) => t.university) ? x : { ...x, targets: [{ university: x.university, department: x.department }] }));
    setView("input");
    window.scrollTo(0, 0);
  };

  const goSignup = (kind) => {
    track("interview_gate", kind);
    nav(kind === "login" ? "/login" : "/signup", { state: { returnTo: "/interview" } });
  };

  const openPay = () => {
    if (!user) return nav("/login");
    track("interview_pay");
    setPayOpen(true);
  };

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  const field = "w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 py-3 text-[15px] outline-none focus:border-sm-navy";
  const area = `${field} mt-2 min-h-[76px] resize-y leading-relaxed text-[14.5px]`;
  const r = results[ri] ?? results[0];
  const loadingUniv = running === "full" ? (filledTargets.length > 1 ? `${filledTargets[0].university} 외 ${filledTargets.length - 1}곳` : filledTargets[0]?.university) : d.university;

  return (
    <div className="mx-auto max-w-[680px] px-5 pb-16 pt-8">
      {!(view === "input" && !paid) && <p className="text-[12.5px] font-bold text-sm-orange">내 생기부 면접 예상 질문</p>}

      {/* 기다리는 화면 */}
      {view === "loading" && (
        <>
          <h1 className="mt-1 text-[24px] font-black text-sm-navy">{running === "full" ? loadingUniv : `${d.university} ${d.department}`}</h1>
          <p className="mt-1 text-[13px] text-gray-500">{running === "full" ? `올린 활동 ${excelActs.length}개` : `내 활동 ${filled}개`}</p>
          <Waiting university={loadingUniv} done={done} full={running === "full"} />
        </>
      )}

      {/* 결제 후 결과 — 대학별 */}
      {view === "result" && !isPreview && r && (
        <>
          {results.length > 1 && (
            <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {results.map((x, i) => (
                <button
                  key={x.university}
                  type="button"
                  onClick={() => setRi(i)}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-bold ${i === ri ? "text-white" : "bg-gray-100 text-gray-600"}`}
                  style={i === ri ? { background: CHANNEL } : undefined}
                >
                  {x.university}
                </button>
              ))}
            </div>
          )}
          <h1 className="mt-2 text-[24px] font-black text-sm-navy">
            {r.university} {r.department}
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            활동 {r.activity_count ?? r.total}개 · 예상 질문 {r.total}개{r.has_univ_data ? " · 생수면 대학별 면접 분석 데이터 반영" : ""}
          </p>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => {
                track("interview_pdf", "1");
                printPdf([r]);
              }}
              className="h-12 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white"
            >
              {results.length > 1 ? "이 대학 PDF로 받기" : "PDF로 받기"}
            </button>
            {results.length > 1 && (
              <button
                onClick={() => {
                  track("interview_pdf", String(results.length));
                  printPdf(results);
                }}
                className="h-12 rounded-xl border-[1.5px] border-sm-navy text-[15px] font-extrabold text-sm-navy"
              >
                {results.length}개 대학 한 번에 PDF
              </button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[12px] text-gray-400">인쇄 창에서 ‘PDF로 저장’을 고르면 파일로 받아져요</p>
          {excelActs.length > 0 && (
            <button
              onClick={() => {
                track("interview_xlsx", String(results.length));
                downloadExcel(results, excelActs);
              }}
              className="mt-3 h-12 w-full rounded-xl border-[1.5px] border-emerald-600 bg-emerald-50 text-[15px] font-extrabold text-emerald-700"
            >
              내 엑셀에 질문 채워서 받기{results.length > 1 ? ` (${results.length}개 대학)` : ""}
            </button>
          )}
          <Questions groups={r.groups} />
          <button
            onClick={() => {
              setErr("");
              setView("input");
              window.scrollTo(0, 0);
            }}
            className="mt-8 h-12 w-full rounded-xl border-[1.5px] border-sm-navy text-[14px] font-bold text-sm-navy"
          >
            {plan.plan === "six" ? "대학을 더하거나 바꿔서 다시 뽑기" : "학과나 생기부를 바꿔서 다시 뽑기"}
          </button>
        </>
      )}

      {/* 결제 전 결과 — 5개 */}
      {view === "result" && isPreview && result && (
        <>
          <h1 className="mt-1 text-[24px] font-black text-sm-navy">
            {result.university} {result.department}
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            내 활동 {result.activity_count ?? filled}개 기준{result.has_univ_data ? " · 생수면 대학별 면접 분석 데이터 반영" : ""}
          </p>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}

          {isGuest ? (
            <>
              <Questions groups={result.groups} />

              {/* 비회원 — 나머지 3개는 가입하면 보인다 */}
              <div className="relative mt-2">
                <div className="pointer-events-none select-none blur-[5px]" aria-hidden="true">
                  <Questions groups={[{ title: "가장 나올 가능성이 큰 질문", questions: LOCKED_SAMPLE.flatMap((g) => g.questions).slice(0, Math.max(1, result.locked ?? 3)) }]} start={result.groups?.[0]?.questions?.length ?? 2} />
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/55 px-4 text-center">
                  <p className="text-[16px] font-extrabold leading-relaxed text-sm-navy">
                    회원가입하면 <b className="text-sm-orange">나머지 {result.locked ?? 3}개</b>도
                    <br />
                    바로 볼 수 있어요
                  </p>
                  <button onClick={() => goSignup("signup")} className="mt-3 rounded-xl bg-sm-orange px-6 py-3.5 text-[15px] font-extrabold text-white">
                    회원가입하고 나머지 보기
                  </button>
                  <button onClick={() => goSignup("login")} className="mt-2 text-[12.5px] text-gray-500">
                    이미 계정이 있어요 · 로그인
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Questions groups={result.groups} />

              {/* 결제 전 — 아래는 흐리게 */}
              <div className="relative mt-2">
                <div className="pointer-events-none select-none blur-[5px]" aria-hidden="true">
                  <Questions groups={LOCKED_SAMPLE} start={result.total} />
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/55 px-4 text-center">
                  <p className="text-[16px] font-extrabold leading-relaxed text-sm-navy">
                    질문이 마음에 드셨나요?
                    <br />
                    <b className="text-sm-orange">고1~고3 모든 생기부 예상질문</b>을 열어 드려요
                  </p>
                  {paid ? (
                    <button onClick={() => goFullInput()} className="mt-3 rounded-xl px-6 py-3.5 text-[15px] font-extrabold text-white" style={{ background: CHANNEL }}>
                      내 생기부 전체 넣으러 가기
                    </button>
                  ) : (
                    <button onClick={openPay} className="mt-3 rounded-xl bg-sm-orange px-6 py-3.5 text-[15px] font-extrabold text-white">
                      19,000원부터 · 전체 열기
                    </button>
                  )}
                  <p className="mt-2 text-[12.5px] text-gray-500">활동마다 예상 질문 1개 · 대학별 PDF 저장</p>
                </div>
              </div>

              <p className="mt-5 rounded-xl bg-violet-50 px-4 py-3 text-[13px] leading-relaxed text-violet-900">
                💡 결제하면 <b>생기부 정리 가이드</b>로 고1~고3 활동을 한 번에 넣을 수 있어요. 활동 하나마다 예상 질문이 하나씩 나오고, <b>수시 6곳 상품</b>은 대학마다 질문을 따로 뽑아 드려요.
              </p>
            </>
          )}
        </>
      )}

      {/* 입력 — 결제 후: 가이드 + 대학 1~6곳 + 붙여 넣기 */}
      {view === "input" && paid && (
        <>
          <h1 className="mt-1 text-[26px] font-black leading-tight text-sm-navy">
            내 생기부 전체로
            <br />
            면접 예상 질문 뽑기
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            {plan.plan === "six" ? "수시 6곳 상품" : "지원 대학 1곳 상품"}이에요. 활동 하나마다 예상 질문이 하나씩 나와요.
          </p>
          {notice && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-[13.5px] font-bold leading-relaxed text-emerald-700">{notice}</p>}

          <section className="mt-6 rounded-2xl border border-gray-200 p-5">
            <p className="text-[15px] font-extrabold text-sm-navy">① 생기부 예상질문 가이드</p>
            {/* 가이드 PDF — Supabase Storage 비공개 버킷에서 결제한 사람에게만 10분짜리 링크를 받아 연다 */}
            <button
              type="button"
              onClick={async () => {
                track("interview_guide");
                const w = window.open("", "_blank"); // 팝업 차단을 피하려고 창을 먼저 연다
                const { data } = await supabase.functions.invoke("interview", { body: { action: "guide" } });
                if (data?.url) {
                  if (w) w.location.href = data.url;
                  else window.location.href = data.url;
                } else {
                  w?.close();
                  window.alert(data?.error ?? "가이드를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
                }
              }}
              className="mt-3 flex h-14 w-full items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-[15px] font-extrabold text-sm-navy"
            >
              생기부 예상질문 가이드 PDF 받기
            </button>
            <ol className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed text-gray-600">
              {[
                "내 학교생활기록부를 준비해요. 나이스나 학교에서 PDF로 받을 수 있어요.",
                "가이드 PDF를 따라 ChatGPT에 넣으면, 3년 동안의 내 활동이 엑셀 파일로 정리돼요.",
                "정리된 엑셀 파일을 내려받아요.",
                "아래에 지원 대학·학과를 적고, 엑셀 파일을 올리면 끝이에요.",
              ].map((t, i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sm-navy text-[12px] font-bold text-white">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center">
              <p className="text-[15px] font-extrabold text-sm-navy">② 지원 대학 · 학과</p>
              <span className="ml-auto text-[13px] font-bold text-gray-400">
                {plan.plan === "six" ? `${Math.min(plan.max, plan.used.length + newCount)}/${plan.max}` : "1/1"}
              </span>
            </div>
            {lockedUniv && <p className="mt-1.5 text-[12.5px] text-gray-500">1곳 상품은 처음 뽑은 <b className="text-sm-navy">{lockedUniv}</b>로 고정돼요. 학과는 바꿀 수 있어요.</p>}
            {plan.plan === "six" && plan.used.length > 0 && (
              <p className="mt-1.5 text-[12.5px] text-gray-500">
                이미 뽑은 대학: <b className="text-sm-navy">{plan.used.join(", ")}</b> · 이 대학들은 다시 뽑아도 6곳에서 빠지지 않아요
              </p>
            )}
            <div className="mt-3 space-y-2">
              {targets.slice(0, plan.plan === "six" ? 6 : 1).map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-3.5 w-4 shrink-0 text-center text-[13px] font-extrabold text-sm-orange">{i + 1}</span>
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <div className="relative">
                      <input
                        value={lockedUniv ?? t.university}
                        readOnly={Boolean(lockedUniv)}
                        onChange={(e) => setTarget(i, "university", e.target.value)}
                        onFocus={() => !lockedUniv && setFocus(`u${i}`)}
                        onBlur={() => setFocus(null)}
                        placeholder="지원 대학 (예: 가천대학교)"
                        className={`${field} ${lockedUniv ? "bg-gray-50 text-gray-500" : ""}`}
                      />
                      {focus === `u${i}` && <SuggestList items={suggest(t.university, UNIVERSITIES)} onPick={(v) => { setTarget(i, "university", v); setFocus(null); }} />}
                    </div>
                    <div className="relative">
                      <input
                        value={t.department}
                        onChange={(e) => setTarget(i, "department", e.target.value)}
                        onFocus={() => setFocus(`d${i}`)}
                        onBlur={() => setFocus(null)}
                        placeholder="지원 학과 (예: 간호학과)"
                        className={field}
                      />
                      {focus === `d${i}` && <SuggestList items={suggest(t.department, DEPARTMENTS)} onPick={(v) => { setTarget(i, "department", v); setFocus(null); }} />}
                    </div>
                  </div>
                  {targets.length > 1 && (
                    <button type="button" onClick={() => delTarget(i)} className="mt-3 shrink-0 px-1 text-[12.5px] font-bold text-gray-400 hover:text-red-500" aria-label={`${i + 1}번 대학 지우기`}>
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
            {plan.plan === "six" && targets.length < 6 && (
              <button type="button" onClick={addTarget} className="mt-3 h-12 w-full rounded-xl border-[1.5px] border-dashed border-gray-300 text-[14px] font-bold text-gray-600 hover:border-violet-400 hover:text-violet-600">
                + 지원 대학 추가
              </button>
            )}
            {overMax && <p className="mt-2 text-[12.5px] font-bold text-red-500">이미 뽑은 대학을 합쳐 {plan.max}곳까지 뽑을 수 있어요. 새 대학을 줄여 주세요.</p>}
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 p-5">
            <p className="text-[15px] font-extrabold text-sm-navy">③ 정리한 엑셀 파일 올리기</p>
            <label
              className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-[1.5px] border-dashed px-4 text-center ${
                excelActs.length ? "border-violet-300 bg-violet-50 py-4" : "border-gray-300 py-10 hover:border-violet-400 hover:bg-violet-50"
              }`}
            >
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onExcel} className="hidden" />
              {xlsBusy ? (
                <span className="text-[14px] font-bold text-gray-500">엑셀을 읽고 있어요…</span>
              ) : excelActs.length ? (
                <>
                  <span className="text-[14.5px] font-extrabold text-sm-navy">✓ 활동 {excelActs.length}개를 읽었어요</span>
                  <span className="mt-1 text-[12px] text-gray-500">{d.excel?.name} · 눌러서 다른 파일로 바꾸기</span>
                </>
              ) : (
                <>
                  <span className="text-[15px] font-extrabold text-sm-navy">엑셀 파일 올리기</span>
                  <span className="mt-1 text-[12.5px] text-gray-500">가이드대로 정리한 .xlsx 파일을 눌러서 골라 주세요</span>
                </>
              )}
            </label>
            {xlsErr && <p className="mt-2 text-[12.5px] font-bold text-red-500">{xlsErr}</p>}
            {excelActs.length > 0 && (
              <ul className="mt-3 max-h-[360px] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100 text-[13px]">
                {excelActs.map((a, i) => (
                  <li key={i} className="flex gap-2 px-3 py-2.5">
                    <span className="w-[74px] shrink-0 font-bold text-violet-700">
                      {a.grade || "-"} · {KIND_NAME[a.kind]}
                    </span>
                    <span className="min-w-0">
                      {/* 활동명 + 한 활동 (질문 AI에도 둘 다 들어간다) */}
                      <span className="block font-bold text-sm-navy">
                        {a.subject ? `${a.subject} · ` : ""}
                        {a.title || "활동"}
                      </span>
                      <span className="mt-0.5 block leading-relaxed text-gray-600">{a.content}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] font-bold text-emerald-600">✓ 파일은 서버에 올라가지 않고, 읽은 활동만 이 브라우저에 저장돼요</p>
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 p-5">
            <label className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-600">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                올린 활동과 뽑은 예상 질문은 <b className="text-sm-navy">서비스 제공과 품질 개선을 위해 저장</b>되는 것에 동의해요. (
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline">개인정보처리방침</a>)
              </span>
            </label>
            {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}
            <button
              onClick={() => run("full")}
              disabled={!ok}
              className="mt-3 h-[54px] w-full rounded-xl text-[16px] font-extrabold text-white disabled:opacity-40"
              style={{ background: CHANNEL }}
            >
              {filledTargets.length > 1 ? `${filledTargets.length}개 대학 예상 질문 뽑기` : "예상 질문 뽑기"}
            </button>
            <p className="mt-2 text-center text-[12px] text-gray-400">하루 3번까지 뽑을 수 있어요{filledTargets.length > 1 ? " · 여러 대학을 한 번에 뽑아도 1번으로 세요" : ""}</p>
          </section>
        </>
      )}

      {/* 입력 — 결제 전 */}
      {view === "input" && !paid && (
        <>
          <h1 className="mt-2 text-[26px] font-black leading-tight text-sm-navy">
            생기부 질문 20만 건 데이터 분석해 보니
            <br />
            같은 활동인데,
            <br />
            대학마다 묻는 게 달라요
          </h1>

          {/* 맨 위 비교 — 같은 활동, 두 대학의 예시 질문 */}
          <p className="mt-4 rounded-xl bg-gray-50 px-3.5 py-2.5 text-[13px] text-gray-600">
            <b className="text-sm-navy">활동</b> · {COMPARE_ACTIVITY}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {COMPARE.map((c, i) => (
              <div key={c.univ} className={`rounded-xl border p-3 ${i ? "border-emerald-200 bg-emerald-50" : "border-violet-200 bg-violet-50"}`}>
                <p className={`text-[12px] font-extrabold ${i ? "text-emerald-700" : "text-violet-700"}`}>
                  {c.univ} · {c.label}
                </p>
                <p className={`mt-1.5 text-[13.5px] font-bold leading-relaxed ${i ? "text-emerald-950" : "text-violet-950"}`}>"{c.q}"</p>
                <p className={`mt-1 text-[13px] leading-relaxed ${i ? "text-emerald-700" : "text-violet-700"}`}>→ "{c.follow}"</p>
              </div>
            ))}
          </div>

          {/* 대학별로 실제로 어떻게 묻는지 — 질문 3개 */}
          <div className="mt-3 space-y-2.5">
            {COMPARE.map((c, i) => (
              <div key={c.title} className={`rounded-xl border p-4 ${i ? "border-emerald-200" : "border-violet-200"}`}>
                <p className="text-[15px] font-extrabold text-sm-navy">{c.title}</p>
                <ol className="mt-2.5 space-y-1.5 text-[13.5px] leading-relaxed">
                  {c.qs.map((q, j) => (
                    <li key={q} className="flex gap-2">
                      <span className={`w-6 shrink-0 font-extrabold ${i ? "text-emerald-700" : "text-violet-700"}`}>Q{j + 1}</span>
                      <span className="text-gray-800">"{q}"</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          <p className="mt-7 text-[14px] font-extrabold text-sm-navy">내 활동이면, 우리 대학은 뭐라고 물을까?</p>
          <section className="mt-2.5 rounded-2xl border border-gray-200 p-5">
            <p className="text-[15px] font-extrabold text-sm-navy">① 지원 대학 · 학과</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="relative">
                <input value={d.university} onChange={(e) => set("university", e.target.value)} onFocus={() => setFocus("u")} onBlur={() => setFocus(null)} placeholder="지원 대학 (예: 가천대학교)" className={field} />
                {focus === "u" && <SuggestList items={suggest(d.university, [...SERVICE_UNIVS, ...UNIVERSITIES.filter((u) => !SERVICE_UNIVS.includes(u))])} onPick={(v) => { set("university", v); setFocus(null); }} />}
              </div>
              <div className="relative">
                <input value={d.department} onChange={(e) => set("department", e.target.value)} onFocus={() => setFocus("d")} onBlur={() => setFocus(null)} placeholder="지원 학과 (예: 간호학과)" className={field} />
                {focus === "d" && <SuggestList items={suggest(d.department, DEPARTMENTS)} onPick={(v) => { set("department", v); setFocus(null); }} />}
              </div>
            </div>

            {/* 고른 대학 — 예시 꼬리질문이 있으면 질문부터, 없으면 성향 설명 */}
            {univInfo && (
              <div className="mt-4 rounded-xl border border-violet-200 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-extrabold text-sm-navy">{univInfo.name.replace("대학교", "대")}는 이렇게 파고들어요</p>
                  {(() => {
                    // 면접까지 남은 날 — 날짜가 있으면 D-day, 없으면 질문 스타일 이름
                    const dd = univInfo.next_interview ? Math.round((Date.parse(univInfo.next_interview) - Date.parse(univInfo.today)) / 864e5) : null;
                    if (dd != null)
                      return (
                        <span title={univInfo.next_label || undefined} className="ml-auto shrink-0 rounded-full bg-orange-50 px-2.5 py-1 text-[11.5px] font-extrabold text-orange-700">
                          {dd === 0 ? "오늘 면접" : `면접까지 D-${dd}`}
                        </span>
                      );
                    return univInfo.sample?.label ? (
                      <span className="ml-auto shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-extrabold text-violet-700">{univInfo.sample.label}</span>
                    ) : null;
                  })()}
                </div>
                {UNIV_STATS[univInfo.name] && (
                  <p className="mt-1.5 text-[12px] font-bold text-violet-700">생수면 후기 분석 · {UNIV_STATS[univInfo.name]}</p>
                )}
                {univInfo.sample?.questions?.length === 3 ? (
                  <ol className="mt-3 space-y-1.5 text-[13.5px] leading-relaxed">
                    {univInfo.sample.questions.map((q, i) => (
                      <li key={q} className="flex gap-2">
                        <span className="w-6 shrink-0 font-extrabold text-violet-700">Q{i + 1}</span>
                        <span className="text-gray-800">"{q}"</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <dl className="mt-2.5 space-y-2 text-[13.5px] leading-relaxed">
                    {[
                      ["무엇을 보나", univInfo.view],
                      ["어떻게 묻나", univInfo.style],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="w-[72px] shrink-0 font-extrabold text-violet-700">{k}</dt>
                          <dd className="text-gray-700">{brief(v)}</dd>
                        </div>
                      ))}
                  </dl>
                )}
                {(univInfo.style || univInfo.tone) && (
                  <p className="mt-2.5 text-[12px] leading-relaxed text-gray-500">
                    {univInfo.next_interview && univInfo.sample?.label && <b className="mr-1 text-violet-700">{univInfo.sample.label} ·</b>}
                    {brief(univInfo.sample ? univInfo.style || univInfo.tone : univInfo.tone, 90)}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 걱정되는 활동 하나 (최대 4개) */}
          <section className="mt-4 rounded-2xl border-2 p-5" style={{ borderColor: CHANNEL }} onFocusCapture={() => markFill(0)}>
            <p className="text-[15px] font-extrabold text-sm-navy">② 면접에서 가장 걱정되는 활동 하나</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-500">
              <b className="text-sm-navy">생기부 안 열어도 돼요.</b> 기억나는 대로 내 말로 적어 주세요.
            </p>
            {free.map((a, i) => (
              <div key={i} className={i ? "mt-3 border-t border-gray-100 pt-3" : "mt-3"}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {KIND_CHIPS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFree(i, "kind", k)}
                      className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${a.kind === k ? "text-white" : "bg-gray-100 text-gray-500"}`}
                      style={a.kind === k ? { background: CHANNEL } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                  {free.length > 1 && (
                    <button type="button" onClick={() => delFree(i)} className="ml-auto text-[12px] font-bold text-gray-400 hover:text-red-500">
                      삭제
                    </button>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                    <span className="mr-1 text-[12.5px] font-bold text-gray-500">학년</span>
                    {GRADES.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setFree(i, "grade", a.grade === g ? "" : g)}
                        className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold ${a.grade === g ? "border-transparent text-white" : "border-gray-200 bg-white text-gray-500"}`}
                        style={a.grade === g ? { background: CHANNEL } : undefined}
                      >
                        {g}
                      </button>
                    ))}
                </div>
                {a.kind === "subject" && (
                  <input value={a.subject} onChange={(e) => setFree(i, "subject", e.target.value)} placeholder="과목 (예: 생명과학)" className={`${field} mt-2`} />
                )}
                {/* 예시는 칸 안에 회색 글씨로 — 직접 겹쳐 그려서, 빈칸이면 언제나 보인다 */}
                <div className="relative">
                  <textarea
                    value={a.content}
                    onChange={(e) => setFree(i, "content", e.target.value)}
                    aria-label={FREE_PH[a.kind] ?? FREE_PH.subject}
                    className={`${area} relative bg-transparent`}
                  />
                  {!String(a.content ?? "").trim() && (
                    <p className="pointer-events-none absolute left-0 right-0 top-2 px-3.5 py-3 text-[14.5px] leading-relaxed text-gray-400">
                      {FREE_PH[a.kind] ?? FREE_PH.subject}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {free.length < FREE_MAX && (
              <button type="button" onClick={addFree} className="mt-3 w-full rounded-xl border-[1.5px] border-dashed border-gray-300 py-2.5 text-[13px] font-bold text-gray-500 hover:border-violet-400 hover:text-violet-600">
                + 활동 더 넣기 (선택) · 더 넣을수록 질문이 정확해져요
              </button>
            )}
            <p className="mt-2 text-[12px] font-bold text-emerald-600">✓ 쓰는 내용은 자동으로 저장돼요</p>
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 p-5">
            <label className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-600">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                입력한 활동과 뽑은 예상 질문은 <b className="text-sm-navy">서비스 제공과 품질 개선을 위해 저장</b>되는 것에 동의해요. (
                <a href="/privacy" target="_blank" rel="noreferrer" className="underline">개인정보처리방침</a>)
              </span>
            </label>

            {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}

            <button
              onClick={() => run("preview")}
              disabled={!ok}
              className="mt-3 h-[54px] w-full rounded-xl text-[16px] font-extrabold text-white disabled:opacity-40"
              style={{ background: CHANNEL }}
            >
              {d.university.trim() ? `${(univInfo?.name ?? d.university.trim()).replace("대학교", "대")} 생기부 예상질문 보기` : "생기부 예상질문 보기"}
            </button>
          </section>
        </>
      )}

      {/* 관리자 도구 — 관리자에게만 보인다 */}
      {isAdmin && (
        <section className="mt-12 rounded-2xl border border-dashed border-gray-300 p-5">
          <p className="text-[13px] font-extrabold text-gray-500">관리자 · 대학별 꼬리질문 예시 ({SERVICE_UNIVS.length}곳)</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => genSamples(false)} disabled={genBusy} className="rounded-lg bg-sm-navy px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
              없는 대학만 만들기
            </button>
            <button
              onClick={() => window.confirm("이미 만든 예시도 전부 새로 만들어요. 고쳐 둔 예시가 있으면 사라져요. 진행할까요?") && genSamples(true)}
              disabled={genBusy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-bold text-gray-600 disabled:opacity-50"
            >
              전부 다시 만들기
            </button>
          </div>
          {genLog && <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-[12px] leading-relaxed text-gray-600">{genLog}</pre>}
          <p className="mt-2 text-[11.5px] text-gray-400">관리자는 결제한 것으로 보여서 결제 전 화면은 시크릿 창(비회원)으로 확인하세요.</p>
        </section>
      )}

      <Paywall
        kind="interview"
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onUnlocked={() => {
          setPaid(true);
          setPayOpen(false);
          loadPlan();
          // 결제가 확인되면 붙여 넣기 화면으로 — 생기부 전체를 넣을수록 질문이 늘어난다
          goFullInput("결제가 확인됐어요! 가이드 PDF로 생기부를 엑셀로 정리해서 올리면, 활동마다 예상 질문을 뽑아 드려요.");
        }}
      />
    </div>
  );
}