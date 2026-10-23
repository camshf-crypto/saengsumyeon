import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getClientId } from "../../lib/clientId";

/*
 * 📮 광고 문의 — /advertise (누구나 · 로그인 없이)
 *   ① 생수면 소개 + 진짜 숫자 (가입 학생 · 최근 30일 방문)
 *   ② 광고 자리 2곳 (메인 맨 위 배너 · 오른쪽 띠 배너) — 크기 · 업체 수 · 보이는 방식
 *   ③ 광고 기준 (청소년에게 맞지 않는 광고는 받지 않음)
 *   ④ 문의 남기기 → 관리자 '가입 · 결제 > 광고' 탭 위쪽에 쌓인다
 *   가격은 페이지에 적지 않고, 문의가 오면 따로 안내한다
 * DB: sql/sm_69_ad_inquiry.sql (ads_public_stats · ad_inquiry_submit)
 */

const WIDTH = "mx-auto max-w-3xl px-4 sm:px-6";
const PLACES = [
  { k: "top", label: "메인 맨 위 배너", size: "1200 × 240", rule: "업체 3곳까지 · 5초마다 돌아가며 보여요", where: "메인에 들어오면 가장 먼저 보이는 자리 (탐구주제 검색창 위)" },
  { k: "right", label: "오른쪽 띠 배너", size: "900 × 200", rule: "업체 4곳까지 · 4개가 함께 보여요", where: "메인 오른쪽 · 휴대폰에서는 메인 아래쪽" },
];
const PLACE_OPT = [
  { k: "top", l: "맨 위 배너" },
  { k: "right", l: "오른쪽 띠 배너" },
  { k: "both", l: "둘 다" },
  { k: "undecided", l: "상담 후 결정" },
];
const NO = ["술 · 담배 · 전자담배", "도박 · 사행성", "대출 · 금융 투자", "성인 · 이성 만남", "다이어트약 · 의약품", "허위 · 과장 광고 (합격 보장 등)"];

function Box({ children, className = "" }) {
  return <section className={`rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 ${className}`}>{children}</section>;
}

/* 광고 자리 그림 — 메인 화면을 단순하게 그리고 해당 자리만 색칠 */
function Mini({ k }) {
  const on = "bg-sm-orange";
  const off = "bg-gray-200";
  return (
    <div className="flex gap-1.5 rounded-lg bg-[#F4F5F7] p-2">
      <div className="flex flex-1 flex-col gap-1">
        <i className={`block h-3 rounded-sm ${k === "top" ? on : "bg-transparent"}`} />
        <i className={`block h-2.5 rounded-sm ${off}`} />
        <i className="block h-5 rounded-sm bg-sm-navy/70" />
        <div className="grid grid-cols-4 gap-1">{[...Array(8)].map((_, i) => <i key={i} className={`block h-3 rounded-sm ${off}`} />)}</div>
      </div>
      <div className="flex w-[34%] flex-col gap-1">
        <i className={`block h-5 rounded-sm ${off}`} />
        {[...Array(4)].map((_, i) => <i key={i} className={`block h-2 rounded-sm ${k === "right" ? on : off}`} />)}
      </div>
    </div>
  );
}

