import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import LoginGate from "../../components/LoginGate";
import UpgradeModal from "../../components/UpgradeModal";
import { track } from "../../lib/track";
import { Rich } from "../agent/Agent";

/*
 * 내 입시 홈 — /my/home
 * 생수면에서 한 것(물꼬 답 저장 · 탐구주제 · 독서 · 지원동기 · 면접 예상질문 · 꼬리질문 · 탐구 보고서 · 입시 플랜 · 물꼬 대화)이
 * 날짜순으로 자동으로 쌓인다 (sql/sm_107 home_feed) · 맨 위는 이번 달 할 일 + 다음 달 미리 보기 (물꼬 서버 month_plan)
 * 무료는 최근 30일만 열림 · 그 전 것은 흐리게 잠김 → 1년 이용권
 */
const KIND = {
  save: { label: "물꼬 답 저장", color: "#1E2A5A" },
  chat: { label: "물꼬 대화", color: "#3D6BEF" },
  topic: { label: "탐구주제 진단", color: "#EA580C" },
  reading: { label: "독서 진단", color: "#2F56D6" },
  motive: { label: "지원동기 진단", color: "#0B8A5E" },
  interview: { label: "생기부 예상질문", color: "#18224F" },
  tail: { label: "꼬리질문 연습", color: "#FD1673" },
  inquiry: { label: "탐구 보고서", color: "#C2410C" },
  plan: { label: "입시 플랜", color: "#0F9D58" },
  suhaeng: { label: "수행평가 완성", color: "#0F9D58" },
};
const FILTERS = [
  ["all", "전체"],
  ["save", "저장"],
  ["study", "탐구 · 진단"],
  ["interview", "면접"],
  ["plan", "플랜"],
  ["chat", "물꼬 대화"],
];
const IN_FILTER = {
  study: ["topic", "reading", "motive", "inquiry", "suhaeng"],
  interview: ["interview", "tail"],
};
const day = (d) => new Date(d).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const monthOf = (d) => new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

// 이번 달 할 일 + 다음 달 미리 보기 — 학년 할 일 · 전국 입시 일정 · 학교 시험 · 학교 수행평가 (물꼬 서버 month_plan)
function MonthCard({ p }) {
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  if (!p?.months?.length) return null;
  const ask = (q) => nav(`/agent?q=${encodeURIComponent(q)}`);
  const school = p.school_name || p.school;
  const Task = ({ t, mon }) => (
    <button
      onClick={() => ask(`${t.subject} 수행평가 '${t.title}' 채점 기준이랑 준비 방법 알려 줘`)}
      className="flex w-full items-center gap-3 rounded bg-[#F7F8FA] px-3.5 py-2.5 text-left hover:bg-orange-50"
    >
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px] font-bold text-gray-900">{t.subject} · {t.title}</b>
        <small className="text-[12px] text-gray-500">{t.period || "시기 미정"}{t.due && <b className="ml-1.5 font-extrabold text-[#FD1673]">{mon}월 마감</b>}</small>
      </span>
      <span className="flex-none rounded bg-white px-2 py-1 text-[12px] font-extrabold text-sm-orange ring-1 ring-orange-200">{t.points ?? "?"}점</span>
    </button>
  );
  const Month = ({ m, first }) => {
    const tasks = first || more ? m.tasks : m.tasks.slice(0, 3);
    return (
      <div className={first ? "" : "mt-5 border-t border-dashed border-gray-200 pt-4"}>
        <p className={`text-[15px] font-black ${first ? "text-sm-navy" : "text-gray-500"}`}>
          {m.month}월 <span className="text-[12px] font-extrabold">{m.label}</span>
        </p>
        {m.todo && (
          <p className="mt-2 rounded bg-orange-50 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-gray-800">
            <b className="font-extrabold">{p.grade} {m.month}월</b>엔 {m.todo}
          </p>
        )}
        {[...m.national.map((x) => `${x.date} · ${x.title}`), ...m.exams.map((x) => `${school} ${x}`)].map((x) => (
          <p key={x} className="mt-1.5 px-1 text-[13px] font-bold text-gray-700">{x}</p>
        ))}
        {m.tasks.length > 0 && (
          <>
            <p className="mt-3 text-[12px] font-extrabold text-gray-400">{school} 수행평가 {m.tasks.length}개</p>
            <div className="mt-1.5 space-y-1.5">{tasks.map((t, k) => <Task key={k} t={t} mon={m.month} />)}</div>
            {!first && !more && m.tasks.length > 3 && (
              <button onClick={() => setMore(true)} className="mt-1.5 text-[12.5px] font-bold text-gray-400">{m.tasks.length - 3}개 더 보기</button>
            )}
          </>
        )}
      </div>
    );
  };
  return (
    <div className="rounded bg-white p-4 ring-1 ring-black/10">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-extrabold text-gray-400">{school ? `${school} ${p.grade ?? ""}` : p.grade || "내"} 할 일</p>
        {p.term && <small className="text-[11px] text-gray-400">{p.term} 평가계획 기준</small>}
      </div>
      <div className="mt-2">
        <Month m={p.months[0]} first />
        {p.months[1] && <Month m={p.months[1]} />}
      </div>
      {p.always?.length > 0 && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-gray-500">
          꾸준히 쌓는 상시 수행평가: {p.always.slice(0, 3).map((t) => `${t.subject} '${t.title}'`).join(" · ")}
        </p>
      )}
      {!p.school && <p className="mt-3 text-[12.5px] text-gray-400">학교를 알려 주면 그 학교 수행평가 · 시험 일정도 여기에 같이 떠요.</p>}
      {p.school && !p.has_data && <p className="mt-3 text-[12.5px] text-gray-400">{p.school} 평가계획을 준비하고 있어요. 들어오면 수행평가 일정이 여기에 같이 떠요.</p>}
      <button
        onClick={() => ask(`${p.months[0].month}월에 할 일 순서대로 계획 짜 줘`)}
        className="mt-4 h-11 w-full rounded bg-sm-navy text-[14px] font-extrabold text-white"
      >
        물꼬랑 {p.months[0].month}월 계획 짜기 ›
      </button>
      <p className="mt-2 text-center text-[11px] text-gray-400">수행평가를 누르면 물꼬가 채점 기준에 맞춰 준비 방법을 알려 줘요 · 최종 일정은 학교 공지를 따라요</p>
    </div>
  );
}

