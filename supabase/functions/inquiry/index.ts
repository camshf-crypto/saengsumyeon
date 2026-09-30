// 탐구 준비 — 탐구 방법 추천 + 탐구팩 생성
// 배포: npx supabase functions deploy inquiry --project-ref xhywexuazwipwvzrldwo
//
// 요청 (로그인 필수, Authorization 헤더의 토큰으로 본인 확인)
//   { action: "start", query_id? , topic, focus, department, subject, grade, term }
//                                              → 상위 1% 주제로 탐구 한 건 만들기 + 방법 추천 + 탐구팩
//                                                (이용권이 없으면 '결제 대기'로 주제만 저장하고 402 + inquiry)
//                                                (결제 대기 탐구를 query_id로 다시 부르면 그때 탐구팩을 만든다)
//   { action: "use_free", inquiry_id }        → 이 탐구에 무료 체험 1건 쓰기 (AI 자료 찾기~보고서 디자인 무료)
//   { action: "pack", inquiry_id, method }     → 방법을 바꿔 탐구팩 다시 만들기
//   { action: "research", inquiry_id }         → 웹 검색으로 실제 자료 찾기 (문헌·사례·데이터, 탐구당 2번)
//   { action: "fill", inquiry_id, cols? }      → AI가 찾은 자료 페이지를 읽고 비교표 채우기 (탐구당 2번)
//   { action: "fill_one", inquiry_id, index, text } → 막힌 자료를 학생이 붙여넣은 본문으로 채우기
//   { action: "analyze", inquiry_id, data }    → 학생이 입력한 결과를 AI가 분석 (탐구당 5번까지)
//   { action: "report", inquiry_id }           → 보고서 칸별 내용 만들기 (탐구당 3번)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5";
const DAILY_START_LIMIT = 3; // 하루에 새 탐구 3건까지 (탐구팩 생성 비용 관리)
const METHODS = ["lit", "case", "data", "survey", "exp", "obs"] as const;
type Method = (typeof METHODS)[number];

const METHOD_NAME: Record<Method, string> = {
  lit: "문헌 탐구", case: "사례 탐구", data: "데이터 탐구",
  survey: "설문조사 탐구", exp: "실험 탐구", obs: "관찰 탐구",
};

/* 방법별 탐구팩 모양 — AI는 이 JSON만 채운다 */
const PACK_SHAPE: Record<Method, string> = {
  lit: `"sources":[{"kind":"논문|기사|도서|공식자료","what":"무엇을 확인할 자료인지","keywords":["검색어"]}],"where":["찾아볼 곳(학교 도서관, 국가 공식 통계 사이트 같은 종류만)"],"criteria":["자료를 비교할 기준"],"record":["자료마다 적어둘 것"]`,
  case: `"cases":[{"name":"사례 이름(실제 브랜드는 A·B·C로)","why":"고른 이유"}],"criteria":["비교 기준"],"record":["사례마다 기록할 것"],"photo":["찍어두면 좋은 장면"]`,
  data: `"datasets":[{"what":"필요한 데이터","where":"찾을 곳의 종류(예: 공공데이터 포털)","keywords":["검색어"]}],"variables":{"x":"비교할 기준","y":"확인할 값"},"analysis":["분석 순서"]`,
  survey: `"target":"조사 대상과 인원","questions":[{"type":"객관식|상황 선택|주관식","text":"문항","options":["보기"]}],"intro":"설문 첫머리 안내문(개인정보를 묻지 않는다는 내용 포함)","distribute":["배포 방법 단계"],"sample":"권장 응답 수"`,
  exp: `"hypothesis":"가설","variables":{"change":"바꾸는 것","measure":"재는 것","control":["같게 둘 것"]},"materials":["준비물"],"procedure":["실험 순서"],"record_table":{"rows":["조건"],"cols":["1회","2회","3회","평균"],"unit":"단위"},"repeats":"반복 횟수","safety":["안전 주의"]`,
  obs: `"target":"관찰 대상","period":"관찰 기간","criteria":[{"level":"단계 이름","desc":"판단 기준"}],"record_table":{"rows":["날짜 또는 회차"],"cols":["기록할 항목"]},"checklist":["매번 확인할 것"]`,
};

const SYSTEM = `고등학생 탐구를 준비시키는 도우미다. 학생이 실제로 해야 할 일 직전까지 모든 준비를 대신 만든다. JSON만 출력.

원칙:
- 결과를 지어내지 않는다. 설문 응답·실험 수치·자료 결론처럼 학생이 앞으로 얻을 결과는 절대 쓰지 않는다
- 실제로 있는지 확인할 수 없는 논문·기사·책 제목, 기관 이름, 통계 수치를 만들지 않는다. 자료는 '어떤 종류를 어떤 검색어로 찾을지'로만 쓴다
- 학교에서 할 수 있는 안전한 방법만 쓴다. 위험한 약품·불·전기 사용은 선생님 지도 아래로 안내하고, 사람을 대상으로 한 실험은 하지 않는다
- 설문은 이름·학교·연락처 같은 개인정보를 묻지 않고, 민감한 질문(건강·가정사 등)은 넣지 않는다
- 학년 수준에 맞춘다. 고1은 가볍게, 고3은 분석까지
- 쉬운 말로 쓴다. 전문용어는 학생 주제에 이미 있는 것만 쓴다
- 문장은 짧게. 목록 항목은 한 줄
- 비교 기준(criteria)은 3~4개, 한 기준은 10자 안팎의 짧은 말로 쓴다`;

async function ask(system: string, user: string, maxTokens = 12000) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: maxTokens,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("openai error", res.status, body.slice(0, 800));
    return null;
  }
  try {
    const raw = JSON.parse(body).choices?.[0]?.message?.content ?? "";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("parse failed", e);
    return null;
  }
}

