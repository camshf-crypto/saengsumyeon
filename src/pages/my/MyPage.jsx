import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { printPdf } from "../interview/Interview";

/*
 * 마이페이지 — /my
 * 흔한가 시리즈 진단 기록을 탭으로 모아 본다: 탐구주제 · 독서 · 지원동기 · 면접 예상질문
 * 주소 끝에 ?tab=reading 처럼 붙이면 그 탭으로 열린다
 * (독서·지원동기·면접 기록은 각 표에 '본인 기록만 보기' 권한이 걸려 있어 바로 읽는다)
 */

const TABS = [
  { k: "topic", label: "탐구주제", color: "#EA580C", go: "/topic" },
  { k: "reading", label: "독서", color: "#2F56D6", go: "/reading" },
  { k: "motive", label: "지원동기", color: "#0B8A5E", go: "/motive" },
  { k: "interview", label: "면접 예상질문", color: "#18224F", go: "/interview" },
];
const WEEK_MS = 7 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// 탐구주제 흔함 판정 (탐구주제 진단과 같은 기준)
function topicVerdict(score) {
  if (score == null) return "";
  if (score >= 85) return "아주 흔해요";
  if (score >= 65) return "흔한 편이에요";
  if (score >= 45) return "조금 흔해요";
  if (score >= 25) return "괜찮은 편이에요";
  return "드문 편이에요";
}
// 독서·지원동기 흔함 판정 (서버의 verdict_level과 같은 기준)
function verdict(score, rare = "드문 편이에요") {
  if (score == null) return "";
  if (score >= 85) return "아주 흔해요";
  if (score >= 65) return "흔한 편이에요";
  if (score >= 40) return "조금 흔해요";
  if (score >= 15) return "괜찮은 편이에요";
  return rare;
}
const day = (d) => new Date(d).toLocaleDateString("ko-KR");

/* 기록 한 줄 — 누르면 펼친다 */
function Row({ open, onToggle, meta, title, score, sub, color, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-5 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold" style={{ color }}>{meta}</p>
          <p className="mt-1.5 text-[15px] font-bold leading-relaxed text-sm-navy">{title}</p>
          <p className="mt-1.5 text-[11.5px] text-gray-400">{sub}</p>
        </div>
        {score != null && (
          <div className="shrink-0 text-right">
            <p className="text-xl font-black leading-none" style={{ color }}>{score.value ?? "-"}</p>
            <p className="mt-1 text-[11px] text-gray-400">{score.label}</p>
          </div>
        )}
      </button>
      {open && <div className="border-t border-gray-100 bg-gray-50 p-5">{children}</div>}
    </div>
  );
}

/* 남은 횟수 + 새로 진단하기 */
function Quota({ label, left, total, unit, go, color }) {
  const nav = useNavigate();
  return (
    <div className="mt-5 flex items-center justify-between rounded-xl border border-gray-200 p-5">
      <div>
        <p className="text-[12.5px] text-gray-500">{label}</p>
        {left != null && (
          <p className="mt-1 text-lg font-extrabold text-sm-navy">
            {left}
            {unit} <span className="text-[13px] font-semibold text-gray-400">/ {total}{unit}</span>
          </p>
        )}
      </div>
      <button onClick={() => nav(go)} className="rounded-lg px-4 py-2.5 text-[14px] font-bold text-white" style={{ background: color }}>
        새로 진단하기
      </button>
    </div>
  );
}

function Empty({ text, go, color }) {
  const nav = useNavigate();
  return (
    <div className="rounded-xl border border-gray-200 py-16 text-center">
      <p className="text-sm text-gray-500">{text}</p>
      <button onClick={() => nav(go)} className="mt-5 rounded-lg px-5 py-2.5 text-[14px] font-bold text-white" style={{ background: color }}>
        첫 진단 시작하기
      </button>
    </div>
  );
}