function Item({ it, onLocked, onDelete }) {
  const [open, setOpen] = useState(false);
  const k = KIND[it.kind] ?? { label: it.kind, color: "#18224F" };
  const head = (
    <div className="flex items-start gap-3">
      <span className="w-[3px] flex-none self-stretch" style={{ background: k.color }} />
      <span className="min-w-0 flex-1">
        <small className="text-[11.5px] font-extrabold" style={{ color: k.color }}>{k.label} · {day(it.at)}</small>
        <b className={`mt-0.5 block text-[14.5px] font-bold leading-snug text-gray-900 ${it.locked ? "select-none blur-[5px]" : ""}`}>{it.title}</b>
        {it.sub && !it.locked && <small className="mt-0.5 block truncate text-[12.5px] text-gray-500">{it.sub}</small>}
      </span>
      {it.locked ? (
    <span className="flex-none rounded bg-gray-100 px-2 py-1 text-[11.5px] font-extrabold text-gray-500">이용권</span>
      ) : it.kind === "save" ? (
        <span className="flex-none text-[12px] font-bold text-gray-400">{open ? "접기" : "펼치기"}</span>
      ) : (
        <span className="flex-none text-gray-300">›</span>
      )}
    </div>
  );
  const box = "block w-full rounded bg-white p-4 text-left ring-1 ring-black/10 hover:ring-black/15";
  if (it.locked) return <button onClick={onLocked} className={box}>{head}</button>;
  if (it.kind === "save")
    return (
      <div className={box}>
        <button onClick={() => setOpen(!open)} className="w-full text-left">{head}</button>
        {open && (
          <div className="mt-3 border-t border-gray-100 pt-3 text-[14px] leading-relaxed text-gray-700">
            <Rich text={it.body} />
            <div className="mt-3 flex gap-3 text-[12.5px] font-bold">
              {it.link && <Link to={it.link} className="text-sm-navy underline-offset-2 hover:underline">그 대화 열기 ›</Link>}
              <button onClick={() => onDelete(it.id)} className="text-gray-400 hover:text-red-500">지우기</button>
            </div>
          </div>
        )}
      </div>
    );
  return <Link to={it.link || "/my"} className={box}>{head}</Link>;
}

