import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

function dayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const RANGES = [
  { label: "오늘", from: () => dayStr(0), to: () => dayStr(0) },
  { label: "7일", from: () => dayStr(-6), to: () => dayStr(0) },
  { label: "30일", from: () => dayStr(-29), to: () => dayStr(0) },
  { label: "전체", from: () => "", to: () => "" },
];

const PARTS = ["소재", "대상", "조건", "방식"]; // 항목별 점수 순서
const FOCUS_LABEL = { career: "진로 연결", subject: "과목 깊이 파기" }; // 학생이 고른 방향
const MAX = { 소재: 40, 대상: 20, 조건: 20, 방식: 20 };

/* 항목별 점수 합계 — 저장된 지수와 다르면 채점 오류를 의심할 수 있다 */
function sumOf(b) {
  if (!b) return null;
  return PARTS.reduce((acc, k) => acc + (Number(b[k]) || 0), 0);
}

/*
 * Supabase는 한 번에 최대 1,000줄까지만 돌려준다.
 * 목록·사용자별 이용은 1,000줄씩 나눠서 끝까지 이어 받는다 (최대 10,000줄)
 */
async function fetchAllRows(args, fn = "admin_topic_queries") {
  const CHUNK = 1000;
  let all = [];
  for (let from = 0; from < 10000; from += CHUNK) {
    const { data, error } = await supabase
      .rpc(fn, args)
      .range(from, from + CHUNK - 1);
    if (error) return { data: null, error };
    all = all.concat(data ?? []);
    if (!data || data.length < CHUNK) break;
  }
  return { data: all, error: null };
}

const PAGE_SIZE = 100; // 목록 한 페이지에 보여줄 줄 수

/* 페이지 번호 — 10개씩 묶어서 1 2 3 … 10, 다음 묶음은 › */
function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null;
  const start = Math.floor((page - 1) / 10) * 10 + 1;
  const end = Math.min(start + 9, pages);
  const nums = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const btn = "min-w-[34px] rounded-md px-2 py-1.5 text-[13px] font-bold transition";
  const off = "text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
      <button className={`${btn} ${off}`} disabled={page === 1} onClick={() => onChange(1)}>«</button>
      <button className={`${btn} ${off}`} disabled={start === 1} onClick={() => onChange(start - 1)}>‹</button>
      {nums.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`${btn} ${n === page ? "bg-sm-navy text-white" : off}`}
        >
          {n}
        </button>
      ))}
      <button className={`${btn} ${off}`} disabled={end === pages} onClick={() => onChange(end + 1)}>›</button>
      <button className={`${btn} ${off}`} disabled={page === pages} onClick={() => onChange(pages)}>»</button>
    </div>
  );
}

