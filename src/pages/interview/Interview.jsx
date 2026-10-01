import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import { getClientId } from "../../lib/clientId";
import { UNIVERSITIES, DEPARTMENTS } from "../motive/Motive";
import Paywall from "../inquiry/Paywall";

/*
 * 내 생기부 면접 예상 질문 — /interview
 * 결제 전 (회원·비회원): 지원 대학·학과 + 고3 1학기 활동 4칸 → 질문 5개
 *   비회원: 2개만 또렷하게, 3개는 흐리게 → 가입하면 그 자리에서 5개 (다시 뽑지 않음)
 *   회원: 5개 다 보이고 + [전체 열기] 결제
 * 결제 후: 가이드 PDF로 생기부를 ChatGPT에 요약 → 요약을 붙여 넣기 → 활동마다 질문 1개
 *   1곳 상품(19,000원): 처음 뽑은 대학으로 고정 / 6곳 상품(24,000원): 대학 6곳까지, 대학마다 질문 따로
 *   하루 3번, 대학별 PDF
 * 쓰는 내용은 이 브라우저에 자동 저장 (로그인하러 다녀와도 남는다)
 */

const DRAFT_KEY = "sm_interview_draft";
const GUEST_KEY = "sm_interview_guest"; // 비회원으로 질문을 뽑았다는 표시 — 가입하고 돌아오면 기록을 계정으로 옮긴다
const GUIDE_PDF = "/guides/interview-guide.pdf"; // public/guides 폴더의 가이드 PDF 파일 이름과 같아야 한다
const BASE = "고3 1학기"; // 결제 전에 채우는 학기
const MAX_TEXT = 20000; // 붙여 넣기 최대 글자 수 (서버와 같게)
const emptyTerm = () => ({ subjects: [{ subject: "", content: "" }], club: "", career: "", autonomy: "" });
const EMPTY = { university: "", department: "", rec: { [BASE]: emptyTerm() }, paste: "", targets: [{ university: "", department: "" }] };
const CHANNEL = "#7C3AED"; // 면접 예상질문 색

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
    paste: typeof saved.paste === "string" ? saved.paste : "",
    targets: Array.isArray(saved.targets) && saved.targets.length ? saved.targets : [{ university: saved.university ?? "", department: saved.department ?? "" }],
  };
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
    ? ["붙여 넣은 생기부를 활동별로 나누고 있어요", `${university} 면접 스타일과 맞춰 보고 있어요`, "활동마다 예상 질문을 정리하고 있어요"]
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
      <p className="mt-1 text-[12px] text-gray-400">보통 {full ? "1~2분" : "15~30초"} 걸려요 · 이 화면을 닫지 마세요</p>
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
        if (p) return loadPlan();
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

  // 결제 전 4칸
  const filled = [b.subjects?.[0]?.subject.trim() && b.subjects?.[0]?.content.trim(), b.club.trim(), b.career.trim(), b.autonomy.trim()].filter(Boolean).length;
  const pasteLen = (d.paste ?? "").length;
  const ok = paid
    ? filledTargets.length > 0 && pasteLen >= 100 && !overMax && agree
    : d.university.trim() && d.department.trim() && filled === 4 && agree;

  async function run(mode) {
    if (!user && mode === "full") return nav("/login"); // 쓴 내용은 저장돼 있어서 돌아오면 그대로 남는다
    if (mode === "full" && (!filledTargets.length || pasteLen < 100)) {
      setView("input");
      setErr("지원 대학·학과를 적고, 가이드대로 요약한 내용을 전부 붙여 넣어 주세요.");
      return;
    }
    if (mode === "preview" && (filled < 4 || !d.university.trim() || !d.department.trim())) {
      setView("input");
      setErr("활동 4칸을 모두 채워 주세요.");
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
        ? { targets: filledTargets, record_text: d.paste, agreed: true, mode, client_id: getClientId() }
        : { university: d.university, department: d.department, activities: baseActivities(b), agreed: true, mode, client_id: getClientId() };
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
      <p className="text-[12.5px] font-bold text-sm-orange">내 생기부 면접 예상 질문</p>

      {/* 기다리는 화면 */}
      {view === "loading" && (
        <>
          <h1 className="mt-1 text-[24px] font-black text-sm-navy">{running === "full" ? loadingUniv : `${d.university} ${d.department}`}</h1>
          <p className="mt-1 text-[13px] text-gray-500">{running === "full" ? `붙여 넣은 생기부 ${pasteLen.toLocaleString()}자` : "고3 1학기 활동 4개"}</p>
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
            고3 1학기 활동 4개 기준{result.has_univ_data ? " · 생수면 대학별 면접 분석 데이터 반영" : ""}
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
            <a
              href={GUIDE_PDF}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("interview_guide")}
              className="mt-3 flex h-14 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-[15px] font-extrabold text-sm-navy"
            >
              생기부 예상질문 가이드 PDF 받기
            </a>
            <ol className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed text-gray-600">
              {[
                "내 학교생활기록부를 준비해요. 나이스나 학교에서 PDF로 받을 수 있어요.",
                "가이드 PDF를 따라 ChatGPT에 넣으면, 3년 동안의 내 활동이 한눈에 요약돼요.",
                "요약된 내용을 전부 복사해요.",
                "아래에 지원 대학·학과를 적고, 요약한 내용을 붙여 넣으면 끝이에요.",
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
            <p className="text-[15px] font-extrabold text-sm-navy">③ 요약한 내 활동 붙여 넣기</p>
            <div className="relative mt-3">
              <textarea
                value={d.paste}
                onChange={(e) => set("paste", e.target.value.slice(0, MAX_TEXT))}
                placeholder="가이드대로 요약한 내 활동 내용을 그대로 붙여 넣어요"
                className={`${field} min-h-[280px] resize-y pb-8 leading-relaxed text-[14px]`}
              />
              <span className="pointer-events-none absolute bottom-3 right-4 text-[12px] text-gray-400">
                {pasteLen.toLocaleString()}/{MAX_TEXT.toLocaleString()}
              </span>
            </div>
            <p className="mt-2 text-[12px] font-bold text-emerald-600">✓ 붙여 넣은 내용은 이 브라우저에 자동으로 저장돼요</p>
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 p-5">
            <label className="flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-600">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                붙여 넣은 내용과 뽑은 예상 질문은 <b className="text-sm-navy">서비스 제공과 품질 개선을 위해 저장</b>되는 것에 동의해요. (
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
            <p className="mt-2 text-center text-[12px] text-gray-400">{filledTargets.length > 1 ? " · 여러 대학을 한 번에 뽑아도 1번으로 세요" : ""}</p>
          </section>
        </>
      )}

      {/* 입력 — 결제 전: 고3 1학기 4칸 */}
      {view === "input" && !paid && (
        <>
          <h1 className="mt-1 text-[26px] font-black leading-tight text-sm-navy">
            내 생기부로
            <br />
            지원 대학 면접 예상 질문 뽑기
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            고3 1학기 세특 1개와 창체 3개만 적으면, 지원 대학의 면접 스타일에 맞춰 나올 질문을 골라 드려요.
          </p>

          <section className="mt-6 rounded-2xl border border-gray-200 p-5">
            <p className="text-[15px] font-extrabold text-sm-navy">① 지원 대학 · 학과</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="relative">
                <input value={d.university} onChange={(e) => set("university", e.target.value)} onFocus={() => setFocus("u")} onBlur={() => setFocus(null)} placeholder="지원 대학 (예: 가천대학교)" className={field} />
                {focus === "u" && <SuggestList items={suggest(d.university, UNIVERSITIES)} onPick={(v) => { set("university", v); setFocus(null); }} />}
              </div>
              <div className="relative">
                <input value={d.department} onChange={(e) => set("department", e.target.value)} onFocus={() => setFocus("d")} onBlur={() => setFocus(null)} placeholder="지원 학과 (예: 간호학과)" className={field} />
                {focus === "d" && <SuggestList items={suggest(d.department, DEPARTMENTS)} onPick={(v) => { set("department", v); setFocus(null); }} />}
              </div>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center">
              <p className="text-[15px] font-extrabold text-sm-navy">② 고3 1학기 활동</p>
              <span className="ml-auto text-[12px] font-bold text-gray-400">나이스 생기부를 보면서 옮겨 적어요</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-500">
              생기부를 보고 <b className="text-sm-navy">활동을 한 줄로</b> 적어 주세요. 무엇을, 어떻게 했는지가 들어가면 충분해요.
            </p>
            <BaseFields t={b} field={field} area={area} onTerm={setTerm} onSubj={setSubj} />
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

            {filled < 4 && (
              <p className="mt-3 text-center text-[13.5px] text-gray-600">
                <b style={{ color: CHANNEL }}>{filled}/4칸</b> 채웠어요 · {4 - filled}칸만 더 적으면 예상 질문을 볼 수 있어요
              </p>
            )}
            {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}

            <button
              onClick={() => run("preview")}
              disabled={!ok}
              className="mt-3 h-[54px] w-full rounded-xl text-[16px] font-extrabold text-white disabled:opacity-40"
              style={{ background: CHANNEL }}
            >
              생기부 예상질문 보기
            </button>
          </section>
        </>
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
          goFullInput("결제가 확인됐어요! 가이드 PDF로 생기부를 요약해서 붙여 넣으면, 활동마다 예상 질문을 뽑아 드려요.");
        }}
      />
    </div>
  );
}