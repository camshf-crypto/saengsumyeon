import { Fragment, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

/* 한국 날짜 "YYYY-MM-DD" (offset일 전후) */
function kstDay(offset = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/* 시각 → 한국 날짜 "YYYY-MM-DD" */
const kstOf = (t) => new Date(new Date(t).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const num = (v) => Number(v ?? 0);
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (day) => WD[new Date(`${day}T00:00:00Z`).getUTCDay()];
const hm = (t) => (t ? new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-");
const ymd = (t) => (t ? new Date(t).toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" }) : "-");
const pct = (a, b) => (num(b) ? Math.round((num(a) / num(b)) * 100) : null);
const daysTxt = (v) => (v == null ? "-" : `${Math.round(Number(v) * 10) / 10}일`);

const PROVIDER = { kakao: "카카오", google: "구글", email: "이메일" };
const SOURCE_STYLE = {
  탐구주제: "bg-orange-50 text-sm-orange",
  독서: "bg-blue-50 text-blue-600",
  지원동기: "bg-emerald-50 text-emerald-700",
  "면접 예상질문": "bg-violet-50 text-violet-700",
  "친구 추천 링크": "bg-amber-50 text-amber-700",
  "바로 가입": "bg-gray-100 text-gray-600",
  "가입 마무리 전": "bg-red-50 text-red-500",
};
const DID = [
  ["topic", "탐구주제"],
  ["reading", "독서"],
  ["motive", "지원동기"],
  ["interview", "면접 예상질문"],
  ["report", "탐구보고서"],
];

/* 며칠 만에 왔는지 → 구간 (3 · 7 · 15 · 30 · 30일 넘게) */
const GAP_BUCKETS = [
  { k: "d3", label: "3일 안", color: "#0B8A5E", test: (g) => g != null && g <= 3 },
  { k: "d7", label: "7일 안", color: "#2F56D6", test: (g) => g != null && g >= 4 && g <= 7 },
  { k: "d15", label: "15일 안", color: "#7C3AED", test: (g) => g != null && g >= 8 && g <= 15 },
  { k: "d30", label: "30일 안", color: "#EA580C", test: (g) => g != null && g >= 16 && g <= 30 },
  { k: "over", label: "30일 넘게", color: "#9CA3AF", test: (g) => g != null && g > 30 },
];
const bucketOf = (g) => GAP_BUCKETS.find((b) => b.test(g));

/* 그날 한 일 — "탐구주제 3 · 독서 1" + 입력한 주제·대학 */
function DidCell({ p }) {
  const items = DID.filter(([k]) => num(p[k]) > 0);
  const topics = p.topics ?? [];
  const ivs = p.interviews ?? [];
  if (!items.length) return <span className="text-gray-400">들어와서 둘러봄</span>;
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {items.map(([k, l]) => (
          <span key={k} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11.5px] font-bold text-gray-700">
            {l} {num(p[k])}
          </span>
        ))}
      </div>
      {topics.length > 0 && (
        <p className="mt-1 text-[12px] leading-snug text-gray-500">
          주제: {topics.slice(0, 3).join(" / ")}
          {topics.length > 3 ? ` 외 ${topics.length - 3}개` : ""}
        </p>
      )}
      {ivs.length > 0 && <p className="mt-0.5 text-[12px] leading-snug text-gray-500">면접: {ivs.slice(0, 3).join(" / ")}</p>}
    </div>
  );
}

function Who({ p }) {
  return (
    <>
      <span className="font-bold text-sm-navy">{p.name || "회원"}</span>
      <span className="ml-1.5 text-[12px] text-gray-400">{p.email}</span>
      {p.provider && <span className="ml-1.5 text-[11px] text-gray-400">{PROVIDER[p.provider] ?? p.provider}</span>}
    </>
  );
}

/* 지난 방문 — "3일 만 (10/1)" · "다음 날 (10/3)" · "가입 후 처음" */
function GapCell({ p }) {
  const g = p.gap_days;
  if (g == null)
    return (
      <span>
        <b className="text-gray-600">가입 후 처음</b>
        <span className="ml-1 text-[12px] text-gray-400">({md(kstOf(p.joined_at))} 가입)</span>
      </span>
    );
  const b = bucketOf(g);
  return (
    <span>
      <b style={{ color: b?.color }}>{g === 1 ? "다음 날" : `${g}일 만`}</b>
      {p.prev_at && <span className="ml-1 text-[12px] text-gray-400">({md(kstOf(p.prev_at))})</span>}
    </span>
  );
}

/* 날짜를 누르면 펼쳐지는 그날 사람 목록 */
function DayPeople({ data }) {
  if (!data) return <p className="px-6 py-6 text-[13px] text-gray-400">그날 기록을 불러오는 중…</p>;
  if (data.error) return <p className="px-6 py-4 text-[13px] font-bold text-red-500">불러오지 못했어요 · {data.error}</p>;

  const fresh = data.new ?? [];
  const back = data.returning ?? [];
  const bySource = fresh.reduce((m, p) => ((m[p.source] = (m[p.source] ?? 0) + 1), m), {});
  const firstAfter = back.filter((p) => p.gap_days == null).length;

  return (
    <div className="space-y-6 bg-gray-50 px-6 py-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-extrabold text-sm-navy">신규 회원 {fresh.length}명</p>
          {Object.entries(bySource)
            .sort((a, b) => b[1] - a[1])
            .map(([s, n]) => (
              <span key={s} className={`rounded px-2 py-0.5 text-[11.5px] font-bold ${SOURCE_STYLE[s] ?? "bg-gray-100 text-gray-600"}`}>
                {s} {n}
              </span>
            ))}
        </div>
        {fresh.length ? (
          <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">가입 시각</th>
                  <th className="px-4 py-2.5">회원</th>
                  <th className="px-4 py-2.5">가입 경로</th>
                  <th className="px-4 py-2.5">그날 한 일</th>
                </tr>
              </thead>
              <tbody>
                {fresh.map((p) => (
                  <tr key={p.user_id} className="border-b border-gray-100 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{hm(p.joined_at)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Who p={p} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-[11.5px] font-bold ${SOURCE_STYLE[p.source] ?? "bg-gray-100 text-gray-600"}`}>{p.source}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DidCell p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-gray-400">이날 가입한 회원이 없어요.</p>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-extrabold text-sm-navy">재로그인 회원 {back.length}명</p>
          {GAP_BUCKETS.map((b) => {
            const n = back.filter((p) => b.test(p.gap_days)).length;
            return n ? (
              <span key={b.k} className="rounded bg-white px-2 py-0.5 text-[11.5px] font-bold ring-1 ring-gray-200" style={{ color: b.color }}>
                {b.label} {n}
              </span>
            ) : null;
          })}
          {firstAfter > 0 && (
            <span className="rounded bg-white px-2 py-0.5 text-[11.5px] font-bold text-gray-500 ring-1 ring-gray-200">가입 후 처음 {firstAfter}</span>
          )}
        </div>
        {back.length ? (
          <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">머문 시간대</th>
                  <th className="px-4 py-2.5">회원</th>
                  <th className="px-4 py-2.5">지난 방문</th>
                  <th className="px-4 py-2.5">처음 가입</th>
                  <th className="px-4 py-2.5">그날 한 일</th>
                </tr>
              </thead>
              <tbody>
                {back.map((p) => (
                  <tr key={p.user_id} className="border-b border-gray-100 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">
                      {hm(p.first_at)} ~ {hm(p.last_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Who p={p} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <GapCell p={p} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{ymd(p.joined_at)}</td>
                    <td className="px-4 py-2.5">
                      <DidCell p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-gray-400">이날 다시 들어온 회원이 없어요.</p>
        )}
      </div>

      <p className="text-[12.5px] text-gray-500">
        비회원 <b className="text-sm-navy">{num(data.guests)}명</b>
        <span className="text-gray-400"> (브라우저 기준이라 목록 없이 숫자만 보여요)</span>
      </p>
    </div>
  );
}

/* 재방문 요약 — 보통 며칠 만 · 구간 막대 · 가입 후 N일 안 재방문율 */
function ReturnSummary({ s }) {
  if (!s) return <p className="mt-4 text-[13px] text-gray-400">재방문 숫자를 불러오는 중…</p>;
  if (s.error)
    return (
      <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">
        재방문 숫자를 불러오지 못했어요 · {s.error} (admin_return_stats.sql 실행했는지 확인)
      </p>
    );

  const b = s.buckets ?? {};
  const measured = num(s.measured);
  const ret = s.retention ?? [];

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
      {/* 며칠 만에 다시 오나 */}
      <div className="rounded-xl border border-gray-200 p-5">
        <p className="text-[12px] text-gray-500">재로그인 회원은 보통</p>
        <p className="mt-1 text-2xl font-extrabold text-sm-navy">
          {s.median_gap == null ? "-" : `${daysTxt(s.median_gap)} 만에`}
          <span className="ml-1 text-[14px] font-bold text-gray-500">다시 와요</span>
        </p>
        <p className="mt-0.5 text-[12px] text-gray-400">
          평균 {daysTxt(s.avg_gap)} · 재로그인 {measured.toLocaleString()}번 기준
          {num(s.first_after_join) ? ` · 가입 후 처음 ${num(s.first_after_join)}번은 뺌` : ""}
        </p>

        {/* 구간 막대 */}
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-gray-100">
          {GAP_BUCKETS.map((x) => {
            const w = measured ? (num(b[x.k]) / measured) * 100 : 0;
            return w ? <span key={x.k} style={{ width: `${w}%`, background: x.color }} title={`${x.label} ${num(b[x.k])}번`} /> : null;
          })}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
          {GAP_BUCKETS.map((x) => (
            <li key={x.k} className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: x.color }} />
              <span className="text-gray-600">{x.label}</span>
              <b className="ml-auto text-sm-navy">{num(b[x.k])}</b>
              <em className="w-9 text-right not-italic text-[11px] text-gray-400">{pct(b[x.k], measured) ?? 0}%</em>
            </li>
          ))}
        </ul>
      </div>

      {/* 가입 후 N일 안 재방문율 */}
      <div className="rounded-xl border border-gray-200 p-5">
        <p className="text-[12px] text-gray-500">가입 후 N일 안에 다시 온 비율 (고른 기간에 가입한 회원)</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[3, 7, 15, 30].map((n) => {
            const r = ret.find((x) => Number(x.days) === n);
            const rate = r ? pct(r.back, r.base) : null;
            return (
              <div key={n} className="rounded-lg bg-gray-50 p-3">
                <p className="text-[12px] text-gray-500">{n}일 안</p>
                <p className="mt-1 text-lg font-extrabold text-sm-navy">{rate == null ? "-" : `${rate}%`}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
                  {r && num(r.base) ? `${num(r.back)} / ${num(r.base)}명` : `가입 ${n}일 지난 회원 없음`}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-gray-400">
          각 비율은 그 기간이 다 지난 회원만 넣어서 계산해요. 기간이 짧으면 15일·30일은 비어 보일 수 있으니 [30일]이나 [전체]로 보세요.
        </p>
      </div>
    </div>
  );
}

/*
 * 날짜별 방문 — 위에서 고른 기간을 따른다.
 * 고른 기간이 7일보다 짧으면(오늘 등) 끝 날짜까지 최근 7일을 보여준다.
 */
export default function VisitorsPanel({ from, to }) {
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null); // 재방문 통계
  const [open, setOpen] = useState(null); // 펼친 날짜
  const [people, setPeople] = useState({}); // 날짜별 사람 목록
  const [showAll, setShowAll] = useState(false);
  const [label, setLabel] = useState("");
  const req = useRef(0);

  useEffect(() => {
    const my = ++req.current;
    const end = to || kstDay(0);
    const span = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 : Infinity;
    const week = span < 7;
    const pFrom = week ? addDays(end, -6) : from || null;
    const pTo = week ? end : to || null;
    setLabel(week ? `최근 7일 (${md(pFrom)} ~ ${md(pTo)})` : "");
    setRows(null);
    setStats(null);
    setOpen(null);
    setShowAll(false);
    const args = { p_from: pFrom, p_to: pTo };
    Promise.all([supabase.rpc("admin_daily_visitors", args), supabase.rpc("admin_return_stats", args)]).then(([v, r]) => {
      if (my !== req.current) return;
      if (v.error) console.warn("daily visitors failed", v.error);
      if (r.error) console.warn("return stats failed", r.error);
      setRows(v.error ? { error: v.error.message ?? "불러오지 못했어요" } : v.data ?? []);
      setStats(r.error ? { error: r.error.message ?? "불러오지 못했어요" } : r.data ?? {});
    });
  }, [from, to]);

  function toggle(day) {
    if (open === day) return setOpen(null);
    setOpen(day);
    if (people[day] && !people[day].error) return;
    setPeople((m) => ({ ...m, [day]: null }));
    supabase.rpc("admin_day_people", { p_day: day }).then(({ data, error }) => {
      if (error) console.warn("day people failed", error);
      setPeople((m) => ({ ...m, [day]: error ? { error: error.message ?? "불러오지 못했어요" } : data ?? {} }));
    });
  }

  const head = (
    <h2 className="text-lg font-extrabold text-sm-navy">
      날짜별 방문 {label && <span className="ml-1 text-[13px] font-bold text-gray-400">{label}</span>}
    </h2>
  );

  if (!rows)
    return (
      <div className="mb-8">
        {head}
        <p className="py-8 text-center text-[13px] text-gray-400">방문 기록을 불러오는 중…</p>
      </div>
    );
  if (rows.error)
    return (
      <div className="mb-8">
        {head}
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">
          불러오지 못했어요 · {rows.error} (admin_daily_visitors.sql 실행했는지 확인)
        </p>
      </div>
    );

  const latest = rows[0];
  const list = showAll ? rows : rows.slice(0, 31);
  const gapByDay = Object.fromEntries((stats?.by_day ?? []).map((x) => [x.day, x]));

  return (
    <div className="mb-8">
      {head}
      <p className="mt-1 text-[12.5px] text-gray-400">
        진단·탐구보고서·화면 기록이 하나라도 남은 사람을 셉니다. 같은 브라우저에 회원 기록이 있으면 그 회원 한 명으로 묶어요. 날짜를 누르면 그날 신규 회원이 어디서 가입했는지, 재로그인 회원이 며칠 만에 와서 뭘 했는지 보여요.
      </p>

      {latest && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["들어온 사람", latest.visitors, `회원 ${num(latest.members)} · 비회원 ${num(latest.guests)}`],
            ["신규 회원", latest.new_members, "그날 가입한 회원"],
            ["재로그인 회원", latest.returning, "전날 이전에 가입한 회원"],
            ["비회원", latest.guests, "브라우저 기준"],
          ].map(([l, v, sub]) => (
            <div key={l} className="rounded-xl border border-gray-200 p-4">
              <p className="text-[12px] text-gray-500">
                {md(latest.day)}({weekday(latest.day)}) {l}
              </p>
              <p className="mt-1.5 text-lg font-extrabold text-sm-navy">{num(v).toLocaleString()}명</p>
              <p className="mt-0.5 text-[11.5px] text-gray-400">{sub}</p>
            </div>
          ))}
        </div>
      )}

      <ReturnSummary s={stats} />

      <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[720px] text-left text-[13.5px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12.5px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-2.5">날짜</th>
              <th className="px-4 py-2.5 text-right">들어온 사람</th>
              <th className="px-4 py-2.5 text-right">회원</th>
              <th className="px-4 py-2.5 text-right">비회원</th>
              <th className="px-4 py-2.5 text-right">신규</th>
              <th className="px-4 py-2.5 text-right">재로그인</th>
              <th className="px-4 py-2.5 text-right">보통 며칠 만</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const isOpen = open === r.day;
              const g = gapByDay[r.day];
              return (
                <Fragment key={r.day}>
                  <tr
                    onClick={() => toggle(r.day)}
                    className={`cursor-pointer border-b border-gray-100 transition hover:bg-orange-50/40 ${isOpen ? "bg-orange-50/40" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-bold text-sm-navy">
                      <span className="mr-1.5 inline-block w-3 text-gray-400">{isOpen ? "▾" : "▸"}</span>
                      {md(r.day)} <span className="font-normal text-gray-400">({weekday(r.day)})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-sm-navy">{num(r.visitors).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">{num(r.members).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-gray-500">{num(r.guests).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-sm-orange">{num(r.new_members).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">{num(r.returning).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {g ? (
                        <>
                          <b className="text-sm-navy">{daysTxt(g.median_gap)}</b>
                          <em className="ml-1 not-italic text-[11px] text-gray-400">평균 {daysTxt(g.avg_gap)}</em>
                        </>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={7} className="p-0">
                        <DayPeople data={people[r.day]} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  이 기간에는 기록이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.length > 31 && !showAll && (
          <button onClick={() => setShowAll(true)} className="w-full border-t border-gray-100 py-2.5 text-[12.5px] font-bold text-gray-500 hover:bg-gray-50">
            이전 날짜 {rows.length - 31}일 더 보기
          </button>
        )}
      </div>
    </div>
  );
}