/* 상위 항목을 막대로 */
function RankList({ title, rows, total }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <p className="text-[13px] font-bold text-sm-navy">{title}</p>
      <ul className="mt-3.5 space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2.5 text-[13px]">
            <span className="w-24 shrink-0 truncate text-gray-600">{r.key || "-"}</span>
            <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-gray-100">
              <span
                className="block h-full rounded-full bg-sm-orange"
                style={{ width: `${(r.n / max) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right">
              <b className="text-sm-navy">{r.n}</b>
              {total ? (
                <em className="ml-1 not-italic text-[11px] text-gray-400">
                  {Math.round((r.n / total) * 100)}%
                </em>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 날짜·시간 짧게 */
const shortTime = (t) =>
  new Date(t).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/*
 * 탐구보고서 단계별 현황 — 어느 단계에서 나가는지, PDF를 누른 사람 중 몇 명이 결제하는지
 * 윗줄은 탐구 건수, 아랫줄은 사람 수 (관리자 계정은 빼고 센다)
 */
/* 초 → "6분 20초" */
function dur(sec) {
  const v = Math.round(Number(sec ?? 0));
  if (v < 60) return `${v}초`;
  const m = Math.floor(v / 60), s = v % 60;
  if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

function InquiryPanel({ f }) {
  if (!f) return null;
  if (f.error)
    return (
      <div className="mt-10">
        <h2 className="text-lg font-extrabold text-sm-navy">탐구보고서 단계별 현황</h2>
        <p className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {f.error}</p>
      </div>
    );
  const n = (v) => Number(v ?? 0);
  const pct = (a, b) => (n(b) ? Math.round((n(a) / n(b)) * 100) : null);

  const flow = [
    { label: "탐구 시작", v: f.start, sub: "탐구팩까지 만든 탐구" },
    { label: "3단계 들어감", v: f.analyze, prev: f.start, sub: "2단계(탐구 준비)를 마침" },
    { label: "AI 분석 받음", v: f.ai, prev: f.analyze, sub: "3단계에서 분석 버튼을 누름" },
    { label: "4단계 들어감", v: f.report, prev: f.ai, sub: "보고서 내용까지 만듦" },
    { label: "디자인 고름", v: f.design, prev: f.report, sub: "보고서 디자인을 고름" },
  ];
  const pay = [
    { label: "PDF 누름", v: f.pdf_click, prev: f.design, sub: "PDF 저장 → 결제 창을 본 사람" },
    { label: "입금했어요", v: f.order, prev: f.pdf_click, sub: "주문을 접수한 사람" },
    { label: "입금 승인", v: f.approved, prev: f.order, sub: "관리자가 승인한 사람" },
    { label: "PDF 저장", v: f.pdf_saved, prev: f.approved, sub: "실제로 PDF를 저장한 사람" },
  ];

  // 가장 많이 빠지는 단계 — 두 줄 전체에서 하나
  const all = [...flow, ...pay];
  let worst = null;
  let worstRate = 101;
  all.forEach((s) => {
    const r = s.prev == null ? null : pct(s.v, s.prev);
    if (r != null && r < worstRate) {
      worstRate = r;
      worst = s.label;
    }
  });

  const Card = ({ s, i }) => {
    const r = s.prev == null ? null : pct(s.v, s.prev);
    const bad = s.label === worst;
    return (
      <div className={`rounded-xl border p-4 ${bad ? "border-red-300 bg-red-50/50" : "border-gray-200"}`}>
        <p className="text-[12px] text-gray-500">
          {i}. {s.label}
        </p>
        <p className="mt-1.5 text-lg font-extrabold text-sm-navy">
          {n(s.v)}
          {r != null && (
            <span className={`ml-1.5 text-[12.5px] font-bold ${bad ? "text-red-500" : "text-sm-orange"}`}>{r}%</span>
          )}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{s.sub}</p>
        {bad && <p className="mt-1 text-[11.5px] font-bold text-red-500">가장 많이 빠지는 단계</p>}
      </div>
    );
  };

  const overall = pct(f.approved, f.start);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-extrabold text-sm-navy">탐구보고서 단계별 현황</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">
        어느 단계에서 나가는지, PDF를 누른 사람 중 몇 명이 결제하는지 봅니다. % 는 바로 앞 단계 대비예요. 관리자 계정은 빼고 셉니다.
      </p>

      <p className="mt-4 text-[12.5px] font-bold text-gray-500">탐구 진행 (탐구 건수)</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {flow.map((s, i) => (
          <Card key={s.label} s={s} i={i + 1} />
        ))}
      </div>

      <p className="mt-4 text-[12.5px] font-bold text-gray-500">PDF · 결제 (사람 수)</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {pay.map((s, i) => (
          <Card key={s.label} s={s} i={flow.length + i + 1} />
        ))}
      </div>

      {/* 단계별 머문 시간 — 탐구 1건이 그 화면에 실제로 머문 시간(다른 탭·5분 이상 가만히 있던 시간은 뺌) */}
      <p className="mt-4 text-[12.5px] font-bold text-gray-500">단계별 머문 시간 (탐구 1건당 · 보통은 중간값)</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["prepare", "2 탐구 준비"],
          ["result", "3 결과 분석"],
          ["report", "4 보고서 디자인"],
        ].map(([k, l]) => {
          const st = f.stay?.[k];
          return (
            <div key={k} className="rounded-xl border border-gray-200 p-4">
              <p className="text-[12px] text-gray-500">{l}</p>
              <p className="mt-1.5 text-lg font-extrabold text-sm-navy">{st ? `보통 ${dur(st.median)}` : "-"}</p>
              <p className="mt-0.5 text-[11.5px] text-gray-400">{st ? `평균 ${dur(st.avg)} · ${st.n}건` : "아직 기록이 없어요"}</p>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-[12.5px] text-gray-500">
        탐구를 시작한 것 대비 입금 승인까지 <b className="text-sm-navy">{overall == null ? "-" : `${overall}%`}</b>
        <span className="text-gray-400">
          {" "}
          · 결제 대기로 저장된 두 번째 탐구 <b className="text-sm-navy">{n(f.waiting)}건</b>
        </span>
      </p>
    </div>
  );
}

/* 사용자별 이용 — 한 사람이 몇 번, 며칠에 걸쳐 진단했는지 */
function UsagePanel({ usage, onPick }) {
  if (!usage) return null;

  const people = usage.length;
  const total = usage.reduce((a, u) => a + u.total, 0);
  const members = usage.filter((u) => u.is_member).length;
  const returning = usage.filter((u) => u.days >= 2).length;
  const heavy = usage.filter((u) => u.total >= 3).length;
  const pct = (n) => (people ? Math.round((n / people) * 100) : 0);

  // 진단 횟수 분포
  const dist = [
    { key: "1회", n: usage.filter((u) => u.total === 1).length },
    { key: "2회", n: usage.filter((u) => u.total === 2).length },
    { key: "3회", n: usage.filter((u) => u.total === 3).length },
    { key: "4회 이상", n: usage.filter((u) => u.total >= 4).length },
  ];

  return (
    <div className="mt-10">
      <h2 className="text-lg font-extrabold text-sm-navy">사용자별 이용</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">
        회원은 계정, 비회원은 브라우저 기준으로 묶었어요. 새로 진단한 횟수만 셉니다.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["이용자", `${people}명`, `회원 ${members} · 비회원 ${people - members}`],
          ["1인당 평균 진단", people ? `${(total / people).toFixed(1)}회` : "-", `총 ${total}건`],
          ["재방문자 (2일 이상)", `${returning}명`, `${pct(returning)}%`],
          ["3회 이상 진단", `${heavy}명`, `${pct(heavy)}%`],
        ].map(([l, v, sub]) => (
          <div key={l} className="rounded-xl border border-gray-200 p-5">
            <p className="text-[12.5px] text-gray-500">{l}</p>
            <p className="mt-1.5 text-lg font-extrabold text-sm-navy">{v}</p>
            <p className="mt-0.5 text-[12px] text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_2fr]">
        <RankList title="진단 횟수 분포" rows={dist} total={people} />

        {/* 많이 쓴 사람 */}
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
              <tr>
                <th className="px-4 py-2.5">이용자</th>
                <th className="px-4 py-2.5 text-right">진단</th>
                <th className="px-4 py-2.5 text-right">이용 일수</th>
                <th className="px-4 py-2.5">처음</th>
                <th className="px-4 py-2.5">마지막</th>
              </tr>
            </thead>
            <tbody>
              {usage.slice(0, 20).map((u) => (
                <tr
                  key={u.user_key}
                  onClick={() => u.is_member && onPick(u.email)}
                  className={`border-b border-gray-100 last:border-0 ${
                    u.is_member ? "cursor-pointer hover:bg-orange-50/40" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {u.is_member ? (
                      <>
                        <span className="font-bold text-sm-navy">{u.name ?? "회원"}</span>
                        <span className="ml-1.5 text-[12px] text-gray-400">{u.email}</span>
                      </>
                    ) : (
                      <span className="text-gray-500">
                        비회원 <span className="text-[11.5px] text-gray-400">{u.user_key.slice(5, 13)}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-sm-navy">{u.total}</td>
                  <td className={`px-4 py-2.5 text-right ${u.days >= 2 ? "font-bold text-sm-orange" : "text-gray-500"}`}>
                    {u.days}일
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{shortTime(u.first_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{shortTime(u.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.length > 20 && (
            <p className="border-t border-gray-100 px-4 py-2 text-[12px] text-gray-400">
              상위 20명만 표시 · 회원을 누르면 아래 목록에서 그 사람 기록만 보여요
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/*
 * 가입 전환 — 비회원이 결과를 본 뒤 어디서 멈추는지
 * 결과 봄 → 가입 버튼 → 카카오·구글 → 새 회원 로그인 → 가입 마무리
 */
function SignupPanel({ f }) {
  if (!f) return null;
  const n = (v) => Number(v ?? 0);
  const pct = (a, b) => (n(b) ? Math.round((n(a) / n(b)) * 100) : null);

  const gate = f.gate_by ?? {};
  const oauth = f.oauth_by ?? {};

  const steps = [
    { label: "결과를 본 비회원", v: f.result_view, sub: "흐림 처리된 결과 화면이 뜬 브라우저" },
    {
      label: "가입 버튼 클릭",
      v: f.gate_click,
      prev: f.result_view,
      sub: `회원가입 ${n(gate.signup)} · 로그인 ${n(gate.login)} · 한도 화면 ${n(gate.quota)}`,
    },
    {
      label: "카카오·구글 선택",
      v: f.oauth_start,
      prev: f.gate_click,
      sub: `카카오 ${n(oauth.kakao)} · 구글 ${n(oauth.google)}`,
    },
    {
      label: "새 회원 로그인 완료",
      v: f.auth_new,
      prev: f.oauth_start,
      sub: `기존 회원 로그인 ${n(f.auth_existing)}명은 제외`,
    },
    { label: "가입 마무리 완료", v: f.signup_done, prev: f.auth_new, sub: "학년·약관 동의까지 끝낸 회원" },
  ];

  // 가장 많이 빠지는 단계 표시
  let worst = -1;
  let worstRate = 101;
  steps.forEach((s, i) => {
    const r = i ? pct(s.v, s.prev) : null;
    if (r != null && r < worstRate) {
      worstRate = r;
      worst = i;
    }
  });

  const overall = pct(f.signup_done, f.result_view);

  return (
    <div className="mt-10">
      <h2 className="text-lg font-extrabold text-sm-navy">가입 전환</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">
        비회원이 결과를 본 뒤 어느 단계에서 멈추는지 봅니다.
        {f.since && ` 기록 시작: ${new Date(f.since).toLocaleString("ko-KR")}`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {steps.map((s, i) => {
          const r = i ? pct(s.v, s.prev) : null;
          const bad = i === worst;
          return (
            <div
              key={s.label}
              className={`rounded-xl border p-4 ${bad ? "border-red-300 bg-red-50/50" : "border-gray-200"}`}
            >
              <p className="text-[12px] text-gray-500">
                {i + 1}. {s.label}
              </p>
              <p className="mt-1.5 text-lg font-extrabold text-sm-navy">
                {n(s.v)}
                {r != null && (
                  <span className={`ml-1.5 text-[12.5px] font-bold ${bad ? "text-red-500" : "text-sm-orange"}`}>
                    {r}%
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{s.sub}</p>
              {bad && <p className="mt-1 text-[11.5px] font-bold text-red-500">가장 많이 빠지는 단계</p>}
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-[12.5px] text-gray-500">
        결과를 본 비회원 중 <b className="text-sm-navy">{overall == null ? "-" : `${overall}%`}</b>가 가입까지 마쳤어요.
        <span className="text-gray-400"> (% 는 바로 앞 단계 대비)</span>
      </p>
    </div>
  );
}

/* 친구 추천 — 전환 단계 5개 + 추천/비교 그룹 비교 + 많이 데려온 회원 */
function ReferralPanel({ stats }) {
  if (!stats) return null;
  const f = stats.funnel ?? {};
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");

  const steps = [
    ["3회 소진", f.quota_hit, "추천 그룹 + 비교 그룹 회원 수"],
    ["공유 클릭", f.share_click, `3회 소진 대비 ${pct(f.share_click, f.quota_hit)}`],
    ["친구 유입", f.ref_visit, "추천 링크로 들어온 브라우저"],
    ["친구 가입+진단", f.rewarded, `가입 ${f.joined ?? 0}명 중 ${pct(f.rewarded, f.joined)}`],
    ["추가권 사용", f.bonus_used, "받은 +3회를 실제로 쓴 횟수"],
  ];

  const label = { share: "추천 화면 (50%)", control: "예전 화면 (50%)", before: "A/B 전 (전원 추천 화면)" };

  return (
    <div className="mt-10">
      <h2 className="text-lg font-extrabold text-sm-navy">친구 추천</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">
        3회를 다 쓴 회원 중 절반에게만 추천 화면을 보여주고, 나머지 절반과 비교합니다.
      </p>

      {/* 전환 단계 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {steps.map(([l, v, sub], i) => (
          <div key={l} className="rounded-xl border border-gray-200 p-4">
            <p className="text-[12px] text-gray-500">
              {i + 1}. {l}
            </p>
            <p className="mt-1.5 text-lg font-extrabold text-sm-navy">{v ?? 0}</p>
            <p className="mt-0.5 text-[11.5px] text-gray-400">{sub}</p>
          </div>
        ))}
      </div>

      {/* 그룹 비교 */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-2.5">그룹</th>
              <th className="px-4 py-2.5 text-right">3회 소진 회원</th>
              <th className="px-4 py-2.5 text-right">공유 누름</th>
              <th className="px-4 py-2.5 text-right">24시간 뒤 다시 진단</th>
              <th className="px-4 py-2.5 text-right">소진 후 평균 진단</th>
            </tr>
          </thead>
          <tbody>
            {(stats.groups ?? []).map((g) => (
              <tr key={g.variant} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2.5 font-bold text-sm-navy">{label[g.variant] ?? g.variant}</td>
                <td className="px-4 py-2.5 text-right">{g.users}</td>
                <td className="px-4 py-2.5 text-right">
                  {g.variant === "control" ? <span className="text-gray-300">-</span> : `${g.shared} (${pct(g.shared, g.users)})`}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-sm-orange">
                  {g.returned} ({pct(g.returned, g.users)})
                </td>
                <td className="px-4 py-2.5 text-right">{g.avg_after ?? 0}회</td>
              </tr>
            ))}
            {!stats.groups?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  아직 3회를 다 쓴 회원이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 많이 데려온 회원 */}
      {stats.top?.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
              <tr>
                <th className="px-4 py-2.5">추천한 회원</th>
                <th className="px-4 py-2.5">코드</th>
                <th className="px-4 py-2.5 text-right">가입한 친구</th>
                <th className="px-4 py-2.5 text-right">보상 받은 친구</th>
                <th className="px-4 py-2.5 text-right">남은 추가권</th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((t) => (
                <tr key={t.code} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 text-gray-600">{t.email}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-gray-500">{t.code}</td>
                  <td className="px-4 py-2.5 text-right">{t.invited}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-sm-navy">{t.rewarded}</td>
                  <td className="px-4 py-2.5 text-right">{t.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* 줄을 펼쳤을 때 보이는 AI 결과 */
function AiDetail({ r }) {
  const res = r.result ?? {};
  const b = res.breakdown;
  const sum = sumOf(b);
  const mismatch = sum != null && r.score != null && sum !== r.score;

  return (
    <div className="grid gap-5 bg-gray-50 px-6 py-5 lg:grid-cols-[260px_1fr]">
      {/* 항목별 점수 */}
      <div>
        <p className="text-[12px] font-bold text-gray-400">항목별 점수</p>
        {b ? (
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {PARTS.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span className="w-9 text-gray-500">{k}</span>
                <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-gray-200">
                  <span
                    className="block h-full rounded-full bg-sm-orange"
                    style={{ width: `${Math.min(100, ((b[k] ?? 0) / MAX[k]) * 100)}%` }}
                  />
                </span>
                <span className="w-12 text-right">
                  <b className="text-sm-navy">{b[k] ?? "-"}</b>
                  <small className="text-gray-400">/{MAX[k]}</small>
                </span>
              </li>
            ))}
            <li className={`pt-1 text-[12px] font-bold ${mismatch ? "text-red-500" : "text-gray-400"}`}>
              합계 {sum}
              {mismatch && ` — 저장된 지수 ${r.score}와 다름`}
            </li>
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-gray-400">점수 내역 없음</p>
        )}
      </div>

      {/* 이유와 제안 */}
      <div className="space-y-4 text-[13.5px] leading-relaxed">
        <div>
          <p className="text-[12px] font-bold text-gray-400">왜 흔한 주제인지</p>
          <p className="mt-1 text-gray-700">{res.reason || "-"}</p>
        </div>
        {res.fit === "weak" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] font-bold text-red-500">
            AI 판단: 학생이 고른 방향이 이 주제와 잘 맞지 않음 → 반대 방향 &apos;다시 받기&apos; 안내가 뜸
          </p>
        )}
        <div>
          <p className="text-[12px] font-bold text-gray-400">AI 제안 주제</p>
          <p className="mt-1 font-bold text-sm-navy">{res.suggestion?.topic || "-"}</p>
          {res.suggestion?.topic && (
            <p className="mt-0.5 text-[12px] text-gray-400">{res.suggestion.topic.length}자</p>
          )}
        </div>
        <div>
          <p className="text-[12px] font-bold text-gray-400">좁힌 방법</p>
          <p className="mt-1 text-gray-700">{res.suggestion?.how || "-"}</p>
        </div>
        {res.similar?.length > 0 && (
          <div>
            <p className="text-[12px] font-bold text-gray-400">참고한 유사 탐구 (DB)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-500">
              {res.similar.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminTopics() {
  const { user, loading: authLoading } = useAuth();

  const [from, setFrom] = useState(dayStr(-6));
  const [to, setTo] = useState(dayStr(0));
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null); // 사용자별 이용
  const [refStats, setRefStats] = useState(null); // 친구 추천
  const [funnel, setFunnel] = useState(null); // 가입 전환
  const [inqFunnel, setInqFunnel] = useState(null); // 탐구보고서 단계별 현황
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | member | anon
  const [focusOnly, setFocusOnly] = useState("all"); // all | career | subject
  const [weakOnly, setWeakOnly] = useState(false); // 방향이 안 맞는 기록만
  const [open, setOpen] = useState(null); // 펼친 줄의 id
  const [page, setPage] = useState(1); // 목록 페이지
  const listTop = useRef(null); // 페이지를 넘기면 목록 맨 위로
  const [pendingOrders, setPendingOrders] = useState(0); // 입금 확인 대기

  // 입금 확인 대기 건수 — 새 주문이 오면 실시간으로 바뀐다
  useEffect(() => {
    if (authLoading || !user) return;
    const count = () =>
      supabase.rpc("admin_orders").then(({ data }) => setPendingOrders((data ?? []).filter((o) => o.status === "pending").length));
    count();
    const ch = supabase
      .channel("admin-topics-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "pay_orders" }, count)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [authLoading, user]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    const args = { p_from: from || null, p_to: to || null };

    const [list, stat, use, refs, fun, inf] = await Promise.all([
      fetchAllRows(args),
      supabase.rpc("admin_topic_stats", args),
      fetchAllRows(args, "admin_user_usage"),
      supabase.rpc("admin_referral_stats", args),
      supabase.rpc("admin_signup_funnel", args),
      supabase.rpc("admin_inquiry_funnel", args),
    ]);
    setBusy(false);

    if (inf.error) console.warn("inquiry funnel failed", inf.error);
    // 실패해도 칸은 보이게 하고 이유를 적는다 (숨기면 왜 안 보이는지 알 수 없어서)
    setInqFunnel(inf.error ? { error: inf.error.message ?? "불러오지 못했어요" } : inf.data ?? {});

    if (fun.error) console.warn("signup funnel failed", fun.error);
    setFunnel(fun.error ? null : fun.data ?? null);

    if (use.error) console.warn("usage query failed", use.error);
    setUsage(use.error ? null : use.data ?? []);

    if (refs.error) console.warn("referral stats failed", refs.error);
    setRefStats(refs.error ? null : refs.data ?? null);

    if (list.error || stat.error) {
      const e = list.error ?? stat.error;
      console.error("admin query failed", e);
      setErr(
        e.message.includes("권한") ? "이 계정은 어드민이 아닙니다." : "조회에 실패했습니다."
      );
      setRows([]);
      setStats(null);
      return;
    }
    setRows(list.data ?? []);
    setStats(stat.data ?? null);
  }, [from, to]);

  useEffect(() => {
    if (!authLoading && user) load();
  }, [authLoading, user, load]);

  const shown = useMemo(() => {
    let r = rows;
    if (only === "member") r = r.filter((x) => x.is_member);
    if (only === "anon") r = r.filter((x) => !x.is_member);
    if (focusOnly !== "all") r = r.filter((x) => (x.focus ?? "career") === focusOnly);
    if (weakOnly) r = r.filter((x) => x.result?.fit === "weak");

    const k = q.trim().toLowerCase();
    if (!k) return r;
    return r.filter((x) =>
      [x.email, x.name, x.department, x.subject, x.topic, x.result?.suggestion?.topic]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k))
    );
  }, [rows, q, only, focusOnly, weakOnly]);

  // 검색·필터·기간이 바뀌면 1페이지로
  useEffect(() => {
    setPage(1);
    setOpen(null);
  }, [q, only, focusOnly, weakOnly, rows]);

  // 방향 비율 — 기간 안 전체 기록 기준
  const focusRows = useMemo(() => {
    const c = { career: 0, subject: 0 };
    rows.forEach((x) => (c[x.focus === "subject" ? "subject" : "career"] += 1));
    return [
      { key: FOCUS_LABEL.career, n: c.career },
      { key: FOCUS_LABEL.subject, n: c.subject },
    ];
  }, [rows]);

  // 방향별 '안 맞음' 비율 — 판단 기능 배포 후 기록(fit 값이 있는 것)만
  const fitStats = useMemo(() => {
    const t = { career: { n: 0, weak: 0 }, subject: { n: 0, weak: 0 } };
    rows.forEach((x) => {
      const f = x.result?.fit;
      if (f !== "good" && f !== "weak") return;
      const k = x.focus === "subject" ? "subject" : "career";
      t[k].n += 1;
      if (f === "weak") t[k].weak += 1;
    });
    return t;
  }, [rows]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageRows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function goPage(n) {
    setPage(n);
    setOpen(null);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function downloadCsv() {
    const head = [
      "일시", "회원여부", "이메일", "이름", "학과", "학년", "학기", "과목", "방향", "방향 맞음", "탐구주제", "지수",
      "소재", "대상", "조건", "방식", "흔한 이유", "AI 제안 주제", "좁힌 방법",
    ];
    const body = shown.map((r) => {
      const res = r.result ?? {};
      const b = res.breakdown ?? {};
      return [
        new Date(r.created_at).toLocaleString("ko-KR"),
        r.is_member ? "회원" : "비회원",
        r.email ?? "",
        r.name ?? "",
        r.department ?? "",
        r.grade ?? "",
        r.term ?? "",
        r.subject ?? "",
        FOCUS_LABEL[r.focus] ?? FOCUS_LABEL.career,
        res.fit === "weak" ? "안 맞음" : res.fit === "good" ? "맞음" : "",
        r.topic ?? "",
        r.score ?? "",
        ...PARTS.map((k) => b[k] ?? ""),
        res.reason ?? "",
        res.suggestion?.topic ?? "",
        res.suggestion?.how ?? "",
      ];
    });
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `진단기록_${from || "전체"}_${to || ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <div className="py-40 text-center text-gray-500">로그인이 필요합니다.</div>;

  const field =
    "rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-sm-orange";

  const total = stats?.total ?? 0;
  const convRate = total ? Math.round(((stats?.people ?? 0) / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">진단 기록</h1>
        <a
          href="/admin/orders"
          className={`ml-auto flex items-center gap-2 rounded-lg px-4 py-2 text-[13.5px] font-bold ${
            pendingOrders ? "bg-sm-orange text-white" : "border border-gray-300 text-gray-600"
          }`}
        >
          입금 확인 {pendingOrders ? `대기 ${pendingOrders}건` : ""}
          <span aria-hidden="true">→</span>
        </a>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        학생이 입력한 탐구주제와 AI 진단 결과를 날짜별로 확인합니다. 줄을 누르면 AI 결과 전체가 펼쳐집니다.
      </p>

      {/* 기간 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => {
          const on = from === r.from() && to === r.to();
          return (
            <button
              key={r.label}
              onClick={() => {
                setFrom(r.from());
                setTo(r.to());
              }}
              className={`rounded-lg border px-3.5 py-2 text-[13.5px] font-bold transition ${
                on ? "border-sm-orange bg-orange-50 text-sm-orange" : "border-gray-300 text-gray-600"
              }`}
            >
              {r.label}
            </button>
          );
        })}

        <div className="ml-1 flex items-center gap-2">
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-gray-400">~</span>
          <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <button
          onClick={load}
          disabled={busy}
          className="rounded-lg bg-sm-navy px-4 py-2 text-[13.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "조회 중…" : "조회"}
        </button>
      </div>

      {err && <p className="mt-5 text-sm font-semibold text-red-500">{err}</p>}

      {/* 요약 */}
      {stats && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["진단 건수", `${stats.total}건`],
              ["비회원 진단", `${stats.anonymous}건`],
              ["회원 진단", `${stats.members}건 · ${stats.people}명`],
              ["평균 흔함 지수", stats.avg_score == null ? "-" : `${stats.avg_score}점`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-gray-200 p-5">
                <p className="text-[12.5px] text-gray-500">{l}</p>
                <p className="mt-1.5 text-lg font-extrabold text-sm-navy">{v}</p>
              </div>
            ))}
          </div>

          <p className="mt-2.5 text-[12.5px] text-gray-400">
            전체 {stats.total}건 중 회원이 남긴 것은 {stats.members}건 ({convRate}% 수준)
          </p>

          {/* 집계 */}
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            <RankList title="희망 학과" rows={stats.by_department} total={total} />
            <RankList title="과목" rows={stats.by_subject} total={total} />
            <RankList title="학년" rows={stats.by_grade} total={total} />
            <RankList title="학기" rows={stats.by_term} total={total} />
            <RankList title="흔함 지수 구간" rows={stats.score_band} total={total} />
            <RankList title="날짜별" rows={stats.by_day} total={total} />
            <RankList title="고른 방향 (방향 선택 기능 배포 후 기간으로 보세요)" rows={focusRows} total={rows.length} />

            {/* 방향이 안 맞아서 '다시 받기' 안내가 뜬 비율 — 10~20%가 적당 */}
            <div className="rounded-xl border border-gray-200 p-5">
              <p className="text-[13px] font-bold text-sm-navy">방향이 안 맞음 (다시 받기 안내가 뜬 비율)</p>
              <ul className="mt-3.5 space-y-2 text-[13px]">
                {[
                  ["career", "진로 연결 → 과목 깊이 파기 권함"],
                  ["subject", "과목 깊이 파기 → 진로 연결 권함"],
                ].map(([k, l]) => {
                  const { n, weak } = fitStats[k];
                  const r = n ? Math.round((weak / n) * 100) : null;
                  const warn = r != null && (r >= 30 || r < 5);
                  return (
                    <li key={k} className="flex items-center justify-between">
                      <span className="text-gray-600">{l}</span>
                      <span>
                        <b className={warn ? "text-red-500" : "text-sm-navy"}>{r == null ? "-" : `${r}%`}</b>
                        <em className="ml-1.5 not-italic text-[11px] text-gray-400">
                          {weak}/{n}
                        </em>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11.5px] text-gray-400">
                10~20%가 적당해요. 30% 이상이면 기준이 너무 느슨하고, 5% 미만이면 너무 엄격해요.
              </p>
            </div>
          </div>
        </>
      )}

      {/* 사용자별 이용 — 회원을 누르면 아래 목록을 그 사람으로 거른다 */}
      <UsagePanel usage={usage} onPick={(email) => email && setQ(email)} />

      {/* 가입 전환 — 비회원이 어디서 멈추는지 */}
      <SignupPanel f={funnel} />

      {/* 탐구보고서 — 어느 단계에서 나가는지, PDF 누른 사람 중 몇 명이 결제하는지 (수요 테스트 자리) */}
      <InquiryPanel f={inqFunnel} />

      {/* 친구 추천 — 전환 단계와 A/B 그룹 비교 */}
      <ReferralPanel stats={refStats} />

      {/* 목록 */}
      <div ref={listTop} className="mt-10 flex flex-wrap items-center gap-2 scroll-mt-4">
        <h2 className="text-lg font-extrabold text-sm-navy">전체 목록</h2>
        <span className="text-[12.5px] text-gray-400">
          {shown.length.toLocaleString()}건 · {page}/{pages}쪽
        </span>
        <div className="flex gap-1.5">
          {[
            ["all", "전체"],
            ["member", "회원"],
            ["anon", "비회원"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setOnly(v)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition ${
                only === v
                  ? "border-sm-orange bg-orange-50 text-sm-orange"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {[
            ["all", "모든 방향"],
            ["career", "진로 연결"],
            ["subject", "과목 깊이 파기"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFocusOnly(v)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition ${
                focusOnly === v
                  ? "border-sm-navy bg-sm-navy text-white"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <button
          onClick={() => setWeakOnly((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition ${
            weakOnly ? "border-red-400 bg-red-50 text-red-500" : "border-gray-300 text-gray-600"
          }`}
        >
          방향 안 맞음만
        </button>

        <input
          className={`${field} ml-auto w-56`}
          placeholder="이름 · 학과 · 주제 · 제안 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          onClick={downloadCsv}
          disabled={!shown.length}
          className="rounded-lg border border-gray-300 px-3.5 py-2 text-[13.5px] font-bold text-gray-600 disabled:opacity-40"
        >
          엑셀 내보내기
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[1280px] text-left text-[13.5px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12.5px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-3">일시</th>
              <th className="px-4 py-3">회원</th>
              <th className="px-4 py-3">학과</th>
              <th className="px-4 py-3">학년</th>
              <th className="px-4 py-3">과목</th>
              <th className="px-4 py-3">방향</th>
              <th className="px-4 py-3">학생 입력 주제</th>
              <th className="px-4 py-3 text-right">지수</th>
              <th className="px-4 py-3">AI 제안 주제</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => {
              const key = r.id ?? `${page}-${i}`;
              const isOpen = open === key;
              const sug = r.result?.suggestion?.topic;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : key)}
                    className={`cursor-pointer border-b border-gray-100 transition hover:bg-orange-50/40 ${
                      isOpen ? "bg-orange-50/40" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {new Date(r.created_at).toLocaleString("ko-KR", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.is_member ? (
                        <>
                          <span className="font-bold text-sm-navy">{r.name ?? "회원"}</span>
                          <span className="ml-1.5 text-[12px] text-gray-400">{r.email}</span>
                        </>
                      ) : (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-500">
                          비회원
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{r.department}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {r.grade}
                      {r.term ? ` ${r.term}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{r.subject}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[11.5px] font-bold ${
                          r.focus === "subject" ? "bg-blue-50 text-blue-600" : "bg-orange-50 text-sm-orange"
                        }`}
                      >
                        {FOCUS_LABEL[r.focus] ?? FOCUS_LABEL.career}
                      </span>
                      {r.result?.fit === "weak" && (
                        <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-500">
                          안 맞음
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{r.topic}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {r.score == null ? (
                        <span className="text-gray-300">-</span>
                      ) : (
                        <b className={r.score >= 65 ? "text-sm-orange" : "text-sm-navy"}>{r.score}</b>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm-navy">
                      {sug ? sug : <span className="text-gray-300">-</span>}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={9} className="p-0">
                        <AiDetail r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {!shown.length && !busy && (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                  기록이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} pages={pages} onChange={goPage} />
    </div>
  );
}