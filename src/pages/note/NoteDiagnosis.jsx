import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";

/*
 * 내 생기부 노트 · AI 진단 (/my/note/diagnosis)
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

const LEVEL_STYLE = { 높음: "bg-emerald-50 text-emerald-700", 보통: "bg-amber-50 text-amber-700", 낮음: "bg-gray-100 text-gray-600" };
const LINK_ICON = { 강함: "✅", 약함: "➖", 없음: "⚪" };
const STATUS_STYLE = { 충분: "bg-emerald-50 text-emerald-700", 약함: "bg-amber-50 text-amber-700", "비어 있음": "bg-red-50 text-red-600" };
const STAGE = ["내 활동을 읽고 있어요", "같은 학과 탐구 사례와 비교하고 있어요", "학과가 보는 역량을 따져보고 있어요", "다음 학년에 할 것을 고르고 있어요"];

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
    <div className="mt-6 rounded-2xl bg-white px-6 py-10 text-center" role="status" aria-live="polite">
      <p className="text-[16px] font-bold text-sm-navy">{STAGE[at]}</p>
      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-sm-navy transition-all duration-300" style={{ width: `${p}%` }} />
      </div>
      <p className="mt-3 text-[22px] font-black text-sm-navy">{p}%</p>
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
      className="mt-4 rounded-2xl border border-gray-200 bg-white p-5"
    >
      <b className="text-[16px] text-sm-navy">어느 학과 기준으로 볼까요?</b>
      <p className="mt-1 text-[12.5px] text-gray-500">가고 싶은 학과를 1~3개 적어 주세요. 학과마다 내 생기부가 얼마나 이어지는지 비교해 드려요.</p>
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
              className="w-full rounded-[10px] border border-gray-200 px-3 py-2.5 text-[14.5px] outline-none focus:border-sm-navy"
            />
            {focus === i && suggest(d).length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
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
        <input type="checkbox" checked={unsure} onChange={(e) => setUnsure(e.target.checked)} className="h-4 w-4 accent-[#18224F]" />
        아직 못 정했어요 · 내 활동과 잘 맞는 학과를 찾아 주세요
      </label>
      <button disabled={!ok || busy} className="mt-4 h-12 w-full rounded-[10px] bg-sm-navy text-[15px] font-bold text-white disabled:opacity-50">
        AI 진단 받기
      </button>
    </form>
  );
}

/* 흐리게 가린 나머지 — 고2 로드맵에서 보이는 부분 */
function Locked({ n, what, next = "고2" }) {
  if (!n) return null;
  return (
    <div className="relative overflow-hidden rounded-xl bg-white px-4 py-3 ring-1 ring-gray-200">
      <div className="select-none blur-[5px]" aria-hidden="true">
        <b className="text-[14.5px] text-sm-navy">●●●● ●●●</b>
        <p className="mt-0.5 text-[12.5px] text-gray-600">●●● ●●●●● ●●●● ●●● ●●●●●● ●●●</p>
      </div>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-sm-navy">
        🔒 {what} {n}개 더 · {next} 로드맵에서
      </span>
    </div>
  );
}

/* 고2 로드맵 (유료 · 정가 14,900원 → 출시 할인 9,900원)
 * [결제하기] → 계좌이체 팝업 → '입금했어요' → 관리자 입금 승인(/admin/orders)에 'roadmap' 주문으로 뜬다
 * 승인되면 note_roadmap_access 에 들어가고, 이 카드가 '결제 완료'로 바뀐다 (관리자가 승인하는 순간 저절로)
 * 주문은 DB 함수 roadmap_order 가 받는다 — 금액은 서버(sm_price)가 정한다 */
const BANK = { name: "국민은행", number: "649301-04-159726", holder: "세움러닝(김지윤)" };
const ROADMAP_PRICE = 9900;

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => window.prompt("복사해 주세요", text))}
      className="shrink-0 rounded-md border border-sm-navy px-2.5 py-1 text-[12px] font-bold text-sm-navy"
    >
      {done ? "복사됨" : "복사"}
    </button>
  );
}

