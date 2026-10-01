import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import { UNIVERSITIES, DEPARTMENTS } from "../motive/Motive";
import Paywall from "../inquiry/Paywall";

/*
 * 내 생기부 면접 예상 질문 — /interview
 * ① 가이드 PDF대로 생기부 활동을 요약 → ② 지원 대학·학과 입력 → ③ 요약한 내용 붙여 넣기
 * → ④ 대학 면접 데이터 기준 예상 질문 (질문만) → ⑤ PDF로 받기
 * 지원동기 진단 결과에서 넘어오면 대학·학과가 채워져 있다
 */

// 가이드 PDF — public/guides/ 폴더에 이 이름으로 넣는다
const GUIDE_PDF = "/guides/saengsumyeon-guide.pdf";
// 준비 방법 — 문구를 바꾸려면 여기만 고친다
const GUIDE_STEPS = [
  "내 학교생활기록부를 준비해요. 나이스나 학교에서 PDF로 받을 수 있어요.",
  "생기부 예상질문 가이드를 따라하면, 3년 동안의 내 활동이 한눈에 요약돼요.",
  "요약된 내용을 전부 복사해요.",
  "아래에 지원 대학·학과를 적고, 요약한 내용을 붙여 넣으면 끝이에요.",
];
const MAX = 20000;

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
            className="block w-full px-4 py-2.5 text-left text-[14.5px] text-gray-800 hover:bg-indigo-50"
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

const MAX_TARGETS = 6; // 수시 최대 6곳

