// 생수면 · 탐구 결과물 만들기 (2~3단계: 만들기 + 고치기 함수)
// 경로: supabase/functions/build-output/index.ts
// 1) { mode: "create", topic, output_type, template_id, theme, layout, answers }  → { id }
// 2) { mode: "generate", id }                                                    → { id, slug, content }
// 3) { mode: "quick", id, label, patch: { theme?, layout?, accent?, ranges? } }  → 바로 고치기 (AI 없음, 무료)
// 4) { mode: "edit", id, request }                                               → AI로 고치기 (20번 한도)

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TYPES = ["sim", "exp", "explain", "dash", "survey", "compare", "quiz", "map"] as const;
const THEMES = ["textbook", "lab", "note", "poster", "gradient", "illust", "magazine", "glass"];
const LAYOUTS = ["side", "stack"];
const FREE_LIMIT = 3;

// 유형별로 AI가 채울 내용의 모양 (화면 틀은 프론트에 있고, AI는 이것만 씀)
const SHAPES: Record<string, string> = {
  sim: `{"variables":[{"key":"t","label":"세율","min":0,"max":100,"step":1,"default":30,"unit":"%"}],
 "formula":"수식 한 줄. 변수 key와 + - * / ^ ( ) 와 sqrt, log, exp, sin, cos 만 사용. 예: t/100*(1-t/100)^e",
 "x":"그래프 가로축에 쓸 변수 key","output":{"label":"세수","unit":""},
 "marker":{"label":"최적세율","formula":"선택. 표시할 특별한 x 값 수식"}}`,
  exp: `{"columns":[{"key":"temp","label":"온도","unit":"°C"},{"key":"rate","label":"분해 속도","unit":"mg/분"}],
 "rows":[{"temp":10,"rate":1.2}],"x":"temp","y":"rate","chart":"line 또는 bar","highlight":"max 또는 min 또는 none"}`,
  explain: `{"steps":[{"title":"단계 제목","body":"두 문장 이내 설명"}],"scene":"그림 태그 (예: physics/motor, biology/cell)"}`,
  dash: `{"columns":[{"key":"day","label":"요일"},{"key":"g","label":"잔반량","unit":"g"}],
 "rows":[{"day":"월","g":52}],"group":"day","value":"g","cards":["avg","max","min"],"chart":"bar 또는 line"}`,
  survey: `{"question":"설문 문항","options":["보기1","보기2"],"counts":[3,7],"target":"응답 대상"}`,
  compare: `{"items":["비교 대상 A","비교 대상 B"],"criteria":["기준1","기준2"],"cells":[["A의 기준1","B의 기준1"],["A의 기준2","B의 기준2"]]}`,
  quiz: `{"scenario":"상황 설명","options":[{"label":"선택지","pro":"지지하는 관점","con":"반대하는 관점"}]}`,
  map: `{"axis":"year 또는 place","events":[{"at":"1948 또는 장소명","value":"짧은 값","note":"한 줄 설명"}]}`,
};

