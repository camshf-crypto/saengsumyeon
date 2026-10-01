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
function RankList({ title, rows, total, color }) {
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
                className={`block h-full rounded-full ${color ? "" : "bg-sm-orange"}`}
                style={{ width: `${(r.n / max) * 100}%`, ...(color ? { background: color } : {}) }}
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

      {/* 결과 화면 → 다음 단계 → 무료 체험 (사람 수) */}
      <p className="mt-4 text-[12.5px] font-bold text-gray-500">결과 화면에서 넘어오기 (사람 수)</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "다음 단계 버튼을 본 회원", v: f.next_view, sub: "상위 1% 주제 결과를 본 회원" },
          { label: "다음 단계 누름", v: f.next_click, prev: f.next_view, sub: "결과 화면에서 버튼을 누른 회원" },
          { label: "무료 체험 '네'", v: f.trial_yes, prev: f.next_click, sub: `'아니요' ${n(f.trial_no)}명` },
          { label: "탐구 시작한 회원", v: f.starters, prev: f.trial_yes, sub: "탐구팩까지 만든 회원 (이용권 포함)" },
        ].map((s, i) => {
          const r = s.prev == null ? null : pct(s.v, s.prev);
          return (
            <div key={s.label} className="rounded-xl border border-gray-200 p-4">
              <p className="text-[12px] text-gray-500">
                {String.fromCharCode(65 + i)}. {s.label}
              </p>
              <p className="mt-1.5 text-lg font-extrabold text-sm-navy">
                {n(s.v)}
                {r != null && <span className="ml-1.5 text-[12.5px] font-bold text-sm-orange">{r}%</span>}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{s.sub}</p>
            </div>
          );
        })}
      </div>

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
      <h2 className="text-lg font-extrabold text-sm-navy">탐구주제 진단한 사람</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">
        고른 기간에 탐구주제 진단을 한 번이라도 한 사람만 셉니다 (가입만 하고 진단 안 한 회원은 빠져요). 회원은 계정, 비회원은 브라우저 기준이에요. 전체 가입자 수는 [요약] 탭에서 봐요.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["진단한 사람", `${people}명`, `진단한 회원 ${members} · 비회원 ${people - members}`],
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

/* ───────────── 흔한가 시리즈 새 탭 ───────────── */

const TABS = [
  { k: "sum", label: "요약", color: "#18224F" },
  { k: "topic", label: "탐구주제", color: "#EA580C" },
  { k: "reading", label: "독서", color: "#2F56D6" },
  { k: "motive", label: "지원동기", color: "#0B8A5E" },
  { k: "interview", label: "면접 예상질문", color: "#7C3AED" },
  { k: "inquiry", label: "탐구보고서", color: "#18224F" },
  { k: "growth", label: "가입·추천·결제", color: "#18224F" },
];
const SERVICE = {
  topic: { label: "탐구주제", color: "#EA580C", bg: "#FFF7ED" },
  reading: { label: "독서", color: "#2F56D6", bg: "#EEF3FF" },
  motive: { label: "지원동기", color: "#0B8A5E", bg: "#ECFBF3" },
  interview: { label: "면접 예상질문", color: "#7C3AED", bg: "#F3E8FF" },
  inquiry: { label: "탐구보고서", color: "#18224F", bg: "#EEF1FA" },
};
const PRODUCT = { interview: "생기부 예상질문 1곳", interview6: "생기부 예상질문 6곳", ten: "탐구 10건", one: "탐구 1건 (예전)" };
const USD_KRW = 1400; // AI 비용 원화 환산 (대략)
const num = (v) => Number(v ?? 0);
const won = (v) => `${Math.round(num(v)).toLocaleString()}원`;
const pctOf = (a, b) => (num(b) ? Math.round((num(a) / num(b)) * 100) : null);

/* 숫자 칸 */
function Stat({ label, value, sub, rate, color, bad, flag }) {
  return (
    <div className={`rounded-xl border p-4 ${bad ? "border-red-300 bg-red-50/50" : "border-gray-200"}`}>
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1.5 text-lg font-extrabold" style={{ color: color ?? "#18224F" }}>
        {value}
        {rate != null && <span className={`ml-1.5 text-[12.5px] font-bold ${bad ? "text-red-500" : "text-sm-orange"}`}>{rate}%</span>}
      </p>
      {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{sub}</p>}
      {flag && <p className="mt-1 text-[11.5px] font-bold text-red-500">{flag}</p>}
    </div>
  );
}

function Loading({ what }) {
  return <p className="py-16 text-center text-sm text-gray-400">{what ?? "숫자"}를 불러오는 중…</p>;
}
function Failed({ msg }) {
  return <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {msg}</p>;
}

