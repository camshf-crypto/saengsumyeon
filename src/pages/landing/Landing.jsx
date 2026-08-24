import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { PREORDER as P } from "../preorder/preorderConfig";
import "./landing.css";

/* ── 화면에만 쓰는 정적 문구 ────────────────────────────── */

const PROBLEMS = [
  ["활동은 많은데 어떤 걸 말해야 할지 모르겠습니다", "3년치 생기부 중 면접관이 물어볼 활동을 골라내는 기준이 없습니다."],
  ["지원동기는 외웠는데 꼬리질문이 나오면 막힙니다", "답변을 암기하면 한 번은 넘어가지만 두 번째 질문에서 멈춥니다."],
  ["혼자 연습하니 내 답변이 맞는지 알 수 없습니다", "말은 해봤지만 평가자가 뭘 보는지 모른 채 연습하고 있습니다."],
];

const SOLVE = [
  ["STEP 01", "평가역량 이해", "면접관이 무엇을 보고 점수를 주는지 먼저 파악합니다."],
  ["STEP 02", "학생부에서 질문 찾기", "내 생기부에서 나올 질문을 직접 뽑아냅니다."],
  ["STEP 03", "답변 만들기", "근거가 있는 답변으로 재구성합니다."],
  ["STEP 04", "실전처럼 말하기", "압박질문과 꼬리질문까지 실전으로 연습합니다."],
];

const CURRICULUM = [
  ["이론 1", "인성 · 공동체역량", "자기이해, 협업, 갈등 상황, 리더십 경험을 면접 언어로 정리합니다.", "인성 경험 정리표"],
  ["이론 2", "학업 · 전공역량", "세특과 탐구활동을 학과와 연결하는 방법. 지금까지 무엇을 했는지 말하는 법.", "학생부 핵심활동 5개"],
  ["이론 3", "미래발전가능성", "학과 커리큘럼 리서치법, 지원동기와 학업계획. 앞으로 무엇을 할지 말하는 법.", "지원동기 · 학업계획서"],
  ["실습 1", "인성 빈출질문 실습", "경험질문, 상황질문, 꼬리질문. 가장 많이 나오는 질문부터 답변을 완성합니다.", "인성 답변 10개"],
  ["실습 2", "학생부 심층면접 실습", "내 학생부에서 예상질문을 추출하고, 탐구·세특 심층질문에 대응합니다.", "내 학생부 예상질문 30개"],
  ["실습 3", "파이널 실전면접", "대학별 기출, 압박질문 대응, 실전 모의면접과 평가표 체크.", "대학별 실전 점검표"],
];

const TABS = ["생수면 학습 관리", "탄탄한 3단계 면접 시스템", "계열별 맞춤 교재와 추가자료"];

const SYSTEM_STEPS = [
  ["STEP 01", "평가역량 이해", ["무료 오픈특강으로 가장 빠르게 면접 준비 시작", "인성·전공·미래발전성, 면접관이 무엇을 보는지부터 파악"]],
  ["STEP 02", "학생부 실전 대비", ["이론 3강으로 평가역량별 답변 프레임 완성", "내 학생부에서 예상질문 추출, 세특·탐구 심층질문 대비"]],
  ["STEP 03", "파이널 실전 연습", ["대학별 기출, 압박질문과 꼬리질문 대응", "스터디 모의면접과 평가표로 실전 점검"]],
];


const FOOTNOTE =
  "[누적 4,000명] 세움스피치 대입·고입 면접 과정 누적 수강 인원 (2019.1.1~2025.12.31)";

const won = (n) => n.toLocaleString("ko-KR") + "원";

