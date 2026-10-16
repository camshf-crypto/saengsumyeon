import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";

/*
 * 💧 물병 단어장 — 사탐 · 과탐 개념 외우기 (고1 · 고2)
 *   뒤집는 카드가 아니라 '빨간 가리개 단어장' 방식:
 *     줄노트 한 장에 단어가 있고, 뜻은 빨간 가리개에 가려져 있다 → 탭하면 가리개가 내려간다
 *     옆으로 밀거나 버튼으로 [다시 볼래] [알아!] — 알 때마다 내 물병이 찬다
 *   /cards                   학년(고1 · 고2 · 고3) › 과목 고르기 (카드가 있는 과목만 열림 · 나머지는 준비 중)
 *   /cards/:subject          단원 목록 (단원마다 물병 · 외운 수 / 전체)
 *   /cards/:subject/:unit    단어장 넘기기 · 가리기 방식: 뜻 가리기 / 단어 가리기
 *   못 외운 단어는 이번 판 끝에 다시 나온다 · 회원은 기록이 남는다 (비회원은 이번 판만)
 * SQL: sm_35_cards.sql (카드 · 기록) · sm_36_card_subjects.sql (학년별 과목)
 */
const GRADES = ["고1", "고2", "고3"];
const nameOf = (key) => key.replace(/^고\d /, ""); // '고2 경제' → '경제' (학년이 달라도 이름이 같은 과목은 key 로 구분)
const AREA = {
  국어: "bg-rose-50 text-rose-700",
  수학: "bg-violet-50 text-violet-700",
  영어: "bg-sky-50 text-sky-700",
  사회: "bg-teal-50 text-teal-700",
  과학: "bg-blue-50 text-blue-700",
  역사: "bg-amber-50 text-amber-700",
  정보: "bg-indigo-50 text-indigo-700",
  한문: "bg-stone-100 text-stone-700",
  제2외국어: "bg-pink-50 text-pink-700",
  "기술·가정": "bg-lime-50 text-lime-700",
};
const LINES = "repeating-linear-gradient(to bottom, transparent 0, transparent 33px, #E8ECF4 33px, #E8ECF4 34px)";

/* 물병 — 0~1 만큼 물이 찬다 */
function Bottle({ value = 0, size = 44 }) {
  const h = 46 * Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size * 1.35} viewBox="0 0 40 54" aria-hidden="true">
      <defs>
        <clipPath id={`b${size}`}>
          <path d="M14 2h12v6c0 2 6 4 6 10v30a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V18c0-6 6-8 6-10Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#b${size})`}>
        <rect x="0" y="0" width="40" height="54" fill="#EEF4FF" />
        <rect x="0" y={52 - h} width="40" height={h} fill="#3B82F6" opacity=".85" style={{ transition: "y .5s, height .5s" }} />
        <rect x="0" y={52 - h} width="40" height="2.5" fill="#93C5FD" style={{ transition: "y .5s" }} />
      </g>
      <path d="M14 2h12v6c0 2 6 4 6 10v30a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V18c0-6 6-8 6-10Z" fill="none" stroke="#18224F" strokeWidth="2" />
      <rect x="13" y="0.5" width="14" height="4" rx="1.5" fill="#18224F" />
    </svg>
  );
}

/* ───────── 학년 › 과목 고르기 ───────── */