function brief(inq: any) {
  return [
    `희망학과: ${inq.department}`,
    `학년: ${inq.grade ?? ""} ${inq.term ?? ""}`.trim(),
    `과목: ${inq.subject}`,
    `탐구 주제: ${inq.suggestion}`,
    inq.topic && inq.topic !== inq.suggestion ? `(처음 쓴 주제: ${inq.topic})` : "",
  ].filter(Boolean).join("\n");
}

/*
 * 웹 검색으로 실제 자료 찾기 — 3단계로 품질을 올린다
 *  ① 검색: 주제를 쪼갠 검색어 4~6개로 여러 번 검색해 후보 8~10개 (OpenAI Responses API의 web_search 도구)
 *     모델이 실제로 열어 본 링크만 남긴다 → 없는 자료를 지어낼 수 없다
 *  ② 본문 읽기: 서버가 후보 페이지를 직접 열어 앞부분을 읽는다 (막힌 곳은 '직접 확인 필요')
 *  ③ 점수 매기기: 좋은 예시 기준 4가지로 점수를 매겨 낮은 건 빼고, 요약을 본문에 맞게 고친다
 *     실험·설문·관찰: 같은 대상·변인인지 / 과정이 적혀 있는지 / 기록·결과가 있는지 / 고등학생이 따라 할 수 있는지
 *     문헌·사례·데이터: 주제와 직접 관련 / 믿을 만한 출처 / 구체적 근거(수치·기준) / 읽을 수 있는 수준
 */