const NOTICE = [
  {
    title: "사전신청 안내",
    items: [
      "본 과정은 사전신청으로 운영됩니다. 신청 마감은 2027학년도 수시 일정에 맞춰 공지된 날짜까지입니다.",
      "목표 인원 이상이 신청하면 제작이 확정되며, 확정 여부는 마감 후 개별 안내드립니다.",
      "목표 인원에 미달하는 경우 계약금 전액을 환불해 드립니다. 별도 신청 없이 일괄 환불되며, 입금하신 계좌로 돌려드립니다.",
      "계약금은 계좌이체로만 받습니다. 신청 후 안내되는 계좌로 입금하시면 접수가 완료됩니다.",
      "입금자명이 신청자와 다르면 확인이 어렵습니다. 신청 시 입력하신 입금자명 그대로 입금해 주세요.",
      "잔금은 제작이 확정된 후 별도로 안내드립니다.",
      "커리큘럼과 제공 자료는 확정된 계획이며, 제작 과정에서 세부 구성이 일부 조정될 수 있습니다.",
    ],
  },
  {
    title: "강의",
    items: [
      "전 강의는 온라인 동영상으로 제공되며, 공개일에 6강 전체가 한 번에 열립니다.",
      "수강 기간은 강의 공개일로부터 90일이며, 기간 내 횟수 제한 없이 반복 수강할 수 있습니다.",
      "별도 추가 결제 없이 PC와 모바일에서 모두 수강할 수 있습니다. 같은 계정으로 로그인하면 보던 지점부터 이어서 재생됩니다.",
      "수강 기간 내 일시정지 및 이에 따른 기간 연장, 재수강은 불가합니다. 수강을 시작하지 않아도 기간은 자동으로 경과합니다.",
    ],
  },
  {
    title: "교재",
    items: [
      "교재는 「대입면접 교재」와 「답변 정리 워크북」 2종이며, 모두 PDF 파일로 제공됩니다.",
      "두 종 모두 수강료에 포함되어 있으며, 별도 구매 절차는 없습니다.",
      "강의 공개 후 나의 강의실 → 교재 · 학습자료에서 내려받을 수 있습니다. 배송 절차는 없습니다.",
      "교재 파일의 이용 기간은 강의와 동일하게 공개일로부터 90일입니다.",
      "디지털 콘텐츠이므로 파일을 내려받은 이후에는 환불이 불가합니다.",
    ],
  },
  {
    title: "1단계 불합격 시 전액 환불",
    items: [
      "2027학년도 수시 학생부종합전형 1단계 발표일 이전에 신청한 수강생 중, 지원한 모든 대학에서 1단계 불합격한 경우에 한하여 수강료를 전액 환불해 드립니다.",
      "환불은 유선상으로 신청할 수 없으며, 나의 강의실 → 환불 신청에서 요청서를 작성해야 합니다. [1단계 발표일로부터 14일 이내 신청]",
      "환불 신청 시 아래 서류를 모두 첨부해야 합니다.",
      "① 원서접수증 — 지원한 모든 대학의 접수증을 빠짐없이 제출해야 하며, 지원자 인적사항과 지원 대학·전형명이 보이도록 촬영해 주세요.",
      "② 1단계 불합격 조회 화면 — 지원한 모든 대학의 결과를 각각 제출해야 하며, 지원자 인적사항과 불합격 여부가 함께 보이도록 촬영해 주세요.",
      "③ 신분증 사본 — 이름과 사진이 보이도록 하되, 주민등록번호 뒷자리는 가리고 제출해 주세요.",
      "제출한 원서접수증과 불합격 조회 화면의 대학이 일치하지 않거나, 일부 대학의 결과가 누락된 경우 환불이 승인되지 않습니다.",
      "1개 대학이라도 1단계에 합격한 경우에는 본 특약이 적용되지 않으며, 일반 환불 규정에 따릅니다.",
      "교재를 이미 내려받은 경우 교재 금액은 환불 대상에서 제외됩니다.",
    ],
  },
  {
    title: "세움스피치 수강생 50% 할인",
    items: [
      "세움스피치 면접 과정을 수강한 이력이 있는 학생은 합격패스를 50% 할인가로 신청하실 수 있습니다.",
      "쿠폰은 확인 후 발급되며, 나의 강의실에서 확인하실 수 있습니다.",
      "발급받은 쿠폰은 「생수면 대입면접 합격패스」에만 적용됩니다.",
      "쿠폰은 발급 후 30일 이내에 사용하실 수 있으며, 다른 할인과 중복 적용되지 않습니다.",
      "수강 도중 부분 환불을 진행한 경우에는 발급되지 않습니다.",
    ],
  },
  {
    title: "스터디 · 커뮤니티",
    items: [
      "지원 대학과 계열, 면접 일정이 비슷한 학생끼리 스터디를 연결해 드립니다. 수강생이면 누구나 신청하실 수 있습니다.",
      "스터디 구성은 신청 인원과 지원 계열에 따라 달라지거나 배정이 지연될 수 있습니다.",
      "수강생 전용 오픈채팅에서 질문과 면접 정보를 나누실 수 있습니다.",
    ],
  },
  {
    title: "유의사항",
    items: [
      "계정 공유, 중복 사용, 양도, 재판매 등의 행위가 적발되면 회원 자격이 박탈되며 민·형사상 불이익을 받을 수 있습니다.",
      "강의 영상 및 교재를 녹화·캡처·복제하거나 배포하는 경우 이용이 제한되며, 이 경우 환불이 불가합니다.",
      "서로 다른 접속 환경에서 같은 계정으로 동시에 수강하는 것이 확인되면 이용이 제한될 수 있습니다. 제한 기간에도 수강 기간은 그대로 경과합니다.",
      "표기된 수치는 세움스피치 자체 집계 기준이며, 산출 기준은 고객센터를 통해 확인하실 수 있습니다.",
      "환불은 전자상거래 등에서의 소비자보호에 관한 법률 및 당사 환불 규정에 따릅니다.",
    ],
  },
];



