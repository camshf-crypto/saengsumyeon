// 내 생기부 노트 — AI 진단 (희망 학과 기준)
// 배포: npx supabase functions deploy note_diagnose --project-ref xhywexuazwipwvzrldwo
//
// 고1 13칸(교과 세특 10과목 + 자율·동아리·진로) 중 10칸 이상 채운 학생만.
// 희망 학과(1~3개)를 기준으로: 학과별 연결도 · 칸마다 학과와 이어지는지 · 학과가 보는 역량(충분/약함/비어 있음)
//   · 고2 선택과목 · 고2에 이어갈 탐구. 희망 학과를 못 정했으면 활동과 잘 맞는 학과 TOP 3.
// 학과가 보는 역량은 topic_db(학과별 세특 탐구 사례)에서 같은 학과 사례를 뽑아 기준으로 준다.
//
// 요청 { departments: string[], unsure: boolean, force?: boolean }   (로그인 필수)
// 응답 { result(무료 부분), departments, created_at, cached }  또는 { locked: true, done, total, need } / { error }
// 무료 부분: 연결도 · 요약 · 칸마다 · 역량 상태(채우는 방법 빼고) · 선택과목 1개 · 탐구 1개
// 전체 결과는 result_full 에만 저장한다 (학생 화면에서는 읽을 수 없음 — 고2 로드맵(유료)에서 쓴다)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5"; // 진단은 판단이 복잡해서 탐구주제 흔한가와 같은 gpt-5
const DAILY = 3; // 하루 새 진단 횟수 (활동이 그대로면 저장된 결과를 다시 보여 주고 횟수에 안 셈)
const NEED_SUBJECTS = 10; // 고1 교과 세특 과목 수
const UNLOCK_AT = 10; // 13칸 중 이만큼 채우면 진단 (화면과 같게)
const KIND_LABEL: Record<string, string> = { subject: "교과 세특", autonomy: "자율", club: "동아리", career: "진로", book: "독서" };

// 고2·고3에 고를 수 있는 2022 개정 선택과목 (물병 단어장에 넣은 이름과 같게) — 이 안에서만 추천
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

const SYSTEM = `고등학생의 '내 생기부 노트'(학생이 자기 말로 요약한 활동)를 보고, 학생이 가고 싶은 학과 기준으로 진단한다. JSON만 출력.

원칙:
- 모든 판단은 [희망 학과] 기준이다. 일반적인 칭찬·조언이 아니라 "이 학과에 지원할 때 이 활동이 근거가 되는가"로 본다
- 학과가 보는 역량은 [같은 학과 탐구 사례]에 나오는 탐구 방향·역량을 바탕으로 정한다. 사례가 없으면 그 학과의 일반적인 전공 적합 역량으로 정한다
- 근거는 반드시 학생 활동에서 찾고, 활동 속 구체적인 말(책·이론·실험·주제 이름)을 짧게 인용한다. 활동에 없는 것을 지어내지 않는다
- 비어 있는 곳은 고칠 수 있는 것만, 혼내지 않는 말투로 쓴다
- 선택과목은 [고를 수 있는 선택과목] 목록에 있는 이름만 그대로 쓴다
- 탐구는 [다음 학년] 학생이 학교 수업·실험실·설문·공공데이터로 한 학기 안에 실제로 할 수 있는 수준으로만 쓴다 (대학원 수준 통계·모델링, 의료 현장 실험, 비싼 장비 금지)
- 대학 이름, 합격 가능성, 등급·점수 이야기는 하지 않는다
- 모든 글은 쉬운 말, "~예요/~해요"

출력:
- fit: 희망 학과마다 { department, level("높음"|"보통"|"낮음"), score(0~100, 학과와 활동이 이어지는 정도), line(왜 그런지 한 문장) }. 희망 학과가 없으면(아직 몰라요) 활동과 가장 잘 맞는 학과 3개를 같은 모양으로 (이때 department는 실제 대학 학과 이름)
- main: fit 중 진단의 기준이 될 학과 하나 (희망 학과가 있으면 1지망, 없으면 가장 잘 맞는 학과)
- summary: main 기준으로 지금까지 활동(고1, 적었으면 고2까지)이 어디로 모이는지 2문장
- cells: 고1 활동 칸마다 main 학과와의 연결 { label(과목 이름 또는 자율·동아리·진로), link("강함"|"약함"|"없음"), why(한 줄) }. 교과 세특은 과목마다 하나
- competencies: main 학과가 보는 역량 4개 { name(짧게), status("충분"|"약함"|"비어 있음"), evidence(근거 활동 한 줄, 없으면 빈 문자열), tip(채우는 방법 한 문장) }
- subjects: [다음 학년]에 고르면 좋은 선택과목 4개 { name, why(main 학과·학생 활동과 이어서 한 문장) }
- inquiries: [다음 학년]에 이어갈 탐구 3개 { subject(선택과목 이름), title(탐구 주제 한 줄), why(어떤 비어 있는 곳을 채우는지 한 문장) }
- other: 희망 학과가 2개 이상이면 학과 사이 차이를 한두 문장으로 (없으면 빈 문자열)

{"fit":[{"department":"","level":"높음","score":0,"line":""}],"main":"","summary":"",
"cells":[{"label":"","link":"강함","why":""}],
"competencies":[{"name":"","status":"충분","evidence":"","tip":""}],
"subjects":[{"name":"","why":""}],
"inquiries":[{"subject":"","title":"","why":""}],
"other":""}`;

