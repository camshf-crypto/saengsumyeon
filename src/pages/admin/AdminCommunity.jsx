import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 — 커뮤니티 (/admin/community)
 *   설명회: 만들기 · 고치기 · 신청 학생 명단
 *   글 관리: 최근 게시판 글 · 댓글 · 나만 그래? 댓글 → 숨기기 / 다시 보이기 · 쓴 학생 7일 정지
 */

function toLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmt(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EV_EMPTY = { id: null, title: "", starts_at: "", minutes: 60, capacity: 50, min_level: 16, place: "줌", join_url: "", open: true };

/* ───────── 설명회 ───────── */

function Events() {
  const [list, setList] = useState([]);
  const [f, setF] = useState(EV_EMPTY);
  const [msg, setMsg] = useState("");
  const [roster, setRoster] = useState(null); // { id, title, students }

  const load = () => supabase.rpc("ev_admin_events").then(({ data }) => setList(data || []));
  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (!f.title.trim() || !f.starts_at) return setMsg("제목과 날짜를 적어 주세요");
    const p = { ...f, starts_at: new Date(f.starts_at).toISOString(), minutes: Number(f.minutes), capacity: Number(f.capacity), min_level: Number(f.min_level) };
    if (!p.id) delete p.id;
    const { data, error } = await supabase.rpc("ev_admin_save", { p });
    if (error) return setMsg(error.message);
    setF((x) => ({ ...x, id: data }));
    setMsg("저장했어요");
    load();
  }

  async function openRoster(ev) {
    const { data } = await supabase.rpc("ev_admin_list", { p_event: ev.id });
    setRoster({ id: ev.id, title: ev.title, students: data?.students || [] });
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-[14px] outline-none focus:border-sm-navy";
  const label = "mb-1 block text-[12.5px] font-bold text-gray-600";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <form onSubmit={save} className="grid gap-3.5 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center">
          <b className="text-[15px] text-gray-900">{f.id ? `설명회 고치기 #${f.id}` : "새 설명회"}</b>
          {f.id && (
            <button type="button" onClick={() => { setF(EV_EMPTY); setMsg(""); }} className="ml-auto text-[13px] font-semibold text-gray-500">
              + 새로 만들기
            </button>
          )}
        </div>
        <div><span className={label}>제목</span><input value={f.title} onChange={set("title")} placeholder="11월 생수면 입시설명회 · 5등급제 첫 세대, 생기부로 이기는 법" className={input} /></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="col-span-2"><span className={label}>날짜 · 시간</span><input type="datetime-local" value={f.starts_at} onChange={set("starts_at")} className={input} /></div>
          <div><span className={label}>시간(분)</span><input type="number" value={f.minutes} onChange={set("minutes")} className={input} /></div>
          <div><span className={label}>정원(가정)</span><input type="number" value={f.capacity} onChange={set("capacity")} className={input} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div><span className={label}>신청 레벨</span><input type="number" value={f.min_level} onChange={set("min_level")} className={input} /></div>
          <div><span className={label}>장소</span><input value={f.place} onChange={set("place")} className={input} /></div>
          <div className="col-span-2"><span className={label}>줌 주소 (시작 1시간 전부터 신청 학생에게 보여요)</span><input value={f.join_url || ""} onChange={set("join_url")} placeholder="https://zoom.us/j/..." className={input} /></div>
        </div>
        <label className="flex items-center gap-2 text-[13.5px] text-gray-700">
          <input type="checkbox" checked={f.open} onChange={set("open")} /> 학생에게 보이기
        </label>
        <div className="flex items-center gap-3">
          <button className="rounded-lg bg-sm-navy px-6 py-3 text-[14.5px] font-bold text-white">저장</button>
          {msg && <span className="text-[13.5px] font-semibold text-sm-orange">{msg}</span>}
        </div>
      </form>

      <div className="grid content-start gap-2">
        <b className="text-[14px] text-gray-700">설명회 {list.length}개</b>
        {list.map((ev) => (
          <div key={ev.id} className="rounded-xl border border-gray-200 bg-white p-3.5">
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className={`rounded px-1.5 py-0.5 font-bold ${!ev.open ? "bg-gray-100 text-gray-500" : new Date(ev.starts_at) < new Date() ? "bg-gray-100 text-gray-500" : "bg-emerald-50 text-emerald-700"}`}>
                {!ev.open ? "숨김" : new Date(ev.starts_at) < new Date() ? "지남" : "모집 중"}
              </span>
              <span className="text-gray-500">{fmt(ev.starts_at)}</span>
              <span className="ml-auto font-bold text-gray-700">{ev.applied}/{ev.capacity}</span>
            </div>
            <b className="mt-1.5 block text-[14px] font-semibold leading-snug text-gray-900">{ev.title}</b>
            <div className="mt-2 flex gap-3 text-[12.5px] font-semibold">
              <button onClick={() => setF({ ...EV_EMPTY, ...ev, starts_at: toLocal(ev.starts_at), join_url: ev.join_url || "" })} className="text-gray-500 hover:text-sm-navy">고치기</button>
              <button onClick={() => openRoster(ev)} className="text-gray-500 hover:text-sm-navy">신청 명단</button>
            </div>
          </div>
        ))}
      </div>

      {roster && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setRoster(null)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center">
              <b className="text-[15px] text-gray-900">신청 명단 · {roster.students.length}명</b>
              <button onClick={() => setRoster(null)} className="ml-auto text-[13px] text-gray-500">닫기</button>
            </div>
            <p className="mt-1 text-[12.5px] text-gray-500">{roster.title}</p>
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[12px] text-gray-500">
                  <th className="py-2">닉네임</th><th>레벨</th><th>이메일</th><th>신청</th>
                </tr>
              </thead>
              <tbody>
                {roster.students.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 font-semibold">{s.nick}</td>
                    <td>Lv.{s.level}</td>
                    <td className="text-gray-600">{s.email}</td>
                    <td className="text-gray-500">{fmt(s.applied_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 글 관리 ───────── */

const KINDS = [
  { key: "post", label: "게시판 글" },
  { key: "comment", label: "게시판 · 칼럼 댓글" },
  { key: "mg_comment", label: "나만 그래? 댓글" },
];

function Moderation() {
  const [kind, setKind] = useState("post");
  const [list, setList] = useState(null);

  const load = () => supabase.rpc("admin_recent", { p_kind: kind, p_limit: 100 }).then(({ data }) => setList(data || []));
  useEffect(() => {
    setList(null);
    load();
  }, [kind]);

  async function toggle(r) {
    const { error } = await supabase.rpc("admin_set_hidden", { p_kind: kind, p_id: r.id, p_hidden: !r.hidden });
    if (error) return window.alert(error.message);
    load();
  }

  async function clearPhoto(r) {
    if (!window.confirm(`${r.nick} 학생의 프로필 사진을 지울까요?`)) return;
    const { error } = await supabase.rpc("admin_clear_avatar", { p_user: r.user_id });
    if (error) return window.alert(error.message);
    load();
  }

  async function ban(r, days) {
    const ok = window.confirm(days ? `${r.nick} 학생을 ${days}일 동안 글·댓글 금지할까요?` : `${r.nick} 학생 정지를 풀까요?`);
    if (!ok) return;
    const { error } = await supabase.rpc("admin_ban", { p_user: r.user_id, p_days: days });
    if (error) return window.alert(error.message);
    load();
  }

  return (
    <div>
      <div className="flex gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${kind === k.key ? "border-sm-navy bg-sm-navy text-white" : "border-gray-200 bg-white text-gray-600"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4">
        {list === null && <p className="py-10 text-center text-gray-500">불러오는 중…</p>}
        {list?.length === 0 && <p className="py-10 text-center text-gray-500">아직 없어요</p>}
        {list?.map((r) => {
          const banned = r.banned_until && new Date(r.banned_until) > new Date();
          return (
            <div key={r.id} className={`flex gap-3 border-b border-gray-100 py-3.5 last:border-0 ${r.hidden ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px] text-gray-500">
                  {r.avatar && <img src={r.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />}
                  <b className="text-gray-800">{r.nick}</b>
                  <span>{fmt(r.created_at)}</span>
                  <span>{r.title}</span>
                  {r.hidden && <span className="rounded bg-gray-100 px-1.5 font-bold">숨김</span>}
                  {banned && <span className="rounded bg-red-50 px-1.5 font-bold text-red-600">정지 ~{fmt(r.banned_until)}</span>}
                </div>
                <p className="mt-1 whitespace-pre-line text-[13.5px] text-gray-800">{r.body}</p>
              </div>
              <div className="flex flex-none flex-col items-end gap-1.5 text-[12.5px] font-semibold">
                <button onClick={() => toggle(r)} className={r.hidden ? "text-sm-navy" : "text-red-600"}>
                  {r.hidden ? "다시 보이기" : "숨기기"}
                </button>
                {r.avatar && (
                  <button onClick={() => clearPhoto(r)} className="text-gray-500">사진 지우기</button>
                )}
                {banned ? (
                  <button onClick={() => ban(r, 0)} className="text-gray-500">정지 풀기</button>
                ) : (
                  <button onClick={() => ban(r, 7)} className="text-gray-500">7일 정지</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── 화면 ───────── */

export default function AdminCommunity() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(null);
  const [tab, setTab] = useState("events");

  useEffect(() => {
    if (!user) return setIsAdmin(false);
    supabase.rpc("sm_is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, [user?.id]);

  if (loading || isAdmin === null) return <div className="py-24 text-center text-gray-500">확인 중…</div>;
  if (!isAdmin) return <div className="py-24 text-center text-gray-500">관리자만 볼 수 있어요</div>;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-20 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-[22px] font-bold text-sm-navy">커뮤니티 관리</h1>
        <Link to="/admin" className="text-[13px] font-semibold text-gray-500">‹ 관리자</Link>
        <Link to="/admin/columns" className="ml-auto text-[13px] font-semibold text-gray-500">입시 칼럼 관리 ›</Link>
      </div>
      <div className="mt-5 flex gap-1 border-b border-gray-200">
        {[
          ["events", "설명회"],
          ["mod", "글 관리"],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2.5 text-[14.5px] font-bold ${tab === k ? "border-sm-navy text-sm-navy" : "border-transparent text-gray-400"}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="mt-5">{tab === "events" ? <Events /> : <Moderation />}</div>
    </div>
  );
}