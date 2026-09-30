import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import StepBar from "./StepBar";
import Paywall from "./Paywall";
import { trialUsedElsewhere } from "./freeInquiry";
import { useStay } from "./useStay";
import InquirySwitcher from "./InquirySwitcher";

/*
 * 탐구 준비 — 상위 1% 주제로 탐구 방법 추천 + 탐구팩
 * /inquiry/new  (결과 화면에서 { topic, focus }를 들고 옴) → 새로 만들고 /inquiry/:id 로 바뀜
 * /inquiry/:id  (저장된 탐구 다시 열기)
 * 노트북·태블릿 화면 기준. 휴대폰에서는 안내를 띄우고 한 줄로 보여준다.
 */

const METHODS = [
  { k: "lit", label: "문헌 탐구", desc: "논문·기사·도서·공식자료를 찾아 비교해요" },
  { k: "case", label: "사례 탐구", desc: "여러 사례를 같은 기준으로 비교해요" },
  { k: "data", label: "데이터 탐구", desc: "공공데이터·통계로 수치와 관계를 봐요" },
  { k: "survey", label: "설문조사 탐구", desc: "문항을 받아 친구들에게 직접 조사해요" },
  { k: "exp", label: "실험 탐구", desc: "변인·순서·기록표를 받아 직접 측정해요" },
  { k: "obs", label: "관찰 탐구", desc: "기준표를 받아 일정 기간 기록해요" },
];
const METHOD_NAME = Object.fromEntries(METHODS.map((m) => [m.k, m.label]));

/* 위쪽 단계 표시 */

/* 칸 제목 — 누르면 그 칸을 접었다 펼쳤다 */
function FoldTitle({ title, open, onToggle, extra }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left">
      <h3 className="text-[15px] font-extrabold text-sm-navy">{title}</h3>
      {extra}
      <span className="ml-auto rounded-md border border-gray-200 px-2 py-0.5 text-[12px] font-bold text-gray-500">
        {open ? "접기 ▲" : "펼치기 ▼"}
      </span>
    </button>
  );
}

/* 글 목록 한 칸 — 처음엔 접힌 채로, 제목을 누르면 펼친다 */
function List({ title, items }) {
  const [open, setOpen] = useState(false); // 처음엔 접어 두고, 제목을 눌러 펼친다
  if (!items?.length) return null;
  return (
    <section className="space-y-2">
      <FoldTitle title={title} open={open} onToggle={() => setOpen((v) => !v)} extra={!open && <span className="text-[12px] text-gray-400">{items.length}개</span>} />
      {open && <ul className="space-y-1.5 text-[14px] leading-relaxed text-gray-700">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-sm-orange">·</span>
            <span>{typeof x === "string" ? x : JSON.stringify(x)}</span>
          </li>
        ))}
      </ul>}
    </section>
  );
}

