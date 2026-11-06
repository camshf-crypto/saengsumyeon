import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import LoginGate from "../../components/LoginGate";
import { track } from "../../lib/track";
import { DesignGo, DocButton, Rich } from "../agent/Agent"; // 완성본 PDF · 보고서 디자인 버튼은 물꼬와 같은 것

/*
 * 내 입시 홈 — /my/home
 * 생수면에서 한 것(물꼬 답 저장 · 탐구주제 · 독서 · 지원동기 · 면접 예상질문 · 꼬리질문 · 탐구 보고서 · 입시 플랜 · 물꼬 대화)이
 * 날짜순으로 자동으로 쌓인다 (sql/sm_107 home_feed) · 맨 위는 이번 달 할 일 + 다음 달 미리 보기 (물꼬 서버 month_plan)
 * 맨 위는 「내 생기부」 보드 (비커스 입시 로드맵처럼 교과군 × 고1 · 고2 · 고3) — 수행평가 · 탐구를 끝내면 서버가 생기부 노트에 넣고(sql/sm_120)
 * 여기에 바로 보인다 · 직접 적기 · 고치기는 생기부 노트(/my/note)
 * 2026-11-06 무료 전환 — 지난 기록도 전부 열림 (home_feed 잠금 없앰)
 */
const KIND = {
  save: { label: "물꼬 답 저장", color: "#1E2A5A" },
  chat: { label: "물꼬 대화", color: "#3D6BEF" },
  topic: { label: "탐구주제 진단", color: "#EA580C" },
  reading: { label: "독서 진단", color: "#2F56D6" },
  motive: { label: "지원동기 진단", color: "#0B8A5E" },
  interview: { label: "생기부 예상질문", color: "#18224F" },
  tail: { label: "꼬리질문 연습", color: "#FD1673" },
  inquiry: { label: "탐구 보고서", color: "#C2410C" },
  plan: { label: "입시 플랜", color: "#0F9D58" },
  suhaeng: { label: "수행평가 완성", color: "#0F9D58" },
};
const FILTERS = [
  ["all", "전체"],
  ["save", "저장"],
  ["study", "탐구 · 진단"],
  ["interview", "면접"],
  ["plan", "플랜"],
  ["chat", "물꼬 대화"],
];
const IN_FILTER = {
  study: ["topic", "reading", "motive", "inquiry", "suhaeng"],
  interview: ["interview", "tail"],
};
const day = (d) => new Date(d).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
const monthOf = (d) => new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

/* ───────── 내 생기부 보드 — 교과군(줄) × 학년(칸) · 창의적 체험활동 · 독서 ───────── */
const GRADES = ["고1", "고2", "고3"];
const UNLOCK_AT = 10; // 고1 13칸(세특 10과목 + 자율 · 동아리 · 진로) 중 이만큼 채우면 AI 입시 방향 진단 (생기부 노트와 같게)
// 과목 이름 → 교과군 (앞에서부터 먼저 맞는 것)
const FAMILY = [
  { key: "국어", color: "#DB2777", re: /국어|문학|화법|언어|독서와|작문|매체|글쓰기/ },
  { key: "수학", color: "#4F46E5", re: /수학|미적분|확률|기하|대수|통계/ },
  { key: "영어", color: "#0284C7", re: /영어|영미|English/i },
  { key: "사회", color: "#16A34A", re: /사회|한국사|역사|지리|윤리|정치|경제|법|세계|동아시아|인권|도시|국제|철학|심리/ },
  { key: "과학", color: "#EA580C", re: /과학|물리|화학|생명|지구|생물|천문|역학|융합/ },
  { key: "체육", color: "#65A30D", re: /체육|운동|스포츠|건강/ },
  { key: "예술", color: "#BE185D", re: /미술|음악|연극|예술|영화|디자인/ },
  { key: "정보", color: "#2563EB", re: /정보|인공지능|프로그래밍|데이터|소프트웨어|컴퓨터|코딩/ },
  { key: "기타", color: "#6B7280", re: /./ },
];
const CORE = ["국어", "수학", "영어", "사회", "과학"]; // 기록이 없어도 늘 보이는 줄
const familyOf = (subject) => FAMILY.find((f) => f.re.test(String(subject ?? ""))) ?? FAMILY[FAMILY.length - 1];
const AREAS = [
  { kind: "autonomy", label: "자율 · 자치활동", color: "#7C3AED", ask: "자율활동 뭐 하면 좋을지 알려 줘" },
  { kind: "club", label: "동아리활동", color: "#0891B2", ask: "동아리활동 뭐 하면 좋을지 알려 줘" },
  { kind: "career", label: "진로활동", color: "#D97706", ask: "탐구주제 하자" },
  { kind: "book", label: "독서", color: "#475569", ask: "독서 흔한가 진단해 줘" },
];
const SRC = { suhaeng: "수행평가 완성", tamgu: "물꼬 탐구", inquiry: "탐구 보고서" };
const skey = (x) => String(x ?? "").replace(/\s/g, "");
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

