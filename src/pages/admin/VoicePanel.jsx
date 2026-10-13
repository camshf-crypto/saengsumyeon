import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 첫 화면 '사람 › 학생 의견' 탭
 * 위: 3문항 설문 결과 (문항별 보기 · 학년별) + 응답 하나씩 보기(누가 · 언제) + 학생이 직접 쓴 말
 * 아래: 의견함 — '나도 원해' 순 · 상태 바꾸기(검토 중 → 만드는 중 → 반영됨) · 반영 소식 · 후보 추가
 * 반영됨으로 바꾸면 제안한 학생에게 조각 +3, 학생 의견함 맨 위에 2주 동안 소식으로 뜬다
 */
const GRADES = ["고1", "고2", "고3"];
const GCOLOR = { 고1: "#2563EB", 고2: "#0D9488", 고3: "#E8590C", 모름: "#9CA3AF" };
const QTITLE = { q1: "Q1. 생수면에 있으면 좋겠는 것 (여러 개)", q2: "Q2. 지금 제일 아쉬운 점 (하나)", q3: "Q3. 대학생 되면 계속 쓸 것 (여러 개)" };
const ST = [
  ["open", "받음"],
  ["review", "검토 중"],
  ["making", "만드는 중"],
  ["done", "반영됨"],
  ["hidden", "숨김"],
];
const n = (v) => Number(v ?? 0).toLocaleString();

// [{label, grade, n}] → [{label, total, by:{고1:..}}] 많은 순
function group(rows) {
  const m = {};
  (rows ?? []).forEach((r) => {
    const x = (m[r.label] ??= { label: r.label, total: 0, by: {} });
    x.total += Number(r.n);
    x.by[r.grade] = (x.by[r.grade] ?? 0) + Number(r.n);
  });
  return Object.values(m).sort((a, b) => b.total - a.total);
}

function Question({ title, rows, people }) {
  const list = group(rows);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="text-[14px] font-extrabold text-sm-navy">{title}</h4>
      <div className="mt-3 space-y-2">
        {list.map((x) => (
          <div key={x.label} className="text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-gray-800">{x.label}</span>
              <span className="shrink-0 text-gray-500">
                {n(x.total)}명 · {people ? Math.round((x.total / people) * 100) : 0}%
              </span>
            </div>
            {/* 학년별로 나눈 막대 */}
            <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-gray-100">
              {[...GRADES, "모름"].map((g) =>
                x.by[g] ? <span key={g} style={{ width: `${(x.by[g] / Math.max(1, people)) * 100}%`, background: GCOLOR[g] }} title={`${g} ${x.by[g]}명`} /> : null
              )}
            </div>
          </div>
        ))}
        {!list.length && <p className="text-[13px] text-gray-400">아직 응답이 없어요</p>}
      </div>
    </section>
  );
}

