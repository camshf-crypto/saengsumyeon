// 내 생기부 노트 — 고2 로드맵 / 고3 1학기 로드맵 (유료 · 결제 승인된 학생만)
// 고2 칸을 10칸 이상 채운 학생은 고3 1학기 로드맵(마무리 탐구 · 면접에서 물어볼 활동), 아니면 고2 1년 로드맵
// 배포: npx supabase functions deploy note_roadmap --project-ref xhywexuazwipwvzrldwo
//
// 가장 최근 AI 진단(전체 결과 result_full) + 내 활동을 바탕으로 main 학과 기준 고2 1년 계획을 만든다
//   선택과목 조합 · 이어갈 탐구 5개(+ 흔함 지수) · 약한 역량 채우는 법 · 1학기/2학기 계획 · 부모님께 한마디
// 흔함 지수: topic_db 의 같은 학과 탐구 사례와 탐구 제목을 비교해 비슷한 사례가 몇 개인지 센다 (AI 아님)
//
// 요청 { force?: boolean }   (로그인 필수)
// 응답 { roadmap, created_at, cached }  또는 { running: true, started_at }  또는 { need: "pay" | "diagnosis" } / { error }
// 만들기는 백그라운드에서 한다: '만드는 중' 줄을 먼저 저장하고 바로 답한 뒤, 다 만들면 그 줄을 채운다
//   → 학생이 화면을 닫아도 끝까지 만들어지고, 다시 들어오면 화면이 note_roadmaps 를 보고 이어서 보여 준다

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hasPass } from "../_shared/pass.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5";
const DAILY = 3;
const RUN_LIMIT_MS = 5 * 60 * 1000; // 5분 넘게 "만드는 중"이면 실패로 보고 다시 만들 수 있게 // 하루에 새로 만들 수 있는 횟수 (진단이 그대로면 저장된 로드맵을 다시 보여 주고 횟수에 안 셈)
const KIND_LABEL: Record<string, string> = { subject: "교과 세특", autonomy: "자율", club: "동아리", career: "진로", book: "독서" };

// 2022 개정 선택과목 — 이 안에서만 추천 (note_diagnose 와 같은 목록)
const SUBJECTS = [
  "화법과 언어", "독서와 작문", "문학", "주제 탐구 독서", "문학과 영상", "독서 토론과 글쓰기", "매체 의사소통", "언어생활 탐구",
  "대수", "미적분Ⅰ", "확률과 통계", "기하", "미적분Ⅱ", "경제 수학", "인공지능 수학", "실용 통계",
  "영어Ⅰ", "영어Ⅱ", "영어 독해와 작문", "영미 문학 읽기", "영어 발표와 토론", "심화 영어", "심화 영어 독해와 작문", "세계 문화와 영어",
  "사회와 문화", "현대사회와 윤리", "세계시민과 지리", "세계사", "한국지리 탐구", "도시의 미래 탐구", "동아시아 역사 기행", "정치", "법과 사회", "경제",
  "윤리와 사상", "인문학과 윤리", "국제 관계의 이해", "여행지리", "역사로 탐구하는 현대 세계", "사회문제 탐구", "금융과 경제생활", "윤리문제 탐구", "기후변화와 지속가능한 세계",
  "물리학", "화학", "생명과학", "지구과학", "역학과 에너지", "전자기와 양자", "물질과 에너지", "화학 반응의 세계", "세포와 물질대사", "생물의 유전",
  "지구시스템과학", "행성우주과학", "과학의 역사와 문화", "기후변화와 환경생태", "융합과학 탐구",
  "정보", "인공지능 기초", "데이터 과학", "한문", "일본어", "중국어", "기술·가정",
];

/* 어느 학년 로드맵을 만들지 — 고2 칸을 10칸 이상 채웠으면 고3(1학기), 아니면 고2(1년) */
const NEED_SUBJECTS = 10;
const UNLOCK_AT = 10;
const key = (s: string) => String(s || "").replace(/\s/g, "");
function gradeDone(rows: any[], grade: string) {
  const g = rows.filter((a) => a.grade === grade);
  const subjects = new Set(g.filter((a) => a.kind === "subject").map((a) => key(a.subject)).filter(Boolean)).size;
  const has = (k: string) => g.some((a) => a.kind === k);
  return Math.min(subjects, NEED_SUBJECTS) + (has("autonomy") ? 1 : 0) + (has("club") ? 1 : 0) + (has("career") ? 1 : 0);
}
const targetOf = (rows: any[]) => (gradeDone(rows, "고2") >= UNLOCK_AT ? "고3" : "고2");