/* ── 사전신청 박스 — 상단·하단 두 곳에서 같은 걸 쓴다 ───── */

function PreorderBox({ count, onApply }) {
  const rate = count === null ? 0 : Math.min((count / P.target) * 100, 100);
  const reached = count !== null && count >= P.target;   // 목표 인원 달성

  return (
    <div className="pricebox">
      <div className="wrap">
        <div className="pre-card">
          <div className="pre-head">
            <span className={`pre-badge${reached ? " done" : ""}`}>
              {reached ? "제작 확정" : "사전신청"}
            </span>
            <b>
              {reached
                ? `${P.deadline}까지 신청받습니다`
                : `${P.deadline}까지 신청받습니다`}
            </b>
          </div>

          <div className="pre-price">
            <div className="pre-now">
              <span>지금 내는 계약금</span>
              <b>{won(P.deposit)}</b>
            </div>
            <div className="pre-total">
              <span>총 수강료</span>
              <em>
                {won(P.total)} <i>(잔금 {won(P.balance)}은 제작 확정 후)</i>
              </em>
            </div>
          </div>

          {count !== null && (
            <div className="pre-gauge">
              <div className="pre-gauge-top">
                <span>{reached ? "제작이 확정되었습니다" : "현재 신청"}</span>
                <b>
                  {reached ? `${count}명 신청` : `${count} / ${P.target}명`}
                </b>
              </div>
              <div className="pre-bar">
                <i className={reached ? "full" : ""} style={{ width: `${rate}%` }} />
              </div>
            </div>
          )}

          <button className="btn pre-btn" onClick={onApply}>
            {reached ? "지금 신청하기" : "사전신청 하기"}
          </button>

          <ul className="pre-note">
            {reached ? (
              <li>
                <b>{P.target}명이 모여 제작이 확정되었습니다.</b> 지금 신청하셔도 함께 수강하실 수
                있습니다.
              </li>
            ) : (
              <>
                <li>{P.target}명 이상 신청되면 제작이 확정됩니다. ({P.confirmDate} 개별 안내)</li>
                <li>미달 시 {P.refundDate}까지 계약금 전액을 환불해 드립니다.</li>
              </>
            )}
            <li>강의 공개 예정 {P.openDate} · 수강 기간은 공개일부터 90일</li>
            <li>계약금은 계좌이체로 받습니다. 신청 후 입금 계좌를 안내드립니다.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── 화면 ───────────────────────────────────────────────── */

export default function Landing() {
  const nav = useNavigate();

  const [tab, setTab] = useState(1);
  const [openNotice, setOpenNotice] = useState(0);
  const [count, setCount] = useState(null);

  // 입금 확인된 신청자 수 (개인정보 없이 숫자만 내려온다)
  useEffect(() => {
    supabase.rpc("paid_preorder_count").then(({ data, error }) => {
      if (error) console.error("preorder count", error);
      setCount(data ?? 0);
    });
  }, []);

  function apply() {
    nav("/preorder");
  }

  return (
    <div className="lp">
      <div className="topbar">
        2027 수시 대비 · <b>{P.deadline} 마감</b> · {P.target}명 사전신청 진행 중
      </div>

      {/* 히어로 */}
      <header className="hero">
        <div className="wrap">
          <p className="mid">
            대입면접 코칭 누적 <u>4,000</u> 명
          </p>
          <h1>생수면 대입면접 합격패스</h1>
          <p className="foot">
            {FOOTNOTE}
            <br />
            [합격률 93.7%] 2025학년도 수시 면접 과정 수강생 중 1개 대학 이상 최초합격 기준, 자체 집계
          </p>
          <div className="stats">
            {[
              ["4,000명", "누적 면접 코칭"],
              ["93.7%", "대입 수시 합격률"],
              ["6강 24편", "세부 커리큘럼"],
              ["90일", "수강 기간"],
            ].map(([n, l]) => (
              <div className="stat" key={l}>
                <div className="num">{n}</div>
                <div className="lbl">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* 상단 사전신청 박스 */}
      <PreorderBox count={count} onApply={apply} />

      {/* 문제 */}
      <section className="problem">
        <div className="wrap">
          <span className="eyebrow">이런 학생들을 위한 강의입니다</span>
          <h2>
            생기부는 채웠는데,
            <br />
            면접에서 무너지는 이유가 있습니다
          </h2>
          <div className="plist">
            {PROBLEMS.map(([t, d]) => (
              <div className="pitem" key={t}>
                {t}
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 해결 */}
      <section className="solve">
        <div className="wrap">
          <span className="eyebrow">생수면의 해결 방식</span>
          <h2>
            답변을 외우기 전에,
            <br />
            무엇을 어떻게 말할지부터 배웁니다
          </h2>
          <div className="steps">
            {SOLVE.map(([n, t, d]) => (
              <div className="step" key={n}>
                <div className="n">{n}</div>
                <div className="t">{t}</div>
                <div className="d">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 커리큘럼 */}
      <section className="curri" id="curriculum">
        <div className="wrap">
          <span className="eyebrow">6강 커리큘럼</span>
          <h2>이렇게 만들어집니다</h2>
          <p className="lead">
            듣고 끝나는 강의로 만들지 않습니다. 6강을 마치면 내 학생부로 만든 면접 자료가 손에
            남도록 구성할 예정입니다. 아래는 확정된 커리큘럼입니다.
          </p>

          <div className="ctable">
            <div className="crow head">
              <div>구분</div>
              <div>강의명</div>
              <div>수강 후 남는 것</div>
            </div>
            {CURRICULUM.map(([kind, title, desc, out]) => (
              <div className="crow" key={kind}>
                <div className="ckind">{kind}</div>
                <div className="cmain">
                  <b>{title}</b>
                  <span>{desc}</span>
                </div>
                <div className="cout">
                  <em>
                    <small>결과물</small>
                    {out}
                  </em>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3탭 */}
      <section className="tabsec">
        <div className="wrap">
          <p className="tabhead">
            <b>4,000명</b>을 지도한 대입면접 전문 세움스피치가
            <br />
            이렇게 만들 예정입니다.
          </p>
          <p className="tabdisc">{FOOTNOTE}</p>

          <div className="tabbar">
            {TABS.map((label, i) => (
              <button
                key={label}
                className={`tab${tab === i + 1 ? " on" : ""}`}
                onClick={() => setTab(i + 1)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="tabcard">
            {tab === 1 && (
              <div className="tgrid">
                <div className="tcard">
                  <span className="tn">01</span>
                  <b>
                    온라인 강의 +<br />
                    워크북
                  </b>
                  <p>
                    공개되면 6강 전체가 열립니다
                    <br />
                    강의를 들으며 워크북을 채우는
                    <br />
                    방식으로 구성할 예정입니다
                  </p>
                  <div className="pillrow">
                    <span className="pill mid">온라인<br />강의</span>
                    <span className="pill">워크북<br />PDF</span>
                  </div>
                </div>

                <div className="tcard">
                  <span className="tn">02</span>
                  <b>
                    수강생 전용<br />질문방
                  </b>
                  <p>
                    강의를 듣다 막힌 부분을 남기면
                    <br />
                    대입면접 전문 교육진이
                    <br />
                    직접 답변할 예정입니다
                  </p>
                  <span className="tagbtn">
                    가장 빠르고 정확한<br />면접 정보 공유
                  </span>
                </div>

                <div className="tcard">
                  <span className="tn">03</span>
                  <b>
                    면접<br />스터디 구성
                  </b>
                  <p>
                    수강생이면 누구나 신청 가능
                    <br />
                    지원 대학·계열·면접 일정이
                    <br />
                    비슷한 학생끼리 구성 예정
                    <br />
                    <em>스터디원 매칭 + 주차별 질문지 제공</em>
                  </p>
                </div>

                <div className="tcard">
                  <span className="tn">04</span>
                  <b>
                    1:1<br />코칭
                  </b>
                  <p>
                    · 일대일 실전 모의면접
                    <br />· 대학별 파이널 점검
                    <br />
                    <em>별도 신청 과정으로 운영됩니다</em>
                  </p>
                </div>
              </div>
            )}

            {tab === 2 &&
              SYSTEM_STEPS.map(([n, t, items]) => (
                <div className="stepbox" key={n}>
                  <div className="sn">{n}</div>
                  <b>{t}</b>
                  <ul>
                    {items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}

            {tab === 3 && (
              <>
                <p className="bookhead">
                  <b>가장 정확한, 가장 최신의</b> 대입면접
                  <br />
                  정보를 담아 제작합니다
                </p>
                <div className="bookrow">
                  <div className="bookvis">
                    <img src="/images/textbook-cover.png" alt="대입면접 올패스 교재" />
                  </div>
                  <ul className="booklist">
                    <li>인성·공동체역량<br />빈출질문 수록</li>
                    <li>학업·전공역량<br />답변 프레임</li>
                    <li>지원동기·학업계획<br />작성법 및 실습</li>
                  </ul>
                </div>

                <div className="bookrow alt">
                  <span className="plusmark">+</span>
                  <div className="bookvis">
                    <img src="/images/workbook-cover.png" alt="대입면접 답변 정리 워크북" />
                  </div>
                  <div>
                    <span className="bookbadge">워크북</span>
                    <p className="bookdesc">답변 정리 및 작성 워크북</p>
                    <ul className="booklist">
                      <li>내 학생부에서 뽑은<br />예상질문 정리</li>
                      <li>질문별 답변<br />직접 작성</li>
                      <li>꼬리질문 대비<br />답변 보완</li>
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* 마감 문구 */}
      <section className="final">
        <div className="wrap">
          <h2>
            혼자 외우는 대입면접에서
            <br />
            함께 완성하는 대입면접으로
          </h2>
          <p className="lead">
            세움스피치 4,000명 면접 코칭 노하우를 생수면 6강 온라인 과정에 담습니다.
            <br />
            {P.target}명이 모이면 제작을 시작합니다.
          </p>
        </div>
      </section>

      {/* 하단 사전신청 박스 — 상단과 같은 내용을 한 번 더 */}
      <PreorderBox count={count} onApply={apply} />

      {/* 유의사항 */}
      <div className="notice">
        <div className="wrap">
          <h4>수강 전 확인해 주세요</h4>
          <div className="acc">
            {NOTICE.map((g, i) => {
              const open = openNotice === i;
              return (
                <div className={`acc-item${open ? " on" : ""}`} key={g.title}>
                  <button
                    className="acc-head"
                    onClick={() => setOpenNotice(open ? -1 : i)}
                  >
                    <span>{g.title}</span>
                    <i>{open ? "−" : "+"}</i>
                  </button>
                  {open && (
                    <ul className="acc-body">
                      {g.items.map((t, k) => (
                        <li key={k}>{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}