async function searchSources(inq: any) {
  const kind = {
    lit: "논문·기사·도서·공식자료",
    case: "실제 사례를 다룬 기사·보고서·공식 발표",
    data: "공공데이터·공식 통계 페이지",
    exp: "같은 주제나 비슷한 조건으로 실제로 해 본 실험 — 학생 탐구 보고서, 과학 교육 자료(사이언스올·에듀넷 등), 실험 과정을 적은 블로그 글, 관련 논문",
    survey: "비슷한 주제로 실제로 한 설문조사 — 설문 결과 보고서, 기사, 학생이 설문한 과정을 적은 블로그 글, 관련 공식 통계",
    obs: "비슷한 대상을 실제로 관찰한 기록 — 관찰 보고서, 학생 탐구 보고서, 관찰 일지를 적은 블로그 글, 과학 교육 자료",
  }[inq.method as string] ?? "논문·기사·도서·공식자료";
  const similar = ["exp", "survey", "obs"].includes(inq.method);
  const packBrief = JSON.stringify(inq.pack?.pack ?? {}).slice(0, 1200);

  // ① 검색 — 검색어를 먼저 쪼개고 여러 번 찾는다
  const prompt = `고등학생 탐구에 쓸 실제 자료를 웹에서 찾아라.
탐구 주제: ${inq.suggestion}
탐구팩(대상·변인·기준): ${packBrief}
찾을 자료: ${kind}${similar ? "\n이 자료는 학생이 직접 할 탐구를 설계·비교할 때 참고용이다. 학생의 결과를 대신하지 않는다." : ""}
방법:
1) 주제를 쪼개 검색어 4~6개를 만든다. 대상 이름, 바꾸는 조건, 재는 값, '관찰 일지·실험 보고서·탐구 보고서·설문 결과' 같은 말을 섞는다
2) 검색어마다 따로 검색해 후보를 모은다
조건:
- 반드시 웹 검색으로 실제로 열어 확인한 자료만. 기억으로 제목을 만들지 않는다
- 한국어 자료를 우선(국내 논문 사이트, 정부·공공기관, 신문사, 교육 자료, 블로그). 필요하면 영어 자료 1~2개
- ${similar ? "과정(방법·기간·도구)과 기록(숫자·사진·표)이 적힌 자료를 우선" : "주제와 직접 관련 있고 구체적 근거(수치·기준)가 있는 자료를 우선"}
- 후보 8~10개
- 요약은 그 자료에 실제로 쓰인 내용만, 쉬운 말 두 문장
마지막에 아래 JSON만 출력:
{"sources":[{"title":"자료 제목","url":"https://...","publisher":"발행처","kind":"논문|기사|도서|공식자료|데이터|보고서|블로그","summary":"두 문장 요약"}]}`;

  const call = (tool: string) =>
    fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: "low" },
        tools: [{ type: tool }],
        include: ["web_search_call.action.sources"], // 검색하며 실제로 본 페이지 목록도 받는다
        input: prompt,
        max_output_tokens: 10000,
      }),
    });

  let res = await call("web_search");
  if (res.status === 400) res = await call("web_search_preview"); // 계정에 따라 도구 이름이 다를 수 있다
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    console.error("search failed", res.status, JSON.stringify(body).slice(0, 800));
    return null;
  }

  // 답변 글 + 실제로 본 링크 모으기 (인용 각주 + 검색 도구가 연 페이지)
  const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  let text = "";
  const seen = new Set<string>();
  for (const item of body.output ?? []) {
    if (item.type === "web_search_call") {
      for (const src of item.action?.sources ?? []) if (src?.url) seen.add(norm(src.url));
    }
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text") continue;
      text += c.text ?? "";
      for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) seen.add(norm(a.url));
    }
  }

  let parsed: any = null;
  try {
    const m = text.match(/\{[\s\S]*"sources"[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.error("parse failed", e, text.slice(0, 500));
  }
  // 같은 주소는 하나만
  const uniq = new Map<string, any>();
  for (const x of parsed?.sources ?? []) {
    if (x?.url && x?.title && /^https?:\/\//.test(x.url) && !uniq.has(norm(x.url))) uniq.set(norm(x.url), x);
  }
  const list = [...uniq.values()].slice(0, 10);

  // 링크가 실제로 열리는지 서버가 직접 확인 (5초 안에 응답이 오면 인정)
  async function alive(url: string) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, { method: "GET", redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
      clearTimeout(t);
      return r.status < 400;
    } catch {
      return false;
    }
  }
  const checked = await Promise.all(
    list.map(async (x: any) => {
      const u = norm(x.url);
      const inSearch = [...seen].some((c) => c === u || c.startsWith(u) || u.startsWith(c));
      if (inSearch) return x;
      return (await alive(x.url)) ? x : null;
    })
  );
  const verified = checked.filter(Boolean) as any[];
  if (!verified.length) return { list: [], why: String(parsed?.why ?? "") };

  // ② 본문 읽기 (동시에) — 요약이 맞는지, 과정·기록이 있는지 보려고
  const pages = await Promise.all(verified.map((x) => pageText(x.url)));

  // ③ 점수 매기기 + 요약 고치기 + 고른 이유
  const crit = similar
    ? `same: 내 탐구와 같은 대상이나 같은 변인인가 (0~3)
process: 방법·기간·도구 같은 과정이 적혀 있는가 (0~3)
record: 숫자·사진·표 같은 기록이나 결과가 있는가 (0~3)
level: 고등학생이 학교에서 따라 할 수 있는 수준인가 (0~3)`
    : `same: 탐구 주제와 직접 관련 있는가 (0~3)
process: 공공기관·학술지·언론처럼 믿을 만한 출처인가 (0~3)
record: 비교에 쓸 구체적 근거(수치·기준·사례)가 있는가 (0~3)
level: 고등학생이 읽고 이해할 수 있는가 (0~3)`;
  const judged = await ask(
    `고등학생 탐구에 쓸 자료 후보를 평가한다. JSON만 출력.
- [본문]이 있으면 본문 기준으로만 판단하고, 요약도 본문에 실제로 쓰인 내용으로 고친다. 본문이 없으면 제목·요약만으로 보수적으로 판단한다
- 과장하지 않는다. 모르면 낮게 준다
- 쉬운 말, 짧은 문장`,
    `탐구 주제: ${inq.suggestion}
탐구팩: ${packBrief}
평가 기준:
${crit}

${verified
  .map(
    (x, i) =>
      `[후보 ${i + 1}] ${x.title} (${x.publisher ?? ""})\n[요약] ${x.summary ?? ""}\n[본문] ${pages[i]?.ok ? String(pages[i].text).slice(0, 2500) : "(읽지 못함)"}`
  )
  .join("\n\n")}

{"why":"이 자료들을 고른 이유를 학생에게 설명하는 쉬운 말 두 문장",
"items":[{"i":1,"same":0,"process":0,"record":0,"level":0,
"match":"${similar ? "내 탐구와 비슷한 점 한 줄 (예: 같은 강낭콩 · 매일 각도 기록)" : "이 자료를 고른 이유 한 줄"}",
"use":"${similar ? "내 탐구에서 참고할 점 한 줄" : "이 탐구에서 어떻게 쓸지 한 줄"}",
"summary":"본문 기준 두 문장 요약 (본문이 없으면 원래 요약)",
"body_ok":true}]}`,
    6000
  );

  const scored = verified.map((x, i) => {
    const j = (judged?.items ?? []).find((y: any) => Number(y.i) === i + 1) ?? {};
    const n = (v: any) => Math.max(0, Math.min(3, Number(v) || 0));
    const score = n(j.same) + n(j.process) + n(j.record) + n(j.level);
    const bodyRead = Boolean(pages[i]?.ok);
    return {
      title: x.title,
      url: x.url,
      publisher: x.publisher ?? "",
      kind: x.kind ?? "",
      summary: bodyRead && j.summary ? String(j.summary) : x.summary ?? "",
      use: j.use ?? "",
      match: j.match ?? "",
      score,
      checked: bodyRead && j.body_ok !== false ? "body" : "link", // body = 서버가 본문을 읽고 요약을 맞춤
      opened: false,
    };
  });

  // 점수 순, 6점(12점 만점) 넘는 것만. 너무 적으면 위에서 3개는 남긴다
  scored.sort((a, b) => b.score - a.score);
  let good = scored.filter((x) => x.score >= 6);
  if (good.length < 3) good = scored.slice(0, 3);
  console.log("research", { found: list.length, verified: verified.length, read: pages.filter((p) => p?.ok).length, kept: good.length });
  return { list: good.slice(0, 5), why: String(judged?.why ?? "").slice(0, 300) };
}

/* 자료 페이지 글 가져오기 — HTML만, 태그를 걷어내고 앞부분 6천 자 */
async function pageText(url: string) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);
    if (!r.ok) return { ok: false, why: "접속이 막혀 있어요" };
    const type = r.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return { ok: false, why: "PDF·파일이라 직접 열어 확인해야 해요" };
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 200) return { ok: false, why: "본문을 읽지 못했어요" };
    return { ok: true, text: text.slice(0, 6000) };
  } catch {
    return { ok: false, why: "접속이 막혀 있어요" };
  }
}

/*
 * 서버가 못 들어간 페이지를 AI 웹 검색 도구로 다시 읽기
 * 검색 도구가 그 주소(같은 사이트)를 실제로 열어본 경우에만 인정한다
 */
