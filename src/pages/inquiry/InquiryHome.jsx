import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

/*
 * 기억에 남는 탐구보고서 — /inquiry (헤더 메뉴로 들어오는 첫 화면)
 *  - 내가 진단한 주제를 전부 보여준다 (진단 기록 my_topic_queries + 그 주제로 만든 탐구 inquiries)
 *    · 탐구를 아직 안 만든 주제 → 누르면 그 주제로 탐구 시작 (/inquiry/new)
 *    · 탐구가 있는 주제 → 누르면 그 탐구의 2 탐구 준비
 *  - 진단한 주제가 없으면(처음 온 사람·로그인 전): 맨 위에 '상위 1% 탐구주제 선정하기'로 가라는 안내 + 4단계 안내
 */

const STAGE = {
  prepare: "2 탐구 준비",
  doing: "2 탐구 준비",
  analyze: "3 결과 분석",
  design: "4 보고서 디자인",
};

const STEPS = [
  ["1", "주제 진단", "내 주제가 얼마나 흔한지 보고, 상위 1% 주제로 다듬어요"],
  ["2", "탐구 준비", "AI가 탐구 방법과 탐구팩을 만들고, 쓸 자료를 함께 찾아요"],
  ["3", "결과 분석", "모은 결과를 비교표로 정리하고, 내 생각 한 줄을 써요"],
  ["4", "보고서 디자인", "선생님이 몇 달 뒤에도 떠올릴 디자인으로 PDF를 만들어요"],
];

