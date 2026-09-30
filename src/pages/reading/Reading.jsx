import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { getClientId } from "../../lib/clientId";
import { track } from "../../lib/track";
import InviteGate, { openDay } from "../../components/InviteGate";
import { SUBJECT_HINTS } from "../landing/subjects";
import "../landing/landing.css";

/*
 * 독서 흔한가 — /reading
 * 희망 학과 · 학년 · 과목 · 읽은 책 → 흔함 지수 · 책 수준(초급·중급·고급) · 왜 흔한지
 *   · 같은 책 다르게 읽기 · 덜 흔한 책(수준별 1권) · 이어 읽기 맛보기
 * 무료 3권 (계정·브라우저 기준 전체), 비회원은 이유·제안을 흐리게
 */

/* 희망 학과 추천 목록 — 탐구주제 DB에 들어 있는 학과 131개 (탐구주제 진단과 같은 목록) */
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

const GRADES = ["고1", "고2", "고3"];
const TERMS = ["1학기", "2학기"];

/* 독서 진단 색 — 크기·배치는 탐구주제 진단과 같고, 색만 파란 계열로 구분 */
const THEME = {
  hero: "linear-gradient(160deg,#8FB4FF 0%,#5D8BFA 32%,#3D6BEF 66%,#2F56D6 100%)",
  mid: "#10245E", // 위 작은 제목
  shadow: "0 3px 14px rgba(16,36,94,.25)", // 큰 제목 그림자
  field: "0 2px 12px rgba(16,36,94,.18)", // 입력칸 그림자
  foot: "#DCE6FF",
};

/* 학년·학기 선택칸 화살표 — 탐구주제 진단과 같게 */
const ARROW = {
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 7'%3E%3Cpath d='M0 0h10L5 7z' fill='%231f2937'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 18px center",
  backgroundSize: "11px 8px",
  paddingRight: "40px",
};

/* 추천 검색 — 띄어쓰기·로마숫자(Ⅰ/1) 차이는 무시하고, 앞글자가 맞는 것을 먼저 */
const norm = (s) => s.replace(/\s/g, "").replace(/Ⅰ/g, "1").replace(/Ⅱ/g, "2").toLowerCase();
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
    <ul className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl bg-white py-1 text-left shadow-lg ring-1 ring-black/10">
      {items.map((it) => (
        <li key={it}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // 입력칸 포커스가 먼저 빠지지 않게
              onPick(it);
            }}
            className="block w-full px-4 py-2.5 text-left text-[14.5px] text-gray-800 hover:bg-orange-50"
          >
            {it}
          </button>
        </li>
      ))}
    </ul>
  );
}
const VERDICT = ["드문 편이에요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"];
const LEVELS = ["초급", "중급", "고급"];
const LV_STYLE = {
  초급: { chip: "bg-emerald-50 text-emerald-700", cover: "bg-emerald-400" },
  중급: { chip: "bg-blue-50 text-blue-700", cover: "bg-blue-400" },
  고급: { chip: "bg-violet-50 text-violet-700", cover: "bg-violet-400" },
};
const KEY = "sm_reading"; // 로그인하러 다녀와도 입력이 남도록

// 진단 중 문구 — 어떤 순서로 판단하는지는 드러내지 않고, 멈춘 게 아니라는 것만 보여준다
const STAGE = ["책을 살펴보고 있어요", "얼마나 흔한지 따져보고 있어요", "나만의 독서 방법을 찾고 있어요"];

/* 진단 중 — 진행 막대는 천천히 오르다 99%에서 멈추고, 응답이 오면 100% */
function Loading({ done }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setSec((Date.now() - t0) / 1000), 200);
    return () => clearInterval(t);
  }, []);
  const p = done ? 100 : Math.min(99, Math.round(100 * (1 - Math.exp(-sec / 7))));
  const at = Math.min(STAGE.length - 1, Math.floor((p / 100) * STAGE.length));
  return (
    <div className="rounded-2xl border border-gray-200 px-6 py-8 text-center" role="status" aria-live="polite">
      <p className="text-[16px] font-extrabold text-sm-navy">{STAGE[at]}</p>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-[#3D6BEF] transition-all duration-300" style={{ width: `${p}%` }} />
      </div>
      <p className="mt-3 text-[22px] font-black text-sm-navy">{p}%</p>
      <p className="mt-4 text-[12px] text-gray-400">보통 10~20초 걸려요</p>
    </div>
  );
}

