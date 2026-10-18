import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 '흔한가 진단' 묶음 — [꼬리질문] 탭
 *   <TailPanel from to />
 * DB: sql/sm_65_admin_tail_stats.sql (admin_tail_stats)
 * 들어온 사람은 '머문 시간' 기록으로 센다 — StayTracker 에 /tail 을 넣은 뒤부터 쌓인다
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

const won = (v) => `${Number(v ?? 0).toLocaleString()}원`;

export default function TailPanel({ from, to }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState({});
  useEffect(() => {
    setD(null); setErr("");
    supabase.rpc("admin_tail_stats", { p_from: from || null, p_to: to || null }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setD(data);
    });
  }, [from, to]);

  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {err} (sm_65 SQL을 실행했는지 확인해 주세요)</p>;
  if (!d) return <p className="py-16 text-center text-sm text-gray-400">숫자를 불러오는 중…</p>;
  const v = d.visit ?? {}, u = d.use ?? {}, c = d.credits ?? {}, p = d.pay ?? {}, ai = d.ai ?? {};
  const maxU = Math.max(1, ...(d.by_univ ?? []).map((x) => x.n));
  const maxP = Math.max(1, ...(d.by_pattern ?? []).map((x) => x.n));
  const types = Object.entries(d.by_type ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">들어오고 · 연습하고</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="들어온 사람" value={`${n(v.visitors)}명`} sub={`회원 ${n(v.members)} · 평균 ${t(v.avg_sec)} 머묾`} />
          <Tile label="연습한 사람" value={`${n(u.users)}명`} sub={`들어온 회원 중 ${pct(u.users, v.members)}% · 전체 누적 ${n(d.all?.users)}명`} color="#FD1673" />
          <Tile label="연습한 질문" value={`${n(u.sessions)}개`} sub={`1인당 ${u.users ? (u.sessions / u.users).toFixed(1) : 0}개 · 누적 ${n(d.all?.sessions)}개`} />
          <Tile label="만든 꼬리질문" value={`${n(u.tails)}개`} sub={`질문 1개당 평균 ${u.avg_tails ?? 0}개`} color="#EA580C" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="끝까지 파고든 연습" value={`${n(u.deep)}개`} sub={`꼬리 3개 이상 이어서 답함 · ${pct(u.deep, u.sessions)}%`} />
          <Tile label="첫 꼬리에서 멈춤" value={`${n(u.one)}개`} sub={`꼬리 1개만 받고 그만 · ${pct(u.one, u.sessions)}%`} />
          <Tile label="무료 5개 다 쓴 사람" value={`${n(c.free_done)}명`} sub={`무료를 써 본 사람 ${n(c.free_people)}명 중 ${pct(c.free_done, c.free_people)}% (전체 기간)`} color="#FD1673" />
          <Tile label="AI 비용" value={`$${Number(ai.usd ?? 0).toFixed(2)}`} sub={`호출 ${n(ai.calls)}번 · 실패 ${n(ai.fail)}번`} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">결제</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="승인 매출" value={won(p.revenue)} sub={`승인 ${n(p.approved)}건 · 입금 대기 ${n(p.pending)}건`} color="#EA580C" />
          <Tile label="결제 전환" value={`${pct(p.approved, c.free_done)}%`} sub="무료 5개 다 쓴 사람 중 결제한 비율 (대략)" />
          <Tile label="10개 · 30개 · 50개" value={`${n(p.by_qty?.["10"])} · ${n(p.by_qty?.["30"])} · ${n(p.by_qty?.["50"])}`} sub="승인된 주문 수" />
          <Tile label="안 쓰고 남은 개수" value={`${n(c.balance_left)}개`} sub="산 사람들이 아직 안 쓴 꼬리질문 합계" />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">날짜별</h2>
        <Bars rows={d.daily} keys={[{ k: "visitors", l: "들어온 사람", c: "#CBD5E1" }, { k: "sessions", l: "연습한 질문", c: "#FD1673" }, { k: "tails", l: "꼬리질문", c: "#EA580C" }]} />
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-[15px] font-extrabold text-sm-navy">많이 연습한 대학</h2>
          {(d.by_univ ?? []).length === 0 ? <p className="text-[13px] text-gray-400">아직 없어요</p> : (d.by_univ ?? []).map((x) => (
            <div key={x.k} className="mb-2">
              <div className="flex justify-between text-[12.5px]"><span className="font-bold text-gray-800">{x.k}</span><span className="text-gray-500">{x.n}개 · {x.users}명</span></div>
              <div className="mt-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${(x.n / maxU) * 100}%`, background: "#FD1673" }} /></div>
            </div>
          ))}
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-[15px] font-extrabold text-sm-navy">질문 종류</h2>
          {types.length === 0 ? <p className="text-[13px] text-gray-400">아직 없어요</p> : types.map(([k, v2]) => (
            <div key={k} className="flex justify-between border-b border-gray-100 py-1.5 text-[13px]"><span className="text-gray-700">{k}</span><b>{v2}개 · {pct(v2, u.sessions)}%</b></div>
          ))}
          <p className="mt-2 text-[11.5px] text-gray-400">생기부 질문 · 지원동기가 많으면 예상질문 · 지원동기 흔한가에서 넘어온 거예요</p>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-[15px] font-extrabold text-sm-navy">나간 꼬리 패턴</h2>
          {(d.by_pattern ?? []).length === 0 ? <p className="text-[13px] text-gray-400">아직 없어요</p> : (d.by_pattern ?? []).map((x) => (
            <div key={x.k} className="mb-2">
              <div className="flex justify-between text-[12.5px]"><span className="font-bold text-gray-800">{x.k}</span><span className="text-gray-500">{x.n}개</span></div>
              <div className="mt-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${(x.n / maxP) * 100}%`, background: "#EA580C" }} /></div>
            </div>
          ))}
        </section>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-lg font-extrabold text-sm-navy">최근 연습</h2>
        <p className="mb-3 text-[12.5px] text-gray-500">줄을 누르면 학생 답변과 꼬리질문이 순서대로 보여요</p>
        {(d.recent ?? []).length === 0 && <p className="py-6 text-center text-[13px] text-gray-400">이 기간에 연습한 학생이 없어요</p>}
        <div className="flex flex-col gap-2">
          {(d.recent ?? []).map((r) => {
            const on = !!open[r.id];
            return (
              <div key={r.id} className="rounded-xl border border-gray-200">
                <button onClick={() => setOpen((o) => ({ ...o, [r.id]: !on }))} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-[13px]">
                  <span className="text-gray-500">{new Date(r.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <b>{r.nick}</b>
                  <span>{r.univ}{r.department ? ` · ${r.department}` : ""}</span>
                  <span className="text-gray-500">{r.main_type}</span>
                  <span className="font-bold" style={{ color: "#FD1673" }}>꼬리 {r.tails}개</span>
                  <span className="min-w-0 flex-1 truncate text-gray-700">{r.main_q}</span>
                  <span className="text-[12px] font-bold text-gray-400">{on ? "접기 ▲" : "펼치기 ▼"}</span>
                </button>
                {on && (
                  <div className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 text-[13px] leading-relaxed">
                    <p><b className="text-gray-500">메인</b>　{r.main_q}</p>
                    {(r.turns ?? []).map((x, i) => (x.q
                      ? <p key={i} className="rounded-lg bg-[#FFF0F5] px-3 py-2"><b style={{ color: "#FD1673" }}>꼬리 · {x.pattern}</b>　{x.q}</p>
                      : <p key={i} className="rounded-lg bg-[#F4F5F7] px-3 py-2"><b className="text-gray-500">학생</b>　{x.a}</p>))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}