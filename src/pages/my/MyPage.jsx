import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { refLink } from "../../lib/referral";
import { printPdf } from "../interview/Interview";
import NicknameEditor, { fetchNickname, NICK_EVENT } from "../../components/NicknameEditor";

/*
 * 마이페이지 — /my
 * 위: 내 정보 · 남은 횟수 · 이용권/결제 · 친구 초대 · 다음에 해볼 것
 * 아래: 내 기록 탭 — 탐구주제 · 독서 · 지원동기 · 면접 · 탐구보고서 · 나만 그래?
 * 맨 아래: 약관 · 로그아웃 · 회원 탈퇴(이유를 묻고 신청 → 관리자가 처리)
 * 주소 끝에 ?tab=reading 처럼 붙이면 그 탭으로 열린다
 */

const TABS = [
  { k: "topic", label: "탐구주제", color: "#EA580C", go: "/topic", empty: "아직 진단한 탐구주제가 없어요." },
  { k: "reading", label: "독서", color: "#2F56D6", go: "/reading", empty: "아직 진단한 책이 없어요." },
  { k: "motive", label: "지원동기", color: "#0B8A5E", go: "/motive", empty: "아직 진단한 지원동기가 없어요." },
  { k: "interview", label: "면접", color: "#18224F", go: "/interview", empty: "아직 뽑은 예상 질문이 없어요." },
  { k: "inquiry", label: "탐구보고서", color: "#C2410C", go: "/inquiry", empty: "아직 시작한 탐구가 없어요." },
  { k: "mulgyeol", label: "나만 그래?", color: "#1A5E9A", go: "/mulgyeol", empty: "아직 답한 질문이 없어요." },
];
const PRODUCT = { interview: "면접 예상질문 1곳", interview6: "면접 예상질문 6곳", ten: "탐구보고서 10건", one: "탐구보고서 1건" };
const ORDER_STATUS = { pending: "입금 확인 중", approved: "결제 완료", rejected: "취소됨", cancelled: "취소됨", refunded: "환불됨" };
const PROVIDER = { kakao: "카카오", google: "구글", email: "이메일" };
const STEPS = ["탐구 시작", "탐구 준비", "결과 분석", "보고서"];
const WITHDRAW_REASONS = ["진단 결과가 도움이 안 됐어요", "필요한 기능이 없어요", "자주 쓰지 않아요", "이용권 가격이 부담돼요", "입시가 끝났어요", "기타"];

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
const num = (v) => Number(v ?? 0);
const day = (d) => new Date(d).toLocaleDateString("ko-KR");
const md = (d) => {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()} ${x.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
};
const won = (v) => `${num(v).toLocaleString()}원`;
const pct = (a, b) => (num(b) ? Math.round((num(a) / num(b)) * 100) : 0);