const COMMON_RULES = `- 선택과목은 [고를 수 있는 선택과목] 목록의 이름만 그대로 쓴다
- 대학 이름, 합격 가능성, 등급·점수 이야기는 하지 않는다
- 학생 활동에 없는 사실을 지어내지 않는다
- 모든 글은 쉬운 말, "~예요/~해요"`;

const SYSTEM_G2 = `고1 '내 생기부 노트' 활동과 AI 진단 결과를 바탕으로, 학생이 가고 싶은 학과(main) 기준 '고2 1년 로드맵'을 만든다. JSON만 출력.

원칙:
- 모든 계획은 main 학과 기준. 고1 활동에서 이어지게 짜고, 진단에서 '약함'·'비어 있음'인 역량을 고2에 채우는 데 집중한다
- 탐구는 고2 학생이 학교 수업·실험실·설문·공공데이터로 한 학기 안에 실제로 할 수 있는 수준만 (대학원 수준 통계·모델링, 의료 현장 실험, 비싼 장비 금지)
- 탐구 5개는 서로 다른 선택과목·다른 역량을 채우게 고르고, 고1 활동 중 무엇을 이어 가는지 분명히 쓴다
${COMMON_RULES}

출력:
- headline: main 학과 기준 고2 1년 방향 한 문장
- subjects: 고2에 고를 선택과목 4~5개 { name, why(학과·고1 활동과 이어서 한 문장), role("핵심"|"보완") }
- combos: 같이 들으면 좋은 조합 2개 { names(과목 이름 2~3개), why(한 문장) }
- inquiries: 고2에 할 탐구 5개 { subject(선택과목 이름), title(탐구 주제 한 줄), from(이어 가는 고1 활동, 짧게), fills(채우는 역량 이름), steps(실제로 할 일 3단계, 각 한 줄), output(결과물: 보고서·발표·포스터 등), term("1학기"|"2학기") }
- competencies: 진단의 역량 4개 { name, status("충분"|"약함"|"비어 있음"), how(고2에 채우거나 더 키우는 방법 한두 문장) }
- terms: 학기별 계획 { "1학기": [{ area(과목 이름 또는 자율·동아리·진로·독서), todo(무엇을 할지 한 줄) }], "2학기": [...] } — 학기마다 5~7줄
- books: 고2에 읽으면 좋은 책 3권 { title, why(학과·탐구와 이어서 한 줄) } (실제로 있는 책만, 모르면 빈 배열)
- interview: 빈 배열
- parent: 부모님께 보여 드릴 요약 2~3문장

{"headline":"","subjects":[{"name":"","why":"","role":"핵심"}],"combos":[{"names":[""],"why":""}],
"inquiries":[{"subject":"","title":"","from":"","fills":"","steps":["","",""],"output":"","term":"1학기"}],
"competencies":[{"name":"","status":"약함","how":""}],
"terms":{"1학기":[{"area":"","todo":""}],"2학기":[{"area":"","todo":""}]},
"books":[{"title":"","why":""}],"interview":[],"parent":""}`;

