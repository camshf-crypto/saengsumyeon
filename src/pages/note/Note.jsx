import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";

/*
 * 내 생기부 노트 (/my/note)
 * 학년 · 영역별로 내 활동을 한 줄씩 쌓는다 (학기 구분 없음). 생기부 예상질문에서 넣은 활동도 같이 보인다
 * 고1 13칸(교과 세특 10과목 + 자율 · 동아리 · 진로) 중 10칸 이상 채우면 AI 입시 방향 진단이 열린다 (13칸 다 채우면 더 정확)
 * 세특 과목 수: 고1 10 · 고2 10 · 고3 6 (고3은 1학기까지만 반영)
 * 독서는 대입에 반영되지 않아 선택 (적으면 진단에 참고만)
 */

const GRADES = ["고1", "고2", "고3"];
const KINDS = [
  { key: "subject", label: "교과 세특" },
  { key: "autonomy", label: "자율" },
  { key: "club", label: "동아리" },
  { key: "career", label: "진로" },
  { key: "book", label: "독서", optional: true },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
const NEED_SUBJECTS = { 고1: 10, 고2: 10, 고3: 6 }; // 학년별 세특 과목 수
const UNLOCK_GRADE = "고1"; // 이 학년 칸으로 진단을 연다
const UNLOCK_AT = 10; // 13칸 중 이만큼 채우면 진단이 열린다 (서버 note_diagnose 와 같게)

const PLACEHOLDER = {
  subject: "예) 손 소독제 농도별로 세균 배양을 비교하는 실험을 하고 보고서를 씀",
  club: "예) 보건 동아리에서 교내 손 씻기 캠페인 포스터를 만들고 발표함",
  career: "예) 간호사 직업 인터뷰를 하고 3교대 근무의 어려움을 정리함",
  autonomy: "예) 학급 건강 도우미로 보건실 안내 게시판을 관리함",
  book: "책 제목",
};

// 한 학년이 얼마나 채워졌는지 — 세특은 서로 다른 과목 수로 센다
function progressOf(list, grade) {
  const rows = (list || []).filter((a) => a.grade === grade);
  const subjects = new Set(rows.filter((a) => a.kind === "subject").map((a) => (a.subject || "").replace(/\s/g, "")).filter(Boolean)).size;
  const has = (k) => rows.some((a) => a.kind === k);
  const parts = [
    { key: "subject", label: "교과 세특", done: Math.min(subjects, NEED_SUBJECTS[grade]), need: NEED_SUBJECTS[grade] },
    { key: "autonomy", label: "자율", done: has("autonomy") ? 1 : 0, need: 1 },
    { key: "club", label: "동아리", done: has("club") ? 1 : 0, need: 1 },
    { key: "career", label: "진로", done: has("career") ? 1 : 0, need: 1 },
  ];
  const done = parts.reduce((a, p) => a + p.done, 0);
  const total = parts.reduce((a, p) => a + p.need, 0);
  const next = parts.find((p) => p.done < p.need);
  return { parts, done, total, pct: Math.round((done * 100) / total), complete: done >= total, next, books: rows.filter((a) => a.kind === "book").length };
}

export default function Note() {
  const { user, loading } = useAuth();
  const uid = user?.id ?? null;
  const nav = useNavigate();

  const [list, setList] = useState(null);
  const [my, setMy] = useState({ grade: null, department: null });
  const [editMy, setEditMy] = useState(false);
  const [tab, setTab] = useState(UNLOCK_GRADE);
  const [f, setF] = useState({ kind: "subject", subject: "", content: "", author: "" });
  // 교과 세특은 과목을 여러 개 한 번에 적는다 — [+ 과목 추가]로 칸을 늘린다
  const blankRows = () => [{ subject: "", content: "" }, { subject: "", content: "" }, { subject: "", content: "" }];
  const [rows, setRows] = useState(blankRows);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");
  const [roadmapPaid, setRoadmapPaid] = useState(false); // 로드맵을 결제(승인)했는지
  const [diagDone, setDiagDone] = useState(false); // 진단을 이미 받았는지 (받았으면 다시 돌리지 않고 결과로)

  const load = () => supabase.rpc("note_list").then(({ data }) => setList(data || []));

  useEffect(() => {
    if (!uid) return;
    load();
    supabase.from("note_roadmap_access").select("user_id").maybeSingle().then(({ data }) => setRoadmapPaid(Boolean(data)));
    supabase.from("note_diagnoses").select("id").limit(1).then(({ data }) => setDiagDone(Boolean(data?.length)));
    supabase.rpc("sm_get_my").then(({ data }) => {
      if (!data) return;
      setMy({ grade: data.grade, department: data.department });
      if (!data.department) setEditMy(true);
    });
  }, [uid]);

  const counts = useMemo(() => {
    const c = { 고1: 0, 고2: 0, 고3: 0 };
    (list || []).forEach((a) => c[a.grade] != null && (c[a.grade] += 1));
    return c;
  }, [list]);

  const unlock = useMemo(() => progressOf(list, UNLOCK_GRADE), [list]);
  const cur = useMemo(() => progressOf(list, tab), [list, tab]);

  // 이 학년 활동을 영역별로 묶는다
  const groups = useMemo(() => {
    const rows = (list || []).filter((a) => a.grade === tab);
    return KINDS.map((k) => ({ ...k, items: rows.filter((a) => a.kind === k.key) })).filter((k) => k.items.length);
  }, [list, tab]);

  function flash(m) {
    setToast(m);
    setTimeout(() => setToast(""), 1800);
  }

  async function saveMy(e) {
    e.preventDefault();
    const { error } = await supabase.rpc("sm_set_dept", { p_department: my.department });
    if (error) return setErr(error.message);
    setEditMy(false);
  }

  async function add(e) {
    e.preventDefault();
    setErr("");

    // 교과 세특 — 채운 과목 줄을 한 번에 저장
    if (f.kind === "subject") {
      const fill = rows.filter((r) => r.subject.trim() || r.content.trim());
      if (!fill.length) return setErr("과목과 활동을 하나 이상 적어 주세요");
      const bad = fill.find((r) => !r.subject.trim() || r.content.trim().length < 4);
      if (bad) return setErr(bad.subject.trim() ? `${bad.subject} 활동을 조금 더 적어 주세요` : "과목 이름을 적어 주세요");
      setBusy(true);
      let n = 0;
      for (const r of fill) {
        const { error } = await supabase.rpc("note_add", {
          p_grade: tab, p_term: null, p_kind: "subject", p_subject: r.subject.trim(), p_content: r.content.trim(), p_author: null,
        });
        if (error) {
          setErr(n ? `${n}과목까지 저장했어요. ${error.message}` : error.message);
          break;
        }
        n += 1;
      }
      setBusy(false);
      if (n) {
        setRows((rs) => {
          const left = rs.filter((r) => (r.subject.trim() || r.content.trim()) && !fill.slice(0, n).includes(r));
          return left.length ? left : blankRows();
        });
        flash(`${n}과목 저장했어요`);
        load();
      }
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("note_add", {
      p_grade: tab,
      p_term: null,
      p_kind: f.kind,
      p_subject: f.subject,
      p_content: f.content,
      p_author: f.author,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setF((x) => ({ ...x, subject: x.kind === "subject" ? "" : x.subject, content: "", author: "" }));
    flash(data?.piece > 0 ? "저장했어요 · 조각 +1" : "저장했어요");
    load();
  }

  async function remove(a) {
    if (!window.confirm("이 활동을 지울까요?")) return;
    await supabase.rpc("note_delete", { p_id: a.id });
    load();
  }

  if (loading) return <div className="py-24 text-center text-gray-500">불러오는 중…</div>;

  if (!uid)
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="text-[22px] font-bold text-sm-navy">내 생기부 노트</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
          학년별 생기부를 다 적으면,
          <br />
          AI가 내 입시 방향을 진단해 줘요.
        </p>
        <Link to="/signup" className="mt-6 inline-block rounded-[10px] bg-[#FEE500] px-6 py-3 text-[14.5px] font-bold text-[#191919]">
          카카오로 시작하기
        </Link>
      </div>
    );

  const input = "w-full rounded-[10px] border border-gray-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-sm-navy";

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
        <div className="flex items-end gap-3">
          <h1 className="text-[24px] font-bold tracking-tight text-sm-navy">내 생기부 노트</h1>
          <span className="ml-auto text-[13px] tabular-nums text-gray-500">전체 {(list || []).length}개</span>
        </div>

        {/* 왜 적는지 + 고1 완성도 */}
        <div className="mt-4 rounded-2xl bg-sm-navy p-5 text-white">
          <small className="text-[12px] font-bold text-orange-300">AI 입시 방향 진단</small>
          <b className="mt-1 block text-[19px] font-bold leading-snug tracking-tight">
            학년별 활동을 {UNLOCK_AT}칸 적으면,
            <br />
            가고 싶은 학과 기준으로 진단해 줘요
          </b>
          <ul className="mt-3 grid gap-1.5 text-[13.5px] text-slate-200">
            <li>· 가고 싶은 학과와 내 생기부가 얼마나 이어지는지</li>
            <li>· 그 학과가 보는 역량 중 비어 있는 곳</li>
            <li>· 고2에 고를 선택과목과 이어갈 탐구</li>
          </ul>

          <div className="mt-5 flex items-baseline justify-between text-[13px]">
            <span className="text-slate-300">고1 채운 칸</span>
            <b className="text-[20px] font-bold tabular-nums">
              {Math.min(unlock.done, UNLOCK_AT)}
              <span className="text-[14px] text-slate-400"> / {UNLOCK_AT}</span>
            </b>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/15">
            <i className="block h-full rounded-full bg-orange-300 transition-all" style={{ width: `${Math.min(100, (unlock.done * 100) / UNLOCK_AT)}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-slate-300">
            {roadmapPaid
              ? "로드맵이 열렸어요. 저장된 로드맵을 바로 볼 수 있어요."
              : diagDone
              ? "진단을 받았어요. 저장된 결과를 다시 볼 수 있어요."
              : unlock.done >= UNLOCK_AT
              ? "진단이 열렸어요. 가고 싶은 학과 기준으로 진단을 받아 보세요."
              : unlock.next.key === "subject"
              ? `고1 교과 세특을 ${unlock.next.need - unlock.next.done}과목 더 적어 주세요`
              : `고1 ${unlock.next.label} 활동을 적어 주세요`}
          </p>
          {roadmapPaid && (
            <Link to="/my/note/roadmap" className="mt-4 flex h-12 w-full items-center justify-center rounded-[10px] bg-white text-[15px] font-bold text-sm-navy">
              🗺️ 내 로드맵 보기 →
            </Link>
          )}
          {roadmapPaid ? (
            <Link to="/my/note/diagnosis" className="mt-2 block text-center text-[12.5px] font-semibold text-slate-300 underline">
              진단 결과 보기
            </Link>
          ) : unlock.done >= UNLOCK_AT || diagDone ? (
            <Link to="/my/note/diagnosis" className="mt-4 flex h-11 w-full items-center justify-center rounded-[10px] bg-orange-400 text-[14.5px] font-bold text-sm-navy">
              {diagDone ? "내 진단 결과 보기 →" : "AI 진단 받기 →"}
            </Link>
          ) : (
            <button disabled className="mt-4 h-11 w-full rounded-[10px] bg-white/10 text-[14px] font-bold text-slate-300">
              {`${UNLOCK_AT - unlock.done}칸만 더 채우면 진단이 열려요`}
            </button>
          )}
          <p className="mt-3 text-[11.5px] text-slate-400">고2 · 고3 활동까지 적을수록 진단이 더 정확해져요</p>
        </div>

        {/* 학년(가입 정보) · 희망 학과 */}
        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4">
          {editMy ? (
            <form onSubmit={saveMy} className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] text-gray-500">지금</span>
              <b className="text-[14px] text-gray-900">{my.grade || "학년 미정"}</b>
              <input
                value={my.department || ""}
                onChange={(e) => setMy((m) => ({ ...m, department: e.target.value }))}
                placeholder="희망 학과 (예: 간호학과)"
                className={`${input} min-w-0 flex-1`}
              />
              <button className="rounded-[10px] bg-sm-navy px-4 py-2.5 text-[14px] font-bold text-white">저장</button>
              <p className="w-full text-[12px] text-gray-500">진단할 때 이 학과를 기준으로 봐요. 학년은 가입할 때 정한 학년이에요.</p>
            </form>
          ) : (
            <div className="flex items-center gap-2 text-[14px]">
              <span className="text-gray-500">지금</span>
              <b className="text-gray-900">{my.grade || "학년 미정"}</b>
              <span className="text-gray-300">·</span>
              <b className="text-gray-900">{my.department}</b>
              <span className="text-gray-500">준비 중</span>
              <button onClick={() => setEditMy(true)} className="ml-auto text-[13px] font-semibold text-gray-500">
                학과 바꾸기
              </button>
            </div>
          )}
        </div>

        {/* 학년 탭 */}
        <div className="mt-5 flex gap-1 rounded-xl bg-[#E9EBEF] p-1">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setTab(g)}
              className={`flex-1 rounded-lg py-2.5 text-[14px] font-bold ${tab === g ? "bg-white text-sm-navy shadow-sm" : "text-gray-500"}`}
            >
              {g} <span className="ml-0.5 text-[12px] font-semibold tabular-nums text-gray-400">{counts[g]}</span>
            </button>
          ))}
        </div>

        {/* 이 학년 채운 칸 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-white px-3.5 py-3 text-[12.5px]">
          <b className="mr-1 text-gray-700">{tab}</b>
          {cur.parts.map((p) => {
            const ok = p.done >= p.need;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setF((v) => ({ ...v, kind: p.key }))}
                className={`rounded-full px-2.5 py-1 font-semibold ${ok ? "bg-emerald-50 text-emerald-700" : "border border-dashed border-gray-300 text-gray-500 hover:border-sm-orange hover:text-sm-orange"}`}
              >
                {ok ? "✓ " : "+ "}
                {p.label}
                {p.need > 1 && <span className="tabular-nums"> {p.done}/{p.need}</span>}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setF((v) => ({ ...v, kind: "book" }))}
            className="rounded-full border border-gray-200 px-2.5 py-1 font-semibold text-gray-400"
          >
            독서 {cur.books > 0 ? cur.books : ""} · 선택
          </button>
        </div>

        {/* 쓰기 */}
        <form onSubmit={add} className="mt-3 grid gap-2.5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <b className="text-[14.5px] text-gray-900">{tab} 활동 추가</b>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                type="button"
                key={k.key}
                onClick={() => setF((x) => ({ ...x, kind: k.key }))}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${f.kind === k.key ? "border-sm-orange bg-orange-50 text-sm-orange" : "border-gray-200 text-gray-600"}`}
              >
                {k.label}
                {k.optional && <span className="ml-1 text-[11px] text-gray-400">선택</span>}
              </button>
            ))}
          </div>
          {f.kind === "subject" ? (
            <div className="grid gap-3">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-1.5 rounded-xl bg-gray-50 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={r.subject}
                      onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, subject: e.target.value } : x)))}
                      placeholder={`과목 ${i + 1} (예: 통합과학)`}
                      className={`${input} flex-1`}
                    />
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} className="shrink-0 px-1 text-[12px] text-gray-400 hover:text-red-600" aria-label="이 과목 줄 빼기">
                        빼기
                      </button>
                    )}
                  </div>
                  <textarea
                    value={r.content}
                    onChange={(e) => setRows((rs) => rs.map((x, k) => (k === i ? { ...x, content: e.target.value } : x)))}
                    maxLength={300}
                    rows={2}
                    placeholder={i === 0 ? PLACEHOLDER.subject : "이 과목에서 내가 한 일"}
                    className={`${input} resize-none leading-relaxed`}
                  />
                  {r.content.length > 150 && (
                    <p className="text-[12px] text-amber-700">생기부 문장을 그대로 넣지 말고, 내가 한 일을 짧게 적어 주세요.</p>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRows((rs) => [...rs, { subject: "", content: "" }])}
                className="h-10 rounded-[10px] border border-dashed border-gray-300 text-[13.5px] font-semibold text-gray-600 hover:border-sm-navy hover:text-sm-navy"
              >
                + 과목 추가
              </button>
            </div>
          ) : f.kind === "book" ? (
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <input value={f.content} onChange={(e) => setF((x) => ({ ...x, content: e.target.value }))} placeholder="책 제목" className={input} />
              <input value={f.author} onChange={(e) => setF((x) => ({ ...x, author: e.target.value }))} placeholder="저자" className={input} />
            </div>
          ) : (
            <textarea
              value={f.content}
              onChange={(e) => setF((x) => ({ ...x, content: e.target.value }))}
              maxLength={300}
              rows={3}
              placeholder={PLACEHOLDER[f.kind]}
              className={`${input} resize-none leading-relaxed`}
            />
          )}
          {f.kind === "book" && <p className="text-[11.5px] text-gray-400">독서는 대입에 직접 반영되지 않지만, 진단할 때 관심 분야를 보는 데 참고해요.</p>}
          {f.kind !== "book" && f.kind !== "subject" && f.content.length > 150 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800">
              생기부 문장을 그대로 붙여 넣었나요? 무엇을 했고 무엇을 알게 됐는지만 내 말로 짧게 적어 주세요.
            </p>
          )}
          {err && <p className="text-[13px] font-semibold text-red-600">{err}</p>}
          <button disabled={busy} className="h-12 rounded-[10px] bg-sm-navy text-[15px] font-bold text-white disabled:opacity-50">
            {busy
              ? "저장 중…"
              : f.kind === "subject"
              ? `${rows.filter((r) => r.subject.trim() && r.content.trim()).length || ""}과목 저장`.trim()
              : "활동 저장"}
          </button>
          <p className="text-[11.5px] leading-relaxed text-gray-400">생기부 문장을 그대로 옮기지 말고, 내가 한 일을 내 말로 한 줄 요약해 적어 주세요.</p>
        </form>

        {/* 목록 — 영역별 */}
        <div className="mt-5 grid gap-4">
          {list === null && <p className="py-10 text-center text-[14px] text-gray-500">불러오는 중…</p>}
          {list && groups.length === 0 && (
            <p className="rounded-2xl border border-dashed border-gray-300 py-10 text-center text-[14px] text-gray-500">{tab} 활동이 아직 없어요</p>
          )}
          {groups.map((k) => (
            <section key={k.key}>
              <h3 className="mb-2 pl-1 text-[13px] font-bold text-gray-500">
                {tab} {k.label} <span className="font-semibold tabular-nums text-gray-400">{k.items.length}</span>
              </h3>
              <div className="rounded-2xl border border-gray-200 bg-white px-4">
                {k.items.map((a) => (
                  <div key={a.id} className="flex gap-3 border-b border-gray-100 py-3.5 last:border-0">
                    <div className="min-w-0 flex-1">
                      {(a.subject || a.from_interview) && (
                        <span className="text-[11.5px] font-bold text-indigo-700">
                          {a.subject}
                          {a.from_interview && <em className="ml-1.5 rounded bg-gray-100 px-1.5 py-px font-semibold not-italic text-gray-500">예상질문에서</em>}
                        </span>
                      )}
                      <p className="mt-0.5 text-[14.5px] leading-relaxed text-gray-800">
                        {a.content}
                        {a.author && <span className="text-gray-500"> · {a.author}</span>}
                      </p>
                    </div>
                    <button onClick={() => remove(a)} className="flex-none self-start text-[12px] text-gray-400 hover:text-red-600">
                      지우기
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-sm-navy/95 px-4 py-2.5 text-[13.5px] font-semibold text-white md:bottom-8">{toast}</div>
      )}
    </div>
  );
}