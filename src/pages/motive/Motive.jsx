import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { getClientId } from "../../lib/clientId";
import { track } from "../../lib/track";
import InviteGate, { openDay } from "../../components/InviteGate";
import "../landing/landing.css";

/*
 * 지원동기 흔한가 — /motive (고3 대입 시즌)
 * 지원 대학(선택) · 지원 학과 · 면접/자소서 · 지원동기 글 → 흔함 지수 · 뻔한 표현 형광펜
 *   · 왜 흔한지 · 내 경험으로 바꾸는 질문 3개 · 다시 짜는 틀(계기 → 한 일·배운 점 → 대학에서 할 것)
 * 무료 3번 (계정·브라우저 기준 전체), 비회원은 흔함 지수 아래를 흐리게
 */

/* 희망 학과 추천 목록 — 탐구주제 DB에 들어 있는 학과 131개 (다른 진단과 같은 목록) */
export const DEPARTMENTS = [
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

/* 대학 추천 목록 — 대학별 면접 분석 데이터가 있는 140개 대학 (여기 있는 대학은 그 대학 기준 분석이 나온다) */
export const UNIVERSITIES = [
  "가천대학교", "가톨릭대학교", "강원대학교", "건국대학교", "경기대학교", "경북대학교", "경희대학교", "광운대학교", "국민대학교", "단국대학교",
  "동국대학교", "부산대학교", "서울대학교", "서울시립대학교", "서울여자대학교", "성신여자대학교", "세종대학교", "숭실대학교", "아주대학교",
  "을지대학교", "인천대학교", "전남대학교", "전북대학교", "조선대학교", "중앙대학교", "차의과학대학교", "동아대학교", "우석대학교", "창원대학교",
  "계명대학교", "한국체육대학교", "대구한의대학교", "백석대학교", "감리교신학대학교", "한국외국어대학교", "총신대학교", "수원대학교",
  "신경주대학교", "지스트(광주과학기술원)", "한국과학기술원(KAIST)", "인하대학교", "공군사관학교", "포스텍(포항공과대학교)", "호서대학교", "서일대학교",
  "덕성여자대학교", "공주대학교", "이화여자대학교", "상지대학교", "안양대학교", "한양여자대학교", "명지대학교", "대진대학교", "부산외국어대학교",
  "삼육보건대학교", "대구대학교", "성공회대학교", "한동대학교", "한국성서대학교", "한국교통대학교", "육군사관학교", "세명대학교", "동양대학교", "원광대학교",
  "디지스트(대구경북과학기술원)", "수원가톨릭대학교", "홍익대학교", "유니스트(울산과학기술원)", "경상국립대학교", "숙명여자대학교",
  "한국외국어대학교(글로벌캠퍼스)", "인천가톨릭대학교", "한양대학교", "한림대학교", "우송대학교", "순천향대학교", "성균관대학교", "루터대학교",
  "한국공학대학교", "충남대학교", "강릉원주대학교", "대전대학교", "서울여자간호대학교", "선문대학교", "협성대학교", "광주가톨릭대학교", "인하공업전문대학",
  "건양대학교", "건국대학교(글로컬)", "장로회신학대학교", "가톨릭꽃동네대학교", "상명대학교", "상명대학교(천안캠퍼스)", "서울과학기술대학교", "김천대학교",
  "순천대학교", "농협대학교", "청주대학교", "삼육대학교", "경동대학교", "울산대학교", "국립경국대학교", "해군사관학교", "한국항공대학교", "나사렛대학교",
  "강남대학교", "인제대학교", "배재대학교", "동덕여자대학교", "마산대학교", "가톨릭상지대학교", "인덕대학교", "경남도립거창대학", "남서울대학교",
  "경인여자대학교", "고신대학교", "극동대학교", "대구가톨릭대학교", "부천대학교", "서원대학교", "충청대학교", "한신대학교", "경남대학교", "경일대학교",
  "부산가톨릭대학교", "신라대학교", "연성대학교", "한세대학교", "대림대학교", "강서대학교", "청주교육대학교", "대구교육대학교",
  "신한대학교", "구미대학교", "대구보건대학교", "영산대학교", "유원대학교",
];

const MAX = 700; // 지원동기 최대 글자 수
const MIN = 30;

/* 지원동기 진단 색 — 크기·배치는 다른 진단과 같고, 색만 초록 계열로 구분 */
const THEME = {
  hero: "linear-gradient(160deg,#86E3B8 0%,#3CC48F 32%,#15A673 66%,#0B8A5E 100%)",
  mid: "#063B2A",
  shadow: "0 3px 14px rgba(6,59,42,.25)",
  field: "0 2px 12px rgba(6,59,42,.18)",
  foot: "#DDF7EA",
  accent: "#0B8A5E",
};

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
    <ul className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl bg-white py-1 text-left shadow-lg ring-1 ring-black/10">
      {items.map((it) => (
        <li key={it}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it);
            }}
            className="block w-full px-4 py-2.5 text-left text-[14.5px] text-gray-800 hover:bg-emerald-50"
          >
            {it}
          </button>
        </li>
      ))}
    </ul>
  );
}