export default function Advertise() {
  const [stats, setStats] = useState(null);
  const [f, setF] = useState({ company: "", person: "", phone: "", email: "", place: "undecided", period: "", message: "", agree: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.rpc("ads_public_stats").then(({ data }) => setStats(data ?? null));
  }, []);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const miss =
    f.company.trim().length < 2 ? "업체명" :
    f.person.trim().length < 2 ? "담당자 이름" :
    f.phone.replace(/[^0-9]/g, "").length < 9 ? "연락처" :
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) ? "이메일" :
    !f.agree ? "개인정보 동의" : "";

  async function submit() {
    if (miss) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.rpc("ad_inquiry_submit", {
      p_company: f.company, p_person: f.person, p_phone: f.phone, p_email: f.email,
      p_place: f.place, p_period: f.period, p_message: f.message, p_client: getClientId(), p_agree: f.agree,
    });
    setBusy(false);
    if (error) return setErr(error.message.replace(/^.*?:\s*/, "") || "문의를 남기지 못했어요. 잠시 후 다시 시도해 주세요");
    setDone(true);
    setF({ company: "", person: "", phone: "", email: "", place: "undecided", period: "", message: "", agree: false });
  }

  const inp = "mt-1 w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-[15px] outline-none focus:border-sm-navy";
  const n = (v) => Number(v ?? 0).toLocaleString();

  return (
    <div className="min-h-screen bg-[#F4F5F7] pb-24 pt-6 sm:pt-10">
      <div className={`${WIDTH} space-y-4`}>
        {/* ① 소개 */}
        <section className="rounded-2xl bg-sm-navy px-6 py-8 text-white sm:px-8">
          <p className="text-[13px] font-bold text-orange-300">생수면 광고 문의</p>
          <h1 className="mt-2 text-[26px] font-extrabold leading-snug tracking-tight sm:text-[30px]">
            입시를 준비하는 고등학생이
            <br />
            매일 들어오는 곳에 알리세요
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-slate-300">
            생수면은 탐구주제 진단 · 면접 예상질문 · 공부법 · 학생 커뮤니티를 함께 쓰는 고등학생 입시 서비스예요.
          </p>
          {stats && (
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/10 px-4 py-3">
                <p className="text-[12px] text-slate-300">가입 학생</p>
                <b className="text-[24px] font-extrabold">{n(stats.members)}명</b>
              </div>
              <div className="rounded-xl bg-white/10 px-4 py-3">
                <p className="text-[12px] text-slate-300">최근 30일 방문자 <span className="text-slate-400">· 일별 방문자 합계</span></p>
                <b className="text-[24px] font-extrabold">{n(stats.visits_30d)}명</b>
              </div>
            </div>
          )}
        </section>

        {/* ② 광고 자리 */}
        <Box>
          <h2 className="text-[18px] font-extrabold text-gray-900">광고 자리</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-gray-500">
            <i className="inline-block h-2.5 w-4 rounded-sm bg-sm-orange" />
            주황색이 광고가 들어가는 자리예요
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PLACES.map((p) => (
              <div key={p.k} className="rounded-xl border border-gray-200 p-4">
                <Mini k={p.k} />
                <b className="mt-3 block text-[16px] text-sm-navy">{p.label}</b>
                <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{p.where}</p>
                <div className="mt-3 space-y-1 text-[13px]">
                  <p className="flex justify-between"><span className="text-gray-500">배너 크기</span><b className="text-gray-800">{p.size}</b></p>
                  <p className="flex justify-between"><span className="text-gray-500">보이는 방식</span><b className="text-right text-gray-800">{p.rule}</b></p>
                </div>
              </div>
            ))}
          </div>
        </Box>

        {/* ③ 광고 기준 */}
        <Box>
          <h2 className="text-[18px] font-extrabold text-gray-900">받지 않는 광고</h2>
          <p className="mt-1 text-[13px] text-gray-500">이용자 대부분이 청소년이라, 아래 광고는 받지 않아요.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {NO.map((x) => (
              <span key={x} className="rounded-lg bg-[#F4F5F7] px-3 py-1.5 text-[13px] font-semibold text-gray-700">{x}</span>
            ))}
          </div>
        </Box>

        {/* ④ 문의 */}
        <Box>
          <h2 className="text-[18px] font-extrabold text-gray-900">광고 문의 남기기</h2>
          <p className="mt-1 text-[13px] text-gray-500">남겨 주시면 확인 후 연락드려요.</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[13px] font-bold text-gray-700">업체명 *<input value={f.company} onChange={(e) => set("company", e.target.value)} className={inp} /></label>
            <label className="text-[13px] font-bold text-gray-700">담당자 이름 *<input value={f.person} onChange={(e) => set("person", e.target.value)} className={inp} /></label>
            <label className="text-[13px] font-bold text-gray-700">연락처 *<input value={f.phone} onChange={(e) => set("phone", e.target.value.replace(/[^0-9-]/g, ""))} inputMode="numeric" placeholder="010-0000-0000" className={inp} /></label>
            <label className="text-[13px] font-bold text-gray-700">이메일 *<input value={f.email} onChange={(e) => set("email", e.target.value.trim())} type="email" placeholder="name@company.com" className={inp} /></label>
          </div>

          <p className="mt-4 text-[13px] font-bold text-gray-700">원하는 자리</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PLACE_OPT.map((o) => (
              <button key={o.k} type="button" onClick={() => set("place", o.k)}
                className={`h-11 rounded-xl border-2 text-[13.5px] font-bold ${f.place === o.k ? "border-sm-navy bg-indigo-50 text-sm-navy" : "border-gray-200 text-gray-600"}`}>
                {o.l}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-[13px] font-bold text-gray-700">원하는 기간<input value={f.period} onChange={(e) => set("period", e.target.value)} placeholder="예: 12월 한 달 · 겨울방학 동안" className={inp} /></label>
          <label className="mt-3 block text-[13px] font-bold text-gray-700">문의 내용
            <textarea value={f.message} onChange={(e) => set("message", e.target.value)} rows={4} placeholder="알리고 싶은 내용, 궁금한 점을 적어 주세요" className={`${inp} resize-none`} />
          </label>

          <label className="mt-4 flex items-start gap-2.5 rounded-xl bg-[#F4F5F7] p-3.5 text-[12.5px] leading-relaxed text-gray-600">
            <input type="checkbox" checked={f.agree} onChange={(e) => set("agree", e.target.checked)} className="mt-0.5 h-5 w-5 flex-none" />
            <span>
              <b className="text-gray-800">[필수] 개인정보 수집 · 이용에 동의해요</b>
              <br />
              수집 항목: 업체명, 담당자 이름, 연락처, 이메일 · 목적: 광고 상담 연락 · 보관: 1년 뒤 삭제
            </span>
          </label>

          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}
          <button onClick={submit} disabled={!!miss || busy} className="mt-4 h-[52px] w-full rounded-xl bg-sm-navy text-[15.5px] font-extrabold text-white disabled:opacity-40">
            {busy ? "보내는 중…" : miss ? `${miss}을(를) 확인해 주세요` : "광고 문의 보내기"}
          </button>
        </Box>
      </div>

      {/* 보냈어요 팝업 */}
      {done && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDone(false)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-[18px] font-extrabold text-gray-900">문의를 받았어요</p>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-600">확인 후 남겨 주신 연락처로 연락드릴게요.</p>
            <button onClick={() => setDone(false)} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-bold text-white">확인</button>
          </div>
        </div>
      )}
    </div>
  );
}