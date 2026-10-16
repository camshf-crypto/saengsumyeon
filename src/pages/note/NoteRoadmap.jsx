import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import LoginGate, { NoteIcon } from "../../components/LoginGate";

/*
 * 내 로드맵 (/my/note/roadmap) — 고2 로드맵 · 고3 1학기 로드맵 (결제 승인된 학생만)
 * 처음에는 [내 로드맵 만들기]를 눌러 서버(note_roadmap)가 만들고, 다음부터는 저장된 것을 바로 보여 준다
 * 고2 칸을 10칸 이상 채웠으면 고3 1학기 로드맵, 아니면 고2 로드맵
 */

/* 고2 칸도 10칸 이상이면 고3 1학기 로드맵 (진단 화면과 같은 규칙) */
function nextGrade(list) {
  const rows = (list || []).filter((a) => a.grade === "고2");
  const subjects = new Set(rows.filter((a) => a.kind === "subject").map((a) => (a.subject || "").replace(/\s/g, "")).filter(Boolean)).size;
  const has = (k) => rows.some((a) => a.kind === k);
  const done = Math.min(subjects, 10) + (has("autonomy") ? 1 : 0) + (has("club") ? 1 : 0) + (has("career") ? 1 : 0);
  return done >= 10 ? "고3" : "고2";
}

const STATUS_STYLE = { 충분: "bg-emerald-50 text-emerald-700", 약함: "bg-amber-50 text-amber-700", "비어 있음": "bg-red-50 text-red-600" };

const COMMON_STYLE = {
  드묾: "bg-emerald-100 text-emerald-800",
  보통: "bg-amber-100 text-amber-800",
  흔함: "bg-red-100 text-red-700",
  모름: "bg-gray-100 text-gray-500",
};
const COMMON_LABEL = { 드묾: "드물어요", 보통: "보통이에요", 흔함: "흔해요", 모름: "사례 부족" };

