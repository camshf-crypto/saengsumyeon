import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 — 입시 칼럼 쓰기 (/admin/columns)
 * 공개 시각을 미래로 두면 '예약' → 그 시각에 자동 공개 (물결 Lv.11 이상은 하루 먼저 봄)
 * 본문: 빈 줄 = 문단, "## " = 소제목, "> " = 강조 문장
 */

const EMPTY = {
  id: null,
  series: "",
  series_no: "",
  title: "",
  summary: "",
  body: "",
  checklist: "",
  cta: "interview",
  thumb: "",
  minutes: 3,
  publish_at: "",
  hidden: false,
};

// 다음 화 · 목 오후 5시 (한국 시간) → datetime-local 값
function nextSlot() {
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 17, 0, 0);
    if ((t.getDay() === 2 || t.getDay() === 4) && t > d) return toLocal(t);
  }
  return toLocal(new Date(d.getTime() + 86400000));
}
function toLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmt(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS_COLOR = { 공개: "bg-emerald-50 text-emerald-700", 예약: "bg-indigo-50 text-indigo-700", 숨김: "bg-gray-100 text-gray-500" };

export default function AdminColumns() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(null);
  const [list, setList] = useState([]);
  const [f, setF] = useState({ ...EMPTY, publish_at: nextSlot() });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () => supabase.rpc("col_admin_list").then(({ data }) => setList(data || []));

  useEffect(() => {
    if (!user) return setIsAdmin(false);
    supabase.rpc("sm_is_admin").then(({ data }) => {
      setIsAdmin(Boolean(data));
      if (data) load();
    });
  }, [user?.id]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function edit(c) {
    setF({
      id: c.id,
      series: c.series || "",
      series_no: c.series_no ?? "",
      title: c.title,
      summary: c.summary || "",
      body: c.body || "",
      checklist: (c.checklist || []).join("\n"),
      cta: c.cta || "",
      thumb: c.thumb || "",
      minutes: c.minutes,
      publish_at: toLocal(new Date(c.publish_at)),
      hidden: c.hidden,
    });
    setMsg("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e) {
    e.preventDefault();
    if (!f.title.trim()) return setMsg("제목을 적어 주세요");
    setSaving(true);
    const p = {
      ...f,
      series: f.series.trim() || null,
      series_no: f.series_no === "" ? null : Number(f.series_no),
      checklist: f.checklist.split("\n").map((s) => s.trim()).filter(Boolean),
      minutes: Number(f.minutes) || 3,
      publish_at: new Date(f.publish_at).toISOString(),
    };
    if (!p.id) delete p.id;
    const { data, error } = await supabase.rpc("col_admin_save", { p });
    setSaving(false);
    if (error) return setMsg(error.message);
    setMsg(new Date(f.publish_at) > new Date() ? `저장했어요 · ${fmt(p.publish_at)}에 공개돼요` : "저장했어요 · 지금 공개 중");
    setF((x) => ({ ...x, id: data }));
    load();
  }

  if (loading || isAdmin === null) return <div className="py-24 text-center text-gray-500">확인 중…</div>;
  if (!isAdmin) return <div className="py-24 text-center text-gray-500">관리자만 볼 수 있어요</div>;

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-[14px] outline-none focus:border-sm-navy";
  const label = "mb-1 block text-[12.5px] font-bold text-gray-600";

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-[22px] font-bold text-sm-navy">입시 칼럼 관리</h1>
        <Link to="/admin" className="text-[13px] font-semibold text-gray-500">‹ 관리자</Link>
        <Link to="/columns" className="ml-auto text-[13px] font-semibold text-gray-500">학생 화면 보기 ›</Link>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* 쓰기 */}
        <form onSubmit={save} className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <b className="text-[15px] text-gray-900">{f.id ? `칼럼 고치기 #${f.id}` : "새 칼럼"}</b>
            {f.id && (
              <button type="button" onClick={() => { setF({ ...EMPTY, publish_at: nextSlot() }); setMsg(""); }} className="text-[13px] font-semibold text-gray-500">
                + 새로 쓰기
              </button>
            )}
          </div>

          <div className="grid grid-cols-[1fr_90px_90px] gap-2">
            <div><span className={label}>시리즈</span><input value={f.series} onChange={set("series")} placeholder="면접관 시선" className={input} /></div>
            <div><span className={label}>몇 편</span><input type="number" value={f.series_no} onChange={set("series_no")} className={input} /></div>
            <div><span className={label}>읽는 시간(분)</span><input type="number" value={f.minutes} onChange={set("minutes")} className={input} /></div>
          </div>

          <div><span className={label}>제목</span><input value={f.title} onChange={set("title")} placeholder="면접관이 세특에서 제일 먼저 보는 한 줄" className={input} /></div>
          <div><span className={label}>한 줄 요약 (목록 · 본문 위에 보여요)</span><input value={f.summary} onChange={set("summary")} className={input} /></div>

          <div>
            <span className={label}>본문 — 빈 줄로 문단 나누기 · "## 소제목" · "&gt; 강조 문장"</span>
            <textarea value={f.body} onChange={set("body")} rows={14} className={`${input} leading-relaxed`} />
          </div>

          <div>
            <span className={label}>끝 체크리스트 (한 줄에 하나, 회원만 보여요)</span>
            <textarea value={f.checklist} onChange={set("checklist")} rows={4} placeholder={"자료 정리 말고, 내가 직접 한 일이 한 줄이라도 있다\n예상과 달랐던 결과를 적었다"} className={input} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_120px_1fr]">
            <div>
              <span className={label}>끝 버튼 (관련 서비스)</span>
              <select value={f.cta} onChange={set("cta")} className={input}>
                <option value="interview">생기부 예상질문</option>
                <option value="topic">탐구주제 흔한가</option>
                <option value="reading">독서 흔한가</option>
                <option value="motive">지원동기 흔한가</option>
                <option value="">없음</option>
              </select>
            </div>
            <div><span className={label}>목록 그림</span><input value={f.thumb} onChange={set("thumb")} placeholder="🎯 또는 이미지 주소" className={input} /></div>
            <div className="col-span-2 sm:col-span-1">
              <span className={label}>공개 시각</span>
              <input type="datetime-local" value={f.publish_at} onChange={set("publish_at")} className={input} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13.5px] text-gray-700">
            <input type="checkbox" checked={f.hidden} onChange={set("hidden")} /> 숨기기 (학생에게 안 보임)
          </label>

          <div className="flex items-center gap-3">
            <button disabled={saving} className="rounded-lg bg-sm-navy px-6 py-3 text-[14.5px] font-bold text-white disabled:opacity-50">
              {saving ? "저장 중…" : "저장"}
            </button>
            {msg && <span className="text-[13.5px] font-semibold text-sm-orange">{msg}</span>}
          </div>
        </form>

        {/* 목록 */}
        <div>
          <b className="text-[14px] text-gray-700">칼럼 {list.length}개</b>
          <div className="mt-2 grid gap-2">
            {list.map((c) => (
              <button key={c.id} onClick={() => edit(c)} className={`rounded-xl border bg-white p-3.5 text-left hover:border-sm-navy ${f.id === c.id ? "border-sm-navy" : "border-gray-200"}`}>
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className={`rounded px-1.5 py-0.5 font-bold ${STATUS_COLOR[c.status]}`}>{c.status}</span>
                  <span className="text-gray-500">{fmt(c.publish_at)}</span>
                  <span className="ml-auto text-gray-500">읽음 {c.reads}</span>
                </div>
                <b className="mt-1.5 block text-[14px] font-semibold leading-snug text-gray-900">{c.title}</b>
                {c.series && <small className="text-[12px] text-gray-500">{c.series} {c.series_no}편</small>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}