// 한 칸 안의 카드 하나 (과목 하나 · 활동 하나) — 누르면 아래 자세히 보기
function Card({ name, rows, on, onClick }) {
  const last = rows[0];
  return (
    <button onClick={onClick} className={`block w-full border bg-white px-3 py-2.5 text-left ${on ? "border-sm-navy" : "border-gray-200 hover:border-gray-400"}`}>
      <span className="flex items-center justify-between gap-2">
        <b className="min-w-0 truncate text-[13.5px] font-bold text-gray-900">{name}</b>
        {rows.length > 1 && <span className="flex-none bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-600">{rows.length}개</span>}
      </span>
      {last && (
        <small className="mt-1 block text-[12px] leading-snug text-gray-500" style={clamp2}>
          {last.source && <b className="mr-1 font-bold text-sm-navy">{SRC[last.source] ?? ""}</b>}
          {last.title || last.content}
        </small>
      )}
    </button>
  );
}

// 수행평가 · 물꼬 탐구 칸을 누르면 — 완성본 전체 · PDF 저장 · 보고서 디자인(PDF) (물꼬 채팅과 같은 버튼)
function TaskFiles({ taskId }) {
  const [t, setT] = useState(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    supabase.from("school_tasks").select("draft").eq("id", taskId).maybeSingle().then(({ data }) => setT(data ?? null));
  }, [taskId]);
  if (t === undefined) return <p className="mt-2 text-[12.5px] text-gray-400">완성본 불러오는 중…</p>;
  if (!t?.draft) return null;
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="h-9 border border-gray-300 bg-white px-3.5 text-[12.5px] font-bold text-gray-700 hover:border-gray-500">
        {open ? "완성본 접기" : "완성본 전체 보기"}
      </button>
      {open && <div className="mt-2 max-h-[480px] overflow-y-auto border border-gray-200 bg-[#FAFAFA] p-4 text-[13.5px] leading-relaxed text-gray-800"><Rich text={t.draft} /></div>}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <DocButton taskId={taskId} kind="pdf" />
        <DesignGo taskId={taskId} />
      </div>
    </div>
  );
}

