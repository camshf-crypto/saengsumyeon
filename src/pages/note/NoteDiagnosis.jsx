import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import LoginGate, { NoteIcon } from "../../components/LoginGate";
import FeedbackAsk from "../../components/FeedbackAsk";

/*
 * AI 입시 방향 진단 (/roadmap/diagnosis) — 입시 컨설턴트처럼 (2026-11-13)
 *   학과 적합도 → 생기부 분석(강점 · 빈 곳 · 학년 흐름) → 과목 적합도(대학 권장과목과 비교) → 학과가 보는 역량
 *   → 칸마다 연결 → 앞으로 채우는 순서(학기별) → 다음 학년 과목 · 탐구 (탐구는 물꼬에서 바로 시작) · 전부 무료
 * (예전 설명)
 * 고1 13칸 중 10칸 이상 채우면 열린다. 희망 학과(1~3지망) 기준으로
 *   학과별 연결도 → 칸마다 학과와 이어지는지 → 학과가 보는 역량 4개 → 고2 선택과목 → 고2에 이어갈 탐구
 * 희망 학과를 못 정했으면 '아직 못 정했어요' → 활동과 잘 맞는 학과 TOP 3
 * 활동·학과가 그대로면 서버가 저장된 결과를 다시 보여 준다 (AI를 다시 돌리지 않음)
 */

/* 희망 학과 추천 목록 — 탐구주제 DB에 들어 있는 학과 131개 (독서 흔한가와 같은 목록) */
const DEPARTMENTS = [
  "IT융합학과", "가족자원경영학과", "간호학과", "건축공학과", "건축학과", "게임학과",
  "경영학과", "경제학과", "경찰학과", "공간정보공학과", "과학교육과", "관광과",
  "광고홍보학과", "교육학과", "교통공학과", "국어교육과", "국어국문학과", "국제통상학과",
  "국제학과", "금융학과", "기계공학과", "기계항공학과", "기독교교육과", "농업경제학과",
  "농업생명과학과", "도시공학과", "도시행정학과", "독일어과", "동물자원과학과", "러시아어과",
  "로봇학과", "무역학과", "문헌정보학과", "문화콘텐츠학과", "물리치료학과", "물리학과",
  "미디어커뮤니케이션학과", "미래에너지공학과", "바이오공학과", "바이오식품공학과",
  "반도체공학과", "방사선학과", "법학과", "보건의료학과", "불어불문학과", "사이버보안학과",
  "사학과", "사회복지학과", "사회학과", "산림환경학과", "산업·시각디자인전공", "산업공학과",
  "산업심리학과", "생명공학과", "생명과학과", "세무회계학과", "소방학과", "소비자학과",
  "소프트웨어학과", "수의예과", "수학과", "수학교육과", "스마트팜과학과", "스페인어과",
  "스포츠재활학과", "식량식물자원학과", "식품공학과", "식품생명공학과", "식품영양학과",
  "신소재공학과", "신학과", "실내디자인학과", "심리학과", "아동복지학부", "안경광학과",
  "앙트러프러너십전공", "약학과", "언론정보학과", "역사학과", "연극영화학과", "영어교육과",
  "영어영문학과", "외식·조리전공학과", "유럽문화학과", "유아교육과", "윤리교육과",
  "응급구조학과", "의공학과", "의생명공학과", "의예과", "인공지능학과", "일본어학과",
  "자동차공학과", "자유전공", "작업치료학과", "전기공학과", "전자공학과", "전자재료공학과",
  "전자전기공학", "정보통신학과", "정치외교학과", "제약공학과", "주거환경학과", "중국어학과",
  "지리교육과", "지리학과", "철도시스템학과", "철학과", "체육교육학과", "체코슬로바키아어학과",
  "초등교육학과", "치위생학과", "컴퓨터공학과", "토목공학과", "통계학과", "특수교육학과",
  "패션학과", "펄프제지공학과", "한국어학과", "한국우주공학과", "한의예과", "해양학과",
  "행정학과", "호텔경영학과", "화공생명공학과", "화장품공학과", "화학공학과", "화학과",
  "화학교육과", "환경공학과", "환경원예공학과",
];

