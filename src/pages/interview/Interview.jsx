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
 * ① 지원 대학·학과 + 고3 1학기 활동 4칸(세특 1개 · 동아리 · 진로 · 자율) → [생기부 예상질문 보기] (로그인 없이)
 * 비회원: 질문 2개만 또렷하게, 나머지는 흐리게 → 가입하면 그 자리에서 5개 (다시 뽑지 않음)
 * ② 기다리는 화면 → ③ 질문 5개 (결제 전, 계정당 1번) + [19,000원으로 전체 열기]
 * ④ 결제가 확인되면 같은 활동으로 전체 예상 질문을 뽑고 PDF로 받는다
 * 쓰는 내용은 이 브라우저에 자동 저장 (로그인하러 다녀와도 남는다)
 */

const DRAFT_KEY = "sm_interview_draft";
const GUEST_KEY = "sm_interview_guest"; // 비회원으로 질문을 뽑았다는 표시 — 가입하고 돌아오면 기록을 계정으로 옮긴다
const EMPTY = { university: "", department: "", subject: "", subj: "", club: "", career: "", autonomy: "" };
const CHANNEL = "#7C3AED"; // 면접 예상질문 색

const norm = (s) => s.replace(/\s/g, "").toLowerCase();
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
  const p = done ? 100 : Math.min(99, Math.round(100 * (1 - Math.exp(-sec / (full ? 18 : 9)))));
  const titles = ["내 활동을 읽고 있어요", `${university} 면접 스타일과 맞춰 보고 있어요`, full ? "예상 질문을 정리하고 있어요" : "나올 가능성이 큰 질문을 고르고 있어요"];
  return (
    <>
      <div className="mt-4 rounded-2xl border border-gray-200 px-6 py-9 text-center" role="status" aria-live="polite">
        <p className="text-[17px] font-extrabold text-sm-navy">{titles[Math.min(2, Math.floor(p / 34))]}</p>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${p}%`, background: CHANNEL }} />
        </div>
        <p className="mt-3 text-[24px] font-black text-sm-navy">{p}%</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
          내 활동을 <b className="text-sm-navy">{university} 면접 스타일</b>에 맞춰 보고 있어요
        </p>
        <p className="mt-1 text-[12px] text-gray-400">보통 {full ? "30초~1분" : "15~30초"} 걸려요 · 이 화면을 닫지 마세요</p>
      </div>
    </>
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
    return {
      ...EMPTY,
      ...saved,
      ...(state?.university ? { university: state.university } : {}),
      ...(state?.department ? { department: state.department } : {}),
    };
  });
  const [agree, setAgree] = useState(false);
  const [focus, setFocus] = useState(null);
  const [view, setView] = useState("input"); // input | loading | result
  const [done, setDone] = useState(false);
  const [running, setRunning] = useState(null); // 지금 뽑는 중인 종류 preview | full
  const [result, setResult] = useState(null);
  const [isPreview, setIsPreview] = useState(true);
  const [isGuest, setIsGuest] = useState(false); // 비회원 결과 (2개만 보임)
  const [err, setErr] = useState("");
  const [paid, setPaid] = useState(false);
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
      const r = prev.data?.result?.results?.[0];
      if (!p && r) {
        setResult(r);
        setIsPreview(true);
        setView("result");
      }
    });
    });
    return () => {
      alive = false;
    };
  }, [user]);

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const filled = [d.subject.trim() && d.subj.trim(), d.club.trim(), d.career.trim(), d.autonomy.trim()].filter(Boolean).length;
  const ok = d.university.trim() && d.department.trim() && filled === 4 && agree;

  const activities = () => [
    { grade: "고3", term: "1학기", kind: "subject", subject: d.subject, content: d.subj },
    { grade: "고3", term: "1학기", kind: "club", content: d.club },
    { grade: "고3", term: "1학기", kind: "career", content: d.career },
    { grade: "고3", term: "1학기", kind: "autonomy", content: d.autonomy },
  ];

  async function run(mode) {
    if (!user && mode === "full") return nav("/login"); // 쓴 내용은 저장돼 있어서 돌아오면 그대로 남는다
    // 다른 기기에서 결제해 칸이 비어 있으면 — 칸부터 채우게 한다
    if (filled < 4 || !d.university.trim() || !d.department.trim()) {
      setView("input");
      setErr(mode === "full" ? "결제가 확인됐어요. 지원 대학·학과와 고3 1학기 활동 4칸을 채우고 [전체 예상 질문 뽑기]를 눌러 주세요." : "활동 4칸을 모두 채워 주세요.");
      return;
    }
    setErr("");
    setDone(false);
    setRunning(mode);
    setView("loading");
    window.scrollTo(0, 0);
    const { data, error } = await supabase.functions.invoke("interview", {
      body: { university: d.university, department: d.department, activities: activities(), agreed: true, mode, client_id: getClientId() },
    });
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
      return setView(result ? "result" : "input");
    }
    setDone(true);
    setTimeout(() => {
      setResult(data.result);
      setIsPreview(Boolean(data.preview));
      setIsGuest(Boolean(data.guest));
      if (data.guest) {
        try {
          localStorage.setItem(GUEST_KEY, "1");
        } catch {
          // 무시
        }
      }
      setRunning(null);
      setView("result");
      window.scrollTo(0, 0);
    }, 450);
  }

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

  return (
    <div className="mx-auto max-w-[680px] px-5 pb-16 pt-8">
      <p className="text-[12.5px] font-bold text-sm-orange">내 생기부 면접 예상 질문</p>

      {/* ② 기다리는 화면 */}
      {view === "loading" && (
        <>
          <h1 className="mt-1 text-[24px] font-black text-sm-navy">
            {d.university} {d.department}
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">고3 1학기 활동 4개</p>
          <Waiting university={d.university} done={done} full={running === "full"} />
        </>
      )}

      {/* ③ 결과 */}
      {view === "result" && result && (
        <>
          <h1 className="mt-1 text-[24px] font-black text-sm-navy">
            {result.university} {result.department}
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">
            {isPreview ? "고3 1학기 활동 4개 기준" : `예상 질문 ${result.total}개`}
            {result.has_univ_data ? " · 생수면 대학별 면접 분석 데이터 반영" : ""}
          </p>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}

          {isPreview && isGuest ? (
            <>
              <Questions groups={result.groups} />

              {/* 비회원 — 나머지는 가입하면 보인다 */}
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
          ) : isPreview ? (
            <>
              <Questions groups={result.groups} />
              <button onClick={() => nav("/tail?from=interview")} className="mt-4 flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FFF0F5] text-[14.5px] font-extrabold text-[#FD1673]">
                이 질문으로 압박 꼬리질문 연습하기 →
              </button>

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
                    <button onClick={() => run("full")} className="mt-3 rounded-xl px-6 py-3.5 text-[15px] font-extrabold text-white" style={{ background: CHANNEL }}>
                      전체 예상 질문 뽑기
                    </button>
                  ) : (
                    <button onClick={openPay} className="mt-3 rounded-xl bg-sm-orange px-6 py-3.5 text-[15px] font-extrabold text-white">
                      19,000원으로 전체 열기
                    </button>
                  )}
                  <p className="mt-2 text-[12.5px] text-gray-500">채운 활동마다 예상 질문 · PDF 저장</p>
                </div>
              </div>

              <p className="mt-5 rounded-xl bg-violet-50 px-4 py-3 text-[13px] leading-relaxed text-violet-900">
                💡 결제하면 <b>고1 ~ 고3 전체 학기</b>의 세특과 창체를 모두 채울 수 있어요. 많이 채울수록 질문이 내 생기부에 딱 맞아져요.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  track("interview_pdf", "1");
                  printPdf([result]);
                }}
                className="mt-4 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white"
              >
                PDF로 받기
              </button>
              <p className="mt-1.5 text-center text-[12px] text-gray-400">인쇄 창에서 ‘PDF로 저장’을 고르면 파일로 받아져요</p>
              <Questions groups={result.groups} />
              <button onClick={() => nav("/tail?from=interview")} className="mt-4 flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FFF0F5] text-[14.5px] font-extrabold text-[#FD1673]">
                이 질문으로 압박 꼬리질문 연습하기 →
              </button>
              <button
                onClick={() => {
                  setResult(null);
                  setView("input");
                  window.scrollTo(0, 0);
                }}
                className="mt-8 h-12 w-full rounded-xl border-[1.5px] border-sm-navy text-[14px] font-bold text-sm-navy"
              >
                대학이나 활동을 바꿔서 다시 뽑기
              </button>
            </>
          )}
        </>
      )}

      {/* ① 입력 — 고3 1학기 4칸 */}
      {view === "input" && (
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

            <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="text-[13px] font-extrabold text-sm-navy">세특 (교과 활동) 1개</p>
              <input value={d.subject} onChange={(e) => set("subject", e.target.value)} placeholder="과목 (예: 수학Ⅱ)" className={`${field} mt-2 bg-white`} />
              <textarea
                value={d.subj}
                onChange={(e) => set("subj", e.target.value)}
                placeholder="예) CT 촬영 때 몸속 금속 때문에 생기는 영상 왜곡이 궁금해, 적분으로 왜곡을 보정하는 원리를 조사해 발표함"
                className={`${area} bg-white`}
              />
            </div>
            {[
              ["club", "동아리", "예) 보건 동아리에서 '탄소가 인체에 미치는 영향'을 주제로 블랙카본이 몸에 주는 영향과 줄이는 방법을 조사해 발표함"],
              ["career", "진로", "예) X-ray·MRI에 쓰이는 파장의 특성과 의료에서 쓰이는 방식을 비교하는 '의료 파장 연구'를 진행함"],
              ["autonomy", "자율 · 봉사", "예) 학급 자치회에서 게시판 관리를 맡아 공지사항과 동아리 활동 정보를 정리해 친구들이 쉽게 보게 함"],
            ].map(([k, label, ph]) => (
              <div key={k} className="mt-2 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-[13px] font-extrabold text-sm-navy">{label}</p>
                <textarea value={d[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} className={`${area} bg-white`} />
              </div>
            ))}
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
              onClick={() => run(paid ? "full" : "preview")}
              disabled={!ok}
              className="mt-3 h-[54px] w-full rounded-xl text-[16px] font-extrabold text-white disabled:opacity-40"
              style={{ background: CHANNEL }}
            >
              {paid ? "전체 예상 질문 뽑기" : "생기부 예상질문 보기"}
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
          run("full"); // 결제가 확인되면 같은 활동으로 바로 전체 질문을 뽑는다
        }}
      />
    </div>
  );
}