function RoadmapView({ next = "고2" }) {
  const g3 = next === "고3";
  const title = g3 ? "고3 1학기 로드맵" : "고2 로드맵";
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [startedAt, setStartedAt] = useState(null); // 서버가 만들기 시작한 시각 (만드는 중일 때만)
  const busy = startedAt != null;
  const [sec, setSec] = useState(0); // 만들기 시작하고 지난 초
  const [ready, setReady] = useState(false); // 저장된 로드맵을 확인했는지

  /*
   * 저장된 로드맵 확인 — AI를 부르지 않는다
   * 서버는 '만드는 중' 줄을 먼저 저장하고 백그라운드에서 끝까지 만든다.
   * 그래서 화면을 닫았다 다시 와도 만드는 중이면 진행 화면을 이어서, 다 됐으면 결과를 바로 보여 준다
   */
  async function check() {
    const [last, done] = await Promise.all([
      supabase.from("note_roadmaps").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("note_roadmaps").select("*").not("result", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setReady(true);
    if (last.error) {
      // 저장 표를 못 읽으면 만들기 버튼을 보여 주지 않는다 (만들어도 저장이 안 돼 매번 다시 돌게 됨)
      setErr("로드맵을 불러오지 못했어요. 잠시 후 다시 들어와 주세요.");
      return setStartedAt(null);
    }
    const row = last.data;
    const age = row ? Date.now() - new Date(row.created_at).getTime() : 0;
    if (row?.status === "running" && age < 5 * 60 * 1000) {
      setErr("");
      return setStartedAt(new Date(row.created_at).getTime());
    }
    if (done.data?.result) setData({ roadmap: done.data.result, created_at: done.data.created_at });
    if (row?.status === "failed" || (row?.status === "running" && age >= 5 * 60 * 1000)) {
      setErr("로드맵을 만들지 못했어요. 다시 시도해 주세요.");
    }
    setStartedAt(null);
  }
  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 만드는 중이면 4초마다 다 됐는지 확인
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  async function load(force = false) {
    setErr("");
    setStartedAt(Date.now());
    const { data: res, error } = await supabase.functions.invoke("note_roadmap", { body: { force } });
    let body = res;
    if (error) {
      try { body = await error.context?.json?.(); } catch { body = null; }
    }
    if (body?.running) return setStartedAt(new Date(body.started_at ?? Date.now()).getTime());
    setStartedAt(null);
    if (body?.roadmap) return setData(body);
    if (body?.need === "diagnosis") return setErr("먼저 AI 진단을 받아 주세요.");
    setErr(body?.error ?? "로드맵을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  }

  // 진행률 — 서버가 시작한 시각 기준이라, 화면을 닫았다 와도 이어서 올라간다 (끝나기 전엔 99%에서 멈춤)
  useEffect(() => {
    if (!busy) return;
    const tick = () => setSec(Math.max(0, (Date.now() - startedAt) / 1000));
    tick();
    const t = setInterval(tick, 300);
    return () => clearInterval(t);
  }, [busy, startedAt]);
  const pct = Math.min(99, Math.round(100 * (1 - Math.exp(-sec / 25))));
  const STEPS = ["내 진단 결과를 가져오고 있어요", `${next} 선택과목을 고르고 있어요`, g3 ? "마무리 탐구 3개를 짜고 있어요" : "이어 갈 탐구 5개를 짜고 있어요", "생수면 탐구 데이터로 흔한지 보고 있어요", "학기별 계획을 정리하고 있어요"];
  const stepNow = STEPS[Math.min(STEPS.length - 1, Math.floor((pct / 100) * STEPS.length))];

  if (!ready) return null;

  if (busy)
    return (
      <section className="mt-5 rounded-2xl bg-sm-navy p-6 text-center text-white">
        <small className="text-[12px] font-bold text-orange-300">{title} · 결제 완료</small>
        <p className="mt-4 text-[16px] font-bold">{stepNow}</p>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-orange-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-[26px] font-black tabular-nums">{pct}%</p>
        <p className="mt-1 text-[12.5px] text-slate-300">1분쯤 걸려요 · 화면을 닫아도 계속 만들어요. 나중에 다시 들어오면 볼 수 있어요.</p>
      </section>
    );

  // 결제는 했고 아직 안 만들었으면 — 버튼을 눌러 만든다
  if (!err && !data)
    return (
      <section className="mt-5 rounded-2xl bg-sm-navy p-6 text-center text-white">
        <small className="text-[12px] font-bold text-orange-300">{title} · 결제 완료</small>
        <p className="mt-2 text-[18px] font-bold leading-snug">
          지금 진단 결과로
          <br />
          {g3 ? "내 고3 1학기 계획을 만들어요" : "내 고2 1년 계획을 만들어요"}
        </p>
        <button onClick={() => load()} className="mt-4 h-12 w-full rounded-[10px] bg-orange-400 text-[15px] font-bold text-sm-navy">
          내 {title} 만들기
        </button>
      </section>
    );

  if (!data)
    return (
      <section className="mt-7 rounded-2xl bg-sm-navy p-6 text-center text-white">
        <small className="text-[12px] font-bold text-orange-300">{title} · 결제 완료</small>
        <p className="mt-3 text-[15px] font-bold">{err || "로드맵을 불러오지 못했어요."}</p>
        <button onClick={() => load()} className="mt-4 h-11 w-full rounded-[10px] bg-orange-400 text-[14px] font-bold text-sm-navy">다시 시도</button>
      </section>
    );

  const r = data.roadmap;
  const rg = r.target ?? "고2";
  const rTitle = rg === "고3" ? "고3 1학기 로드맵" : "고2 로드맵";
  const old = rg !== next; // 학년이 바뀌었는데 예전 로드맵이 저장돼 있으면
  const Box = ({ title, sub, children }) => (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-[16px] font-extrabold text-sm-navy">{title}</p>
      {sub && <p className="mt-0.5 text-[12.5px] text-gray-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );

  return (
    <div id="roadmap-print" className="mt-5 space-y-4">
      {err && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600">{err}</p>}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #roadmap-print, #roadmap-print * { visibility: visible !important; }
        #roadmap-print { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
        #roadmap-print > div, #roadmap-print > section { break-inside: avoid; }
      }`}</style>

      <section className="rounded-2xl bg-sm-navy p-5 text-white">
        <small className="text-[12px] font-bold text-orange-300">{rTitle} · {r.main}</small>
        <p className="mt-1 text-[19px] font-extrabold leading-snug">{r.headline}</p>
        {r.parent && <p className="mt-3 rounded-xl bg-white/10 p-3 text-[13.5px] leading-relaxed text-slate-100">{r.parent}</p>}
        {old && (
          <button onClick={() => load(true)} className="no-print mt-3 w-full rounded-xl bg-orange-400/20 px-3 py-2.5 text-left text-[13px] font-bold text-orange-200">
            {next} 활동까지 다 적었네요 → {next === "고3" ? "고3 1학기" : "고2"} 로드맵으로 새로 만들기
          </button>
        )}
      </section>

      <Box title={`① ${rg} 선택과목`} sub={`${r.main} 쪽으로 고르면 좋은 과목`}>
        <ul className="grid gap-2.5">
          {r.subjects.map((s) => (
            <li key={s.name} className="flex gap-2.5">
              <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${s.role === "핵심" ? "bg-sm-navy text-white" : "bg-gray-100 text-gray-600"}`}>{s.role}</span>
              <span>
                <b className="block text-[14.5px] text-sm-navy">{s.name}</b>
                <span className="text-[13px] leading-relaxed text-gray-600">{s.why}</span>
              </span>
            </li>
          ))}
        </ul>
        {r.combos.length > 0 && (
          <div className="mt-4 grid gap-2">
            <p className="text-[13px] font-bold text-sm-navy">같이 들으면 좋은 조합</p>
            {r.combos.map((c, i) => (
              <div key={i} className="rounded-xl bg-indigo-50 p-3">
                <p className="text-[13.5px] font-bold text-sm-navy">{c.names.join(" + ")}</p>
                <p className="mt-0.5 text-[12.5px] text-gray-600">{c.why}</p>
              </div>
            ))}
          </div>
        )}
      </Box>

      <Box title={rg === "고3" ? "② 고3 1학기 마무리 탐구" : "② 고2에 할 탐구 5개"} sub={`흔함 지수 · 생수면 탐구주제 데이터의 ${r.main} 사례 ${r.case_total ?? 0}개와 비교했어요`}>
        <ol className="grid gap-3">
          {r.inquiries.map((q, i) => (
            <li key={i} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-sm-navy px-1.5 py-0.5 text-[11px] font-bold text-white">{q.term}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-600">{q.subject}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${COMMON_STYLE[q.common?.level] ?? COMMON_STYLE.모름}`}>
                  {COMMON_LABEL[q.common?.level] ?? "사례 부족"}
                  {q.common?.total ? ` · 비슷한 사례 ${q.common.similar}개` : ""}
                </span>
              </div>
              <p className="mt-2 text-[15px] font-bold leading-snug text-sm-navy">{i + 1}. {q.title}</p>
              {q.from && <p className="mt-1 text-[12.5px] text-gray-500">고1 「{q.from}」에서 이어져요{q.fills ? ` · ${q.fills} 채우기` : ""}</p>}
              <ul className="mt-2 grid gap-1">
                {q.steps.map((st, j) => (
                  <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
                    <span className="font-bold text-sm-orange">{j + 1}</span>
                    {st}
                  </li>
                ))}
              </ul>
              {q.output && <p className="mt-2 text-[12.5px] font-bold text-gray-600">결과물 · {q.output}</p>}
              {q.common?.level === "흔함" && q.common.example && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">비슷한 사례: {q.common.example} — 나만의 대상·자료로 바꿔 보세요</p>
              )}
            </li>
          ))}
        </ol>
      </Box>

      <Box title="③ 약한 역량 채우기" sub={`${r.main}가 보는 역량 4개`}>
        <ul className="grid gap-3">
          {r.competencies.map((c) => (
            <li key={c.name}>
              <p className="text-[14px] font-bold text-sm-navy">
                {c.name} <span className={`ml-1 rounded px-1.5 py-0.5 text-[11.5px] ${STATUS_STYLE[c.status] ?? ""}`}>{c.status}</span>
              </p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-gray-600">→ {c.how}</p>
            </li>
          ))}
        </ul>
      </Box>

      <Box title={rg === "고3" ? "④ 고3 1학기 계획" : "④ 학기별 계획"} sub={rg === "고3" ? "수시에 들어가는 마지막 학기 · 과목 · 자율 · 동아리 · 진로" : "과목 · 자율 · 동아리 · 진로에서 무엇을 할지"}>
        <div className={`grid gap-4 ${Object.keys(r.terms ?? {}).length > 1 ? "sm:grid-cols-2" : ""}`}>
          {Object.keys(r.terms ?? {}).map((t) => (
            <div key={t}>
              <p className="rounded-lg bg-sm-navy px-3 py-1.5 text-[13px] font-bold text-white">{rg} {t}</p>
              <ul className="mt-2 grid gap-2">
                {(r.terms?.[t] ?? []).map((x, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-gray-700">
                    <b className="text-sm-navy">{x.area}</b> · {x.todo}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Box>

      {r.interview?.length > 0 && (
        <Box title="⭐ 면접에서 물어볼 내 활동" sub="수시 면접에서 이 활동은 꼭 준비해 두세요">
          <ul className="grid gap-3">
            {r.interview.map((v, i) => (
              <li key={i} className="rounded-xl bg-indigo-50 p-3.5">
                <p className="text-[12px] font-bold text-indigo-700">{v.activity}</p>
                <p className="mt-1 text-[14.5px] font-bold leading-snug text-sm-navy">Q. {v.question}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">답할 때 · {v.point}</p>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {r.books?.length > 0 && (
        <Box title={`⑤ ${rg}에 읽을 책`}>
          <ul className="grid gap-2">
            {r.books.map((b) => (
              <li key={b.title} className="text-[13px] leading-relaxed text-gray-700">
                <b className="text-sm-navy">『{b.title}』</b> · {b.why}
              </li>
            ))}
          </ul>
        </Box>
      )}

      
    </div>
  );
}

export default function NoteRoadmap() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState("load"); // load | paid | none
  const [next, setNext] = useState("고2");

  useEffect(() => {
    if (!user) return;
    Promise.all([supabase.from("note_roadmap_access").select("user_id").maybeSingle(), supabase.rpc("note_list")]).then(([acc, notes]) => {
      setNext(nextGrade(notes.data));
      setState(acc.data ? "paid" : "none");
    });
  }, [user]);

  if (loading) return <div className="py-24 text-center text-gray-500">불러오는 중…</div>;
  if (!user)
    return <LoginGate icon={<NoteIcon />} title="내 생기부 진단은 회원 전용이에요" desc="학년별 활동을 적으면 가고 싶은 학과 기준으로 AI가 입시 방향을 진단하고, 다음 학년 로드맵까지 짜 줘요." />;

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
        <Link to="/my/note" className="no-print text-[13px] font-semibold text-gray-500">← 내 생기부 노트</Link>
        <h1 className="mt-2 text-[24px] font-bold tracking-tight text-sm-navy">{next === "고3" ? "내 고3 1학기 로드맵" : "내 고2 로드맵"}</h1>

        {state === "load" && <p className="py-20 text-center text-[14px] text-gray-500">불러오는 중…</p>}
        {state === "none" && (
          <div className="mt-6 rounded-2xl bg-white p-8 text-center ring-1 ring-gray-200">
            <p className="text-[15px] font-bold text-sm-navy">로드맵은 결제 후에 열려요</p>
            <p className="mt-1 text-[13px] text-gray-500">AI 진단 결과 맨 아래에서 신청할 수 있어요</p>
            <Link to="/my/note/diagnosis" className="mt-4 inline-block rounded-[10px] bg-sm-navy px-6 py-3 text-[14.5px] font-bold text-white">AI 진단으로 가기</Link>
          </div>
        )}
        {state === "paid" && <RoadmapView next={next} />}
      </div>
    </div>
  );
}