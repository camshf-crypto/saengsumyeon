import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import LoginGate from "../../components/LoginGate";
import UpgradeModal from "../../components/UpgradeModal";
// 2026-11-06 사용자 모으기 — 완성본까지 무료 (서버 school_task FREE_OPEN 과 같이) · 결제 안내 없이 하루 3개 (새벽 5시에 다시)
const FREE_OPEN = true;
import { track } from "../../lib/track";
import { Rich } from "../agent/Agent";

/*
 * 수행평가 완성 — /suhaeng (비커스 '내 학교 과제'를 생수면용으로 · 선생님 검토 없이 학생 혼자 끝까지)
 * 딸깍: 자료 고르기(우리 학교 평가계획 · 안내문 사진 · PDF · 글) → 질문 고르기(객관식 + 내 생각 한 줄 + 나만의 이야기) → [완성본 만들기] 한 번에 글 · 채점 · 세특 예상 문장
 * 학습가이드는 완성본 화면에 접어 둔다 (더 잘 쓰고 싶으면)
 * 무료: 자료 고르기 · 질문 · 완성본(글 · 채점 · 세특) — 완성본은 하루 3개 (새벽 5시에 다시 · 서버 school_task 가 센다)
 * DB: sql/sm_110 school_tasks · 저장소 school-task-files · 학교 평가계획 sql/sm_105
 */
const STEPS = ["자료 고르기", "질문 고르기", "완성본"];
const STATUS_STEP = { draft: 0, analyzed: 1, qa: 1, guide: 1, writing: 2, done: 2 };
const STATUS_LABEL = { draft: "자료 고르는 중", analyzed: "질문 고르는 중", qa: "질문 고르는 중", guide: "완성본 만들기 전", writing: "완성본 만드는 중", done: "완성" };
const NAVY = "#1E2A5A";
const card = "rounded-2xl bg-white ring-1 ring-black/5";
const btnMain = "h-11 rounded-xl px-5 text-[14px] font-extrabold text-white disabled:opacity-50";
const btnSub = "h-11 rounded-xl bg-white px-4 text-[13px] font-bold text-gray-600 ring-1 ring-gray-200 hover:ring-gray-400 disabled:opacity-50";

// 서버 호출 — 이용권이 필요하면 { paywall } 로 돌아온다
async function callAI(action, body) {
  const { data, error } = await supabase.functions.invoke("school_task", { body: { action, ...body } });
  if (error) {
    let msg = error.message, paywall = false;
    try {
      const j = await error.context.json();
      msg = j?.error || msg;
      paywall = Boolean(j?.paywall);
    } catch { /* 넘어간다 */ }
    const e = new Error(msg);
    e.paywall = paywall;
    throw e;
  }
  return data;
}