const SYSTEM = `너는 고등학생 탐구 결과물(작은 웹페이지)의 "내용"만 쓰는 조수다.
화면 디자인은 이미 정해져 있으니 디자인·HTML·CSS는 절대 쓰지 마라.
반드시 JSON 하나만 출력한다. 공통 칸:
{"title":"질문형 제목(25자 이내)","subtitle":"한 줄 설명","report_sentence":"학생이 보고서에 옮길 수 있는 문장 1~2개(학생의 예상을 반영)","illustration_tag":"계열/주제 태그","sample":true 또는 false, "body": 유형별 칸}
규칙:
- 학생이 직접 재거나 모을 숫자는 그럴듯한 예시로 채우고 "sample":true 로 표시한다.
- 역사·과학 사실은 확실한 것만 쓰고, 불확실하면 쓰지 않는다.
- 학생이 고른 '바꿀 것'과 '예상'을 반드시 반영한다.
- 한국어, 고등학생이 읽기 쉬운 말.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const makeSlug = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "로그인이 필요해요" }, 401);

    const input = await req.json();

    // ── 1) create: 탐구 설계 저장 ──────────────────────────
    if (input.mode === "create") {
      const { topic, output_type, template_id, theme, layout, answers } = input;
      if (!topic || typeof topic !== "string" || topic.length > 200) return json({ error: "탐구주제를 확인해 주세요" }, 400);
      if (!TYPES.includes(output_type)) return json({ error: "결과물 종류가 올바르지 않아요" }, 400);
      if (!/^[gh]\d{2}$/.test(template_id ?? "")) return json({ error: "틀을 다시 골라 주세요" }, 400);

      const { count } = await admin.from("research_outputs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("plan", "free");
      if ((count ?? 0) >= FREE_LIMIT) return json({ error: "무료 결과물 3개를 모두 썼어요", code: "FREE_LIMIT" }, 403);

      const { data, error } = await admin.from("research_outputs").insert({
        user_id: user.id,
        topic: topic.trim(),
        output_type,
        template_id,
        theme: THEMES.includes(theme) ? theme : "textbook",
        layout: LAYOUTS.includes(layout) ? layout : "side",
        answers: answers ?? {},
      }).select("id").single();
      if (error) throw error;
      return json({ id: data.id });
    }

    // ── 2) generate: AI가 내용 쓰기 ────────────────────────
    if (input.mode === "generate") {
      const { data: row, error } = await admin.from("research_outputs")
        .select("*").eq("id", input.id).eq("user_id", user.id).single();
      if (error || !row) return json({ error: "결과물을 찾을 수 없어요" }, 404);
      if (row.slug) return json({ id: row.id, slug: row.slug, content: row.content }); // 이미 만들어짐

      const userMsg = `탐구주제: ${row.topic}
결과물 종류: ${row.output_type}
학생이 고른 탐구 설계: ${JSON.stringify(row.answers)}
body 칸 모양: ${SHAPES[row.output_type]}`;

      const ai = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
        body: JSON.stringify({
          model: "gpt-5",
          reasoning_effort: "low",
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
        }),
      });
      if (!ai.ok) return json({ error: "내용을 만들지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      const out = await ai.json();

      let content;
      try { content = JSON.parse(out.choices[0].message.content); }
      catch { return json({ error: "내용 형식이 맞지 않아 다시 만들어야 해요" }, 502); }
      if (!content?.title || !content?.body) return json({ error: "내용이 비어 있어요. 다시 해 주세요" }, 502);

      const slug = makeSlug();
      await admin.from("research_outputs").update({ content, slug }).eq("id", row.id);
      await admin.from("research_output_versions").insert({
        output_id: row.id, version: 1, content, theme: row.theme, layout: row.layout,
      });
      return json({ id: row.id, slug, content });
    }

    // 고칠 결과물 불러오기 (quick, edit 공통)
    const loadOwn = async (id: string) => {
      const { data } = await admin.from("research_outputs")
        .select("*").eq("id", id).eq("user_id", user.id).single();
      return data;
    };
    const nextVersion = async (outputId: string) => {
      const { data } = await admin.from("research_output_versions")
        .select("version").eq("output_id", outputId).order("version", { ascending: false }).limit(1);
      return (data?.[0]?.version ?? 0) + 1;
    };
    const saveVersion = async (row: any, content: any, theme: string, layout: string) => {
      await admin.from("research_output_versions").insert({
        output_id: row.id, version: await nextVersion(row.id), content, theme, layout,
      });
    };

    // ── 3-1) quick: 바로 고치기 (AI 없음, 횟수 안 셈) ─────────
    // { mode: "quick", id, label: "테마를 연구소 다크풍으로", patch: { theme?, layout?, accent?, ranges? } }
    // ranges: [{ key: "t", min: 0, max: 50 }]  ← 시뮬레이터 값 범위 바꾸기
    if (input.mode === "quick") {
      const row = await loadOwn(input.id);
      if (!row?.slug) return json({ error: "먼저 결과물을 만들어 주세요" }, 404);
      const p = input.patch ?? {};

      const theme = THEMES.includes(p.theme) ? p.theme : row.theme;
      const layout = LAYOUTS.includes(p.layout) ? p.layout : row.layout;
      const content = structuredClone(row.content);

      if (typeof p.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(p.accent)) {
        content.style = { ...(content.style ?? {}), accent: p.accent };
      }
      if (Array.isArray(p.ranges) && Array.isArray(content.body?.variables)) {
        for (const r of p.ranges) {
          const v = content.body.variables.find((x: any) => x.key === r.key);
          if (!v || typeof r.min !== "number" || typeof r.max !== "number" || r.min >= r.max) continue;
          v.min = r.min; v.max = r.max;
          if (v.default < r.min || v.default > r.max) v.default = r.min;
        }
      }

      await admin.from("research_outputs").update({ theme, layout, content }).eq("id", row.id);
      await saveVersion(row, content, theme, layout);
      await admin.from("research_output_edits").insert({
        output_id: row.id, user_id: user.id, request: String(input.label ?? "바로 고치기").slice(0, 100), applied: true,
      });
      return json({ id: row.id, theme, layout, content, edits_left: 20 - row.edit_count });
    }

    // ── 3-2) edit: AI로 고치기 (20번 한도) ───────────────────
    // { mode: "edit", id, request: "제목을 더 짧게 해 줘" }
    if (input.mode === "edit") {
      const row = await loadOwn(input.id);
      if (!row?.slug) return json({ error: "먼저 결과물을 만들어 주세요" }, 404);
      const request = String(input.request ?? "").trim();
      if (!request || request.length > 200) return json({ error: "고칠 내용을 200자 안으로 적어 주세요" }, 400);
      if (row.edit_count >= 20) return json({ error: "말로 고치기 20번을 모두 썼어요", code: "EDIT_LIMIT" }, 403);

      const EDIT_SYSTEM = `${SYSTEM}
