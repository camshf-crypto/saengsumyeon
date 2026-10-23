import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 '공부' 묶음 — 전국 공부법 도감 이용 숫자 (전과목 단어장은 2026-10 에 없앰)
 *   <StudyPanel which="study" from to />  공부법 도감
 * DB: sql/sm_55_admin_study_cards.sql (admin_study_cards_stats)
 * 들어온 사람은 '머문 시간' 기록으로 센다 — StayTracker 에 /study 를 넣은 뒤부터 쌓인다
 */

const n = (v) => Number(v ?? 0).toLocaleString();
const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);
function t(sec) {
  const s = Math.round(Number(sec ?? 0));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  return `${m}분${s % 60 ? ` ${s % 60}초` : ""}`;
}
const EXAM = { school: "내신용", mock: "모의고사용", both: "내신·모의", "-": "미입력" };

function Tile({ label, value, sub, color }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1 text-[20px] font-extrabold" style={{ color: color ?? "#18224F" }}>{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{sub}</p>}
    </div>
  );
}
const th = "whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-[12px] font-bold text-gray-500";
const td = "whitespace-nowrap border-b border-gray-100 px-3 py-2 text-[13px] text-gray-800";

/* 날짜별 막대 — 가장 큰 값 기준으로 높이를 맞춘다 */
function Bars({ rows, keys }) {
  if (!rows?.length) return <p className="py-8 text-center text-[13px] text-gray-400">이 기간에는 기록이 없어요.</p>;
  const max = Math.max(1, ...rows.flatMap((r) => keys.map((k) => Number(r[k.k] ?? 0))));
  return (
    <div>
      <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1">
        {rows.map((r) => (
          <div key={r.day} className="flex min-w-[28px] flex-1 flex-col items-center">
            <div className="flex h-32 w-full items-end justify-center gap-[2px]">
              {keys.map((k) => (
                <div key={k.k} title={`${r.day} ${k.l} ${r[k.k]}`} className="w-2.5 rounded-t" style={{ height: `${(Number(r[k.k] ?? 0) / max) * 100}%`, background: k.c, minHeight: Number(r[k.k]) ? 3 : 0 }} />
              ))}
            </div>
            <span className="mt-1 text-[10px] text-gray-400">{String(r.day).slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-[12px] text-gray-500">
        {keys.map((k) => <span key={k.k} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: k.c }} />{k.l}</span>)}
      </div>
    </div>
  );
}

export default function StudyPanel({ which, from, to }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setD(null);
    setErr("");
    supabase.rpc("admin_study_cards_stats", { p_from: from || null, p_to: to || null }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setD(data);
    });
  }, [from, to]);

  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {err}</p>;
  if (!d) return <p className="py-16 text-center text-sm text-gray-400">숫자를 불러오는 중…</p>;
  return <Study s={d.study} from={from} to={to} />;
}

/* ━━━━━━━━━━ 전국 공부법 도감 ━━━━━━━━━━ */
function Study({ s, from, to }) {
  const v = s.visit ?? {}, p = s.posts ?? {}, vf = s.verify ?? {}, rw = s.reward ?? {};
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">들어오고 · 쓰고</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="들어온 사람" value={`${n(v.visitors)}명`} sub={`회원 ${n(v.members)} · 평균 ${t(v.avg_sec)} 머묾`} />
          <Tile label="공부법 올라옴" value={`${n(p.total)}개`} sub={`쓴 사람 ${n(p.authors)}명 · 전체 누적 ${n(p.total_all)}개`} color="#EA580C" />
          <Tile label="쓴 비율" value={`${pct(p.authors, v.members)}%`} sub="들어온 회원 중 공부법을 쓴 사람" />
          <Tile label="1~2등급 공부법" value={`${n(p.top)}개`} sub={`인증 ${n(p.verified)}개 · 숨김 ${n(p.hidden)}개`} color="#FD1673" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">모의고사 인증 · 다이소 쿠폰</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="인증 요청" value={`${n(vf.total)}건`} sub={`인증 ${n(vf.approved)} · 확인 중 ${n(vf.pending)} · 반려 ${n(vf.rejected)}`} />
          <Tile label="인증한 사람" value={`${n(vf.people)}명`} sub={`요청 대비 ${pct(vf.approved, vf.total)}% 통과`} />
          <Tile label="쿠폰 보낼 차례" value={`${n(rw.approved)}명`} sub={`확인할 것 ${n(rw.pending)} · 반려 ${n(rw.rejected)}`} color="#FD1673" />
          <Tile label="쿠폰 보냄" value={`${n(rw.sent)}명`} sub={`남은 자리 ${n(rw.left)} · ${n(Number(rw.sent ?? 0) * 1000)}원 썼어요`} />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 p-5">
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">날짜별</h2>
        <Bars rows={s.daily} keys={[{ k: "visitors", l: "들어온 사람", c: "#18224F" }, { k: "posts", l: "공부법", c: "#EA580C" }, { k: "verifies", l: "인증 요청", c: "#FD1673" }]} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 p-5">
          <h3 className="mb-2 text-[15px] font-extrabold text-sm-navy">과목별</h3>
          {(s.by_subject ?? []).length === 0 ? <p className="text-[13px] text-gray-400">아직 없어요</p> :
            s.by_subject.map((x) => (
              <div key={x.k} className="mb-1.5 flex items-center gap-2 text-[13px]">
                <span className="w-16 flex-none text-gray-700">{x.k}</span>
                <div className="h-2.5 flex-1 rounded bg-gray-100"><div className="h-full rounded bg-sm-orange" style={{ width: `${pct(x.n, p.total)}%` }} /></div>
                <b className="w-8 text-right">{x.n}</b>
              </div>
            ))}
        </div>
        <div className="rounded-2xl border border-gray-200 p-5">
          <h3 className="mb-2 text-[15px] font-extrabold text-sm-navy">학년</h3>
          {Object.entries(s.by_year ?? {}).map(([k, val]) => <p key={k} className="text-[13px] text-gray-700">{k} <b>{val}개</b></p>)}
          {Object.keys(s.by_year ?? {}).length === 0 && <p className="text-[13px] text-gray-400">아직 없어요</p>}
        </div>
        <div className="rounded-2xl border border-gray-200 p-5">
          <h3 className="mb-2 text-[15px] font-extrabold text-sm-navy">시험 종류</h3>
          {Object.entries(s.by_exam ?? {}).map(([k, val]) => <p key={k} className="text-[13px] text-gray-700">{EXAM[k] ?? k} <b>{val}개</b></p>)}
          {Object.keys(s.by_exam ?? {}).length === 0 && <p className="text-[13px] text-gray-400">아직 없어요</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 p-5">
        <h2 className="mb-1 text-lg font-extrabold text-sm-navy">최근 올라온 공부법</h2>
        <p className="mb-3 text-[12.5px] text-gray-500">줄을 누르면 3단계 · 안 맞았던 방법 · 추천 대상까지 전부 보여요</p>
        <RecentPosts from={from} to={to} />
      </section>
    </div>
  );
}

