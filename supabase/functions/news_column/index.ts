// 오늘의 입시 뉴스 — 매일 아침 입시 칼럼을 자동으로 쓴다 (2026-11-18)
// 배포: npx supabase functions deploy news_column --project-ref xhywexuazwipwvzrldwo --no-verify-jwt --yes
//
// 매일 새벽 6시 30분(한국) pg_cron 이 부른다 (sm_129_news_column.sql) → 7시에 칼럼 목록에 공개
//   ① 어제~오늘 입시 뉴스를 웹 검색 (믿을 만한 언론 · 교육부 · 대교협 · 평가원만)
//   ② 고등학생 · 학부모가 알아야 할 것 3~4개를 골라 우리 말로 요약 (기사 문장 · 사진은 옮기지 않는다 — 출처 링크만)
//   ③ sm_columns 에 '오늘의 입시 뉴스' 시리즈로 넣는다 (publish_at = 오늘 아침 7시)
// 보호: 요청 헤더 x-cron-key 가 sm_cron_keys('news_column') 값과 같아야 한다 (키는 SQL 이 만들고 아무도 복사하지 않는다)
// 요청 { force?: boolean }  — force 면 오늘 것이 있어도 하나 더 (관리자 시험용)
// 응답 바로 { started: true } — 검색 · 글쓰기는 1~2분 걸려서 뒤에서 이어서 한다

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL = Deno.env.get("NEWS_MODEL") || "gpt-5-mini";
const PRICE: Record<string, [number, number, number]> = { "gpt-5-mini": [0.25, 2, 0.025], "gpt-5": [1.25, 10, 0.125] };
const SEARCH_USD = 0.01; // 웹 검색 한 번 값 (OpenAI 1,000번에 10달러)
const SERIES = "오늘의 입시 뉴스";

// 검색할 곳 — 언론사 · 정부 · 입시 기관
const DOMAINS = [
  "moe.go.kr", "kcue.or.kr", "kice.re.kr", "adiga.kr", "korea.kr",
  "yna.co.kr", "news1.kr", "newsis.com", "kbs.co.kr", "ytn.co.kr", "sbs.co.kr", "imbc.com",
  "joongang.co.kr", "donga.com", "chosun.com", "hani.co.kr", "khan.co.kr", "hankookilbo.com",
  "mk.co.kr", "hankyung.com", "edaily.co.kr", "seoul.co.kr",
  "veritas-a.com", "unn.net", "dhnews.co.kr", "edpl.co.kr", "eduinnews.co.kr", "hangyo.com",
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const clean = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// 한국 날짜 · 시각
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { ymd: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}
// 한국 날짜 ymd 의 오전 7시 → ISO (UTC)
const kst7 = (ymd: string) => new Date(`${ymd}T07:00:00+09:00`).toISOString();
const dayKo = (ymd: string) => { const [, m, d] = ymd.split("-").map(Number); return `${m}월 ${d}일`; };

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "summary", "items", "checklist", "cta"],
  properties: {
    title: { type: "string", description: "오늘 칼럼 제목 — 오늘 뉴스들을 다 읽고 가장 중요한 내용을 신문 1면 제목처럼 학생이 누르고 싶게 22자 안. 예: '수능 AI 커닝 막는다, 단추·안경까지 점검' · '2028 수능 통합사회·과학 확정'. '요약' · '뉴스' · '시간' · 날짜 · 괄호 쓰지 말 것" },
    summary: { type: "string", description: "오늘 뉴스 전체를 두 문장으로" },
    items: {
      type: "array", minItems: 0, maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["headline", "what", "why", "who", "source_name", "source_url", "date"],
        properties: {
          headline: { type: "string", description: "이 뉴스의 소제목 — 우리 말로 다시 쓴 짧은 한 줄 22자 안 (기사 제목을 그대로 쓰지 않는다 · 문장 끝 '~을 내' 같이 자르지 말 것)" },
          what: { type: "string", description: "무슨 일인지 2~3문장 — 기사 문장을 옮기지 말고 우리 말로" },
          why: { type: "string", description: "고등학생 · 학부모에게 왜 중요한지 한두 문장" },
          who: { type: "string", description: "이 뉴스가 해당하는 학생만 15자 안 (예: 고3 · 재수생 / 2028 대입 고2 / 의대 지원생). 발표한 기관 · 출처는 쓰지 말 것" },
          source_name: { type: "string", description: "언론사 · 기관 이름" },
          source_url: { type: "string", description: "실제로 검색해서 본 기사 주소" },
          date: { type: "string", description: "기사 날짜 YYYY-MM-DD" },
        },
      },
    },
    checklist: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" }, description: "오늘 뉴스를 보고 학생이 이번 주에 해 볼 것 3개 — 짧게" },
    cta: { type: "string", enum: ["interview", "topic", "reading", "motive", "none"], description: "오늘 뉴스와 가장 이어지는 생수면 서비스" },
  },
};

