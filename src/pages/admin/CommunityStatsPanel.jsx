import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

/*
 * 새 서비스 현황 — 관리자 첫 화면 '커뮤니티 · 레벨' 탭과 커뮤니티 관리 '현황' 탭이 같이 쓴다
 * 회원 · 날짜별 활동 · 나만 그래? · 자유게시판 · 생기부 노트 · 퍼즐 · 쿠폰 · 레벨 분포 · 조각 · 입시 칼럼 · 설명회
 * from · to 를 주면 그 기간, 안 주면 위에 기간 버튼(오늘 · 7일 · 30일 · 전체)이 나온다
 */

function fmt(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const kst = (offset = 0) => {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const RANGES = [
  { label: "오늘", from: () => kst(0), to: () => kst(0) },
  { label: "7일", from: () => kst(-6), to: () => kst(0) },
  { label: "30일", from: () => kst(-29), to: () => kst(0) },
  { label: "전체", from: () => null, to: () => null },
];
const n = (v) => Number(v ?? 0).toLocaleString();
const rate = (a, b) => (Number(b) ? `${Math.round((Number(a) / Number(b)) * 100)}%` : "-");
const STAGE_COLOR = ["#059669", "#2563EB", "#4F46E5", "#E8590C", "#0369A1", "#6D28D9"];

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="mt-1 text-[20px] font-extrabold text-sm-navy">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-gray-400">{sub}</p>}
    </div>
  );
}
function Block({ title, note, children }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[17px] font-extrabold text-sm-navy">{title}</h2>
        {note && <span className="text-[12px] text-gray-400">{note}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
const th = "whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-[12px] font-bold text-gray-500";
const td = "whitespace-nowrap border-b border-gray-100 px-3 py-2 text-[13px] text-gray-800";

export default function CommunityStatsPanel({ from, to }) {
  const outer = from !== undefined || to !== undefined; // 관리자 첫 화면처럼 바깥에서 기간을 정해 주면 기간 버튼을 숨긴다
  const [range, setRange] = useState(1); // 기본 7일
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");

  const pFrom = outer ? from || null : RANGES[range].from();
  const pTo = outer ? to || null : RANGES[range].to();
  useEffect(() => {
    setD(null);
    setErr("");
    supabase.rpc("admin_community_stats", { p_from: pFrom, p_to: pTo }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setD(data);
    });
  }, [pFrom, pTo]);

  const m = d?.members ?? {};
  const lvTotal = (d?.levels ?? []).reduce((a, x) => a + Number(x.n), 0);

  return (
    <div>
      <div className={`flex flex-wrap items-center gap-1.5 ${outer ? "hidden" : ""}`}>
        {RANGES.map((r, i) => (
          <button
            key={r.label}
            onClick={() => setRange(i)}
            className={`h-9 rounded-full px-4 text-[13px] font-bold ${range === i ? "bg-sm-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}
          >
            {r.label}
          </button>
        ))}
        <span className="ml-2 text-[12px] text-gray-400">기간은 한국 날짜 기준 · 레벨 분포 · 남은 조각은 지금 기준</span>
      </div>

      {err && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">숫자를 불러오지 못했어요 · {err}</p>}
      {!d && !err && <p className="py-16 text-center text-sm text-gray-400">불러오는 중…</p>}

      {d && (
        <>
          <Block title="회원">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="전체 회원" value={n(m.total)} sub={Object.entries(m.grades ?? {}).map(([g, c]) => `${g} ${c}`).join(" · ")} />
              <Tile label="새로 가입" value={n(m.new)} />
              <Tile label="활동한 학생" value={n(m.active)} sub="응답 · 댓글 · 글 · 출석 · 노트 · 칼럼" />
              <Tile label="2일 이상 온 학생" value={n(m.returning)} sub={`활동 학생의 ${rate(m.returning, m.active)}`} />
              <Tile label="닉네임 정함" value={n(m.nickname)} sub={`전체의 ${rate(m.nickname, m.total)}`} />
              <Tile label="프로필 사진" value={n(m.avatar)} sub={`전체의 ${rate(m.avatar, m.total)}`} />
            </div>
          </Block>

          <Block title="날짜별" note="최대 60일 · 전체는 최근 30일">
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr>
                    {["날짜", "활동 학생", "가입", "출석", "나만 그래? 응답", "댓글", "게시판 글", "노트 활동", "칼럼 끝까지"].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.daily ?? []).map((r) => (
                    <tr key={r.d}>
                      <td className={`${td} font-bold`}>{r.d.slice(5).replace("-", "/")}</td>
                      <td className={`${td} font-bold text-sm-navy`}>{n(r.active)}</td>
                      <td className={td}>{n(r.signup)}</td>
                      <td className={td}>{n(r.att)}</td>
                      <td className={td}>{n(r.answers)}</td>
                      <td className={td}>{n(r.comments)}</td>
                      <td className={td}>{n(r.posts)}</td>
                      <td className={td}>{n(r.notes)}</td>
                      <td className={td}>{n(r.reads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <div className="grid gap-x-6 lg:grid-cols-2">
            <Block title="나만 그래?">
              <div className="grid grid-cols-3 gap-2">
                <Tile label="응답" value={n(d.mulgyeol.answers)} sub={`${n(d.mulgyeol.answerers)}명 (회원 ${n(d.mulgyeol.members)})`} />
                <Tile label="댓글" value={n(d.mulgyeol.comments)} sub={`${n(d.mulgyeol.commenters)}명`} />
                <Tile label="댓글 나도 그래" value={n(d.mulgyeol.likes)} />
              </div>
            </Block>
            <Block title="자유게시판">
              <div className="grid grid-cols-3 gap-2">
                <Tile label="글" value={n(d.board.posts)} sub={`${n(d.board.writers)}명 · ${Object.entries(d.board.tags ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ")}`} />
                <Tile label="댓글" value={n(d.board.comments)} />
                <Tile label="나도 그래" value={n(d.board.likes)} sub={d.board.hidden ? `가린 글 ${d.board.hidden}` : null} />
              </div>
            </Block>
            <Block title="내 생기부 노트">
              <div className="grid grid-cols-3 gap-2">
                <Tile label="적은 활동" value={n(d.notes.added)} sub={`${n(d.notes.writers)}명`} />
                <Tile label="노트 쓴 학생 (전체)" value={n(d.notes.users)} />
                <Tile label="AI 진단 열린 학생" value={n(d.notes.unlocked)} sub="고1 13칸 다 채움 (전체)" />
              </div>
            </Block>
            <Block title="합격 생기부 퍼즐 · 쿠폰">
              <div className="grid grid-cols-3 gap-2">
                <Tile label="퍼즐 조각 연 횟수" value={n(d.puzzle.opens)} sub={`${n(d.puzzle.users)}명`} />
                <Tile label="쿠폰 나감 / 씀" value={`${n(d.coupons.issued)} / ${n(d.coupons.used)}`} />
                <Tile label="쓸 수 있는 쿠폰 (지금)" value={n(d.coupons.valid)} />
              </div>
            </Block>
          </div>

          <Block title="레벨 분포" note={`지금 기준 · ${n(lvTotal)}명`}>
            <div className="space-y-1.5 rounded-xl border border-gray-200 bg-white p-4">
              {(d.levels ?? []).map((x) => (
                <div key={x.stage_no} className="flex items-center gap-3 text-[13px]">
                  <span className="w-14 font-bold text-gray-700">{x.stage}</span>
                  <span className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full rounded-full" style={{ width: rate(x.n, lvTotal), background: STAGE_COLOR[x.stage_no - 1] }} />
                  </span>
                  <span className="w-24 text-right text-gray-600">
                    {n(x.n)}명 · {rate(x.n, lvTotal)}
                  </span>
                </div>
              ))}
            </div>
          </Block>

          <Block title="조각" note={`지금 학생들에게 남은 조각 ${n(d.pieces.balance)}개 · 반쪽 모아 둔 학생 ${n(d.pieces.halves)}명`}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full">
                  <thead>
                    <tr>
                      {["받은 이유", "조각", "학생"].map((h) => (
                        <th key={h} className={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(d.pieces.earned ?? []).map((x) => (
                      <tr key={x.mission}>
                        <td className={td}>{x.mission === "daily2" ? "출석 + 오늘 질문 (반쪽 2개)" : x.mission === "lvstage" ? "레벨 단계 보상" : x.title}</td>
                        <td className={`${td} font-bold`}>{n(x.amount)}</td>
                        <td className={td}>{n(x.users)}명</td>
                      </tr>
                    ))}
                    {!(d.pieces.earned ?? []).length && (
                      <tr>
                        <td className={`${td} text-gray-400`} colSpan={3}>이 기간에 나간 조각이 없어요</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="grid content-start gap-2">
                <Tile label="퍼즐 · 결제에 쓴 조각" value={n(d.pieces.spent)} />
                <Tile label="결제 할인에 쓴 조각" value={n(d.pieces.paid)} sub={`${n(Number(d.pieces.paid) * 50)}원 할인`} />
              </div>
            </div>
          </Block>

          <Block title="입시 칼럼" note="최근 20편 · 끝까지 읽은 학생 기준">
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr>
                    {["공개", "제목", "끝까지 읽음 (전체)", "이 기간", "댓글"].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.columns ?? []).map((c) => (
                    <tr key={c.id} className={c.hidden ? "opacity-50" : ""}>
                      <td className={td}>{fmt(c.publish_at)}</td>
                      <td className={`${td} max-w-[320px] truncate font-bold`}>
                        <Link to={`/columns/${c.id}`} className="hover:underline">{c.title}</Link>
                      </td>
                      <td className={`${td} font-bold text-sm-navy`}>{n(c.reads)}</td>
                      <td className={td}>{n(c.reads_range)}</td>
                      <td className={td}>{n(c.comments)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <Block title="입시설명회" note="최근 10개">
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr>
                    {["날짜", "제목", "신청 / 정원"].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(d.events ?? []).map((e) => (
                    <tr key={e.id}>
                      <td className={td}>{fmt(e.starts_at)}</td>
                      <td className={`${td} font-bold`}>{e.title}</td>
                      <td className={td}>
                        {n(e.applied)} / {n(e.capacity)}
                      </td>
                    </tr>
                  ))}
                  {!(d.events ?? []).length && (
                    <tr>
                      <td className={`${td} text-gray-400`} colSpan={3}>아직 만든 설명회가 없어요</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Block>
        </>
      )}
    </div>
  );
}