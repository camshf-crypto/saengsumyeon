import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const DAILY_LIMIT = 3;

function verdictOf(score) {
  if (score == null) return "";
  if (score >= 85) return "아주 흔해요";
  if (score >= 65) return "흔한 편이에요";
  if (score >= 45) return "조금 흔해요";
  if (score >= 25) return "괜찮은 편이에요";
  return "드문 편이에요";
}

export default function MyPage() {
  const nav = useNavigate();
  const { user, profile, loading: authLoading } = useAuth();

  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let alive = true;

    (async () => {
      const { data, error } = await supabase.rpc("my_topic_queries");
      if (!alive) return;
      setBusy(false);
      if (error) {
        console.error("my queries failed", error);
        setErr("기록을 불러오지 못했습니다.");
        return;
      }
      setRows(data ?? []);
    })();

    return () => {
      alive = false;
    };
  }, [authLoading, user]);

  // 최근 24시간 사용 횟수
  const usedToday = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return rows.filter((r) => new Date(r.created_at).getTime() >= since).length;
  }, [rows]);

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-lg font-bold text-sm-navy">로그인이 필요합니다</p>
        <Link
          to="/login"
          className="mt-6 inline-block rounded-lg bg-sm-navy px-6 py-3 text-sm font-bold text-white"
        >
          로그인하기
        </Link>
      </div>
    );
  }

  const left = Math.max(0, DAILY_LIMIT - usedToday);

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-sm font-bold text-sm-orange">마이페이지</p>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">
        {profile?.name ?? "회원"}님이 진단한 탐구주제
      </h1>

      {/* 남은 횟수 */}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-gray-200 p-5">
        <div>
          <p className="text-[12.5px] text-gray-500">오늘 남은 진단</p>
          <p className="mt-1 text-lg font-extrabold text-sm-navy">
            {left}회 <span className="text-[13px] font-semibold text-gray-400">/ {DAILY_LIMIT}회</span>
          </p>
        </div>
        <button
          onClick={() => nav("/")}
          disabled={left === 0}
          className="rounded-lg bg-sm-orange px-4 py-2.5 text-[14px] font-bold text-white disabled:opacity-40"
        >
          {left === 0 ? "내일 다시" : "새로 진단하기"}
        </button>
      </div>

      {err && <p className="mt-5 text-sm font-semibold text-red-500">{err}</p>}

      {/* 목록 */}
      <div className="mt-6 space-y-2.5">
        {busy && <p className="py-16 text-center text-sm text-gray-400">불러오는 중…</p>}

        {!busy && !rows.length && (
          <div className="rounded-xl border border-gray-200 py-16 text-center">
            <p className="text-sm text-gray-500">아직 진단한 주제가 없어요.</p>
            <button
              onClick={() => nav("/")}
              className="mt-5 rounded-lg bg-sm-navy px-5 py-2.5 text-[14px] font-bold text-white"
            >
              첫 진단 시작하기
            </button>
          </div>
        )}

        {rows.map((r) => {
          const open = openId === r.id;
          const sug = r.result?.suggestion;
          return (
            <div key={r.id} className="overflow-hidden rounded-xl border border-gray-200">
              <button
                onClick={() => setOpenId(open ? null : r.id)}
                className="flex w-full items-start gap-3 p-5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-bold text-sm-orange">
                    {r.department} · {r.grade}
                    {r.term ? ` ${r.term}` : ""} · {r.subject}
                  </p>
                  <p className="mt-1.5 text-[15px] font-bold leading-relaxed text-sm-navy">
                    {r.topic}
                  </p>
                  <p className="mt-1.5 text-[11.5px] text-gray-400">
                    {new Date(r.created_at).toLocaleDateString("ko-KR")}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-xl font-black leading-none text-sm-orange">
                    {r.score ?? "-"}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400">{verdictOf(r.score)}</p>
                </div>
              </button>

              {open && (
                <div className="border-t border-gray-100 bg-gray-50 p-5">
                  {r.result?.reason ? (
                    <>
                      <p className="text-[13px] font-bold text-sm-navy">왜 흔한 주제일까?</p>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
                        {r.result.reason}
                      </p>
                    </>
                  ) : (
                    <p className="text-[13.5px] text-gray-400">
                      이 진단에는 상세 내용이 저장되지 않았어요.
                    </p>
                  )}

                  {sug && (
                    <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
                      <p className="text-[11.5px] font-bold text-sm-orange">이렇게 바꿔보세요</p>
                      <p className="mt-2 text-[15px] font-bold leading-relaxed text-sm-navy">
                        {sug.topic}
                      </p>
                      {sug.how && (
                        <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{sug.how}</p>
                      )}
                      <p className="mt-3 border-t border-orange-200 pt-3 text-[12.5px] text-gray-500">
                        흔함 지수 <b className="text-gray-400">{r.score}</b> →{" "}
                        <b className="text-[16px] text-sm-orange">{sug.score}</b>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}