function prompt(ymd: string, recent: string[]) {
  return `오늘은 ${ymd} (한국 시간)이다. 너는 고등학생 · 학부모를 위한 입시 뉴스 편집자다.
웹 검색으로 어제와 오늘 나온 대한민국 대학 입시 뉴스를 찾아, 고등학생이 꼭 알아야 할 것 3~4개를 골라라.

고를 것: 수능 · 수시 · 정시 일정과 변화, 학생부종합 · 교과 전형, 대학 모집요강 · 정원 · 선발 방식, 고교학점제 · 교육과정 · 내신 평가, 교육부 · 대교협 · 평가원 발표, 입시 통계 · 경쟁률
고르지 말 것: 광고 · 학원 홍보 기사, 정치인 발언 다툼, 사건 · 사고, 대학 순위 · 취업률, 사흘보다 오래된 기사, 같은 일을 다룬 기사 두 개
최근 칼럼에서 이미 다룬 것 (같은 일은 새 발표가 없으면 다시 고르지 말 것):
${recent.length ? recent.map((t) => `- ${t}`).join("\n") : "- (없음)"}

쓰는 법
- 기사 문장을 그대로 옮기지 말고 고등학생이 읽기 쉬운 우리 말로 다시 쓴다 ("~예요/~해요")
- 숫자 · 날짜 · 기관 이름은 기사에 나온 그대로 정확하게. 확실하지 않으면 빼라
- 찬반이 갈리는 일은 한쪽 편을 들지 말고 무엇이 정해졌는지만
- source_url 은 네가 실제로 검색해서 본 기사 주소만. 지어내지 말 것
- 쓸 만한 뉴스가 2개보다 적으면 items 를 비워라 (억지로 채우지 말 것)
JSON 으로만 답한다.`;
}

async function callOpenAI(body: any) {
  for (let k = 0; ; k++) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && k < 2) { await res.body?.cancel(); await new Promise((ok) => setTimeout(ok, 3000)); continue; }
    return res;
  }
}

// 웹 검색 + JSON 답 — 검색 범위 제한이 안 되면 제한 없이, 새 도구가 안 되면 예전 도구로
async function research(ymd: string, recent: string[]) {
  const base = {
    model: MODEL,
    reasoning: { effort: "low" },
    input: prompt(ymd, recent),
    include: ["web_search_call.action.sources"],
    text: { format: { type: "json_schema", name: "news_column", strict: true, schema: SCHEMA } },
  };
  const tries = [
    { ...base, tools: [{ type: "web_search", filters: { allowed_domains: DOMAINS }, user_location: { type: "approximate", country: "KR" } }] },
    { ...base, tools: [{ type: "web_search", user_location: { type: "approximate", country: "KR" } }] },
    { ...base, include: undefined, tools: [{ type: "web_search_preview" }] },
  ];
  let last = "";
  for (const t of tries) {
    const res = await callOpenAI(t);
    const raw = await res.text();
    if (res.status === 400) { last = raw.slice(0, 300); console.error("news 400", last); continue; }
    if (!res.ok) throw new Error(`openai ${res.status} ${raw.slice(0, 300)}`);
    return JSON.parse(raw);
  }
  throw new Error(`openai 400 ${last}`);
}

