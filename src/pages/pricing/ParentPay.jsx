import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { track } from "../../lib/track";
import { BANK, PASS_BENEFITS, PLANS } from "../../lib/pass";

/*
 * 부모님 결제 화면 — /pay/:code (로그인 없이)
 * 학생이 '부모님께 결제 요청 보내기'로 카톡에 보낸 링크 (sql/sm_114 pay_requests)
 * 학생 이름(가운데 가림) · 학교 · 생수면에서 한 것 → 이용권 내용 → 계좌 입금 → 입금자명 → '입금했어요'
 * 주문은 학생 이름으로 들어간다 (pay_request_order → 기존 agent_order) · 관리자가 입금을 확인하면 학생 이용권이 열린다
 */
export default function ParentPay() {
  const { code } = useParams();
  const [info, setInfo] = useState(null); // null = 불러오는 중
  const [depositor, setDepositor] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ordered, setOrdered] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.rpc("pay_request_view", { p_code: code }).then(({ data, error }) => {
      if (error || !data) return setInfo({ error: "fail" });
      setInfo(data);
      if (!data.error) track("parent_page", data.ordered ? "ordered" : "open");
    });
  }, [code]);

  const plan = PLANS.find((p) => p.k === info?.plan) ?? PLANS.find((p) => p.sale);

  async function submit() {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("pay_request_order", { p_code: code, p_depositor: depositor.trim() });
    setBusy(false);
    if (error || !data) return setErr(error?.message?.includes("입금자명") ? "입금자명을 적어 주세요." : error?.message?.includes("끝났") ? "요청 기간이 끝났어요. 학생에게 새 링크를 받아 주세요." : "접수하지 못했어요. 잠시 후 다시 눌러 주세요.");
    track("parent_page", "order");
    setOrdered(data);
  }

  function copyBank() {
    navigator.clipboard?.writeText(BANK.number.replace(/-/g, "")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => window.prompt("계좌번호를 복사해 주세요", BANK.number));
  }

  if (!info) return <div className="py-40 text-center text-[14px] text-gray-400">불러오는 중…</div>;
  if (info.error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="text-[18px] font-extrabold text-gray-900">{info.error === "expired" ? "요청 기간(14일)이 끝난 링크예요" : "링크를 찾지 못했어요"}</p>
        <p className="mt-2 text-[14px] text-gray-500">학생에게 생수면에서 '부모님께 결제 요청 보내기'를 다시 눌러 달라고 해 주세요.</p>
      </div>
    );
  }

  const st = info.stats ?? {};
  const where = [info.school, info.grade].filter(Boolean).join(" ");
  const who = `${where ? `${where} ` : ""}${info.name ? `${info.name} 학생` : "자녀"}`;
  const waiting = ordered || info.ordered || info.pending;
  const activity = [
    st.days ? ["생수면을 쓴 날", `${st.days}일`] : null,
    st.questions ? ["물꼬 입시 AI에 물어본 것", `${st.questions}번`] : null,
    st.tasks ? ["완성한 수행평가 · 탐구", `${st.tasks}개`] : null,
    st.topics ? ["탐구주제 흔한가 진단", `${st.topics}번`] : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <p className="text-[20px] font-extrabold text-sm-navy">생수면</p>
        <p className="text-[12.5px] text-gray-500">생기부 · 수행평가 · 면접, 흔하지 않게 준비해요</p>

        <h1 className="mt-6 break-keep text-[22px] font-black leading-snug text-gray-900">
          {who}이 생수면 {plan.label} 결제를 부탁드렸어요
        </h1>

        {activity.length > 0 && (
          <section className="mt-5 border border-gray-200 p-4">
            <p className="text-[13px] font-extrabold text-gray-800">자녀가 생수면에서 한 것</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              {activity.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[12px] text-gray-500">{k}</dt>
                  <dd className="text-[17px] font-extrabold text-sm-navy">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section className="mt-5">
          <p className="text-[13px] font-extrabold text-gray-800">생수면은 무엇인가요</p>
          <p className="mt-1.5 break-keep text-[13.5px] leading-relaxed text-gray-600">
            고등학생이 생활기록부 · 수행평가 · 탐구 보고서 · 대입 면접을 스스로 준비하도록 돕는 서비스예요. 학생이 다니는 학교의 평가계획과 선생님 안내문을 읽고, 학생에게 질문하면서 그 학생만의 결과물로 완성해요. 면접 · 발표 코칭 학원 세움스피치(2019년부터)를 운영하는 세움러닝(주)이 만들었어요.
          </p>
        </section>

        <section className="mt-5 border border-gray-200 p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[15px] font-extrabold text-sm-navy">{plan.label}</p>
            <p className="text-[22px] font-black text-sm-navy">{plan.price.toLocaleString()}원</p>
          </div>
          <p className="text-[12px] text-gray-500">{plan.days === 365 ? "1년 · 한 달 약 6,600원 · " : ""}입금이 확인된 날부터 · 자동으로 다시 결제되지 않아요</p>
          <ul className="mt-3 grid gap-1.5">
            {PASS_BENEFITS.filter((t) => !/출시 예정/.test(t)).map((t) => (
              <li key={t} className="flex items-start gap-2 text-[13px] text-gray-700">
                <span className="mt-[7px] h-1 w-1 flex-none bg-gray-500" />
                {t}
              </li>
            ))}
          </ul>
        </section>

        {waiting ? (
          <section className="mt-5 border border-gray-300 bg-[#F8F9FB] p-5 text-center">
            <p className="text-[16px] font-extrabold text-gray-900">입금 확인 중이에요</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
              {ordered?.depositor ? `${ordered.depositor} · ` : ""}{plan.price.toLocaleString()}원
              <br />
              확인되는 대로 자녀 계정에서 바로 열려요. 보통 2시간 안에, 밤 12시~아침 6시 입금은 오전 8시에 확인해요.
            </p>
          </section>
        ) : (
          <section className="mt-5 border border-gray-200 p-4 text-[13.5px]">
            <p className="flex items-baseline justify-between font-bold text-gray-800">
              ① 아래 계좌로 입금
              <b className="text-[16px] text-gray-900">{plan.price.toLocaleString()}원</b>
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-gray-700">
                {BANK.name} <b>{BANK.number}</b>
                <br />
                <span className="text-[12px] text-gray-500">예금주 {BANK.holder}</span>
              </p>
              <button onClick={copyBank} className="shrink-0 border border-gray-400 px-2.5 py-1 text-[12px] font-bold text-gray-700">{copied ? "복사됨" : "복사"}</button>
            </div>
            <p className="mt-4 font-bold text-gray-800">② 입금하신 분 이름</p>
            <input
              value={depositor}
              onChange={(e) => setDepositor(e.target.value.slice(0, 20))}
              placeholder="통장에 찍히는 이름 그대로"
              className="mt-2 h-11 w-full border border-gray-300 px-3 text-[15px] font-bold text-gray-900 outline-none focus:border-gray-600"
            />
            <label className="mt-4 flex items-center gap-2 font-bold text-gray-800">
              <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="h-4 w-4" />
              {plan.price.toLocaleString()}원을 입금했어요
            </label>
            {err && <p className="mt-3 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}
            <button
              onClick={submit}
              disabled={!done || busy || depositor.trim().length < 2}
              className="mt-3 h-12 w-full bg-gray-900 text-[15px] font-extrabold text-white disabled:opacity-40"
            >
              {busy ? "접수 중…" : "입금했어요"}
            </button>
          </section>
        )}

        <p className="mt-4 text-center text-[12px] text-gray-500">
          궁금한 점은 company@seumlearning.com 으로 보내 주세요 · <Link to="/refund" className="underline">환불 규정</Link>
        </p>
      </div>
    </div>
  );
}