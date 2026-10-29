import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { getPassUntil, PASS_PRICE } from "../../lib/pass";
import PassSheet from "../../components/PassSheet";
import { track } from "../../lib/track";

/*
 * 요금제 — /pricing
 * 무료 vs 1년 이용권 비교 · [1년 이용권 시작하기] → 결제 창(PassSheet)
 * 업그레이드 팝업(components/UpgradeModal)의 [요금제 보기]가 여기로 온다
 * '(출시 예정)'은 기능이 열리면 지운다
 */
const FREE = [
  ["커뮤니티 (나만 그래?, 옥상에서 외쳐, 칼럼)", "전부 무료"],
  ["생기부 노트 기록", "무료"],
  ["선배 합격 생기부", "1개"],
  ["물꼬 입시 AI", "맛보기 + 매일 조금씩 · 광고 있음"],
  ["입결 · 모집요강 (물꼬 안)", "무료"],
  ["선택과목 (대학 권장과목)", "권장과목 보기"],
  ["흔한가 진단 (탐구 · 동기 · 독서)", "탐구 하루 2번 · 동기 · 독서 주 2번"],
  ["탐구 보고서", "탐구 준비까지 (주제 · 방법 · 자료)"],
  ["입시 플랜", "맛보기 1번"],
];
const PAID = [
  ["커뮤니티 (나만 그래?, 옥상에서 외쳐, 칼럼)", "전부"],
  ["생기부 노트 기록", "무료"],
  ["선배 합격 생기부", "5개"],
  ["물꼬 입시 AI", "무제한 · 광고 없음"],
  ["입결 · 모집요강 (물꼬 안)", "무료"],
  ["흔한가 진단 (탐구 · 동기 · 독서)", "무제한"],
  ["탐구 보고서", "결과 분석 → 보고서 PDF 완성"],
  ["생기부 AI 진단", "전체 진단 + 로드맵"],
  ["생기부 예상질문", "6곳"],
  ["수시 면접 기출", "6곳"],
  ["꼬리질문 연습", "무제한"],
  ["공부법 도감 (입시 플랜 · 학습 플랜)", "매주 미션"],
  ["학습 다이어리", "이용권 전용"],
  ["자기주도학습법", "전 과목"],
  ["수행평가", "무제한 (출시 예정)"],
  ["선택과목", "내 학과 맞춤 3년 설계 (출시 예정)"],
];

function Row({ name, value, paid }) {
  return (
    <li className="flex gap-3 border-b border-gray-100 py-2 last:border-0">
      <span className={paid ? "text-sm-orange" : "text-gray-400"}>✓</span>
      <span className={`flex-1 ${paid ? "text-gray-800" : "text-gray-700"}`}>{name}</span>
      <b className={`text-right ${paid ? "font-extrabold text-sm-orange" : "font-bold text-gray-500"}`}>{value}</b>
    </li>
  );
}

export default function Pricing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [until, setUntil] = useState(null); // 이용권 끝나는 날 (없으면 null)
  const [buy, setBuy] = useState(false);

  useEffect(() => {
    track("pricing_view");
    if (user) getPassUntil().then(setUntil);
  }, [user]);

  function start() {
    track("pricing_start");
    if (!user) return nav("/login", { state: { from: "/pricing" } });
    setBuy(true);
  }
  const untilText = until ? new Date(until).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "";

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <p className="text-center text-[13px] font-extrabold text-sm-orange">생수면 이용권</p>
        <h1 className="mt-1 text-center text-[24px] font-black leading-tight text-sm-navy sm:text-[32px]">
          무료로 매일 쌓고,
          <br className="sm:hidden" /> 이용권으로 끝까지 완성해요
        </h1>
        <p className="mt-2 text-center text-[13.5px] text-gray-500">생기부 기록 · 커뮤니티는 계속 무료예요</p>

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {/* 무료 */}
          <div className="rounded-3xl bg-white p-6 ring-1 ring-black/5">
            <p className="text-[15px] font-extrabold text-gray-900">무료</p>
            <p className="mt-1"><b className="text-[30px] font-black text-gray-900">0원</b></p>
            <p className="text-[12.5px] text-gray-500">가입만 하면 계속</p>
            <div className="mt-4 h-12 rounded-2xl bg-gray-100 text-center text-[14.5px] font-extrabold leading-[48px] text-gray-500">
              {until ? "무료 기능" : "지금 쓰는 중"}
            </div>
            <ul className="mt-4 text-[13.5px]">
              {FREE.map(([n, v]) => <Row key={n} name={n} value={v} />)}
            </ul>
          </div>

          {/* 1년 이용권 */}
          <div className="relative rounded-3xl bg-white p-6 ring-2 ring-sm-navy">
            <span className="absolute -top-3 left-6 rounded-full bg-sm-orange px-3 py-1 text-[12px] font-extrabold text-white">첫해 가격</span>
            <p className="text-[15px] font-extrabold text-sm-navy">1년 이용권</p>
            <p className="mt-1"><b className="text-[30px] font-black text-sm-navy">{PASS_PRICE.toLocaleString()}원</b></p>
            <p className="text-[12.5px] font-bold text-sm-orange">한 달 약 6,600원 · 승인한 날부터 1년</p>
            {until ? (
              <div className="mt-4 h-12 rounded-2xl bg-orange-50 text-center text-[14px] font-extrabold leading-[48px] text-sm-orange">이용 중 · {untilText}까지</div>
            ) : (
              <button onClick={start} className="mt-4 h-12 w-full rounded-2xl bg-sm-navy text-[14.5px] font-extrabold text-white">
                1년 이용권 시작하기 ›
              </button>
            )}
            <ul className="mt-4 text-[13.5px]">
              {PAID.map(([n, v]) => <Row key={n} name={n} value={v} paid />)}
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-black/5">
          <p className="text-[14px] font-extrabold text-gray-900">
            1년 동안 이렇게 써요 <span className="text-[12px] font-bold text-gray-400">· 고2 예시</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
            {[
              ["3월", "선택과목 · 1년 로드맵"],
              ["4~7월", "세특 탐구 보고서 · 수행평가"],
              ["8월", "심화 탐구 · 독서"],
              ["9~12월", "2학기 보고서 · 고3 준비"],
            ].map(([m, t]) => (
              <div key={m} className="rounded-2xl bg-orange-50 p-3">
                <b className="text-sm-orange">{m}</b>
                <p className="mt-0.5 text-gray-700">{t}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-[12px] leading-relaxed text-gray-400">
          계좌 입금 후 '입금했어요'를 누르면 확인되는 대로 열려요 · 자동으로 다시 결제되지 않아요 · 환불 규정은 이용약관을 따라요
        </p>
      </div>

      <PassSheet
        open={buy}
        title="생수면 이용권"
        headline="1년 이용권 하나로 생수면 전부 열기"
        onClose={() => setBuy(false)}
        onUnlocked={() => {
          setBuy(false);
          getPassUntil().then(setUntil);
        }}
      />
    </div>
  );
}