const SYSTEM_G3 = `고1·고2 '내 생기부 노트' 활동과 AI 진단 결과를 바탕으로, 학생이 가고 싶은 학과(main) 기준 '고3 1학기 로드맵'을 만든다. JSON만 출력.

배경: 고3 1학기 기록이 수시 원서에 들어가는 마지막 학교생활기록부다. 고3은 수능·내신 준비로 시간이 적다.

원칙:
- 새 주제를 벌이기보다 고1·고2 활동의 흐름을 main 학과 쪽으로 '마무리·심화'하는 계획을 짠다
- 진단에서 '약함'·'비어 있음'인 역량 중 1학기 안에 채울 수 있는 것만 고른다
- 탐구는 고3 1학기 안에 수업 시간·과제로 끝낼 수 있는 작은 규모만 (설문·공공데이터·문헌·간단한 실험). 대학원 수준 분석, 의료 현장 실험, 비싼 장비 금지
- 탐구 3개는 각각 고1·고2의 어떤 활동을 이어 가는지 분명히 쓴다
- 면접 대비: 학생 활동 중 면접관이 물어볼 만한 것을 골라, 실제 질문 형태로 쓴다
${COMMON_RULES}

출력:
- headline: main 학과 기준 고3 1학기 방향 한 문장
- subjects: 고3에 고를 선택과목 3~4개 { name, why(학과·고1~고2 활동과 이어서 한 문장), role("핵심"|"보완") }
- combos: 같이 들으면 좋은 조합 1개 { names(과목 이름 2~3개), why(한 문장) }
- inquiries: 고3 1학기에 할 탐구 3개 { subject(선택과목 이름), title(탐구 주제 한 줄), from(이어 가는 고1·고2 활동, 짧게), fills(채우는 역량 이름), steps(실제로 할 일 3단계, 각 한 줄), output(결과물), term("1학기") }
- competencies: 진단의 역량 4개 { name, status("충분"|"약함"|"비어 있음"), how(고3 1학기에 마무리하거나 면접에서 보여 주는 방법 한두 문장) }
- terms: { "1학기": [{ area(과목 이름 또는 자율·동아리·진로·독서), todo(무엇을 할지 한 줄) }] } — 6~8줄, 생기부 마무리 중심
- books: 고3 1학기에 읽을 책 2권 { title, why } (실제로 있는 책만, 모르면 빈 배열)
- interview: 면접에서 물어볼 만한 내 활동 3개 { activity(학생 활동 짧게), question(예상 질문 한 문장), point(답할 때 꼭 말할 것 한 문장) }
- parent: 부모님께 보여 드릴 요약 2~3문장

{"headline":"","subjects":[{"name":"","why":"","role":"핵심"}],"combos":[{"names":[""],"why":""}],
"inquiries":[{"subject":"","title":"","from":"","fills":"","steps":["","",""],"output":"","term":"1학기"}],
"competencies":[{"name":"","status":"약함","how":""}],
"terms":{"1학기":[{"area":"","todo":""}]},
"books":[{"title":"","why":""}],"interview":[{"activity":"","question":"","point":""}],"parent":""}`;

/* AI 사용량 기록 */
const PRICE: Record<string, [number, number]> = { "gpt-5": [1.25, 10], "gpt-5-mini": [0.25, 2] };
async function logUsage(admin: any, userId: string, usage: any, ok: boolean) {
  try {
    const [pi, po] = PRICE[MODEL] ?? [0, 0];
    const inT = Number(usage?.prompt_tokens ?? 0);
    const outT = Number(usage?.completion_tokens ?? 0);
    await admin.from("ai_usage").insert({
      service: "note_roadmap", user_id: userId, client_id: null, model: MODEL,
      input_tokens: inT, output_tokens: outT, cost_usd: (inT * pi + outT * po) / 1e6, ok,
    });
  } catch (e) {
    console.warn("usage log failed", e);
  }
}

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/* 같은 학과 탐구 사례 — topic_db 에서 학과 이름이 들어간 줄 (칸 이름이 무엇이든 동작) */
const DEPT_COLS = ["department", "dept", "major", "학과", "dept_name", "department_name"];
async function deptRows(admin: any, dept: string, limit: number): Promise<string[]> {
  const d = dept.replace(/(학과|학부|전공)$/, "");
  if (d.length < 2) return [];
  for (const col of DEPT_COLS) {
    const { data, error } = await admin.from("topic_db").select("*").ilike(col, `%${d}%`).limit(limit);
    if (error) continue;
    return (data ?? []).map((row: any) =>
      Object.entries(row)
        .filter(([k, v]) => typeof v === "string" && v.trim() && !/(^id$|_id$|created|updated|embedding)/i.test(k))
        .map(([, v]) => clean(v, 200))
        .join(" / ")
    );
  }
  return [];
}

/* 흔함 지수 — 탐구 제목의 두 글자 묶음이 사례 글에 얼마나 들어 있는지로 '비슷한 사례' 수를 센다 */
const STOP = /(에서|으로|에게|의|과|와|및|를|을|이|가|는|은|에|한|하는|미치는|영향|관계|분석|탐구|비교|활용|통한|대한|위한|연구|조사)/g;
function grams(s: string) {
  const t = s.replace(STOP, " ").replace(/[^가-힣a-zA-Z0-9]/g, "");
  const g = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}