/* AI 사용량 기록 */
const PRICE: Record<string, [number, number]> = { "gpt-5": [1.25, 10], "gpt-5-mini": [0.25, 2] };
async function logUsage(admin: any, userId: string, usage: any, ok: boolean) {
  try {
    const [pi, po] = PRICE[MODEL] ?? [0, 0];
    const inT = Number(usage?.prompt_tokens ?? 0);
    const outT = Number(usage?.completion_tokens ?? 0);
    await admin.from("ai_usage").insert({
      service: "note_diagnose", user_id: userId, client_id: null, model: MODEL,
      input_tokens: inT, output_tokens: outT, cost_usd: (inT * pi + outT * po) / 1e6, ok,
    });
  } catch (e) {
    console.warn("usage log failed", e);
  }
}

/* 무료로 보여 줄 부분만 */
function freePart(full: any) {
  return {
    ...full,
    competencies: (full.competencies ?? []).map(({ tip, ...c }: any) => c),
    subjects: (full.subjects ?? []).slice(0, 1),
    inquiries: (full.inquiries ?? []).slice(0, 1),
    locked: {
      subjects: Math.max(0, (full.subjects ?? []).length - 1),
      inquiries: Math.max(0, (full.inquiries ?? []).length - 1),
    },
  };
}

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const key = (s: string) => String(s || "").replace(/\s/g, "");

/* 고1이 몇 칸 채워졌는지 — 노트 화면과 같은 규칙 */
function g1Progress(rows: any[]) {
  const g1 = rows.filter((a) => a.grade === "고1");
  const subjects = new Set(g1.filter((a) => a.kind === "subject").map((a) => key(a.subject)).filter(Boolean)).size;
  const has = (k: string) => g1.some((a) => a.kind === k);
  const done = Math.min(subjects, NEED_SUBJECTS) + (has("autonomy") ? 1 : 0) + (has("club") ? 1 : 0) + (has("career") ? 1 : 0);
  return { done, total: NEED_SUBJECTS + 3, need: UNLOCK_AT };
}

/*
 * 같은 학과 탐구 사례 — topic_db 에서 학과 이름이 들어간 줄을 뽑는다
 * 표의 칸 이름이 무엇이든 동작하도록, 학과 칸 이름을 몇 가지 시도하고 글자 칸만 짧게 이어 붙인다
 */