// 답에서 글 · 실제로 본 주소 · 검색 횟수 꺼내기
function unpack(r: any) {
  let text = "";
  const seen = new Set<string>();
  let searches = 0;
  for (const o of r.output ?? []) {
    if (o.type === "web_search_call") {
      searches++;
      for (const s of o.action?.sources ?? []) if (s?.url) seen.add(s.url);
    }
    if (o.type === "message") for (const c of o.content ?? []) {
      if (c.type === "output_text") { text += c.text ?? ""; for (const a of c.annotations ?? []) if (a?.url) seen.add(a.url); }
    }
  }
  return { text, seen, searches };
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\.|^m\./, ""); } catch { return ""; } };

// 받을 뉴스만 — https 주소 · 검색에서 본 사이트 · 최근 3일 · 제목 겹치지 않게
function pick(items: any[], seen: Set<string>, ymd: string) {
  const seenHosts = new Set([...seen].map(hostOf).filter(Boolean));
  const oldest = new Date(new Date(`${ymd}T00:00:00+09:00`).getTime() - 3 * 86400e3).toISOString().slice(0, 10);
  const out: any[] = [];
  for (const x of items ?? []) {
    const url = clean(x.source_url, 400);
    const host = hostOf(url);
    if (!/^https:\/\//.test(url) || !host) continue;
    if (seenHosts.size && !seenHosts.has(host) && ![...seenHosts].some((h) => h.endsWith(host) || host.endsWith(h))) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : "";
    if (date && (date < oldest || date > ymd)) continue;
    const headline = clean(x.headline, 40);
    if (!headline || !clean(x.what, 10)) continue;
    if (out.some((y) => y.headline === headline || y.url === url)) continue;
    out.push({ headline, what: clean(x.what, 500), why: clean(x.why, 300), who: /출처|발표/.test(String(x.who)) ? "" : clean(x.who, 30), name: clean(x.source_name, 30) || host, url, date });
  }
  return out.slice(0, 4);
}

// 제목 — 모델이 '(요약) 최근 48시간…' 같은 설명을 쓰면 첫 뉴스 제목으로 (2026-11-18 첫 시험에서 나옴)
function titleOf(t: unknown, items: any[], ymd: string) {
  const s = clean(t, 80).replace(/^\(?요약\)?\s*/, "").replace(/\(\d{4}-\d{2}-\d{2}[^)]*\)/g, "").trim();
  const bad = !s || s.length > 32 || /\d+\s*시간|요약|\d{4}-\d{2}-\d{2}|핵심\s*(뉴스)?\s*$/.test(s);
  return bad ? clean(items[0]?.headline, 32) || `${dayKo(ymd)} 입시 뉴스` : s;
}

// 칼럼 본문 — 빈 줄 = 문단, "## " = 소제목, "> " = 강조, "출처 " = 출처 줄 (Columns.jsx 가 링크로 그린다)
function bodyOf(items: any[]) {
  return items.map((x) => [
    `## ${x.headline}`,
    x.what,
    x.who ? `대상 · ${x.who}` : "",
    x.why ? `> ${x.why}` : "",
    `출처 ${x.name}${x.date ? ` · ${dayKo(x.date)}` : ""} ${x.url}`,
  ].filter(Boolean).join("\n\n")).join("\n\n") +
    "\n\n이 글은 생수면이 여러 기사와 발표를 읽고 고등학생 눈높이로 요약한 것이에요. 정확한 내용은 출처 기사와 각 대학 · 기관 발표에서 꼭 다시 확인하세요.";
}