/* 흰 칸 */
function Card({ title, right, children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-baseline justify-between gap-3">
          {title && <h2 className="text-[16px] font-extrabold text-sm-navy">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/* 기록 한 줄 — 누르면 펼친다 */
function Row({ open, onToggle, meta, title, score, sub, color, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <button onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold" style={{ color }}>{meta}</p>
          <p className="mt-1 text-[14.5px] font-bold leading-relaxed text-sm-navy">{title}</p>
          <p className="mt-1 text-[11.5px] text-gray-400">{sub}</p>
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

function Empty({ text, go, color }) {
  const nav = useNavigate();
  return (
    <div className="rounded-xl border border-gray-200 py-12 text-center">
      <p className="text-sm text-gray-500">{text}</p>
      <button onClick={() => nav(go)} className="mt-4 rounded-lg px-5 py-2.5 text-[14px] font-bold text-white" style={{ background: color }}>
        시작하기
      </button>
    </div>
  );
}

/* 회원 탈퇴 — 이유를 묻고 신청만 받는다 (이유는 선택) */
function WithdrawModal({ onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("request_withdrawal", { p_reason: reason || null, p_detail: detail || null });
    setBusy(false);
    if (error) return setErr("신청하지 못했어요. 잠시 후 다시 해 주세요.");
    onDone(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[17px] font-extrabold text-sm-navy">탈퇴하기 전에, 이유를 알려줄래요?</p>
        <p className="mt-1 text-[13px] text-gray-500">고르지 않아도 탈퇴 신청은 돼요. 더 나은 서비스를 만드는 데 써요.</p>

        <div className="mt-4 space-y-1.5">
          {WITHDRAW_REASONS.map((r) => (
            <label key={r} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-4 py-3 text-[14px] font-bold ${reason === r ? "border-sm-navy bg-gray-50 text-sm-navy" : "border-gray-200 text-gray-600"}`}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="h-4 w-4 accent-[#18224F]" />
              {r}
            </label>
          ))}
        </div>
        {reason && (
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value.slice(0, 300))}
            rows={3}
            placeholder="더 하고 싶은 말이 있으면 적어 주세요 (선택)"
            className="mt-3 w-full resize-none rounded-xl border border-gray-300 px-4 py-3 text-[14px] outline-none focus:border-sm-navy"
          />
        )}

        <div className="mt-4 rounded-xl bg-gray-50 p-4 text-[12.5px] leading-relaxed text-gray-600">
          탈퇴 신청을 하면 확인한 뒤 처리해요. 처리되면 진단 기록, 탐구보고서, 닉네임과 댓글, 남은 이용권이 모두 지워지고 되돌릴 수 없어요.
          남은 이용권이나 진행 중인 결제가 있으면 환불 안내를 먼저 드려요.
        </div>
        {err && <p className="mt-3 text-[13px] font-bold text-red-500">{err}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="h-12 rounded-xl bg-sm-navy text-[14.5px] font-bold text-white">
            계속 쓸게요
          </button>
          <button onClick={submit} disabled={busy} className="h-12 rounded-xl border border-gray-300 text-[14.5px] font-bold text-gray-500 disabled:opacity-50">
            {busy ? "신청 중…" : "탈퇴 신청"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyPage() {
  const { user, profile, signOut, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.k === params.get("tab")) ? params.get("tab") : "topic";
  const T = TABS.find((t) => t.k === tab);

  const [sum, setSum] = useState(null); // 한눈에 보기 (mypage_summary)
  const [nick, setNick] = useState(null);
  const [data, setData] = useState({}); // 탭별 기록
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 한눈에 보기 + 닉네임
  useEffect(() => {
    if (authLoading || !user) return;
    supabase.rpc("mypage_summary").then(({ data: d, error }) => {
      if (error) console.error("mypage summary failed", error);
      setSum(error ? { error: true } : d);
    });
    fetchNickname().then((d) => setNick(d?.is_auto ? null : d?.nickname ?? null));
    const onNick = (e) => setNick(e.detail || null);
    window.addEventListener(NICK_EVENT, onNick);
    return () => window.removeEventListener(NICK_EVENT, onNick);
  }, [authLoading, user]);

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
        : tab === "interview"
        ? supabase.from("interview_queries").select("id, targets, university, department, result, created_at").order("created_at", { ascending: false }).limit(50)
        : tab === "inquiry"
        ? supabase.rpc("mypage_inquiries")
        : supabase.rpc("mypage_mulgyeol");
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

  const rows = tab === "mulgyeol" ? data.mulgyeol?.answers ?? [] : Array.isArray(data[tab]) ? data[tab] : [];

  // 남은 횟수 칸
  const quota = useMemo(() => {
    const q = sum?.quota;
    if (!q) return [];
    const bonus = num(q.topic_bonus);
    return [
      { name: "탐구주제", left: `${Math.max(0, 3 - num(q.topic_used))}번`, total: "3번", when: bonus ? `오늘 · 친구 보너스 +${bonus}` : "오늘", color: "#C2410C", go: "/topic" },
      { name: "독서", left: `${Math.max(0, 2 - num(q.reading_used))}권`, total: "2권", when: "이번 주", color: "#2F56D6", go: "/reading" },
      { name: "지원동기", left: `${Math.max(0, 2 - num(q.motive_used))}번`, total: "2번", when: "이번 주", color: "#0B8A5E", go: "/motive" },
      { name: "탐구보고서", left: `${num(q.inquiry_credits)}건`, total: null, when: "이용권", color: "#18224F", go: "/inquiry" },
    ];
  }, [sum]);

  // 다음에 해볼 것 — 이 학생이 아직 안 한 것·이어서 할 것 (최대 3개)
  const next = useMemo(() => {
    if (!sum || sum.error) return [];
    const c = sum.counts ?? {};
    const list = [];
    if (num(sum.mulgyeol_today_left) > 0)
      list.push({ title: `오늘 열린 나만 그래? 질문 ${num(sum.mulgyeol_today_left)}개`, sub: "다른 고등학생들은 어떤지 확인해봐요", color: "#1A5E9A", go: "/mulgyeol" });
    if (sum.last_topic && num(sum.last_topic.score) >= 65 && !num(c.inquiry))
      list.push({ title: "흔한 편이었던 주제, 탐구보고서로 바꿔보기", sub: `탐구주제 ${sum.last_topic.score}점 · 기억에 남는 탐구보고서`, color: "#C2410C", go: "/inquiry" });
    if (!num(c.topic)) list.push({ title: "내 탐구주제, 얼마나 흔할까?", sub: "탐구주제 흔한가", color: "#C2410C", go: "/topic" });
    if (!num(c.motive)) list.push({ title: "지원동기 흔한가 아직 안 해봤어요", sub: "희망 대학 기준으로 지원동기 점검", color: "#0B8A5E", go: "/motive" });
    if (!num(c.reading)) list.push({ title: "독서 흔한가 아직 안 해봤어요", sub: "읽은 책이 남들과 얼마나 겹칠까", color: "#2F56D6", go: "/reading" });
    if (!num(c.interview)) list.push({ title: "내 생기부로 면접 질문 뽑아보기", sub: "면접 예상 질문", color: "#18224F", go: "/interview" });
    return list.slice(0, 3);
  }, [sum]);

  async function copyInvite() {
    const { data: code, error } = await supabase.rpc("mypage_referral");
    if (error || !code) return window.alert("초대 링크를 만들지 못했어요.");
    const link = refLink(code);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("이 링크를 복사해서 보내 주세요", link);
    }
    supabase.rpc("log_ref_event", { p_type: "link_copy", p_code: code }).then(() => {});
  }

  async function cancelWithdraw() {
    await supabase.rpc("cancel_withdrawal");
    setSum((s) => ({ ...s, withdraw: null }));
  }

  async function logout() {
    await signOut();
    nav("/");
  }

  async function deleteComment(id) {
    if (!window.confirm("이 댓글을 지울까요?")) return;
    await supabase.rpc("mulgyeol_comment_delete", { p_comment_id: id });
    setData((d) => ({ ...d, mulgyeol: { ...d.mulgyeol, comments: (d.mulgyeol?.comments ?? []).filter((c) => c.id !== id) } }));
  }

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
  const meta = user.user_metadata ?? {};
  const provider = user.app_metadata?.provider;
  const counts = sum?.counts ?? {};
  const orders = sum?.orders ?? [];
  const ref = sum?.referral ?? {};

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <div className="mx-auto max-w-2xl space-y-3.5 px-4 py-8 sm:px-5 sm:py-12">
        <div className="px-1">
          <p className="text-sm font-bold text-sm-orange">마이페이지</p>
          <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-sm-navy">{nick || profile?.name || "회원"}님</h1>
        </div>

        {/* 탈퇴 신청 중 */}
        {sum?.withdraw && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-300 bg-white p-4">
            <p className="text-[13.5px] text-gray-600">
              <b className="text-sm-navy">탈퇴 신청이 접수됐어요.</b> 확인한 뒤 처리해 드려요.
            </p>
            <button onClick={cancelWithdraw} className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-[13px] font-bold text-gray-600">
              신청 취소
            </button>
          </div>
        )}

        {/* 내 정보 — 닉네임 카드 + 학년·로그인·이메일 */}
        <div className="space-y-2">
          <NicknameEditor />
          <p className="px-2 text-[12.5px] text-gray-500">
            {[meta.grade, provider && `${PROVIDER[provider] ?? provider}로 로그인`, user.email].filter(Boolean).join(" · ")}
          </p>
        </div>

        {sum?.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">정보를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>}

        {/* 남은 횟수 */}
        {quota.length > 0 && (
          <Card title="남은 횟수" right={<span className="text-[11.5px] text-gray-400">탐구주제는 매일, 독서·지원동기는 매주 채워져요</span>}>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {quota.map((q) => (
                <Link key={q.name} to={q.go} className="rounded-xl border border-gray-100 bg-gray-50 p-3 transition hover:border-gray-300">
                  <p className="text-[12px] font-bold" style={{ color: q.color }}>{q.name}</p>
                  <p className="mt-1 text-[20px] font-black text-sm-navy">
                    {q.left}
                    {q.total && <span className="text-[12.5px] font-medium text-gray-400"> / {q.total}</span>}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-gray-500">{q.when}</p>
                </Link>
              ))}
            </div>
          </Card>
        )}

        {/* 이용권 · 결제 */}
        {sum && !sum.error && (orders.length > 0 || sum.interview_access || num(sum.quota?.inquiry_credits) > 0) && (
          <Card title="이용권 · 결제">
            <div className="mt-3 space-y-2">
              {orders.map((o) => {
                const pending = o.status === "pending";
                const refund = o.refund_status && o.refund_status !== "rejected" && o.refund_status !== "done";
                const isInterview = String(o.product).startsWith("interview");
                return (
                  <div
                    key={o.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${pending ? "border-orange-200 bg-orange-50" : "border-gray-200"}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${pending ? "bg-[#C2410C] text-white" : o.status === "approved" ? "bg-gray-100 text-sm-navy" : "bg-gray-100 text-gray-500"}`}>
                          {refund ? "환불 요청 중" : ORDER_STATUS[o.status] ?? o.status}
                        </span>
                        <p className="text-[14px] font-bold text-sm-navy">{PRODUCT[o.product] ?? o.product}</p>
                      </div>
                      <p className="mt-1 text-[12px] text-gray-500">
                        {won(o.amount)} · {md(o.created_at)} {pending ? "신청 · 확인되면 바로 쓸 수 있어요" : "결제"}
                      </p>
                    </div>
                    {o.status === "approved" && !refund && (
                      <Link to={isInterview ? "/my?tab=interview" : "/inquiry"} className="shrink-0 text-[13px] font-bold text-sm-navy">
                        {isInterview ? "질문 보기" : "탐구 시작"}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-gray-500">
              <span>
                탐구보고서 이용권 <b className="text-sm-navy">{num(sum.quota?.inquiry_credits)}건</b> 남음
              </span>
              {sum.interview_access && <span>면접 예상질문 이용 중</span>}
              <Link to="/refund" className="ml-auto font-bold text-gray-500 underline-offset-2 hover:underline">
                환불 안내
              </Link>
            </div>
          </Card>
        )}

        {/* 친구 초대 */}
        {sum && !sum.error && (
          <section className="rounded-2xl bg-sm-navy p-5 text-white">
            <h2 className="text-[16px] font-extrabold">친구 초대</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-300">친구가 내 링크로 가입하고 진단하면, 나도 진단이 더 생겨요.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[12px] text-gray-300">가입한 친구</p>
                <p className="mt-1 text-[20px] font-black">{num(ref.invited)}명</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="text-[12px] text-gray-300">진단까지 한 친구</p>
                <p className="mt-1 text-[20px] font-black">{num(ref.rewarded)}명</p>
              </div>
            </div>
            <button onClick={copyInvite} className="mt-3 h-12 w-full rounded-xl bg-sm-orange text-[14.5px] font-extrabold text-white">
              {copied ? "복사했어요!" : "내 초대 링크 복사"}
            </button>
          </section>
        )}

        {/* 다음에 해볼 것 */}
        {next.length > 0 && (
          <Card title="다음에 해볼 것">
            <div className="mt-1">
              {next.map((n, i) => (
                <Link key={n.title} to={n.go} className={`flex items-center gap-3 py-3 ${i ? "border-t border-gray-100" : ""}`}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold text-sm-navy">{n.title}</span>
                    <span className="block text-[12px] text-gray-500">{n.sub}</span>
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </Card>
        )}

        {/* 내 기록 */}
        <Card title="내 기록">
          <div className="mt-3 flex flex-wrap gap-1.5">
            {TABS.map((t) => {
              const on = tab === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => {
                    setOpenId(null);
                    setParams(t.k === "topic" ? {} : { tab: t.k }, { replace: true });
                  }}
                  className={`h-9 rounded-full px-3.5 text-[13px] font-bold transition ${on ? "bg-sm-navy text-white" : "border border-gray-200 bg-white text-gray-600"}`}
                >
                  {t.label}
                  {counts[t.k] != null && <span className="ml-1 font-medium opacity-70">{num(counts[t.k])}</span>}
                </button>
              );
            })}
          </div>

          {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

          <div className="mt-4 space-y-2">
            {busy && <p className="py-12 text-center text-sm text-gray-400">불러오는 중…</p>}
            {!busy && !rows.length && !err && <Empty text={T.empty} go={T.go} color={T.color} />}

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
                    meta={[r.university, r.department].filter(Boolean).join(" · ")}
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

            {/* 탐구보고서 — 4단계 진행 막대 */}
            {!busy && tab === "inquiry" &&
              rows.map((r) => {
                const step = num(r.step) || 1;
                const href = step >= 4 ? `/inquiry/${r.id}/report` : step === 3 ? `/inquiry/${r.id}/result` : `/inquiry/${r.id}`;
                return (
                  <div key={r.id} className="rounded-xl border border-gray-200 p-4">
                    <p className="text-[11.5px] font-bold text-[#C2410C]">{[r.department, r.subject].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1 text-[14.5px] font-bold leading-relaxed text-sm-navy">{r.topic}</p>
                    <div className="mt-3 grid grid-cols-4 gap-1" aria-label={`4단계 중 ${step}단계`}>
                      {STEPS.map((s, i) => (
                        <span key={s} className={`h-1.5 rounded-full ${i < step ? "bg-sm-orange" : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[12px] text-gray-500">
                        {step >= 4 ? "보고서까지 만들었어요" : `${STEPS[step - 1]}까지 했어요`} · {day(r.updated_at || r.created_at)}
                      </span>
                      <Link to={href} className="text-[13px] font-bold text-[#C2410C]">
                        {step >= 4 ? "보고서 보기" : "이어서 하기"}
                      </Link>
                    </div>
                  </div>
                );
              })}

            {/* 나만 그래? — 내가 답한 질문 */}
            {!busy && tab === "mulgyeol" &&
              rows.map((a) => {
                const r = a.result ?? {};
                const by = (r.by_grade ?? []).find((x) => x.grade === a.grade);
                const yes = a.answer === "yes";
                const useGrade = by && num(by.total) >= 5;
                const same = useGrade ? (yes ? num(by.yes) : num(by.total) - num(by.yes)) : yes ? num(r.yes) : num(r.no);
                const base = useGrade ? num(by.total) : num(r.total);
                return (
                  <Link key={a.question_id} to="/mulgyeol" className="block rounded-xl border border-gray-200 p-4">
                    <p className="text-[11.5px] text-gray-400">{a.open_date && `${Number(a.open_date.slice(5, 7))}월 ${Number(a.open_date.slice(8, 10))}일`}</p>
                    <p className="mt-1 text-[14.5px] font-bold leading-relaxed text-sm-navy">{a.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-[12px] font-bold text-white ${yes ? "bg-[#1A5E9A]" : "bg-sm-orange"}`}>{yes ? "나도 그래" : "난 아닌데"}</span>
                      <span className="text-[12.5px] text-gray-600">
                        {useGrade ? `${a.grade} 중` : "답한 사람 중"} {pct(same, base)}%가 나랑 같아요
                      </span>
                    </div>
                  </Link>
                );
              })}

            {/* 나만 그래? — 내 댓글 */}
            {!busy && tab === "mulgyeol" && (data.mulgyeol?.comments ?? []).length > 0 && (
              <div className="pt-3">
                <p className="text-[13px] font-bold text-gray-600">내가 남긴 댓글 {data.mulgyeol.comments.length}</p>
                <div className="mt-2 space-y-2">
                  {data.mulgyeol.comments.map((c) => (
                    <div key={c.id} className="rounded-xl bg-gray-50 px-4 py-3">
                      <p className="text-[12px] text-gray-500">{c.title}</p>
                      <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-sm-navy">{c.body}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11.5px] text-gray-400">
                          {day(c.created_at)}
                          {c.hidden && <b className="ml-1.5 text-red-500">신고가 쌓여 가려졌어요</b>}
                        </span>
                        <button onClick={() => deleteComment(c.id)} className="px-1 py-1 text-[12px] text-gray-400 hover:text-red-500">
                          지우기
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* 설정 */}
        <Card className="!py-1">
          <Link to="/terms" className="block border-b border-gray-100 py-3.5 text-[14px] font-bold text-gray-700">
            이용약관 · 개인정보처리방침
          </Link>
          <button onClick={logout} className="block w-full border-b border-gray-100 py-3.5 text-left text-[14px] font-bold text-gray-700">
            로그아웃
          </button>
          {!sum?.withdraw && (
            <button onClick={() => setLeaving(true)} className="block w-full py-3.5 text-left text-[13px] text-gray-500">
              회원 탈퇴
            </button>
          )}
        </Card>
      </div>

      {leaving && (
        <WithdrawModal
          onClose={() => setLeaving(false)}
          onDone={(w) => {
            setLeaving(false);
            setSum((s) => ({ ...s, withdraw: w }));
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </div>
  );
}