/* 상태 표시 — 색 대신 회색 농도 (진할수록 좋음) */
const TAG = { 높음: "dark", 보통: "mid", 낮음: "light", 강함: "dark", 약함: "mid", 없음: "light", 충분: "dark", "비어 있음": "light", "잘 맞음": "dark", 부족: "light" };
function Tag({ v }) {
  const t = TAG[v] ?? "mid";
  return <span className={`flex-none self-start px-2 py-0.5 text-[12px] font-extrabold ${t === "dark" ? "bg-gray-900 text-white" : t === "mid" ? "bg-gray-200 text-gray-800" : "border border-gray-300 text-gray-500"}`}>{v}</span>;
}
function H({ n, children, sub }) {
  return (
    <div className="mt-9 border-b border-gray-900 pb-2">
      <p className="text-[12px] font-bold text-gray-400">{n}</p>
      <h2 className="text-[18px] font-black tracking-tight text-gray-900">{children}</h2>
      {sub && <p className="mt-0.5 text-[12.5px] text-gray-500">{sub}</p>}
    </div>
  );
}
const STAGE = ["내 생기부를 읽고 있어요", "같은 학과 탐구 사례와 비교하고 있어요", "대학 권장과목과 내 과목을 맞춰 보고 있어요", "학과가 보는 역량을 따져보고 있어요", "앞으로 채울 순서를 짜고 있어요"];

/* 고1이 몇 칸 채워졌는지 — 노트 화면 · 서버와 같은 규칙 (교과 세특 10과목 + 자율 · 동아리 · 진로) */
function g1Progress(list) {
  const rows = (list || []).filter((a) => a.grade === "고1");
  const subjects = new Set(rows.filter((a) => a.kind === "subject").map((a) => (a.subject || "").replace(/\s/g, "")).filter(Boolean)).size;
  const has = (k) => rows.some((a) => a.kind === k);
  const done = Math.min(subjects, 10) + (has("autonomy") ? 1 : 0) + (has("club") ? 1 : 0) + (has("career") ? 1 : 0);
  return { done, total: 13, need: 10 };
}
/* 고2 칸도 10칸 이상이면 다음은 고3 (로드맵 · 추천이 고3 1학기 기준) */
export function nextGrade(list) {
  const rows = (list || []).filter((a) => a.grade === "고2");
  const subjects = new Set(rows.filter((a) => a.kind === "subject").map((a) => (a.subject || "").replace(/\s/g, "")).filter(Boolean)).size;
  const has = (k) => rows.some((a) => a.kind === k);
  const done = Math.min(subjects, 10) + (has("autonomy") ? 1 : 0) + (has("club") ? 1 : 0) + (has("career") ? 1 : 0);
  return done >= 10 ? "고3" : "고2";
}

const norm = (s) => s.replace(/\s/g, "").toLowerCase();
function suggest(q) {
  const n = norm(q);
  if (!n) return [];
  const hits = DEPARTMENTS.filter((d) => norm(d).includes(n));
  if (hits.length === 1 && hits[0] === q) return [];
  return hits.sort((a, b) => Number(norm(b).startsWith(n)) - Number(norm(a).startsWith(n))).slice(0, 6);
}

/* 진단 중 — 진행 막대는 천천히 오르다 99%에서 멈춘다 */
function Loading() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setSec((Date.now() - t0) / 1000), 300);
    return () => clearInterval(t);
  }, []);
  const p = Math.min(99, Math.round(100 * (1 - Math.exp(-sec / 25))));
  const at = Math.min(STAGE.length - 1, Math.floor((p / 100) * STAGE.length));
  return (
    <div className="mt-6 border border-gray-200 bg-white px-6 py-10 text-center" role="status" aria-live="polite">
      <p className="text-[16px] font-bold text-gray-900">{STAGE[at]}</p>
      <div className="mt-4 h-2 overflow-hidden bg-gray-100">
        <div className="h-full bg-gray-900 transition-all duration-300" style={{ width: `${p}%` }} />
      </div>
      <p className="mt-3 text-[22px] font-black text-gray-900">{p}%</p>
      <p className="mt-3 text-[12px] text-gray-400">보통 40초~1분 걸려요. 화면을 닫지 말아 주세요.</p>
    </div>
  );
}

