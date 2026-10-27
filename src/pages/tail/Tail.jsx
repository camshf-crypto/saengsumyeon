import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { LoginPopup } from "../../components/LoginGate";
import PassSheet from "../../components/PassSheet";
import { hasPass } from "../../lib/pass";

/*
 * 🎤 면접 꼬리질문 — /tail
 *   ① 대학 · 학과 · 질문 종류 · 면접 질문 · 내 답변 → [꼬리질문 받기]
 *   ② 그 대학 면접관이 파고드는 방식대로 꼬리질문 1개 (면접관 의도 · 답변 방향)
 *   ③ 꼬리에 답하면 다음 꼬리 → 한 질문에 6개까지
 *   꼬리질문 1개 = 1개 · 처음 5개 무료 (회원) → 생수면 이용권(12,900원부터)이면 개수 제한 없음 (components/PassSheet)
 *   예전에 산 꼬리질문 개수(balance)는 그대로 쓴다
 *   생기부 질문 → '생기부 예상질문'에서 뽑은 질문을 가져온다 (안 했으면 하고 오라고 안내 → /interview)
 *   지원동기   → '지원동기 흔한가'에 쓴 지원동기를 내 답변으로 가져온다 (안 했으면 → /motive)
 *   /tail?from=interview · /tail?from=motive 로 들어오면 가져오기 창이 바로 열린다
 *   결제가 승인 · 반려되면 들어올 때 팝업으로 알린다
 * DB: sql/sm_60_tail.sql · sm_62_tail_notice.sql · sm_61_tail_data.sql · 서버 함수: supabase/functions/tail
 */

const NAVY = "#1E2A5A";
const PINK = "#FD1673";
const WIDTH = "mx-auto max-w-xl px-4 sm:px-5";
const MAIN_TYPES = ["생기부 질문", "지원동기", "자기소개", "공통·인성", "제시문"];
const MAIN_PH = {
  "생기부 질문": "예: 3학년 화학 세특에 촉매 탐구가 있는데, 어떤 실험을 했는지 설명해 주세요.",
  지원동기: "예: 우리 학과에 지원한 이유가 뭔가요?",
  자기소개: "예: 1분 동안 자기소개 해 주세요.",
  "공통·인성": "예: 갈등이 생겼을 때 어떻게 해결했나요?",
  제시문: "예: 제시문 (가)와 (나)의 관점 차이를 설명해 보세요.",
};
const DRAFT = "sm_tail_draft";
const errMsg = (e) => (e?.message || String(e || "")).replace(/^.*?exception:\s*/i, "") || "잠시 후 다시 해 주세요";
const won = (n) => `${Number(n || 0).toLocaleString()}원`;
const seen = (k) => { try { return localStorage.getItem("tail-seen-" + k) === "1"; } catch { return false; } };
const markSeen = (k) => { try { localStorage.setItem("tail-seen-" + k, "1"); } catch {} };
// 다른 서비스와 이어지는 질문 종류
const LINK = {
  "생기부 질문": { kind: "interview", name: "생기부 예상질문", obj: "생기부 예상질문을", to: "/interview", need: "내 생기부로 예상 질문을 먼저 뽑아 오면, 그 질문을 골라 바로 연습할 수 있어요." },
  지원동기: { kind: "motive", name: "지원동기 흔한가", obj: "지원동기 흔한가를", to: "/motive", need: "지원동기를 먼저 진단받아 오면, 내가 쓴 지원동기를 답변으로 가져와 바로 압박 질문을 받아요." },
};
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) || "null"); } catch { return null; } };
const saveDraft = (d) => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch {} };

function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-extrabold text-gray-900">{title}</p>
          <button onClick={onClose} className="text-[24px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Modal({ onClose, children }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-5" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/* 서버 함수 부르기 — 오류 내용까지 꺼낸다 */
async function callTail(body) {
  const { data, error } = await supabase.functions.invoke("tail", { body });
  if (error) {
    let j = null;
    try { j = await error.context?.json(); } catch {}
    return j ?? { error: "잠시 문제가 생겼어요. 다시 시도해 주세요" };
  }
  return data;
}