function commonness(title: string, rows: string[]) {
  if (!rows.length) return { level: "모름", similar: 0, total: 0, example: "" };
  const q = grams(title);
  if (q.size < 2) return { level: "모름", similar: 0, total: rows.length, example: "" };
  let similar = 0;
  let best = 0;
  let example = "";
  for (const r of rows) {
    const text = r.replace(/[^가-힣a-zA-Z0-9]/g, "");
    let hit = 0;
    q.forEach((g) => { if (text.includes(g)) hit++; });
    const score = hit / q.size;
    if (score >= 0.5) similar++;
    if (score > best) {
      best = score;
      // 사례 글 중 제목과 가장 많이 겹치는 칸을 예시로
      let top = -1;
      for (const seg of r.split(" / ")) {
        let h = 0;
        q.forEach((g) => { if (seg.includes(g)) h++; });
        if (h > top) { top = h; example = seg; }
      }
    }
  }
  const level = similar >= 6 ? "흔함" : similar >= 2 ? "보통" : "드묾";
  return { level, similar, total: rows.length, example: best >= 0.5 ? clean(example, 80) : "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "로그인이 필요해요." }, 401);
    const body = await req.json().catch(() => ({}));

    // 결제(승인)했는지
    const { data: access } = await admin.from("note_roadmap_access").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!access && !(await hasPass(admin, user.id))) return json({ need: "pay" }, 403); // 이용권도 열림

    // 가장 최근 진단 (전체 결과)
    const { data: diag } = await admin
      .from("note_diagnoses")
      .select("id, departments, unsure, result_full, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!diag?.result_full) return json({ need: "diagnosis" }, 400);
    const full = diag.result_full;
    const main = clean(full.main, 30) || diag.departments?.[0] || "";

    // 가장 최근 로드맵 — 만드는 중이면 그대로 기다리게, 같은 진단으로 다 만든 게 있으면 그대로
    const { data: last, error: lastErr } = await admin
      .from("note_roadmaps")
      .select("id, diagnosis_id, result, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // 저장할 표가 없으면 AI를 돌리지 않는다 (만들어도 저장이 안 돼서 들어올 때마다 다시 돌게 됨)
    if (lastErr) {
      console.error("note_roadmaps read failed", lastErr.message);
      return json({ error: "로드맵을 저장할 곳이 준비되지 않았어요. 관리자에게 알려 주세요. (sm_49 · sm_50)" }, 500);
    }
    // 내 활동 · 어느 학년 로드맵인지
    const { data: rows } = await admin
      .from("record_activities")
      .select("grade, kind, subject, content")
      .eq("user_id", user.id)
      .order("id", { ascending: true });
    const acts = rows ?? [];
    const target = targetOf(acts);

    const fresh = last && Date.now() - new Date(last.created_at).getTime() < RUN_LIMIT_MS;
    if (last?.status === "running" && fresh) {
      return json({ running: true, started_at: last.created_at });
    }
    if (last?.status === "done" && last.result && last.diagnosis_id === diag.id && (last.result.target ?? "고2") === target && !body.force) {
      return json({ roadmap: last.result, created_at: last.created_at, cached: true });
    }

    // 하루 새로 만드는 횟수 (관리자는 제한 없음 · 실패한 건 안 셈)
    const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await admin.from("note_roadmaps").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "failed").gte("created_at", since);
      if ((count ?? 0) >= DAILY) return json({ error: `로드맵은 하루 ${DAILY}번까지 새로 만들 수 있어요. 내일 다시 해 주세요.` }, 429);
    }

    // '만드는 중' 줄을 먼저 저장하고 바로 답한다 — 학생이 화면을 닫아도 서버는 끝까지 만들어서 저장한다
    const { data: job, error: jobErr } = await admin
      .from("note_roadmaps")
      .insert({ user_id: user.id, diagnosis_id: diag.id, main, status: "running", result: null })
      .select("id, created_at")
      .single();
    if (jobErr || !job) {
      console.error("note_roadmaps insert failed", jobErr?.message);
      return json({ error: "로드맵을 저장할 곳이 준비되지 않았어요. 관리자에게 알려 주세요. (sm_50)" }, 500);
    }

    const work = (async () => {
      try {
      const actText = acts
        .map((a: any) => `- [${a.grade}] ${KIND_LABEL[a.kind] ?? a.kind}${a.subject ? `(${a.subject})` : ""}: ${clean(a.content, 300)}`)
        .join("\n");

      // 같은 학과 사례 — AI 참고용 20개 · 흔함 지수용 최대 500개
      const cases = await deptRows(admin, main, 500);

      const diagText = JSON.stringify({
        main,
        summary: full.summary,
        cells: full.cells,
        competencies: full.competencies,
        subjects: full.subjects,
        inquiries: full.inquiries,
      });

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
        body: JSON.stringify({
          model: MODEL,
          max_completion_tokens: 16000,
          reasoning_effort: "low",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: target === "고3" ? SYSTEM_G3 : SYSTEM_G2 },
            {
              role: "user",
              content: `[만들 로드맵] ${target === "고3" ? "고3 1학기" : "고2 1년"}

  [main 학과] ${main}

  [고를 수 있는 선택과목] ${SUBJECTS.join(", ")}

  [AI 진단 결과]
  ${diagText}

  [같은 학과 탐구 사례]
  ${cases.length ? cases.slice(0, 20).map((c) => `- ${clean(c, 160)}`).join("\n") : "(없음)"}

  [학생 활동]
  ${actText}`,
            },
          ],
        }),
      });
      const raw = await res.text();
      let ai: any = null;
      let usage: any = null;
      if (res.ok) {
        try {
          const j = JSON.parse(raw);
          usage = j.usage;
          ai = JSON.parse(j.choices?.[0]?.message?.content ?? "");
        } catch (e) {
          console.error("parse failed", e);
        }
      } else console.error("openai error", res.status, raw.slice(0, 800));
      await logUsage(admin, user.id, usage, Boolean(ai));
      if (!ai) throw new Error("ai failed");

      const STATUS = ["충분", "약함", "비어 있음"];
      const TERMS = target === "고3" ? ["1학기"] : ["1학기", "2학기"];
      const termList = (k: string) =>
        (ai.terms?.[k] ?? []).slice(0, 8).map((t: any) => ({ area: clean(t.area, 20), todo: clean(t.todo, 140) })).filter((t: any) => t.area && t.todo);

      const roadmap = {
        main,
        headline: clean(ai.headline, 160),
        subjects: (ai.subjects ?? [])
          .filter((s: any) => SUBJECTS.includes(clean(s.name, 30)))
          .slice(0, 5)
          .map((s: any) => ({ name: clean(s.name, 30), why: clean(s.why, 160), role: s.role === "보완" ? "보완" : "핵심" })),
        combos: (ai.combos ?? []).slice(0, 2).map((c: any) => ({
          names: (Array.isArray(c.names) ? c.names : []).map((n: any) => clean(n, 30)).filter((n: string) => SUBJECTS.includes(n)).slice(0, 3),
          why: clean(c.why, 160),
        })).filter((c: any) => c.names.length >= 2),
        inquiries: (ai.inquiries ?? []).slice(0, target === "고3" ? 3 : 5).map((q: any) => {
          const title = clean(q.title, 90);
          return {
            subject: clean(q.subject, 30),
            title,
            from: clean(q.from, 80),
            fills: clean(q.fills, 30),
            steps: (Array.isArray(q.steps) ? q.steps : []).slice(0, 3).map((s: any) => clean(s, 120)).filter(Boolean),
            output: clean(q.output, 30),
            term: TERMS.includes(q.term) ? q.term : "1학기",
            common: commonness(title, cases),
          };
        }).filter((q: any) => q.title),
        competencies: (ai.competencies ?? []).slice(0, 4).map((c: any) => ({
          name: clean(c.name, 30),
          status: STATUS.includes(c.status) ? c.status : "약함",
          how: clean(c.how, 220),
        })).filter((c: any) => c.name),
        terms: Object.fromEntries(TERMS.map((t) => [t, termList(t)])),
        books: (ai.books ?? []).slice(0, 3).map((b: any) => ({ title: clean(b.title, 60), why: clean(b.why, 140) })).filter((b: any) => b.title),
        interview: target === "고3"
          ? (ai.interview ?? []).slice(0, 3).map((v: any) => ({ activity: clean(v.activity, 80), question: clean(v.question, 160), point: clean(v.point, 160) })).filter((v: any) => v.question)
          : [],
        parent: clean(ai.parent, 400),
        target,
        case_total: cases.length,
      };


        await admin.from("note_roadmaps").update({ status: "done", result: roadmap }).eq("id", job.id);
      } catch (e) {
        console.error("roadmap job failed", String(e));
        await admin.from("note_roadmaps").update({ status: "failed" }).eq("id", job.id);
      }
    })();
    // EdgeRuntime.waitUntil — 답을 보낸 뒤에도 서버가 이 일을 끝까지 한다
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
    else await work;

    return json({ running: true, started_at: job.created_at });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});