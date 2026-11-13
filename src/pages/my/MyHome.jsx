import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { LoginPopup } from "../../components/LoginGate";
import { track } from "../../lib/track";
import { DesignGo, DocButton, OPENING_GAP, OpeningPopup, Rich } from "../agent/Agent"; // 완성본 PDF · 보고서 디자인 버튼은 물꼬와 같은 것

/*
 * 내 입시 홈 — /my/home
 * 생수면에서 한 것(물꼬 답 저장 · 탐구주제 · 독서 · 지원동기 · 면접 예상질문 · 꼬리질문 · 탐구 보고서 · 입시 플랜 · 물꼬 대화)이
 * 날짜순으로 자동으로 쌓인다 (sql/sm_107 home_feed) · 맨 위는 이번 달 할 일 + 다음 달 미리 보기 (물꼬 서버 month_plan)
 * 맨 위는 「내 생기부」 보드 (비커스 입시 로드맵처럼 교과군 × 고1 · 고2 · 고3) — 수행평가 · 탐구를 끝내면 서버가 생기부 노트에 넣고(sql/sm_120)
 * 여기에 바로 보인다 · 물꼬 밖에서 한 활동은 과목 창에서 바로 적는다 (생기부 노트는 2026-11-12 없앰)
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
const SRC = { suhaeng: "수행평가 완성", tamgu: "물꼬 탐구", inquiry: "탐구 보고서", self_suhaeng: "수행평가 · 직접 적음", self_tamgu: "탐구 · 직접 적음" };
const skey = (x) => String(x ?? "").replace(/\s/g, "");
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

// 수행평가 · 물꼬 탐구 칸을 누르면 — 완성본 전체 · PDF 저장 · 보고서 디자인(PDF) (물꼬 채팅과 같은 버튼)
function TaskFiles({ taskId, startOpen = false }) {
  const [t, setT] = useState(undefined);
  const [open, setOpen] = useState(startOpen);
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

// 고1 공통과목 (2022 개정) — 학교 평가계획이 없어도 고1은 이 과목으로 시작
const COMMON_G1 = ["공통국어", "공통수학", "공통영어", "한국사", "통합사회", "통합과학"];
// 이번 달 학교 수행평가(month_plan)에서 이 과목 것 — 이름이 서로 들어가 있으면 같은 과목
const sameSubj = (a, b) => { const x = skey(a), y = skey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/* ───────── 입시 로드맵 — 당근 목록처럼: 학년 탭 · 과목 한 줄씩 · 누르면 그 과목 · 오른쪽 아래 '+ 과목' ───────── */
// 물꼬에서 하는 중인 과제 줄 (주제가 정해지면 '진행 중'으로 먼저 들어온다 · 완성하면 완성본으로 바뀜)
const doingRow = (r) => String(r?.content ?? "").startsWith("진행 중");
function RoadList({ rows, grade, mine, plan, user, onGo, onAsk, onAdd, onReload, onResume, tabReq, doneMap = {}, onToggleDone }) {
  const now = GRADES.includes(grade) ? grade : "고1";
  const [tab, setTab] = useState(now);
  const [open, setOpen] = useState(null); // 누른 과목 { name, rows, tasks } 또는 창체 { area, rows }
  useEffect(() => setTab(now), [now]);
  const listRef = useRef(null);
  useEffect(() => { if (tabReq?.g) { setTab(tabReq.g); listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, [tabReq]);
  const list = rows ?? [];
  const tasksNow = (plan?.months?.[0]?.tasks ?? []);

  // 이 학년 과목 — 내가 고른 과목 + 기록이 있는 과목 (+ 고1인데 아무것도 없으면 공통과목)
  const items = useMemo(() => {
    const names = [];
    const add = (n) => { if (n && !names.some((x) => skey(x) === skey(n))) names.push(n); };
    (mine?.[tab] ?? []).forEach(add);
    list.filter((r) => r.kind === "subject" && r.grade === tab).forEach((r) => add(r.subject));
    if (!names.length && tab === "고1") COMMON_G1.forEach(add);
    return names.map((name) => ({
      name,
      family: familyOf(name).key,
      rows: list.filter((r) => r.kind === "subject" && r.grade === tab && sameSubj(r.subject, name)),
      tasks: tab === now ? tasksNow.filter((t) => sameSubj(t.subject, name)) : [],
    })).sort((a, b) => FAMILY.findIndex((f) => f.key === a.family) - FAMILY.findIndex((f) => f.key === b.family));
  }, [list, mine, tab, now, tasksNow]);
  const areas = AREAS.map((a) => ({ ...a, rows: list.filter((r) => r.kind === a.kind && r.grade === tab) }));
  const cnt = (rs, src) => rs.filter((r) => r.source === src).length;
  // 완료 = 수행평가 · 탐구를 둘 다 끝냄 · 또는 학생이 직접 '완료'로 누름 (탐구를 안 하는 과목도 있어서)
  const shOf = (rs) => rs.filter((r) => !doingRow(r) && /suhaeng/.test(r.source || "")).length;
  const tpOf = (rs) => rs.filter((r) => !doingRow(r) && /tamgu|inquiry/.test(r.source || "")).length;
  const marked = (name) => (doneMap[tab] ?? []).some((x) => skey(x) === skey(name));
  const isDone = (it) => marked(it.name) || (shOf(it.rows) > 0 && tpOf(it.rows) > 0);

  // 한 줄 — 왼쪽 네모(과목 앞 두 글자) · 가운데 이름 · 최근 기록 · 오른쪽 이번 달 수행평가
  const Line = ({ thumb, title, sub, meta, right, onClick }) => (
    <button onClick={onClick} className="flex w-full items-center gap-3.5 border-b border-gray-100 py-3.5 text-left hover:bg-[#FAFAFA]">
      <span className="flex h-14 w-14 flex-none items-center justify-center bg-[#F2F3F5] text-[15px] font-black text-gray-700">{thumb}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[15.5px] font-bold text-gray-900">{title}</b>
        <small className="mt-0.5 block truncate text-[12.5px] text-gray-500">{sub}</small>
        {meta && <small className="mt-0.5 block text-[12px] text-gray-400">{meta}</small>}
      </span>
      {right && <span className="flex-none text-right text-[13px] font-extrabold text-gray-900">{right}</span>}
    </button>
  );

  return (
    <div>
      {/* 학년 탭 */}
      <div ref={listRef} className="flex scroll-mt-4 border-b border-gray-200">
        {GRADES.map((g) => (
          <button key={g} onClick={() => setTab(g)} className={`h-11 flex-1 text-[14.5px] font-extrabold ${tab === g ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400"}`}>
            {g}{g === now && <span className="ml-1 text-[11px] font-bold text-gray-400">지금</span>}
          </button>
        ))}
      </div>

      {/* 과목 */}
      {items.length === 0 && (
        <button onClick={() => onAdd(tab)} className="mt-3 block w-full border border-dashed border-gray-300 py-6 text-center text-[13.5px] font-bold text-gray-500 hover:border-gray-500">
          {tab} 때 듣는 과목을 먼저 골라 주세요 ›
        </button>
      )}
      {items.map((it) => {
        const last = it.rows[0];
        const t = it.tasks.find((x) => !x.done);
        return (
          <Line key={it.name}
            thumb={it.family === "기타" ? it.name.replace(/\s/g, "").slice(0, 2) : it.family}
            title={it.name}
            sub={last ? last.title || last.content : tab === now ? "아직 기록 없음 · 눌러서 수행평가 · 탐구 시작" : GRADES.indexOf(tab) < GRADES.indexOf(now) ? `아직 기록 없음 · 눌러서 ${tab} 때 한 것 적기` : "들을 과목"}
            meta={it.rows.length ? `수행평가 ${cnt(it.rows, "suhaeng") + cnt(it.rows, "self_suhaeng")} · 탐구 ${cnt(it.rows, "tamgu") + cnt(it.rows, "inquiry") + cnt(it.rows, "self_tamgu")}` : ""}
            right={isDone(it) ? "완료" : it.rows.some(doingRow) ? <span className="text-gray-500">하는 중</span> : t ? <>{t.due ? "이번 달" : ""}<br /><span className="text-[12px] font-bold text-gray-500">수행 {t.points ?? "?"}점</span></> : shOf(it.rows) ? <span className="text-[12.5px] text-gray-500">탐구 남음</span> : tpOf(it.rows) ? <span className="text-[12.5px] text-gray-500">수행평가 남음</span> : ""}
            onClick={() => setOpen({ ...it })} />
        );
      })}

      {/* 창체 · 독서 */}
      <p className="mt-6 text-[12.5px] font-bold text-gray-400">창의적 체험활동 · 독서</p>
      {areas.map((a) => (
        <Line key={a.kind} thumb={a.label.slice(0, 2)} title={a.label}
          sub={a.rows[0] ? a.rows[0].title || a.rows[0].content : "아직 기록 없음"}
          meta={a.rows.length ? `${a.rows.length}개` : ""}
          onClick={() => setOpen({ area: a, name: a.label, rows: a.rows, tasks: [] })} />
      ))}

      {/* 오른쪽 아래 '+ 과목' (당근 글쓰기 버튼 자리) */}
      <button onClick={() => onAdd(tab)} className="fixed bottom-20 right-5 z-40 h-12 bg-gray-900 px-5 text-[14.5px] font-extrabold text-white shadow-lg sm:bottom-6 sm:right-8">+ 과목</button>

      {/* 누른 과목 — 아래에서 올라오는 창 */}
      {open && (() => {
        // 완성한 것 먼저 · 같은 과제(같은 종류 + 같은 제목)를 두 번 끝냈으면 마지막 것만
        const seen = new Set();
        const doneRows = open.rows.filter((r) => !doingRow(r)).filter((r) => { const k = `${r.source}|${skey(r.title)}`; if (r.title && seen.has(k)) return false; seen.add(k); return true; });
        const shownRows = [...doneRows, ...open.rows.filter(doingRow)];
        return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(null)}>
          <div className="max-h-[88dvh] w-full max-w-lg overflow-y-auto bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <small className="text-[12px] font-bold text-gray-400">{tab}</small>
                <p className="text-[20px] font-black text-gray-900">{open.name}</p>
              </div>
              <button onClick={() => setOpen(null)} className="text-[13px] font-bold text-gray-400">닫기</button>
            </div>

            {/* 지금 학년이면 바로 시작 — 그 과목만 하는 물꼬 화면 · 이미 완성한 게 있으면 위 큰 버튼 대신 완성본부터 (새로 하기는 맨 아래 작게) */}
            {tab === now && open.area && (open.area ? (
              <button onClick={() => (open.area.kind === "career" ? onGo("tp", "진로") : onAsk(open.area.ask))} className="mt-4 h-12 w-full bg-gray-900 text-[15px] font-extrabold text-white">
                {open.area.kind === "career" ? "진로 탐구 하기" : "물꼬랑 채우기"}
              </button>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => onGo("sh", open.name)} className="h-12 bg-gray-900 text-[15px] font-extrabold text-white">수행평가 하기</button>
                <button onClick={() => onGo("tp", open.name)} className="h-12 border border-gray-900 bg-white text-[15px] font-extrabold text-gray-900">탐구 하기</button>
              </div>
            ))}

            {open.tasks?.length > 0 && (
              <div className="mt-5">
                <p className="text-[12.5px] font-bold text-gray-400">이번 달 학교 수행평가</p>
                {open.tasks.map((t) => (
                  <p key={t.id ?? t.title} className="mt-1.5 flex justify-between gap-3 bg-[#F7F8FA] px-3 py-2.5 text-[13.5px]">
                    <span className={`min-w-0 truncate font-bold ${t.done ? "text-gray-400 line-through" : "text-gray-900"}`}>{t.title}</span>
                    <span className="flex-none text-gray-500">{t.done ? "완료" : `${t.points ?? "?"}점`}</span>
                  </p>
                ))}
              </div>
            )}

            {/* 과목은 수행평가 · 탐구를 따로 — 칸마다 완성한 것 + '하나 더' 버튼 (한 과목에서 둘 다 여러 번 낼 수 있다) · 창체는 한 줄 목록 */}
            {(open.area ? [["", "내 생기부에 들어간 것", shownRows]] : [
              ["sh", "수행평가", shownRows.filter((r) => /suhaeng/.test(r.source || ""))],
              ["tp", "탐구", shownRows.filter((r) => /tamgu|inquiry/.test(r.source || ""))],
              ["", "직접 적은 것", shownRows.filter((r) => !/suhaeng|tamgu|inquiry/.test(r.source || ""))],
            ]).filter(([k, , list]) => k || list.length || open.area).map(([k, label, list]) => (
              <div key={label} className="mt-6">
                <div className="flex items-baseline justify-between border-b border-gray-900 pb-1.5">
                  <p className="text-[15px] font-black text-gray-900">{label}{list.length > 0 && <span className="ml-1.5 text-[12.5px] font-bold text-gray-400">{list.filter((r) => !doingRow(r)).length ? `완성 ${list.filter((r) => !doingRow(r)).length}개` : ""}</span>}</p>
                </div>
                {!list.length && <p className="mt-2 text-[13px] text-gray-500">{tab === now ? (k ? `아직 없어요. 물꼬랑 끝내면 여기에 바로 들어와요.` : "아직 없어요. 물꼬랑 끝내면 여기에 바로 들어와요.") : GRADES.indexOf(tab) < GRADES.indexOf(now) ? "아직 적은 게 없어요. 아래에 적어 두면 들어와요." : "아직 없어요."}</p>}
                <div className="mt-2.5 space-y-3">
                  {list.map((r, i) => (
                    <div key={r.id} className={`border-l-2 pl-3 ${doingRow(r) ? "border-gray-300" : "border-gray-900"}`}>
                      <small className="text-[11.5px] font-bold text-gray-400">{doingRow(r) ? "하는 중" : SRC[r.source] ?? "직접 적음"} · {day(r.at)}</small>
                      {r.title && <b className="mt-0.5 block text-[14px] font-bold text-gray-900">{r.title}</b>}
                      {doingRow(r) ? (
                        <button onClick={() => onResume(r)} className="mt-2 h-10 w-full border border-gray-900 text-[13.5px] font-extrabold text-gray-900">물꼬에서 이어서 하기 ›</button>
                      ) : <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-gray-700" style={clamp2}>{r.content}</p>}
                      {!doingRow(r) && (r.source === "suhaeng" || r.source === "tamgu") && <TaskFiles taskId={Number(r.source_id)} startOpen={i === 0} />}
                      {r.source === "inquiry" && <Link to={`/inquiry/${r.source_id}/report`} className="mt-1.5 inline-block text-[12.5px] font-bold text-gray-700 hover:underline">보고서 열기 · PDF 저장 ›</Link>}
                    </div>
                  ))}
                </div>
                {k && tab === now && (
                  <button onClick={() => onGo(k, open.name)} className={`mt-3 h-11 w-full text-[14px] font-extrabold ${list.length ? "border border-gray-900 bg-white text-gray-900" : "bg-gray-900 text-white"}`}>
                    {list.length ? `+ ${label} 하나 더 하기` : `${label} 하기`}
                  </button>
                )}
              </div>
            ))}
            {/* 과목 완료 — 둘 다 했으면 저절로 · 아니면 학생이 직접 (탐구를 안 하는 과목) */}
            {user && !open.area && GRADES.indexOf(tab) <= GRADES.indexOf(now) && (() => {
              const auto = shOf(open.rows) > 0 && tpOf(open.rows) > 0;
              const on = marked(open.name);
              return (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  {auto ? <p className="text-[13.5px] font-bold text-gray-900">완료 · 수행평가 · 탐구를 둘 다 했어요</p> : (
                    <button onClick={() => onToggleDone?.(tab, open.name, items.map((x) => x.name))}
                      className={`h-11 w-full text-[14px] font-extrabold ${on ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-700 hover:border-gray-900"}`}>
                      {on ? "완료로 표시했어요 · 누르면 풀기" : "이 과목 끝 · 완료로 표시"}
                    </button>
                  )}
                  {!auto && !on && <p className="mt-1.5 text-[12px] text-gray-400">수행평가 · 탐구를 둘 다 하면 저절로 완료돼요. 탐구를 안 하는 과목이면 눌러서 끝내요.</p>}
                </div>
              );
            })()}
            {/* 지난 학년: 적기만 (처음부터 열림) · 지금 학년: 물꼬로 시작 + 이미 한 것 적기(접힘) · 다음 학년: 아직 없음 */}
            {user && GRADES.indexOf(tab) <= GRADES.indexOf(now) && <ActivityForm key={`${tab}${open.name}`} grade={tab} past={tab !== now} kind={open.area ? open.area.kind : "subject"} subject={open.area ? "" : open.name} onAdded={onReload} />}
            {GRADES.indexOf(tab) > GRADES.indexOf(now) && <p className="mt-5 text-[13px] text-gray-500">{tab}이 되면 여기서 수행평가 · 탐구를 시작해요. 지금은 들을 과목만 미리 골라 둘 수 있어요.</p>}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

/* '+ 과목' — 우리 학교 그 학년 평가계획 과목에서 고르기 (없으면 많이 듣는 과목) · 직접 적기 · 저장은 my_subjects (sql/sm_122) */
const MORE_SUBJ = ["문학", "독서와 작문", "화법과 언어", "대수", "미적분Ⅰ", "확률과 통계", "영어Ⅰ", "영어Ⅱ", "세계사", "사회와 문화", "정치", "경제", "생활과 윤리", "물리학", "화학", "생명과학", "지구과학", "정보"];
// 과목 고르기 칸 — 우리 학교 그 학년 평가계획 과목 (없으면 많이 듣는 과목) + 직접 적기 · '+ 과목' 창과 처음 설정이 같이 쓴다
// 가고 싶은 학과 → 대학들이 권하는 선택과목 (agent subject_reco · 2028학년도 대학 권장과목) — 누르면 내 과목에 넣기
function RecoBox({ dept0, on, toggle }) {
  const [dept, setDept] = useState(dept0 || "");
  const [univ, setUniv] = useState("");
  const [res, setRes] = useState(null); // { list, univ_count, note } · "loading"
  const ready = dept.trim() && univ.trim();
  const ask = async (d = dept, u = univ) => {
    if (!d.trim() || !u.trim()) return;
    setRes("loading");
    const { data } = await supabase.functions.invoke("agent", { body: { action: "subject_reco", department: d.trim(), university: u.trim() } }).catch(() => ({ data: null }));
    setRes(data ?? { list: [], note: "추천을 불러오지 못했어요" });
    track("road_subject_reco");
  };

  return (
    <div className="mb-5 bg-[#F7F8FA] p-4">
      <p className="text-[14px] font-extrabold text-gray-900">가고 싶은 대학 · 학과가 권하는 과목</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <input value={univ} onChange={(e) => setUniv(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="대학 (예: 연세대)" className="h-11 min-w-0 border border-gray-300 bg-white px-2.5 text-[14px] outline-none focus:border-gray-900" />
        <input value={dept} onChange={(e) => setDept(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="학과 (예: 기계공학과)" className="h-11 min-w-0 border border-gray-300 bg-white px-2.5 text-[14px] outline-none focus:border-gray-900" />
      </div>
      <button onClick={() => ask()} disabled={!ready} className="mt-1.5 h-11 w-full bg-gray-900 text-[14px] font-bold text-white disabled:bg-gray-300">{ready ? "추천 과목 보기" : "대학 · 학과를 둘 다 적어 주세요"}</button>
      {res === "loading" && <p className="mt-3 text-[12.5px] text-gray-400">대학 권장과목 찾는 중… (학과 이름이 다르면 물꼬가 계열을 찾아요)</p>}
      {res && res !== "loading" && (
        res.list?.length ? (
          <>
            {/* 학과 이름이 그대로 없으면 — 물꼬가 그 학과가 속한 계열 · 단과대학을 찾아 한두 줄로 */}
            {res.why && !res.exact && <p className="mt-3 border-l-2 border-gray-900 bg-white px-3 py-2 text-[13px] leading-relaxed text-gray-800">{res.why}</p>}
            <p className="mt-3 text-[12px] text-gray-500">{res.university} {res.matched?.length ? res.matched.join(" · ") : res.department} 권장과목 · 누르면 내 과목에 들어가요</p>
            <div className="mt-2 space-y-1.5">
              {res.list.map((x) => (
                <button key={x.name} onClick={() => toggle(x.name)} className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left ${on(x.name) ? "bg-gray-900 text-white" : "border border-gray-200 bg-white text-gray-900"}`}>
                  <b className="min-w-0 truncate text-[14px] font-bold">{x.name}</b>
                  <small className={`flex-none text-[12px] ${on(x.name) ? "text-gray-300" : "text-gray-500"}`}>
                    {x.core ? "핵심" : "권장"}
                  </small>
                </button>
              ))}
            </div>
            {res.notes?.length > 0 && <div className="mt-2 space-y-1">{res.notes.map((n) => <p key={n} className="text-[12px] leading-relaxed text-gray-600">· {n}</p>)}</div>}
            <p className="mt-2 text-[11.5px] text-gray-400">2028학년도 대학 발표 자료 · 권장과목은 필수가 아니라 대학이 들으면 좋다고 권하는 과목이에요.</p>
          </>
        ) : <p className="mt-3 text-[12.5px] leading-relaxed text-gray-600">{res.university && res.matched?.length ? `${res.university} ${res.matched.join(" · ")}: ` : ""}{res.note || "이 대학 · 학과 권장과목 자료가 아직 없어요"}</p>
      )}
    </div>
  );
}

function SubjectChips({ grade, pick, setPick, dept }) {
  const [list, setList] = useState(null);
  const [school, setSchool] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    setList(null);
    supabase.functions.invoke("agent", { body: { action: "school_subjects", grade } }).then(({ data }) => {
      setSchool(data?.subjects?.length ? data.school ?? "" : "");
      setList(data?.subjects?.length ? data.subjects : grade === "고1" ? COMMON_G1 : MORE_SUBJ);
    }).catch(() => setList(grade === "고1" ? COMMON_G1 : MORE_SUBJ));
  }, [grade]);
  const on = (n) => pick.some((x) => skey(x) === skey(n));
  const toggle = (n) => setPick((p) => (on(n) ? p.filter((x) => skey(x) !== skey(n)) : [...p, n]));
  const addText = () => { const n = text.trim().slice(0, 30); if (n && !on(n)) setPick((p) => [...p, n]); setText(""); };
  const all = [...new Set([...(list ?? []), ...pick])];
  return (
    <div>
      {grade !== "고1" && <RecoBox dept0={dept} on={on} toggle={toggle} />}
      {school && <p className="mb-3 text-[12.5px] text-gray-500">{school} {grade} 평가계획 과목이에요.</p>}
      {list === null ? <p className="py-6 text-center text-[13px] text-gray-400">과목 불러오는 중…</p> : (
        <div className="flex flex-wrap gap-2">
          {all.map((n) => (
            <button key={n} onClick={() => toggle(n)} className={`h-10 px-3.5 text-[14px] font-bold ${on(n) ? "bg-gray-900 text-white" : "border border-gray-300 bg-white text-gray-700"}`}>{n}</button>
          ))}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addText()} placeholder="목록에 없으면 과목 이름 적기" className="h-11 min-w-0 flex-1 border border-gray-300 px-3 text-[14px] outline-none focus:border-gray-900" />
        <button onClick={addText} className="h-11 flex-none border border-gray-900 px-4 text-[14px] font-bold text-gray-900">추가</button>
      </div>
    </div>
  );
}

// 아래에서 올라오는 창 틀 (과목 · 과목 고르기 · 처음 설정)
function Sheet({ onClose, title, sub, foot, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-100 p-5 pb-3">
          <p className="text-[19px] font-black text-gray-900">{title}</p>
          {sub && <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{sub}</p>}
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {foot && <div className="border-t border-gray-100 p-4">{foot}</div>}
      </div>
    </div>
  );
}

function SubjectPicker({ grade, have, dept, onClose, onSave }) {
  const [pick, setPick] = useState(have);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet onClose={onClose} title={`${grade} 내 과목`} sub="듣는(들은) 과목을 모두 눌러 주세요."
      foot={<button disabled={saving} onClick={async () => { setSaving(true); await onSave(pick); setSaving(false); }} className="h-12 w-full bg-gray-900 text-[15px] font-extrabold text-white disabled:opacity-50">{saving ? "저장 중…" : `${pick.length}과목 저장`}</button>}>
      <SubjectChips grade={grade} pick={pick} setPick={setPick} dept={dept} />
    </Sheet>
  );
}

// 과목 · 활동 하나에 '내가 한 활동' 적기 → 내 생기부 (sql/sm_122 road_add_activity) · 물꼬가 새 탐구 · 수행평가를 짤 때 읽는다
function ActivityForm({ grade, kind, subject, onAdded, past = false }) {
  // 처음엔 접혀 있다 (위의 '수행평가 하기 · 탐구 하기'와 헷갈리지 않게) — 열면 수행평가 칸 · 탐구 칸 따로 (처음 설정과 같은 모양)
  const [open, setOpen] = useState(past); // 지난 학년은 처음부터 열어 둔다 (그 학년엔 적는 것만 한다)
  const [sh, setSh] = useState("");
  const [tp, setTp] = useState("");
  const [state, setState] = useState("");
  const isSubj = kind === "subject";
  async function save() {
    const rows = isSubj ? [["suhaeng", sh], ["tamgu", tp]] : [[kind === "career" ? "tamgu" : "", sh]];
    const todo = rows.filter(([, t]) => t.trim());
    if (!todo.length) return;
    setState("saving");
    const res = await Promise.all(todo.map(([type, t]) => supabase.rpc("road_add_activity", { p_grade: grade, p_kind: kind, p_subject: subject || "", p_title: t.trim(), p_content: "", p_type: type })));
    if (res.some((r) => r.error)) return setState("fail");
    track("road_activity_add");
    setSh(""); setTp(""); setState("ok");
    onAdded?.();
  }
  if (!open) return (
    <button onClick={() => setOpen(true)} className="mt-5 block w-full border-t border-gray-100 pt-4 text-left text-[13px] font-bold text-gray-500 hover:text-gray-900">
      물꼬 없이 이미 한 {isSubj ? "수행평가 · 탐구" : "활동"}가 있으면 적어 두기 ›
    </button>
  );
  const box = "mt-1 h-11 w-full border border-gray-300 px-3 text-[14px] outline-none focus:border-gray-900";
  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <p className="text-[12.5px] font-bold text-gray-400">{past ? `${grade} 때 한 것 적기` : "이미 한 것 적기"} — 물꼬가 다음 탐구 · 수행평가에 이어서 써요</p>
      {isSubj ? (
        <>
          <label className="mt-2 block text-[12px] font-bold text-gray-500">수행평가<input value={sh} onChange={(e) => setSh(e.target.value)} placeholder={`${subject} 수행평가 제목`} className={box} /></label>
          <label className="mt-2 block text-[12px] font-bold text-gray-500">탐구<input value={tp} onChange={(e) => setTp(e.target.value)} placeholder={`${subject} 탐구 주제`} className={box} /></label>
        </>
      ) : (
        <input value={sh} onChange={(e) => setSh(e.target.value)} placeholder="활동 이름 (예: 과학 동아리 실험 발표)" className={`mt-2 ${box}`} />
      )}
      <button onClick={save} disabled={(!sh.trim() && !tp.trim()) || state === "saving"} className="mt-2 h-11 w-full border border-gray-900 text-[14px] font-extrabold text-gray-900 disabled:border-gray-200 disabled:text-gray-300">
        {state === "saving" ? "저장 중…" : state === "ok" ? "저장했어요 · 더 적기" : state === "fail" ? "저장 못 했어요 · 다시 누르기" : "내 생기부에 넣기"}
      </button>
    </div>
  );
}

/* 처음 들어왔을 때 — 학년 → 고1부터 지금 학년까지 과목 → 지난 학년 활동(선택) · 끝나면 로드맵
 * 지난 학년 과목 · 활동까지 넣어야 물꼬가 그걸 이어서 새 탐구 · 수행평가를 짠다 */
function RoadSetup({ grade0, dept, onDone, onSkip }) {
  const [grade, setGrade] = useState(GRADES.includes(grade0) ? grade0 : "");
  const [step, setStep] = useState(0); // 0 학년 · 그다음 [과목 고1, 활동 고1, 과목 고2, …]
  const [subs, setSubs] = useState({});
  const [acts, setActs] = useState({}); // { "고1|공통수학|suhaeng": ["제목", …] } — 과목마다 수행평가 · 탐구 여러 개
  const [saving, setSaving] = useState(false);
  const gi = GRADES.indexOf(grade);
  const steps = gi < 0 ? [] : GRADES.slice(0, gi + 1).flatMap((g, i) => (i < gi ? [["subj", g], ["act", g]] : [["subj", g]]));
  const cur = step > 0 ? steps[step - 1] : null;
  const pick = cur ? subs[cur[1]] ?? (cur[1] === "고1" ? COMMON_G1 : []) : [];
  const setPick = (f) => setSubs((m) => ({ ...m, [cur[1]]: typeof f === "function" ? f(m[cur[1]] ?? (cur[1] === "고1" ? COMMON_G1 : [])) : f }));
  const last = step === steps.length;
  async function finish() {
    setSaving(true);
    const all = Object.fromEntries(steps.filter(([k]) => k === "subj").map(([, g]) => [g, subs[g] ?? (g === "고1" ? COMMON_G1 : [])]));
    await Promise.all([
      supabase.rpc("road_set_grade", { p_grade: grade }),
      supabase.auth.updateUser({ data: { grade } }).catch(() => null),
      supabase.from("my_subjects").upsert(Object.entries(all).map(([g, list]) => ({ grade: g, subjects: list, updated_at: new Date().toISOString() })), { onConflict: "user_id,grade" }),
      ...Object.entries(acts).flatMap(([k, list]) => {
        const [g, subj, type] = k.split("|");
        return list.filter((t) => t.trim()).map((t) => supabase.rpc("road_add_activity", { p_grade: g, p_kind: "subject", p_subject: subj, p_title: t.trim(), p_content: "", p_type: type }));
      }),
    ]);
    track("road_setup_done");
    setSaving(false);
    onDone(grade, all);
  }
  const next = () => (last ? finish() : setStep(step + 1));
  const foot = (
    <div className="flex gap-2">
      {step > 0 && <button onClick={() => setStep(step - 1)} className="h-12 w-24 flex-none border border-gray-300 text-[14px] font-bold text-gray-600">이전</button>}
      <button disabled={!grade || saving || (cur?.[0] === "subj" && !pick.length)} onClick={next} className="h-12 flex-1 bg-gray-900 text-[15px] font-extrabold text-white disabled:opacity-40">
        {saving ? "저장 중…" : last ? "로드맵 만들기" : "다음"}
      </button>
    </div>
  );
  if (!cur) return (
    <Sheet onClose={onSkip} title="내 입시 로드맵 만들기" sub="학년과 과목을 알려 주면, 지난 학년에 한 것까지 이어서 물꼬가 탐구 · 수행평가를 짜 줘요." foot={foot}>
      <p className="text-[14px] font-bold text-gray-900">지금 몇 학년이야?</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {GRADES.map((g) => <button key={g} onClick={() => setGrade(g)} className={`h-14 text-[16px] font-extrabold ${grade === g ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-700"}`}>{g}</button>)}
      </div>
      <button onClick={onSkip} className="mt-6 block w-full text-center text-[12.5px] font-bold text-gray-400">나중에 할게요</button>
    </Sheet>
  );
  const [kind, g] = cur;
  const past = GRADES.indexOf(g) < gi;
  if (kind === "subj") return (
    <Sheet onClose={onSkip} title={`${g} ${past ? "때 들은" : "지금 듣는"} 과목`} sub={past ? "기억나는 만큼만 골라도 돼요. 지난 과목과 이어지는 주제를 물꼬가 찾아 줘요." : "듣는 과목을 모두 눌러 주세요."} foot={foot}>
      <SubjectChips grade={g} pick={pick} setPick={setPick} dept={dept} />
    </Sheet>
  );
  // 과목 하나에 수행평가 · 탐구 칸 — 칸을 채우면 아래에 빈 칸이 하나 더 생긴다
  const Field = ({ subj, type, label, ph }) => {
    const k = `${g}|${subj}|${type}`;
    const list = acts[k] ?? [];
    const rows = [...list.filter((x) => x.trim()), ""]; // 채운 칸 + 빈 칸 하나
    const set = (i, v) => setActs((m) => { const cur = [...rows]; cur[i] = v; return { ...m, [k]: cur }; });
    return (
      <div className="mt-2">
        <small className="text-[12px] font-bold text-gray-500">{label}</small>
        {rows.map((v, i) => (
          <input key={i} value={v} onChange={(e) => set(i, e.target.value)} placeholder={i ? "하나 더 있으면" : ph}
            className="mt-1 h-11 w-full border border-gray-300 px-3 text-[14px] outline-none focus:border-gray-900" />
        ))}
      </div>
    );
  };
  return (
    <Sheet onClose={onSkip} title={`${g} 때 한 활동`} sub="과목마다 생기부에 들어간 수행평가 · 탐구를 적어요. 여러 개면 칸이 계속 생겨요. 기억 안 나면 비워 두고 다음을 눌러요." foot={foot}>
      <div className="space-y-5">
        {(subs[g] ?? (g === "고1" ? COMMON_G1 : [])).map((n) => (
          <div key={n} className="border-b border-gray-100 pb-4">
            <p className="text-[15px] font-extrabold text-gray-900">{n}</p>
            {Field({ subj: n, type: "suhaeng", label: "수행평가", ph: `${n} 수행평가 제목` })}
            {Field({ subj: n, type: "tamgu", label: "탐구", ph: `${n} 탐구 주제` })}
          </div>
        ))}
      </div>
    </Sheet>
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

export default function MyHome({ simple = false }) { // simple: 첫 화면 (로드맵만) · /my/home 은 이번 달 할 일 · 최근 기록까지
  const { user, loading } = useAuth();
  const [feed, setFeed] = useState(null); // { items, open_all, free_days }
  const [plan, setPlan] = useState(null); // 이번 달 할 일 (물꼬 서버 month_plan)
  const [filter, setFilter] = useState("all");
  const [record, setRecord] = useState(null); // 내 생기부 (sql/sm_120 home_record)
  const [my, setMy] = useState({}); // { grade, department }
  const [more, setMore] = useState(false); // 최근 기록 더 보기
  const nav = useNavigate();
  const [gate, setGate] = useState(false); // 로그인 안 한 사람이 버튼을 누르면
  const [mine, setMine] = useState({}); // 내가 고른 과목 { 고1: [...], 고2: [...] } (sql/sm_122 my_subjects)
  const [doneMap, setDoneMap] = useState({}); // 학생이 직접 '완료'로 누른 과목 { 고1: [...] } (sql/sm_124 my_subjects.done) — 탐구를 안 하는 과목도 끝낼 수 있게
  const [picker, setPicker] = useState(""); // '+ 과목' 창을 연 학년
  const [mineOk, setMineOk] = useState(false); // 내 과목을 다 읽었는지 (처음 설정 창을 띄울지 정할 때)
  const [setup, setSetup] = useState(false); // 처음 설정 (학년 → 학년별 과목 → 지난 학년 활동)
  const [gradeSet, setGradeSet] = useState(""); // 처음 설정에서 고른 학년 (바로 반영)
  const [opening, setOpening] = useState("");
  const [diagInfo, setDiagInfo] = useState(false); // 진단 잠김 창
  const [tabReq, setTabReq] = useState(null); // 로드맵 학년 탭 바꾸기 요청 { g: "고1" } // 물꼬가 먼저 거는 말 — 우리 학교 이번 달 수행평가 · 할 일 (물꼬 채팅과 같은 팝업 · 3시간에 한 번)
  const ask = (q) => (user ? nav(`/agent?q=${encodeURIComponent(q)}`) : setGate(true));
  // 과목 칸 '수행평가 · 탐구' — 그 과제만 하는 물꼬 화면 (Agent.jsx ?do=)
  // 하는 중인 과제 — 그 과제를 물꼬에서 다시 꺼낸다 (서버 router SH_CONT → 지금 단계 카드)
  const resume = (r) => {
    track("road_resume");
    nav(`/agent?go=${encodeURIComponent(`${r.subject || "진로"} ${r.source === "tamgu" ? "탐구" : "수행평가"} '${r.title}' 이어서 하자`)}`);
  };
  const go = (kind, subj) => {
    if (!user) return setGate(true);
    track(`road_${kind}`);
    nav(`/agent?do=${kind}&subj=${encodeURIComponent(subj)}`);
  };

  // 첫 화면에서도 물꼬 팝업 — 처음 설정이 끝난 뒤 · 닫으면 3시간 동안은 다시 안 뜸 (물꼬 채팅과 같은 시계)
  useEffect(() => {
    if (!user || !mineOk || setup || opening) return;
    let seen = false;
    try { seen = Date.now() - Number(localStorage.getItem(`sm_opening_${user.id}`) || 0) < OPENING_GAP; } catch { /* 띄운다 */ }
    if (seen) return;
    supabase.functions.invoke("agent", { body: { action: "opening" } }).then(({ data }) => {
      if (data?.text) { setOpening(data.text); track("opening_view_road"); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, mineOk, setup]);
  function closeOpening(pick) {
    setOpening("");
    try { localStorage.setItem(`sm_opening_${user.id}`, String(Date.now())); } catch { /* 넘어간다 */ }
    if (pick) { track("opening_pick_road"); nav(`/agent?go=${encodeURIComponent(pick)}`); }
  }
  const loadRecord = () => supabase.rpc("home_record").then(({ data, error }) => setRecord((r) => (error ? r ?? [] : data ?? [])));
  const load = () =>
    supabase.rpc("home_feed").then(({ data, error }) => setFeed(error ? { items: [], open_all: false, error: true } : data));
  useEffect(() => {
    if (!user) return;
    track("myhome_view");
    // 완료 표시는 따로 읽는다 (sm_124 를 아직 안 넣었으면 그냥 비워 둔다 — 과목 목록은 그대로)
    supabase.from("my_subjects").select("grade,done").then(({ data, error }) => { if (!error) setDoneMap(Object.fromEntries((data ?? []).map((r) => [r.grade, r.done ?? []]))); });
    supabase.from("my_subjects").select("grade,subjects").then(({ data, error }) => {
      const m = Object.fromEntries((data ?? []).map((r) => [r.grade, r.subjects ?? []]));
      setMine(m);
      setMineOk(true);
      // 과목을 한 번도 안 골랐으면 처음 설정 (닫으면 하루 동안 다시 안 띄움)
      let skipped = false;
      try { skipped = Date.now() - Number(localStorage.getItem(`sm_road_setup_${user.id}`) || 0) < 86400000; } catch { /* 띄운다 */ }
      if (!error && !Object.keys(m).length && !skipped) setSetup(true);
    });
    loadRecord();
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

  // 과목 '완료' 표시 · 풀기 — 화면 먼저 바꾸고 저장 (실패하면 되돌림)
  async function toggleDone(g, name, names) {
    const cur = doneMap[g] ?? [];
    const on = !cur.some((x) => skey(x) === skey(name));
    const next = on ? [...cur, name] : cur.filter((x) => skey(x) !== skey(name));
    setDoneMap((m) => ({ ...m, [g]: next }));
    const row = { grade: g, done: next, updated_at: new Date().toISOString() };
    if (!mine[g]) row.subjects = names; // 과목을 한 번도 안 고른 학년이면 지금 보이는 과목으로 같이 저장 (빈 목록으로 덮지 않게)
    const { error } = await supabase.from("my_subjects").upsert(row, { onConflict: "user_id,grade" });
    if (error) { setDoneMap((m) => ({ ...m, [g]: cur })); alert("저장하지 못했어요. 잠시 뒤 다시 해 주세요."); }
    else { if (row.subjects) setMine((m) => ({ ...m, [g]: names })); track(on ? "subject_done" : "subject_undone"); }
  }

  async function saveSubjects(g, list) {
    const { error } = await supabase.from("my_subjects").upsert({ grade: g, subjects: list, updated_at: new Date().toISOString() }, { onConflict: "user_id,grade" });
    if (!error) { setMine((m) => ({ ...m, [g]: list })); setPicker(""); track("my_subjects_save"); }
    else alert("저장하지 못했어요. 잠시 뒤 다시 해 주세요.");
  }

  if (loading) return null;
  const grade = gradeSet || my.grade || plan?.grade;
  const school = plan?.school_name || plan?.school;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-4 py-7 sm:py-10">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[22px] font-black tracking-tight text-gray-900">내 입시 로드맵</h1>
            <p className="mt-0.5 truncate text-[13px] text-gray-500">
              {user ? [school, grade, my.department && `희망 ${my.department}`].filter(Boolean).join(" · ") || "학교 · 학년을 알려 주면 그 기준으로 맞춰 줘요" : "과목을 누르면 물꼬가 수행평가 · 탐구를 같이 끝내 줘요"}
            </p>
          </div>
        </div>


        {/* AI 입시 방향 진단 — 고1 칸(세특 10과목 + 자율 · 동아리 · 진로) 10칸이 차면 열린다 (진단 화면 /roadmap/diagnosis)
            · 잠겨 있어도 누르면 창: 진단으로 무엇을 받는지 + 채운 칸 · 남은 칸 + '고1 칸 채우러 가기' */}
        {user && record && (() => {
          const g1 = record.filter((r) => r.grade === "고1");
          const subs = [...new Map(g1.filter((r) => r.kind === "subject" && r.subject).map((r) => [skey(r.subject), r.subject])).values()];
          const areas = [["autonomy", "자율"], ["club", "동아리"], ["career", "진로"]].map(([k, l]) => ({ l, ok: g1.some((r) => r.kind === k) }));
          const filled = Math.min(subs.length, 10) + areas.filter((a) => a.ok).length;
          const open = filled >= UNLOCK_AT;
          return (
            <>
              <button onClick={() => (open ? nav("/roadmap/diagnosis") : setDiagInfo(true))}
                className={`mt-4 flex w-full items-center justify-between gap-3 border px-4 py-3 text-left ${open ? "border-gray-900 bg-white hover:bg-[#FAFAFA]" : "border-gray-200 bg-white hover:border-gray-400"}`}>
                <span className="min-w-0">
                  <b className="block text-[14px] font-extrabold text-gray-900">AI 입시 방향 진단</b>
                  <small className="text-[12.5px] text-gray-500">{open ? "가고 싶은 학과와 내 생기부가 얼마나 이어지는지 · 비어 있는 역량 · 다음 학년 과목" : `고1 과목 · 창체 ${filled}/${UNLOCK_AT}칸 · 눌러서 남은 칸 보기`}</small>
                </span>
                <span className={`flex-none text-[13px] font-extrabold ${open ? "text-gray-900" : "text-gray-500"}`}>{open ? "진단 받기 ›" : `${UNLOCK_AT - filled}칸 남음 ›`}</span>
              </button>
              {diagInfo && (
                <Sheet onClose={() => setDiagInfo(false)} title="AI 입시 방향 진단" sub={`고1 칸을 ${UNLOCK_AT}칸 채우면 열려요. 지금 ${filled}칸 · ${UNLOCK_AT - filled}칸 남았어요.`}
                  foot={<button onClick={() => { setDiagInfo(false); setTabReq({ g: "고1", n: Date.now() }); }} className="h-12 w-full bg-gray-900 text-[15px] font-extrabold text-white">고1 칸 채우러 가기</button>}>
                  {/* ① 진단 흐름 — 지금 어느 단계인지 */}
                  <p className="text-[12.5px] font-bold text-gray-400">진단은 이렇게 진행돼요</p>
                  <ol className="mt-2 border-l border-gray-200">
                    {[
                      { t: "고1 생기부 칸 채우기", d: `과목 세특 10칸 + 자율 · 동아리 · 진로 3칸 중 ${UNLOCK_AT}칸 · 지금 ${filled}칸`, now: true },
                      { t: "희망 학과 고르기", d: my.department ? `1~3지망까지 · 지금 희망 ${my.department}` : "1~3지망까지 · 못 정했으면 내 활동에 맞는 학과 TOP 3를 골라 줘요" },
                      { t: "AI 컨설팅 — 생기부 · 학과 · 과목 진단", d: "학과 적합도 · 생기부 강점과 빈 곳 · 대학 권장과목과 내 과목 비교 · 학과가 보는 역량" },
                      { t: "앞으로 채우는 순서 받기", d: "학기마다 어느 과목 · 창체에서 무엇을 할지 · 다음 학년 선택과목 · 이어 갈 탐구는 눌러서 물꼬와 바로 시작" },
                    ].map((x, i) => (
                      <li key={i} className="relative pb-4 pl-5 last:pb-0">
                        <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 ${x.now ? "bg-gray-900" : "border border-gray-300 bg-white"}`} />
                        <b className={`block text-[14px] ${x.now ? "font-extrabold text-gray-900" : "font-bold text-gray-500"}`}>{i + 1}. {x.t}{x.now && <span className="ml-1.5 bg-gray-900 px-1.5 py-0.5 text-[11px] text-white">지금</span>}</b>
                        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-gray-500">{x.d}</span>
                      </li>
                    ))}
                  </ol>

                  {/* ② 지금 내 고1 생기부 — 과목마다 들어간 활동 · 빈 과목 */}
                  {(() => {
                    const base = (mine["고1"]?.length ? mine["고1"] : COMMON_G1);
                    const names = [...subs, ...base.filter((x) => !subs.some((y) => skey(y) === skey(x)))];
                    const typ = (r) => (/suhaeng/.test(r.source || "") ? "수행평가" : /tamgu|inquiry/.test(r.source || "") ? "탐구" : "활동");
                    const Row = ({ name, list, unit, hint = "그때 한 수행평가 · 탐구 적기" }) => (
                      <button onClick={() => { setDiagInfo(false); setTabReq({ g: "고1", n: Date.now() }); }} className="flex w-full items-start gap-3 border-b border-gray-100 py-2.5 text-left last:border-0 hover:bg-[#FAFAFA]">
                        <span className={`mt-0.5 w-7 flex-none text-center text-[11px] font-extrabold ${list.length ? "bg-gray-900 py-0.5 text-white" : "border border-gray-300 py-0.5 text-gray-400"}`}>{list.length ? unit : "빈칸"}</span>
                        <span className="min-w-0 flex-1">
                          <b className="block text-[13.5px] font-bold text-gray-900">{name}</b>
                          {list.length ? list.slice(0, 3).map((r, i) => (
                            <span key={i} className="mt-0.5 block truncate text-[12.5px] text-gray-600"><span className="text-gray-400">{typ(r)} · </span>{String(r.title || "").replace(/^진행 중 — /, "")}{/^진행 중/.test(r.content || r.title || "") ? " (하는 중)" : ""}</span>
                          )).concat(list.length > 3 ? [<span key="m" className="mt-0.5 block text-[12px] text-gray-400">외 {list.length - 3}개</span>] : [])
                            : <span className="mt-0.5 block text-[12.5px] text-gray-400">아직 없어요 · 눌러서 {hint}</span>}
                        </span>
                      </button>
                    );
                    return (
                      <>
                        <p className="mt-6 text-[12.5px] font-bold text-gray-400">지금 내 고1 생기부 · 과목 세특 {Math.min(subs.length, 10)}/10칸</p>
                        <div className="mt-1">
                          {names.map((n) => <Row key={n} name={n} unit="1칸" list={g1.filter((r) => r.kind === "subject" && skey(r.subject) === skey(n))} />)}
                        </div>
                        <p className="mt-5 text-[12.5px] font-bold text-gray-400">고1 창의적 체험활동 · {areas.filter((x) => x.ok).length}/3칸</p>
                        <div className="mt-1">
                          {[["autonomy", "자율 · 자치활동"], ["club", "동아리활동"], ["career", "진로활동"]].map(([k, l]) => <Row key={k} name={l} unit="1칸" hint="그때 한 활동 한 줄 적기" list={g1.filter((r) => r.kind === k)} />)}
                        </div>
                      </>
                    );
                  })()}

                  {/* ③ 칸 세는 법 */}
                  <div className="mt-6 bg-[#F7F7F8] p-4 text-[12.5px] leading-relaxed text-gray-600">
                    <b className="block text-[13px] text-gray-900">칸은 이렇게 세요</b>
                    <span className="mt-1 block">· 과목 하나에 수행평가나 탐구가 한 줄이라도 있으면 1칸 (10과목까지)</span>
                    <span className="block">· 자율 · 동아리 · 진로는 각각 1칸</span>
                    <span className="block">· 13칸 중 {UNLOCK_AT}칸이면 열려요 — 지금 {UNLOCK_AT - filled}칸만 더 채우면 돼요</span>
                    <span className="mt-1 block">· 물꼬에서 '이 주제로 할게'를 누른 과제는 자동으로 들어와요</span>
                  </div>
                </Sheet>
              )}
            </>
          );
        })()}

        <div className="mt-4">
          {user && record === null ? <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중…</p>
            : <RoadList rows={record ?? []} grade={grade} mine={mine} plan={plan} user={user} onGo={go} onAsk={ask} onAdd={(g) => (user ? setPicker(g) : setGate(true))} onReload={loadRecord} onResume={resume} tabReq={tabReq} doneMap={doneMap} onToggleDone={toggleDone} />}
        </div>
        {opening && !setup && <OpeningPopup text={opening} onClose={closeOpening} plan={plan} onCheck={toggleCheck} />}
        {setup && mineOk && (
          <RoadSetup grade0={grade} dept={my.department}
            onSkip={() => { setSetup(false); try { localStorage.setItem(`sm_road_setup_${user.id}`, String(Date.now())); } catch { /* 넘어간다 */ } }}
            onDone={(g, all) => { setSetup(false); setGradeSet(g); setMine((m) => ({ ...m, ...all })); setMy((x) => ({ ...x, grade: g })); loadRecord(); }} />
        )}
        {user && mineOk && !setup && !Object.keys(mine).length && (
          <button onClick={() => setSetup(true)} className="mt-3 h-11 w-full border border-gray-900 text-[14px] font-extrabold text-gray-900">학년 · 과목 · 지난 학년 활동 넣고 로드맵 만들기 ›</button>
        )}
        {picker && <SubjectPicker grade={picker} dept={my.department} have={mine[picker] ?? (picker === "고1" && !(record ?? []).some((r) => r.grade === "고1" && r.kind === "subject") ? COMMON_G1 : (record ?? []).filter((r) => r.kind === "subject" && r.grade === picker).map((r) => r.subject))} onClose={() => setPicker("")} onSave={(list) => saveSubjects(picker, list)} />}
        <LoginPopup open={gate} onClose={() => setGate(false)} title="로그인하고 시작해요" desc="수행평가 · 탐구를 물꼬랑 끝내면 내 생기부에 자동으로 쌓여요. 무료예요." />
        <div className="h-20" />{/* 오른쪽 아래 '+ 과목' 버튼에 마지막 줄이 가리지 않게 */}

      </div>
    </div>
  );
}