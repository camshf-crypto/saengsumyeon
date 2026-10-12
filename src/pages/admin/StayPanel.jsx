import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 첫 화면 '머문 시간' 탭
 * 한 번 방문에 얼마나 있다 가는지 · 메뉴별로 어디서 시간을 쓰는지 · 날짜별 · 오래 머문 회원
 * (화면을 보고 있고 1분 안에 손짓이 있었던 시간만 센다 — 켜 두고 자리 뜬 시간은 빠진다)
 */

const SECTION = {
  home: "홈",
  mulgyeol: "나만 그래?",
  columns: "입시 칼럼",
  board: "자유게시판",
  sb: "합격 생기부 퍼즐",
  note: "내 생기부 노트",
  level: "내 레벨",
  my: "마이페이지",
  topic: "탐구주제 흔한가",
  reading: "독서 흔한가",
  motive: "지원동기 흔한가",
  interview: "생기부 예상질문",
  inquiry: "탐구보고서",
  ladder: "대학 사다리",
  auth: "로그인 · 가입",
  etc: "기타",
};
const n = (v) => Number(v ?? 0).toLocaleString();
// 초 → "3분 20초"
function t(sec) {
  const s = Math.round(Number(sec ?? 0));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분${s % 60 ? ` ${s % 60}초` : ""}`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 100) : 0);

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1 text-[20px] font-extrabold text-sm-navy">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-gray-400">{sub}</p>}
    </div>
  );
}
const th = "whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-[12px] font-bold text-gray-500";
const td = "whitespace-nowrap border-b border-gray-100 px-3 py-2 text-[13px] text-gray-800";

export default function StayPanel({ from, to }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setD(null);
    setErr("");
    supabase.rpc("admin_stay_stats", { p_from: from || null, p_to: to || null }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setD(data);
    });
  }, [from, to]);

  if (err) return <p className="rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {err}</p>;
  if (!d) return <p className="py-16 text-center text-sm text-gray-400">불러오는 중…</p>;

  const s = d.summary ?? {};
  const buckets = d.buckets ?? [];
  const maxB = Math.max(1, ...buckets.map((b) => Number(b.n)));
  const secs = d.sections ?? [];
  const maxS = Math.max(1, ...secs.map((x) => Number(x.total_sec)));

  return (
    <div>
      <p className="text-[12.5px] text-gray-500">
        화면을 보고 있고 1분 안에 움직임이 있었던 시간만 세요. 방문 1번 = 한 탭에서 30분 안에 이어진 이용 · 관리자 화면은 빼요 · 이 기능을 넣은 날부터 쌓여요.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="방문 수" value={n(s.sessions)} sub={`방문한 사람 ${n(s.visitors)}명`} />
        <Tile label="방문 1번 평균" value={t(s.avg_sec)} sub={`가운데 값 ${t(s.median_sec)}`} />
        <Tile label="회원 평균" value={t(s.member_avg_sec)} />
        <Tile label="비회원 평균" value={t(s.guest_avg_sec)} />
        <Tile label="사람당 기간 합계" value={t(s.per_visitor_sec)} sub="이 기간에 한 사람이 쓴 시간" />
        <Tile label="30초 안에 나감" value={`${pct(s.bounce, s.sessions)}%`} sub={`${n(s.bounce)}번 · 한 화면만 보고 나감`} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-[16px] font-extrabold text-sm-navy">방문 1번에 머문 시간</h3>
          <div className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-3 text-[13px]">
                <span className="w-20 shrink-0 font-bold text-gray-700">{b.label}</span>
                <span className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <span className="block h-full rounded-full bg-sm-navy" style={{ width: `${(Number(b.n) / maxB) * 100}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right text-gray-600">
                  {n(b.n)}번 · {pct(b.n, s.sessions)}%
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[16px] font-extrabold text-sm-navy">메뉴별로 쓴 시간</h3>
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full">
              <thead>
                <tr>
                  {["메뉴", "총 시간", "", "들른 방문", "들르면 평균"].map((h, i) => (
                    <th key={i} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {secs.map((x) => (
                  <tr key={x.section}>
                    <td className={`${td} font-bold`}>{SECTION[x.section] ?? x.section}</td>
                    <td className={td}>{t(x.total_sec)}</td>
                    <td className={`${td} w-[30%]`}>
                      <span className="block h-2 rounded-full bg-sm-orange" style={{ width: `${(Number(x.total_sec) / maxS) * 100}%` }} />
                    </td>
                    <td className={td}>
                      {n(x.sessions)}번 <span className="text-gray-400">({pct(x.sessions, s.sessions)}%)</span>
                    </td>
                    <td className={`${td} font-bold text-sm-navy`}>{t(x.avg_sec)}</td>
                  </tr>
                ))}
                {!secs.length && (
                  <tr>
                    <td className={`${td} text-gray-400`} colSpan={5}>아직 쌓인 기록이 없어요</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-[16px] font-extrabold text-sm-navy">날짜별</h3>
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full">
              <thead>
                <tr>
                  {["날짜", "방문", "사람", "방문 1번 평균", "회원 평균"].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(d.daily ?? []).map((r) => (
                  <tr key={r.d}>
                    <td className={`${td} font-bold`}>{r.d.slice(5).replace("-", "/")}</td>
                    <td className={td}>{n(r.sessions)}</td>
                    <td className={td}>{n(r.visitors)}</td>
                    <td className={`${td} font-bold text-sm-navy`}>{t(r.avg_sec)}</td>
                    <td className={td}>{r.member_avg_sec == null ? "-" : t(r.member_avg_sec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="text-[16px] font-extrabold text-sm-navy">오래 머문 회원</h3>
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full">
              <thead>
                <tr>
                  {["", "닉네임", "학년", "온 날", "쓴 시간"].map((h, i) => (
                    <th key={i} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(d.top ?? []).map((u, i) => (
                  <tr key={i}>
                    <td className={`${td} text-gray-400`}>{i + 1}</td>
                    <td className={`${td} font-bold`}>
                      {u.author?.nick ?? "회원"}
                      {u.author?.stage && <span className="ml-1.5 text-[11.5px] font-medium text-gray-400">{u.author.stage}</span>}
                    </td>
                    <td className={td}>{u.grade ?? "-"}</td>
                    <td className={td}>{n(u.days)}일</td>
                    <td className={`${td} font-bold text-sm-navy`}>{t(u.sec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}