export default function Tail() {
  const { user, loading } = useAuth();
  const d0 = readDraft() ?? {};
  const [univs, setUnivs] = useState([]);
  const [me, setMe] = useState(null);
  const [univ, setUniv] = useState(d0.univ ?? "");
  const [dept, setDept] = useState(d0.dept ?? "");
  const [mainType, setMainType] = useState(d0.mainType ?? "생기부 질문");
  const [mainQ, setMainQ] = useState(d0.mainQ ?? "");
  const [answer, setAnswer] = useState(d0.answer ?? "");
  const [sess, setSess] = useState(null); // { id, univ, main_q, turns }
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pay, setPay] = useState(false);
  const [login, setLogin] = useState(false);
  const [focusU, setFocusU] = useState(false);
  const endRef = useRef(null);
  const nav = useNavigate();
  const loc = useLocation();
  const [need, setNeed] = useState(null);   // 아직 안 한 서비스 안내 팝업
  const [pick, setPick] = useState(null);   // 가져오기 창 { kind, rows }
  const [notice, setNotice] = useState(null); // 결제 승인 · 반려 알림

  /* 생기부 예상질문 · 지원동기에서 내가 한 것 불러오기 */
  const fetchMine = useCallback(async (kind) => {
    if (kind === "interview") {
      // 회원으로 한 기록만 (sm_63)
      const { data } = await supabase.rpc("tail_my_interviews");
      return (data ?? []).map((r) => {
        const res = r.result?.results?.[0] ?? r.result ?? {};
        const qs = (res.groups ?? []).flatMap((g) => (g.questions ?? []).map((q) => ({ q, group: g.title })));
        return { id: r.id, univ: res.university || r.university || "", dept: res.department || r.department || "", at: r.created_at, qs };
      }).filter((r) => r.qs.length);
    }
    const { data } = await supabase.rpc("tail_my_motives");
    return (data ?? []).filter((r) => (r.motive ?? "").trim());
  }, [user?.id]);

  const openLink = useCallback(async (type) => {
    const L = LINK[type];
    if (!L) return;
    if (!user) return setLogin(true);
    const rows = await fetchMine(L.kind);
    if (!rows.length) setNeed(type);
    else setPick({ kind: L.kind, rows });
  }, [user, fetchMine]);

  const chooseType = (t) => {
    setMainType(t);
    if (LINK[t]) openLink(t);
  };

  // 다른 서비스 결과 화면에서 넘어왔으면 가져오기 창을 바로 연다
  useEffect(() => {
    if (loading || !user) return;
    const sp = new URLSearchParams(loc.search);
    const sid = Number(sp.get("session"));
    if (sid) { // 마이페이지에서 '이어서 연습하기'
      supabase.rpc("tail_get", { p_id: sid }).then(({ data }) => { if (data) setSess({ ...data, max: 6 }); });
      nav("/tail", { replace: true });
      return;
    }
    // 면접 준비 화면(/prep)에서 넘어오면 대학·학과를 채운다 (/tail?univ=…&dept=…)
    const u = sp.get("univ"), dp = sp.get("dept");
    if (u) { setSess(null); setUniv(u.slice(0, 30)); }
    if (dp) setDept(dp.slice(0, 30));
    const from = sp.get("from");
    const t = from === "interview" ? "생기부 질문" : from === "motive" ? "지원동기" : null;
    if (t) { setMainType(t); openLink(t); }
    if (t || u) nav("/tail", { replace: true });
  }, [loading, user?.id, loc.search, openLink, nav]);

  // 결제 승인 · 반려 알림 (한 번만)
  useEffect(() => {
    const o = me?.last_order;
    if (!o?.id || seen(`order-${o.id}`)) return;
    markSeen(`order-${o.id}`);
    setNotice(o.status === "approved"
      ? { title: "결제가 완료됐어요", body: `꼬리질문 ${o.qty}개가 더해졌어요. 지금 바로 연습해 보세요.` }
      : { title: "입금이 확인되지 않았어요", body: "입금자명과 금액을 확인하고 다시 신청해 주세요. 궁금한 점은 문의해 주세요." });
  }, [me?.last_order?.id]);

  const [pass, setPass] = useState(false); // 이용권 — 개수 제한 없음
  const loadMe = useCallback(async () => {
    const [{ data }, p] = await Promise.all([supabase.rpc("tail_me"), hasPass()]);
    setMe(data);
    setPass(p);
  }, []);
  useEffect(() => {
    supabase.rpc("tail_univs").then(({ data }) => setUnivs(data ?? []));
  }, []);
  useEffect(() => { if (!loading) loadMe(); }, [loading, user?.id, loadMe]);
  useEffect(() => { saveDraft({ univ, dept, mainType, mainQ, answer }); }, [univ, dept, mainType, mainQ, answer]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [sess?.turns?.length, busy]);

  const left = pass ? Infinity : (me?.free_left ?? 0) + (me?.balance ?? 0);
  const hits = univ && focusU ? univs.filter((u) => u.replace(/\s/g, "").includes(univ.replace(/\s/g, ""))).slice(0, 6) : [];
  const known = univs.includes(univ);
  const startOk = univ.trim() && dept.trim() && mainQ.trim().length >= 5 && answer.trim().length >= 15;

  const handle = (r) => {
    if (r?.need_login) { setLogin(true); return false; }
    if (r?.need_pay) { setPay(true); loadMe(); return false; }
    if (r?.error) { setErr(r.error); return false; }
    return true;
  };

  const start = async () => {
    if (!user) return setLogin(true);
    if (me?.login && left <= 0) return setPay(true);
    setBusy(true); setErr("");
    const r = await callTail({ action: "start", univ: univ.trim(), department: dept.trim(), main_type: mainType, main_q: mainQ.trim(), answer: answer.trim() });
    setBusy(false);
    if (!handle(r)) return;
    setSess({ id: r.id, univ: univ.trim(), department: dept.trim(), main_type: mainType, main_q: mainQ.trim(), turns: r.turns, max: r.max });
    setMe((m) => ({ ...m, free_left: r.left.free, balance: r.left.paid }));
    if (r.pass) setPass(true);
  };

  const next = async () => {
    if (me?.login && left <= 0) return setPay(true);
    setBusy(true); setErr("");
    const r = await callTail({ action: "next", id: sess.id, answer: reply.trim() });
    setBusy(false);
    if (!handle(r)) return;
    setSess((s) => ({ ...s, turns: r.turns }));
    setReply("");
    setMe((m) => ({ ...m, free_left: r.left.free, balance: r.left.paid }));
    if (r.pass) setPass(true);
  };

  const openPast = async (id) => {
    const { data } = await supabase.rpc("tail_get", { p_id: id });
    if (data) { setSess({ ...data, max: 6 }); setReply(""); setErr(""); window.scrollTo(0, 0); }
  };

  const reset = () => { setSess(null); setReply(""); setErr(""); setAnswer(""); setMainQ(""); loadMe(); window.scrollTo(0, 0); };

  const tails = sess ? sess.turns.filter((t) => t.q).length : 0;
  const lastIsQ = sess && sess.turns[sess.turns.length - 1]?.q;
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] outline-none focus:border-[#1E2A5A]";

  return (
    <div className="min-h-screen bg-[#F4F5F7] pb-28">
      <div className={`${WIDTH} pt-6`}>
        <div className="px-1">
          <h1 className="text-[23px] font-extrabold leading-snug text-gray-900">내 답변에 이어질<br />면접 꼬리질문</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
            면접 후기 <b className="text-gray-800">10만 건 · 꼬리질문 3만 건</b>을 분석했어요. 내가 지원하는 대학 면접관이 파고드는 방식대로 물어봐요.
          </p>
        </div>

        {/* 남은 개수 */}
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-black/5">
          <p className="text-[13px] text-gray-600">
            {pass ? <b style={{ color: NAVY }}>이용권 사용 중 · 꼬리질문 개수 제한 없음</b>
              : user ? <>남은 꼬리질문 <b className="text-[16px]" style={{ color: PINK }}>{left}개</b>{me?.free_left > 0 && <span className="ml-1 text-[12px] text-gray-400">(무료 {me.free_left}개 포함)</span>}</>
              : <>로그인하면 <b style={{ color: PINK }}>꼬리질문 5개 무료</b></>}
          </p>
          {!pass && (
            <button onClick={() => (user ? setPay(true) : setLogin(true))} className="h-9 rounded-lg px-3 text-[12.5px] font-extrabold text-white" style={{ background: NAVY }}>
              {user ? "더 받기" : "로그인"}
            </button>
          )}
        </div>
        {me?.pending && (
          <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2.5 text-[12.5px] font-bold text-[#C2410C]">
            입금 확인 중이에요 ({me.pending.qty}개 · {won(me.pending.amount)} · {me.pending.depositor}). 확인되면 바로 더해져요.
          </p>
        )}

        {!sess ? (
          /* ① 입력 */
          <div className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <p className="text-[13px] font-bold text-gray-700">지원 대학 <span style={{ color: PINK }}>*</span></p>
                <input value={univ} onChange={(e) => setUniv(e.target.value.slice(0, 30))} onFocus={() => setFocusU(true)} onBlur={() => setTimeout(() => setFocusU(false), 150)}
                  placeholder="예: 건국대학교" className={`${field} mt-1.5 h-11`} />
                {hits.length > 0 && !(hits.length === 1 && hits[0] === univ) && (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
                    {hits.map((h) => (
                      <li key={h}><button type="button" onMouseDown={() => { setUniv(h); setFocusU(false); }} className="block w-full px-3 py-2 text-left text-[13.5px] hover:bg-gray-50">{h}</button></li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[13px] font-bold text-gray-700">학과 <span style={{ color: PINK }}>*</span></p>
                <input value={dept} onChange={(e) => setDept(e.target.value.slice(0, 30))} placeholder="예: 화학공학과" className={`${field} mt-1.5 h-11`} />
              </div>
            </div>
            {univ.trim() && !known && univs.length > 0 && (
              <p className="mt-1.5 text-[11.5px] text-gray-500">목록에 없는 대학은 전체 대학 평균 방식으로 물어봐요.</p>
            )}

            <p className="mt-4 text-[13px] font-bold text-gray-700">어떤 질문이에요? <span style={{ color: PINK }}>*</span></p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MAIN_TYPES.map((t) => (
                <button key={t} onClick={() => chooseType(t)}
                  className={`h-9 rounded-full px-3.5 text-[13px] font-bold ${mainType === t ? "text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}
                  style={mainType === t ? { background: NAVY } : undefined}>{t}</button>
              ))}
            </div>

            {LINK[mainType] && (
              <button onClick={() => openLink(mainType)} className="mt-2 flex w-full items-center justify-between rounded-xl bg-[#FFF0F5] px-3 py-2.5 text-left text-[12.5px] font-bold" style={{ color: PINK }}>
                <span>{mainType === "지원동기" ? "내가 쓴 지원동기 가져오기" : "내 생기부 예상질문에서 고르기"}</span>
                <span>→</span>
              </button>
            )}

            <p className="mt-4 text-[13px] font-bold text-gray-700">면접 질문 <span style={{ color: PINK }}>*</span></p>
            <textarea value={mainQ} onChange={(e) => setMainQ(e.target.value.slice(0, 300))} rows={2} placeholder={MAIN_PH[mainType]}
              className={`${field} mt-1.5 py-2.5 leading-relaxed`} />

            <p className="mt-4 text-[13px] font-bold text-gray-700">내 답변 <span style={{ color: PINK }}>*</span></p>
            <p className="mt-0.5 text-[11.5px] text-gray-500">실제로 말할 것처럼 적어 주세요. 답변 속 단어를 콕 집어서 물어봐요.</p>
            <div className="relative">
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value.slice(0, 1200))} rows={5} placeholder="예: 촉매가 반응 속도에 미치는 영향을 알아보려고 과산화수소 분해 실험을 했습니다. 이산화망가니즈 양을 바꿔 가며…"
                className={`${field} mt-1.5 py-2.5 pb-6 leading-relaxed`} />
              <span className={`absolute bottom-2.5 right-3 text-[11px] font-bold ${answer.trim().length >= 15 ? "text-[#15803D]" : "text-gray-400"}`}>
                {answer.trim().length >= 15 ? "✓" : `${answer.trim().length}/15`}
              </span>
            </div>

            {err && <p className="mt-3 text-[13px] font-semibold text-red-500">{err}</p>}
            <button onClick={start} disabled={!startOk || busy} className="mt-4 h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50" style={{ background: PINK }}>
              {busy ? "면접관이 질문을 고르는 중..." : !univ.trim() ? "지원 대학을 적어 주세요" : !dept.trim() ? "지원 학과를 적어 주세요" : mainQ.trim().length < 5 ? "면접 질문을 적어 주세요" : answer.trim().length < 15 ? "내 답변을 15자 이상 적어 주세요" : "꼬리질문 받기 (1개 사용)"}
            </button>
          </div>
        ) : (
          /* ② 면접 연습 */
          <div className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-extrabold text-gray-900">{sess.univ}{sess.department ? ` · ${sess.department}` : ""}</p>
              <span className="text-[12px] font-bold text-gray-400">꼬리 {tails}/{sess.max ?? 6}</span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <Bubble who="면접관" tag={sess.main_type} text={sess.main_q} />
              {sess.turns.map((t, i) => (t.q ? (
                <div key={i}>
                  <Bubble who="면접관" tag={`꼬리 ${sess.turns.slice(0, i + 1).filter((x) => x.q).length} · ${t.pattern}`} text={t.q} hot />
                  {(t.why || t.tip) && (
                    <div className="ml-2 mt-1.5 rounded-xl bg-[#F8F9FB] px-3 py-2 text-[12px] leading-relaxed text-gray-600">
                      {t.why && <p><b className="text-gray-800">왜 묻냐면</b> · {t.why}</p>}
                      {t.tip && <p className="mt-0.5"><b className="text-gray-800">답할 때</b> · {t.tip}</p>}
                    </div>
                  )}
                </div>
              ) : (
                <Bubble key={i} who="나" text={t.a} me />
              )))}
              {busy && <p className="text-[13px] font-bold text-gray-400">면접관이 다음 질문을 고르는 중...</p>}
              <div ref={endRef} />
            </div>

            {lastIsQ && tails < (sess.max ?? 6) && (
              <div className="mt-4">
                <div className="relative">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value.slice(0, 1200))} rows={4} placeholder="이 꼬리질문에 답해 보세요"
                    className={`${field} py-2.5 pb-6 leading-relaxed`} />
                  <span className={`absolute bottom-2.5 right-3 text-[11px] font-bold ${reply.trim().length >= 15 ? "text-[#15803D]" : "text-gray-400"}`}>
                    {reply.trim().length >= 15 ? "✓" : `${reply.trim().length}/15`}
                  </span>
                </div>
                {err && <p className="mt-2 text-[13px] font-semibold text-red-500">{err}</p>}
                <button onClick={next} disabled={reply.trim().length < 15 || busy} className="mt-2 h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50" style={{ background: PINK }}>
                  {busy ? "질문 고르는 중..." : reply.trim().length < 15 ? "답변을 15자 이상 적어 주세요" : "답하고 다음 꼬리질문 (1개 사용)"}
                </button>
              </div>
            )}
            {tails >= (sess.max ?? 6) && (
              <p className="mt-4 rounded-xl bg-[#EEF1F8] px-3 py-2.5 text-[13px] font-bold" style={{ color: NAVY }}>
                이 질문은 끝까지 파고들었어요. 실제 면접에서도 이 정도면 충분해요. 다른 질문으로 연습해 보세요.
              </p>
            )}
            <button onClick={reset} className="mt-3 h-11 w-full rounded-xl bg-[#F4F5F7] text-[14px] font-bold text-gray-700">새 질문으로 연습하기</button>
          </div>
        )}

        {/* 지난 연습 */}
        {user && me?.recent?.length > 0 && (
          <div className="mt-5">
            <p className="px-1 text-[15px] font-extrabold text-gray-900">지난 연습</p>
            <div className="mt-2 flex flex-col gap-2">
              {me.recent.map((r) => (
                <button key={r.id} onClick={() => openPast(r.id)} className="rounded-2xl bg-white px-4 py-3 text-left ring-1 ring-black/5">
                  <p className="text-[12px] font-bold text-gray-400">{r.univ} · 꼬리 {r.tails}개 · {new Date(r.at).toLocaleDateString("ko-KR")}</p>
                  <p className="mt-0.5 truncate text-[13.5px] font-bold text-gray-800">{r.main_q}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 아직 안 한 서비스 → 하고 오라고 */}
      {need && (
        <Modal onClose={() => setNeed(null)}>
          <p className="text-[18px] font-extrabold text-gray-900">{LINK[need].obj} 먼저 해 주세요</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{LINK[need].need}</p>
          <button onClick={() => { const to = LINK[need].to; setNeed(null); nav(to); }} className="mt-4 h-12 w-full rounded-xl text-[15px] font-extrabold text-white" style={{ background: PINK }}>
            {LINK[need].name} 하러 가기
          </button>
          <button onClick={() => setNeed(null)} className="mx-auto mt-2 block text-[12.5px] text-gray-400 underline">직접 적을게요</button>
        </Modal>
      )}

      {/* 가져오기 */}
      <Sheet open={!!pick} onClose={() => setPick(null)} title={pick?.kind === "motive" ? "어떤 지원동기로 연습할래요?" : "어떤 질문으로 연습할래요?"}>
        {pick?.kind === "interview" ? (
          <div className="flex flex-col gap-4">
            {pick.rows.map((r) => (
              <div key={r.id}>
                <p className="text-[12px] font-bold text-gray-400">{r.univ}{r.dept ? ` · ${r.dept}` : ""} · {new Date(r.at).toLocaleDateString("ko-KR")}</p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {r.qs.map((x, i) => (
                    <button key={i} onClick={() => { setMainType("생기부 질문"); setMainQ(x.q.slice(0, 300)); if (r.univ) setUniv(r.univ); if (r.dept) setDept(r.dept); setAnswer(""); setPick(null); }}
                      className="rounded-xl bg-[#F4F5F7] px-3 py-2.5 text-left text-[13.5px] font-semibold leading-relaxed text-gray-800 active:scale-[.99]">
                      {x.q}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[12px] text-gray-500">질문을 고르면 대학 · 학과가 같이 채워져요. 내 답변만 적으면 바로 꼬리질문을 받아요.</p>
          </div>
        ) : pick ? (
          <div className="flex flex-col gap-2">
            {pick.rows.map((r) => (
              <button key={r.id} onClick={() => {
                setMainType("지원동기");
                setMainQ(`${r.department || "우리 학과"}에 지원한 이유가 뭔가요?`);
                setAnswer((r.motive ?? "").slice(0, 1200));
                if (r.university) setUniv(r.university);
                if (r.department) setDept(r.department);
                setPick(null);
              }} className="rounded-xl bg-[#F4F5F7] px-3 py-3 text-left active:scale-[.99]">
                <p className="text-[12px] font-bold text-gray-400">{r.university}{r.department ? ` · ${r.department}` : ""} · {new Date(r.created_at).toLocaleDateString("ko-KR")}</p>
                <p className="mt-1 line-clamp-3 text-[13.5px] leading-relaxed text-gray-800">{r.motive}</p>
              </button>
            ))}
            <p className="mt-1 text-[12px] text-gray-500">고르면 내 지원동기가 답변으로 들어가요. [꼬리질문 받기]만 누르면 돼요.</p>
          </div>
        ) : null}
      </Sheet>

      {/* 결제 승인 · 반려 알림 */}
      {notice && (
        <Modal onClose={() => setNotice(null)}>
          <p className="text-[18px] font-extrabold text-gray-900">{notice.title}</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{notice.body}</p>
          <button onClick={() => setNotice(null)} className="mt-4 h-12 w-full rounded-xl text-[15px] font-extrabold text-white" style={{ background: NAVY }}>확인</button>
        </Modal>
      )}

      <PassSheet
        open={pay}
        title="면접 꼬리질문"
        headline={left <= 0 ? "꼬리질문을 다 썼어요" : "꼬리질문 개수 제한 없이 받기"}
        onClose={() => setPay(false)}
        onUnlocked={() => { setPay(false); loadMe(); }}
      />
      <LoginPopup open={login} onClose={() => setLogin(false)} title="로그인하고 꼬리질문 5개 무료로 받기" desc="닉네임만 보이고, 학교·이름은 받지 않아요." />
    </div>
  );
}

function Bubble({ who, tag, text, me, hot }) {
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${me ? "rounded-br-md bg-[#1E2A5A] text-white" : hot ? "rounded-bl-md bg-[#FFF0F5]" : "rounded-bl-md bg-[#F4F5F7]"}`}>
        <p className={`text-[11px] font-extrabold ${me ? "text-white/70" : ""}`} style={!me ? { color: hot ? PINK : "#6B7280" } : undefined}>
          {who}{tag ? ` · ${tag}` : ""}
        </p>
        <p className={`mt-0.5 whitespace-pre-wrap text-[14px] leading-relaxed ${me ? "" : "font-semibold text-gray-900"}`}>{text}</p>
      </div>
    </div>
  );
}