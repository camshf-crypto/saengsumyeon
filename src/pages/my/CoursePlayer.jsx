import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Player from "@vimeo/player";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const mmss = (sec) => {
  const s = Math.max(Math.round(sec ?? 0), 0);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function CoursePlayer() {
  const { courseId } = useParams();
  const { user } = useAuth();

  const [course, setCourse] = useState(null);
  const [lectures, setLectures] = useState([]);
  const [progress, setProgress] = useState({}); // lecture_id -> {played_sec, is_completed}
  const [current, setCurrent] = useState(null);
  const [open, setOpen] = useState([]); // 펼친 챕터 번호
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const boxRef = useRef(null);
  const playerRef = useRef(null);
  const lastSaved = useRef(0);

  /* ── 데이터 로드 ─────────────────────────────────────── */
  useEffect(() => {
    if (!user) return;

    (async () => {
      const { data: enr } = await supabase
        .from("enrollments")
        .select("id, expires_at")
        .eq("user_id", user.id)
        .eq("course_id", courseId)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!enr) {
        setDenied(true);
        setLoading(false);
        return;
      }

      const [{ data: c }, { data: ls }] = await Promise.all([
        supabase.from("courses").select("title, description").eq("id", courseId).maybeSingle(),
        supabase
          .from("lectures")
          .select("id, chapter_no, chapter_title, title, sort_order, duration_sec, video_provider, video_key")
          .eq("course_id", courseId)
          .order("chapter_no")
          .order("sort_order"),
      ]);

      const list = ls ?? [];
      const { data: prog } = await supabase
        .from("lecture_progress")
        .select("lecture_id, played_sec, is_completed")
        .eq("user_id", user.id)
        .in("lecture_id", list.map((l) => l.id).length ? list.map((l) => l.id) : ["-"]);

      const map = {};
      (prog ?? []).forEach((p) => (map[p.lecture_id] = p));

      setCourse(c ?? null);
      setLectures(list);
      setProgress(map);

      // 안 끝낸 첫 강의부터 이어서
      const next = list.find((l) => !map[l.id]?.is_completed) ?? list[0] ?? null;
      setCurrent(next);
      setOpen(next ? [next.chapter_no] : []);
      setLoading(false);
    })();
  }, [user, courseId]);

  /* ── 플레이어 ────────────────────────────────────────── */
  useEffect(() => {
    if (!current?.video_key || !boxRef.current) return;

    const player = new Player(boxRef.current, {
      id: current.video_key,
      responsive: true,
      playsinline: true,
    });
    playerRef.current = player;
    lastSaved.current = 0;

    // 보던 지점부터
    const seen = progress[current.id]?.played_sec ?? 0;
    if (seen > 5) player.setCurrentTime(seen).catch(() => {});

    async function save(sec, done) {
      await supabase.from("lecture_progress").upsert(
        {
          user_id: user.id,
          lecture_id: current.id,
          played_sec: Math.round(sec),
          is_completed: done || (progress[current.id]?.is_completed ?? false),
          last_played_at: new Date().toISOString(),
        },
        { onConflict: "user_id,lecture_id" }
      );
      setProgress((p) => ({
        ...p,
        [current.id]: {
          played_sec: Math.round(sec),
          is_completed: done || (p[current.id]?.is_completed ?? false),
        },
      }));
    }

    // 15초마다 한 번만 저장 (timeupdate는 초당 여러 번 들어온다)
    player.on("timeupdate", ({ seconds, percent }) => {
      if (seconds - lastSaved.current < 15) return;
      lastSaved.current = seconds;
      save(seconds, percent >= 0.9);
    });

    player.on("ended", ({ duration }) => save(duration, true));

    return () => {
      // 나가기 전 마지막 지점 저장
      player.getCurrentTime().then((s) => s > 5 && save(s, false)).catch(() => {});
      player.destroy().catch(() => {});
      playerRef.current = null;
    };
  }, [current?.id]);

  /* ── 화면 ────────────────────────────────────────────── */
  if (loading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  if (denied) {
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center">
        <p className="text-xl font-extrabold text-sm-navy">수강 권한이 없습니다</p>
        <p className="mt-3 text-sm text-gray-500">
          수강 기간이 지났거나 신청하지 않은 강의입니다.
        </p>
        <Link
          to="/my"
          className="mt-8 inline-block rounded-lg bg-sm-orange px-6 py-3 text-sm font-extrabold text-white"
        >
          나의 강의실로
        </Link>
      </div>
    );
  }

  // 챕터별로 묶기
  const chapters = [];
  lectures.forEach((l) => {
    let ch = chapters.find((c) => c.no === l.chapter_no);
    if (!ch) {
      ch = { no: l.chapter_no, title: l.chapter_title, items: [] };
      chapters.push(ch);
    }
    ch.items.push(l);
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Link to="/my" className="text-sm text-gray-400 hover:text-sm-orange">
        ← 나의 강의실
      </Link>
      <h1 className="mt-3 text-xl font-extrabold tracking-tight text-sm-navy">{course?.title}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* 플레이어 */}
        <div>
          {current?.video_key ? (
            <div className="overflow-hidden rounded-xl bg-black">
              <div ref={boxRef} />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-400">
              아직 영상이 등록되지 않았습니다
            </div>
          )}

          {current && (
            <div className="mt-4">
              <p className="text-xs font-bold text-sm-orange">
                {current.chapter_no}강 · {current.chapter_title}
              </p>
              <p className="mt-1 text-lg font-extrabold tracking-tight text-sm-navy">
                {current.title}
              </p>
            </div>
          )}
        </div>

        {/* 목차 */}
        <aside className="rounded-xl border border-gray-200">
          <div className="border-b border-gray-100 px-5 py-4 text-sm font-extrabold text-sm-navy">
            커리큘럼 {lectures.length}강
          </div>

          {chapters.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-gray-400">
              등록된 강의가 없습니다.
            </p>
          )}

          <ul className="max-h-[560px] overflow-y-auto">
            {chapters.map((ch) => {
              const opened = open.includes(ch.no);
              const done = ch.items.filter((l) => progress[l.id]?.is_completed).length;
              return (
                <li key={ch.no} className="border-b border-gray-100 last:border-0">
                  <button
                    onClick={() =>
                      setOpen(opened ? open.filter((n) => n !== ch.no) : [...open, ch.no])
                    }
                    className="flex w-full items-center justify-between px-5 py-3.5 text-left"
                  >
                    <span className="text-sm font-bold text-sm-navy">
                      {ch.no}강 {ch.title}
                    </span>
                    <span className="text-xs text-gray-400">
                      {done}/{ch.items.length}
                    </span>
                  </button>

                  {opened && (
                    <ul className="pb-2">
                      {ch.items.map((l) => {
                        const on = current?.id === l.id;
                        const fin = progress[l.id]?.is_completed;
                        return (
                          <li key={l.id}>
                            <button
                              onClick={() => setCurrent(l)}
                              className={`flex w-full items-center gap-2 px-5 py-2.5 text-left text-[13px] ${
                                on ? "bg-orange-50 font-bold text-sm-orange" : "text-gray-600"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  fin ? "bg-sm-orange" : "bg-gray-300"
                                }`}
                              />
                              <span className="flex-1">{l.title}</span>
                              <span className="text-xs text-gray-400">{mmss(l.duration_sec)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}