async function readViaSearch(x: any, cols: string[]) {
  const host = (() => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const prompt = `다음 자료를 웹에서 직접 열어 읽고, 비교 기준별로 자료에 실제로 쓰인 내용만 정리하라.
자료: ${x.title}
주소: ${x.url}
비교 기준: ${cols.map((c, i) => `${i + 1}) ${c}`).join(" / ")}
본문에 없으면 "자료에 없음". 칸마다 근거 문장을 30자 안팎으로 그대로 옮긴다. 추측 금지.
마지막에 JSON만: {"cells":["..."],"evidence":["..."]}`;
  const call = (tool: string) =>
    fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify({ model: MODEL, reasoning: { effort: "low" }, tools: [{ type: tool }], include: ["web_search_call.action.sources"], input: prompt, max_output_tokens: 4000 }),
    });
  try {
    let res = await call("web_search");
    if (res.status === 400) res = await call("web_search_preview");
    const body = await res.json();
    if (!res.ok) return null;
    let text = "";
    let opened = false;
    for (const item of body.output ?? []) {
      if (item.type === "web_search_call") {
        for (const src of item.action?.sources ?? []) if (host && String(src?.url ?? "").includes(host)) opened = true;
      }
      if (item.type !== "message") continue;
      for (const c of item.content ?? []) {
        if (c.type !== "output_text") continue;
        text += c.text ?? "";
        for (const a of c.annotations ?? []) if (host && String(a?.url ?? "").includes(host)) opened = true;
      }
    }
    if (!opened) return null; // 그 사이트를 실제로 열지 못했으면 버린다
    const m = text.match(/\{[\s\S]*"cells"[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : null;
    return j?.cells?.length ? j : null;
  } catch (e) {
    console.error("readViaSearch failed", e);
    return null;
  }
}

/* 결제 막기 — 유료 기능은 결제된(이용권으로 연) 탐구만. 관리자는 통과 */
const PAYWALL = { error: "이용권이 필요해요. 결제하면 바로 열려요.", paywall: true };

/* 방법 추천 + 그 방법의 탐구팩 */
async function recommendAndPack(inq: any) {
  const shapes = METHODS.map((m) => `- ${m}(${METHOD_NAME[m]})`).join("\n");
  return ask(
    SYSTEM,
    `${brief(inq)}

1) 이 주제에 가장 잘 맞는 탐구 방법 하나를 고른다:
${shapes}
2) 고른 방법으로 탐구팩을 만든다.

{"method":"lit|case|data|survey|exp|obs","reason":"그 방법이 맞는 이유 한 문장","purpose":"탐구 목적 한 문장","do":"학생이 직접 할 일 한 문장","memo_points":["탐구하면서 메모해 둘 것 2~3개"],"pack":{방법에 맞는 모양}}

방법별 pack 모양:
${METHODS.map((m) => `${m}: {${PACK_SHAPE[m]}}`).join("\n")}`
  );
}

/* 정해진 방법으로 탐구팩만 */
async function packFor(inq: any, method: Method) {
  return ask(
    SYSTEM,
    `${brief(inq)}
탐구 방법: ${METHOD_NAME[method]}

{"method":"${method}","reason":"이 방법으로 할 때의 장점 한 문장","purpose":"탐구 목적 한 문장","do":"학생이 직접 할 일 한 문장","memo_points":["탐구하면서 메모해 둘 것 2~3개"],"pack":{${PACK_SHAPE[method]}}}`
  );
}

/* 선배 비교 — 진단 때 찾아둔 같은 학과 유사 기록을 그대로 쓴다 (새로 지어내지 않음) */
function seniorsOf(q: any) {
  const r = q?.result ?? {};
  return { count: Number(r.similar_count ?? 0), examples: (r.similar ?? []).slice(0, 3) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 본인 확인 — 요청에 담긴 로그인 토큰으로
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "로그인이 필요합니다." }, 401);

    // 정식 오픈 — 회원이면 누구나. 관리자는 결제·횟수 제한 없이 통과
    const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const admin_ok = Boolean(isAdmin);

    // 쓸 수 있는 탐구인지 — 결제된 탐구, 관리자, 또는 무료 체험 탐구
    // 무료 체험 = 학생이 2단계에서 "무료 체험 1건을 사용할게요"를 누른 탐구 1건 (free_trial)
    //           → AI 자료 찾기부터 보고서 디자인까지 무료 (PDF 저장만 이용권, 화면에서 막음)
    async function usable(inq: any) {
      return Boolean(inq.paid || admin_ok || (inq.free_trial && inq.pack));
    }
    // 이 학생이 무료 체험을 이미 다른 탐구에 썼는지
    async function trialUsedElsewhere(inqId: string | null) {
      let q = admin.from("inquiries").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("free_trial", true);
      if (inqId) q = q.neq("id", inqId);
      const { count } = await q;
      return (count ?? 0) >= 1;
    }

    const body = await req.json();

    // ── 새 탐구 시작
    if (body.action === "start") {
      const topic = String(body.topic ?? "");
      let focus = body.focus === "subject" ? "subject" : "career";
      const cols = "id, department, grade, term, subject, topic, focus, result";
      let q: any = null;

      // 내 기록에서 시작하면 진단 기록 번호로 바로 찾는다 (본인 기록만)
      if (body.query_id) {
        const { data } = await admin
          .from("topic_queries").select(cols).eq("id", body.query_id).eq("user_id", user.id).maybeSingle();
        q = data;
        if (q?.focus) focus = q.focus === "subject" ? "subject" : "career";
      }

      if (!q && !topic) return json({ error: "주제가 없습니다." }, 400);

      // 이 학생이 진단한 기록 중 같은 주제·방향의 가장 최근 것
      if (!q) {
        const { data } = await admin
          .from("topic_queries")
          .select(cols)
          .eq("user_id", user.id)
          .eq("topic", topic)
          .eq("focus", focus)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        q = data;
      }

      // 같은 주제를 다른 학생이 먼저 진단해서 저장된 결과를 재사용한 경우 — 그 기록을 쓰고 학년·학기는 이 학생 것으로
      if (!q && body.department && body.subject) {
        const { data: shared } = await admin
          .from("topic_queries")
          .select(cols)
          .eq("department", body.department)
          .eq("subject", body.subject)
          .eq("topic", topic)
          .eq("focus", focus)
          .not("result", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (shared) q = { ...shared, grade: body.grade ?? shared.grade, term: body.term ?? shared.term };
      }
      if (!q?.result?.suggestion?.topic) return json({ error: "진단 기록을 찾지 못했어요. 다시 진단해 주세요." }, 404);

      // 같은 진단으로 이미 만든 탐구 — 탐구팩까지 있으면 그대로 돌려준다 (AI 다시 부르지 않음)
      // 탐구팩이 없으면 '결제 대기'로 저장만 해 둔 탐구 → 아래에서 결제 확인 후 탐구팩을 만든다
      const { data: existing } = await admin
        .from("inquiries").select("*").eq("user_id", user.id).eq("query_id", q.id).maybeSingle();
      if (existing?.pack) return json({ inquiry: existing, reused: true });

      const base = {
        user_id: user.id, query_id: q.id,
        department: q.department, grade: q.grade, term: q.term, subject: q.subject, focus,
        topic: q.topic, suggestion: q.result.suggestion.topic,
      };

      // 무료 체험을 아직 안 쓴 학생은 탐구팩까지 자유롭게 만들어 볼 수 있다 (하루 3건 제한은 아래에서)
      // 무료 체험을 이미 쓴 학생은 새 탐구를 이용권 1개로 시작한다
      let payNow = false;
      if (!admin_ok && !existing?.paid && (await trialUsedElsewhere(existing?.id ?? null))) {
        const { data: cr } = await admin.from("credits").select("balance").eq("user_id", user.id).maybeSingle();
        if (!(cr?.balance > 0)) {
          // 이용권이 없으면 고른 주제를 '결제 대기'로 저장만 해 둔다 (AI는 부르지 않음 → 비용 없음)
          // 목록 '내 탐구'에 남고, 입금 승인 뒤 이 탐구를 열면 그때 탐구팩을 만든다
          let pending = existing;
          if (!pending) {
            const { data: row, error } = await admin
              .from("inquiries").insert({ ...base, stage: "prepare", paid: false }).select("*").single();
            if (error) console.error("pending insert failed", error);
            pending = row;
          }
          return json(
            { ...PAYWALL, error: "무료 탐구 1건을 다 썼어요. 주제는 저장해 두었어요. 이용권으로 열면 탐구팩을 만들어 드려요.", inquiry: pending ?? null },
            402
          );
        }
        payNow = true;
      }

      // 하루 생성 한도 (탐구팩까지 만든 것만 센다)
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await admin
        .from("inquiries").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).not("pack", "is", null).gte("created_at", since);
      if ((count ?? 0) >= DAILY_START_LIMIT) return json({ error: "오늘은 새 탐구를 3개까지 만들 수 있어요.", limit: true }, 429);

      const ai = await recommendAndPack(base);
      if (!ai?.pack || !METHODS.includes(ai.method)) return json({ error: "탐구팩을 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);

      // 결제 대기로 저장돼 있던 탐구면 그 줄을 채우고, 없으면 새로 만든다
      const filled = {
        method: ai.method,
        stage: "prepare",
        pack: { ...ai, recommended: ai.method, seniors: seniorsOf(q) },
      };
      const { data: inq, error } = existing
        ? await admin.from("inquiries").update(filled).eq("id", existing.id).select("*").single()
        : await admin.from("inquiries").insert({ ...base, ...filled }).select("*").single();
      if (error) {
        console.error("save failed", error);
        return json({ error: "저장에 실패했어요." }, 500);
      }
      // 두 번째 탐구부터는 만들자마자 이용권 1개로 연다 (입금 승인으로 이미 열린 탐구는 차감 안 함)
      if (payNow) {
        const { data: cr } = await admin.from("credits").select("balance").eq("user_id", user.id).single();
        const { data: lastOrder } = await admin
          .from("pay_orders").select("id").eq("user_id", user.id).neq("status", "rejected")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        await admin.from("credits").update({ balance: Math.max(0, (cr?.balance ?? 1) - 1), updated_at: new Date().toISOString() }).eq("user_id", user.id);
        await admin.from("inquiries").update({ paid: true, order_id: lastOrder?.id ?? null }).eq("id", inq.id);
        inq.paid = true;
      }

      await admin.from("referral_events").insert({ type: "inquiry_start", user_id: user.id, code: ai.method });
      return json({ inquiry: inq });
    }

    // ── 무료 체험 쓰기 — 2단계에서 "무료 체험 1건을 사용할게요"를 누르면 이 탐구를 무료 체험으로 연다
    if (body.action === "use_free") {
      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq?.pack) return json({ error: "탐구를 찾지 못했어요." }, 404);
      if (inq.paid || inq.free_trial || admin_ok) return json({ inquiry: inq, reused: true });
      if (await trialUsedElsewhere(inq.id)) return json({ ...PAYWALL, error: "무료 체험 1건은 이미 다른 탐구에 썼어요." }, 402);
      const { data: updated, error } = await admin
        .from("inquiries").update({ free_trial: true }).eq("id", inq.id).select("*").single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      await admin.from("referral_events").insert({ type: "free_trial_use", user_id: user.id, code: inq.method });
      return json({ inquiry: updated });
    }

    // ── 방법 바꿔 탐구팩 다시 만들기
    if (body.action === "pack") {
      const method = body.method as Method;
      if (!METHODS.includes(method)) return json({ error: "탐구 방법이 올바르지 않아요." }, 400);

      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq) return json({ error: "탐구를 찾지 못했어요." }, 404);
      if (!inq.pack) return json({ ...PAYWALL, error: "이용권으로 연 뒤에 탐구팩을 만들 수 있어요." }, 402);
      if (inq.method === method && inq.pack) return json({ inquiry: inq, reused: true });

      // 방법마다 한 번 만든 탐구팩은 보관해 두고 다시 쓴다
      const saved = inq.pack?.by_method?.[method];
      const ai = saved ?? (await packFor(inq, method));
      if (!ai?.pack) return json({ error: "탐구팩을 만들지 못했어요." }, 502);

      // 지금 탐구팩도 보관 (보관본 안에 보관본이 겹겹이 쌓이지 않게 by_method는 빼고)
      const { by_method: _old, ...current } = inq.pack ?? {};
      const { by_method: _ai, ...fresh } = ai;
      const byMethod = { ...(inq.pack?.by_method ?? {}), [inq.method]: current, [method]: fresh };
      const { data: updated, error } = await admin
        .from("inquiries")
        .update({
          method,
          pack: { ...fresh, recommended: inq.pack?.recommended, seniors: inq.pack?.seniors, by_method: byMethod },
        })
        .eq("id", inq.id)
        .select("*")
        .single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      return json({ inquiry: updated });
    }

    // ── 자료 찾기 (2단계 '내가 직접 찾기 / AI가 찾아주기' 중 AI) — 모든 방법, 탐구당 2번
    //    문헌·사례·데이터: 비교할 자료 / 실험·설문·관찰: 비슷하게 해 본 실험·설문·관찰 (보고서·블로그 글 등)
    if (body.action === "research") {
      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq) return json({ error: "탐구를 찾지 못했어요." }, 404);
      if (!(await usable(inq))) return json(PAYWALL, 402);

      const used = Number(inq.sources?.count ?? 0);
      if (used >= 2) return json({ error: "이 탐구는 AI 자료 찾기를 2번까지 쓸 수 있어요.", limit: true }, 429);

      const found = await searchSources(inq);
      if (!found?.list?.length) return json({ error: "확인된 자료를 찾지 못했어요. 잠시 후 다시 시도하거나 직접 찾아 주세요." }, 502);

      const { data: updated, error } = await admin
        .from("inquiries")
        // 내가 추가한 자료는 그대로 두고, AI가 찾은 자료만 새로
        .update({
          sources: {
            list: [...(inq.sources?.list ?? []).filter((x: any) => x.added_by === "me"), ...found.list],
            why: found.why, // AI가 이 자료들을 고른 이유 (2단계 오른쪽에 보여준다)
            count: used + 1,
            found_at: new Date().toISOString(),
          },
        })
        .eq("id", inq.id)
        .select("*")
        .single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      return json({ inquiry: updated });
    }

    // ── AI가 자료를 읽고 비교표 채우기 (3단계 'AI가 해주기' — 문헌·사례·데이터, 탐구당 2번)
    if (body.action === "fill") {
      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq) return json({ error: "탐구를 찾지 못했어요." }, 404);
      // 학생이 '보고서에 쓰기'로 고른 자료만 읽는다
      if (!(await usable(inq))) return json(PAYWALL, 402);
      const list = (inq.sources?.list ?? []).filter((x: any) => x.selected && x.url).slice(0, 6);
      if (!list.length) return json({ error: "보고서에 쓸 자료를 2단계에서 먼저 골라 주세요." }, 400);

      const used = Number(inq.results?.fill_count ?? 0);
      if (used >= 2) return json({ error: "AI 자료 읽기는 탐구당 2번까지예요.", limit: true }, 429);

      const cols: string[] = (body.cols?.length ? body.cols : inq.pack?.pack?.criteria ?? []).slice(0, 5);
      if (!cols.length) return json({ error: "비교 기준이 없어요." }, 400);

      // 자료마다 페이지 글 가져오기 (동시에)
      const pages = await Promise.all(list.map((x: any) => pageText(x.url)));
      const readable = list.map((x: any, i: number) => ({ ...x, page: pages[i] }));

      const ai = await ask(
        `고등학생 탐구의 자료 비교표를 채운다. JSON만 출력.
원칙:
- 각 자료의 [본문]에 실제로 쓰인 내용만 쓴다. 본문에 없으면 그 칸은 "자료에 없음"
- 칸마다 근거가 된 본문 문장을 30자 안팎으로 그대로 옮겨 evidence에 넣는다
- 숫자는 본문에 있는 그대로. 계산하거나 추측하지 않는다
- 쉬운 말, 한 칸은 25자 안팎`,
        `탐구 주제: ${inq.suggestion}
비교 기준: ${cols.map((c, i) => `${i + 1}) ${c}`).join(" / ")}

${readable
  .map((x: any, i: number) => `[자료 ${i + 1}] ${x.title} (${x.publisher ?? ""})\n[본문] ${x.page.ok ? x.page.text : "(읽지 못함)"}`)
  .join("\n\n")}

{"rows":[{"source":1,"cells":["기준1 내용", "..."],"evidence":["기준1 근거 문장", "..."]}]}`,
        8000
      );
      if (!ai?.rows) return json({ error: "자료를 읽고 정리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);

      // 서버가 못 들어간 자료는 AI 웹 검색 도구로 다시 읽기 (동시에)
      // 비용 관리: 다시 읽기는 막힌 자료 중 앞의 3개까지만
      let retryLeft = 3;
      const retried = await Promise.all(
        readable.map((x: any) => (x.page.ok || retryLeft-- <= 0 ? null : readViaSearch(x, cols)))
      );

      // 결과 입력표(문헌·사례 카드)와 같은 모양으로 저장
      const rowsOut = readable.map((x: any, i: number) => {
        const again = retried[i];
        if (again) {
          return {
            title: x.title,
            url: x.url,
            cells: cols.map((_, j) => again.cells?.[j] ?? "자료에 없음"),
            evidence: cols.map((_, j) => again.evidence?.[j] ?? ""),
            blocked: false,
          };
        }
        const r = ai.rows.find((y: any) => Number(y.source) === i + 1);
        const unreadable = !x.page.ok;
        return {
          title: x.title,
          url: x.url,
          cells: cols.map((_, j) => (unreadable ? `직접 확인 필요 (${x.page.why})` : r?.cells?.[j] ?? "자료에 없음")),
          evidence: cols.map((_, j) => (unreadable ? "" : r?.evidence?.[j] ?? "")),
          blocked: unreadable,
        };
      });
      const data = {
        kind: "text",
        rows: rowsOut.map((r: any) => r.title),
        cols,
        cells: rowsOut.map((r: any) => r.cells),
        evidence: rowsOut.map((r: any) => r.evidence),
        urls: rowsOut.map((r: any) => r.url),
        blocked: rowsOut.map((r: any) => r.blocked),
        filled_by: "ai",
      };
      const results = { ...(inq.results ?? {}), data, fill_count: used + 1 };
      const { data: updated, error } = await admin
        .from("inquiries").update({ results }).eq("id", inq.id).select("*").single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      return json({ inquiry: updated });
    }

    // ── 막힌 자료 하나를 학생이 붙여넣은 본문으로 채우기 (횟수 제한 없음 · 짧은 요청)
    if (body.action === "fill_one") {
      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq?.results?.data) return json({ error: "비교표를 찾지 못했어요." }, 404);
      if (!(await usable(inq))) return json(PAYWALL, 402);
      const d = inq.results.data;
      const i = Number(body.index);
      const text = String(body.text ?? "").slice(0, 8000);
      if (!(i >= 0 && i < d.rows.length) || text.length < 100) return json({ error: "본문을 100자 이상 붙여넣어 주세요." }, 400);

      const ai = await ask(
        `학생이 붙여넣은 자료 본문을 읽고 비교 기준별로 정리한다. JSON만 출력.
본문에 실제로 쓰인 내용만. 없으면 "자료에 없음". 칸마다 근거 문장을 30자 안팎으로 그대로 옮긴다. 추측 금지.`,
        `자료: ${d.rows[i]}
비교 기준: ${d.cols.map((c: string, k: number) => `${k + 1}) ${c}`).join(" / ")}
[본문] ${text}

{"cells":["..."],"evidence":["..."]}`,
        3000
      );
      if (!ai?.cells) return json({ error: "본문을 읽지 못했어요. 다시 시도해 주세요." }, 502);

      const next = {
        ...d,
        cells: d.cells.map((r: string[], k: number) => (k === i ? d.cols.map((_: string, j: number) => ai.cells[j] ?? "자료에 없음") : r)),
        evidence: (d.evidence ?? d.rows.map(() => [])).map((r: string[], k: number) => (k === i ? d.cols.map((_: string, j: number) => ai.evidence?.[j] ?? "") : r)),
        blocked: (d.blocked ?? d.rows.map(() => false)).map((b: boolean, k: number) => (k === i ? false : b)),
      };
      const { data: updated, error } = await admin
        .from("inquiries").update({ results: { ...inq.results, data: next } }).eq("id", inq.id).select("*").single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      return json({ inquiry: updated });
    }

    // ── 보고서 내용 만들기 (4단계) — 칸별 내용. 디자인과 분리해서 저장한다
    if (body.action === "report") {
      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq) return json({ error: "탐구를 찾지 못했어요." }, 404);
      if (!(await usable(inq))) return json(PAYWALL, 402);
      const r = inq.results ?? {};
      if (!r.memory?.l1) return json({ error: "3단계에서 기억 문장을 먼저 정해 주세요." }, 400);

      const used = Number(inq.report?.gen_count ?? 0);
      if (used >= 3) return json({ error: "보고서 내용 만들기는 탐구당 3번까지예요.", limit: true }, 429);

      const refs = (inq.sources?.list ?? []).filter((x: any) => x.selected).map((x: any) => ({ title: x.title, url: x.url ?? "", publisher: x.publisher ?? "" }));
      const mine = r.answers?.mine || [r.answers?.notable, r.answers?.why].filter(Boolean).join(" ");

      const ai = await ask(
        `고등학생 탐구 보고서의 칸을 채운다. JSON만 출력.
원칙:
- 결과·수치·자료 내용은 아래 [탐구 기록]에 있는 것만. 없는 결과·자료·통계를 만들지 않는다
- 학생 목소리 칸(탐구 계기, 어려웠던 점, 진로 연결)은 학생 기록이 있으면 그 말을 살려 다듬고, 없으면 비워 두고 guide(무엇을 쓸지)와 starter(시작 문장 예시)만 준다
- 교과 개념 설명은 고등학교 교과서 수준의 일반 지식만, 짧게
- 쉬운 말, 짧은 문장. 보고서 문체(~했다, ~이다)
- 제목 후보는 기억에 남게 (질문형·숫자형·반전형), 20자 안팎`,
        `[탐구 기록]
희망학과 ${inq.department} · ${inq.grade} · 과목 ${inq.subject}
탐구 주제: ${inq.suggestion}
탐구 방법: ${METHOD_NAME[inq.method as Method]}
탐구 목적: ${inq.pack?.purpose ?? ""}
${inq.pack?.pack?.hypothesis ? `가설: ${inq.pack.pack.hypothesis}` : ""}
탐구팩 요약: ${JSON.stringify(inq.pack?.pack ?? {}).slice(0, 1500)}
결과 데이터: ${JSON.stringify(r.data ?? {}).slice(0, 3000)}
AI 분석: ${JSON.stringify(r.ai ?? {}).slice(0, 1200)}
기억 문장: ${r.memory.l1} ${r.memory.l2}
학생 생각: ${mine || "(없음)"}
학생 메모(처음 생각과 달랐던 점): ${String(inq.memo ?? "").slice(0, 800) || "(없음)"}
참고 자료: ${refs.map((x: any) => x.title).join(" / ") || "(없음)"}

{"titles":["제목 후보 3개"],
"question":"출발 질문 한 문장",
"motive":{"text":"학생 기록이 있으면 다듬은 글, 없으면 빈 문자열","guide":"무엇을 쓸지","starter":"시작 문장 예시"},
"concepts":[{"term":"개념","explain":"두 문장 설명"}],
"method":{"summary":"방법 요약 두 문장","steps":[{"title":"단계","detail":"한 문장"}]},
"results":{"text":"결과를 수치와 함께 서술 3~4문장","finding":"핵심 발견 한 문장"},
"interpretation":"결과 해석 3문장",
"difficulty":{"text":"학생 메모(처음 생각과 달랐던 점)가 있으면 그 말을 살려 '예상과 달랐던 점과 어떻게 받아들였는지'로 다듬은 글, 없으면 빈 문자열","guide":"무엇을 쓸지","starter":"시작 문장 예시"},
"mine":"학생 생각을 다듬은 한두 문장 (학생 생각이 없으면 빈 문자열)",
"limits":"한계 두 문장",
"next":"다음 질문 한 문장",
"career":{"text":"","guide":"진로와 어떻게 이어지는지 쓸 방향","starter":"시작 문장 예시"},
"summary":{"motive":"계기 한 줄","method":"방법 한 줄","next":"더 알아볼 점 한 줄","career":"진로 한 줄"}}`,
        10000
      );
      if (!ai?.results) return json({ error: "보고서 내용을 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);

      const report = {
        ...ai,
        title: ai.titles?.[0] ?? inq.suggestion,
        subtitle: inq.suggestion,
        memory: r.memory,
        references: refs,
        meta: { department: inq.department, grade: inq.grade, term: inq.term, subject: inq.subject, method: inq.method },
        gen_count: used + 1,
        generated_at: new Date().toISOString(),
      };
      const { data: updated, error } = await admin
        .from("inquiries").update({ report, stage: "design" }).eq("id", inq.id).select("*").single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      return json({ inquiry: updated });
    }

    // ── 결과 분석 (AI 분석을 고른 경우, 또는 직접 분석하다 "AI 도움 받기")
    if (body.action === "analyze") {
      const { data: inq } = await admin
        .from("inquiries").select("*").eq("id", body.inquiry_id).eq("user_id", user.id).maybeSingle();
      if (!inq) return json({ error: "탐구를 찾지 못했어요." }, 404);

      if (!(await usable(inq))) return json(PAYWALL, 402);
      const data = body.data; // 학생이 입력한 결과 (표·설문 집계)
      if (!data) return json({ error: "결과를 먼저 입력해 주세요." }, 400);

      const used = Number(inq.results?.ai_count ?? 0);
      if (used >= 5) return json({ error: "이 탐구는 AI 분석을 5번까지 받을 수 있어요.", limit: true }, 429);

      const p = inq.pack ?? {};
      const ai = await ask(
        `고등학생이 직접 모은 탐구 결과를 분석한다. JSON만 출력.
원칙:
- 학생이 입력한 숫자·내용만 쓴다. 입력에 없는 수치·응답·자료를 절대 만들지 않는다
- 비율·차이·평균처럼 입력으로 계산할 수 있는 값은 계산해서 쓴다
- 결과가 부족하거나 빈칸이 많으면 caution에 그 점을 먼저 쓴다
- 인과를 단정하지 않는다. 표본이 적으면 일반화하기 어렵다고 쓴다
- 쉬운 말, 짧은 문장
기억 문장: 선생님이 몇 달 뒤에도 떠올릴 가장 임팩트 있는 한 문장을 두 줄로 나눈다. l1은 예상·상황(12자 안팎, 쉼표로 끝), l2는 결과·반전(15자 안팎, 마침표로 끝).
- 후보 3개는 서로 다른 곳에서 찾는다
  1) 결과 속 반전 — 입력한 결과에서 가장 의외인 차이나 대비
  2) 학생의 말 — [학생 생각]·[학생 메모]에 가장 인상적인 느낌이나 깨달음이 있으면 그 말을 살려서 (없으면 결과에서 하나 더)
  3) 자료 속 한 장면 — 결과·자료에 나온 가장 생생한 사실이나 사례 하나
- 중학생도 한 번에 읽히는 쉬운 말. 기호(≤, %, / 등)·전문용어·숫자 나열 금지. 숫자는 꼭 필요할 때 하나까지
- 예상과 다른 점이나 대비가 드러나게 (예: "위에서는 버티고, 장에서만 녹았다." "포기할 줄 알았는데, 오히려 더 샀다.")
- 결과·학생 말에 없는 사실을 지어내지 않는다
- 주제 제목 반복, "~을 알 수 있었다", 추상적 교훈 금지. 3개. 가장 임팩트 있는 것을 첫 번째로.`,
        `탐구 주제: ${inq.suggestion}
탐구 방법: ${METHOD_NAME[inq.method as Method]}
${p.pack?.hypothesis ? `가설: ${p.pack.hypothesis}\n` : ""}${p.purpose ? `탐구 목적: ${p.purpose}\n` : ""}학생이 입력한 결과(JSON):
${JSON.stringify(data).slice(0, 6000)}
${body.mine ? `[학생 생각] ${String(body.mine).slice(0, 600)}` : ""}
${inq.memo ? `[학생 메모] ${String(inq.memo).slice(0, 600)}` : ""}

{"notable":"가장 눈에 띈 점 한두 문장(숫자 포함)","unexpected":"예상과 다른 점 한두 문장","caution":"조심할 점 한 문장","finding":"핵심 발견 한 문장","memory":[{"l1":"","l2":"","from":"결과|학생 말|자료"},{"l1":"","l2":"","from":""},{"l1":"","l2":"","from":""}]}`,
        6000
      );
      if (!ai?.finding) return json({ error: "분석을 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);

      const results = { ...(inq.results ?? {}), data, ai, ai_count: used + 1 };
      const { data: updated, error } = await admin
        .from("inquiries").update({ results }).eq("id", inq.id).select("*").single();
      if (error) return json({ error: "저장에 실패했어요." }, 500);
      return json({ inquiry: updated });
    }

    return json({ error: "알 수 없는 요청입니다." }, 400);
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});