export default function InquiryHome() {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState(null); // null = 불러오는 중

  // 진단 기록 + 탐구를 합쳐서 한 줄씩 (최신순)
  useEffect(() => {
    if (authLoading || !user) return;
    Promise.all([
      supabase.rpc("my_topic_queries"),
      supabase
        .from("inquiries")
        .select("id, query_id, suggestion, stage, method, department, grade, subject, created_at")
        .eq("user_id", user.id),
    ]).then(([q, i]) => {
      if (q.error) console.warn("my queries failed", q.error);
      if (i.error) console.warn("inquiry list failed", i.error);
      const queries = (q.data ?? []).filter((r) => r.result?.suggestion?.topic); // 진단이 끝난 것만
      const inqs = i.data ?? [];
      const byQuery = Object.fromEntries(inqs.map((x) => [x.query_id, x]));

      const rows = queries.map((r) => ({
        key: `q-${r.id}`,
        query: r,
        inquiry: byQuery[r.id] ?? null,
        topic: r.topic,
        suggestion: r.result.suggestion.topic,
        meta: [r.department, r.grade, r.subject].filter(Boolean).join(" · "),
        at: r.created_at,
      }));
      // 다른 학생 진단 결과를 이어받아 만든 탐구처럼, 내 진단 기록에 없는 탐구도 빠짐없이
      const known = new Set(queries.map((r) => r.id));
      inqs
        .filter((x) => !known.has(x.query_id))
        .forEach((x) =>
          rows.push({
            key: `i-${x.id}`,
            query: null,
            inquiry: x,
            topic: "",
            suggestion: x.suggestion,
            meta: [x.department, x.grade, x.subject].filter(Boolean).join(" · "),
            at: x.created_at,
          })
        );
      rows.sort((a, b) => new Date(b.at) - new Date(a.at));
      setItems(rows);
    });
  }, [authLoading, user]);

  // 누르기 — 탐구가 있으면 2 탐구 준비로, 없으면 그 주제로 새 탐구 시작
  function open(row) {
    if (row.inquiry) return nav(`/inquiry/${row.inquiry.id}`);
    const r = row.query;
    nav("/inquiry/new", {
      state: {
        query_id: r.id,
        topic: r.topic,
        focus: r.focus,
        department: r.department,
        subject: r.subject,
        grade: r.grade,
        term: r.term,
      },
    });
  }

  if (authLoading) return <p className="py-40 text-center text-gray-400">불러오는 중…</p>;

  const has = items?.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <p className="text-[13px] font-bold text-sm-orange">생수면 탐구보고서</p>
      <h1 className="mt-1 text-[26px] font-black leading-tight text-sm-navy sm:text-[32px]">기억에 남는 탐구보고서</h1>
      <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">
        흔한 주제로 흔한 보고서를 쓰면 선생님 기억에 남지 않아요. 주제 진단부터 PDF까지, 네 단계로 함께 만들어요.
      </p>

      {/* 처음 온 사람 — 아직 진단한 탐구 주제가 없으면 '상위 1% 탐구주제 선정하기'부터 */}
      {(!user || items?.length === 0) && (
        <div className="mt-8 rounded-2xl border-2 border-sm-navy bg-indigo-50/60 p-6 sm:p-7">
          <p className="text-[13px] font-bold text-sm-orange">처음 오셨나요?</p>
          <p className="mt-1 text-[20px] font-extrabold leading-snug text-sm-navy">아직 탐구 주제가 없어요</p>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            탐구보고서는 <b className="text-sm-navy">상위 1% 탐구주제 선정</b>부터 시작해요.
            <br className="hidden sm:block" />
            생각해 둔 주제가 얼마나 흔한지 진단하고, 선생님 기억에 남을 주제로 다듬어 드려요.
          </p>
          <button onClick={() => nav("/")} className="mt-5 h-[52px] w-full rounded-xl bg-sm-navy text-[16px] font-extrabold text-white sm:w-auto sm:px-8">
            상위 1% 탐구주제 선정하기 →
          </button>
          {!user && (
            <p className="mt-3 text-[12.5px] text-gray-500">
              이미 주제를 진단했다면{" "}
              <Link to="/login" className="font-bold text-sm-navy underline">
                로그인
              </Link>
              하고 이어서 해요.
            </p>
          )}
        </div>
      )}

      {/* 내가 진단한 주제 전부 */}
      {user && items === null && <p className="py-16 text-center text-gray-400">내 탐구 주제를 불러오는 중…</p>}
      {user && has && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-extrabold text-sm-navy">내 탐구 주제</h2>
            <span className="text-[13px] font-bold text-gray-400">{items.length}개</span>
            <button onClick={() => nav("/")} className="ml-auto rounded-lg border border-sm-navy px-3 py-1.5 text-[13px] font-bold text-sm-navy hover:bg-indigo-50">
              + 새 주제 진단하기
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-gray-500">주제를 누르면 그 주제로 탐구를 시작하거나, 하던 탐구를 이어서 해요.</p>

          <div className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {items.map((row) => {
              const x = row.inquiry;
              const waiting = x && !x.method; // 결제 대기 (주제만 저장, 탐구팩 아직 없음)
              const badge = !x
                ? { text: "탐구 시작 전", cls: "border border-gray-300 text-gray-500" }
                : waiting
                ? { text: "결제 대기", cls: "bg-orange-50 text-sm-orange" }
                : { text: STAGE[x.stage] ?? STAGE.prepare, cls: "bg-indigo-50 text-sm-navy" };
              return (
                <button
                  key={row.key}
                  onClick={() => open(row)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className={`rounded-full px-2.5 py-0.5 font-bold ${badge.cls}`}>{badge.text}</span>
                      <span className="text-gray-400">{new Date(row.at).toLocaleDateString("ko-KR")}</span>
                      {row.meta && <span className="truncate text-gray-400">· {row.meta}</span>}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[15px] font-bold leading-snug text-sm-navy">{row.suggestion}</p>
                    {row.topic && row.topic !== row.suggestion && (
                      <p className="mt-0.5 truncate text-[12.5px] text-gray-400">처음 쓴 주제 · {row.topic}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-lg px-3 py-2 text-[13px] font-bold ${x ? "border border-gray-300 text-sm-navy" : "bg-sm-navy text-white"}`}>
                    {x ? "이어서 하기" : "탐구 시작하기"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 4단계 안내 — 진단한 주제가 없으면 이게 첫 화면 */}
      {(!user || items !== null) && (
        <section className="mt-12">
          <h2 className="text-[17px] font-extrabold text-sm-navy">{has ? "이렇게 만들어요" : "기억에 남는 탐구보고서, 이렇게 만들어요"}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {STEPS.map(([n, t, d]) => (
              <div key={n} className="rounded-2xl border border-gray-200 bg-white p-5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sm-navy text-[13px] font-extrabold text-white">{n}</span>
                <p className="mt-3 text-[15px] font-extrabold text-sm-navy">{t}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">{d}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}