function Busy({ text }) {
  return (
    <div className={`${card} flex items-center gap-3 p-5 text-[14px] font-bold text-gray-700`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-sm-orange" />
      {text}
      <small className="font-medium text-gray-400">· 20~40초쯤 걸려요</small>
    </div>
  );
}

/* ───────── 목록 ───────── */
export default function SchoolTask() {
  const { user, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const open = Number(params.get("task")) || null;

  const load = () =>
    supabase.from("school_tasks").select("id,title,subject,grade,status,score,updated_at").order("updated_at", { ascending: false })
      .then(({ data }) => setList(data ?? []));
  useEffect(() => {
    if (!user) return;
    track("suhaeng_view");
    load();
  }, [user, open]);

  async function create() {
    const meta = user.user_metadata ?? {};
    const mon = new Date().getMonth() + 1;
    const { data, error } = await supabase.from("school_tasks").insert({
      user_id: user.id, school: meta.school ?? null, grade: meta.grade ?? null, semester: mon >= 3 && mon <= 8 ? 1 : 2, title: "새 수행평가",
    }).select("id").single();
    if (error) return alert("만들지 못했어요. 잠시 후 다시 해 주세요.");
    track("suhaeng_create");
    setParams({ task: String(data.id) });
  }
  async function remove(id) {
    if (!confirm("이 수행평가를 지울까요?")) return;
    await supabase.from("school_tasks").delete().eq("id", id);
    load();
  }

  if (loading) return null;
  if (!user) return <LoginGate title="수행평가 완성" desc="학교 수행평가 안내문만 올리면 분석 → 질의응답 → 가이드 → 초안 · 채점까지 끝까지 같이 해요." />;
  if (open) return <TaskFlow taskId={open} onBack={() => setParams({})} />;

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-3xl px-4 py-7 sm:py-10">
        <p className="text-[13px] font-extrabold text-sm-orange">수행평가 완성</p>
        <h1 className="mt-1 text-[24px] font-black leading-tight text-sm-navy">학교 수행평가, 안내문만 올리면<br className="sm:hidden" /> 끝까지 같이 해요</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">
          안내문 사진 · 우리 학교 평가계획 → 분석 → 질의응답으로 내 방향 정하기 → 학습가이드 → 초안 · 채점 → 세특 예상 문장까지
        </p>
        <button onClick={create} className={`${btnMain} mt-5 w-full sm:w-auto`} style={{ background: NAVY }}>+ 새 수행평가 시작하기</button>

        <div className="mt-6 space-y-2">
          {list === null ? (
            <p className="py-8 text-center text-[13px] text-gray-400">불러오는 중…</p>
          ) : !list.length ? (
            <div className={`${card} p-6 text-center text-[13px] text-gray-500`}>아직 시작한 수행평가가 없어요.</div>
          ) : (
            list.map((t) => (
              <div key={t.id} className={`${card} flex items-center gap-3 p-4`}>
                <button onClick={() => setParams({ task: String(t.id) })} className="min-w-0 flex-1 text-left">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-extrabold ${t.status === "done" ? "bg-emerald-50 text-emerald-700" : "bg-orange-50 text-sm-orange"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                  <b className="mt-1 block truncate text-[15px] font-extrabold text-gray-900">{t.title || "수행평가"}</b>
                  <small className="text-[12px] text-gray-500">
                    {[t.grade, t.subject, t.score ? `${t.score.total}/${t.score.max}점` : ""].filter(Boolean).join(" · ")}
                  </small>
                </button>
                <button onClick={() => remove(t.id)} className="flex-none text-[12px] font-bold text-gray-300 hover:text-red-500">지우기</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── 한 과제 흐름 — 자료 고르기 → 질문 고르기(객관식 + 내 생각) → 완성본 (딸깍) ───────── */
function TaskFlow({ taskId, onBack }) {
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState(null); // 보고 있는 단계 (null = 지금 단계)
  const [buy, setBuy] = useState(false);

  const load = () => supabase.from("school_tasks").select("*").eq("id", taskId).single().then(({ data }) => setTask(data));
  useEffect(() => { load(); }, [taskId]);

  // AI 단계 실행 — 이용권이 필요하면 업그레이드 팝업
  async function run(text, fn) {
    setBusy(text);
    setErr("");
    try {
      const r = await fn((t) => setBusy(t));
      if (r?.task) setTask(r.task);
      else await load();
      setView(null);
    } catch (e) {
      if (e.paywall && !FREE_OPEN) setBuy(true);
      setErr(e.message || "잠시 후 다시 해 주세요.");
      await load();
    }
    setBusy("");
  }
  const patch = async (p) => {
    const { data, error } = await supabase.from("school_tasks").update({ ...p, updated_at: new Date().toISOString() }).eq("id", taskId).select().single();
    if (error) throw error;
    setTask(data);
    return data;
  };
  // 딸깍 — 가이드(처음 한 번) → 완성본 → 채점 → 세특 예상 문장 (한 번에 다 하면 서버 시간이 모자라서 단계마다 나눠 부른다)
  const makeAll = (format) => run("완성본을 만들 준비를 하고 있어요", async (say) => {
    let t = task;
    if (!t.guide) { say("채점 기준에 맞춰 쓸 방향을 잡는 중이에요 (1/4)"); t = (await callAI("guide", { taskId })).task; }
    say("완성본을 쓰고 있어요 · 출처가 필요하면 실제 자료도 찾아요 (2/4 · 1분쯤)");
    t = (await callAI("draft", { taskId, format })).task;
    say("채점 기준으로 채점하는 중이에요 (3/4)");
    t = (await callAI("score", { taskId })).task;
    say("세특 예상 문장을 만드는 중이에요 (4/4)");
    return callAI("finalize", { taskId });
  });

  if (!task) return <p className="py-20 text-center text-[13px] text-gray-400">불러오는 중…</p>;
  const reached = STATUS_STEP[task.status] ?? 0;
  const step = view ?? reached;

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <button onClick={onBack} className="text-[13px] font-bold text-gray-500">‹ 수행평가 목록</button>
        <h1 className="mt-2 text-[21px] font-black text-sm-navy">{task.title || "새 수행평가"}</h1>
        <p className="text-[12.5px] text-gray-500">{[task.school, task.grade, task.semester && `${task.semester}학기`, task.subject].filter(Boolean).join(" · ")}</p>

        {/* 단계 */}
        <div className="mt-4 flex gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s}
              disabled={i > reached}
              onClick={() => setView(i === reached ? null : i)}
              className={`flex-1 rounded-full px-2 py-2 text-[12.5px] font-bold ${i === step ? "bg-sm-navy text-white" : i <= reached ? "bg-white text-gray-700 ring-1 ring-gray-200" : "bg-white/60 text-gray-300"}`}
            >
              {i + 1}. {s}{i === 2 && !FREE_OPEN ? " 🔑" : ""}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-gray-400">{FREE_OPEN ? "완성본(글 · 채점 · 세특)까지 무료예요 · 완성본은 하루 3개 (새벽 5시에 다시 열려요)" : "🔑 완성본(글 · 채점 · 세특)은 1년 이용권 · 자료 고르기와 질문은 무료예요 (과제 3개까지)"}</p>

        {err && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">{err}</p>}
        <div className="mt-4">
          {busy ? <Busy text={busy} /> :
            step === 0 ? <StepPrepare task={task} readOnly={reached > 0} onAnalyze={(p) => run("안내문을 읽고 내 활동과 이어 보는 중이에요", async (say) => {
              await patch(p);
              await callAI("analyze", { taskId });
              say("첫 질문을 만드는 중이에요");
              return callAI("qa", { taskId });
            })} /> :
            step === 1 ? <StepQA task={task} readOnly={reached > 1} patch={patch}
              onAnswer={(qa) => run("다음 질문을 만드는 중이에요", async () => { await patch({ qa }); return callAI("qa", { taskId }); })}
              onMake={(qa, myStory, format) => { patch({ qa, my_story: myStory || null }).then(() => makeAll(format)); }} /> :
            <StepResult task={task} patch={patch} onBack={() => setView(1)}
              onScore={(content) => run("채점 기준으로 채점하는 중이에요", () => callAI("score", { taskId, content }))}
              onSetuk={(content) => run("세특 예상 문장을 만드는 중이에요", () => callAI("finalize", { taskId, content }))} />}
        </div>
      </div>
      <UpgradeModal
        open={buy && !FREE_OPEN}
        reason="suhaeng"
        title="수행평가 완성본 딸깍"
        desc="1년 이용권이면 수행평가를 개수 제한 없이 완성본 → 채점 → 세특 예상 문장까지 한 번에 만들어요."
        onClose={() => setBuy(false)}
      />
    </div>
  );
}

/* ───────── 1. 자료 준비 — 사진 · PDF · 글, 또는 우리 학교 평가계획에서 고르기 ───────── */
function StepPrepare({ task, readOnly, onAnalyze }) {
  const { user } = useAuth();
  const [text, setText] = useState(task.source_text ?? "");
  const [files, setFiles] = useState(Array.isArray(task.source_files) ? task.source_files : []);
  const [up, setUp] = useState(false);
  const [evalList, setEvalList] = useState(null); // 우리 학교 평가계획 수행평가 목록
  const [pick, setPick] = useState(task.eval_task_id ?? null);

  // 우리 학교 · 내 학년 평가계획 (가장 최근 학기)
  useEffect(() => {
    const school = user?.user_metadata?.school;
    const g = Number(String(task.grade ?? user?.user_metadata?.grade ?? "").match(/[123]/)?.[0] ?? 0);
    if (!school) return setEvalList([]);
    (async () => {
      let name = school;
      const { data: hit } = await supabase.from("school_eval_subjects").select("school").eq("school", school).limit(1);
      if (!hit?.length) {
        const short = school.replace(/\s/g, "").replace(/(고등학교|고교|고)$/, "");
        const { data } = await supabase.from("school_eval_subjects").select("school").ilike("school", `${short}고%`).limit(100);
        const names = [...new Set((data ?? []).map((r) => r.school))];
        name = names.length === 1 ? names[0] : "";
      }
      if (!name) return setEvalList([]);
      let q = supabase.from("school_eval_subjects").select("id,school,year,semester,grade,subject").eq("school", name).order("year", { ascending: false }).order("semester", { ascending: false });
      if (g) q = q.eq("grade", g);
      const { data: subs } = await q.limit(200);
      if (!subs?.length) return setEvalList([]);
      const top = subs.filter((s) => s.year === subs[0].year && s.semester === subs[0].semester);
      const { data: tasks } = await supabase.from("school_eval_tasks").select("id,subject_id,title,period,points,methods,unit,memo,rubric").in("subject_id", top.map((s) => s.id)).order("subject_id").order("sort");
      const subj = new Map(top.map((s) => [s.id, s]));
      setEvalList((tasks ?? []).map((t) => ({ ...t, subject: subj.get(t.subject_id)?.subject, school: name, term: `${top[0].year}학년도 ${top[0].semester}학기` })));
    })();
  }, [user, task.grade]);

  async function addFiles(e) {
    const picked = [...(e.target.files ?? [])].slice(0, 6 - files.length);
    e.target.value = "";
    if (!picked.length) return;
    setUp(true);
    const added = [];
    for (const f of picked) {
      if (!/^image\/|pdf/.test(f.type)) continue;
      const path = `${user.id}/${task.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
      const { error } = await supabase.storage.from("school-task-files").upload(path, f, { contentType: f.type });
      if (!error) added.push({ path, name: f.name, type: f.type });
    }
    setFiles((x) => [...x, ...added]);
    setUp(false);
  }

  const chosen = (evalList ?? []).find((t) => t.id === pick);
  const ready = text.trim().length >= 10 || files.length > 0 || chosen;
  function go() {
    const p = { source_text: text.trim() || null, source_files: files, eval_task_id: chosen?.id ?? null };
    if (chosen) Object.assign(p, { subject: chosen.subject, title: task.title === "새 수행평가" ? chosen.title : task.title });
    onAnalyze(p);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 우리 학교 평가계획에서 고르기 */}
      {evalList?.length > 0 && (
        <div className={`${card} p-5`}>
          <p className="text-[15px] font-extrabold text-gray-900">🏫 {evalList[0].school} 평가계획에서 고르기</p>
          <p className="mt-0.5 text-[12.5px] text-gray-500">{evalList[0].term} · 학교가 공개한 채점 기준표까지 같이 읽어서 만점 기준에 맞춰 도와줘요</p>
          <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
            {evalList.map((t) => (
              <button
                key={t.id}
                disabled={readOnly}
                onClick={() => setPick(pick === t.id ? null : t.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left ${pick === t.id ? "bg-orange-50 ring-2 ring-sm-orange" : "bg-[#F7F8FA] hover:bg-orange-50"}`}
              >
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] font-bold text-gray-900">{t.subject} · {t.title}</b>
                  <small className="text-[12px] text-gray-500">{t.period || "시기 미정"}{t.rubric ? " · 채점 기준표 있음" : ""}</small>
                </span>
                <span className="flex-none text-[12px] font-extrabold text-sm-orange">{t.points ?? "?"}점</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 안내문 사진 · PDF · 글 */}
      <div className={`${card} p-5`}>
        <p className="text-[15px] font-extrabold text-gray-900">📄 선생님이 준 안내문 올리기 {evalList?.length ? <small className="font-bold text-gray-400">(있으면 같이)</small> : ""}</p>
        <p className="mt-0.5 text-[12.5px] text-gray-500">사진 · PDF 최대 6장 · 또는 안내문 글을 그대로 붙여 넣어요</p>
        {!readOnly && (
          <label className="mt-3 flex h-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-[13.5px] font-bold text-gray-500 hover:border-sm-orange">
            {up ? "올리는 중…" : "📷 사진 · PDF 고르기"}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={addFiles} />
          </label>
        )}
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-[12.5px] text-gray-600">
            {files.map((f, i) => (
              <li key={f.path} className="flex items-center gap-2">
                <span className="truncate">📎 {f.name}</span>
                {!readOnly && <button onClick={() => setFiles(files.filter((_, k) => k !== i))} className="text-gray-300 hover:text-red-500">×</button>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          disabled={readOnly}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="안내문 글 붙여 넣기 (예: 과제 · 분량 · 제출일 · 평가 기준)"
          className="mt-3 w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[13.5px] leading-relaxed outline-none focus:border-sm-orange"
        />
      </div>

      {!readOnly && (
        <button disabled={!ready || up} onClick={go} className={`${btnMain} w-full`} style={{ background: NAVY }}>
          다음: 질문 고르기 →
        </button>
      )}
    </div>
  );
}

/* 안내문 정리 · 내 활동과 잇기 — 질문 화면 위에 접어 둔다 */
function AnalysisBox({ task }) {
  const [open, setOpen] = useState(false);
  const a = task.analysis ?? {};
  const r = task.reco ?? {};
  if (!a.summary && !a.criteria?.length) return null;
  return (
    <div className={`${card} p-4`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="min-w-0">
          <b className="text-[13px] font-extrabold text-gray-900">📋 안내문 정리</b>
          {a.summary && <small className="mt-0.5 block truncate text-[12.5px] text-gray-500">{a.summary}</small>}
        </span>
        <span className="flex-none text-[12px] font-bold text-gray-400">{open ? "접기" : "보기"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-gray-700">
          {a.required?.filter(Boolean).length > 0 && <p><b className="text-gray-900">꼭 넣을 것</b> · {a.required.filter(Boolean).join(" · ")}</p>}
          {a.penalties?.filter(Boolean).length > 0 && <p><b className="text-gray-900">감점 주의</b> · {a.penalties.filter(Boolean).join(" · ")}</p>}
          {a.criteria?.length > 0 && <p><b className="text-gray-900">채점 기준</b> · {a.criteria.map((c) => `${c.name}${c.points ? ` ${c.points}점` : ""}`).join(" · ")}</p>}
          {r.deepen && <p className="rounded-xl bg-orange-50 p-3"><b className="text-sm-orange">[{r.deepen.relation}] {r.deepen.when} {r.deepen.title}</b><br />{r.deepen.how}</p>}
        </div>
      )}
    </div>
  );
}

/* ───────── 2. 질문 고르기 — 객관식으로 고르고, 내 생각을 한 줄씩 덧붙인다 → 나만의 이야기 → 완성본 딸깍 ───────── */
function StepQA({ task, readOnly, onAnswer, onMake }) {
  const qa = Array.isArray(task.qa) ? task.qa : [];
  const curIdx = qa.findIndex((x) => !(Array.isArray(x.answer) ? x.answer.length : x.answer) && !x.custom);
  const cur = curIdx >= 0 ? qa[curIdx] : null;
  const multi = !!cur?.multi;
  const maxPick = Number(cur?.maxPick) || (multi ? 2 : 1);
  const [picks, setPicks] = useState([]);
  const [mine, setMine] = useState(""); // 이 질문에 덧붙이는 내 생각 (선택)
  const [story, setStory] = useState(task.my_story ?? "");
  const [fm, setFm] = useState(null);
  const [fmt, setFmt] = useState("");
  const [stop, setStop] = useState(false); // '여기까지만' — 남은 질문 없이 바로 완성본으로
  useEffect(() => { setPicks([]); setMine(""); }, [curIdx, task.updated_at]);
  const answered = qa.filter((x) => x.answer?.length || x.custom);
  const done = (!cur || stop) && answered.length > 0;
  useEffect(() => {
    if (!done || fm) return;
    callAI("formats", { taskId: task.id }).then((r) => { setFm(r); setFmt(r.current); }).catch(() => setFm({ formats: [] }));
  }, [done]);
  const toggle = (label) => {
    if (!multi) return setPicks([label]);
    setPicks((p) => (p.includes(label) ? p.filter((x) => x !== label) : p.length >= maxPick ? [...p.slice(1), label] : [...p, label]));
  };
  const ansText = (x) => [Array.isArray(x.answer) ? x.answer.join(" + ") : x.answer, x.custom && `내 생각: ${x.custom}`].filter(Boolean).join(" / ");
  const submit = () => onAnswer(qa.map((x, i) => (i === curIdx ? { ...x, answer: multi ? picks : picks[0] ?? null, custom: mine.trim() || null } : x)));
  const finishNow = () => onMake(answered, story.trim(), fmt);

  return (
    <div className="flex flex-col gap-3">
      <AnalysisBox task={task} />
      <div className="grid gap-3 md:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-3">
          {cur && !stop && !readOnly ? (
            <div className={`${card} flex flex-col gap-3 p-5`}>
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-extrabold text-sm-orange">질문 {Math.min(answered.length + 1, 5)} / 5</p>
                <div className="h-1.5 w-32 rounded bg-gray-200"><div className="h-full rounded bg-sm-orange" style={{ width: `${Math.min(answered.length / 5, 1) * 100}%` }} /></div>
              </div>
              {cur.badge && <span className="self-start rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-extrabold text-sm-orange">{cur.badge}</span>}
              <p className="text-[18px] font-extrabold leading-snug text-gray-900">{cur.q}</p>
              {multi && <p className="-mt-1 text-[12px] font-bold text-sm-orange">1~{maxPick}개 골라요 · 2개를 고르면 섞어서 나만의 방향이 돼요</p>}
              <div className="flex flex-col gap-2">
                {(cur.options ?? []).map((o) => {
                  const on = picks.includes(o.label);
                  return (
                    <button key={o.label} onClick={() => toggle(o.label)} className={`rounded-xl px-4 py-3 text-left ${on ? "bg-orange-50 ring-2 ring-sm-orange" : "ring-1 ring-gray-200 hover:ring-orange-200"}`}>
                      {o.from && <span className="mb-1 inline-block rounded bg-white px-1.5 py-0.5 text-[10.5px] font-bold text-sm-orange ring-1 ring-orange-200">{o.from}</span>}
                      <b className="block text-[14px] text-gray-900">{o.label}</b>
                      {o.desc && <small className="mt-0.5 block text-[12px] text-gray-500">{o.desc}</small>}
                    </button>
                  );
                })}
              </div>
              <div>
                <p className="text-[12.5px] font-bold text-gray-700">✍ 내 생각 한 줄 더하기 <small className="font-medium text-gray-400">(선택 · 쓰면 글에 꼭 들어가요)</small></p>
                <input value={mine} onChange={(e) => setMine(e.target.value.slice(0, 300))} placeholder="예: 작년에 동생이랑 직접 겪은 일이라 더 와닿았어요" className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 px-3.5 text-[13.5px] outline-none focus:border-sm-orange" />
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <button onClick={() => onAnswer(qa.slice(0, curIdx))} className={btnSub}>다른 질문으로 바꾸기</button>
                <div className="flex gap-2">
                  {answered.length >= 3 && <button onClick={() => setStop(true)} className={btnSub}>여기까지만</button>}
                  <button disabled={!picks.length && !mine.trim()} onClick={submit} className={btnMain} style={{ background: NAVY }}>다음 →</button>
                </div>
              </div>
            </div>
          ) : done && !readOnly ? (
            <div className={`${card} flex flex-col gap-3 p-5`}>
              <p className="text-[17px] font-extrabold text-gray-900">거의 다 됐어요 ✨</p>
              <div>
                <p className="text-[13px] font-bold text-gray-700">나만의 이야기 <small className="font-medium text-gray-400">(선택 · 내 경험 · 생각을 쓰면 친구들과 다른 글이 돼요)</small></p>
                <textarea value={story} onChange={(e) => setStory(e.target.value.slice(0, 2000))} rows={4} placeholder="이 과제와 관련해 내가 겪은 일, 느낀 점, 꼭 넣고 싶은 말을 자유롭게 써요" className="mt-1.5 w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[13.5px] leading-relaxed outline-none focus:border-sm-orange" />
              </div>
              {fm?.formats?.length > 0 && (
                <label className="text-[12.5px] font-bold text-gray-600">
                  글 구조
                  <select value={fmt} onChange={(e) => setFmt(e.target.value)} className="ml-2 h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px]">
                    {fm.formats.map((f) => <option key={f.key} value={f.key}>{f.label}{f.key === fm.recommended ? " (추천)" : ""}</option>)}
                  </select>
                </label>
              )}
              <button onClick={finishNow} className={`${btnMain} h-14 w-full text-[16px]`} style={{ background: NAVY }}>✨ 완성본 만들기 🔑</button>
              <p className="-mt-1 text-center text-[11.5px] text-gray-400">글 · 채점 · 세특 예상 문장까지 한 번에 · 1~2분쯤 걸려요</p>
            </div>
          ) : (
            <div className={`${card} p-5 text-[13px] text-gray-500`}>
              {readOnly ? "질문을 마쳤어요. 오른쪽에서 고른 답을 볼 수 있어요." : "질문을 불러오지 못했어요."}
              {!readOnly && <button onClick={() => onAnswer(qa)} className={`${btnMain} ml-3`} style={{ background: NAVY }}>질문 다시 받기</button>}
            </div>
          )}
        </div>
        <div className={`${card} flex flex-col gap-2.5 p-4`}>
          <p className="text-[13px] font-extrabold text-gray-900">내가 고른 답</p>
          {!answered.length && <p className="text-[12px] text-gray-400">아직 고른 답이 없어요</p>}
          {answered.map((x, i) => (
            <div key={i} className="border-b border-gray-100 pb-2">
              <small className="text-[11px] text-gray-400">Q{i + 1} · {x.q}</small>
              <p className="mt-0.5 text-[13px] leading-snug text-gray-800">{ansText(x)}</p>
              {!readOnly && <button onClick={() => confirm(`${i + 1}번 질문부터 다시 고를까요?`) && onAnswer(qa.slice(0, i))} className="mt-1 text-[11px] font-bold text-sm-orange">여기부터 다시 고르기</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── 3. 완성본 — 글 · 채점 · 세특 예상 문장 (고치고 다시 채점 가능) ───────── */
function StepResult({ task, patch, onBack, onScore, onSetuk }) {
  const [content, setContent] = useState(task.draft ?? "");
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => { setContent(task.draft ?? ""); }, [task.draft]);
  const sc = task.score;
  if (!task.draft) return <div className={`${card} p-6 text-[13px] text-gray-500`}>완성본이 아직 없어요. <button onClick={onBack} className="font-bold text-sm-orange">질문으로 돌아가기 ›</button></div>;
  async function save() {
    setSaving(true);
    try { await patch({ draft: content }); } catch { alert("저장하지 못했어요."); }
    setSaving(false);
  }
  async function copy(t) {
    try { await navigator.clipboard.writeText(t); alert("복사했어요. 한글 · 워드에 붙여 넣으면 돼요."); } catch { /* 넘어간다 */ }
  }
  return (
    <div className="grid gap-3 md:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-3">
        <div className={`${card} flex flex-col`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
            <p className="text-[13px] font-extrabold text-sm-orange">완성본{task.draft_round > 1 ? ` (${task.draft_round}번째)` : ""}</p>
            <div className="flex gap-2">
              <button onClick={() => copy(content)} className="rounded-md px-2.5 py-1 text-[12px] font-bold text-gray-500 ring-1 ring-gray-200">📋 복사</button>
              <button onClick={() => setEdit(!edit)} className="rounded-md px-2.5 py-1 text-[12px] font-bold text-gray-500 ring-1 ring-gray-200">{edit ? "👀 미리보기" : "✏️ 고치기"}</button>
            </div>
          </div>
          <div className="p-5 text-[14px] leading-relaxed text-gray-700">
            {edit ? <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={26} className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[13.5px] leading-[1.8] outline-none focus:border-sm-orange" /> : <Rich text={content} />}
          </div>
        </div>
        {task.guide && (
          <div className={`${card} p-4`}>
            <button onClick={() => setShowGuide(!showGuide)} className="flex w-full justify-between text-left text-[13px] font-extrabold text-gray-900">
              📘 학습가이드 (더 잘 쓰고 싶으면) <span className="text-[12px] font-bold text-gray-400">{showGuide ? "접기" : "보기"}</span>
            </button>
            {showGuide && <div className="mt-3 text-[13.5px] leading-relaxed text-gray-700"><Rich text={task.guide} /></div>}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <div className={`${card} flex flex-col gap-2 p-4`}>
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] font-extrabold text-gray-900">채점 기준으로 채점</p>
            {sc ? <p className="text-[24px] font-black text-sm-navy">{sc.total}<small className="text-[13px] text-gray-400">/{sc.max}</small></p> : <small className="text-[12px] text-gray-400">아직 안 받았어요</small>}
          </div>
          {sc?.items?.map((it, i) => (
            <div key={i} className={`rounded-lg px-3 py-2 ${it.got < it.max ? "bg-orange-50" : "bg-[#F7F8FA]"}`}>
              <div className="flex justify-between text-[12.5px]"><span>{it.name}</span><b className={it.got < it.max ? "text-sm-orange" : ""}>{it.got} / {it.max}</b></div>
              {it.got < it.max && it.tip && <p className="mt-1 text-[11.5px] leading-snug text-gray-600">{it.tip}</p>}
            </div>
          ))}
        </div>
        {task.setuk_text && (
          <div className={`${card} p-4`}>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-extrabold text-gray-900">세특 예상 문장</p>
              <button onClick={() => copy(task.setuk_text)} className="text-[12px] font-bold text-gray-400">복사</button>
            </div>
            <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-gray-700">{task.setuk_text}</p>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className={`${btnSub} flex-1`}>{saving ? "저장 중…" : "💾 저장"}</button>
          <button onClick={() => onScore(content)} className={`${btnSub} flex-1`}>다시 채점받기</button>
        </div>
        <button onClick={() => onSetuk(content)} className={btnSub}>고친 글로 세특 다시 받기</button>
        <button onClick={onBack} className={btnSub}>질문으로 돌아가서 다시 만들기</button>
        <Link to="/my/home" className="text-center text-[12.5px] font-bold text-gray-400">내 입시 홈에도 쌓였어요 ›</Link>
      </div>
    </div>
  );
}