import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 [물꼬 · 면접] 탭 — 물꼬 입시 AI · 수시 면접 준비 · 학습 플랜 숫자
 *   <AgentPrepPanel from to />
 * DB: sql/sm_95_admin_agent_prep_stats.sql (admin_agent_prep_stats) — 관리자 계정은 숫자에서 뺀다
 * '들어온 학생'은 화면 방문 기록(prep_view · agent_view)으로 센다 — 이 기록을 넣은 화면을 배포한 날부터 쌓인다
 * 결제 전환 = 처음 써 본 뒤에 결제가 승인된 학생
 */

const n = (v) => Number(v ?? 0).toLocaleString();
const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);
const won = (v) => `${Number(v ?? 0).toLocaleString()}원`;
const PRODUCT = { interview: "기출 + 생기부 예상질문", agent30: "한 달 이용권", agent180: "6개월 이용권", agent365: "1년 이용권" };
const RESULT = { 늘리기: "거의 잡음", 유지: "효과 있음", 한주더: "한 주 더", 교체: "공부법 교체" };

function Tile({ label, value, sub, color }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1 text-[20px] font-extrabold" style={{ color: color ?? "#18224F" }}>{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{sub}</p>}
    </div>
  );
}

/* 전환 깔때기 — 단계마다 명수 · 바로 앞 단계 대비 · 처음 단계 대비 */
function Funnel({ steps }) {
  const list = steps.filter((s) => s.value !== null && s.value !== undefined);
  const top = Math.max(1, ...list.map((s) => Number(s.value)));
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      {list.map((s, i) => {
        const prev = i > 0 ? list[i - 1].value : null;
        return (
          <div key={s.label} className="mb-3 last:mb-0">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-bold text-gray-800">{s.label}</span>
              <span className="text-gray-500">
                <b className="text-[15px] text-sm-navy">{n(s.value)}명</b>
                {prev !== null && <em className="ml-2 not-italic text-[12px] font-bold text-sm-orange">앞 단계의 {pct(s.value, prev)}%</em>}
              </span>
            </div>
            <div className="mt-1 h-3 rounded-full bg-gray-100">
              <div className="h-3 rounded-full" style={{ width: `${Math.max(2, (Number(s.value) / top) * 100)}%`, background: s.color ?? "#18224F" }} />
            </div>
            {s.sub && <p className="mt-0.5 text-[11.5px] text-gray-400">{s.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* 날짜별 막대 */
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

function Rank({ title, rows, unit, color }) {
  const max = Math.max(1, ...(rows ?? []).map((x) => Number(x.n)));
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h3 className="mb-3 text-[15px] font-extrabold text-sm-navy">{title}</h3>
      {!(rows ?? []).length ? <p className="text-[13px] text-gray-400">아직 없어요</p> : rows.map((x) => (
        <div key={x.k} className="mb-2">
          <div className="flex justify-between text-[12.5px]"><span className="font-bold text-gray-800">{x.k}</span><span className="text-gray-500">{n(x.n)}{unit} · {n(x.users)}명</span></div>
          <div className="mt-1 h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${(Number(x.n) / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </section>
  );
}

export default function AgentPrepPanel({ from, to }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setD(null); setErr("");
    supabase.rpc("admin_agent_prep_stats", { p_from: from || null, p_to: to || null }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setD(data);
    });
  }, [from, to]);

  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {err} (sm_95 SQL을 실행했는지 확인해 주세요)</p>;
  if (!d) return <p className="py-16 text-center text-sm text-gray-400">숫자를 불러오는 중…</p>;
  const a = d.agent ?? {}, p = d.prep ?? {}, pl = d.plan ?? {};
  const st = p.steps ?? {};
  const products = Object.entries(p.paid_by_product ?? {});
  const results = Object.entries(pl.results ?? {});

  return (
    <div className="flex flex-col gap-8">
      {/* ───── 수시 면접 준비 ───── */}
      <section>
        <h2 className="mb-1 text-lg font-extrabold text-sm-navy">수시 면접 준비 · 결제 전환</h2>
        <p className="mb-3 text-[12.5px] text-gray-500">이 기간에 AI 피드백을 받은 학생 기준 · 결제 = 처음 써 본 뒤 승인된 결제 (기출만 12,900원 · 기출+예상질문 24,000원)</p>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Funnel steps={[
            { label: "들어온 학생", value: p.visitors, color: "#CBD5E1", sub: p.visitors === null ? "" : "화면 방문 기록 기준 (배포한 날부터 쌓여요)" },
            { label: "목표 학교 넣음", value: p.target_users, color: "#94A3B8" },
            { label: "실제로 사용 (AI 피드백 1번 이상)", value: p.users, color: "#18224F", sub: `처음 써 본 학생 ${n(p.new_users)}명` },
            { label: "무료 다 씀", value: p.free_done, color: "#FD1673", sub: "무료 3문제 + 친구 1명당 5문제를 다 쓴 학생" },
            { label: "결제", value: p.paid_users, color: "#EA580C", sub: `사용한 학생의 ${pct(p.paid_users, p.users)}% · 무료 다 쓴 학생의 ${pct(p.paid_users, p.free_done)}%` },
          ]} />
          <div className="grid grid-cols-2 content-start gap-3">
            <Tile label="결제 전환율" value={`${pct(p.paid_users, p.users)}%`} sub={`사용 ${n(p.users)}명 중 ${n(p.paid_users)}명 · 누적 ${n(p.ever_paid)}/${n(p.ever_users)}명`} color="#EA580C" />
            <Tile label="매출 (이 기간)" value={won(p.revenue)} sub="사용한 뒤 결제한 승인 금액" color="#EA580C" />
            <Tile label="친구 초대로 넘어감" value={`${n(p.invited)}명`} sub="결제 대신 친구를 데려온 학생" />
            <Tile label="AI 피드백" value={`${n(p.uses)}문제`} sub={`1인당 ${p.users ? (p.uses / p.users).toFixed(1) : 0}문제 · 예상질문 ${n(p.uses_interview)}`} />
            {products.map(([k, v]) => <Tile key={k} label={PRODUCT[k] ?? k} value={`${n(v)}명`} sub="결제한 상품" />)}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="1차 피드백까지" value={`${n(st.first)}문제`} />
          <Tile label="2차(최종) 피드백까지" value={`${n(st.second)}문제`} sub={`1차 중 ${pct(st.second, st.first)}%`} />
          <Tile label="꼬리질문까지" value={`${n(st.tail)}문제`} sub={`1차 중 ${pct(st.tail, st.first)}%`} color="#FD1673" />
          <Tile label="AI 비용" value={`$${Number(p.ai?.usd ?? 0).toFixed(2)}`} sub={`호출 ${n(p.ai?.calls)}번 · 실패 ${n(p.ai?.fail)}번`} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 text-[15px] font-extrabold text-sm-navy">날짜별</h3>
            <Bars rows={p.daily} keys={[{ k: "users", l: "사용한 학생", c: "#18224F" }, { k: "uses", l: "AI 피드백", c: "#FD1673" }]} />
          </section>
          <Rank title="많이 연습한 학교" rows={p.by_univ} unit="문제" color="#FD1673" />
        </div>
      </section>

      {/* ───── 물꼬 입시 AI ───── */}
      <section className="border-t border-gray-200 pt-6">
        <h2 className="mb-1 text-lg font-extrabold text-sm-navy">물꼬 입시 AI</h2>
        <p className="mb-3 text-[12.5px] text-gray-500">학생이 보낸 질문 기준 · 결제 = 처음 물어본 뒤 승인된 이용권</p>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Funnel steps={[
            { label: "들어온 학생", value: a.visitors, color: "#CBD5E1", sub: a.visitors === null ? "" : "화면 방문 기록 기준 (배포한 날부터 쌓여요)" },
            { label: "질문한 학생", value: a.users, color: "#18224F", sub: `처음 써 본 학생 ${n(a.new_users)}명` },
            { label: "주간 무료 사용량 다 씀", value: a.full_users, color: "#FD1673", sub: "한 주에 무료 한도를 넘게 쓴 학생 (친구 보너스는 빼고 대략)" },
            { label: "이용권 결제", value: a.paid_users, color: "#EA580C", sub: `질문한 학생의 ${pct(a.paid_users, a.users)}%` },
          ]} />
          <div className="grid grid-cols-2 content-start gap-3">
            <Tile label="질문 수" value={`${n(a.questions)}개`} sub={`1인당 ${a.users ? (a.questions / a.users).toFixed(1) : 0}개 · 새 대화 ${n(a.chats)}개`} color="#FD1673" />
            <Tile label="이용권 전환 (누적)" value={`${pct(a.paid_total, a.ever_users)}%`} sub={`써 본 ${n(a.ever_users)}명 중 ${n(a.paid_total)}명`} color="#EA580C" />
            <Tile label="AI 비용" value={`$${Number(a.ai?.usd ?? 0).toFixed(2)}`} sub={`호출 ${n(a.ai?.calls)}번 · 실패 ${n(a.ai?.fail)}번`} />
            <Tile label="학생 1명당 비용" value={`$${a.users ? (Number(a.ai?.usd ?? 0) / a.users).toFixed(3) : "0"}`} sub="이 기간 AI 비용 ÷ 질문한 학생" />
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 text-[15px] font-extrabold text-sm-navy">날짜별</h3>
            <Bars rows={a.daily} keys={[{ k: "users", l: "질문한 학생", c: "#18224F" }, { k: "questions", l: "질문", c: "#FD1673" }]} />
          </section>
          <Rank title="많이 쓴 기능" rows={a.features} unit="개" color="#18224F" />
        </div>
        <p className="mt-2 text-[11.5px] text-gray-400">기능은 학생이 쓴 말로 나눠요 (예: '공부법', '루틴', '흔한가', '탐구', '입결'). 여러 기능이 섞인 질문은 먼저 맞는 하나로만 세요.</p>
      </section>

      {/* ───── 학습 플랜 · 공부법 효과 시험 ───── */}
      <section className="border-t border-gray-200 pt-6">
        <h2 className="mb-3 text-lg font-extrabold text-sm-navy">학습 플랜 · 공부법 효과 시험</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="다이어리에 루틴 넣은 학생" value={`${n(pl.routine_users)}명`} />
          <Tile label="루틴 체크한 학생" value={`${n(pl.check_users)}명`} sub={`루틴 넣은 학생 중 ${pct(pl.check_users, pl.routine_users)}%`} />
          <Tile label="입시 플랜 만든 수" value={`${n(pl.plans)}개`} />
          <Tile label="시험 만들고 → 시작 → 다시" value={`${n(pl.tests_made)} → ${n(pl.tests_pre)} → ${n(pl.tests_post)}`} sub={`다시 시험 평균 ${pl.avg_gain ?? 0}개 더 맞힘`} color="#EA580C" />
        </div>
        {results.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {results.map(([k, v]) => (
              <span key={k} className="rounded-full bg-white px-3 py-1.5 text-[12.5px] font-bold text-gray-700 ring-1 ring-gray-200">{RESULT[k] ?? k} <b className="text-sm-navy">{n(v)}</b></span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}