export function CardHome() {
  const { user } = useAuth();
  const [grade, setGrade] = useState(null);
  const [list, setList] = useState(null);

  // 처음 학년 — 회원이면 내 학년, 아니면 마지막으로 본 학년, 없으면 고1
  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem("sm_cards_grade");
    } catch {
      /* 없어도 된다 */
    }
    if (saved && GRADES.includes(saved)) return setGrade(saved);
    if (!user) return setGrade("고1");
    supabase.rpc("sm_get_my").then(({ data }) => setGrade(GRADES.includes(data?.grade) ? data.grade : "고1"));
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!grade) return;
    try {
      localStorage.setItem("sm_cards_grade", grade);
    } catch {
      /* 못 적어도 된다 */
    }
    setList(null);
    supabase.rpc("cards_subjects", { p_grade: grade }).then(({ data }) => setList(data || []));
  }, [grade, user?.id]);

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-md px-4 pb-16 pt-6">
        <p className="text-[12.5px] font-bold text-gray-500">💧 물병 단어장</p>
        <h1 className="mt-0.5 text-[24px] font-extrabold tracking-tight text-sm-navy">아는 만큼 물병이 차</h1>
        <p className="mt-1 text-[13.5px] text-gray-600">내 학년이랑 과목을 골라. 시험에 나오는 개념을 빨간 가리개로 외워.</p>

        {/* 학년 */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-[#E9EBEF] p-1">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={`h-10 rounded-lg text-[14.5px] font-bold ${grade === g ? "bg-white text-sm-navy shadow-sm" : "text-gray-500"}`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* 과목 */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {list === null && <p className="col-span-2 py-12 text-center text-[14px] text-gray-500">불러오는 중…</p>}
          {list?.map((s, i) => {
            const head =
              list.some((x) => x.tag) && (i === 0 || !!list[i - 1].tag !== !!s.tag) ? (
                <p key={`h-${s.key}`} className={`col-span-2 text-[13px] font-extrabold text-gray-600 ${i ? "mt-3" : ""}`}>
                  {s.tag ? "수능 보는 과목" : "선택 과목"}
                </p>
              ) : null;
            const ready = s.total > 0;
            const v = s.known / Math.max(1, s.total);
            const body = (
              <>
                <div className="flex items-start justify-between">
                  <span className="flex flex-wrap gap-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${ready ? AREA[s.area] : "bg-gray-100 text-gray-400"}`}>{s.area}</span>
                    {s.tag && <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-600">{s.tag}</span>}
                  </span>
                  {ready ? <Bottle value={v} size={26} /> : <span className="text-[11px] font-bold text-gray-400">준비 중</span>}
                </div>
                <b className={`mt-2 break-keep text-[15.5px] leading-snug ${ready ? "text-gray-900" : "text-gray-400"}`}>{s.name}</b>
                <span className="mt-auto pt-1.5 text-[12px] font-bold tabular-nums text-gray-500">{ready ? `${s.known} / ${s.total}` : "곧 열려요"}</span>
              </>
            );
            const tile = ready ? (
              <Link key={s.key} to={`/cards/${encodeURIComponent(s.key)}`} className="flex min-h-[118px] flex-col rounded-2xl bg-white p-4 ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:ring-gray-300">
                {body}
              </Link>
            ) : (
              <div key={s.key} className="flex min-h-[118px] flex-col rounded-2xl bg-white/60 p-4 ring-1 ring-gray-200">
                {body}
              </div>
            );
            return head ? [head, tile] : tile;
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────── 단원 목록 ───────── */

export function CardUnits() {
  const { subject } = useParams();
  const SUBJECT = decodeURIComponent(subject);
  const { user } = useAuth();
  const [units, setUnits] = useState(null);

  useEffect(() => {
    supabase.rpc("cards_units", { p_subject: SUBJECT }).then(({ data }) => setUnits(data || []));
  }, [SUBJECT, user?.id]);

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-md px-4 pb-16 pt-6">
        <Link to="/cards" className="text-[13px] font-semibold text-gray-500">
          ‹ 과목 고르기
        </Link>
        <p className="mt-3 text-[12.5px] font-bold text-gray-500">💧 물병 단어장</p>
        <h1 className="mt-0.5 text-[24px] font-extrabold tracking-tight text-sm-navy">{nameOf(SUBJECT)}</h1>
        <p className="mt-1 text-[13.5px] text-gray-600">빨간 가리개를 내려서 확인하고, 알면 옆으로 넘겨. 단원 물병을 가득 채워 봐.</p>
        {!user && <p className="mt-3 rounded-xl bg-orange-50 px-3.5 py-2.5 text-[12.5px] text-[#C2410C]">로그인하면 물병이 저장돼서 다음에 이어서 채울 수 있어</p>}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {units === null && <p className="col-span-2 py-12 text-center text-[14px] text-gray-500">불러오는 중…</p>}
          {units?.map((u) => {
            const v = u.known / Math.max(1, u.total);
            return (
              <Link key={u.unit_no} to={`/cards/${encodeURIComponent(SUBJECT)}/${u.unit_no}`} className="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:ring-gray-300">
                <div className="flex items-start justify-between">
                  <span className="text-[12px] font-extrabold text-[#2563EB]">{u.unit_no}단원</span>
                  <Bottle value={v} size={30} />
                </div>
                <b className="mt-2 break-keep text-[15px] leading-snug text-gray-900">{u.unit_name}</b>
                <span className="mt-auto pt-2 text-[12px] font-bold tabular-nums text-gray-500">
                  {u.known} / {u.total} {v >= 1 && "· 가득 💧"}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────── 단어장 넘기기 ───────── */

export default function Cards() {
  const { subject, unit } = useParams();
  const SUBJECT = decodeURIComponent(subject);
  const { user } = useAuth();
  const [cards, setCards] = useState(null);
  const [unitName, setUnitName] = useState("");
  const [hide, setHide] = useState("defn"); // defn: 뜻 가리기 · term: 단어 가리기
  const [onlyLeft, setOnlyLeft] = useState(true);
  const [order, setOrder] = useState([]);
  const [pos, setPos] = useState(0);
  const [open, setOpen] = useState(false); // 가리개 내렸나
  const [known, setKnown] = useState(0);
  const [again, setAgain] = useState(0);
  const [dx, setDx] = useState(0); // 밀고 있는 거리
  const startX = useRef(null);

  useEffect(() => {
    setCards(null);
    supabase.rpc("cards_list", { p_subject: SUBJECT, p_unit: Number(unit) }).then(({ data }) => setCards(data || []));
    supabase
      .rpc("cards_units", { p_subject: SUBJECT })
      .then(({ data }) => setUnitName((data || []).find((u) => String(u.unit_no) === String(unit))?.unit_name ?? ""));
  }, [SUBJECT, unit, user?.id]);

  const pool = useMemo(() => {
    if (!cards) return [];
    const left = cards.filter((c) => !c.known);
    return onlyLeft && left.length ? left : cards;
  }, [cards, onlyLeft]);

  function start() {
    setOrder(pool.map((_, i) => i).sort(() => Math.random() - 0.5));
    setPos(0);
    setOpen(false);
    setKnown(0);
    setAgain(0);
  }
  useEffect(start, [pool]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = pool.length;
  const done = cards && order.length > 0 && pos >= order.length;
  const card = !cards || done ? null : pool[order[pos]];
  const retryLeft = Math.max(0, order.length - Math.max(pos, total));
  const someKnown = cards?.some((c) => c.known) && !cards?.every((c) => c.known);
  const nextCard = !done && order[pos + 1] != null ? pool[order[pos + 1]] : null;

  function next(ok) {
    if (!card) return;
    if (ok) setKnown((n) => n + 1);
    else {
      setAgain((n) => n + 1);
      setOrder((o) => [...o, o[pos]]);
    }
    if (user) supabase.rpc("cards_mark", { p_card: card.id, p_known: ok });
    setOpen(false);
    setDx(0);
    setPos((p) => p + 1);
  }

  // 옆으로 밀기 — 오른쪽: 알아 · 왼쪽: 다시 볼래
  const onDown = (e) => (startX.current = e.clientX);
  const onMove = (e) => startX.current != null && setDx(e.clientX - startX.current);
  const onUp = () => {
    if (startX.current == null) return;
    const d = dx;
    startX.current = null;
    if (Math.abs(d) < 8) {
      setDx(0);
      setOpen((o) => !o); // 탭 = 가리개 올리고 내리기
    } else if (d > 90) next(true);
    else if (d < -90) next(false);
    else setDx(0);
  };

  const shown = hide === "defn" ? card?.term : card?.defn;
  const hidden = hide === "defn" ? card?.defn : card?.term;

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-md px-4 pb-10 pt-5">
        {/* 위: 뒤로 · 단원 · 내 물병 */}
        <div className="flex items-center gap-3">
          <Link to={`/cards/${encodeURIComponent(SUBJECT)}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[16px] text-gray-600 ring-1 ring-gray-200" aria-label="단원 목록">
            ‹
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-bold text-[#2563EB]">{unit}단원 · {nameOf(SUBJECT)}</p>
            <p className="truncate text-[16px] font-extrabold text-sm-navy">{unitName}</p>
          </div>
          <div className="flex items-end gap-1.5">
            <span className="pb-1 text-[12px] font-bold tabular-nums text-gray-500">
              {known}/{total}
            </span>
            <Bottle value={known / Math.max(1, total)} size={28} />
          </div>
        </div>

        {/* 가리기 방식 */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-[#E9EBEF] p-[3px]">
            {[
              ["defn", "뜻 가리기"],
              ["term", "단어 가리기"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setHide(k);
                  setOpen(false);
                }}
                className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold ${hide === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {someKnown && (
            <button onClick={() => setOnlyLeft((v) => !v)} className="ml-auto text-[12.5px] font-semibold text-gray-500">
              {onlyLeft ? "☑" : "☐"} 안 외운 것만
            </button>
          )}
        </div>

        {cards === null && <p className="py-16 text-center text-[14px] text-gray-500">불러오는 중…</p>}

        {done && (
          <section className="mt-5 flex flex-col items-center rounded-3xl bg-white px-6 py-10 text-center ring-1 ring-gray-200">
            <Bottle value={1} size={56} />
            <p className="mt-3 text-[19px] font-extrabold text-sm-navy">물병 가득! {total}개 다 알았어</p>
            <p className="mt-1 text-[13.5px] text-gray-500">
              다시 본 단어 {again}번{!user && " · 로그인하면 물병이 저장돼"}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button onClick={start} className="h-11 rounded-xl bg-sm-navy px-5 text-[14px] font-bold text-white">
                한 번 더
              </button>
              <Link to={`/cards/${encodeURIComponent(SUBJECT)}`} className="flex h-11 items-center rounded-xl bg-[#E9EBEF] px-5 text-[14px] font-bold text-gray-700">
                다른 단원
              </Link>
            </div>
          </section>
        )}

        {card && (
          <>
            {/* 단어장 — 뒤에 다음 장이 살짝 보인다 */}
            <div className="relative mt-5 h-[400px] select-none">
              {nextCard && <div className="absolute inset-x-3 top-3 h-full rounded-[22px] bg-white/70 ring-1 ring-gray-200" />}
              <div
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={() => startX.current != null && onUp()}
                className="absolute inset-0 touch-pan-y overflow-hidden rounded-[22px] bg-white shadow-[0_8px_24px_rgba(20,27,61,.08)] ring-1 ring-gray-200"
                style={{
                  transform: `translateX(${dx}px) rotate(${dx / 25}deg)`,
                  transition: startX.current == null ? "transform .25s" : "none",
                  backgroundImage: LINES,
                  backgroundPosition: "0 18px",
                }}
              >
                {/* 왼쪽 빨간 여백 줄 */}
                <div className="absolute inset-y-0 left-[42px] w-px bg-[#F8B4B4]" />
                {/* 밀 때 표시 */}
                {dx > 30 && <span className="absolute left-[58px] top-[118px] z-10 -rotate-6 rounded-lg border-2 border-[#2563EB] px-2 py-0.5 text-[14px] font-black text-[#2563EB]">알아!</span>}
                {dx < -30 && <span className="absolute right-6 top-[118px] z-10 rotate-6 rounded-lg border-2 border-gray-400 px-2 py-0.5 text-[14px] font-black text-gray-500">다시</span>}

                <div className="relative flex h-full flex-col py-5 pl-[58px] pr-5">
                  <span className="absolute left-3 top-5 text-[11px] font-bold tabular-nums text-[#E57373]">{String(card.no).padStart(3, "0")}</span>
                  <p className="text-[11.5px] font-bold text-gray-400">{hide === "defn" ? "이 단어의 뜻은?" : "이 뜻의 단어는?"}</p>
                  <p className={`mt-3 break-keep [overflow-wrap:anywhere] font-extrabold leading-snug text-gray-900 ${hide === "defn" ? "text-[30px]" : "text-[19px]"}`}>{shown}</p>

                  {/* 가려진 답 + 빨간 가리개 */}
                  <div className="relative mt-6 overflow-hidden rounded-xl">
                    <p className={`break-keep [overflow-wrap:anywhere] px-3 py-3 font-bold leading-relaxed text-[#C53030] ${hide === "defn" ? "text-[17px]" : "text-[26px]"}`}>{hidden}</p>
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#E53935] text-[13px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)] font-bold text-white transition-transform duration-300"
                      style={{ transform: open ? "translateY(105%)" : "translateY(0)" }}
                    >
                      탭해서 가리개 내리기
                    </div>
                  </div>

                  {open && card.topic && (
                    <div className="mt-auto rounded-xl bg-[#F4F5F7] px-3.5 py-2.5">
                      <p className="text-[11.5px] font-bold text-gray-500">이 개념으로 탐구하면?</p>
                      <p className="mt-0.5 truncate text-[13px] font-semibold text-gray-800">💡 {card.topic}</p>
                    </div>
                  )}
                  <p className="mt-auto pt-3 text-[11.5px] text-gray-400">← 다시 볼래 · 알아! →</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <button onClick={() => next(false)} className="h-[52px] flex-1 rounded-full bg-white text-[15px] font-extrabold text-gray-600 ring-1 ring-gray-200">
                ↺ 다시 볼래
              </button>
              <button onClick={() => next(true)} className="h-[52px] flex-[1.4] rounded-full bg-sm-navy text-[15px] font-extrabold text-white">
                💧 알아!
              </button>
            </div>
            <p className="mt-2 text-center text-[12px] text-gray-500">
              다시 나올 단어 <b className="text-gray-800">{retryLeft}</b>개 · 남은 단어 <b className="text-gray-800">{Math.max(0, total - pos)}</b>개
            </p>
          </>
        )}
      </div>
    </div>
  );
}