function Ideas() {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState({}); // { id: { status, note } }
  const [msg, setMsg] = useState("");
  const [nt, setNt] = useState("");
  const [ns, setNs] = useState("");

  const load = () => supabase.rpc("idea_admin_list").then(({ data, error }) => (error ? setMsg(error.message) : setList(data || [])));
  useEffect(() => {
    load();
  }, []);

  async function save(it) {
    const e = edit[it.id] ?? {};
    const status = e.status ?? it.status;
    const { error } = await supabase.rpc("idea_admin_set", { p_id: it.id, p_status: status, p_note: e.note ?? it.note ?? null });
    if (error) return setMsg(error.message);
    setMsg(status === "done" ? `'${it.title}' 반영됨 · 의견함 맨 위에 소식으로 떠요${it.author ? " · 제안한 학생 조각 +3" : ""}` : "저장했어요");
    setEdit((x) => ({ ...x, [it.id]: undefined }));
    load();
  }

  async function add(e) {
    e.preventDefault();
    if (nt.trim().length < 4) return;
    const { error } = await supabase.rpc("idea_admin_add", { p_title: nt, p_sub: ns || null });
    if (error) return setMsg(error.message);
    setNt("");
    setNs("");
    setMsg("후보를 올렸어요");
    load();
  }

  const input = "h-9 rounded-lg border border-gray-300 px-3 text-[13px] outline-none focus:border-sm-navy";
  return (
    <div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={nt} onChange={(e) => setNt(e.target.value.slice(0, 40))} placeholder="새 후보 기능 (40자)" className={`${input} min-w-[220px] flex-1`} />
        <input value={ns} onChange={(e) => setNs(e.target.value.slice(0, 80))} placeholder="한 줄 설명 (선택)" className={`${input} min-w-[220px] flex-1`} />
        <button className="h-9 rounded-lg bg-sm-navy px-4 text-[13px] font-bold text-white">후보 올리기</button>
      </form>
      {msg && <p className="mt-2 text-[13px] font-bold text-sm-navy">{msg}</p>}
      {!list && <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>}
      <div className="mt-3 space-y-2">
        {(list ?? []).map((it, i) => {
          const e = edit[it.id] ?? {};
          const st = e.status ?? it.status;
          return (
            <div key={it.id} className={`rounded-xl border border-gray-200 bg-white p-3.5 ${it.status === "hidden" ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-[12px] font-bold text-gray-400">{i + 1}</span>
                <b className="text-[14.5px] text-sm-navy">{it.title}</b>
                {it.sub && <span className="text-[12.5px] text-gray-500">{it.sub}</span>}
                <span className="ml-auto text-[13px] font-extrabold text-sm-navy">나도 원해 {n(it.votes)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-[11.5px] text-gray-500">
                {Object.entries(it.by_grade ?? {}).map(([g, c]) => (
                  <span key={g}>
                    <i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: GCOLOR[g] ?? "#9CA3AF" }} />
                    {g} {c}
                  </span>
                ))}
                <span>{it.author ? `학생 제안 · ${it.author.nick}` : "생수면 후보"}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                <select value={st} onChange={(ev) => setEdit((x) => ({ ...x, [it.id]: { ...e, status: ev.target.value } }))} className={input}>
                  {ST.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  value={e.note ?? it.note ?? ""}
                  onChange={(ev) => setEdit((x) => ({ ...x, [it.id]: { ...e, note: ev.target.value.slice(0, 80) } }))}
                  placeholder={st === "done" ? "반영 소식 예) 10/16(목)부터 수행평가 주제 추천이 열려요" : "학생에게 보일 한마디 (선택)"}
                  className={`${input} min-w-[240px] flex-1`}
                />
                <button onClick={() => save(it)} className="h-9 rounded-lg border border-sm-navy px-3 text-[13px] font-bold text-sm-navy">
                  저장
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* 불편해요 — 학생이 알려준 불편한 점 · 상태 + 답장 ('고쳤어요'면 학생에게 조각 +1) */
const FB = [
  ["new", "받음"],
  ["checking", "확인 중"],
  ["fixed", "고쳤어요"],
  ["keep", "그대로 둘게요"],
];
function Feedback() {
  const [st, setSt] = useState("new");
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState({});
  const [msg, setMsg] = useState("");

  const load = () => supabase.rpc("feedback_admin_list", { p_status: st }).then(({ data, error }) => (error ? setMsg(error.message) : setD(data)));
  useEffect(() => {
    setD(null);
    load();
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(f) {
    const e = edit[f.id] ?? {};
    const status = e.status ?? f.status;
    const { error } = await supabase.rpc("feedback_admin_set", { p_id: f.id, p_status: status, p_reply: e.reply ?? f.reply ?? null });
    if (error) return setMsg(error.message);
    setMsg(status === "fixed" ? "고쳤어요로 바꿨어요 · 학생에게 답장이 보이고 조각 +1" : "저장했어요");
    setEdit((x) => ({ ...x, [f.id]: undefined }));
    load();
  }

  const input = "h-9 rounded-lg border border-gray-300 px-3 text-[13px] outline-none focus:border-sm-navy";
  const c = d?.counts ?? {};
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {[...FB, [null, "전체"]].map(([k, l]) => (
          <button
            key={l}
            onClick={() => setSt(k)}
            className={`h-9 rounded-full px-3.5 text-[13px] font-bold ${st === k ? "bg-sm-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}
          >
            {l}
            {k && c[k] ? <span className="ml-1 opacity-70">{c[k]}</span> : null}
          </button>
        ))}
        {Object.keys(d?.areas ?? {}).length > 0 && (
          <span className="ml-2 text-[12px] text-gray-500">
            아직 처리 안 한 곳: {Object.entries(d.areas).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(" · ")}
          </span>
        )}
      </div>
      {msg && <p className="mt-2 text-[13px] font-bold text-sm-navy">{msg}</p>}
      {!d && <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>}
      {d && !d.list.length && <p className="py-10 text-center text-sm text-gray-400">알려준 불편함이 없어요</p>}
      <div className="mt-3 space-y-2">
        {(d?.list ?? []).map((f) => {
          const e = edit[f.id] ?? {};
          return (
            <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-3.5">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
                <b className="text-[13px] text-sm-navy">{f.area}</b>
                <span>{f.author?.nick ?? "학생"} · {f.grade ?? "-"}</span>
                <span>· {new Date(f.created_at).toLocaleString("ko-KR")}</span>
                {f.path && <span className="text-gray-400">· 보던 화면 {f.path}</span>}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-[14px] text-gray-800">{f.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select value={e.status ?? f.status} onChange={(ev) => setEdit((x) => ({ ...x, [f.id]: { ...e, status: ev.target.value } }))} className={input}>
                  {FB.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  value={e.reply ?? f.reply ?? ""}
                  onChange={(ev) => setEdit((x) => ({ ...x, [f.id]: { ...e, reply: ev.target.value.slice(0, 200) } }))}
                  placeholder="학생에게 답장 예) 고쳤어! 알려줘서 고마워"
                  className={`${input} min-w-[240px] flex-1`}
                />
                <button onClick={() => save(f)} className="h-9 rounded-lg border border-sm-navy px-3 text-[13px] font-bold text-sm-navy">
                  저장
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 설문 응답 하나씩 (최근 순) — 누가 · 언제 · 뭘 골랐는지
const when = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
function Answers({ from, to }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  useEffect(() => {
    setList(null);
    supabase
      .rpc("admin_survey_list", { p_from: from || null, p_to: to || null })
      .then(({ data, error }) => (error ? setErr(error.message) : setList(data || [])));
  }, [from, to]);
  if (err) return <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">{err}</p>;
  if (!list) return null;
  const rows = more ? list : list.slice(0, 10);
  const line = (k, arr, etc) => {
    const v = [...(Array.isArray(arr) ? arr : arr ? [arr] : []), etc && `기타: ${etc}`].filter(Boolean);
    return v.length ? (
      <p className="text-[12.5px] text-gray-700">
        <b className="mr-1.5 text-gray-400">{k}</b>
        {v.join(" · ")}
      </p>
    ) : null;
  };
  return (
    <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="text-[14px] font-extrabold text-sm-navy">응답 하나씩 보기 ({list.length})</h4>
      {list.length === 0 && <p className="py-6 text-center text-[13px] text-gray-400">아직 답한 학생이 없어요</p>}
      <ul className="mt-2 divide-y divide-gray-100">
        {rows.map((x, i) => (
          <li key={i} className="space-y-0.5 py-2.5">
            <p className="text-[12px]">
              <b className="mr-1.5" style={{ color: GCOLOR[x.grade] ?? "#9CA3AF" }}>{x.grade}</b>
              <b className="text-gray-800">{x.author?.nick ?? "(닉네임 없음)"}</b>
              <span className="ml-2 text-gray-400">{when(x.at)}</span>
            </p>
            {line("Q1", x.q1, x.q1_etc)}
            {line("Q2", x.q2, x.q2_etc)}
            {line("Q3", x.q3, x.q3_etc)}
            {x.memo && line("한마디", x.memo)}
          </li>
        ))}
      </ul>
      {list.length > 10 && (
        <button onClick={() => setMore((v) => !v)} className="mt-2 w-full rounded-lg bg-[#F4F5F7] py-2 text-[12.5px] font-bold text-gray-600">
          {more ? "접기" : `${list.length - 10}개 더 보기`}
        </button>
      )}
    </section>
  );
}

export default function VoicePanel({ from, to }) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setS(null);
    supabase.rpc("admin_survey_stats", { p_from: from || null, p_to: to || null }).then(({ data, error }) => (error ? setErr(error.message) : setS(data)));
  }, [from, to]);

  return (
    <div>
      <h3 className="text-[17px] font-extrabold text-sm-navy">설문 결과</h3>
      <p className="mt-0.5 text-[12.5px] text-gray-500">
        회원이 2일째 들어오면 한 번 뜨는 3문항 설문 · 끝내면 조각 +2 · 위에서 고른 기간에 답한 사람만
      </p>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">{err}</p>}
      {!s && !err && <p className="py-10 text-center text-sm text-gray-400">불러오는 중…</p>}
      {s && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <b className="text-[15px] text-sm-navy">응답 {n(s.total)}명</b>
            {Object.entries(s.by_grade ?? {}).map(([g, c]) => (
              <span key={g} className="text-gray-600">
                <i className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: GCOLOR[g] ?? "#9CA3AF" }} />
                {g} {n(c)}
              </span>
            ))}
            <span className="text-[12px] text-gray-400">막대 색 = 학년</span>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {["q1", "q2", "q3"].map((q) => (
              <Question key={q} title={QTITLE[q]} rows={s[q]} people={s.total} />
            ))}
          </div>
          <Answers from={from} to={to} />
          {s.texts?.length > 0 && (
            <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
              <h4 className="text-[14px] font-extrabold text-sm-navy">학생이 직접 쓴 말 ({s.texts.length})</h4>
              <ul className="mt-2 divide-y divide-gray-100">
                {s.texts.map((x, i) => (
                  <li key={i} className="py-2 text-[13px] text-gray-700">
                    <span className="mr-2 text-[11.5px] font-bold" style={{ color: GCOLOR[x.grade] ?? "#9CA3AF" }}>
                      {x.grade ?? "모름"}
                    </span>
                    {[x.q1 && `원하는 것: ${x.q1}`, x.q2 && `아쉬운 점: ${x.q2}`, x.q3 && `대학생 되면: ${x.q3}`, x.memo && `한마디: ${x.memo}`].filter(Boolean).join(" · ")}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <h3 className="mt-10 text-[17px] font-extrabold text-sm-navy">불편해요</h3>
      <p className="mt-0.5 mb-3 text-[12.5px] text-gray-500">학생이 알려준 지금 서비스의 불편한 점 · 학생 본인만 봐요 · 답장을 쓰면 학생 의견함에 보이고, 고쳤어요로 바꾸면 조각 +1</p>
      <Feedback />

      <h3 className="mt-10 text-[17px] font-extrabold text-sm-navy">의견함 (원하는 기능)</h3>
      <p className="mt-0.5 mb-3 text-[12.5px] text-gray-500">
        ‘나도 원해’ 많은 순 · 반영됨으로 바꾸면 학생 의견함 맨 위에 2주 동안 소식이 떠요 (학생이 제안한 거면 조각 +3) · 매주 목요일에 한 번씩 정리하면 좋아요
      </p>
      <Ideas />
    </div>
  );
}