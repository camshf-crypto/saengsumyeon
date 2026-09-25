import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
const MAX = { 소재: 40, 대상: 20, 조건: 20, 방식: 20 };

/* 항목별 점수 합계 — 저장된 지수와 다르면 채점 오류를 의심할 수 있다 */
function sumOf(b) {
  if (!b) return null;
  return PARTS.reduce((acc, k) => acc + (Number(b[k]) || 0), 0);
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all"); // all | member | anon
  const [open, setOpen] = useState(null); // 펼친 줄의 id

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    const args = { p_from: from || null, p_to: to || null };

    const [list, stat, use] = await Promise.all([
      supabase.rpc("admin_topic_queries", args),
      supabase.rpc("admin_topic_stats", args),
      supabase.rpc("admin_user_usage", args),
    ]);
    setBusy(false);

    if (use.error) console.warn("usage query failed", use.error);
    setUsage(use.error ? null : use.data ?? []);

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

    const k = q.trim().toLowerCase();
    if (!k) return r;
    return r.filter((x) =>
      [x.email, x.name, x.department, x.subject, x.topic, x.result?.suggestion?.topic]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k))
    );
  }, [rows, q, only]);

  function downloadCsv() {
    const head = [
      "일시", "회원여부", "이메일", "이름", "학과", "학년", "학기", "과목", "탐구주제", "지수",
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
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">진단 기록</h1>
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
          </div>
        </>
      )}

      {/* 사용자별 이용 — 회원을 누르면 아래 목록을 그 사람으로 거른다 */}
      <UsagePanel usage={usage} onPick={(email) => email && setQ(email)} />

      {/* 목록 */}
      <div className="mt-10 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-extrabold text-sm-navy">전체 목록</h2>
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
        <table className="w-full min-w-[1180px] text-left text-[13.5px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12.5px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-3">일시</th>
              <th className="px-4 py-3">회원</th>
              <th className="px-4 py-3">학과</th>
              <th className="px-4 py-3">학년</th>
              <th className="px-4 py-3">과목</th>
              <th className="px-4 py-3">학생 입력 주제</th>
              <th className="px-4 py-3 text-right">지수</th>
              <th className="px-4 py-3">AI 제안 주제</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const key = r.id ?? i;
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
                      <td colSpan={8} className="p-0">
                        <AiDetail r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {!shown.length && !busy && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                  기록이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}