/* 날짜별 추이 — 서비스별 선 그래프 (SVG) */
function TrendChart({ rows }) {
  if (!rows?.length) return <p className="py-10 text-center text-[13px] text-gray-400">이 기간에는 기록이 없어요.</p>;
  const keys = ["topic", "reading", "motive", "interview"];
  const W = 900, H = 220, L = 36, R = 10, T = 10, B = 26;
  const max = Math.max(1, ...rows.flatMap((d) => keys.map((k) => num(d[k]))));
  const x = (i) => L + (rows.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (rows.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = Math.max(1, Math.ceil(rows.length / 10));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="서비스별 날짜별 진단 수">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke="#F3F4F6" />
            <text x={L - 6} y={y(max * t) + 4} fontSize="11" textAnchor="end" fill="#9CA3AF">{Math.round(max * t)}</text>
          </g>
        ))}
        {rows.map((d, i) =>
          i % every === 0 ? (
            <text key={d.day} x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill="#9CA3AF">{d.day.slice(5)}</text>
          ) : null
        )}
        {keys.map((k) => (
          <g key={k}>
            <polyline fill="none" stroke={SERVICE[k].color} strokeWidth="2.5" points={rows.map((d, i) => `${x(i)},${y(num(d[k]))}`).join(" ")} />
            {rows.map((d, i) => (
              <circle key={i} cx={x(i)} cy={y(num(d[k]))} r="3" fill={SERVICE[k].color}>
                <title>{`${d.day} ${SERVICE[k].label} ${num(d[k])}건`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[12.5px]">
        {keys.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-gray-600">
            <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERVICE[k].color }} />
            {SERVICE[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* AI 비용·실패 표 */
function AiCostTable({ rows, revenue }) {
  const total = (rows ?? []).reduce((a, r) => a + num(r.cost_usd), 0) * USD_KRW;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
          <tr>
            <th className="px-4 py-2.5">서비스</th>
            <th className="px-4 py-2.5 text-right">AI 호출</th>
            <th className="px-4 py-2.5 text-right">실패</th>
            <th className="px-4 py-2.5 text-right">1번당 비용</th>
            <th className="px-4 py-2.5 text-right">비용 합계</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => {
            const failRate = pctOf(r.fails, r.calls);
            return (
              <tr key={r.key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2.5 font-bold" style={{ color: SERVICE[r.key]?.color }}>{SERVICE[r.key]?.label ?? r.key}</td>
                <td className="px-4 py-2.5 text-right">{num(r.calls).toLocaleString()}</td>
                <td className={`px-4 py-2.5 text-right ${failRate >= 5 ? "font-bold text-red-500" : "text-gray-500"}`}>
                  {num(r.fails)}
                  {failRate != null && <em className="ml-1 not-italic text-[11px]">{failRate}%</em>}
                </td>
                <td className="px-4 py-2.5 text-right">{won(num(r.avg_usd) * USD_KRW)}</td>
                <td className="px-4 py-2.5 text-right font-bold text-sm-navy">{won(num(r.cost_usd) * USD_KRW)}</td>
              </tr>
            );
          })}
          {!rows?.length && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-400">아직 AI 사용 기록이 없어요. 서버를 새로 배포한 뒤부터 쌓여요.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-gray-100 px-4 py-2.5 text-[12.5px] text-gray-500">
        AI 비용 <b className="text-sm-navy">{won(total)}</b> · 승인 매출 <b className="text-sm-orange">{won(revenue)}</b>
        {revenue > 0 && <span className="text-gray-400"> · 매출 대비 {Math.round((total / revenue) * 100)}%</span>}
        <span className="text-gray-400"> (1달러 {USD_KRW.toLocaleString()}원으로 환산, 실패 5% 이상은 빨간색)</span>
      </p>
    </div>
  );
}

/* 고른 기간을 글자로 — "오늘", "최근 7일", "9/24 ~ 9/30", "전체 기간" */
function rangeLabel(from, to) {
  if (!from && !to) return "전체 기간";
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const hit = RANGES.find((r) => r.from() === from && r.to() === to);
  if (hit) return hit.label === "오늘" ? "오늘" : hit.label === "전체" ? "전체 기간" : `최근 ${hit.label}`;
  if (from && to) return from === to ? md(from) : `${md(from)} ~ ${md(to)}`;
  return from ? `${md(from)}부터` : `${md(to)}까지`;
}

/* 요약 탭 */
function SummaryTab({ series, growth, topicStats, funnel, pendingOrders, members, period, topicUsers }) {
  if (!series || !growth) return <Loading />;
  if (series.error || growth.error) return <Failed msg={series.error || growth.error} />;
  const r = series.reading ?? {}, m = series.motive ?? {}, iv = series.interview ?? {};
  const sales = series.sales ?? [];
  const revenue = sales.reduce((a, x) => a + num(x.revenue), 0);
  const totalDiag = num(topicStats?.total) + num(r.total) + num(m.total) + num(iv.runs);
  const cu = growth.cross_use ?? {};
  // 가입 경로 — 새 회원이 가입 직전에 누른 가입 버튼의 서비스 (탐구주제·독서·지원동기 / 친구 추천 링크 / 바로 가입)
  const src = Object.fromEntries((growth.signup_source ?? []).map((x) => [x.key, num(x.n)]));
  const srcTotal = Object.values(src).reduce((a, v) => a + v, 0);
  const JOIN = { topic: "탐구주제", reading: "독서", motive: "지원동기" };

  const rows = [
    // 사용자 = 그 기간에 진단한 사람 수 (회원 + 비회원) — 네 서비스 모두 같은 기준
    { k: "topic", total: topicStats?.total, people: topicUsers ?? topicStats?.people, members: topicStats?.members, avg: topicStats?.avg_score, conv: `결과 본 비회원 → 가입 ${pctOf(funnel?.signup_done, funnel?.result_view) ?? "-"}%` },
    { k: "reading", total: r.total, people: r.people, members: r.members, avg: r.avg_score, conv: `친구 보상 ${num(r.bonus_friends)}명 · 탐구주제로 이동 ${num(series.cross?.reading_to_topic)}번` },
    { k: "motive", total: m.total, people: m.people, members: m.members, avg: m.avg_score, conv: `→ 면접 예상질문 바로가기 ${num(m.to_interview_people)}명` },
    { k: "interview", total: iv.runs, people: iv.run_people, members: iv.runs, avg: null, conv: `화면 본 사람 → 입금 ${pctOf(iv.order_people, iv.view_people) ?? "-"}%` },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="전체 회원"
          value={members ? `${num(members.total).toLocaleString()}명` : "-"}
          sub={`${period} 새 회원 ${num(funnel?.signup_done)}명${members ? ` · 최근 7일 로그인 ${num(members.active_7d).toLocaleString()}명` : ""}`}
        />
        <Stat label="전체 진단" value={`${totalDiag.toLocaleString()}건`} sub="4개 서비스 합계" />
        <Stat label="승인 매출" value={won(revenue)} color="#EA580C" sub={sales.map((x) => `${PRODUCT[x.key] ?? x.key} ${num(x.approved)}건`).join(" · ") || "아직 없어요"} />
        <Stat label="입금 대기" value={`${pendingOrders}건`} sub="결제 승인 화면에서 확인" />
      </div>

      <h2 className="mt-8 text-lg font-extrabold text-sm-navy">서비스별 한눈에</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">
        {period}에 각 서비스를 쓴 사람(회원 + 비회원)과, 그 서비스의 가입 버튼으로 가입한 새 회원이에요.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-2.5">서비스</th>
              <th className="px-4 py-2.5 text-right">진단</th>
              <th className="px-4 py-2.5 text-right">사용한 사람</th>
              <th className="px-4 py-2.5 text-right">회원 진단 비율</th>
              <th className="px-4 py-2.5 text-right">이 서비스로 가입</th>
              <th className="px-4 py-2.5 text-right">평균 흔함</th>
              <th className="px-4 py-2.5">핵심 전환</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.k} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-2.5">
                  <span className="rounded-md px-2 py-0.5 text-[12px] font-extrabold" style={{ background: SERVICE[x.k].bg, color: SERVICE[x.k].color }}>
                    {SERVICE[x.k].label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-sm-navy">{num(x.total).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right">{num(x.people).toLocaleString()}명</td>
                <td className="px-4 py-2.5 text-right">{pctOf(x.members, x.total) ?? "-"}%</td>
                <td className="px-4 py-2.5 text-right">
                  {JOIN[x.k] ? (
                    <>
                      <b className="text-sm-navy">{num(src[JOIN[x.k]])}명</b>
                      {srcTotal > 0 && <em className="ml-1 not-italic text-[11px] text-gray-400">{pctOf(src[JOIN[x.k]], srcTotal)}%</em>}
                    </>
                  ) : (
                    <span className="text-gray-300" title="로그인해야 쓸 수 있는 서비스라 가입 경로로 세지 않아요">-</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">{x.avg ?? "-"}</td>
                <td className="px-4 py-2.5 text-gray-600">{x.conv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[12.5px] text-gray-500">
        {period} 새 회원 <b className="text-sm-navy">{srcTotal}명</b> 중 · 친구 추천 링크 <b className="text-sm-navy">{num(src["친구 추천 링크"])}명</b> · 바로 가입{" "}
        <b className="text-sm-navy">{num(src["바로 가입"])}명</b>
        <span className="text-gray-400"> (바로 가입 = 진단 결과의 가입 버튼을 거치지 않고 헤더 등에서 직접 가입)</span>
      </p>

      <h2 className="mt-8 text-lg font-extrabold text-sm-navy">날짜별 진단 수</h2>
      <div className="mt-3 rounded-xl border border-gray-200 p-5">
        <TrendChart rows={growth.trend} />
      </div>

      <h2 className="mt-8 text-lg font-extrabold text-sm-navy">AI 비용</h2>
      <p className="mt-1 text-[12.5px] text-gray-400">서버를 새로 배포한 뒤부터 쌓여요. 탐구주제·탐구보고서는 서버에 기록을 붙인 뒤부터 나와요.</p>
      <div className="mt-3">
        <AiCostTable rows={growth.ai} revenue={revenue} />
      </div>

      <div className="mt-8 grid gap-3 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-extrabold text-sm-navy">어디서 가입했나</h2>
          <p className="mt-1 text-[12.5px] text-gray-400">가입 직전에 마지막으로 누른 가입 버튼의 서비스</p>
          <div className="mt-3">
            <RankList title="가입 경로" rows={growth.signup_source} total={(growth.signup_source ?? []).reduce((a, x) => a + num(x.n), 0)} color="#18224F" />
            {!growth.signup_source?.length && <p className="rounded-xl border border-gray-200 py-8 text-center text-[13px] text-gray-400">이 기간에 가입한 회원이 없어요.</p>}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-sm-navy">여러 서비스를 쓴 회원</h2>
          <p className="mt-1 text-[12.5px] text-gray-400">기간 안에 진단한 회원 {num(cu.members)}명 기준</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="1개만" value={`${num(cu.one)}명`} rate={pctOf(cu.one, cu.members)} />
            <Stat label="2개" value={`${num(cu.two)}명`} rate={pctOf(cu.two, cu.members)} />
            <Stat label="3개 이상" value={`${num(cu.three_plus)}명`} rate={pctOf(cu.three_plus, cu.members)} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="탐구 + 독서" value={`${num(cu.topic_reading)}명`} />
            <Stat label="탐구 + 지원동기" value={`${num(cu.topic_motive)}명`} />
            <Stat label="독서 + 지원동기" value={`${num(cu.reading_motive)}명`} />
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-extrabold text-sm-navy">진단끼리 넘어가기</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="탐구주제 → 독서" value={`${num(series.cross?.topic_to_reading)}번`} sub="[독서 흔한가 진단하러 가기]" />
        <Stat label="독서 → 탐구주제" value={`${num(series.cross?.reading_to_topic)}번`} sub="[탐구주제 흔한가 진단하러 가기]" />
        <Stat label="지원동기 → 면접 예상질문" value={`${num(m.to_interview_people)}명`} sub="[면접 예상질문 바로가기]" />
      </div>
    </>
  );
}

/* 독서 탭 */
function ReadingTab({ series }) {
  if (!series) return <Loading />;
  if (series.error) return <Failed msg={series.error} />;
  const r = series.reading ?? {};
  const C = SERVICE.reading.color;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="진단" value={`${num(r.total)}건`} sub={`회원 ${num(r.members)} · 비회원 ${num(r.anon)}`} />
        <Stat label="사용자" value={`${num(r.people)}명`} sub={num(r.people) ? `1인당 ${(num(r.total) / num(r.people)).toFixed(1)}권` : ""} />
        <Stat label="평균 흔함 지수" value={r.avg_score == null ? "-" : `${r.avg_score}점`} />
        <Stat label="비회원 → 가입 버튼" value={`${num(r.gate)}번`} rate={pctOf(r.gate, r.anon)} sub="비회원 진단 대비" />
        <Stat label="무료 소진" value={`${num(r.gate_quota)}번`} sub="비회원 한도 화면에서 가입 누름" />
      </div>
      <p className="mt-4 text-[12.5px] font-bold text-gray-500">친구 초대</p>
      <div className="mt-2 grid grid-cols-3 gap-3">
        <Stat label="보상 받은 친구" value={`${num(r.bonus_friends)}명`} sub="친구가 가입하고 독서 진단을 마침" />
        <Stat label="받은 권수" value={`${num(r.bonus_granted)}권`} sub="친구 1명당 +2권" />
        <Stat label="쓴 추가 권수" value={`${num(r.bonus_used)}권`} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <RankList title="많이 나온 책 TOP 10" rows={r.top_books} total={num(r.total)} color={C} />
        <div className="space-y-3">
          <RankList title="책 수준" rows={r.levels} total={num(r.total)} color={C} />
          <RankList title="희망 학과" rows={r.departments} total={num(r.total)} color={C} />
        </div>
      </div>
    </>
  );
}

/* 지원동기 탭 */
function MotiveTab({ series }) {
  if (!series) return <Loading />;
  if (series.error) return <Failed msg={series.error} />;
  const m = series.motive ?? {};
  const C = SERVICE.motive.color;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="진단" value={`${num(m.total)}건`} sub={`회원 ${num(m.members)} · 비회원 ${num(m.anon)}`} />
        <Stat label="사용자" value={`${num(m.people)}명`} />
        <Stat label="평균 흔함 지수" value={m.avg_score == null ? "-" : `${m.avg_score}점`} />
        <Stat label="대학 데이터로 분석" value={`${num(m.with_univ)}건`} rate={pctOf(m.with_univ, m.total)} sub="나머지는 대학 미입력·목록 밖" />
      </div>
      <p className="mt-4 text-[12.5px] font-bold text-gray-500">다음 행동</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="비회원 → 가입 버튼" value={`${num(m.gate)}번`} rate={pctOf(m.gate, m.anon)} />
        <Stat label="무료 소진 → 가입" value={`${num(m.gate_quota)}번`} />
        <Stat label="친구 보상 / 쓴 횟수" value={`${num(m.bonus_granted)}번 · ${num(m.bonus_used)}번`} />
        <Stat label="→ 면접 예상질문 바로가기" value={`${num(m.to_interview_people)}명`} color={SERVICE.interview.color} sub="유료 상품으로 넘어간 사람" />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <RankList title="많이 나온 대학 TOP 10" rows={m.top_univ} total={num(m.total)} color={C} />
        <RankList title="지원 학과 TOP 10" rows={m.departments} total={num(m.total)} color={C} />
      </div>
    </>
  );
}

/* 면접 예상질문 탭 — 학생 활동과 뽑힌 질문을 나란히 본다 */
const IV_KIND = { subject: "세특", club: "동아리", career: "진로", autonomy: "자율" };
const IV_TERMS = ["고1 1학기", "고1 2학기", "고2 1학기", "고2 2학기", "고3 1학기"];
const IV_SHORT = 25; // 이보다 짧은 활동은 '짧음' 표시 — 질문이 약한 게 입력 탓인지 보려고
const ivActs = (r) => (Array.isArray(r.activities) ? r.activities : []);
const ivGroups = (r) => r.result?.results?.[0]?.groups ?? [];
const ivQCount = (r) => ivGroups(r).reduce((a, g) => a + (g.questions?.length ?? 0), 0);
const ivShortN = (r) => ivActs(r).filter((a) => String(a.content ?? "").trim().length < IV_SHORT).length;
const ivWho = (r) => r.user_id ?? `guest:${r.client_id}`;
const ivClaimed = (r) => r.is_member && r.client_id; // 비회원으로 뽑고 가입해서 계정으로 옮긴 기록

/* 줄을 펼치면 — 왼쪽 학생 활동, 오른쪽 뽑힌 질문 */
function InterviewDetail({ r }) {
  const acts = ivActs(r);
  const groups = ivGroups(r);
  const guestView = !r.is_member; // 비회원 화면에는 앞 2개만 보였다
  const byTerm = {};
  acts.forEach((a) => {
    const k = `${a.grade} ${a.term}`;
    (byTerm[k] ??= []).push(a);
  });
  let n = 0;
  return (
    <div className="grid gap-6 bg-gray-50 px-6 py-5 lg:grid-cols-2">
      <div>
        <p className="text-[12px] font-bold text-gray-400">학생이 쓴 활동 {acts.length}개</p>
        {IV_TERMS.filter((k) => byTerm[k]).map((k) => (
          <div key={k} className="mt-3">
            <p className="text-[12px] font-extrabold text-sm-navy">{k}</p>
            <ul className="mt-1 space-y-1.5">
              {byTerm[k].map((a, i) => {
                const len = String(a.content ?? "").trim().length;
                const short = len < IV_SHORT;
                return (
                  <li key={i} className={`rounded-lg bg-white px-3 py-2 text-[13px] leading-relaxed ring-1 ${short ? "ring-red-200" : "ring-gray-200"}`}>
                    <span className="mr-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-bold text-violet-700">
                      {IV_KIND[a.kind] ?? a.kind}
                      {a.subject ? ` · ${a.subject}` : ""}
                    </span>
                    {a.title && <b className="mr-1 text-sm-navy">{a.title} ·</b>}
                    {a.content}
                    {short && <span className="ml-1.5 text-[11px] font-bold text-red-500">짧음 {len}자</span>}
                    {a.link && <span className="mt-1 block text-[12px] leading-relaxed text-gray-400">학과와 닿는 지점: {a.link}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[12px] font-bold text-gray-400">
          뽑힌 질문 {ivQCount(r)}개{guestView ? " · 비회원 화면엔 앞 2개만 보였어요" : ""}
        </p>
        {groups.map((g) => (
          <div key={g.title} className="mt-3">
            <p className="text-[12px] font-extrabold text-sm-navy">{g.title}</p>
            <ol className="mt-1 space-y-1.5">
              {(g.questions ?? []).map((q) => {
                n += 1;
                const hidden = guestView && n > 2;
                return (
                  <li key={q} className="flex gap-2 text-[13.5px] leading-relaxed">
                    <span className="w-5 shrink-0 font-extrabold text-sm-orange">{n}</span>
                    <span className={hidden ? "text-gray-400" : "text-gray-800"}>
                      {q}
                      <em className="ml-1.5 not-italic text-[11px] text-gray-400">{q.length}자{hidden ? " · 흐림" : ""}</em>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {!groups.length && <p className="mt-2 text-[13px] text-gray-400">질문 없음</p>}
      </div>
    </div>
  );
}

function InterviewTab({ series, rows }) {
  const [filter, setFilter] = useState("all"); // all | preview | full | guest
  const [shortOnly, setShortOnly] = useState(false);
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
    setOpen(null);
  }, [filter, shortOnly, rows]);

  if (!series || !rows) return <Loading />;
  if (series.error) return <Failed msg={series.error} />;
  if (rows.error) return <Failed msg={`기록 목록 — ${rows.error} (admin_interview_queries.sql 실행했는지 확인)`} />;

  const iv = series.interview ?? {};
  const real = rows.filter((r) => !r.is_admin); // 숫자는 관리자 빼고
  const pre = real.filter((r) => r.preview);
  const full = real.filter((r) => !r.preview);
  const people = (list) => new Set(list.map(ivWho)).size;
  const preGuest = pre.filter((r) => !r.is_member).length;
  const claimed = pre.filter(ivClaimed).length;
  const freePeople = people(pre);
  const fullPeople = people(full);
  const avgActs = full.length ? (full.reduce((a, r) => a + ivActs(r).length, 0) / full.length).toFixed(1) : null;
  const shortRecs = real.filter((r) => ivShortN(r) > 0).length;

  // 결제 후 학기 분포 — 결제한 학생이 어느 학기까지 채우는지
  const termRows = IV_TERMS.map((k) => ({
    key: k,
    n: full.reduce((a, r) => a + ivActs(r).filter((x) => `${x.grade} ${x.term}` === k).length, 0),
  }));
  const termTotal = termRows.reduce((a, x) => a + x.n, 0);
  const top = (pick) =>
    Object.entries(real.reduce((m, r) => ((m[pick(r)] = (m[pick(r)] ?? 0) + 1), m), {}))
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);

  const steps = [
    { label: "1. 화면 본 사람", v: iv.view_people, sub: "/interview 방문" },
    { label: "2. 무료 질문 뽑음", v: freePeople, prev: iv.view_people, sub: "5개 (회원 + 비회원)" },
    { label: "3. 결제 창 연 사람", v: iv.pay_open_people, prev: freePeople, sub: "19,000원 버튼" },
    { label: "4. 입금했어요", v: iv.order_people, prev: iv.pay_open_people, sub: `주문 접수 · 6곳 상품 ${num(iv.order_six)}건` },
    { label: "5. 입금 승인", v: iv.approved_people, prev: iv.order_people },
    { label: "6. 전체 질문 뽑음", v: fullPeople, prev: iv.approved_people, sub: "학기 탭 입력 후" },
    { label: "7. PDF 받음", v: iv.pdf_people, prev: fullPeople },
  ];
  let worst = -1, worstRate = 101;
  steps.forEach((s, i) => {
    const r = s.prev == null ? null : pctOf(s.v, s.prev);
    if (r != null && r < worstRate) {
      worstRate = r;
      worst = i;
    }
  });

  // 목록 — 관리자 기록도 보인다 (테스트 확인용, '관리자' 표시)
  let list = rows;
  if (filter === "preview") list = list.filter((r) => r.preview);
  if (filter === "full") list = list.filter((r) => !r.preview);
  if (filter === "guest") list = list.filter((r) => !r.is_member);
  if (shortOnly) list = list.filter((r) => ivShortN(r) > 0);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pageRows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <p className="text-[12.5px] font-bold text-gray-500">무료 질문 → 결제 흐름 (사람 수 · %는 바로 앞 단계 대비 · 관리자 제외)</p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {steps.map((s, i) => (
          <Stat
            key={s.label}
            label={s.label}
            value={num(s.v)}
            rate={s.prev == null ? null : pctOf(s.v, s.prev)}
            sub={s.sub}
            bad={i === worst}
            flag={i === worst ? "가장 많이 빠지는 단계" : null}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="무료 뽑기" value={`${pre.length}번`} sub={`회원 ${pre.length - preGuest} · 비회원 ${preGuest}`} />
        <Stat label="비회원 → 가입해서 이어 봄" value={`${claimed}번`} rate={pctOf(claimed, preGuest + claimed)} sub="비회원으로 뽑은 기록 대비" />
        <Stat label="전체 뽑기 (결제 후)" value={`${full.length}번`} sub={`${fullPeople}명`} />
        <Stat label="결제 후 평균 활동" value={avgActs == null ? "-" : `${avgActs}개`} sub="= 평균 질문 수" />
        <Stat label="짧은 활동이 있는 기록" value={`${shortRecs}건`} rate={pctOf(shortRecs, real.length)} sub={`${IV_SHORT}자 미만 활동 포함`} />
        <Stat label="결제한 전체 회원" value={`${num(iv.access_total)}명`} sub="기간과 상관없이 누적" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <RankList title="결제 후 채운 학기 (활동 수)" rows={termRows} total={termTotal} color={SERVICE.interview.color} />
        <RankList title="많이 뽑은 대학" rows={top((r) => r.university)} total={real.length} color={SERVICE.interview.color} />
        <RankList title="많이 뽑은 학과" rows={top((r) => r.department)} total={real.length} color={SERVICE.interview.color} />
      </div>

      {/* 기록 목록 — 누르면 활동과 질문을 나란히 */}
      <div className="mt-10 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-extrabold text-sm-navy">뽑은 기록</h2>
        <span className="text-[12.5px] text-gray-400">
          {list.length.toLocaleString()}건 · 누르면 활동과 질문을 나란히 봐요
        </span>
        <div className="ml-auto flex gap-1.5">
          {[
            ["all", "전체"],
            ["preview", "무료 5개"],
            ["full", "결제 후"],
            ["guest", "비회원"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition ${
                filter === v ? "border-violet-500 bg-violet-50 text-violet-700" : "border-gray-300 text-gray-600"
              }`}
            >
              {l}
            </button>
          ))}
          <button
            onClick={() => setShortOnly((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-bold transition ${
              shortOnly ? "border-red-400 bg-red-50 text-red-500" : "border-gray-300 text-gray-600"
            }`}
          >
            짧은 활동만
          </button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[900px] text-left text-[13.5px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12.5px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-3">일시</th>
              <th className="px-4 py-3">이용자</th>
              <th className="px-4 py-3">대학 · 학과</th>
              <th className="px-4 py-3">단계</th>
              <th className="px-4 py-3 text-right">활동</th>
              <th className="px-4 py-3 text-right">질문</th>
              <th className="px-4 py-3">비고</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => {
              const isOpen = open === r.id;
              const sn = ivShortN(r);
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : r.id)}
                    className={`cursor-pointer border-b border-gray-100 transition hover:bg-violet-50/40 ${isOpen ? "bg-violet-50/40" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{shortTime(r.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.is_member ? (
                        <>
                          <span className="font-bold text-sm-navy">{r.name ?? "회원"}</span>
                          <span className="ml-1.5 text-[12px] text-gray-400">{r.email}</span>
                          {r.is_admin && <span className="ml-1.5 rounded bg-gray-800 px-1.5 py-0.5 text-[11px] font-bold text-white">관리자</span>}
                        </>
                      ) : (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-500">비회원</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.university} <span className="text-gray-500">{r.department}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-[11.5px] font-bold ${r.preview ? "bg-gray-100 text-gray-600" : "bg-violet-50 text-violet-700"}`}>
                        {r.preview ? "무료 5개" : "결제 후"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{ivActs(r).length}</td>
                    <td className="px-4 py-3 text-right font-bold text-sm-navy">{ivQCount(r)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[12px]">
                      {sn > 0 && <span className="mr-1.5 font-bold text-red-500">짧은 활동 {sn}개</span>}
                      {ivClaimed(r) && <span className="text-gray-400">비회원 → 가입</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={7} className="p-0">
                        <InterviewDetail r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-gray-400">
                  기록이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onChange={setPage} />
    </>
  );
}

/* 상품별 매출 */
function SalesTable({ sales }) {
  const PRICE = { interview: 19000, interview6: 24000, ten: 29000, one: 3900 };
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
          <tr>
            <th className="px-4 py-2.5">상품</th>
            <th className="px-4 py-2.5 text-right">가격</th>
            <th className="px-4 py-2.5 text-right">주문</th>
            <th className="px-4 py-2.5 text-right">승인</th>
            <th className="px-4 py-2.5 text-right">대기</th>
            <th className="px-4 py-2.5 text-right">승인 매출</th>
          </tr>
        </thead>
        <tbody>
          {(sales ?? []).map((x) => (
            <tr key={x.key} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2.5 font-bold text-sm-navy">{PRODUCT[x.key] ?? x.key}</td>
              <td className="px-4 py-2.5 text-right">{PRICE[x.key] ? won(PRICE[x.key]) : "-"}</td>
              <td className="px-4 py-2.5 text-right">{num(x.orders)}</td>
              <td className="px-4 py-2.5 text-right">{num(x.approved)}</td>
              <td className="px-4 py-2.5 text-right">{num(x.pending)}</td>
              <td className="px-4 py-2.5 text-right font-bold text-sm-orange">{won(x.revenue)}</td>
            </tr>
          ))}
          {!sales?.length && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-400">이 기간에 주문이 없어요.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* 친구 추천 보상 — 서비스별 */
function BonusSummary({ series }) {
  if (!series || series.error) return null;
  const r = series.reading ?? {}, m = series.motive ?? {};
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Stat label="독서 보상 (친구 1명당 +2권)" value={`${num(r.bonus_friends)}명 · ${num(r.bonus_granted)}권`} sub={`쓴 권수 ${num(r.bonus_used)}권`} color={SERVICE.reading.color} />
      <Stat label="지원동기 보상 (친구 1명당 +1번)" value={`${num(m.bonus_granted)}번`} sub={`쓴 횟수 ${num(m.bonus_used)}번`} color={SERVICE.motive.color} />
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
  const [series, setSeries] = useState(null); // 독서·지원동기·면접·매출 통계
  const [growth, setGrowth] = useState(null); // 추이·가입 경로·여러 서비스 사용·AI 비용
  const [members, setMembers] = useState(null); // 전체 회원 수 (기간과 상관없이 누적)
  const [ivRows, setIvRows] = useState(null); // 면접 예상질문 기록 (활동 + 질문)
  // 탭 — 주소 끝 ?tab=reading 처럼 두면 그 탭으로 열린다
  const [tab, setTabState] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((x) => x.k === t) ? t : "sum";
  });
  const setTab = (t) => {
    setTabState(t);
    const u = new URL(window.location.href);
    if (t === "sum") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u);
  };

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

    const [list, stat, use, refs, fun, inf, ser, gro, mem, ivq] = await Promise.all([
      fetchAllRows(args),
      supabase.rpc("admin_topic_stats", args),
      fetchAllRows(args, "admin_user_usage"),
      supabase.rpc("admin_referral_stats", args),
      supabase.rpc("admin_signup_funnel", args),
      supabase.rpc("admin_inquiry_funnel", args),
      supabase.rpc("admin_series_stats", args),
      supabase.rpc("admin_growth_stats", args),
      supabase.rpc("admin_member_total"),
      fetchAllRows(args, "admin_interview_queries"),
    ]);
    setBusy(false);

    if (ivq.error) console.warn("interview queries failed", ivq.error);
    setIvRows(ivq.error ? { error: ivq.error.message ?? "불러오지 못했어요" } : ivq.data ?? []);

    if (ser.error) console.warn("series stats failed", ser.error);
    setSeries(ser.error ? { error: ser.error.message ?? "불러오지 못했어요" } : ser.data ?? {});
    if (gro.error) console.warn("growth stats failed", gro.error);
    setGrowth(gro.error ? { error: gro.error.message ?? "불러오지 못했어요" } : gro.data ?? {});
    if (mem.error) console.warn("member total failed", mem.error);
    setMembers(mem.error ? null : mem.data ?? null);

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
        <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">관리자</h1>
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
        흔한가 시리즈 전체 이용과 매출을 봅니다. 기간은 모든 탭에 같이 적용돼요.
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

      {/* 탭 */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b-2 border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className="-mb-[2px] whitespace-nowrap border-b-[3px] px-4 py-2.5 text-[14px] font-extrabold transition"
            style={tab === t.k ? { color: t.color, borderColor: t.color } : { color: "#6B7280", borderColor: "transparent" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && <p className="mt-5 text-sm font-semibold text-red-500">{err}</p>}

      {/* ── 요약 탭 */}
      {tab === "sum" && (
        <div className="mt-6">
          <SummaryTab series={series} growth={growth} topicStats={stats} funnel={funnel} pendingOrders={pendingOrders} members={members} period={rangeLabel(from, to)} topicUsers={usage?.length} />
        </div>
      )}
      {tab === "reading" && (
        <div className="mt-6">
          <ReadingTab series={series} />
        </div>
      )}
      {tab === "motive" && (
        <div className="mt-6">
          <MotiveTab series={series} />
        </div>
      )}
      {tab === "interview" && (
        <div className="mt-6">
          <InterviewTab series={series} rows={ivRows} />
        </div>
      )}
      {tab === "inquiry" && <InquiryPanel f={inqFunnel} />}
      {tab === "growth" && (
        <>
          <div className="mt-6">
            <h2 className="text-lg font-extrabold text-sm-navy">상품별 매출</h2>
            <p className="mt-1 text-[12.5px] text-gray-400">승인된 주문만 매출로 셉니다. 관리자 계정 주문은 뺍니다.</p>
            {series?.error ? <Failed msg={series.error} /> : <SalesTable sales={series?.sales} />}
          </div>
          <SignupPanel f={funnel} />
          <ReferralPanel stats={refStats} />
          <div className="mt-6">
            <p className="text-[12.5px] font-bold text-gray-500">독서·지원동기 친구 보상 (이 기간)</p>
            <BonusSummary series={series} />
          </div>
        </>
      )}

      {/* ── 탐구주제 탭: 기존 내용 그대로 */}
      {tab === "topic" && (
      <>
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
      </>
      )}
    </div>
  );
}