const VERDICT = ["나만의 지원동기예요", "괜찮은 편이에요", "조금 흔해요", "흔한 편이에요", "아주 흔해요"];
const KEY = "sm_motive"; // 로그인하러 다녀와도 결과가 남도록
const STAGE = ["지원동기를 읽고 있어요", "얼마나 흔한지 따져보고 있어요", "나만의 지원동기로 바꿀 방법을 찾고 있어요"];

/* 진단 중 — 막대는 천천히 오르다 99%에서 멈추고, 응답이 오면 100% */
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
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${p}%`, background: THEME.accent }} />
      </div>
      <p className="mt-3 text-[22px] font-black text-sm-navy">{p}%</p>
      <p className="mt-4 text-[12px] text-gray-400">보통 10~20초 걸려요</p>
    </div>
  );
}

/* 대학 기준 — 평가요소 비중과, 이 지원동기에서 얼마나 드러나는지 (비회원에게도 보여준다: 신뢰의 근거) */
const SEEN = (v) => (v >= 70 ? ["잘 보여요", "#0B8A5E"] : v >= 40 ? ["조금 보여요", "#D97706"] : ["부족해요", "#DC2626"]);
function UnivBars({ u, locked = false }) {
  return (
    <section className="mt-5 rounded-2xl border-[1.5px] p-5" style={{ borderColor: "#A7E3C8", background: "#F4FCF8" }}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[16px] font-extrabold text-sm-navy">{u.name} 기준으로 봤어요</p>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-emerald-200" style={{ color: THEME.accent }}>
          생수면 대학별 면접 분석 데이터
        </span>
      </div>
      {u.view && <p className="mt-2 text-[13px] leading-relaxed text-gray-600">“{u.view}”</p>}
      <ul className="mt-4 space-y-3">
        {u.factors.map((f, i) => {
          const [label, color] = SEEN(f.seen);
          // 비회원은 첫 번째 요소만 보여주고 나머지는 흐리게
          const hide = locked && i > 0;
          return (
            <li key={f.factor} className={hide ? "pointer-events-none select-none blur-[5px]" : ""} aria-hidden={hide || undefined}>
              <div className="flex items-center gap-2 text-[13.5px]">
                <b className="text-sm-navy">{f.factor}</b>
                <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-bold text-gray-500 ring-1 ring-gray-200">비중 {f.weight}%</span>
                <span className="ml-auto text-[12.5px] font-extrabold" style={{ color }}>{label}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white ring-1 ring-gray-100">
                <div className="h-full rounded-full" style={{ width: `${Math.max(4, f.seen)}%`, background: color }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11.5px] text-gray-400">비중은 이 대학 면접에서 각 요소를 얼마나 중요하게 보는지, 막대는 내 지원동기에서 얼마나 드러나는지예요.</p>
    </section>
  );
}

/* 대학 기준 자세히 — 요소마다 드러난 문장·보강 방법, 면접관의 첫 질문 */
function UnivDetail({ u, onInterview }) {
  return (
    <section className="mt-7">
      <h3 className="text-[16px] font-extrabold text-sm-navy">{u.name} 면접관이라면</h3>
      {u.summary && <p className="mt-2 text-[14px] leading-relaxed text-gray-700">{u.summary}</p>}
      <div className="mt-2 space-y-2">
        {u.factors.map((f) => (
          <div key={f.factor} className="rounded-xl border border-gray-200 p-4">
            <p className="text-[14px] font-bold text-sm-navy">
              {f.factor} <span className="text-[12px] font-bold" style={{ color: SEEN(f.seen)[1] }}>· {SEEN(f.seen)[0]}</span>
            </p>
            {f.evidence ? (
              <p className="mt-1 text-[13px] text-gray-600">
                여기서 보여요 · <mark className="rounded bg-emerald-100 px-1 text-sm-navy">“{f.evidence}”</mark>
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-gray-400">지원동기에서 아직 드러나지 않아요</p>
            )}
            {f.tip && (
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: THEME.accent }}>
                <b>보강하려면</b> · {f.tip}
              </p>
            )}
          </div>
        ))}
      </div>
      {u.question && (
        <div className="mt-3 rounded-xl p-4 text-white" style={{ background: "#18224F" }}>
          <p className="text-[12px] font-bold text-orange-200">{u.name} 면접관의 첫 질문 (예상)</p>
          <p className="mt-1 text-[15px] font-extrabold leading-snug">“{u.question}”</p>
          <button
            onClick={() => {
              track("motive_gate", "interview");
              onInterview?.();
            }}
            className="mt-3 flex w-full items-center justify-between rounded-lg bg-white/10 px-3.5 py-2.5 text-left"
          >
            <span className="text-[13px] font-bold">내 생기부로 {u.name} 면접 예상 질문 뽑기</span>
            <span className="rounded-full bg-sm-orange px-2.5 py-0.5 text-[11.5px] font-bold">바로가기 →</span>
          </button>
        </div>
      )}
    </section>
  );
}

/* 대학 기준 자세히 — 비회원이면 흐리게 */
function Detail({ r, onInterview }) {
  return <>{r.univ && <UnivDetail u={r.univ} onInterview={onInterview} />}</>;
}

/* 결과 맨 아래 — 남은 무료 횟수와 다시 진단 */
function After({ r, onAgain }) {
  return (
    <>
      {r.remaining != null && (
        <p className="mt-6 text-center text-[13.5px] font-bold text-sm-navy">
          이번 주 남은 지원동기 진단 <span className="text-sm-orange">{r.remaining}번</span>
          {r.bonus_left > 0 && <span className="text-[12px] font-normal text-gray-500"> (친구 초대로 받은 {r.bonus_left}번 포함)</span>}
          {r.remaining === 0 && r.next_open && (
            <span className="block text-[12px] font-normal text-gray-500">
              {openDay(r.next_open)}에 1번이 다시 열려요{r.is_member ? " · 친구를 초대하면 바로 1번" : ""}
            </span>
          )}
        </p>
      )}
      <button onClick={onAgain} className="mt-3 h-12 w-full rounded-xl border-[1.5px] border-sm-navy text-[14px] font-bold text-sm-navy">
        고쳐 쓴 지원동기 다시 진단하기
      </button>
    </>
  );
}

export default function Motive() {
  const nav = useNavigate();
  const { user } = useAuth();

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  })();
  const [form, setForm] = useState(saved?.form ?? { university: "", department: "", use_for: "interview", motive: "" });
  const [focus, setFocus] = useState(null);
  const [view, setView] = useState(saved?.result ? "result" : "input"); // input | loading | result
  const [result, setResult] = useState(saved?.result ?? null);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const len = form.motive.trim().length;
  const ok = form.department.trim() && len >= MIN && len <= MAX;

  useEffect(() => {
    if (view === "result" && result && !result.quota_exceeded && !result.invalid) track("motive_view", form.use_for);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, result]);

  async function run() {
    if (!ok) return;
    setErr("");
    setDone(false);
    setView("loading");
    window.scrollTo(0, 0);
    const { data, error } = await supabase.functions.invoke("motive", { body: { ...form, client_id: getClientId() } });
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

  // 다시 진단 — 쓴 글은 남겨 두고 고쳐 쓰게
  function again() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // 무시
    }
    setResult(null);
    setView("input");
    window.scrollTo(0, 0);
  }

  const r = result;
  const meta = [form.university, form.department, form.use_for === "document" ? "자소서·서류" : "면접 답변"].filter(Boolean).join(" · ");

  return (
    // 입력 화면은 화면 폭 가득 초록색, 나머지는 가운데 좁게
    <div className={view === "input" ? "" : "mx-auto max-w-[560px] px-5 pb-16 pt-8"}>
      {/* ① 입력 */}
      {view === "input" && (
        <div className="lp">
          <header className="hero" style={{ background: THEME.hero }}>
            <div className="wrap">
              {err && <p className="mx-auto mb-4 max-w-[560px] rounded-lg bg-white px-4 py-3 text-center text-[13.5px] font-bold text-red-600">{err}</p>}
              <p className="mid" style={{ color: THEME.mid }}>
                내 지원동기 <u style={{ borderColor: THEME.mid }}>흔한가</u>?
              </p>
              <h1 style={{ textShadow: THEME.shadow }}>지원동기 진단</h1>

              <form
                className="tform"
                onSubmit={(e) => {
                  e.preventDefault();
                  run();
                }}
              >
                <div className="trow relative" style={{ gridTemplateColumns: "1fr 1.3fr" }}>
                  <div className="relative">
                    <input
                      className="tfield"
                      style={{ boxShadow: THEME.field }}
                      type="text"
                      autoComplete="off"
                      aria-label="지원 대학"
                      value={form.university}
                      onChange={(e) => set("university", e.target.value)}
                      onFocus={() => setFocus("univ")}
                      onBlur={() => setFocus(null)}
                      placeholder="지원 대학 (예: 가천대학교)"
                    />
                    {focus === "univ" && (
                      <SuggestList items={suggest(form.university, UNIVERSITIES)} onPick={(v) => { set("university", v); setFocus(null); }} />
                    )}
                  </div>
                  <div className="relative">
                    <input
                      className="tfield"
                      style={{ boxShadow: THEME.field }}
                      type="text"
                      autoComplete="off"
                      aria-label="지원 학과"
                      value={form.department}
                      onChange={(e) => set("department", e.target.value)}
                      onFocus={() => setFocus("dept")}
                      onBlur={() => setFocus(null)}
                      placeholder="지원 학과 (예: 간호학과)"
                    />
                    {focus === "dept" && (
                      <SuggestList items={suggest(form.department, DEPARTMENTS)} onPick={(v) => { set("department", v); setFocus(null); }} />
                    )}
                  </div>
                </div>

                {/* 어디에 쓰는지 */}
                <div className="mb-2.5 grid grid-cols-2 gap-2.5">
                  {[
                    ["interview", "면접 답변", "말로 하는 지원동기"],
                    ["document", "자소서·서류", "글로 쓰는 지원동기"],
                  ].map(([v, l, d]) => {
                    const on = form.use_for === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => set("use_for", v)}
                        aria-pressed={on}
                        className={`rounded-xl px-4 py-3 text-center transition ${
                          on ? "bg-white text-sm-navy shadow-md ring-2 ring-sm-navy" : "bg-white/20 text-white ring-1 ring-white/40 hover:bg-white/30"
                        }`}
                      >
                        <p className="text-[14.5px] font-extrabold">{l}</p>
                        <p className={`mt-0.5 text-[12px] ${on ? "text-gray-500" : "text-white/90"}`}>{d}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="relative">
                  <textarea
                    className="tinput"
                    style={{ boxShadow: THEME.field }}
                    rows={6}
                    value={form.motive}
                    onChange={(e) => set("motive", e.target.value)}
                    placeholder={"지원동기를 적어주세요\n예) 어릴 때부터 아픈 사람을 돕는 일에 관심이 많았습니다. 병원에서 봉사하며…"}
                  />
                  <span className={`pointer-events-none absolute bottom-3 right-4 text-[12px] ${len > MAX ? "font-bold text-red-500" : "text-gray-400"}`}>
                    {len}/{MAX}
                  </span>
                </div>
                {len > MAX && <p className="text-[13px] font-bold text-white">지원동기는 {MAX}자 이내로 줄여주세요.</p>}

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
          <p className="text-[12.5px] text-gray-500">{meta}</p>
          <p className="mt-1 text-[21px] font-black text-sm-navy">내 지원동기</p>
          <div className="mt-4">
            <Loading done={done} />
          </div>
        </>
      )}

      {/* 무료를 다 씀 — 회원: 친구 초대 또는 기다리기 / 비회원: 회원가입 */}
      {view === "result" && r?.quota_exceeded && r.is_member && (
        <InviteGate
          title="이번 주 무료 지원동기 진단 2번을 모두 사용했어요"
          question="한 번 더 확인해보고 싶은 지원동기가 있나요?"
          reward="+1번"
          unit="번"
          name="지원동기"
          weekly={2}
          bonusTable="motive_bonus"
          shareText="내 지원동기, 면접관이 매년 듣는 말인지 진단해 봐! 대학별 면접 기준으로 봐 줘"
          nextOpen={r.next_open}
          onHome={() => setView("input")}
          color="#0B8A5E"
        />
      )}
      {view === "result" && r?.quota_exceeded && !r.is_member && (
        <div className="rounded-2xl border border-gray-200 px-6 py-8 text-center">
          <p className="text-[18px] font-extrabold text-sm-navy">이번 주 무료 진단 1번을 썼어요</p>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            회원가입하면 <b className="text-sm-navy">일주일에 2번</b>씩 진단하고,
            <br />
            대학별 기준 분석까지 모두 볼 수 있어요.
          </p>
          <button onClick={() => { track("motive_gate", "quota"); nav("/signup"); }} className="mt-5 h-12 w-full rounded-xl bg-sm-orange text-[15px] font-extrabold text-white">
            회원가입하고 2번 더 진단하기
          </button>
          <p className="mt-3 text-[12.5px] text-gray-400">{openDay(r.next_open) ? `${openDay(r.next_open)}에 다시 1번 열려요` : "일주일 뒤 다시 1번 열려요"}</p>
          <button onClick={() => setView("input")} className="mt-2 text-[13px] text-gray-400 underline">처음으로</button>
        </div>
      )}

      {/* 지원동기가 아님 */}
      {view === "result" && r?.invalid && (
        <div className="rounded-2xl border border-gray-200 px-6 py-8 text-center">
          <p className="text-[18px] font-extrabold text-sm-navy">지원동기로 읽기 어려워요</p>
          <p className="mt-2 text-[14px] text-gray-600">{r.invalid_reason || "왜 이 학과에 지원하는지 문장으로 적어 주세요."}</p>
          <button onClick={() => setView("input")} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">다시 입력하기</button>
        </div>
      )}

      {/* ③ 결과 */}
      {view === "result" && r && !r.quota_exceeded && !r.invalid && (
        <>
          <p className="text-[12.5px] text-gray-500">{meta}</p>
          <p className="mt-1 text-[21px] font-black text-sm-navy">내 지원동기</p>

          <div className="mt-4 rounded-2xl border-[1.5px] border-gray-200 px-5 py-6 text-center">
            <p className="text-[13px] font-bold text-gray-500">지원동기 흔함 지수</p>
            <p className="mt-1 text-[52px] font-black leading-none" style={{ color: THEME.accent }}>
              {r.score}
              <span className="text-[18px] text-gray-400">/100</span>
            </p>
            <p className="mt-2 text-[18px] font-extrabold text-sm-navy">{VERDICT[r.verdict_level] ?? ""}</p>
          </div>

          {r.univ && <UnivBars u={r.univ} locked={!user} />}

          {user ? (
            <>
              <Detail r={r} onInterview={() => nav("/interview", { state: { university: r.univ?.name ?? form.university, department: form.department } })} />
              <After r={r} onAgain={again} />
            </>
          ) : (
            <div className="relative mt-2">
              <div className="pointer-events-none select-none blur-[6px]" aria-hidden="true">
                <Detail r={r} onInterview={() => nav("/interview", { state: { university: r.univ?.name ?? form.university, department: form.department } })} />
                <After r={r} onAgain={again} />
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-start bg-white/50 pt-16 text-center">
                <p className="text-[16px] font-bold leading-relaxed text-sm-navy">
                  어디가 흔한 표현인지와
                  <br />
                  <b className="text-sm-orange">나만의 지원동기로 바꾸는 방법</b>을
                  <br />
                  알려드려요
                </p>
                <button onClick={() => { track("motive_gate", "signup"); nav("/signup"); }} className="mt-4 rounded-xl bg-sm-orange px-7 py-3.5 text-[15px] font-extrabold text-white">
                  회원가입하고 제안받기
                </button>
                <button onClick={() => { track("motive_gate", "login"); nav("/login"); }} className="mt-2.5 text-[12.5px] text-gray-500">
                  이미 계정이 있어요 · 로그인
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}