지금은 이미 만든 결과물의 "내용 JSON"을 학생 요청대로 고친다.
- 요청이 내용(제목, 문장, 숫자, 보기, 단계, 변수 등)으로 해결되면:
  {"applied":true,"content":{고친 전체 내용 JSON, 원래 칸 모양 유지}}
- 요청이 화면 틀로는 안 되는 것(새 애니메이션, 새로운 그래프 종류, 지도·사진 넣기, 화면 구조 변경 등)이면 내용을 바꾸지 말고:
  {"applied":false,"reason":"학생에게 보여줄 한 줄 설명"}`;

      const ai = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
        body: JSON.stringify({
          model: "gpt-5",
          reasoning_effort: "low",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: EDIT_SYSTEM },
            { role: "user", content: `결과물 종류: ${row.output_type}\n현재 내용: ${JSON.stringify(row.content)}\n학생 요청: ${request}` },
          ],
        }),
      });
      if (!ai.ok) return json({ error: "고치지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      const out = await ai.json();

      let result;
      try { result = JSON.parse(out.choices[0].message.content); }
      catch { return json({ error: "고친 내용 형식이 맞지 않아요. 다시 해 주세요" }, 502); }

      const editCount = row.edit_count + 1; // 틀로 안 되는 요청도 AI를 썼으니 1번으로 셈

      if (result.applied && result.content?.title && result.content?.body) {
        const content = { ...result.content, style: row.content?.style }; // 바로 고치기로 정한 색은 유지
        await admin.from("research_outputs").update({ content, edit_count: editCount }).eq("id", row.id);
        await saveVersion(row, content, row.theme, row.layout);
        await admin.from("research_output_edits").insert({ output_id: row.id, user_id: user.id, request, applied: true });
        return json({ id: row.id, applied: true, content, edits_left: 20 - editCount });
      }

      await admin.from("research_outputs").update({ edit_count: editCount }).eq("id", row.id);
      await admin.from("research_output_edits").insert({ output_id: row.id, user_id: user.id, request, applied: false });
      return json({
        id: row.id, applied: false, edits_left: 20 - editCount,
        reason: result.reason ?? "이 요청은 틀로는 어려워요",
        upsell: "맞춤 제작(4,900원)에서 이렇게 만들 수 있어요",
      });
    }

    return json({ error: "mode 값이 필요해요 (create / generate / quick / edit)" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "서버 오류가 났어요" }, 500);
  }
});