function Roadmap({ main, next = "고2" }) {
  const g3 = next === "고3";
  const { user, profile } = useAuth();
  const [state, setState] = useState(null); // null 확인 중 · "none" · "pending" · "paid"
  const [pending, setPending] = useState(null);
  const [open, setOpen] = useState(false);
  const waitingRef = useRef(false); // 입금 확인 중이었는지
  const nav = useNavigate();

  async function load() {
    const [{ data: acc }, { data: ord }] = await Promise.all([
      supabase.from("note_roadmap_access").select("user_id").maybeSingle(),
      supabase.from("pay_orders").select("id, amount, depositor, created_at").eq("product", "roadmap").eq("status", "pending").order("created_at", { ascending: false }).limit(1),
    ]);
    if (acc) {
      // 이 화면을 보는 동안 승인됐으면 로드맵 화면으로 바로 넘어간다
      if (waitingRef.current) return nav("/my/note/roadmap");
      return setState("paid");
    }
    if (ord?.[0]) {
      waitingRef.current = true;
      setPending(ord[0]);
      return setState("pending");
    }
    setState("none");
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 입금 확인 중이면 — 관리자가 승인하는 순간 저절로 '결제 완료'로 (예비로 30초마다 확인)
  useEffect(() => {
    if (state !== "pending" || !user) return;
    const ch = supabase
      .channel(`roadmap-order-${user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pay_orders", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, user]);

  const items = g3
    ? [
        ["고3 선택과목", "고1·고2 흐름을 마무리할 과목과 이유"],
        ["마무리 탐구 3개 + 흔함 지수", "고3 1학기 안에 끝낼 수 있는 탐구 · 흔한지 표시"],
        ["고3 1학기 생기부 계획", "수시에 들어가는 마지막 학기에 과목별로 무엇을 할지"],
        ["면접에서 물어볼 내 활동 3개", "예상 질문과 답할 때 꼭 말할 것"],
      ]
    : [
        ["고2 선택과목 조합", "추천 과목 4~5개와 이유 · 같이 들으면 좋은 조합"],
        ["이어갈 탐구 5개 + 흔함 지수", "생수면 탐구주제 데이터로 탐구마다 흔한지 표시"],
        ["약한 역량 채우는 학기별 계획", "고2 1학기 · 2학기 과목별로 무엇을 할지"],
      ];
  const name = (profile?.name ?? user?.user_metadata?.name ?? user?.user_metadata?.full_name ?? "").replace(/\s/g, "").slice(0, 5);

  // 결제 승인됐으면 — 로드맵 화면으로 가는 카드
  if (state === "paid")
    return (
      <section className="mt-7 rounded-2xl bg-sm-navy p-6 text-center text-white">
        <small className="text-[12px] font-bold text-orange-300">{g3 ? "고3 1학기 로드맵" : "고2 로드맵"} · 결제 완료</small>
        <p className="mt-2 text-[18px] font-bold leading-snug">{main} 쪽 {g3 ? "고3 1학기" : "고2 1년"} 계획이 열렸어요</p>
        <Link to="/my/note/roadmap" className="mt-4 flex h-12 w-full items-center justify-center rounded-[10px] bg-orange-400 text-[15px] font-bold text-sm-navy">
          내 로드맵 보기 →
        </Link>
      </section>
    );

  return (
    <section className="mt-7 overflow-hidden rounded-2xl bg-sm-navy text-white">
      <div className="p-5">
        <small className="text-[12px] font-bold text-orange-300">{g3 ? "고3 1학기 로드맵" : "고2 로드맵"}</small>
        <p className="mt-1 text-[18px] font-bold leading-snug">
          {main} 쪽으로 {g3 ? "고3 1학기를" : "고2를"}
          <br />
          어떻게 채울지 다 짜 드려요
        </p>
        <ul className="mt-3 grid gap-2">
          {items.map(([t, d]) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-0.5 text-orange-300">✓</span>
              <span>
                <b className="block text-[14px]">{t}</b>
                <span className="text-[12px] text-slate-300">{d}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <span className="rounded bg-orange-400 px-1.5 py-0.5 text-[11px] font-bold text-sm-navy">출시 할인</span>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <s className="text-[14px] text-slate-400">14,900원</s>
            <b className="text-[24px] font-black">9,900원</b>
            <span className="text-[12px] text-slate-300">한 번 결제 · {g3 ? "고3 1학기 계획" : "고2 1년 계획"}</span>
          </div>
        </div>
        {state === "paid" ? (
          <p className="mt-3 rounded-[10px] bg-white/10 px-3 py-3 text-center text-[14px] font-bold leading-relaxed text-orange-200">
            결제 완료 · {next} 로드맵을 만들고 있어요
            <br />
            <span className="text-[12px] font-normal text-slate-300">완성되면 이 화면에서 바로 볼 수 있어요</span>
          </p>
        ) : state === "pending" ? (
          <p className="mt-3 rounded-[10px] bg-white/10 px-3 py-3 text-center text-[14px] font-bold leading-relaxed text-orange-200">
            입금 확인 중이에요 · {pending?.depositor} {Number(pending?.amount ?? ROADMAP_PRICE).toLocaleString()}원
            <br />
            <span className="text-[12px] font-normal text-slate-300">확인되면 이 화면이 저절로 바뀌어요</span>
          </p>
        ) : (
          <button onClick={() => setOpen(true)} disabled={state === null} className="mt-3 h-12 w-full rounded-[10px] bg-orange-400 text-[15px] font-bold text-sm-navy disabled:opacity-60">
            9,900원으로 로드맵 받기
          </button>
        )}
      </div>
      {open && (
        <RoadmapPay
          main={main}
          next={next}
          name={name}
          onClose={() => setOpen(false)}
          onDone={(o) => {
            setPending(o);
            if (o.status === "approved") return nav("/my/note/roadmap");
            waitingRef.current = true;
            setState("pending");
          }}
        />
      )}
    </section>
  );
}

/* 결제 팝업 — 면접 예상질문과 같은 흐름: ① 상품 ② 계좌로 입금 ③ 입금했어요 */
function RoadmapPay({ main, next = "고2", name, onClose, onDone }) {
  const g3 = next === "고3";
  const code = useState(() => String(Math.floor(1000 + Math.random() * 9000)))[0];
  const [depositor, setDepositor] = useState(`${name || "생수면"}${code}`);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const eta = new Date().getHours() < 6 ? "오늘 오전 8시에" : "2시간 안에";

  async function submit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("roadmap_order", { p_depositor: depositor.trim() });
    setBusy(false);
    if (error || !data) return setErr(error?.message?.includes("입금자명") ? "입금자명을 적어 주세요." : "주문을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.");
    const o = { ...data, depositor: data.depositor ?? depositor.trim() };
    setDone(o);
    onDone(o);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-left" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 text-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[12px] font-bold text-sm-orange">{g3 ? "고3 1학기 로드맵" : "고2 로드맵"}</p>
            <p className="mt-1 text-[19px] font-extrabold text-sm-navy">{main} 쪽 {g3 ? "고3 1학기" : "고2 1년"} 계획 받기</p>
            <p className="mt-1 text-[13px] leading-relaxed text-gray-500">
              <b>{g3 ? "고3 선택과목 · 마무리 탐구 3개와 흔함 지수 · 1학기 계획 · 면접에서 물어볼 활동" : "선택과목 조합 · 탐구 5개와 흔함 지수 · 학기별 계획"}</b>가 열려요. 한 번 결제하면 계속 볼 수 있어요.
            </p>
          </div>
          <button onClick={onClose} className="text-[22px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>

        {err && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

        {done ? (
          <div className="mt-5 rounded-xl bg-orange-50 p-5 text-center">
            <p className="text-[16px] font-extrabold text-orange-800">{done.status === "approved" ? "이미 결제했어요" : "입금 확인 중이에요"}</p>
            {done.status !== "approved" && (
              <>
                <p className="mt-2 text-[13.5px] leading-relaxed text-orange-900">
                  {done.depositor} · {Number(done.amount ?? ROADMAP_PRICE).toLocaleString()}원
                  <br />
                  <b>{eta}</b> 확인하고 열어 드려요.
                </p>
                <p className="mt-2 text-[12px] text-orange-700">밤 12시~아침 6시에 입금하면 오전 8시에 한꺼번에 확인해요.</p>
              </>
            )}
            <button onClick={onClose} className="mt-4 h-11 w-full rounded-lg bg-sm-navy text-[14px] font-bold text-white">확인</button>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {/* ① 상품 */}
            <div>
              <p className="text-[13px] font-extrabold text-sm-navy">① 상품</p>
              <div className="relative mt-2 rounded-xl border-2 border-sm-navy bg-indigo-50 p-3">
                <span className="absolute -top-2 right-2 rounded-full bg-sm-orange px-2 py-0.5 text-[10.5px] font-bold text-white">출시 할인</span>
                <p className="text-[14px] font-extrabold text-sm-navy">{g3 ? "고3 1학기 로드맵" : "고2 로드맵"} · {main}</p>
                <p className="text-[17px] font-black text-sm-navy">
                  <s className="mr-1.5 text-[13px] font-normal text-gray-400">14,900원</s>
                  {ROADMAP_PRICE.toLocaleString()}원
                </p>
                <p className="text-[11.5px] text-gray-500">한 번 결제 · {g3 ? "고3 1학기 계획 + 면접 대비" : "고2 1학기 · 2학기 계획"}</p>
              </div>
            </div>

            {/* ② 입금 */}
            <div>
              <p className="text-[13px] font-extrabold text-sm-navy">② 이 계좌로 입금해 주세요</p>
              <div className="mt-2 space-y-2 rounded-xl bg-gray-50 p-4 text-[13.5px]">
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">은행</span><b className="text-sm-navy">{BANK.name}</b></div>
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">계좌번호</span><span className="flex items-center gap-2"><b className="text-sm-navy">{BANK.number}</b><CopyBtn text={BANK.number.replace(/-/g, "")} /></span></div>
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">예금주</span><b className="text-sm-navy">{BANK.holder}</b></div>
                <div className="flex items-center justify-between gap-2"><span className="text-gray-500">금액</span><b className="text-[16px] text-sm-orange">{ROADMAP_PRICE.toLocaleString()}원</b></div>
              </div>
              <label className="mt-3 block text-[13px] font-bold text-sm-navy">
                입금자명 <span className="font-normal text-sm-orange">꼭 이대로 입금해 주세요</span>
                <div className="mt-1 flex gap-2">
                  <input value={depositor} onChange={(e) => setDepositor(e.target.value)} className="w-full rounded-lg border-2 border-sm-orange px-3 py-2 text-[16px] font-extrabold text-sm-navy outline-none" />
                  <CopyBtn text={depositor} />
                </div>
              </label>
              <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">부모님이 입금해도 괜찮아요. 입금자명만 똑같이 적어 주세요. 이 이름으로 누구의 입금인지 확인해요.</p>
            </div>

            {/* ③ 입금했어요 */}
            <div>
              <p className="text-[13px] font-extrabold text-sm-navy">③ 입금을 마쳤으면 눌러 주세요</p>
              <label className="mt-2 flex items-center gap-2 text-[13.5px] text-gray-700">
                <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-5 w-5" />
                {ROADMAP_PRICE.toLocaleString()}원을 <b>{depositor || "입금자명"}</b>으로 입금했어요
              </label>
              <button onClick={submit} disabled={!paid || busy || depositor.trim().length < 2} className="mt-3 h-[52px] w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-40">
                {busy ? "접수하는 중…" : "입금했어요"}
              </button>
              <p className="mt-2 text-center text-[12px] leading-relaxed text-gray-500">
                입금을 확인하면 열어 드려요 · 지금 누르면 <b>{eta}</b> 확인해요
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* 진단 결과 */
function Result({ r, unsure, next = "고2" }) {
  const strong = r.cells.filter((c) => c.link === "강함").length;
  return (
    <>
      {/* 학과별 연결도 */}
      <section className="mt-5">
        <h2 className="text-[15px] font-bold text-gray-500">{unsure ? "내 활동과 잘 맞는 학과" : "희망 학과별 연결도"}</h2>
        <div className="mt-2 grid gap-2">
          {r.fit.map((f) => (
            <div key={f.department} className={`rounded-2xl bg-white p-4 ${f.department === r.main ? "ring-2 ring-sm-navy" : "ring-1 ring-gray-200"}`}>
              <div className="flex items-center gap-2">
                <b className="text-[16px] text-sm-navy">{f.department}</b>
                {f.department === r.main && <span className="rounded bg-sm-navy px-1.5 py-0.5 text-[10.5px] font-bold text-white">진단 기준</span>}
                <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-bold ${LEVEL_STYLE[f.level]}`}>{f.level}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-sm-navy" style={{ width: `${f.score}%` }} />
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{f.line}</p>
            </div>
          ))}
        </div>
        {r.other && <p className="mt-2 rounded-xl bg-indigo-50 px-3.5 py-3 text-[13px] leading-relaxed text-indigo-900">{r.other}</p>}
      </section>

      {/* 방향 요약 */}
      <section className="mt-6 rounded-2xl bg-sm-navy p-5 text-white">
        <small className="text-[12px] font-bold text-orange-300">{r.main} 기준 · 내 고1 생기부</small>
        <p className="mt-1.5 text-[15.5px] font-bold leading-relaxed">{r.summary}</p>
        {r.cells.length > 0 && (
          <p className="mt-3 text-[13px] text-slate-300">
            {r.cells.length}칸 중 <b className="text-[18px] text-white">{strong}칸</b>이 학과와 강하게 이어져요
          </p>
        )}
      </section>

      {/* 칸마다 */}
      {r.cells.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[16px] font-bold text-sm-navy">칸마다 {r.main} 기준으로 보면</h2>
          <div className="mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {r.cells.map((c, i) => (
              <div key={i} className={`flex gap-3 px-4 py-3 ${i ? "border-t border-gray-100" : ""}`}>
                <span className="w-5 shrink-0 text-center text-[15px]" aria-label={c.link}>{LINK_ICON[c.link]}</span>
                <span className="w-[72px] shrink-0 text-[13.5px] font-bold text-gray-800">{c.label}</span>
                <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-gray-600">{c.why}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-gray-400">✅ 강하게 이어짐 · ➖ 약하게 이어짐 · ⚪ 아직 연결 없음</p>
        </section>
      )}

      {/* 역량 */}
      {r.competencies.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[16px] font-bold text-sm-navy">{r.main}가 보는 역량 · 나는?</h2>
          <div className="mt-2 grid gap-2">
            {r.competencies.map((c, i) => (
              <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <b className="text-[15px] text-gray-900">{c.name}</b>
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-bold ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </div>
                {c.evidence && <p className="mt-1.5 text-[13px] text-gray-600">근거 · {c.evidence}</p>}
                {c.status !== "충분" &&
                  (c.tip ? (
                    <p className="mt-1.5 rounded-lg bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">→ {c.tip}</p>
                  ) : (
                    <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-500">🔒 채우는 방법은 {next} 로드맵에서 알려 드려요</p>
                  ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 고2 */}
      {(r.subjects.length > 0 || r.inquiries.length > 0) && (
        <section className="mt-6">
          <h2 className="text-[16px] font-bold text-sm-navy">{r.next ?? "고2"}에 {r.main} 쪽으로 채울 것</h2>
          {r.subjects.length > 0 && (
            <>
              <p className="mt-3 text-[13px] font-bold text-gray-500">고르면 좋은 선택과목</p>
              <div className="mt-1.5 grid gap-1.5">
                {r.subjects.map((s) => (
                  <div key={s.name} className="rounded-xl bg-white px-4 py-3 ring-1 ring-gray-200">
                    <b className="text-[14.5px] text-sm-navy">{s.name}</b>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">{s.why}</p>
                  </div>
                ))}
                <Locked n={r.locked?.subjects} what="과목" next={next} />
              </div>
            </>
          )}
          {r.inquiries.length > 0 && (
            <>
              <p className="mt-4 text-[13px] font-bold text-gray-500">이어가면 좋은 탐구</p>
              <div className="mt-1.5 grid gap-1.5">
                {r.inquiries.map((q, i) => (
                  <div key={i} className="rounded-xl bg-white px-4 py-3 ring-1 ring-gray-200">
                    <span className="text-[11.5px] font-bold text-indigo-700">{q.subject}</span>
                    <b className="mt-0.5 block text-[14.5px] leading-snug text-gray-900">{q.title}</b>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">{q.why}</p>
                  </div>
                ))}
                <Locked n={r.locked?.inquiries} what="탐구" next={next} />
              </div>
            </>
          )}
        </section>
      )}

      <Roadmap main={r.main} next={next} />

      <p className="mt-6 text-center text-[11.5px] leading-relaxed text-gray-400">
        {r.ref_count > 0 ? `생수면 탐구주제 데이터의 같은 학과 사례를 기준으로 봤어요. ` : ""}
        진단은 내가 노트에 적은 활동만 보고 판단한 참고 자료예요.
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
  const [next, setNext] = useState("고2"); // 로드맵 학년 — 고2 칸도 10칸 이상이면 고3

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
      setNext(nextGrade(notes.data));
      if (prog.done < prog.need) {
        setLock(prog);
        return setState("locked");
      }
      if (d.data?.result) {
        setData(d.data);
        setInitDept(d.data.departments ?? []);
        setState("result");
      } else {
        setInitDept(my.data?.department ? [my.data.department] : []);
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
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="text-[15px] text-gray-600">로그인하면 진단을 볼 수 있어요.</p>
        <button onClick={() => nav("/login")} className="mt-4 rounded-[10px] bg-sm-navy px-6 py-3 text-[14.5px] font-bold text-white">로그인</button>
      </div>
    );

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
        <Link to="/my/note" className="text-[13px] font-semibold text-gray-500">← 내 생기부 노트</Link>
        <h1 className="mt-2 text-[24px] font-bold tracking-tight text-sm-navy">AI 입시 방향 진단</h1>
        {data?.created_at && state === "result" && (
          <p className="mt-1 text-[12.5px] text-gray-500">
            {new Date(data.created_at).toLocaleDateString("ko-KR")} 진단 · {data.unsure ? "학과 추천" : (data.departments ?? []).join(" · ")}
          </p>
        )}
        {err && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-[13.5px] font-semibold text-red-600">{err}</p>}

        {state === "load" && <p className="py-20 text-center text-[14px] text-gray-500">불러오는 중…</p>}
        {state === "form" && <DeptForm init={initDept} onRun={run} />}
        {state === "run" && <Loading />}

        {state === "locked" && lock && (
          <div className="mt-6 rounded-2xl bg-white p-6 text-center">
            <p className="text-[17px] font-bold text-sm-navy">고1 {lock.need ?? 10}칸을 채우면 진단이 열려요</p>
            <p className="mt-2 text-[14px] text-gray-600">
              지금 {lock.done}칸
              {(lock.need ?? 10) > lock.done ? ` · ${(lock.need ?? 10) - lock.done}칸 남았어요` : " · 잠시 후 다시 시도해 주세요"}
            </p>
            <Link to="/my/note" className="mt-4 inline-block rounded-[10px] bg-sm-navy px-6 py-3 text-[14.5px] font-bold text-white">노트 채우러 가기</Link>
          </div>
        )}

        {state === "result" && data?.result && (
          <>
            <Result r={data.result} unsure={data.unsure} next={next} />
          </>
        )}
      </div>
    </div>
  );
}