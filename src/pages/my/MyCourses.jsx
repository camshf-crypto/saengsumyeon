import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const WORKBOOK_SLUG = "workbook-pack"; // 교재용 course는 강의 목록에서 뺀다
const ymd = (d) => (d ? new Date(d).toLocaleDateString("ko-KR").replace(/\.$/, "") : "-");

function daysLeft(expiresAt) {
  return Math.max(Math.ceil((new Date(expiresAt) - new Date()) / 86400000), 0);
}

export default function MyCourses() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("active"); // active | ended
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    (async () => {
      // 만료된 것도 함께 가져와 탭으로 나눈다
      const { data: enrolls, error } = await supabase
        .from("enrollments")
        .select("id, course_id, starts_at, expires_at, status, courses(slug, title)")
        .eq("user_id", user.id)
        .order("expires_at", { ascending: false });

      if (error) console.error("enrollments", error);

      const list = (enrolls ?? []).filter((e) => e.courses?.slug !== WORKBOOK_SLUG);
      if (list.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const courseIds = list.map((e) => e.course_id);
      const { data: lectures } = await supabase
        .from("lectures")
        .select("id, course_id")
        .in("course_id", courseIds);

      const lectureIds = (lectures ?? []).map((l) => l.id);
      let doneIds = [];
      if (lectureIds.length > 0) {
        const { data: prog } = await supabase
          .from("lecture_progress")
          .select("lecture_id")
          .eq("user_id", user.id)
          .eq("is_completed", true)
          .in("lecture_id", lectureIds);
        doneIds = (prog ?? []).map((p) => p.lecture_id);
      }

      setRows(
        list.map((e) => {
          const mine = (lectures ?? []).filter((l) => l.course_id === e.course_id);
          const done = mine.filter((l) => doneIds.includes(l.id)).length;
          const left = daysLeft(e.expires_at);
          return {
            ...e,
            total: mine.length,
            done,
            rate: mine.length ? Math.round((done / mine.length) * 100) : 0,
            left,
            ended: left === 0 || e.status !== "active",
          };
        })
      );
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  const active = rows.filter((r) => !r.ended);
  const ended = rows.filter((r) => r.ended);
  const shown = tab === "active" ? active : ended;

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">내 강의</h1>

      {/* 상태 탭 */}
      <div className="mt-5 flex gap-2">
        {[
          ["active", `수강중인 강의 (${active.length})`],
          ["ended", `수강종료 강의 (${ended.length})`],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-4 py-2 text-[13px] font-bold transition ${
              tab === k
                ? "border-sm-navy bg-sm-navy text-white"
                : "border-gray-300 text-gray-500 hover:text-sm-navy"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {shown.length === 0 ? (
        <div className="mt-5 rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-sm text-gray-500">
            {tab === "active" ? "수강 중인 강의가 없습니다." : "수강이 종료된 강의가 없습니다."}
          </p>
          {tab === "active" && (
            <Link
              to="/"
              className="mt-4 inline-block rounded-lg bg-sm-orange px-6 py-3 text-sm font-extrabold text-white"
            >
              강의 보러 가기
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-xl border border-gray-200">
          {/* 헤더 */}
          <div className="hidden border-b border-gray-100 bg-gray-50 px-5 py-3 text-xs font-bold text-gray-500 sm:grid sm:grid-cols-[1fr_150px_120px]">
            <span>강의명</span>
            <span>진도</span>
            <span className="text-right">수강</span>
          </div>

          <ul className="divide-y divide-gray-100">
            {shown.map((r) => (
              <li key={r.id} className="px-5 py-5 sm:grid sm:grid-cols-[1fr_150px_120px] sm:items-center sm:gap-4">
                {/* 강의명 + 기간 */}
                <div className="min-w-0">
                  <p className="truncate font-bold tracking-tight text-sm-navy">{r.courses?.title}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {ymd(r.starts_at)} ~ {ymd(r.expires_at)}
                    {r.ended ? (
                      <span className="ml-2 text-gray-400">[수강종료]</span>
                    ) : (
                      <span className={`ml-2 font-bold ${r.left <= 7 ? "text-red-500" : "text-gray-500"}`}>
                        [잔여수강일: {r.left}일]
                      </span>
                    )}
                  </p>
                </div>

                {/* 진도 */}
                <div className="mt-3 sm:mt-0">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${r.ended ? "bg-gray-300" : "bg-sm-orange"}`}
                        style={{ width: `${r.rate}%` }}
                      />
                    </div>
                    <span className={`text-xs font-bold ${r.ended ? "text-gray-400" : "text-sm-orange"}`}>
                      {r.rate}%
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {r.done}/{r.total}강
                  </p>
                </div>

                {/* 버튼 */}
                <div className="mt-4 sm:mt-0 sm:text-right">
                  {r.ended ? (
                    <span className="text-xs text-gray-400">기간 만료</span>
                  ) : (
                    <Link
                      to={`/my/course/${r.course_id}`}
                      className="inline-block rounded-lg bg-sm-orange px-4 py-2.5 text-xs font-extrabold text-white"
                    >
                      {r.done > 0 ? "이어서 수강" : "수강 시작"}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}