async function run(db: any, force: boolean) {
  const { ymd, hour } = kstNow();
  const publishAt = hour < 7 ? kst7(ymd) : new Date().toISOString();

  // 오늘 것이 이미 있으면 그만 (cron 이 두 번 불러도 하나만)
  const dayStart = new Date(`${ymd}T00:00:00+09:00`).toISOString();
  const { data: today } = await db.from("sm_columns").select("id").eq("series", SERIES).gte("publish_at", dayStart).limit(1);
  if (today?.length && !force) return { skipped: "today exists" };

  const { data: recentRows } = await db.from("sm_columns").select("title, body, series_no").eq("series", SERIES)
    .order("publish_at", { ascending: false }).limit(7);
  const recent: string[] = [];
  for (const r of recentRows ?? []) {
    recent.push(clean(r.title, 60));
    for (const m of String(r.body ?? "").matchAll(/^## (.+)$/gm)) recent.push(clean(m[1], 60));
  }

  const r = await research(ymd, recent.slice(0, 30));
  const { text, seen, searches } = unpack(r);
  let j: any = {};
  try { j = JSON.parse(text); } catch { console.error("news json", text.slice(0, 300)); }
  const items = pick(j.items, seen, ymd);

  // 사용량 기록 — 관리자 'AI 비용'
  try {
    const u = r.usage ?? {};
    const inT = Number(u.input_tokens ?? 0), outT = Number(u.output_tokens ?? 0);
    const cached = Math.min(inT, Number(u.input_tokens_details?.cached_tokens ?? 0));
    const [pi, po, pc] = PRICE[MODEL] ?? PRICE["gpt-5-mini"];
    await db.from("ai_usage").insert({
      service: "news_column", user_id: null, model: MODEL, input_tokens: inT, output_tokens: outT,
      cost_usd: ((inT - cached) * pi + cached * pc + outT * po) / 1e6 + searches * SEARCH_USD, ok: items.length >= 2,
    });
  } catch (e) { console.error("news usage", e); }

  if (items.length < 2) return { skipped: "not enough news", found: items.length };

  const { data: last } = await db.from("sm_columns").select("series_no").eq("series", SERIES)
    .order("series_no", { ascending: false, nullsFirst: false }).limit(1);
  const no = Number(last?.[0]?.series_no ?? 0) + 1;
  const body = bodyOf(items);
  const checklist = (j.checklist ?? []).map((t: unknown) => clean(t, 80)).filter(Boolean).slice(0, 3);
  const row = {
    series: SERIES, series_no: no,
    title: titleOf(j.title, items, ymd),
    summary: clean(j.summary, 200),
    body, checklist, cta: null, // 뉴스 칼럼 밑에는 서비스 버튼 없이 (2026-11-18)
    thumb: null, minutes: Math.max(2, Math.round(body.length / 500)),
    publish_at: publishAt, hidden: false,
  };
  const { data: ins, error } = await db.from("sm_columns").insert(row).select("id").single();
  if (error) throw new Error(`insert ${error.message}`);
  return { id: ins.id, items: items.length, searches };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 문지기 — SQL 이 만든 키와 같아야 (pg_cron 만 안다)
  const key = req.headers.get("x-cron-key") ?? "";
  const { data: k } = await db.from("sm_cron_keys").select("secret").eq("name", "news_column").maybeSingle();
  if (!k?.secret || key !== k.secret) return json({ error: "forbidden" }, 403);

  let force = false;
  try { force = Boolean((await req.json())?.force); } catch { /* 빈 요청 */ }

  // 검색 · 글쓰기는 1~2분 — 먼저 답하고 뒤에서 이어서 (pg_cron 은 기다리지 않는다)
  const job = run(db, force)
    .then((out) => console.log("news_column", JSON.stringify(out)))
    .catch((e) => console.error("news_column fail", String(e)));
  // @ts-ignore Supabase Edge Runtime
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
  return json({ started: true });
});