/* 빈 기록표 — 실험·관찰 · 처음엔 접힌 채로, 제목을 누르면 펼친다 */
function RecordTable({ table }) {
  const [open, setOpen] = useState(false); // 처음엔 접어 두고, 제목을 눌러 펼친다
  if (!table?.rows?.length || !table?.cols?.length) return null;
  return (
    <section className="space-y-2">
      <FoldTitle
        title="기록표"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        extra={table.unit ? <span className="text-[12.5px] font-bold text-gray-400">단위 {table.unit}</span> : null}
      />
      {open && <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-3 py-2 text-left text-gray-500"> </th>
              {table.cols.map((c) => (
                <th key={c} className="border border-gray-200 px-3 py-2 text-gray-500">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r}>
                <td className="border border-gray-200 px-3 py-2.5 font-bold text-sm-navy">{r}</td>
                {table.cols.map((c) => (
                  <td key={c} className="border border-gray-200 px-3 py-2.5" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-gray-400">인쇄해서 채우거나, 다음 단계(결과 분석)에서 바로 입력하면 돼요.</p>
      </>}
    </section>
  );
}

/*
 * 기다리는 화면 — 탐구팩 만들기(20~40초) · AI 자료 찾기(1분~1분 30초)
 * 멈춘 건지 도는 건지 헷갈리지 않게: 진행 막대·지금 하는 일·몇 초째인지·보고서 팁을 보여준다
 * 진행 막대는 예상 시간 기준으로 천천히 오르다 95%에서 멈추고, 끝나면 화면이 바뀐다
 */
const WAIT_STEPS = {
  pack: ["주제 읽기", "알맞은 탐구 방법 고르기", "탐구팩(순서·기준·기록표) 만들기"],
  research: ["주제를 쪼개 검색어 만들기", "여러 번 나눠 검색하기", "찾은 자료 본문 읽기", "비슷한 정도를 따져 좋은 것만 고르기"],
};
const WAIT_TIPS = [
  "선생님이 기억하는 보고서에는 '예상과 달랐던 점'이 꼭 있어요.",
  "좋은 세특은 결과보다 '왜 그렇다고 생각했는지'를 적어요.",
  "자료는 3~5개면 충분해요. 많이보다 같은 기준으로 비교하는 게 중요해요.",
  "보고서 가운데 가장 크게 들어갈 한 문장을 3단계에서 AI와 함께 찾아요.",
  "AI가 찾은 자료는 꼭 직접 열어서 확인해요. 면접에서 물어볼 수 있어요.",
  "30가지 디자인 중에서 내 탐구에 맞는 걸 4단계에서 골라요.",
];
function Waiting({ phase, similar }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    setSec(0);
    const t = setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  const expect = phase === "pack" ? 35 : 90; // 보통 걸리는 시간(초)
  const pct = Math.min(95, Math.round(100 * (1 - Math.exp(-sec / (expect / 2.2)))));
  const steps = WAIT_STEPS[phase];
  const at = Math.min(steps.length - 1, Math.floor((pct / 96) * steps.length)); // 지금 하는 단계
  const tip = WAIT_TIPS[Math.floor(sec / 6) % WAIT_TIPS.length];
  const title =
    phase === "pack"
      ? "이 주제에 맞는 탐구팩을 만들고 있어요"
      : similar
      ? `AI가 비슷한 ${similar} 사례를 찾아 읽고 있어요`
      : "AI가 자료를 찾아 읽고 좋은 것만 고르고 있어요";

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 text-left" role="status" aria-live="polite">
      <p className="text-[16px] font-extrabold text-sm-navy">{title}</p>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-sm-navy transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-[13px] font-extrabold text-sm-navy">{pct}%</span>
      </div>

      <ul className="mt-4 space-y-1.5">
        {steps.map((st, i) => (
          <li key={st} className="flex items-center gap-2 text-[13px]">
            {i < at ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[11px] font-bold text-white">✓</span>
            ) : i === at ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-sm-navy border-t-transparent" />
            ) : (
              <span className="h-5 w-5 rounded-full border-2 border-gray-200" />
            )}
            <span className={i < at ? "text-gray-400 line-through" : i === at ? "font-bold text-sm-navy" : "text-gray-400"}>{st}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[12px] text-gray-500">
        {sec}초째 · 보통 {phase === "pack" ? "20~40초" : "1분~1분 30초"} 걸려요
        {sec > expect * 1.6 && <b className="ml-1 text-sm-orange">· 조금 오래 걸리고 있어요. 창을 닫지 말고 기다려 주세요</b>}
      </p>
      <p className="mt-3 rounded-lg bg-orange-50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-orange-900">
        <b>알고 있나요?</b> {tip}
      </p>
      {phase === "pack" && <p className="mt-2 text-[11.5px] text-gray-400">다 되면 AI가 이어서 자료를 찾아요.</p>}
    </div>
  );
}

/* 문헌·사례·데이터 — 자료 조사를 직접 할지, AI가 찾아줄지 */
const RESEARCH = ["lit", "case", "data"];
// 실험·설문·관찰 — 결과는 직접 모으고, AI는 '비슷하게 해 본 사례'(보고서·블로그 글 등)만 찾아준다
const SIMILAR = { exp: "실험", survey: "설문조사", obs: "관찰" };

/*
 * 처음 쓰는 학생용 튜토리얼 — 자료 카드가 처음 나왔을 때 한 번만
 * 화면을 어둡게 하고 누를 곳만 밝게 비춘 뒤 말풍선으로 설명한다 (data-tour 붙은 곳)
 * 다 보거나 건너뛰면 이 브라우저에서는 다시 안 뜬다
 */
const TOUR_KEY = "sm_tour_sources_v1";
const TOUR_STEPS = [
  { sel: '[data-tour="open"]', title: "① 자료를 열어서 확인해요", body: "AI가 찾은 자료가 실제로 있는지, 내 주제와 맞는지 직접 열어 봐요. 면접에서 물어볼 수 있어요." },
  { sel: '[data-tour="pick"]', title: "② 쓸 자료는 ‘보고서에 쓰기’를 눌러요", body: "2~4개면 충분해요. 고른 자료만 3단계에서 AI가 읽고 비교표를 채워요." },
  { sel: '[data-tour="next"]', title: "③ 다 골랐으면 ‘다음 단계’를 눌러요", body: "3단계에서 AI가 고른 자료로 결과를 정리해 줘요." },
];
function SourceTour({ onDone }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const step = TOUR_STEPS[idx];

  useEffect(() => {
    let alive = true;
    let el = null;
    let tries = 0;
    let raf = 0;
    setRect(null);
    const measure = () => el && alive && setRect(el.getBoundingClientRect());
    // 스크롤이 끝날 때까지 약 1초 동안 매 프레임 자리를 다시 잰다 (휴대폰은 스크롤이 길다)
    const follow = (until) => {
      measure();
      if (Date.now() < until) raf = requestAnimationFrame(() => follow(until));
    };
    // 누를 곳이 화면에 나타날 때까지 잠깐 기다렸다가 찾는다 (최대 약 3초)
    const find = () => {
      if (!alive) return;
      el = document.querySelector(step.sel);
      if (!el) {
        if (tries++ < 20) return setTimeout(find, 150);
        return; // 끝내 못 찾으면 어둡게만 두고 말풍선으로 안내
      }
      // 누를 곳으로 즉시 이동 — 부드러운 스크롤은 휴대폰에서 중간에 끊길 때가 있어서 쓰지 않는다
      // 휴대폰은 아래에 말풍선이 있으니 누를 곳을 화면 위쪽 1/3쯤에 둔다
      const goTo = () => {
        el.scrollIntoView({ block: "center" });
        if (window.innerWidth < 768) {
          const r = el.getBoundingClientRect();
          window.scrollBy(0, r.top - window.innerHeight * 0.22);
        }
      };
      goTo();
      // 화면이 늦게 그려져 자리가 밀렸으면 한 번 더
      setTimeout(() => {
        if (!alive || !el) return;
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight - (window.innerWidth < 768 ? 220 : 0)) goTo();
        follow(Date.now() + 600);
      }, 400);
      follow(Date.now() + 1000);
    };
    find();
    const onResize = () => {
      setMobile(window.innerWidth < 768);
      measure();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", measure, true);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", measure, true);
    };
  }, [idx, step.sel]);

  const last = idx === TOUR_STEPS.length - 1;
  const pad = 6;
  // PC: 말풍선을 밝힌 곳 아래(모자라면 위)에 / 휴대폰: 화면 아래에 고정
  const below = rect ? rect.bottom + 180 < window.innerHeight : true;
  // 휴대폰: 화면 폭에 맞춰 누를 곳 바로 아래(자리가 없으면 위)에 붙인다
  const TIP_H = 175; // 말풍선 대략 높이
  const tipStyle = mobile
    ? {
        left: 12,
        right: 12,
        top: rect
          ? rect.bottom + pad + 12 + TIP_H < window.innerHeight
            ? rect.bottom + pad + 12
            : Math.max(12, rect.top - pad - 12 - TIP_H)
          : window.innerHeight * 0.4,
      }
    : {
        width: 320,
        top: rect ? (below ? rect.bottom + pad + 10 : Math.max(12, rect.top - pad - 10 - 150)) : window.innerHeight / 2 - 80,
        left: rect ? Math.min(Math.max(12, rect.left), window.innerWidth - 332) : window.innerWidth / 2 - 160,
      };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      {/* 누를 곳만 밝게 — 바깥은 큰 그림자로 어둡게 */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl ring-4 ring-sm-orange"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(15,23,42,.55)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-900/55" />
      )}
      <div className="fixed rounded-2xl bg-white p-4 shadow-2xl" style={tipStyle}>
        <p className="text-[11.5px] font-bold text-sm-orange">처음이라면 이렇게 해요 · {idx + 1}/{TOUR_STEPS.length}</p>
        <p className="mt-1 text-[15px] font-extrabold text-sm-navy">{step.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{step.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={onDone} className="text-[12.5px] font-bold text-gray-400">건너뛰기</button>
          <button
            onClick={() => (last ? onDone() : setIdx(idx + 1))}
            className="ml-auto rounded-lg bg-sm-navy px-4 py-2 text-[13px] font-bold text-white"
          >
            {last ? "알겠어요" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}

/*
 * 자료 목록 — AI가 찾은 자료 + 내가 찾아 추가한 자료
 * '보고서에 쓰기'로 고른 자료만 3단계에서 AI가 읽고 요약한다
 */
function SourceList({ list, onOpen, onToggle, onAdd, onRemove, showAi, similar }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const shown = list.map((x, i) => ({ ...x, i })).filter((x) => showAi || x.added_by === "me");
  const picked = list.filter((x) => x.selected).length;
  const okUrl = /^https?:\/\/\S+\.\S+/.test(url.trim());

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-extrabold text-sm-navy">{showAi ? "자료 고르기" : "내가 찾은 자료"}</h3>
        <span className="rounded-full bg-sm-navy px-2.5 py-0.5 text-[12px] font-bold text-white">보고서에 쓸 자료 {picked}개</span>
      </div>
      {/* 지금 할 일 — 자료가 나오면 항상 보인다 (한 일은 체크) */}
      {showAi && list.some((x) => x.added_by !== "me") && (
        <div className="rounded-xl border-2 border-sm-navy/15 bg-indigo-50/50 px-4 py-3">
          <p className="text-[12.5px] font-extrabold text-sm-navy">지금 할 일</p>
          <ol className="mt-1.5 grid gap-1.5 text-[13px] sm:grid-cols-3">
            {[
              [list.some((x) => x.opened), "자료를 열어서 확인하기"],
              [picked > 0, `쓸 자료에 ‘보고서에 쓰기’ 누르기 (${picked}개)`],
              [false, "오른쪽 아래 ‘다음 단계 →’ 누르기"],
            ].map(([done, t], i) => (
              <li key={t} className={`flex items-center gap-2 ${done ? "text-gray-400" : "font-bold text-sm-navy"}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-green-500 text-white" : "bg-sm-navy text-white"}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={done ? "line-through" : ""}>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="rounded-lg bg-orange-50 px-4 py-2.5 text-[12.5px] leading-relaxed text-orange-900">
        {similar ? (
          <>
            {showAi ? `AI가 찾은 비슷한 ${similar} 사례예요. ` : ""}
            <b>직접 열어서 확인하고, 참고할 자료만 골라요.</b> 고른 자료는 보고서의 참고 자료에 들어가요.
          </>
        ) : (
          <>
            {showAi ? "AI가 인터넷에서 찾은 자료예요. " : ""}
            <b>직접 열어서 확인하고, 보고서에 쓸 자료만 골라요.</b> 고른 자료만 3단계에서 AI가 읽고 요약해요.
          </>
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((x, n) => (
          <div key={x.i} className={`rounded-xl border-2 p-4 ${x.selected ? "border-sm-navy bg-indigo-50/40" : "border-gray-200"}`}>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[12px] font-bold text-sm-orange">
                {x.added_by === "me" ? "내가 찾은 자료" : `${x.kind ?? ""}${x.publisher ? ` · ${x.publisher}` : ""}`}
              </p>
              {/* 서버가 본문을 읽고 요약을 맞췄는지 */}
              {x.added_by !== "me" && x.checked === "body" && (
                <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700">본문 확인됨</span>
              )}
              {x.added_by !== "me" && x.checked === "link" && (
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">직접 확인 필요</span>
              )}
            </div>
            <p className="mt-1 text-[14px] font-bold leading-snug text-sm-navy">{x.title}</p>
            {x.match && (
              <p className="mt-2 rounded-md bg-indigo-50 px-2.5 py-1.5 text-[12px] font-bold leading-snug text-sm-navy">
                {similar ? "비슷한 점" : "고른 이유"} · {x.match}
              </p>
            )}
            {x.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600">{x.summary}</p>}
            {x.use && <p className="mt-1.5 text-[12.5px] leading-relaxed text-sm-navy"><b>{similar ? "참고할 점" : "이렇게 써요"}</b> · {x.use}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={x.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => onOpen(x.i)}
                data-tour={n === 0 ? "open" : undefined}
                className={`flex h-10 items-center justify-center rounded-lg border text-[13px] font-bold ${x.opened ? "border-green-400 text-green-700" : "border-sm-navy text-sm-navy"}`}
              >
                {x.opened ? "확인했어요 ✓" : "열어서 확인 ↗"}
              </a>
              <button
                onClick={() => onToggle(x.i)}
                data-tour={n === 0 ? "pick" : undefined}
                className={`h-10 rounded-lg text-[13px] font-bold ${x.selected ? "bg-sm-navy text-white" : "border border-gray-300 text-gray-600"}`}
              >
                {x.selected ? "보고서에 쓰기 ✓" : "보고서에 쓰기"}
              </button>
            </div>
            {x.added_by === "me" && (
              <button onClick={() => onRemove(x.i)} className="mt-2 text-[12px] font-bold text-gray-400 underline">지우기</button>
            )}
          </div>
        ))}
      </div>

      {/* 내가 찾은 자료 추가 */}
      <div className="rounded-xl border border-dashed border-gray-300 p-4">
        <p className="text-[13.5px] font-bold text-sm-navy">내가 찾은 자료 추가</p>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="자료 제목" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-sm-navy" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="링크 (https://…)" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-sm-navy" />
          <button
            disabled={!title.trim() || !okUrl}
            onClick={() => {
              onAdd({ title: title.trim(), url: url.trim() });
              setTitle("");
              setUrl("");
            }}
            className="rounded-lg bg-sm-navy px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            추가
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] text-gray-400">링크가 없는 책은 제목만 적고 3단계에서 내용을 직접 적어요.</p>
      </div>
    </section>
  );
}

/* 방법별 탐구팩 본문 */
function PackBody({ method, pack, topic }) {
  const p = pack?.pack ?? {};
  const [copied, setCopied] = useState(false);

  // 친구들에게 나눠 줄 종이 설문지 — 새 창에 A4로 그려서 바로 인쇄 (이름·학교 같은 개인정보 칸은 넣지 않는다)
  function printSurvey() {
    const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const qs = (p.questions ?? [])
      .map((q, i) => {
        const body = q.options?.length
          ? `<div class="opts">${q.options.map((o) => `<span class="opt"><span class="box"></span>${esc(o)}</span>`).join("")}</div>`
          : `<div class="line"></div><div class="line"></div><div class="line"></div>`;
        return `<li><p class="q">${i + 1}. ${esc(q.text)}</p>${body}</li>`;
      })
      .join("");
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>설문지</title>
<style>
@page { size: A4; margin: 16mm; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; color: #111; font-size: 13.5px; line-height: 1.55; margin: 0; }
h1 { font-size: 20px; margin: 0 0 4px; }
.topic { margin: 0; color: #444; font-size: 13px; }
.intro { border: 1px solid #bbb; border-radius: 6px; padding: 10px 12px; margin: 12px 0 18px; font-size: 12.5px; background: #fafafa; }
ol { list-style: none; padding: 0; margin: 0; }
li { margin: 0 0 16px; page-break-inside: avoid; }
.q { font-weight: 700; margin: 0 0 7px; }
.opts { display: flex; flex-wrap: wrap; gap: 7px 20px; padding-left: 16px; }
.opt { display: inline-flex; align-items: center; gap: 6px; }
.box { width: 13px; height: 13px; border: 1.5px solid #333; border-radius: 2px; display: inline-block; }
.line { border-bottom: 1px solid #999; height: 26px; margin-left: 16px; }
.foot { margin-top: 22px; text-align: center; font-size: 12px; color: #555; }
</style></head><body>
<h1>설문지</h1>
<p class="topic">${esc(topic)}</p>
${p.intro ? `<div class="intro">${esc(p.intro)}</div>` : ""}
<ol>${qs}</ol>
<p class="foot">응답해 주셔서 고맙습니다.</p>
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) return window.alert("팝업이 막혔어요. 브라우저 주소창 오른쪽에서 팝업을 허용해 주세요.");
    w.document.open();
    w.document.write(html);
    w.document.close();
    // 글꼴이 그려진 뒤 인쇄 창을 한 번만 띄운다
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      w.focus();
      w.print();
    };
    w.onload = go;
    setTimeout(go, 700); // onload가 안 오는 브라우저 대비
  }

  // 설문 문항을 구글 폼에 붙여넣기 좋게
  function copySurvey() {
    const text = [
      p.intro,
      "",
      ...(p.questions ?? []).map(
        (q, i) => `${i + 1}. ${q.text}${q.options?.length ? "\n" + q.options.map((o) => `  - ${o}`).join("\n") : ""}`
      ),
    ].join("\n");
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => window.prompt("복사해 주세요", text));
  }

  if (method === "survey")
    return (
      <div className="space-y-6">
        {p.target && <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>조사 대상</b> · {p.target} {p.sample ? `(권장 ${p.sample})` : ""}</p>}
        {p.intro && <p className="rounded-lg bg-orange-50 px-4 py-3 text-[13px] leading-relaxed text-orange-900"><b>설문 첫머리 안내</b> · {p.intro}</p>}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-extrabold text-sm-navy">설문 문항 · {p.questions?.length ?? 0}개</h3>
            <button onClick={printSurvey} className="ml-auto rounded-lg bg-sm-navy px-3 py-1.5 text-[13px] font-bold text-white">
              인쇄용 설문지
            </button>
            <button onClick={copySurvey} className="rounded-lg border border-sm-navy px-3 py-1.5 text-[13px] font-bold text-sm-navy">
              {copied ? "복사했어요 · 구글 폼에 붙여넣기" : "구글 폼용으로 복사"}
            </button>
          </div>
          <ol className="divide-y divide-gray-100">
            {(p.questions ?? []).map((q, i) => (
              <li key={i} className="flex gap-3 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sm-navy text-[12px] font-extrabold text-white">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-[14px] font-bold text-sm-navy">{q.text}</p>
                  {q.options?.length > 0 && <p className="mt-1 text-[12.5px] text-gray-500">{q.options.map((o, j) => `${j + 1} ${o}`).join("  ·  ")}</p>}
                </div>
                <span className="h-fit rounded bg-indigo-50 px-2 py-0.5 text-[11.5px] font-bold text-gray-500">{q.type}</span>
              </li>
            ))}
          </ol>
        </section>
        <List title="배포 방법" items={p.distribute} />
      </div>
    );

  if (method === "exp")
    return (
      <div className="space-y-6">
        {p.hypothesis && <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>가설</b> · {p.hypothesis}</p>}
        {p.variables && (
          <section className="grid grid-cols-3 gap-3 text-[13.5px]">
            <div className="rounded-lg bg-indigo-50 p-3"><p className="text-[12px] font-bold text-gray-500">바꾸는 것</p><p className="mt-1 font-bold text-sm-navy">{p.variables.change}</p></div>
            <div className="rounded-lg bg-orange-50 p-3"><p className="text-[12px] font-bold text-gray-500">재는 것</p><p className="mt-1 font-bold text-sm-navy">{p.variables.measure}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-[12px] font-bold text-gray-500">같게 둘 것</p><p className="mt-1 font-bold text-sm-navy">{(p.variables.control ?? []).join(", ")}</p></div>
          </section>
        )}
        <List title="준비물" items={p.materials} />
        <List title={`실험 순서${p.repeats ? ` · ${p.repeats}` : ""}`} items={p.procedure} />
        <RecordTable table={p.record_table} />
        {p.safety?.length > 0 && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="text-[14px] font-extrabold text-red-700">안전 주의</h3>
            <ul className="mt-1 space-y-1 text-[13px] text-red-800">{p.safety.map((s, i) => <li key={i}>· {s}</li>)}</ul>
          </section>
        )}
      </div>
    );

  if (method === "obs")
    return (
      <div className="space-y-6">
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>관찰 대상</b> · {p.target} &nbsp; <b>기간</b> · {p.period}</p>
        {p.criteria?.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[15px] font-extrabold text-sm-navy">판단 기준</h3>
            <div className="grid grid-cols-2 gap-2">
              {p.criteria.map((c, i) => (
                <div key={i} className="rounded-lg bg-gray-50 p-3 text-[13px]"><b className="text-sm-navy">{c.level}</b> · {c.desc}</div>
              ))}
            </div>
          </section>
        )}
        <RecordTable table={p.record_table} />
        <List title="매번 확인할 것" items={p.checklist} />
      </div>
    );

  if (method === "lit")
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-[15px] font-extrabold text-sm-navy">찾을 자료</h3>
          <div className="grid grid-cols-2 gap-3">
            {(p.sources ?? []).map((s, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-4">
                <p className="text-[12px] font-bold text-sm-orange">{s.kind}</p>
                <p className="mt-1 text-[14px] font-bold text-sm-navy">{s.what}</p>
                <p className="mt-2 text-[12.5px] text-gray-500">검색어 · {(s.keywords ?? []).join(", ")}</p>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-gray-400">자료 제목은 직접 찾은 것만 적어요. AI는 없는 자료를 만들지 않아요.</p>
        </section>
        <List title="찾아볼 곳" items={p.where} />
        <List title="자료를 비교할 기준" items={p.criteria} />
        <List title="자료마다 적어둘 것" items={p.record} />
      </div>
    );

  if (method === "case")
    return (
      <div className="space-y-6">
        <section className="grid grid-cols-3 gap-3">
          {(p.cases ?? []).map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4">
              <p className="text-[16px] font-extrabold text-sm-navy">{c.name}</p>
              <p className="mt-1 text-[13px] text-gray-600">{c.why}</p>
            </div>
          ))}
        </section>
        <List title="비교 기준" items={p.criteria} />
        <List title="사례마다 기록할 것" items={p.record} />
        <List title="찍어두면 좋은 장면" items={p.photo} />
      </div>
    );

  // data
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-[15px] font-extrabold text-sm-navy">필요한 데이터</h3>
        {(p.datasets ?? []).map((d, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-4">
            <p className="text-[14px] font-bold text-sm-navy">{d.what}</p>
            <p className="mt-1 text-[12.5px] text-gray-500">찾을 곳 · {d.where} &nbsp; 검색어 · {(d.keywords ?? []).join(", ")}</p>
          </div>
        ))}
      </section>
      {p.variables && (
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>비교 기준</b> · {p.variables.x} &nbsp; <b>확인할 값</b> · {p.variables.y}</p>
      )}
      <List title="분석 순서" items={p.analysis} />
    </div>
  );
}

/*
 * AI 함수 호출 — 서버가 오류 코드(403·404·429·502)와 함께 보낸 이유를 꺼내서 돌려준다
 * (supabase.functions.invoke는 오류 코드면 data를 비우고 이유를 error.context 안에 넣는다)
 */
async function callInquiry(body) {
  const { data, error } = await supabase.functions.invoke("inquiry", { body });
  if (!error) return data?.error ? { message: data.error, paywall: data.paywall, inquiry: data.inquiry } : { data };

  let message = "탐구팩을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
  try {
    const res = error.context;
    const status = res?.status;
    const payload = await res?.json?.();
    if (payload?.error) message = payload.error;
    if (payload?.paywall) return { message, paywall: true, inquiry: payload.inquiry ?? null }; // 결제 대기로 저장된 탐구
    else if (status === 404) message = "탐구 준비 기능이 아직 서버에 올라가지 않았어요. (inquiry 함수 배포 확인)";
    console.error("inquiry failed", status, payload ?? error);
  } catch (e) {
    console.error("inquiry failed", error);
  }
  return { message };
}

export default function InquiryPrepare() {
  const { id } = useParams();
  const { state } = useLocation();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [inq, setInq] = useState(null);
  useStay("prepare", inq?.pack ? inq.id : null); // 체류 시간 (탐구팩이 있는 탐구만)
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false); // 탐구팩 만드는 중
  const [searching, setSearching] = useState(false); // AI가 자료 찾는 중
  const [wall, setWall] = useState(null); // 결제 팝업 { reason }
  const [building, setBuilding] = useState(false); // 결제 대기 탐구 → 탐구팩 만드는 중
  const buildingRef = useRef(false);
  const [needPick, setNeedPick] = useState(false); // '보고서에 쓰기' 자료를 안 골랐을 때 팝업
  const sourceArea = useRef(null); // 팝업에서 '자료 고르러 가기' 누르면 여기로 내려간다
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (user) supabase.rpc("is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, [user]);
  // 무료 체험 — 2단계에서 "무료 체험 1건을 사용할게요"를 누른 탐구가 무료 체험 탐구가 된다
  const free = Boolean(inq?.free_trial);
  const [trialTaken, setTrialTaken] = useState(null); // 다른 탐구에 이미 무료 체험을 썼는지 (null = 확인 중)
  useEffect(() => {
    if (!user || !inq?.id) return;
    trialUsedElsewhere(user.id, inq.id).then(setTrialTaken);
  }, [user, inq?.id]);
  const opened = Boolean(inq?.paid || isAdmin || free); // AI 자료 찾기·다음 단계를 바로 쓸 수 있는 탐구
  const locked = inq && !opened && trialTaken === true; // 무료 체험도 다 써서 이용권이 필요한 탐구
  const [askTrial, setAskTrial] = useState(null); // 무료 체험 쓸지 묻는 창 — 누르고 나서 할 일: "research" | "result"
  const [usingTrial, setUsingTrial] = useState(false);

  // 이 탐구를 쓸 수 있게 하고 다음 일을 한다 — 열린 탐구면 바로, 무료 체험이 남았으면 물어보고, 없으면 결제 창
  function needOpen(next) {
    if (opened) return true;
    if (trialTaken === false) setAskTrial(next);
    else setWall({ reason: next === "research" ? "research" : "result" });
    return false;
  }
  async function useTrial() {
    const next = askTrial;
    setUsingTrial(true);
    const { data, message, paywall } = await callInquiry({ action: "use_free", inquiry_id: inq.id });
    setUsingTrial(false);
    setAskTrial(null);
    if (paywall) return setWall({ reason: next === "research" ? "research" : "result" });
    if (message) return setErr(message);
    setInq((x) => ({ ...data.inquiry, research_view: x?.research_view }));
    if (next === "research") findSources(data.inquiry);
    else nav(`/inquiry/${inq.id}/result`);
  }

  // 잠겨 있는 동안 — 관리자가 승인하는 순간 실시간으로 받아서 연다 (예비로 30초마다, 화면으로 돌아올 때도)
  const [justOpened, setJustOpened] = useState(false);
  useEffect(() => {
    if (!inq?.id || inq.paid || isAdmin || !user) return;
    const check = () =>
      supabase.from("inquiries").select("paid").eq("id", inq.id).maybeSingle().then(({ data }) => {
        if (!data?.paid) return;
        setInq((x) => ({ ...x, paid: true }));
        setWall(null);
        setJustOpened(true);
      });
    const ch = supabase
      .channel(`prepare-order-${inq.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pay_orders", filter: `user_id=eq.${user.id}` }, (e) => {
        if (e.new?.status === "approved") check();
      })
      .subscribe();
    const t = setInterval(() => document.visibilityState === "visible" && check(), 30000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [inq?.id, inq?.paid, isAdmin, user]);

  // 팝업은 Esc로도 닫기
  useEffect(() => {
    if (!needPick) return;
    const onKey = (e) => e.key === "Escape" && setNeedPick(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [needPick]);

  // 결제 후(이용권으로 열림) 다시 불러오기
  async function reload() {
    const { data } = await supabase.from("inquiries").select("*").eq("id", inq.id).maybeSingle();
    if (data) setInq((x) => ({ ...data, research_view: x?.research_view }));
    setWall(null);
    if (data?.paid) setJustOpened(true);
    if (data && !data.pack) buildPack(data); // 결제 대기였던 탐구 → 이제 탐구팩 만들기
  }

  // 결제 대기 탐구의 탐구팩 만들기 — 같은 진단으로 start를 다시 부르면 서버가 저장된 줄을 채운다
  async function buildPack(row = inq) {
    if (buildingRef.current || !row?.query_id) return;
    buildingRef.current = true;
    setBuilding(true);
    setErr("");
    const { data, message, paywall } = await callInquiry({ action: "start", query_id: row.query_id });
    buildingRef.current = false;
    setBuilding(false);
    if (paywall) return setWall({ reason: "start" });
    if (message) return setErr(message);
    setInq(data.inquiry);
  }

  // 결제 대기 탐구가 입금 승인으로 열리면(paid) 바로 탐구팩 만들기
  useEffect(() => {
    if (inq?.id && !inq.pack && inq.paid) buildPack(inq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inq?.id, inq?.paid, Boolean(inq?.pack)]);
  const started = useRef(false);

  // 처음 들어올 때 — 무료 체험이 남은 학생에게는 탐구팩을 만들기 전에 먼저 묻는다
  const [entryAsk, setEntryAsk] = useState(false);

  // 새 탐구 만들기 (useFree: "무료 체험 1건을 쓸게요"를 누르고 왔는지)
  async function startNew(useFree) {
    setEntryAsk(false);
    setBusy(true);
    const { data, message, paywall, inquiry: pending } = await callInquiry({
      action: "start",
      query_id: state.query_id,
      topic: state.topic,
      focus: state.focus,
      department: state.department,
      subject: state.subject,
      grade: state.grade,
      term: state.term,
      use_free: useFree,
    });
    setBusy(false);
    if (paywall) {
      setWall({ reason: "start" });
      // 주제는 '결제 대기'로 저장됨 → 그 탐구 화면으로 바꿔 두고 결제 창을 띄운다
      if (pending) {
        setInq(pending);
        return nav(`/inquiry/${pending.id}`, { replace: true });
      }
      return setErr(message);
    }
    if (message) return setErr(message);
    setInq(data.inquiry);
    nav(`/inquiry/${data.inquiry.id}`, { replace: true });
    track("pack_view");
  }

  // 새로 만들기 또는 불러오기
  useEffect(() => {
    if (authLoading || !user || started.current) return;
    started.current = true;

    (async () => {
      if (id === "new") {
        if (!state?.topic && !state?.query_id) return nav("/", { replace: true });
        // 무료 체험이 남았으면 먼저 물어본다 (관리자는 묻지 않음)
        const [{ data: admin }, used] = await Promise.all([supabase.rpc("is_admin"), trialUsedElsewhere(user.id, null)]);
        if (!admin && !used) return setEntryAsk(true);
        return startNew(false);
      }
      const { data, error } = await supabase.from("inquiries").select("*").eq("id", id).maybeSingle();
      if (error || !data) return setErr("탐구를 찾지 못했어요.");
      setInq(data);
      track("pack_view");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, id, state, nav]);

  // 방법 바꾸기
  async function switchMethod(method) {
    if (!inq || method === inq.method || busy) return;
    setBusy(true);
    const { data, message } = await callInquiry({ action: "pack", inquiry_id: inq.id, method });
    setBusy(false);
    if (message) return setErr(message);
    setErr("");
    setInq(data.inquiry);
  }

  // 자료 조사 방식 고르기 — 처음 고른 것만 research_mode에 남긴다
  // AI 자료 찾기는 학생이 '이 주제로 AI 자료 찾기 시작'을 눌러야 시작한다 (막 눌러 들어온 주제에 AI 비용·무료 체험을 쓰지 않게)
  const aiCount = (inq?.sources?.list ?? []).filter((x) => x.added_by !== "me").length;
  const hasAiSources = aiCount > 0;
  // AI가 자료를 찾기 전에는 '자료 고르기' 칸을 접어 둔다 (AI 버튼과 직접 넣기 칸이 같이 보이면 헷갈려서)
  // 직접 넣은 자료가 있거나 학생이 펼치면 보인다
  const [manualOpen, setManualOpen] = useState(false);
  const hasMine = (inq?.sources?.list ?? []).some((x) => x.added_by === "me");
  const showList = hasAiSources || hasMine || manualOpen;
  const pickedCount = (inq?.sources?.list ?? []).filter((x) => x.selected).length;
  // 자료 카드가 처음 나오면 튜토리얼 한 번 (이 브라우저에서 본 적 없을 때)
  const [tourOn, setTourOn] = useState(false);
  useEffect(() => {
    if (!hasAiSources || searching) return;
    let seen = false;
    try {
      seen = Boolean(localStorage.getItem(TOUR_KEY));
    } catch {
      // 저장이 막힌 브라우저면 매번 보여주지 않게 그냥 넘어간다
      seen = true;
    }
    if (!seen) setTimeout(() => setTourOn(true), 500);
  }, [hasAiSources, searching]);
  function endTour() {
    setTourOn(false);
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch {
      // 무시
    }
  }
  const autoRan = useRef(false);
  useEffect(() => {
    if (!inq?.pack || !opened || autoRan.current || searching || hasAiSources) return;
    if (Number(inq.sources?.count ?? 0) >= 2) return; // AI 자료 찾기는 탐구당 2번까지
    autoRan.current = true;
    track("research_ai", inq.method);
    if (!inq.research_mode) supabase.from("inquiries").update({ research_mode: "ai" }).eq("id", inq.id).then(({ error }) => error && console.warn(error));
    findSources(inq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inq?.id, Boolean(inq?.pack), opened, hasAiSources]);

  function startResearch() {
    if (!needOpen("research")) return;
    track("research_ai", inq.method);
    if (!inq.research_mode) supabase.from("inquiries").update({ research_mode: "ai" }).eq("id", inq.id).then(({ error }) => error && console.warn(error));
    findSources();
  }

  // AI가 실제 자료 찾기 (웹 검색, 30초~1분)
  async function findSources(row = inq) {
    setSearching(true);
    setErr("");
    const { data, message } = await callInquiry({ action: "research", inquiry_id: row.id });
    setSearching(false);
    if (message) return setErr(message);
    setInq({ ...data.inquiry, research_view: "ai" });
  }

  // 자료 목록 저장 (열어봄·고름·추가·삭제 공통)
  function saveList(list) {
    const sources = { ...(inq.sources ?? {}), list };
    setInq((x) => ({ ...x, sources }));
    supabase.from("inquiries").update({ sources }).eq("id", inq.id).then(({ error }) => error && console.warn(error));
  }
  const listOf = () => inq.sources?.list ?? [];

  function openSource(i) {
    track("source_open", inq.method);
    saveList(listOf().map((x, k) => (k === i ? { ...x, opened: true } : x)));
  }
  function toggleSource(i) {
    saveList(listOf().map((x, k) => (k === i ? { ...x, selected: !x.selected } : x)));
  }
  function addSource({ title, url }) {
    saveList([...listOf(), { title, url, added_by: "me", selected: true, opened: true }]);
  }
  function removeSource(i) {
    saveList(listOf().filter((_, k) => k !== i));
  }

  // 결과 올리기 — 문헌·사례·데이터는 '보고서에 쓰기'로 고른 자료가 1개 이상 있어야 넘어간다
  function goResult() {
    if (RESEARCH.includes(inq.method) && !listOf().some((x) => x.selected)) {
      track("result_blocked_no_source", inq.method);
      return setNeedPick(true);
    }
    if (!needOpen("result")) return;
    nav(`/inquiry/${inq.id}/result`);
  }
  function goPick() {
    setNeedPick(false);
    sourceArea.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }


  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <div className="py-40 text-center text-gray-500">로그인이 필요합니다.</div>;

  const pack = inq?.pack;
  const hasList = (inq?.sources?.list ?? []).length > 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="flex h-[60px] items-center gap-6 border-b border-gray-200 bg-white px-6">
        <button onClick={() => nav("/")} className="text-[20px] font-extrabold text-sm-navy">
          생수면<span className="text-sm-orange">.</span>
        </button>
        <div className="hidden md:block"><StepBar active={1} id={inq?.id ?? id} stage={inq?.stage} /></div>
        <div className="ml-auto"><InquirySwitcher currentId={inq?.id} /></div>
      </header>


      {err && <p className="mx-auto mt-6 max-w-3xl rounded-lg bg-red-50 px-4 py-3 text-center text-[14px] font-bold text-red-600">{err}</p>}

      {/* 처음 들어왔을 때 — 이 주제로 만들지 먼저 묻는다 ("네"를 누른 탐구가 무료 체험이 된다) */}
      {entryAsk && (
        <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-[20px] font-extrabold text-sm-navy">이 주제로 탐구보고서를 만들까요?</p>
          <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
            {state?.suggestion && <p className="text-[11.5px] font-bold text-sm-orange">상위 1% 탐구주제</p>}
            <p className="mt-0.5 text-[14px] font-bold leading-snug text-sm-navy">{state?.suggestion || state?.topic}</p>
          </div>
          <p className="mt-4 text-[13.5px] leading-relaxed text-gray-600">
            탐구 준비부터 <b className="text-sm-navy">AI 자료 찾기, 결과 분석, 보고서 디자인</b>까지 해 볼 수 있어요.
          </p>
          <p className="mt-1 text-[12px] text-gray-400">첫 탐구는 PDF 저장 전까지 무료예요.</p>
          <button onClick={() => startNew(true)} className="mt-6 h-[52px] w-full max-w-sm rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">
            네, 이 주제로 만들게요
          </button>
          <button
            onClick={() => {
              track("trial_no");
              nav(-1);
            }}
            className="mt-2 h-11 w-full max-w-sm rounded-xl border border-gray-300 text-[14px] font-bold text-gray-600"
          >
            다른 주제 볼래요
          </button>
        </div>
      )}

      {!inq && !err && !entryAsk && (
        <div className="px-5 py-16 text-center">
          {busy ? <Waiting phase="pack" /> : <p className="py-24 text-[14px] text-gray-400">불러오는 중…</p>}
        </div>
      )}

      {/* 결제 대기 — 주제만 저장된 탐구 */}
      {inq && !inq.pack && (
        <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-[12px] font-bold text-sm-orange">{building ? "탐구팩 만드는 중" : "결제 대기"}</p>
          <h1 className="mt-2 text-[19px] font-extrabold leading-snug text-sm-navy">{inq.suggestion}</h1>
          <p className="mt-1 text-[12.5px] text-gray-500">{[inq.department, inq.grade, inq.subject].filter(Boolean).join(" · ")}</p>
          <p className="mt-4 text-[13.5px] leading-relaxed text-gray-600">
            {building ? (
              "탐구 방법을 고르고 탐구팩을 만들고 있어요. 20~40초 걸려요."
            ) : (
              <>
                이 주제는 ‘내 탐구’에 저장해 두었어요.
                <br />
                이용권으로 열면 탐구 방법 추천과 탐구팩을 바로 만들어 드려요.
              </>
            )}
          </p>
          {!building && (
            <button
              // 먼저 서버에 열어 달라고 한다 — 승인으로 이용권이 들어와 있으면 그 자리에서 탐구팩을 만들고,
              // 이용권이 없을 때만 결제 창이 뜬다 (buildPack이 결제 창을 띄움)
              onClick={() => buildPack()}
              className="mt-6 h-[52px] w-72 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white"
            >
              {inq.paid ? "탐구팩 만들기" : "이용권으로 열기"}
            </button>
          )}
          {!building && !inq.paid && (
            <p className="mt-3 text-[12px] text-gray-400">입금했다면 관리자 승인 뒤 이 화면이 자동으로 열려요.</p>
          )}
        </div>
      )}

      {inq?.pack && (
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-5 lg:flex-row">
          {/* 왼쪽 — 탐구 방법 */}
          <aside className="space-y-2 lg:w-[250px] lg:shrink-0">
            <p className="px-1 text-[12px] font-bold text-gray-500">탐구 방법</p>
            {METHODS.map((m) => {
              const on = inq.method === m.k;
              const rec = pack?.recommended === m.k;
              // AI가 고른 방법(지금 탐구팩)만 쓴다 — 다른 방법은 흐리게 막는다
              const off = !on;
              return (
                <button
                  key={m.k}
                  type="button"
                  disabled={off || busy}
                  aria-disabled={off}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    on ? "border-sm-navy bg-sm-navy text-white" : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 opacity-60"
                  }`}
                >
                  <p className="text-[14px] font-extrabold">
                    {m.label} {rec && <span className={`text-[11.5px] ${on ? "text-orange-200" : "text-sm-orange"}`}>AI 추천</span>}
                  </p>
                  <p className={`mt-0.5 text-[12px] ${on ? "text-indigo-100" : "text-gray-400"}`}>{m.desc}</p>
                </button>
              );
            })}
            <p className="px-1 text-[12px] leading-relaxed text-gray-500">
              AI가 이 주제에 가장 잘 맞는 방법을 골랐어요. 탐구팩은 이 방법으로 만들어져요.
            </p>
            {busy && <p className="px-1 text-[12.5px] font-bold text-sm-orange">탐구팩을 만드는 중…</p>}
          </aside>

          {/* 가운데 — 탐구팩 */}
          <main className="min-w-0 flex-1 space-y-5 rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <p className="text-[12px] font-bold text-sm-orange">{METHOD_NAME[inq.method]} 탐구팩</p>
              <h1 className="mt-1 text-[19px] font-extrabold leading-snug text-sm-navy">{inq.suggestion}</h1>
              <p className="mt-1 text-[12.5px] text-gray-500">{inq.department} · {inq.grade} · {inq.subject}</p>
            </div>
            {pack?.purpose && <p className="text-[14px] leading-relaxed text-gray-700"><b className="text-sm-navy">탐구 목적</b> · {pack.purpose}</p>}
            {/* 자료 — 들어오면 AI가 바로 찾아 두고, 학생은 열어 보고 고르기만. 직접 찾은 자료는 맨 아래 칸에서 추가 */}
            <div ref={sourceArea} className="scroll-mt-5 space-y-3">
              {searching ? (
                <Waiting phase="research" similar={SIMILAR[inq.method]} />
              ) : (
                !hasAiSources && (
                  <div className="rounded-2xl border-2 border-sm-navy/10 bg-indigo-50/60 p-5 text-center">
                    <p className="text-[15px] font-extrabold text-sm-navy">
                      {SIMILAR[inq.method] ? `이 주제로 비슷한 ${SIMILAR[inq.method]}을 AI가 찾아볼까요?` : "이 주제로 AI가 자료를 찾아볼까요?"}
                    </p>
                    <p className="mt-1 text-[12.5px] text-gray-600">아래 탐구팩을 먼저 보고, 이 주제로 하겠다면 시작해요.</p>
                    <button onClick={startResearch} className="mt-3 h-12 w-full max-w-md rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">
                      이 주제로 AI 자료 찾기 시작
                    </button>
                    {!opened && trialTaken === false && (
                      <p className="mt-2 text-[12px] text-gray-400">첫 탐구는 PDF 저장 전까지 무료예요</p>
                    )}
                  </div>
                )
              )}
              {!searching && showList && (
                <SourceList list={listOf()} onOpen={openSource} onToggle={toggleSource} onAdd={addSource} onRemove={removeSource} showAi similar={SIMILAR[inq.method]} />
              )}
              {!searching && !showList && (
                <button
                  type="button"
                  onClick={() => setManualOpen(true)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-left text-[13.5px] font-bold text-gray-600 hover:border-sm-navy"
                >
                  이미 찾아 둔 자료가 있으면 직접 넣기
                  <span className="rounded-md border border-gray-200 px-2 py-0.5 text-[12px] text-gray-500">펼치기 ▼</span>
                </button>
              )}
            </div>
            {/* 문헌·사례·데이터는 AI가 자료를 찾아 주니 탐구팩(검색어 안내)은 아래로 접어둔다 */}
            {RESEARCH.includes(inq.method) ? (
              <details className="rounded-xl border border-gray-200 p-4">
                <summary className="cursor-pointer text-[13.5px] font-bold text-sm-navy">탐구팩 (검색어·비교 기준) 펼쳐 보기</summary>
                <div className="mt-4"><PackBody method={inq.method} pack={pack} topic={inq.suggestion} /></div>
              </details>
            ) : (
              <PackBody method={inq.method} pack={pack} topic={inq.suggestion} />
            )}
          </main>

          {/* 오른쪽 — 할 일 · 선배 비교 · 메모 */}
          <aside className="space-y-4 lg:w-[320px] lg:shrink-0">
            {pack?.seniors?.count > 0 && (
              <div className="rounded-2xl bg-sm-navy p-5 text-white">
                <p className="text-[11.5px] font-bold text-orange-200">같은 학과 실제 세특 기록에서 찾았어요</p>
                <p className="mt-1 text-[15px] font-extrabold">비슷한 탐구 {pack.seniors.count >= 50 ? "50건 이상" : `${pack.seniors.count}건`}</p>
                <ul className="mt-2 space-y-1 text-[12.5px] text-indigo-100">
                  {pack.seniors.examples.map((e, i) => <li key={i}>· {e}</li>)}
                </ul>
                <p className="mt-2 text-[12.5px] text-white">직접 한 결과로 비교하면 이 기록들과 달라져요.</p>
              </div>
            )}

            {/* AI가 한 일과 이유 — 무엇을 왜 준비했는지, 자료를 왜 골랐는지, AI가 한 것이라 꼭 확인할 것 */}
            <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
              <div>
                <p className="text-[12px] font-bold text-gray-500">AI가 준비한 것</p>
                <ul className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-gray-700">
                  <li>
                    <b className="text-sm-navy">{METHOD_NAME[inq.method]}로 정한 이유</b>
                    <p className="mt-0.5">{pack?.reason || "이 주제를 가장 안전하고 구체적으로 확인할 수 있는 방법이에요."}</p>
                  </li>
                  {aiCount > 0 && (
                    <li>
                      <b className="text-sm-navy">
                        {SIMILAR[inq.method] ? `비슷한 ${SIMILAR[inq.method]} ${aiCount}개를 찾은 이유` : `자료 ${aiCount}개를 찾은 이유`}
                      </b>
                      <p className="mt-0.5">
                        {inq.sources?.why ||
                          (SIMILAR[inq.method]
                            ? "다른 사람이 실제로 해 본 과정과 결과를 보면, 내 탐구를 설계하고 결과를 비교할 기준이 생겨요."
                            : "같은 기준으로 비교할 수 있게, 서로 다른 출처(공식자료·논문·기사)에서 주제와 직접 관련된 자료를 골랐어요.")}
                      </p>
                    </li>
                  )}
                  <li>
                    <b className="text-sm-navy">탐구팩</b>
                    <p className="mt-0.5">
                      {RESEARCH.includes(inq.method) ? "검색어·찾을 곳·비교 기준을 정리해 뒀어요." : "순서·준비물·기록표를 정리해 뒀어요. 그대로 따라 하면 돼요."}
                    </p>
                  </li>
                </ul>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-[12px] font-bold text-gray-500">내가 할 것</p>
                <p className="mt-1 text-[13px] font-bold leading-relaxed text-sm-orange">{pack?.do ?? "탐구하고 기록하기"}</p>
              </div>

              <div className="rounded-xl bg-amber-50 p-3.5">
                <p className="text-[12.5px] font-extrabold text-amber-900">AI가 한 것이라 꼭 확인해요</p>
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-relaxed text-amber-900">
                  <li>· 자료는 <b>직접 열어서</b> 실제로 있는 내용인지 확인해요</li>
                  <li>· 요약·숫자는 틀릴 수 있어요. 보고서엔 원문에서 확인한 것만 써요</li>
                  <li>· 결과는 내가 직접 모은 것만 써요. AI는 결과를 대신 만들지 않아요</li>
                  <li>· 보고서에 쓴 자료는 제목·링크(출처)를 꼭 남겨요</li>
                </ul>
              </div>

              {pack?.memo_points?.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[12.5px] font-bold text-sm-navy">탐구하면서 메모해 둘 것</p>
                  <ul className="mt-1 space-y-0.5 text-[12.5px] text-gray-600">{pack.memo_points.map((m, i) => <li key={i}>· {m}</li>)}</ul>
                </div>
              )}

            </div>

            {justOpened && (
              <p className="rounded-xl bg-green-50 px-4 py-3 text-center text-[13.5px] font-bold text-green-700">
                입금이 확인돼서 열렸어요! 다음 단계로 넘어가 보세요.
              </p>
            )}
            <button
              onClick={goResult}
              data-tour="next"
              className={`h-[52px] w-full rounded-xl text-[15px] font-extrabold text-white ${locked ? "bg-gray-400" : "bg-sm-navy"} ${
                !locked && pickedCount > 0 ? "ring-4 ring-sm-orange/40 animate-pulse" : ""
              }`}
            >
              {locked ? "다음 단계 · 이용권 필요" : "다음 단계 →"}
            </button>
            {locked && (
              <p className="text-center text-[12px] leading-relaxed text-gray-500">
                무료 체험 1건은 이미 썼어요.
                <br />
                이용권으로 열면 결과 분석·보고서 디자인·PDF까지 쓸 수 있어요.
              </p>
            )}
          </aside>
        </div>
      )}

      {/* 무료 체험 1건을 이 탐구에 쓸지 묻기 */}
      {askTrial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={() => !usingTrial && setAskTrial(null)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[440px] rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[19px] font-extrabold text-sm-navy">이 주제로 탐구보고서를 만들까요?</p>
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[13px] font-bold leading-snug text-sm-navy">{inq.suggestion}</p>
            <p className="mt-3 text-[13px] leading-relaxed text-gray-600">
              <b className="text-sm-navy">AI 자료 찾기, 결과 분석, 보고서 디자인</b>까지 해 볼 수 있어요.
            </p>
            <p className="mt-1 text-[12px] text-gray-400">첫 탐구는 PDF 저장 전까지 무료예요.</p>
            <button onClick={useTrial} disabled={usingTrial} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-50">
              {usingTrial ? "여는 중…" : "네, 이 주제로 만들게요"}
            </button>
            <button onClick={() => setAskTrial(null)} disabled={usingTrial} className="mt-2 h-11 w-full rounded-xl border border-gray-300 text-[14px] font-bold text-gray-600">
              다른 주제 볼래요
            </button>
          </div>
        </div>
      )}

      {/* '보고서에 쓰기' 자료를 안 고르고 결과 올리기를 눌렀을 때 */}
      {needPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={() => setNeedPick(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[420px] rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[18px] font-extrabold text-sm-navy">보고서에 쓸 자료를 골라 주세요</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
              {hasList ? (
                <>
                  자료 카드의 <b className="text-sm-navy">‘보고서에 쓰기’</b>를 하나 이상 눌러야 해요.
                  <br />
                  고른 자료만 3단계에서 AI가 읽고 비교표를 채워요.
                </>
              ) : (
                <>
                  아직 모은 자료가 없어요. 직접 찾거나 AI에게 찾아 달라고 한 뒤,
                  <br />
                  <b className="text-sm-navy">‘보고서에 쓰기’</b>로 쓸 자료를 골라요.
                </>
              )}
            </p>
            <button onClick={goPick} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">
              자료 고르러 가기
            </button>
          </div>
        </div>
      )}

      {tourOn && <SourceTour onDone={endTour} />}

      <Paywall open={Boolean(wall)} reason={wall?.reason} inquiryId={inq?.id} onClose={() => setWall(null)} onUnlocked={reload} />
    </div>
  );
}