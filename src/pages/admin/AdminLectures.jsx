import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const EMPTY = {
  chapter_no: 1,
  chapter_title: "",
  title: "",
  sort_order: 1,
  duration_sec: 0,
  video_provider: "vimeo",
  video_key: "",
  is_free_preview: false,
};

export default function AdminLectures() {
  const { isMaster, loading: authLoading } = useAuth();

  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [lectures, setLectures] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase
      .from("courses")
      .select("id, title")
      .order("created_at")
      .then(({ data }) => {
        setCourses(data ?? []);
        if (data?.[0]) setCourseId(data[0].id);
      });
  }, []);

  async function load(id) {
    const { data, error } = await supabase
      .from("lectures")
      .select("*")
      .eq("course_id", id)
      .order("chapter_no")
      .order("sort_order");
    if (error) console.error("lectures", error);
    setLectures(data ?? []);
  }

  useEffect(() => {
    if (courseId) load(courseId);
  }, [courseId]);

  const set = (k) => (e) => {
    const v =
      e.target.type === "checkbox"
        ? e.target.checked
        : e.target.type === "number"
        ? Number(e.target.value)
        : e.target.value;
    setForm({ ...form, [k]: v });
  };

  function startEdit(l) {
    setEditId(l.id);
    setForm({
      chapter_no: l.chapter_no,
      chapter_title: l.chapter_title,
      title: l.title,
      sort_order: l.sort_order,
      duration_sec: l.duration_sec ?? 0,
      video_provider: l.video_provider ?? "vimeo",
      video_key: l.video_key ?? "",
      is_free_preview: l.is_free_preview ?? false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditId(null);
    // 같은 챕터로 연속 등록하는 경우가 많아 챕터 정보는 남긴다
    setForm({ ...EMPTY, chapter_no: form.chapter_no, chapter_title: form.chapter_title,
              sort_order: form.sort_order + 1 });
  }

  async function save() {
    if (!form.title.trim()) return setMsg("강의명을 입력해 주세요.");
    if (!form.chapter_title.trim()) return setMsg("챕터명을 입력해 주세요.");

    setBusy(true);
    setMsg("");
    const payload = { ...form, course_id: courseId, video_key: form.video_key.trim() || null };

    const { error } = editId
      ? await supabase.from("lectures").update(payload).eq("id", editId)
      : await supabase.from("lectures").insert(payload);

    setBusy(false);
    if (error) {
      console.error("save lecture", error);
      setMsg("저장하지 못했습니다. 권한(role=master)을 확인해 주세요.");
      return;
    }
    reset();
    load(courseId);
  }

  async function remove(l) {
    if (!confirm(`「${l.title}」을 삭제할까요? 학생 진도 기록도 함께 사라집니다.`)) return;
    const { error } = await supabase.from("lectures").delete().eq("id", l.id);
    if (error) {
      console.error("delete lecture", error);
      alert("삭제하지 못했습니다.");
      return;
    }
    if (editId === l.id) reset();
    load(courseId);
  }

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  if (!isMaster) {
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center">
        <p className="text-xl font-extrabold text-sm-navy">접근 권한이 없습니다</p>
        <Link to="/" className="mt-6 inline-block text-sm text-gray-400 underline">
          홈으로
        </Link>
      </div>
    );
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-sm-orange";

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">강의 관리</h1>

      <select
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
        className={`${input} mt-6`}
      >
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>

      {/* 등록 / 수정 폼 */}
      <section className="mt-6 rounded-xl border border-gray-200 p-6">
        <p className="text-base font-extrabold text-sm-navy">
          {editId ? "강의 수정" : "세부 강의 추가"}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-gray-500">챕터 번호 (1~6강)</label>
            <input type="number" min={1} className={input} value={form.chapter_no} onChange={set("chapter_no")} />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">챕터명</label>
            <input className={input} placeholder="인성 · 공동체역량" value={form.chapter_title} onChange={set("chapter_title")} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-gray-500">강의명</label>
            <input className={input} placeholder="면접관이 학생부에서 질문을 찾는 방법" value={form.title} onChange={set("title")} />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">챕터 내 순서</label>
            <input type="number" min={1} className={input} value={form.sort_order} onChange={set("sort_order")} />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">재생 시간 (초)</label>
            <input type="number" min={0} className={input} value={form.duration_sec} onChange={set("duration_sec")} />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">영상 제공사</label>
            <select className={input} value={form.video_provider} onChange={set("video_provider")}>
              <option value="vimeo">Vimeo</option>
              <option value="cloudflare">Cloudflare Stream</option>
              <option value="mux">Mux</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">영상 ID</label>
            <input className={input} placeholder="76979871" value={form.video_key} onChange={set("video_key")} />
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={form.is_free_preview} onChange={set("is_free_preview")} className="h-4 w-4 accent-orange-500" />
          맛보기로 공개 (수강신청 안 해도 볼 수 있음)
        </label>

        {msg && <p className="mt-3 text-sm font-semibold text-red-500">{msg}</p>}

        <div className="mt-5 flex gap-2">
          {editId && (
            <button onClick={reset} className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-bold text-gray-600">
              취소
            </button>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-lg bg-sm-orange py-3 text-sm font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "저장 중…" : editId ? "수정 저장" : "추가"}
          </button>
        </div>
      </section>

      {/* 목록 */}
      <section className="mt-8">
        <p className="text-base font-extrabold text-sm-navy">등록된 강의 {lectures.length}개</p>

        {lectures.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 py-16 text-center text-sm text-gray-400">
            아직 등록된 강의가 없습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {lectures.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="w-16 shrink-0 text-xs font-bold text-sm-orange">
                  {l.chapter_no}-{l.sort_order}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-sm-navy">
                    {l.title}
                    {l.is_free_preview && (
                      <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">
                        맛보기
                      </span>
                    )}
                    {!l.video_key && (
                      <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-500">
                        영상 없음
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {l.chapter_title} · {l.video_provider} {l.video_key ?? ""}
                  </p>
                </div>
                <button onClick={() => startEdit(l)} className="text-xs font-semibold text-gray-500 hover:text-sm-orange">
                  수정
                </button>
                <button onClick={() => remove(l)} className="text-xs font-semibold text-gray-400 hover:text-red-500">
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}