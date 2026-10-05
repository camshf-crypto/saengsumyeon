import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 [나만 그래?] 탭
 * 날짜별 들어온 사람 → 누른 사람 → 댓글 단 사람, 새 닉네임, 반응 좋은 질문, 신고 들어온 댓글
 * 위에서 고른 기간을 따른다. 기간이 7일보다 짧으면(오늘 등) 끝 날짜까지 최근 7일을 보여준다.
 */

const BLUE = "#1A5E9A";
const num = (v) => Number(v ?? 0);
const pct = (a, b) => (num(b) ? Math.round((num(a) / num(b)) * 100) : null);
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (day) => WD[new Date(`${day}T00:00:00Z`).getUTCDay()];
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
const shortTime = (t) =>
  new Date(t).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, rate, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1.5 text-lg font-extrabold text-sm-navy">
        {value}
        {rate != null && <span className="ml-1.5 text-[12.5px] font-bold" style={{ color: BLUE }}>{rate}%</span>}
      </p>
      {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-gray-400">{sub}</p>}
    </div>
  );
}

export default function MulgyeolPanel({ from, to }) {
  const [s, setS] = useState(null);
  const [reports, setReports] = useState(null);
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
    setS(null);
    Promise.all([
      supabase.rpc("admin_mulgyeol_stats", { p_from: pFrom, p_to: pTo }),
      supabase.rpc("admin_mulgyeol_reports"),
    ]).then(([a, b]) => {
      if (my !== req.current) return;
      if (a.error) console.warn("mulgyeol stats failed", a.error);
      if (b.error) console.warn("mulgyeol reports failed", b.error);
      setS(a.error ? { error: a.error.message ?? "불러오지 못했어요" } : a.data ?? {});
      setReports(b.error ? [] : b.data ?? []);
    });
  }, [from, to]);

  async function setHidden(id, hidden) {
    if (hidden && !window.confirm("이 댓글을 숨길까요? 학생 화면에서 바로 사라져요.")) return;
    const { error } = await supabase.rpc("admin_mulgyeol_hide", { p_comment_id: id, p_hidden: hidden });
    if (error) return window.alert("바꾸지 못했어요.");
    const { data } = await supabase.rpc("admin_mulgyeol_reports");
    setReports(data ?? []);
  }

  const head = (
    <h2 className="text-lg font-extrabold text-sm-navy">
      나만 그래? {label && <span className="ml-1 text-[13px] font-bold text-gray-400">{label}</span>}
    </h2>
  );

  if (!s)
    return (
      <div>
        {head}
        <p className="py-10 text-center text-[13px] text-gray-400">숫자를 불러오는 중…</p>
      </div>
    );
  if (s.error)
    return (
      <div>
        {head}
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">
          불러오지 못했어요 · {s.error} (admin_mulgyeol.sql 실행했는지 확인)
        </p>
      </div>
    );

  const t = s.totals ?? {};
  const days = s.days ?? [];
  const top = s.top ?? [];
  const waiting = (reports ?? []).filter((r) => !r.hidden);

  return (
    <div>
      {head}
      <p className="mt-1 text-[12.5px] text-gray-400">
        관리자 계정 기록은 빼고 셉니다. 들어온 사람은 {t.visit_since ? `${md(t.visit_since)}부터` : "방문 기록을 넣은 뒤부터"} 기록돼요 (그 전 날짜는 누른 사람만 보여요).
      </p>

      {/* 기간 합계 — 들어온 사람 → 누른 사람 → 댓글 단 사람 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="들어온 사람" value={`${num(t.visitors).toLocaleString()}명`} sub="회원 + 비회원 브라우저" />
        <Stat label="한 번이라도 누른 사람" value={`${num(t.answerers).toLocaleString()}명`} rate={pct(t.answerers, t.visitors)} sub={`답 ${num(t.answers).toLocaleString()}개 · 1인당 ${num(t.answerers) ? (num(t.answers) / num(t.answerers)).toFixed(1) : "-"}개`} />
        <Stat label="댓글 단 사람" value={`${num(t.commenters).toLocaleString()}명`} rate={pct(t.commenters, t.answerers)} sub={`댓글 ${num(t.comments).toLocaleString()}개 · 누른 사람 대비`} />
        <Stat label="새로 닉네임 정한 사람" value={`${num(t.nicknames).toLocaleString()}명`} sub="가입 화면 + 첫 댓글 팝업" />
      </div>

      {/* 신고 대기 */}
      {waiting.length > 0 && (
        <p className="mt-3 rounded-lg bg-orange-50 px-4 py-3 text-[13px] font-bold text-[#C2410C]">
          신고 들어온 댓글 {waiting.length}개가 있어요 · 맨 아래에서 확인
        </p>
      )}

      {/* 날짜별 */}
      <h3 className="mt-8 text-[15px] font-extrabold text-sm-navy">날짜별</h3>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-2.5">날짜</th>
              <th className="px-4 py-2.5 text-right">들어온 사람</th>
              <th className="px-4 py-2.5 text-right">누른 사람</th>
              <th className="px-4 py-2.5 text-right">누른 비율</th>
              <th className="px-4 py-2.5 text-right">답</th>
              <th className="px-4 py-2.5 text-right">댓글 단 사람</th>
              <th className="px-4 py-2.5 text-right">댓글</th>
              <th className="px-4 py-2.5 text-right">새 닉네임</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const r = pct(d.answerers, d.visitors);
              return (
                <tr key={d.day} className="border-b border-gray-100 last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 font-bold text-sm-navy">
                    {md(d.day)} <span className="font-normal text-gray-400">({weekday(d.day)})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {num(d.visitors) ? num(d.visitors) : <span className="text-gray-300">-</span>}
                    {num(d.visitors) > 0 && <em className="ml-1 not-italic text-[11px] text-gray-400">회원 {num(d.visitor_members)}</em>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-sm-navy">
                    {num(d.answerers)}
                    <em className="ml-1 not-italic text-[11px] font-normal text-gray-400">회원 {num(d.answerer_members)}</em>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: BLUE }}>{r == null ? <span className="text-gray-300">-</span> : `${r}%`}</td>
                  <td className="px-4 py-2.5 text-right">{num(d.answers)}</td>
                  <td className="px-4 py-2.5 text-right">{num(d.commenters)}</td>
                  <td className="px-4 py-2.5 text-right">{num(d.comments)}</td>
                  <td className="px-4 py-2.5 text-right">{num(d.nicknames)}</td>
                </tr>
              );
            })}
            {!days.length && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">이 기간에는 기록이 없어요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 반응 좋은 질문 */}
      <h3 className="mt-8 text-[15px] font-extrabold text-sm-navy">반응 좋은 질문</h3>
      <p className="mt-0.5 text-[12px] text-gray-400">지금까지 열린 질문 전체 기준 · 답 많은 순 · 다음 질문을 만들 때 잘 된 유형을 참고하세요</p>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-gray-200 bg-gray-50 text-[12px] font-bold text-gray-500">
            <tr>
              <th className="px-4 py-2.5">공개일</th>
              <th className="px-4 py-2.5">분야</th>
              <th className="px-4 py-2.5">질문</th>
              <th className="px-4 py-2.5 text-right">답</th>
              <th className="px-4 py-2.5 text-right">나도 그래</th>
              <th className="px-4 py-2.5 text-right">학생 댓글</th>
            </tr>
          </thead>
          <tbody>
            {top.map((q) => (
              <tr key={q.id} className="border-b border-gray-100 last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{md(q.open_date)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">{q.area}</td>
                <td className="px-4 py-2.5 font-medium text-sm-navy">{q.title}</td>
                <td className="px-4 py-2.5 text-right font-bold text-sm-navy">{num(q.answers)}</td>
                <td className="px-4 py-2.5 text-right" style={{ color: BLUE }}>{pct(q.yes, q.answers) == null ? "-" : `${pct(q.yes, q.answers)}%`}</td>
                <td className="px-4 py-2.5 text-right">{num(q.comments)}</td>
              </tr>
            ))}
            {!top.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">아직 답이 없어요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 신고 들어온 댓글 */}
      <h3 className="mt-8 text-[15px] font-extrabold text-sm-navy">신고 들어온 댓글</h3>
      <p className="mt-0.5 text-[12px] text-gray-400">신고가 3번 쌓이면 자동으로 숨겨져요. 그 전에 직접 숨기거나, 잘못 숨겨진 걸 되살릴 수 있어요.</p>
      <div className="mt-2 space-y-2">
        {(reports ?? []).map((c) => (
          <div key={c.id} className={`rounded-xl border p-4 ${c.hidden ? "border-gray-200 bg-gray-50" : "border-orange-200"}`}>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <b className="text-sm-navy">{c.nickname || "닉네임 없음"}</b>
              <span className="text-gray-400">{c.email}</span>
              <span className="text-gray-400">· {shortTime(c.created_at)}</span>
              <span className={`ml-auto rounded px-2 py-0.5 font-bold ${c.hidden ? "bg-gray-200 text-gray-600" : "bg-orange-50 text-[#C2410C]"}`}>
                {c.hidden ? "숨김" : `신고 ${num(c.report_count)}번`}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-gray-500">{c.title}</p>
            <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-sm-navy">{c.body}</p>
            <div className="mt-2 text-right">
              {c.hidden ? (
                <button onClick={() => setHidden(c.id, false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-[12.5px] font-bold text-gray-600">
                  되살리기
                </button>
              ) : (
                <button onClick={() => setHidden(c.id, true)} className="rounded-lg bg-sm-navy px-3 py-1.5 text-[12.5px] font-bold text-white">
                  숨기기
                </button>
              )}
            </div>
          </div>
        ))}
        {reports && !reports.length && <p className="rounded-xl border border-gray-200 py-8 text-center text-[13px] text-gray-400">신고 들어온 댓글이 없어요.</p>}
      </div>
    </div>
  );
}