/* 학과 입력 — 1~3지망, 또는 아직 못 정했어요 */
function DeptForm({ init, onRun, busy }) {
  const [depts, setDepts] = useState(() => [init?.[0] ?? "", init?.[1] ?? "", init?.[2] ?? ""]);
  const [unsure, setUnsure] = useState(false);
  const [focus, setFocus] = useState(-1);
  const ok = unsure || depts[0].trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onRun(unsure ? [] : depts.map((d) => d.trim()).filter(Boolean), unsure);
      }}
      className="mt-4 border border-gray-200 bg-white p-5"
    >
      <b className="text-[16px] text-gray-900">어느 학과 기준으로 볼까요?</b>
      <p className="mt-1 text-[12.5px] text-gray-500">가고 싶은 학과를 1~3개 적어 주세요. 1지망 학과 기준으로 생기부 · 과목 · 앞으로 채울 순서까지 봐 드려요.</p>
      <div className={`mt-3 grid gap-2 ${unsure ? "pointer-events-none opacity-40" : ""}`}>
        {depts.map((d, i) => (
          <div key={i} className="relative">
            <input
              value={d}
              onChange={(e) => setDepts((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(-1)}
              placeholder={i === 0 ? "1지망 학과 (예: 간호학과)" : `${i + 1}지망 학과 (선택)`}
              autoComplete="off"
              className="w-full border border-gray-300 px-3 py-2.5 text-[14.5px] outline-none focus:border-gray-900"
            />
            {focus === i && suggest(d).length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden border border-gray-300 bg-white py-1 shadow-lg">
                {suggest(d).map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setDepts((xs) => xs.map((x, k) => (k === i ? s : x)));
                        setFocus(-1);
                      }}
                      className="block w-full px-4 py-2 text-left text-[14px] text-gray-800 hover:bg-gray-50"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13.5px] text-gray-700">
        <input type="checkbox" checked={unsure} onChange={(e) => setUnsure(e.target.checked)} className="h-4 w-4 accent-gray-900" />
        아직 못 정했어요 · 내 활동과 잘 맞는 학과를 찾아 주세요
      </label>
      <button disabled={!ok || busy} className="mt-4 h-12 w-full bg-gray-900 text-[15px] font-bold text-white disabled:opacity-50">
        AI 진단 받기
      </button>
    </form>
  );
}

function Result({ r, unsure, onRedo, at }) {
  const nav = useNavigate();
  const strong = (r.cells ?? []).filter((c) => c.link === "강함").length;
  const course = r.course ?? {};
  const rec = r.record ?? {};
  return (
    <>
      {/* 컨설턴트 한마디 */}
      <section className="mt-5 bg-gray-900 p-5 text-white">
        <p className="text-[12px] font-bold text-gray-400">{r.main} 기준 · 컨설팅 요약</p>
        <p className="mt-1.5 text-[15.5px] font-bold leading-relaxed">{r.summary}</p>
        {(r.cells ?? []).length > 0 && <p className="mt-3 text-[13px] text-gray-300">적은 칸 {r.cells.length}개 중 <b className="text-[17px] text-white">{strong}칸</b>이 학과와 강하게 이어져요</p>}
      </section>

      {/* 1 학과 적합도 */}
      <H n="1" sub={unsure ? "내 활동과 잘 맞는 학과" : "희망 학과마다 내 생기부가 얼마나 이어지는지"}>학과 적합도</H>
      <div className="divide-y divide-gray-100">
        {(r.fit ?? []).map((f) => (
          <div key={f.department} className="py-3.5">
            <div className="flex items-center gap-2">
              <b className="text-[15.5px] text-gray-900">{f.department}</b>
              {f.department === r.main && <span className="text-[11.5px] font-bold text-gray-400">진단 기준</span>}
              <span className="ml-auto text-[13px] font-extrabold text-gray-900">{f.score}</span>
              <Tag v={f.level} />
            </div>
            <div className="mt-2 h-1.5 bg-gray-100"><div className="h-full bg-gray-900" style={{ width: `${f.score}%` }} /></div>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{f.line}</p>
          </div>
        ))}
      </div>
      {r.other && <p className="mt-1 bg-[#F7F7F8] px-4 py-3 text-[13px] leading-relaxed text-gray-700">{r.other}</p>}

      {/* 2 생기부 분석 */}
      {(rec.strengths?.length > 0 || rec.gaps?.length > 0) && (
        <>
          <H n="2" sub="지금까지 적은 활동을 학과 기준으로 읽었어요">생기부 분석</H>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {[["강점", rec.strengths, true], ["빈 곳", rec.gaps, false]].map(([t, list, good]) => (
              <div key={t}>
                <p className={`inline-block px-2 py-0.5 text-[12px] font-extrabold ${good ? "bg-gray-900 text-white" : "border border-gray-400 text-gray-700"}`}>{t}</p>
                {(list ?? []).map((x, i) => (
                  <div key={i} className="mt-2.5">
                    <b className="block text-[14px] text-gray-900">{x.title}</b>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-gray-600">{x.why}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {rec.flow && <p className="mt-4 border-l-2 border-gray-900 pl-3 text-[13.5px] leading-relaxed text-gray-800"><b>학년 흐름 · </b>{rec.flow}</p>}
        </>
      )}

      {/* 3 과목 적합도 */}
      {(course.line || course.reco?.length > 0) && (
        <>
          <H n="3" sub={course.univs ? `${r.main} 관련 학과가 있는 ${course.univs}개 대학이 발표한 권장과목(2028학년도)과 비교` : "학과가 일반적으로 보는 과목과 비교"}>과목 적합도</H>
          <div className="mt-3 flex items-start gap-2">
            <Tag v={course.level} />
            <p className="text-[13.5px] leading-relaxed text-gray-800">{course.line}</p>
          </div>
          {course.reco?.length > 0 && (
            <table className="mt-3 w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-gray-200 text-[11.5px] text-gray-400">
                  <th className="py-1.5 font-bold">과목</th><th className="py-1.5 text-center font-bold">핵심</th><th className="py-1.5 text-center font-bold">권장</th><th className="py-1.5 text-right font-bold">나</th>
                </tr>
              </thead>
              <tbody>
                {course.reco.map((x) => (
                  <tr key={x.name} className="border-b border-gray-100">
                    <td className="py-2 font-bold text-gray-900">{x.name}</td>
                    <td className="py-2 text-center text-gray-700">{x.core ? `${x.core}곳` : "-"}</td>
                    <td className="py-2 text-center text-gray-700">{x.reco ? `${x.reco}곳` : "-"}</td>
                    <td className="py-2 text-right">{x.have ? <b className="text-gray-900">들음</b> : <span className="text-gray-400">안 고름</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {course.missing?.length > 0 && (
            <div className="mt-4">
              <p className="text-[12.5px] font-bold text-gray-500">꼭 챙길 과목</p>
              {course.missing.map((x) => (
                <div key={x.name} className="mt-2 flex gap-3">
                  <span className="w-9 flex-none text-[12px] font-extrabold text-gray-500">{x.when}</span>
                  <span className="min-w-0"><b className="text-[14px] text-gray-900">{x.name}</b><span className="block text-[12.5px] leading-relaxed text-gray-600">{x.why}</span></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 4 역량 */}
      {r.competencies?.length > 0 && (
        <>
          <H n="4" sub={`${r.main}가 생기부에서 보는 것`}>학과가 보는 역량</H>
          <div className="divide-y divide-gray-100">
            {r.competencies.map((c, i) => (
              <div key={i} className="py-3.5">
                <div className="flex items-center gap-2"><b className="text-[14.5px] text-gray-900">{c.name}</b><span className="ml-auto"><Tag v={c.status} /></span></div>
                {c.evidence && <p className="mt-1 text-[13px] text-gray-600">근거 · {c.evidence}</p>}
                {c.tip && c.status !== "충분" && <p className="mt-1.5 bg-[#F7F7F8] px-3 py-2 text-[13px] leading-relaxed text-gray-800">채우는 법 · {c.tip}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 5 칸마다 */}
      {r.cells?.length > 0 && (
        <>
          <H n="5" sub={`적은 활동 하나하나가 ${r.main}와 이어지는지`}>칸마다 연결</H>
          <div className="divide-y divide-gray-100">
            {r.cells.map((c, i) => (
              <div key={i} className="flex gap-3 py-2.5">
                <span className="w-[86px] flex-none text-[13px] font-bold text-gray-900">{c.label}</span>
                <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-gray-600">{c.why}</span>
                <Tag v={c.link} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* 6 앞으로 채우는 순서 */}
      {r.plan?.length > 0 && (
        <>
          <H n="6" sub="빈 곳과 약한 역량을 시기마다 나눠서">앞으로 이렇게 채워요</H>
          <ol className="mt-4 border-l border-gray-300">
            {r.plan.map((p, i) => (
              <li key={i} className="relative pb-5 pl-5 last:pb-0">
                <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 ${i === 0 ? "bg-gray-900" : "border border-gray-400 bg-white"}`} />
                <p className="text-[12px] font-extrabold text-gray-500">{p.when}</p>
                <b className="mt-0.5 block text-[14.5px] text-gray-900">{p.focus}</b>
                <ul className="mt-1.5 space-y-1">
                  {p.todo.map((t, k) => <li key={k} className="text-[13px] leading-relaxed text-gray-700">· {t}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}

      {/* 7 다음 학년 */}
      {(r.subjects?.length > 0 || r.inquiries?.length > 0) && (
        <>
          <H n="7" sub="탐구는 누르면 물꼬가 그 과목 탐구를 같이 시작해요">{r.next ?? "고2"}에 할 것</H>
          {r.subjects?.length > 0 && (
            <>
              <p className="mt-4 text-[12.5px] font-bold text-gray-500">고르면 좋은 선택과목</p>
              <div className="divide-y divide-gray-100">
                {r.subjects.map((x) => (
                  <div key={x.name} className="py-2.5"><b className="text-[14px] text-gray-900">{x.name}</b><p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">{x.why}</p></div>
                ))}
              </div>
            </>
          )}
          {r.inquiries?.length > 0 && (
            <>
              <p className="mt-4 text-[12.5px] font-bold text-gray-500">이어가면 좋은 탐구</p>
              <div className="mt-1 grid gap-2">
                {r.inquiries.map((q, i) => (
                  <button key={i} onClick={() => nav(`/agent?do=tp&subj=${encodeURIComponent(q.subject || "진로")}`)} className="border border-gray-200 bg-white px-4 py-3 text-left hover:border-gray-900">
                    <span className="text-[11.5px] font-bold text-gray-400">{q.subject}</span>
                    <b className="mt-0.5 block text-[14.5px] leading-snug text-gray-900">{q.title}</b>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-gray-600">{q.why}</span>
                    <span className="mt-2 block text-[12.5px] font-extrabold text-gray-900">물꼬와 이 탐구 시작 ›</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 다 읽고 나면 — "이 진단 도움이 됐어?" (진단 한 번에 한 번) */}
      <div className="mt-10"><FeedbackAsk feature="diagnosis" refId={at || ""} /></div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to="/" className="flex h-12 items-center justify-center border border-gray-300 text-[14px] font-bold text-gray-800">로드맵에 더 채우기</Link>
        <button onClick={onRedo} className="h-12 bg-gray-900 text-[14px] font-bold text-white">학과 바꿔서 다시 보기</button>
      </div>
      <p className="mt-5 text-center text-[11.5px] leading-relaxed text-gray-400">
        {r.ref_count > 0 ? "생수면 탐구주제 데이터의 같은 학과 사례 · " : ""}대학 권장과목은 각 대학 2028학년도 발표 자료 기준이에요.
        <br />진단은 로드맵에 적은 활동만 보고 판단한 참고 자료예요. 칸을 더 채우면 다시 받아 보세요.
      </p>
    </>
  );
}

export default function NoteDiagnosis() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState("load"); // load | form | run | result | locked
  const [data, setData] = useState(null); // { result, departments, unsure, created_at }
  const [lock, setLock] = useState(null);
  const [initDept, setInitDept] = useState([]);
  const [err, setErr] = useState("");

  // 지난 진단 + 노트의 희망 학과
  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("note_diagnoses").select("result, departments, unsure, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.rpc("sm_get_my"),
      supabase.rpc("note_list"),
    ]).then(([d, my, notes]) => {
      // 고1 10칸을 채우기 전에는 학과 입력칸도 보여 주지 않는다
      const prog = g1Progress(notes.data);
      if (prog.done < prog.need) {
        setLock(prog);
        return setState("locked");
      }
      if (d.data?.result?.plan) { // 예전 진단(컨설팅 전)이면 학과 칸부터 다시
        setData(d.data);
        setInitDept(d.data.departments ?? []);
        setState("result");
      } else {
        setInitDept(d.data?.departments?.length ? d.data.departments : my.data?.department ? [my.data.department] : []);
        setState("form");
      }
    });
  }, [user]);

  async function run(departments, unsure) {
    setErr("");
    setState("run");
    window.scrollTo(0, 0);
    const { data: res, error } = await supabase.functions.invoke("note_diagnose", { body: { departments, unsure } });
    if (error || res?.error) {
      let m = res?.error;
      try {
        m = m ?? (await error?.context?.json?.())?.error;
      } catch {
        // 무시
      }
      setErr(m || "진단하지 못했어요. 잠시 후 다시 해 주세요.");
      return setState(data ? "result" : "form");
    }
    if (res.locked) {
      setLock(res);
      return setState("locked");
    }
    setData(res);
    setInitDept(res.departments ?? []);
    setState("result");
    // 1지망 학과를 노트의 희망 학과로도 저장 (다른 화면과 맞추기)
    if (departments[0]) supabase.rpc("sm_set_dept", { p_department: departments[0] });
  }

  if (loading) return <div className="py-24 text-center text-gray-500">불러오는 중…</div>;
  if (!user)
    return <LoginGate icon={<NoteIcon />} title="내 생기부 진단은 회원 전용이에요" desc="학년별 활동을 적으면 가고 싶은 학과 기준으로 AI가 입시 방향을 진단하고, 다음 학년 로드맵까지 짜 줘요." />;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
        <Link to="/" className="text-[13px] font-semibold text-gray-500">‹ 내 입시 로드맵</Link>
        <h1 className="mt-2 text-[24px] font-black tracking-tight text-gray-900">AI 입시 방향 진단</h1>
        {data?.created_at && state === "result" && (
          <p className="mt-1 text-[12.5px] text-gray-500">
            {new Date(data.created_at).toLocaleDateString("ko-KR")} 진단 · {data.unsure ? "학과 추천" : (data.departments ?? []).join(" · ")}
          </p>
        )}
        {err && <p className="mt-3 border border-gray-900 px-4 py-3 text-[13.5px] font-semibold text-gray-900">{err}</p>}

        {state === "load" && <p className="py-20 text-center text-[14px] text-gray-500">불러오는 중…</p>}
        {state === "form" && <DeptForm init={initDept} onRun={run} />}
        {state === "run" && <Loading />}

        {state === "locked" && lock && (
          <div className="mt-6 border border-gray-200 bg-white p-6 text-center">
            <p className="text-[17px] font-bold text-gray-900">고1 {lock.need ?? 10}칸을 채우면 진단이 열려요</p>
            <p className="mt-2 text-[14px] text-gray-600">
              지금 {lock.done}칸
              {(lock.need ?? 10) > lock.done ? ` · ${(lock.need ?? 10) - lock.done}칸 남았어요` : " · 잠시 후 다시 시도해 주세요"}
            </p>
            <Link to="/" className="mt-4 inline-block bg-gray-900 px-6 py-3 text-[14.5px] font-bold text-white">로드맵에서 채우러 가기</Link>
          </div>
        )}

        {state === "result" && data?.result && (
          <>
            <Result r={data.result} unsure={data.unsure} at={data.created_at} onRedo={() => { setState("form"); window.scrollTo(0, 0); }} />
          </>
        )}
      </div>
    </div>
  );
}