export default function Interview() {
  const nav = useNavigate();
  const { state } = useLocation();
  const { user, loading: authLoading } = useAuth();

  // 지원 대학·학과 — 최대 6곳 (지원동기 결과에서 넘어오면 첫 줄이 채워져 있다)
  const [targets, setTargets] = useState([{ university: state?.university ?? "", department: state?.department ?? "" }]);
  const [text, setText] = useState("");
  const [agree, setAgree] = useState(false);
  const [focus, setFocus] = useState(null); // 추천 목록을 띄울 칸 — "u0", "d2" 식
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState(null);
  const [tab, setTab] = useState(0);
  const [paid, setPaid] = useState(false); // 생기부 예상질문을 결제했는지 (관리자는 결제 없이)
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    track("interview_view");
  }, []);

  // 결제 여부 — 결제한 회원·관리자만 가이드와 예상 질문이 열린다
  useEffect(() => {
    if (!user) return setPaid(false);
    Promise.all([supabase.from("interview_access").select("user_id").maybeSingle(), supabase.rpc("is_admin")]).then(([a, b]) =>
      setPaid(Boolean(a.data) || Boolean(b.data))
    );
  }, [user]);

  // 잠긴 버튼을 누르면 — 비회원은 로그인, 회원은 결제 창
  const openPay = () => {
    if (!user) return nav("/login");
    track("interview_pay");
    setPayOpen(true);
  };

  const setT = (i, k, v) => setTargets((a) => a.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const addT = () => setTargets((a) => (a.length >= MAX_TARGETS ? a : [...a, { university: "", department: "" }]));
  const delT = (i) => setTargets((a) => (a.length <= 1 ? a : a.filter((_, j) => j !== i)));

  const len = text.trim().length;
  const filled = targets.every((t) => t.university.trim() && t.department.trim());
  const ok = filled && len >= 200 && len <= MAX && agree && !busy;

  async function run() {
    if (!ok) return;
    setErr("");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("interview", { body: { targets, text, agreed: agree } });
    setBusy(false);
    if (error || data?.error) {
      let m = data?.error;
      try {
        m = m ?? (await error?.context?.json?.())?.error;
      } catch {
        // 무시
      }
      if (m && m.includes("결제")) return setPayOpen(true);
      return setErr(m ?? "질문을 뽑지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    setResults(data.results);
    setTab(0);
    window.scrollTo(0, 0);
  }

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  const field = "w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 py-3 text-[15px] outline-none focus:border-sm-navy";

  // 결과 — 대학별 탭
  if (results) {
    const ok2 = results.filter((r) => !r.error);
    const r = results[tab];
    let n = 0;
    return (
      <div className="mx-auto max-w-[680px] px-5 pb-16 pt-8">
        <p className="text-[12.5px] font-bold text-sm-orange">내 생기부 면접 예상 질문</p>
        <h1 className="mt-1 text-[22px] font-black text-sm-navy">{results.length > 1 ? `${results.length}개 대학 예상 질문` : `${r.university} ${r.department}`}</h1>

        <button
          onClick={() => {
            track("interview_pdf", String(ok2.length));
            printPdf(ok2);
          }}
          disabled={!ok2.length}
          className="mt-4 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-40"
        >
          {ok2.length > 1 ? `${ok2.length}개 대학 한 번에 PDF로 받기` : "PDF로 받기"}
        </button>
        <p className="mt-1.5 text-center text-[12px] text-gray-400">인쇄 창에서 ‘PDF로 저장’을 고르면 파일로 받아져요</p>

        {results.length > 1 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {results.map((x, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${tab === i ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-600"}`}
              >
                {x.university}
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 text-[13px] text-gray-500">
          {r.university} {r.department}
          {!r.error && ` · 예상 질문 ${r.total}개`}
          {r.has_univ_data ? " · 생수면 대학별 면접 분석 데이터 반영" : ""}
        </p>
        {r.error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-3 text-[13.5px] font-bold text-red-600">{r.error}</p>
        ) : (
          <div className="mt-3 space-y-5">
            {r.groups.map((g) => (
              <section key={g.title}>
                <h2 className="rounded-lg bg-indigo-50 px-3 py-2 text-[14.5px] font-extrabold text-sm-navy">{g.title}</h2>
                <ol className="mt-1">
                  {g.questions.map((q) => (
                    <li key={q} className="flex gap-2.5 border-b border-gray-100 px-1 py-2.5 text-[14px] leading-relaxed text-gray-800">
                      <span className="w-6 shrink-0 font-extrabold text-sm-orange">{++n}</span>
                      {q}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        <button onClick={() => setResults(null)} className="mt-8 h-12 w-full rounded-xl border-[1.5px] border-sm-navy text-[14px] font-bold text-sm-navy">
          대학을 바꿔서 다시 뽑기
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[680px] px-5 pb-16 pt-8">
      <p className="text-[12.5px] font-bold text-sm-orange">내 생기부 면접 예상 질문</p>
      <h1 className="mt-1 text-[26px] font-black leading-tight text-sm-navy">
        내 생기부로
        <br />
        지원 대학 면접 예상 질문 뽑기
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
        지원 대학의 면접 데이터(평가요소·질문 스타일)에 맞춰, 내 생기부에서 나올 질문만 골라 드려요.
      </p>

      {/* ① 준비 */}
      <section className="mt-6 rounded-2xl border border-gray-200 p-5">
        <p className="text-[15px] font-extrabold text-sm-navy">① 생기부 예상질문</p>
        {paid ? (
          <a
            href={GUIDE_PDF}
            download
            onClick={() => track("interview_guide")}
            className="mt-3 flex h-12 items-center justify-center rounded-xl bg-indigo-50 text-[14.5px] font-extrabold text-sm-navy ring-1 ring-indigo-200"
          >
            생기부 예상질문 가이드 PDF 받기
          </a>
        ) : (
          <button
            onClick={openPay}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gray-100 text-[14.5px] font-extrabold text-gray-400 ring-1 ring-gray-200"
          >
            🔒 생기부 예상질문 가이드 PDF 받기 <span className="rounded-full bg-sm-orange px-2 py-0.5 text-[12px] text-white">19,000원</span>
          </button>
        )}
        <ol className="mt-4 space-y-2">
          {GUIDE_STEPS.map((t, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-gray-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sm-navy text-[12px] font-extrabold text-white">{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
      </section>

      {/* ② 입력 */}
      <section className="mt-4 rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center">
          <p className="text-[15px] font-extrabold text-sm-navy">② 지원 대학 · 학과</p>
          <span className="ml-auto text-[12.5px] font-bold text-gray-400">
            {targets.length}/{MAX_TARGETS}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {targets.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-3 w-5 shrink-0 text-center text-[13px] font-extrabold text-sm-orange">{i + 1}</span>
              <div className="grid flex-1 gap-2 sm:grid-cols-2">
                <div className="relative">
                  <input
                    value={t.university}
                    onChange={(e) => setT(i, "university", e.target.value)}
                    onFocus={() => setFocus(`u${i}`)}
                    onBlur={() => setFocus(null)}
                    placeholder="지원 대학 (예: 가천대학교)"
                    className={field}
                  />
                  {focus === `u${i}` && <SuggestList items={suggest(t.university, UNIVERSITIES)} onPick={(v) => { setT(i, "university", v); setFocus(null); }} />}
                </div>
                <div className="relative">
                  <input
                    value={t.department}
                    onChange={(e) => setT(i, "department", e.target.value)}
                    onFocus={() => setFocus(`d${i}`)}
                    onBlur={() => setFocus(null)}
                    placeholder="지원 학과 (예: 간호학과)"
                    className={field}
                  />
                  {focus === `d${i}` && <SuggestList items={suggest(t.department, DEPARTMENTS)} onPick={(v) => { setT(i, "department", v); setFocus(null); }} />}
                </div>
              </div>
              {targets.length > 1 && (
                <button type="button" onClick={() => delT(i)} aria-label={`${i + 1}번째 대학 지우기`} className="mt-2.5 h-8 w-8 shrink-0 rounded-lg text-[18px] text-gray-400 hover:bg-gray-100 hover:text-red-500">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {targets.length < MAX_TARGETS && (
          <button
            type="button"
            onClick={addT}
            className="mt-2.5 flex h-11 w-full items-center justify-center rounded-xl border-[1.5px] border-dashed border-gray-300 text-[14px] font-bold text-sm-navy hover:border-sm-navy"
          >
            + 지원 대학 추가
          </button>
        )}

        <p className="mt-5 text-[15px] font-extrabold text-sm-navy">③ 요약한 내 활동 붙여 넣기</p>
        <div className="relative mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder="가이드대로 요약한 내 활동 내용을 그대로 붙여 넣어요"
            className={`${field} resize-y leading-relaxed`}
          />
          <span className={`pointer-events-none absolute bottom-3 right-4 text-[12px] ${len > MAX ? "font-bold text-red-500" : "text-gray-400"}`}>
            {len.toLocaleString()}/{MAX.toLocaleString()}
          </span>
        </div>

        <label className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-600">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            붙여 넣은 내용과 뽑은 예상 질문은 <b className="text-sm-navy">서비스 제공과 품질 개선을 위해 저장</b>되는 것에 동의해요. (
            <a href="/privacy" target="_blank" rel="noreferrer" className="underline">개인정보처리방침</a>)
          </span>
        </label>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-center text-[13px] font-bold text-red-600">{err}</p>}

        {user && !paid ? (
          <button onClick={openPay} className="mt-4 h-[54px] w-full rounded-xl bg-sm-orange text-[16px] font-extrabold text-white">
            🔒 19,000원 결제하고 예상 질문 뽑기
          </button>
        ) : user ? (
          <button onClick={run} disabled={!ok} className="mt-4 h-[54px] w-full rounded-xl bg-sm-orange text-[16px] font-extrabold text-white disabled:opacity-40">
            {busy
              ? `예상 질문을 뽑고 있어요… (${targets.length > 1 ? `${targets.length}개 대학 · ` : ""}30초~1분)`
              : targets.length > 1
              ? `${targets.length}개 대학 예상 질문 뽑기`
              : "예상 질문 뽑기"}
          </button>
        ) : (
          <button onClick={() => nav("/login")} className="mt-4 h-[54px] w-full rounded-xl bg-sm-navy text-[16px] font-extrabold text-white">
            로그인하고 예상 질문 뽑기
          </button>
        )}
      </section>

      <Paywall
        kind="interview"
        open={payOpen}
        onClose={() => setPayOpen(false)}
        onUnlocked={() => {
          setPaid(true);
          setPayOpen(false);
        }}
      />
    </div>
  );
}