/* 이유·제안 — 비회원이면 흐리게 */
function Detail({ r }) {
  return (
    <>
      <section className="mt-7">
        <h3 className="text-[16px] font-extrabold text-sm-navy">왜 흔한 독서일까?</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{r.reason}</p>
      </section>

      {r.angles?.length > 0 && (
        <section className="mt-7">
          <h3 className="text-[16px] font-extrabold text-sm-navy">같은 책, 이렇게 읽으면 달라져요</h3>
          <div className="mt-2 space-y-2">
            {r.angles.map((a, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-4">
                <span className="rounded-md bg-orange-50 px-2 py-0.5 text-[11.5px] font-bold text-orange-700">{a.tag}</span>
                <p className="mt-1.5 text-[14.5px] font-bold text-sm-navy">{a.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{a.how}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {r.alternatives?.length > 0 && (
        <section className="mt-7">
          <h3 className="text-[16px] font-extrabold text-sm-navy">덜 흔한 책, 수준별로 한 권씩</h3>
          <div className="mt-2 space-y-2">
            {r.alternatives.map((b, i) => (
              <div key={i} className="flex gap-3 rounded-xl border border-gray-200 p-4">
                <div className={`flex h-[66px] w-12 shrink-0 items-end rounded-md p-1 text-[9px] font-bold text-white ${LV_STYLE[b.level]?.cover ?? "bg-gray-400"}`}>
                  {b.level}
                </div>
                <div className="min-w-0">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${LV_STYLE[b.level]?.chip ?? ""}`}>{b.level}</span>
                  <p className="mt-1 text-[14.5px] font-bold text-sm-navy">{b.title}</p>
                  {b.author && <p className="text-[12px] text-gray-500">{b.author}</p>}
                  <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">{b.why}</p>
                  {b.verified ? (
                    <p className="mt-1 text-[11.5px] font-bold text-emerald-600">같은 학과 기록 {b.dept_count}번 · 덜 흔해요</p>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-gray-400">도서관·서점에서 한 번 확인하고 읽어 주세요</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* 결과 맨 아래 — 남은 무료 횟수와 다른 책 진단 */
function After({ r, onAgain }) {
  return (
    <>
      {r.remaining != null && (
        <p className="mt-6 text-center text-[13.5px] font-bold text-sm-navy">
          {r.is_member ? "이번 주 남은 독서 진단" : "무료 독서 진단"} <span className="text-sm-orange">{r.remaining}권</span>
          {r.bonus_left > 0 && <span className="text-[12px] font-normal text-gray-500"> (친구 초대로 받은 {r.bonus_left}권 포함)</span>}
          {r.is_member && r.remaining === 0 && r.next_open && (
            <span className="block text-[12px] font-normal text-gray-500">{openDay(r.next_open)}에 1권이 다시 열려요 · 친구를 초대하면 바로 2권</span>
          )}
        </p>
      )}
      <button onClick={onAgain} className="mt-3 h-12 w-full rounded-xl border-[1.5px] border-sm-navy text-[14px] font-bold text-sm-navy">
        다른 책도 진단하기
      </button>
    </>
  );
}

export default function Reading() {
  const nav = useNavigate();
  const { user } = useAuth();

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  })();
  const [form, setForm] = useState(saved?.form ?? { department: "", grade: "", term: "", subject: "", title: "", author: "" });
  const [focus, setFocus] = useState(null); // 추천 목록을 띄울 칸
  const [view, setView] = useState(saved?.result ? "result" : "input"); // input | loading | result
  const [result, setResult] = useState(saved?.result ?? null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const topRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const ok = form.department.trim() && form.grade && form.subject.trim() && form.title.trim();

  useEffect(() => {
    if (view === "result" && result && !result.quota_exceeded && !result.invalid) track("reading_view", result.level);
  }, [view, result]);

  async function run() {
    if (!ok) return;
    setErr("");
    setDone(false);
    setView("loading");
    window.scrollTo(0, 0);
    const { data, error } = await supabase.functions.invoke("reading", {
      body: { ...form, client_id: getClientId() },
    });
    if (error || data?.error) {
      let m = data?.error;
      try {
        m = m ?? (await error?.context?.json?.())?.error;
      } catch {
        // 무시
      }
      setErr(m ?? "진단하지 못했어요. 잠시 후 다시 시도해 주세요.");
      return setView("input");
    }
    setDone(true);
    setTimeout(() => {
      setResult(data);
      setView("result");
      try {
        if (!data.quota_exceeded && !data.invalid) localStorage.setItem(KEY, JSON.stringify({ form, result: data }));
      } catch {
        // 무시
      }
    }, 400);
  }

  function again() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 무시
    }
    setResult(null);
    setForm((f) => ({ ...f, title: "", author: "" }));
    setView("input");
    window.scrollTo(0, 0);
  }

  const field = "w-full rounded-xl border-[1.5px] border-gray-200 px-3.5 py-3 text-[15px] outline-none focus:border-sm-navy";
  const r = result;

  return (
    // 입력 화면은 탐구주제 진단처럼 화면 폭 가득 주황색, 나머지는 가운데 좁게
    <div ref={topRef} className={view === "input" ? "" : "mx-auto max-w-[560px] px-5 pb-16 pt-8"}>

      {/* ① 입력 — 탐구주제 진단과 같은 주황 화면·입력칸 */}
      {view === "input" && (
        <div className="lp">
          <header className="hero" style={{ background: THEME.hero }}>
            <div className="wrap">
              {err && <p className="mx-auto mb-4 max-w-[560px] rounded-lg bg-white px-4 py-3 text-center text-[13.5px] font-bold text-red-600">{err}</p>}
              <p className="mid" style={{ color: THEME.mid }}>
                내 세특 독서 <u style={{ borderColor: THEME.mid }}>흔한가</u>?
              </p>
              <h1 style={{ textShadow: THEME.shadow }}>독서 진단</h1>

              <form
                className="tform"
                onSubmit={(e) => {
                  e.preventDefault();
                  run();
                }}
              >
                {/* 학과 — 타이핑하면 아래에 추천 */}
                <div className="relative">
                  <input
                    className="tfield tfull"
                    style={{ boxShadow: THEME.field }}
                    type="text"
                    autoComplete="off"
                    aria-label="희망 학과"
                    value={form.department}
                    onChange={(e) => set("department", e.target.value)}
                    onFocus={() => setFocus("dept")}
                    onBlur={() => setFocus(null)}
                    placeholder="희망 학과 (예: 간호학과)"
                  />
                  {focus === "dept" && (
                    <SuggestList items={suggest(form.department, DEPARTMENTS)} onPick={(v) => { set("department", v); setFocus(null); }} />
                  )}
                </div>

                <div className="trow relative">
                  <select className="tfield" style={{ ...ARROW, boxShadow: THEME.field }} aria-label="학년" value={form.grade} onChange={(e) => set("grade", e.target.value)}>
                    <option value="">학년</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <select className="tfield" style={{ ...ARROW, boxShadow: THEME.field }} aria-label="학기" value={form.term} onChange={(e) => set("term", e.target.value)}>
                    <option value="">학기</option>
                    {TERMS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    className="tfield"
                    style={{ boxShadow: THEME.field }}
                    type="text"
                    autoComplete="off"
                    aria-label="과목"
                    value={form.subject}
                    onChange={(e) => set("subject", e.target.value)}
                    onFocus={() => setFocus("subject")}
                    onBlur={() => setFocus(null)}
                    placeholder="과목 직접 입력 (예: 생명과학Ⅰ)"
                  />
                  {focus === "subject" && (
                    <SuggestList items={suggest(form.subject, SUBJECT_HINTS)} onPick={(v) => { set("subject", v); setFocus(null); }} />
                  )}
                </div>

                {/* 책 — 제목은 꼭, 저자는 선택 */}
                <input
                  className="tfield tfull"
                  style={{ boxShadow: THEME.field }}
                  type="text"
                  autoComplete="off"
                  aria-label="읽은 책"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="읽은 책 제목 (예: 이기적 유전자)"
                />
                <input
                  className="tfield tfull"
                  style={{ boxShadow: THEME.field }}
                  type="text"
                  autoComplete="off"
                  aria-label="저자"
                  value={form.author}
                  onChange={(e) => set("author", e.target.value)}
                  placeholder="저자 (선택 · 예: 리처드 도킨스)"
                />

                <button className="tbtn" type="submit" disabled={!ok}>
                  확인하기
                </button>
              </form>

              <p className="foot" style={{ color: THEME.foot }}>
                입력하신 내용은 진단과 서비스 개선을 위해 저장됩니다.
              </p>
            </div>
          </header>
        </div>
      )}

      {/* ② 진단 중 */}
      {view === "loading" && (
        <>
          <p className="text-[12.5px] text-gray-500">{[form.department, [form.grade, form.term].filter(Boolean).join(" "), form.subject].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-[21px] font-black text-sm-navy">{form.title}</p>
          {form.author && <p className="text-[13px] text-gray-500">{form.author}</p>}
          <div className="mt-4">
            <Loading done={done} />
          </div>
        </>
      )}

      {/* 무료를 다 씀 — 회원: 친구 초대 또는 기다리기 / 비회원: 회원가입 */}
      {view === "result" && r?.quota_exceeded && r.is_member && (
        <InviteGate
          title="이번 주 무료 독서 진단 2권을 모두 사용했어요"
          question="한 번 더 확인해보고 싶은 책이 있나요?"
          reward="+2권"
          unit="권"
          name="독서"
          weekly={2}
          bonusTable="reading_bonus"
          shareText="생기부 독서, 다들 읽는 책인지 진단해 봐! 가입하면 독서 진단 2권 무료야"
          nextOpen={r.next_open}
          onHome={() => setView("input")}
        />
      )}
      {view === "result" && r?.quota_exceeded && !r.is_member && (
        <div className="rounded-2xl border border-gray-200 px-6 py-8 text-center">
          <p className="text-[18px] font-extrabold text-sm-navy">무료 독서 진단 1권을 썼어요</p>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            회원가입하면 <b className="text-sm-navy">일주일에 2권</b>씩 진단하고,
            <br />
            흔한 이유와 바꾸는 방법까지 모두 볼 수 있어요.
          </p>
          <button onClick={() => { track("reading_gate", "quota"); nav("/signup"); }} className="mt-5 h-12 w-full rounded-xl bg-sm-orange text-[15px] font-extrabold text-white">
            회원가입하고 2권 더 진단하기
          </button>
          <button onClick={() => setView("input")} className="mt-3 text-[13px] text-gray-400 underline">처음으로</button>
        </div>
      )}

      {/* 책이 아님 */}
      {view === "result" && r?.invalid && (
        <div className="rounded-2xl border border-gray-200 px-6 py-8 text-center">
          <p className="text-[18px] font-extrabold text-sm-navy">책 제목으로 읽기 어려워요</p>
          <p className="mt-2 text-[14px] text-gray-600">{r.invalid_reason || "책 제목을 정확하게 적어 주세요."}</p>
          <button onClick={() => setView("input")} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">다시 입력하기</button>
        </div>
      )}

      {/* ③ 결과 */}
      {view === "result" && r && !r.quota_exceeded && !r.invalid && (
        <>
          <p className="text-[12.5px] text-gray-500">{[form.department, [form.grade, form.term].filter(Boolean).join(" "), form.subject].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-[21px] font-black text-sm-navy">{r.title}</p>
          {r.author && <p className="text-[13px] text-gray-500">{r.author}</p>}

          <div className="mt-4 rounded-2xl border-[1.5px] border-gray-200 px-5 py-6 text-center">
            <p className="text-[13px] font-bold text-gray-500">독서 흔함 지수</p>
            <p className="mt-1 text-[52px] font-black leading-none text-[#2F56D6]">
              {r.score}
              <span className="text-[18px] text-gray-400">/100</span>
            </p>
            <p className="mt-2 text-[18px] font-extrabold text-sm-navy">{VERDICT[r.verdict_level] ?? ""}</p>
            <p className="text-[12px] text-gray-400">
              {r.has_data ? "실제 생기부 독서 기록을 바탕으로 판단했어요" : "이 학과 추천도서로 알려진 정도를 바탕으로 판단했어요"}
            </p>

            {r.stats && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  [`${Number(r.stats.total ?? 0).toLocaleString()}번`, "전체 기록에서"],
                  [`${Number(r.stats.dept ?? 0).toLocaleString()}번`, `${form.department}에서`],
                  [r.stats.subject_rank ? `상위 ${r.stats.subject_rank}위` : "-", `${form.subject} 독서`],
                ].map(([v, l]) => (
                  <div key={l} className="rounded-xl bg-gray-50 px-1.5 py-2.5">
                    <p className="text-[17px] font-extrabold text-sm-navy">{v}</p>
                    <p className="truncate text-[11.5px] text-gray-500">{l}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 inline-flex gap-1">
              {LEVELS.map((l) => (
                <span key={l} className={`rounded-full px-3 py-1 text-[12px] font-bold ${r.level === l ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-400"}`}>
                  {l}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-gray-500">
              {form.grade} · {form.department} 기준 <b className="text-sm-navy">{r.level}</b>
              {r.level_reason ? ` — ${r.level_reason}` : ""}
            </p>
          </div>

          {user ? (
            <Detail r={r} />
          ) : (
            <div className="relative mt-2">
              <div className="pointer-events-none select-none blur-[6px]" aria-hidden="true">
                <Detail r={r} />
                <After r={r} onAgain={again} />
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-start bg-white/50 pt-16 text-center">
                <p className="text-[16px] font-bold leading-relaxed text-sm-navy">
                  이 책이 왜 흔한지와
                  <br />
                  <b className="text-sm-orange">나만의 독서로 바꾸는 방법</b>을
                  <br />
                  알려드려요
                </p>
                <button onClick={() => { track("reading_gate", "signup"); nav("/signup"); }} className="mt-4 rounded-xl bg-sm-orange px-7 py-3.5 text-[15px] font-extrabold text-white">
                  회원가입하고 제안받기
                </button>
                <button onClick={() => { track("reading_gate", "login"); nav("/login"); }} className="mt-2.5 text-[12.5px] text-gray-500">
                  이미 계정이 있어요 · 로그인
                </button>
              </div>
            </div>
          )}

          {/* 남은 횟수·다시 진단 — 회원만 밖에 보인다 (비회원은 흐린 영역 안에 함께 가려진다) */}
          {user && <After r={r} onAgain={again} />}

          {/* 탐구주제 흔한가로 — 같은 학과·과목으로 이어서 */}
          <button
            onClick={() => {
              track("cross_topic");
              nav("/topic");
            }}
            className="mt-4 flex w-full items-center justify-between rounded-xl border-[1.5px] border-sm-orange bg-orange-50 px-5 py-4 text-left"
          >
            <span>
              <b className="block text-[15px] font-extrabold text-sm-navy">내 탐구주제도 흔한지 궁금하다면</b>
              <span className="text-[12.5px] text-gray-600">내 탐구주제가 다들 하는 주제인지 진단해 봐요</span>
            </span>
            <span className="shrink-0 rounded-lg bg-sm-orange px-3 py-2 text-[13px] font-extrabold text-white">탐구주제 흔한가 진단하러 가기 →</span>
          </button>
        </>
      )}
    </div>
  );
}