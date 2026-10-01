/*
 * 검색용 주소별 페이지 — 빌드(vite build)가 끝난 뒤 자동으로 실행된다
 *
 * React 앱은 모든 주소가 같은 빈 index.html이라, 네이버 로봇(Yeti)이 내용을 거의 못 읽는다.
 * 그래서 주소마다 dist/<주소>/index.html을 따로 만들어 제목·설명·본문 글을 넣어 둔다.
 * Vercel은 실제 파일이 있으면 그 파일을 먼저 보여주므로 로봇은 이 글을 읽고,
 * 학생 화면은 곧바로 React가 그려서 평소와 똑같이 보인다.
 *
 * 제목·설명·본문을 바꾸려면 아래 PAGES만 고친다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SITE = "https://saengsumyeon.vercel.app"; // 도메인을 사면 여기만 바꾼다
const DIST = "dist";

const NAV = [
  ["/topic", "탐구주제 흔한가"],
  ["/reading", "독서 흔한가"],
  ["/motive", "지원동기 흔한가"],
  ["/interview", "면접 예상 질문"],
  ["/inquiry", "기억에 남는 탐구보고서"],
];

const PAGES = [
  {
    path: "/",
    title: "생수면 | 생기부·수행평가·면접, 흔하지 않게 준비해요",
    desc: "생수면은 생활기록부·수행평가·면접을 한곳에서 준비하는 곳이에요. 실제 생기부 기록과 비교해 탐구주제·세특 독서·지원동기가 흔한지 진단하고, 기억에 남는 탐구보고서와 대학별 면접 예상 질문까지 만들어요.",
    h1: "생기부·수행평가·면접, 흔하지 않게 준비해요",
    body: [
      "생수면은 생(활기록부)·수(행평가)·면(접)을 한곳에서 준비하는 곳이에요. 131개 학과의 실제 세특·독서 기록과 비교해, 내가 준비한 탐구주제·독서·지원동기가 얼마나 흔한지 흔함 지수로 알려드려요.",
      "탐구주제 흔한가: 희망 학과와 과목, 탐구주제를 넣으면 흔함 지수와 흔한 이유, 상위 1% 탐구주제로 다듬는 방법을 알려드려요. 하루 3번 무료예요.",
      "독서 흔한가: 세특에 쓸 책이 같은 학과 학생들이 다 읽는 책인지, 책 수준(초급·중급·고급)과 같은 책을 다르게 읽는 법, 덜 흔한 책을 추천해요.",
      "지원동기 흔한가: 고3 대입 지원동기를 137개 대학의 면접 평가요소(인성·전공적합성·학업역량 등) 기준으로 분석하고 면접관의 첫 질문을 예상해요.",
      "면접 예상 질문: 내 생기부 활동을 바탕으로 수시 6곳 지원 대학의 면접 스타일에 맞춘 예상 질문을 뽑아 PDF로 드려요.",
    ],
  },
  {
    path: "/topic",
    title: "탐구주제 흔한가 - 세특 탐구주제 흔함 진단 | 생수면",
    desc: "내 세특 탐구주제, 같은 학과 학생들이 다 하는 주제일까? 실제 생기부 탐구 기록과 비교해 흔함 지수와 흔한 이유를 알려주고, 상위 1% 탐구주제로 다듬어 드려요. 하루 3번 무료.",
    h1: "내 탐구주제, 흔한가?",
    body: [
      "희망 학과, 학년·학기, 과목, 탐구주제를 적으면 실제 생기부 탐구 기록과 비교해 흔함 지수(0~100)를 알려드려요.",
      "소재·대상·조건·방식 네 가지 기준으로 왜 흔한지 설명하고, 같은 관심사를 살린 상위 1% 탐구주제로 바꾸는 방법을 제안해요.",
      "진로 연결 또는 과목 깊이 파기 중 원하는 방향을 고를 수 있어요. 회원은 하루 3번 무료로 진단할 수 있어요.",
    ],
  },
  {
    path: "/reading",
    title: "독서 흔한가 - 세특 독서·독서활동 흔함 진단 | 생수면",
    desc: "내 세특 독서, 같은 학과 학생들이 다 읽는 책일까? 독서 흔함 지수와 책 수준(초급·중급·고급), 같은 책을 다르게 읽는 법, 수준별 덜 흔한 책을 추천해 드려요.",
    h1: "내 세특 독서, 흔한가?",
    body: [
      "희망 학과, 학년, 과목, 읽은 책을 적으면 이 책이 같은 학과 학생들 사이에서 얼마나 흔한지 독서 흔함 지수로 알려드려요.",
      "책 수준을 초급·중급·고급으로 알려주고, 같은 책을 과목 연결·비판적 읽기·진로 연결로 다르게 읽는 방법을 제안해요.",
      "수준별로 덜 흔한 책을 한 권씩 추천해요. 회원은 일주일에 2권 무료이고, 친구를 초대하면 더 진단할 수 있어요.",
    ],
  },
  {
    path: "/motive",
    title: "지원동기 흔한가 - 대학별 면접 기준 지원동기 진단 | 생수면",
    desc: "고3 대입 지원동기, 면접관이 매년 듣는 말은 아닐까? 137개 대학의 면접 평가요소(인성·전공적합성·학업역량) 기준으로 지원동기를 분석하고 면접관의 첫 질문을 예상해요.",
    h1: "내 지원동기, 흔한가?",
    body: [
      "지원 대학과 학과, 지원동기를 적으면 흔함 지수와 함께 그 대학의 면접 평가요소 비중 기준으로 어떤 요소가 잘 드러나고 어떤 요소가 부족한지 알려드려요.",
      "생수면 대학별 면접 분석 데이터를 바탕으로, 그 대학 면접관이 이 지원동기를 듣고 던질 첫 질문을 예상해요.",
      "회원은 일주일에 2번 무료로 진단할 수 있어요.",
    ],
  },
  {
    path: "/interview",
    title: "면접 예상 질문 - 내 생기부로 대입 면접 예상 질문 | 생수면",
    desc: "내 생기부 활동을 바탕으로 수시 지원 대학 6곳의 면접 평가요소와 질문 스타일에 맞춘 면접 예상 질문을 뽑아 드려요. 대학별로 나눠 PDF로 받을 수 있어요.",
    h1: "내 생기부로 지원 대학 면접 예상 질문 뽑기",
    body: [
      "생기부 정리 가이드대로 3년 활동을 요약해 붙여 넣고, 지원 대학과 학과를 최대 6곳까지 적으면 대학별 면접 예상 질문을 뽑아 드려요.",
      "대학마다 평가요소 비중과 질문 출제 특징이 달라서, 같은 생기부라도 대학별로 다른 질문이 나와요.",
      "뽑은 질문은 지원동기·진로, 전공 관련 탐구, 학업 역량, 인성·공동체처럼 묶어서 보여주고 PDF로 저장할 수 있어요.",
    ],
  },
  {
    path: "/inquiry",
    title: "기억에 남는 탐구보고서 작성 - 세특 탐구보고서 | 생수면",
    desc: "흔하지 않은 탐구주제로 탐구 준비, 자료 찾기, 결과 분석, 보고서 디자인까지. 선생님이 몇 달 뒤에 봐도 기억나는 탐구보고서를 만들어요.",
    h1: "기억에 남는 탐구보고서 작성",
    body: [
      "선생님은 학기 말에 몰아서 세특을 써요. 몇 달 뒤에 봐도 기억나는 보고서가 좋은 세특이 돼요.",
      "탐구 준비(탐구팩), AI 자료 찾기, 결과 분석, 보고서 디자인까지 4단계로 탐구보고서를 완성해요. 첫 탐구는 PDF 저장 전까지 무료예요.",
    ],
  },
];

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const base = readFileSync(join(DIST, "index.html"), "utf8");

function setMeta(html, re, tag) {
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `    ${tag}\n  </head>`);
}

for (const p of PAGES) {
  const url = SITE + (p.path === "/" ? "/" : p.path);
  let html = base;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(p.title)}</title>`);
  html = setMeta(html, /<meta name="description"[^>]*>/, `<meta name="description" content="${esc(p.desc)}" />`);
  html = setMeta(html, /<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}" />`);
  html = setMeta(html, /<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(p.title)}" />`);
  html = setMeta(html, /<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(p.desc)}" />`);
  html = setMeta(html, /<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}" />`);

  // 로봇이 읽을 본문 — React가 뜨면 이 자리를 화면으로 바꾼다
  const links = NAV.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join("");
  const text = p.body.map((b) => `<p>${esc(b)}</p>`).join("");
  const seo = `<div id="root"><main style="max-width:720px;margin:0 auto;padding:40px 20px;font-family:sans-serif;color:#1F2640"><p><a href="/">생수면</a></p><h1>${esc(p.h1)}</h1>${text}<nav><ul>${links}</ul></nav></main></div>`;
  html = html.replace('<div id="root"></div>', seo);

  if (p.path === "/") {
    writeFileSync(join(DIST, "index.html"), html);
  } else {
    const dir = join(DIST, p.path.slice(1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
  }
  console.log(`[seo] ${p.path} → ${p.title}`);
}