export default function MyHome() {
  const { user, loading } = useAuth();
  const [feed, setFeed] = useState(null); // { items, open_all, free_days }
  const [plan, setPlan] = useState(null); // 이번 달 할 일 (물꼬 서버 month_plan)
  const [filter, setFilter] = useState("all");
  const [buy, setBuy] = useState(false);

  const load = () =>
    supabase.rpc("home_feed").then(({ data, error }) => setFeed(error ? { items: [], open_all: false, error: true } : data));
  useEffect(() => {
    if (!user) return;
    track("myhome_view");
    load();
    supabase.functions.invoke("agent", { body: { action: "month_plan" } }).then(({ data }) => setPlan(data ?? null));
  }, [user]);

  const items = useMemo(() => {
    const all = feed?.items ?? [];
    if (filter === "all") return all;
    const kinds = IN_FILTER[filter] ?? [filter];
    return all.filter((x) => kinds.includes(x.kind));
  }, [feed, filter]);
  const lockedN = (feed?.items ?? []).filter((x) => x.locked).length;

  // 달마다 묶기
  const groups = useMemo(() => {
    const g = [];
    for (const it of items) {
      const m = monthOf(it.at);
      if (!g.length || g[g.length - 1].m !== m) g.push({ m, list: [] });
      g[g.length - 1].list.push(it);
    }
    return g;
  }, [items]);

  async function remove(id) {
    await supabase.from("home_saves").delete().eq("id", id);
    load();
  }

  if (loading) return null;
  if (!user) return <LoginGate title="내 입시 홈" desc="탐구 · 진단 · 면접 질문 · 물꼬 답이 날짜순으로 자동으로 쌓여요." />;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-4 py-7 sm:py-10">
        <h1 className="text-[24px] font-black tracking-tight text-sm-navy">내 입시 홈</h1>
    <p className="mt-1 text-[13.5px] text-gray-500">생수면에서 한 것이 날짜순으로 자동으로 쌓여요 · 물꼬 답은 저장하면 여기로 와요</p>

        <div className="mt-5"><MonthCard p={plan} /></div>

        <div className="-mx-4 mt-5 overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="flex w-max gap-1.5">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded px-3.5 py-1.5 text-[13px] font-bold ${filter === k ? "bg-sm-navy text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!feed?.open_all && lockedN > 0 && (
          <button onClick={() => setBuy(true)} className="mt-4 flex w-full items-center justify-between gap-3 rounded bg-[#FFF7ED] px-4 py-3 text-left">
            <span className="text-[13px] leading-relaxed text-[#9A3412]">
              <b className="font-extrabold">무료는 최근 {feed?.free_days ?? 30}일만 열려요.</b> 그 전 기록 {lockedN}개는 잠겨 있어요 (지워지지 않아요).
            </span>
            <span className="flex-none text-[12.5px] font-extrabold text-sm-orange">전부 열기 ›</span>
          </button>
        )}

        {feed === null ? (
          <p className="mt-10 text-center text-[13px] text-gray-400">불러오는 중…</p>
        ) : !items.length ? (
          <div className="mt-8 rounded bg-white p-6 text-center ring-1 ring-black/10">
            <p className="text-[15px] font-extrabold text-gray-900">아직 쌓인 게 없어요</p>
            <p className="mt-1 text-[13px] text-gray-500">물꼬에게 물어보거나 탐구주제를 진단하면 여기에 자동으로 쌓여요.</p>
            <Link to="/agent" className="mt-4 inline-block rounded bg-sm-navy px-5 py-2.5 text-[13.5px] font-extrabold text-white">물꼬에게 물어보기 ›</Link>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.m} className="mt-6">
              <p className="mb-2 text-[13px] font-extrabold text-gray-500">{g.m}</p>
              <div className="space-y-2">
                {g.list.map((it) => (
                  <Item key={`${it.kind}${it.id}`} it={it} onLocked={() => setBuy({ reason: "myhome" })} onDelete={remove} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <UpgradeModal
        open={Boolean(buy) && !feed?.open_all}
        reason="myhome"
        title="지난 기록까지 전부 열기"
        desc="무료는 최근 30일만 보여요. 1년 이용권이면 지금까지 쌓은 탐구 · 진단 · 면접 기록을 전부 다시 볼 수 있어요."
        onClose={() => setBuy(false)}
      />
    </div>
  );
}