const DEPT_COLS = ["department", "dept", "major", "학과", "dept_name", "department_name"];
async function deptCases(admin: any, dept: string) {
  const d = dept.replace(/(학과|학부|전공)$/, "");
  if (d.length < 2) return [];
  for (const col of DEPT_COLS) {
    const { data, error } = await admin.from("topic_db").select("*").ilike(col, `%${d}%`).limit(20);
    if (error) continue;
    return (data ?? []).map((row: any) =>
      Object.entries(row)
        .filter(([k, v]) => typeof v === "string" && v.trim() && !/(^id$|_id$|created|updated|embedding)/i.test(k))
        .map(([k, v]) => `${k}: ${clean(v, 120)}`)
        .join(" / ")
    );
  }
  return [];
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
    const unsure = Boolean(body.unsure);
    const departments: string[] = unsure
      ? []
      : Array.from(new Set((Array.isArray(body.departments) ? body.departments : []).map((d: unknown) => clean(d, 30)).filter(Boolean))).slice(0, 3) as string[];
    if (!unsure && !departments.length) return json({ error: "희망 학과를 하나 이상 적어 주세요." }, 400);

    // 내 활동 전체
    const { data: rows, error: rerr } = await admin
      .from("record_activities")
      .select("id, grade, kind, subject, content, author")
      .eq("user_id", user.id)
      .order("id", { ascending: true });
    if (rerr) throw rerr;
    const acts = rows ?? [];
    const prog = g1Progress(acts);
    if (prog.done < prog.need) return json({ locked: true, ...prog });

    // 고2 칸도 10칸 이상이면 다음 학년은 고3 (추천 과목·탐구를 고3 기준으로)
    const g2 = acts.filter((a: any) => a.grade === "고2");
    const g2Subjects = new Set(g2.filter((a: any) => a.kind === "subject").map((a: any) => key(a.subject)).filter(Boolean)).size;
    const g2Done = Math.min(g2Subjects, NEED_SUBJECTS) + ["autonomy", "club", "career"].filter((k) => g2.some((a: any) => a.kind === k)).length;
    const next = g2Done >= UNLOCK_AT ? "고3" : "고2";

    const sig = `${acts.length}-${acts[acts.length - 1]?.id ?? 0}`;
    const deptKey = unsure ? "" : departments.map(key).join(",");

    // 활동·학과가 그대로면 저장된 결과를 다시 보여 준다 (AI를 다시 돌리지 않음)
    const { data: last } = await admin
      .from("note_diagnoses")
      .select("result, departments, unsure, activity_sig, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sameDept = last && Boolean(last.unsure) === unsure && (last.departments ?? []).map(key).join(",") === deptKey;
    if (last?.result && sameDept && last.activity_sig === sig && (last.result.next ?? "고2") === next && !body.force) {
      return json({ result: last.result, departments: last.departments, unsure: last.unsure, created_at: last.created_at, cached: true });
    }

    // 하루 새 진단 횟수 (관리자는 제한 없음)
    const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await admin.from("note_diagnoses").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      if ((count ?? 0) >= DAILY) return json({ error: `진단은 하루 ${DAILY}번까지 새로 받을 수 있어요. 내일 다시 해 주세요.` }, 429);
    }

    // 같은 학과 탐구 사례 (학과마다 최대 20개)
    const refs: string[] = [];
    for (const d of departments) {
      const cases = await deptCases(admin, d);
      if (cases.length) refs.push(`[${d}]\n${cases.map((c: string) => `- ${c}`).join("\n")}`);
    }

    const actText = ["고1", "고2", "고3"]
      .map((g) => {
        const list = acts.filter((a: any) => a.grade === g);
        if (!list.length) return "";
        return `[${g}]\n` + list.map((a: any) => `- ${KIND_LABEL[a.kind] ?? a.kind}${a.subject ? `(${a.subject})` : ""}: ${clean(a.content, 300)}${a.author ? ` / ${clean(a.author, 30)}` : ""}`).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 16000,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `[다음 학년] ${next}${next === "고3" ? " (고3 1학기가 수시에 들어가는 마지막 기록 — 고1·고2 흐름을 마무리하는 쪽으로)" : ""}

[희망 학과] ${unsure ? "아직 못 정함 — 활동과 잘 맞는 학과 3개를 찾아 줘" : departments.map((d, i) => `${i + 1}지망 ${d}`).join(", ")}

[고를 수 있는 선택과목] ${SUBJECTS.join(", ")}

[같은 학과 탐구 사례]
${refs.length ? refs.join("\n\n") : "(없음 — 학과의 일반적인 전공 적합 역량으로 판단)"}

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
    if (!ai) return json({ error: "진단하지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);

    const LEVEL = ["높음", "보통", "낮음"];
    const LINK = ["강함", "약함", "없음"];
    const STATUS = ["충분", "약함", "비어 있음"];
    const full = {
      fit: (ai.fit ?? []).slice(0, 3).map((f: any) => ({
        department: clean(f.department, 30),
        level: LEVEL.includes(f.level) ? f.level : "보통",
        score: Math.max(0, Math.min(100, Math.round(Number(f.score) || 0))),
        line: clean(f.line, 160),
      })).filter((f: any) => f.department),
      main: clean(ai.main, 30) || departments[0] || "",
      summary: clean(ai.summary, 300),
      cells: (ai.cells ?? []).slice(0, 16).map((c: any) => ({ label: clean(c.label, 20), link: LINK.includes(c.link) ? c.link : "약함", why: clean(c.why, 120) })).filter((c: any) => c.label),
      competencies: (ai.competencies ?? []).slice(0, 4).map((c: any) => ({
        name: clean(c.name, 30),
        status: STATUS.includes(c.status) ? c.status : "약함",
        evidence: clean(c.evidence, 140),
        tip: clean(c.tip, 160),
      })).filter((c: any) => c.name),
      subjects: (ai.subjects ?? []).filter((s: any) => SUBJECTS.includes(clean(s.name, 30))).slice(0, 4).map((s: any) => ({ name: clean(s.name, 30), why: clean(s.why, 160) })),
      inquiries: (ai.inquiries ?? []).slice(0, 3).map((q: any) => ({ subject: clean(q.subject, 30), title: clean(q.title, 80), why: clean(q.why, 160) })).filter((q: any) => q.title),
      other: clean(ai.other, 240),
      next, // 추천이 어느 학년 기준인지 (고2 | 고3)
      ref_count: refs.length, // 같은 학과 사례를 찾은 학과 수 (화면에 '생수면 데이터 기준' 표시용)
    };

    const { data: saved } = await admin
      .from("note_diagnoses")
      .insert({ user_id: user.id, departments, unsure, activity_count: acts.length, activity_sig: sig, result: freePart(full), result_full: full })
      .select("created_at")
      .single();

    return json({ result: freePart(full), departments, unsure, created_at: saved?.created_at ?? new Date().toISOString(), cached: false });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});