export default function MyPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.k === params.get("tab")) ? params.get("tab") : "topic";
  const T = TABS.find((t) => t.k === tab);

  const [data, setData] = useState({}); // 탭별 기록 { topic: [], reading: [], ... }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);

  // 탭을 처음 열 때 그 탭 기록만 불러온다
  useEffect(() => {
    if (authLoading || !user || data[tab]) return;
    let alive = true;
    setBusy(true);
    setErr("");
    const load =
      tab === "topic"
        ? supabase.rpc("my_topic_queries")
        : tab === "reading"
        ? supabase.from("reading_queries").select("id, title, author, department, grade, subject, result, used_bonus, created_at").order("created_at", { ascending: false }).limit(100)
        : tab === "motive"
        ? supabase.from("motive_queries").select("id, university, department, use_for, motive, result, used_bonus, created_at").order("created_at", { ascending: false }).limit(100)
        : supabase.from("interview_queries").select("id, targets, university, department, result, created_at").order("created_at", { ascending: false }).limit(50);
    load.then(({ data: rows, error }) => {
      if (!alive) return;
      setBusy(false);
      if (error) {
        console.error("my records failed", tab, error);
        return setErr("기록을 불러오지 못했어요.");
      }
      setData((d) => ({ ...d, [tab]: rows ?? [] }));
    });
    return () => {
      alive = false;
    };
  }, [authLoading, user, tab, data]);

  const rows = data[tab] ?? [];

  // 남은 횟수 — 탐구주제: 최근 24시간 3번 / 독서·지원동기: 최근 7일 무료 2번 (친구 초대로 받은 것은 빼고 센다)
  const quota = useMemo(() => {
    if (tab === "topic") {
      const used = rows.filter((r) => Date.now() - new Date(r.created_at).getTime() < DAY_MS).length;
      return { label: "오늘 남은 진단", left: Math.max(0, 3 - used), total: 3, unit: "번" };
    }
    if (tab === "reading" || tab === "motive") {
      const used = rows.filter((r) => !r.used_bonus && Date.now() - new Date(r.created_at).getTime() < WEEK_MS).length;
      return { label: "이번 주 남은 무료 진단", left: Math.max(0, 2 - used), total: 2, unit: tab === "reading" ? "권" : "번" };
    }
    return { label: "내 생기부로 지원 대학 면접 예상 질문 뽑기", left: null };
  }, [tab, rows]);

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-lg font-bold text-sm-navy">로그인이 필요합니다</p>
        <Link to="/login" className="mt-6 inline-block rounded-lg bg-sm-navy px-6 py-3 text-sm font-bold text-white">
          로그인하기
        </Link>
      </div>
    );
  }

  const toggle = (id) => setOpenId(openId === id ? null : id);

  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-sm font-bold text-sm-orange">마이페이지</p>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">{profile?.name ?? "회원"}님의 진단 기록</h1>

      {/* 탭 */}
      <div className="mt-6 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => {
              setOpenId(null);
              setParams(t.k === "topic" ? {} : { tab: t.k }, { replace: true });
            }}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2.5 text-[13.5px] font-bold ${tab === t.k ? "bg-white shadow-sm" : "text-gray-500"}`}
            style={tab === t.k ? { color: t.color } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Quota {...quota} go={T.go} color={T.color} />

      {err && <p className="mt-5 text-sm font-semibold text-red-500">{err}</p>}

      <div className="mt-6 space-y-2.5">
        {busy && <p className="py-16 text-center text-sm text-gray-400">불러오는 중…</p>}
        {!busy && !rows.length && !err && (
          <Empty
            text={{ topic: "아직 진단한 탐구주제가 없어요.", reading: "아직 진단한 책이 없어요.", motive: "아직 진단한 지원동기가 없어요.", interview: "아직 뽑은 예상 질문이 없어요." }[tab]}
            go={T.go}
            color={T.color}
          />
        )}

        {/* 탐구주제 */}
        {!busy && tab === "topic" &&
          rows.map((r) => {
            const sug = r.result?.suggestion;
            return (
              <Row
                key={r.id}
                open={openId === r.id}
                onToggle={() => toggle(r.id)}
                meta={`${r.department} · ${r.grade}${r.term ? ` ${r.term}` : ""} · ${r.subject}`}
                title={r.topic}
                sub={day(r.created_at)}
                score={{ value: r.score, label: topicVerdict(r.score) }}
                color={T.color}
              >
                {r.result?.reason ? (
                  <>
                    <p className="text-[13px] font-bold text-sm-navy">왜 흔한 주제일까?</p>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{r.result.reason}</p>
                  </>
                ) : (
                  <p className="text-[13.5px] text-gray-400">이 진단에는 상세 내용이 저장되지 않았어요.</p>
                )}
                {sug && (
                  <div className="mt-5 rounded-xl border border-orange-200 bg-orange-50 p-4">
                    <p className="text-[11.5px] font-bold text-sm-orange">이렇게 바꿔보세요</p>
                    <p className="mt-2 text-[15px] font-bold leading-relaxed text-sm-navy">{sug.topic}</p>
                    {sug.how && <p className="mt-2 text-[13px] leading-relaxed text-gray-600">{sug.how}</p>}
                    <p className="mt-3 border-t border-orange-200 pt-3 text-[12.5px] text-gray-500">
                      흔함 지수 <b className="text-gray-400">{r.score}</b> → <b className="text-[16px] text-sm-orange">{sug.score}</b>
                    </p>
                  </div>
                )}
              </Row>
            );
          })}

        {/* 독서 */}
        {!busy && tab === "reading" &&
          rows.map((r) => {
            const x = r.result ?? {};
            return (
              <Row
                key={r.id}
                open={openId === r.id}
                onToggle={() => toggle(r.id)}
                meta={[r.department, r.grade, r.subject].filter(Boolean).join(" · ")}
                title={`${x.title || r.title}${x.author || r.author ? ` · ${x.author || r.author}` : ""}`}
                sub={`${day(r.created_at)}${x.level ? ` · ${x.level}` : ""}`}
                score={{ value: x.score, label: verdict(x.score) }}
                color={T.color}
              >
                {x.reason && (
                  <>
                    <p className="text-[13px] font-bold text-sm-navy">왜 흔한 독서일까?</p>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{x.reason}</p>
                  </>
                )}
                {x.angles?.length > 0 && (
                  <>
                    <p className="mt-5 text-[13px] font-bold text-sm-navy">같은 책, 이렇게 읽으면 달라져요</p>
                    <ul className="mt-2 space-y-2">
                      {x.angles.map((a, i) => (
                        <li key={i} className="rounded-lg bg-white p-3 ring-1 ring-gray-200">
                          <span className="text-[11px] font-bold text-orange-700">{a.tag}</span>
                          <p className="mt-0.5 text-[13.5px] font-bold text-sm-navy">{a.title}</p>
                          <p className="mt-0.5 text-[12.5px] leading-relaxed text-gray-600">{a.how}</p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {x.alternatives?.length > 0 && (
                  <>
                    <p className="mt-5 text-[13px] font-bold text-sm-navy">덜 흔한 책</p>
                    <ul className="mt-2 space-y-1.5">
                      {x.alternatives.map((b, i) => (
                        <li key={i} className="text-[13px] text-gray-700">
                          <b className="text-[#2F56D6]">{b.level}</b> · {b.title}
                          {b.author ? ` · ${b.author}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Row>
            );
          })}

        {/* 지원동기 */}
        {!busy && tab === "motive" &&
          rows.map((r) => {
            const x = r.result ?? {};
            return (
              <Row
                key={r.id}
                open={openId === r.id}
                onToggle={() => toggle(r.id)}
                meta={[r.university, r.department, r.use_for === "document" ? "자소서·서류" : "면접 답변"].filter(Boolean).join(" · ")}
                title={String(r.motive ?? "").slice(0, 60) + (String(r.motive ?? "").length > 60 ? "…" : "")}
                sub={day(r.created_at)}
                score={{ value: x.score, label: verdict(x.score, "나만의 지원동기예요") }}
                color={T.color}
              >
                <p className="text-[13px] font-bold text-sm-navy">내 지원동기</p>
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-gray-600">{r.motive}</p>
                {x.univ && (
                  <div className="mt-5 rounded-xl bg-white p-4 ring-1 ring-emerald-200">
                    <p className="text-[13px] font-bold text-sm-navy">{x.univ.name} 기준</p>
                    <ul className="mt-2 space-y-1.5">
                      {x.univ.factors?.map((f) => (
                        <li key={f.factor} className="text-[12.5px] text-gray-700">
                          <b>{f.factor}</b> (비중 {f.weight}%) · {f.seen >= 70 ? "잘 보여요" : f.seen >= 40 ? "조금 보여요" : "부족해요"}
                          {f.tip && <span className="block text-gray-500">{f.tip}</span>}
                        </li>
                      ))}
                    </ul>
                    {x.univ.question && (
                      <p className="mt-3 rounded-lg bg-[#18224F] p-3 text-[13px] font-bold text-white">
                        면접관의 첫 질문 · “{x.univ.question}”
                      </p>
                    )}
                  </div>
                )}
              </Row>
            );
          })}

        {/* 면접 예상질문 */}
        {!busy && tab === "interview" &&
          rows.map((r) => {
            const list = (r.result?.results ?? []).filter((x) => !x.error);
            const names = (r.targets ?? [{ university: r.university, department: r.department }]).map((t) => t.university).join(" · ");
            const total = list.reduce((a, x) => a + (x.total ?? 0), 0);
            return (
              <Row
                key={r.id}
                open={openId === r.id}
                onToggle={() => toggle(r.id)}
                meta={`${list.length}개 대학 · 예상 질문 ${total}개`}
                title={names}
                sub={day(r.created_at)}
                score={null}
                color={T.color}
              >
                <button onClick={() => printPdf(list)} disabled={!list.length} className="h-11 w-full rounded-lg bg-sm-navy text-[14px] font-extrabold text-white disabled:opacity-40">
                  PDF로 다시 받기
                </button>
                {list.map((x) => {
                  let n = 0;
                  return (
                    <div key={x.university} className="mt-5">
                      <p className="text-[14px] font-extrabold text-sm-navy">
                        {x.university} {x.department}
                      </p>
                      {x.groups?.map((g) => (
                        <div key={g.title} className="mt-2">
                          <p className="text-[12.5px] font-bold text-gray-500">{g.title}</p>
                          <ol className="mt-1 space-y-1">
                            {g.questions.map((q) => (
                              <li key={q} className="flex gap-2 text-[13px] leading-relaxed text-gray-700">
                                <span className="w-5 shrink-0 font-bold text-sm-orange">{++n}</span>
                                {q}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Row>
            );
          })}
      </div>
    </div>
  );
}