/* 최근 공부법 — 누르면 펼쳐서 전체 내용 */
function RecentPosts({ from, to }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState({});
  useEffect(() => {
    setRows(null); setErr("");
    supabase.rpc("study_admin_recent", { p_from: from || null, p_to: to || null }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setRows(data ?? []);
    });
  }, [from, to]);
  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">불러오지 못했어요 · {err} (sm_57 SQL을 실행했는지 확인해 주세요)</p>;
  if (!rows) return <p className="py-6 text-center text-[13px] text-gray-400">불러오는 중…</p>;
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-gray-400">이 기간에 올라온 공부법이 없어요</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const on = !!open[r.id];
        return (
          <div key={r.id} className={`rounded-xl border ${on ? "border-sm-navy/30" : "border-gray-200"} bg-white`}>
            <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !on }))} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-[13px] text-gray-800">
              <span className="text-gray-500">{new Date(r.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <b>{r.nick}</b>
              <span>{r.school_year} {r.detail || r.subject}</span>
              <span className="font-bold">{r.grade_before && r.grade_before !== r.grade ? `${r.grade_before}등급 → ${r.grade}등급` : `${r.grade}등급`}</span>
              <span className={r.verified ? "font-bold text-[#15803D]" : "text-gray-400"}>{r.verified ? "✓ 모의고사 인증" : "직접 적은 등급"}</span>
              <span className="text-gray-500">{EXAM[r.exam_type ?? "-"]}</span>
              {r.hidden && <span className="font-bold text-red-500">숨김</span>}
              {r.reward && (
                <span className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ background: "#FFF0F5", color: "#FD1673" }}>
                  🎁 {r.reward === "sent" ? "쿠폰 보냄" : r.reward === "rejected" ? "쿠폰 반려" : r.phone ? `${r.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3")}` : "번호 아직"}
                </span>
              )}
              <span className="ml-auto text-[12px] font-bold text-gray-400">{on ? "접기 ▲" : "펼치기 ▼"}</span>
            </button>
            {on && (
              <div className="border-t border-gray-100 px-4 py-3 text-[13px] leading-relaxed text-gray-800">
                <p><b className="text-gray-500">교재 · 강의</b>　{r.materials || "-"}</p>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {(r.steps ?? []).map((st, i) => (
                    <li key={i} className="flex gap-2"><span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-sm-navy text-[11px] font-bold text-white">{i + 1}</span><span className="whitespace-pre-wrap">{st}</span></li>
                  ))}
                </ol>
                {r.dropped && <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5"><b className="text-red-600">안 맞았던 방법</b>　{r.dropped}</p>}
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-gray-600">
                  {r.fit?.length > 0 && <span><b className="text-gray-500">추천 대상</b> {r.fit.join(" · ")}</span>}
                  {r.hours != null && <span><b className="text-gray-500">하루</b> {r.hours}시간</span>}
                  {r.note && <span><b className="text-gray-500">오른 시기</b> {r.note}</span>}
                  {r.region && <span><b className="text-gray-500">지역</b> {r.region}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}