function RecordBoard({ rows, grade, onAsk }) {
  const nav = useNavigate();
  const now = GRADES.includes(grade) ? grade : "고1";
  const [pick, setPick] = useState(null); // { label, rows }
  const list = rows ?? [];

  // 교과 세특 — 교과군 → 학년 → 과목
  const subj = useMemo(() => {
    const m = new Map();
    for (const r of list.filter((x) => x.kind === "subject")) {
      const f = familyOf(r.subject).key;
      const k = `${f}|${r.grade}|${skey(r.subject)}`;
      if (!m.has(k)) m.set(k, { family: f, grade: r.grade, name: r.subject || "과목 미정", rows: [] });
      m.get(k).rows.push(r);
    }
    return [...m.values()];
  }, [list]);
  const families = FAMILY.filter((f) => CORE.includes(f.key) || subj.some((x) => x.family === f.key));

  // 진단까지 — 고1 세특 과목 수(10까지) + 자율 · 동아리 · 진로
  const g1 = list.filter((r) => r.grade === "고1");
  const filled = Math.min(new Set(g1.filter((r) => r.kind === "subject").map((r) => skey(r.subject)).filter(Boolean)).size, 10)
    + ["autonomy", "club", "career"].filter((k) => g1.some((r) => r.kind === k)).length;
  const total = list.filter((r) => r.kind !== "book").length;

  const Row = ({ dot, label, children }) => (
    <div className="grid grid-cols-[120px_repeat(3,minmax(0,1fr))] gap-x-4 border-t border-gray-100 py-2.5">
      <p className="flex items-center gap-2 self-center text-[13px] font-bold text-gray-700">
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
        {label}
      </p>
      {children}
    </div>
  );
  const Empty = ({ g, ask }) =>
    g === now ? (
      <button onClick={() => onAsk(ask)} className="flex min-h-[44px] w-full items-center justify-center border border-dashed border-gray-300 text-[12px] font-bold text-gray-400 hover:border-gray-500 hover:text-gray-700">
        물꼬로 채우기
      </button>
    ) : (
      <div className="flex min-h-[44px] items-center justify-center"><span className="h-px w-5 bg-gray-200" /></div>
    );

  return (
    <div className="border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-[13px] text-gray-500">
          <b className="mr-1.5 text-[28px] font-black text-gray-900">{total}</b>
          개 활동 · 수행평가 · 탐구를 끝내면 자동으로 들어와요
        </p>
        <div className="flex gap-2">
          <Link to="/my/note" className="h-9 border border-gray-300 bg-white px-3.5 text-[12.5px] font-bold leading-9 text-gray-700 hover:border-gray-500">직접 적기 · 고치기</Link>
          {filled >= UNLOCK_AT ? (
            <Link to="/my/note/diagnosis" className="h-9 bg-sm-navy px-3.5 text-[12.5px] font-bold leading-9 text-white">AI 입시 방향 진단</Link>
          ) : (
            <span className="h-9 border border-gray-200 bg-[#F7F8FA] px-3.5 text-[12.5px] font-bold leading-9 text-gray-500">고1 {filled}/{UNLOCK_AT}칸 · 다 채우면 진단</span>
          )}
        </div>
      </div>

      <div className="-mx-4 mt-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5 [scrollbar-width:none]">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[120px_repeat(3,minmax(0,1fr))] gap-x-4 pb-2">
            <span />
            {GRADES.map((g) => (
              <div key={g} className="border-b border-gray-200 pb-2">
                <p className="text-[17px] font-black text-gray-900">
                  {g}{g === now && <span className="ml-2 bg-[#EEF2FF] px-1.5 py-0.5 align-middle text-[11px] font-bold text-sm-navy">현재</span>}
                </p>
                <small className="text-[12px] text-gray-400">{new Set(subj.filter((x) => x.grade === g).map((x) => skey(x.name))).size}과목</small>
              </div>
            ))}
          </div>

          {families.map((f) => (
            <Row key={f.key} dot={f.color} label={f.key}>
              {GRADES.map((g) => {
                const cards = subj.filter((x) => x.family === f.key && x.grade === g);
                return (
                  <div key={g} className="space-y-1.5">
                    {cards.length
                      ? cards.map((c) => <Card key={c.name} name={c.name} rows={c.rows} on={pick?.key === `${g}${c.name}`} onClick={() => setPick(pick?.key === `${g}${c.name}` ? null : { key: `${g}${c.name}`, label: `${g} ${c.name} 세특`, rows: c.rows })} />)
                      : <Empty g={g} ask={f.key === "기타" ? "수행평가 하자" : `${f.key} 수행평가 하자`} />}
                  </div>
                );
              })}
            </Row>
          ))}

          <p className="mt-5 pb-1 text-[12px] font-bold text-gray-400">창의적 체험활동 · 독서</p>
          {AREAS.map((a) => (
            <Row key={a.kind} dot={a.color} label={a.label}>
              {GRADES.map((g) => {
                const rs = list.filter((r) => r.kind === a.kind && r.grade === g);
                return (
                  <div key={g} className="space-y-1.5">
                    {rs.length
                      ? rs.slice(0, 3).map((r) => (
                          <Card key={r.id} name={r.title || (a.kind === "book" ? r.content : a.label)} rows={[r]} on={pick?.key === `r${r.id}`}
                            onClick={() => setPick(pick?.key === `r${r.id}` ? null : { key: `r${r.id}`, label: `${g} ${a.label}`, rows: rs })} />
                        ))
                      : <Empty g={g} ask={a.ask} />}
                    {rs.length > 3 && <small className="block text-[11.5px] text-gray-400">{rs.length - 3}개 더</small>}
                  </div>
                );
              })}
            </Row>
          ))}
        </div>
      </div>

      {/* 누른 칸 자세히 */}
      {pick && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-extrabold text-gray-900">{pick.label}</p>
            <button onClick={() => setPick(null)} className="text-[12.5px] font-bold text-gray-400">닫기</button>
          </div>
          <div className="mt-2 space-y-3">
            {pick.rows.map((r) => (
              <div key={r.id} className="border-l-2 border-gray-300 pl-3">
                <small className="text-[11.5px] font-bold text-gray-400">{SRC[r.source] ?? "직접 적음"} · {day(r.at)}</small>
                {r.title && <b className="mt-0.5 block text-[14px] font-bold text-gray-900">{r.title}</b>}
                <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-gray-700">{r.content}</p>
                {(r.source === "suhaeng" || r.source === "tamgu") && <TaskFiles taskId={Number(r.source_id)} />}
                <div className="mt-1.5 flex gap-3 text-[12.5px] font-bold">
                  {r.source === "inquiry" && <Link to={`/inquiry/${r.source_id}/report`} className="text-sm-navy hover:underline">보고서 열기 · PDF 저장 ›</Link>}
                  {(r.source === "suhaeng" || r.source === "tamgu") && (
                    <button onClick={() => onAsk(`'${r.title}' ${r.source === "tamgu" ? "탐구" : "수행평가"} 이어서 하자`)} className="text-sm-navy hover:underline">물꼬에서 이어서 ›</button>
                  )}
                  <button onClick={() => nav("/my/note")} className="text-gray-400 hover:text-gray-700">고치기</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 로드맵 '바로 하기' 버튼 이름 (물꼬 서버 ROADMAP 의 go 말과 짝)
const GO_LABEL = {
  "탐구주제 하자": "탐구 설계 시작하기",
  "수행평가 하자": "수행평가 시작하기",
  "내 입시 플랜 짜 줘": "입시 플랜 짜기",
  "시험 공부법 알려 줘": "시험 공부법 받기",
  "수시 면접 준비할래": "면접 준비하기",
  "내 성적으로 갈 수 있는 대학 알려 줘": "갈 수 있는 대학 보기",
};

// 이번 달 할 일 + 다음 달 미리 보기 — 학년 로드맵 · 전국 입시 일정 · 학교 시험 · 학교 수행평가 (물꼬 서버 month_plan)
function MonthCard({ p, onCheck }) {
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  if (!p?.months?.length) return null;
  const ask = (q) => nav(`/agent?q=${encodeURIComponent(q)}`);
  const school = p.school_name || p.school;
  // 과제 한 줄 — 왼쪽 네모를 누르면 '했어요' 체크 (sql/sm_121 eval_checks) · 물꼬에서 끝낸 건 이미 완료라 체크 칸 대신 '완료'
  const Task = ({ t, mon }) => {
    const auto = t.done && !t.checked; // 물꼬 · 수행평가 페이지에서 끝낸 것
    return (
      <div className={`flex w-full items-stretch bg-[#F7F8FA] ${t.done ? "opacity-70" : ""}`}>
        <button
          onClick={() => !auto && t.id && onCheck?.(t)}
          disabled={auto || !t.id}
          title={auto ? "물꼬에서 끝낸 과제예요" : t.checked ? "체크 풀기" : "이미 했으면 체크"}
          className="flex w-12 flex-none items-center justify-center hover:bg-gray-200/60 disabled:hover:bg-transparent"
        >
          <span className={`relative block h-[22px] w-[22px] border-2 ${t.done ? "border-sm-navy bg-sm-navy" : "border-gray-300 bg-white"}`}>
            {t.done && <span className="absolute left-[6px] top-[1px] block h-[12px] w-[6px] rotate-45 border-b-2 border-r-2 border-white" />}
          </span>
        </button>
        <button
          onClick={() => ask(t.doing ? `${t.subject} 수행평가 '${t.title}' 이어서 하자` : `${t.subject} 수행평가 '${t.title}' 채점 기준이랑 준비 방법 알려 줘`)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3.5 text-left hover:bg-orange-50"
        >
          <span className="min-w-0 flex-1">
            <b className={`block truncate text-[13.5px] font-bold ${t.done ? "text-gray-500 line-through decoration-gray-400" : "text-gray-900"}`}>{t.subject} · {t.title}</b>
            <small className="text-[12px] text-gray-500">{t.period || "시기 미정"}{t.due && !t.done && <b className="ml-1.5 font-extrabold text-[#FD1673]">{mon}월 마감</b>}</small>
          </span>
          {t.done
            ? <span className="flex-none bg-sm-navy px-2 py-1 text-[12px] font-extrabold text-white">{t.checked ? "했어요" : "완료"}</span>
            : t.doing
              ? <span className="flex-none bg-white px-2 py-1 text-[12px] font-extrabold text-sm-navy ring-1 ring-sm-navy">하는 중</span>
              : <span className="flex-none bg-white px-2 py-1 text-[12px] font-extrabold text-sm-orange ring-1 ring-orange-200">{t.points ?? "?"}점</span>}
        </button>
      </div>
    );
  };
  const Month = ({ m, first }) => {
    const sorted = [...m.tasks].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done))); // 끝낸 건 아래로
    const tasks = first || more ? sorted : sorted.slice(0, 3);
    return (
      <div className={first ? "" : "mt-5 border-t border-dashed border-gray-200 pt-4"}>
        <p className={`text-[15px] font-black ${first ? "text-sm-navy" : "text-gray-500"}`}>
          {m.month}월 <span className="text-[12px] font-extrabold">{m.label}</span>
        </p>
        {m.road ? (
          <div className="mt-2 bg-[#F7F8FA] px-3.5 py-3">
            <p className="text-[12px] font-extrabold text-gray-500">{p.grade} {m.month}월 로드맵</p>
            <b className="mt-0.5 block text-[14.5px] font-extrabold text-gray-900">{m.road.t}</b>
            <p className="mt-1 text-[13px] leading-relaxed text-gray-700">{m.road.d}</p>
            {first && m.road.go && (
              <button onClick={() => ask(m.road.go)} className="mt-2.5 h-9 border border-gray-300 bg-white px-3.5 text-[13px] font-extrabold text-gray-800 hover:border-gray-500">
                {GO_LABEL[m.road.go] ?? "물꼬랑 하기"} ›
              </button>
            )}
          </div>
        ) : m.todo && (
          <p className="mt-2 rounded bg-orange-50 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-gray-800">
            <b className="font-extrabold">{p.grade} {m.month}월</b>엔 {m.todo}
          </p>
        )}
        {m.events?.length > 0 && (
          <div className="mt-3">
            <p className="text-[12px] font-extrabold text-gray-400">{school} {m.month}월 학교 일정</p>
            <ul className="mt-1 space-y-0.5">
              {(first ? m.events : m.events.slice(0, 5)).map((e, k) => (
                <li key={k} className={`flex items-baseline gap-2 text-[13px] ${e.past ? "text-gray-400" : "text-gray-800"}`}>
                  <span className="w-[88px] flex-none font-bold">{e.date}</span>
                  <span className="min-w-0 flex-1">{e.name}</span>
                  {!e.past && <span className="flex-none text-[12px] font-bold text-gray-500">{e.when}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {[...m.national.map((x) => `${x.date} · ${x.title}`), ...(m.events?.length ? [] : m.exams.map((x) => `${school} ${x}`))].map((x) => (
          <p key={x} className="mt-1.5 px-1 text-[13px] font-bold text-gray-700">{x}</p>
        ))}
        {m.tasks.length > 0 && (
          <>
            <p className="mt-3 text-[12px] font-extrabold text-gray-400">{school} 수행평가 {m.tasks.length}개{m.tasks.some((t) => t.done) ? ` · ${m.tasks.filter((t) => t.done).length}개 완료` : ""}{first && " · 이미 낸 건 왼쪽 네모를 체크"}</p>
            <div className="mt-1.5 space-y-1.5">{tasks.map((t, k) => <Task key={k} t={t} mon={m.month} />)}</div>
            {!first && !more && m.tasks.length > 3 && (
              <button onClick={() => setMore(true)} className="mt-1.5 text-[12.5px] font-bold text-gray-400">{m.tasks.length - 3}개 더 보기</button>
            )}
          </>
        )}
      </div>
    );
  };
  return (
    <div className="rounded bg-white p-4 ring-1 ring-black/10">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-extrabold text-gray-400">{school ? `${school} ${p.grade ?? ""}` : p.grade || "내"} 할 일</p>
        {p.term && <small className="text-[11px] text-gray-400">{p.term} 평가계획{p.exam_from === "학사일정" ? " · 시험 날짜는 학사일정" : ""} 기준</small>}
      </div>
      <div className="mt-2">
        <Month m={p.months[0]} first />
        {p.months[1] && <Month m={p.months[1]} />}
      </div>
      {p.term_over && (
        <p className="mt-4 bg-[#F7F8FA] px-3.5 py-2.5 text-[13px] leading-relaxed text-gray-700">
          기말고사가 시작돼서 이번 학기 수행평가는 끝났어요.{p.vacation ? ` 방학은 ${p.vacation}부터예요.` : ""}
        </p>
      )}
      {p.always?.length > 0 && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-gray-500">
          꾸준히 쌓는 상시 수행평가: {p.always.slice(0, 3).map((t) => `${t.subject} '${t.title}'`).join(" · ")}
        </p>
      )}
      {!p.school && <p className="mt-3 text-[12.5px] text-gray-400">학교를 알려 주면 그 학교 수행평가 · 시험 일정도 여기에 같이 떠요.</p>}
      {p.school && !p.has_data && <p className="mt-3 text-[12.5px] text-gray-400">{p.school} 평가계획을 준비하고 있어요. 들어오면 수행평가 일정이 여기에 같이 떠요.</p>}
      <button
        onClick={() => ask(`${p.months[0].month}월에 할 일 순서대로 계획 짜 줘`)}
        className="mt-4 h-11 w-full rounded bg-sm-navy text-[14px] font-extrabold text-white"
      >
        물꼬랑 {p.months[0].month}월 계획 짜기 ›
      </button>
      <p className="mt-2 text-center text-[11px] text-gray-400">수행평가를 누르면 물꼬가 채점 기준에 맞춰 준비 방법을 알려 줘요 · 최종 일정은 학교 공지를 따라요 · 로드맵은 비커스 AI 입시 로드맵 기준</p>
    </div>
  );
}

function Item({ it, onLocked, onDelete }) {
  const [open, setOpen] = useState(false);
  const k = KIND[it.kind] ?? { label: it.kind, color: "#18224F" };
  const head = (
    <div className="flex items-start gap-3">
      <span className="w-[3px] flex-none self-stretch" style={{ background: k.color }} />
      <span className="min-w-0 flex-1">
        <small className="text-[11.5px] font-extrabold" style={{ color: k.color }}>{k.label} · {day(it.at)}</small>
        <b className={`mt-0.5 block text-[14.5px] font-bold leading-snug text-gray-900 ${it.locked ? "select-none blur-[5px]" : ""}`}>{it.title}</b>
        {it.sub && !it.locked && <small className="mt-0.5 block truncate text-[12.5px] text-gray-500">{it.sub}</small>}
      </span>
      {it.locked ? (
    <span className="flex-none rounded bg-gray-100 px-2 py-1 text-[11.5px] font-extrabold text-gray-500">이용권</span>
      ) : it.kind === "save" ? (
        <span className="flex-none text-[12px] font-bold text-gray-400">{open ? "접기" : "펼치기"}</span>
      ) : (
        <span className="flex-none text-gray-300">›</span>
      )}
    </div>
  );
  const box = "block w-full rounded bg-white p-4 text-left ring-1 ring-black/10 hover:ring-black/15";
  if (it.locked) return <button onClick={onLocked} className={box}>{head}</button>;
  if (it.kind === "save")
    return (
      <div className={box}>
        <button onClick={() => setOpen(!open)} className="w-full text-left">{head}</button>
        {open && (
          <div className="mt-3 border-t border-gray-100 pt-3 text-[14px] leading-relaxed text-gray-700">
            <Rich text={it.body} />
            <div className="mt-3 flex gap-3 text-[12.5px] font-bold">
              {it.link && <Link to={it.link} className="text-sm-navy underline-offset-2 hover:underline">그 대화 열기 ›</Link>}
              <button onClick={() => onDelete(it.id)} className="text-gray-400 hover:text-red-500">지우기</button>
            </div>
          </div>
        )}
      </div>
    );
  return <Link to={it.link || "/my"} className={box}>{head}</Link>;
}

export default function MyHome() {
  const { user, loading } = useAuth();
  const [feed, setFeed] = useState(null); // { items, open_all, free_days }
  const [plan, setPlan] = useState(null); // 이번 달 할 일 (물꼬 서버 month_plan)
  const [filter, setFilter] = useState("all");
  const [record, setRecord] = useState(null); // 내 생기부 (sql/sm_120 home_record)
  const [my, setMy] = useState({}); // { grade, department }
  const [more, setMore] = useState(false); // 최근 기록 더 보기
  const nav = useNavigate();
  const ask = (q) => nav(`/agent?q=${encodeURIComponent(q)}`);

  const load = () =>
    supabase.rpc("home_feed").then(({ data, error }) => setFeed(error ? { items: [], open_all: false, error: true } : data));
  useEffect(() => {
    if (!user) return;
    track("myhome_view");
    load();
    supabase.rpc("home_record").then(({ data, error }) => setRecord(error ? [] : data ?? []));
    supabase.rpc("sm_get_my").then(({ data }) => data && setMy({ grade: data.grade, department: data.department }));
    supabase.functions.invoke("agent", { body: { action: "month_plan" } }).then(({ data }) => setPlan(data ?? null));
  }, [user]);

  const items = useMemo(() => {
    const all = feed?.items ?? [];
    if (filter === "all") return all;
    const kinds = IN_FILTER[filter] ?? [filter];
    return all.filter((x) => kinds.includes(x.kind));
  }, [feed, filter]);
  const shown = more ? items : items.slice(0, 12);

  // 달마다 묶기
  const groups = useMemo(() => {
    const g = [];
    for (const it of shown) {
      const m = monthOf(it.at);
      if (!g.length || g[g.length - 1].m !== m) g.push({ m, list: [] });
      g[g.length - 1].list.push(it);
    }
    return g;
  }, [shown]);

  // '했어요' 체크 · 풀기 — 화면을 먼저 바꾸고 저장 (실패하면 되돌림) · 다음 물꼬 팝업부터 남은 것만 알려 준다
  async function toggleCheck(t) {
    const on = !t.checked;
    const set = (v) => setPlan((p) => p && { ...p, months: p.months.map((m) => ({ ...m, tasks: m.tasks.map((x) => (x.id === t.id ? { ...x, checked: v, done: v } : x)) })) });
    set(on);
    const { error } = on
      ? await supabase.from("eval_checks").upsert({ eval_task_id: t.id }, { onConflict: "user_id,eval_task_id", ignoreDuplicates: true })
      : await supabase.from("eval_checks").delete().eq("eval_task_id", t.id);
    if (error) set(!on);
    else track(on ? "eval_check" : "eval_uncheck");
  }

  async function remove(id) {
    await supabase.from("home_saves").delete().eq("id", id);
    load();
  }

  if (loading) return null;
  if (!user) return <LoginGate title="내 입시 홈" desc="수행평가 · 탐구를 끝내면 내 생기부에 자동으로 쌓이고, 고1 · 고2 · 고3 한눈에 보여요." />;
  const grade = my.grade || plan?.grade;
  const school = plan?.school_name || plan?.school;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-4 py-7 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-[24px] font-black tracking-tight text-sm-navy">내 입시 홈</h1>
            <p className="mt-1 text-[13.5px] text-gray-500">
              {[school, grade, my.department && `희망 ${my.department}`].filter(Boolean).join(" · ") || "학교 · 학년 · 희망 학과를 알려 주면 그 기준으로 맞춰 줘요"}
            </p>
          </div>
          <Link to="/my" className="text-[12.5px] font-bold text-gray-400 hover:text-gray-700">정보 바꾸기 ›</Link>
        </div>

        {/* 내 생기부 — 비커스 입시 로드맵처럼 교과군 × 학년 */}
        <h2 className="mt-7 text-[17px] font-black text-gray-900">내 생기부</h2>
        <div className="mt-2">
          {record === null ? <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중…</p> : <RecordBoard rows={record} grade={grade} onAsk={ask} />}
        </div>

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {plan?.months?.length > 0 && (
          <div>
            <h2 className="text-[17px] font-black text-gray-900">이번 달 할 일</h2>
            <div className="mt-2"><MonthCard p={plan} onCheck={toggleCheck} /></div>
          </div>
        )}
        <div>
        <h2 className="text-[17px] font-black text-gray-900">최근 기록</h2>

        <div className="-mx-4 mt-2 overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="flex w-max gap-1.5">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded px-3.5 py-1.5 text-[13px] font-bold ${filter === k ? "bg-sm-navy text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>


        {feed === null ? (
          <p className="mt-10 text-center text-[13px] text-gray-400">불러오는 중…</p>
        ) : !items.length ? (
          <div className="mt-8 rounded bg-white p-6 text-center ring-1 ring-black/10">
            <p className="text-[15px] font-extrabold text-gray-900">아직 쌓인 게 없어요</p>
            <p className="mt-1 text-[13px] text-gray-500">물꼬에게 물어보거나 탐구주제를 진단하면 여기에 자동으로 쌓여요.</p>
            <Link to="/agent" className="mt-4 inline-block rounded bg-sm-navy px-5 py-2.5 text-[13.5px] font-extrabold text-white">물꼬에게 물어보기 ›</Link>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.m} className="mt-4">
              <p className="mb-2 text-[13px] font-extrabold text-gray-500">{g.m}</p>
              <div className="space-y-2">
                {g.list.map((it) => (
                  <Item key={`${it.kind}${it.id}`} it={it} onLocked={() => {}} onDelete={remove} />
                ))}
              </div>
            </section>
          ))
        )}
        {!more && items.length > 12 && (
          <button onClick={() => setMore(true)} className="mt-3 h-10 w-full border border-gray-200 text-[13px] font-bold text-gray-500 hover:border-gray-400">{items.length - 12}개 더 보기</button>
        )}
        </div>
        </div>
      </div>
    </div>
  );
}