// 내 생기부 노트 — 활동 한 번에 정리하기
// 배포: npx supabase functions deploy note_import --project-ref xhywexuazwipwvzrldwo
//
// 학생이 생기부 내용을 통째로 붙여 넣으면, AI가 교과 세특·자율·동아리·진로·독서 칸으로 나누고
// 칸마다 '내가 한 일'을 내 말로 짧게 바꿔 돌려준다. 학생이 화면에서 확인한 뒤 저장한다 (저장은 note_add).
// 붙여 넣은 원문은 어디에도 저장하지 않는다 — 몇 글자·몇 칸이었는지만 note_imports 에 남긴다.
//
// 요청 { grade, text }   (로그인 필수 — Authorization 헤더)
// 응답 { items: [{ kind, subject, content, author }] }  또는 { invalid: true, reason } / { error }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5-mini";
const DAILY = 5; // 한 사람이 하루에 정리할 수 있는 횟수
const MAX_CHARS = 12000; // 고1 생기부 한 학년치가 넉넉히 들어가는 길이
const MIN_CHARS = 60;
const GRADES = ["고1", "고2", "고3"];
const KINDS = ["subject", "autonomy", "club", "career", "book"];

const SYSTEM = `고등학생이 자기 학교생활기록부(생기부) 한 학년치 내용을 붙여 넣는다. 이것을 '내 생기부 노트'의 칸으로 나누고, 칸마다 학생이 직접 한 일을 학생의 말로 짧게 요약한다. JSON만 출력.

생기부 내용이 아니거나(아무 말·장난·다른 글) 정리할 활동이 하나도 없으면 {"invalid":true,"reason":"한 문장"}.

칸 나누기 (kind):
- "subject": 교과 세부능력 및 특기사항. 과목마다 1칸. subject에 과목 이름 (예: "공통국어", "통합과학", "정보"). "통합과학1·2", "공통수학1, 2"처럼 1·2로 나뉜 과목은 하나로 합쳐 "통합과학", "공통수학"으로 쓴다
- "autonomy": 자율·자치활동 (봉사활동도 여기)
- "club": 동아리활동
- "career": 진로활동
- "book": 독서 (책마다 1칸, content=책 제목, author=저자. 없으면 빈 문자열)
- 행동특성 및 종합의견, 성적, 출결, 수상, 인적사항은 넣지 않는다
- 같은 칸 내용이 여러 번 나오면 하나로 합친다

요약 규칙 (content, book 제외):
- 학생이 '직접 한 일'만: 무엇을 주제로, 무엇을 했고, 무엇을 알게 됐는지. 50~110자, "~함"으로 끝나는 한 문장 또는 두 문장
- 생기부 문장을 그대로 옮기지 않는다. 같은 뜻을 다른 말로 짧게 바꾼다
- 선생님의 평가 말("성실함", "돋보임", "인상적임", "탁월함", "모범적임", "인기가 많음")은 모두 뺀다
- 사람 이름(학생·친구·교사), 학교 이름, 날짜·기간·시간(예: 2025.07.21., 22시간)은 모두 뺀다. 책·작품·이론·학자 이름은 남겨도 된다
- 내용에 없는 것을 지어내지 않는다

{"invalid":false,"items":[{"kind":"subject","subject":"통합과학","content":"","author":""}]}`;

/* AI 사용량 기록 — 관리자 화면의 'AI 비용·실패' 칸 */
const PRICE: Record<string, [number, number]> = { "gpt-5": [1.25, 10], "gpt-5-mini": [0.25, 2] };
async function logUsage(admin: any, userId: string, usage: any, ok: boolean) {
  try {
    const [pi, po] = PRICE[MODEL] ?? [0, 0];
    const inT = Number(usage?.prompt_tokens ?? 0);
    const outT = Number(usage?.completion_tokens ?? 0);
    await admin.from("ai_usage").insert({
      service: "note_import",
      user_id: userId,
      client_id: null,
      model: MODEL,
      input_tokens: inT,
      output_tokens: outT,
      cost_usd: (inT * pi + outT * po) / 1e6,
      ok,
    });
  } catch (e) {
    console.warn("usage log failed", e);
  }
}

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
// 1·2로 나뉜 과목 이름을 하나로 (통합과학1,2 → 통합과학)
//   생명과학Ⅰ·영어Ⅱ 처럼 원래 이름에 Ⅰ·Ⅱ가 붙는 과목은 그대로 둔다
const COMMON = /^(공통국어|공통수학|공통영어|통합사회|통합과학|한국사|과학탐구실험|기본수학|기본영어)\s*[12]$/;
const subjectName = (s: string) => {
  let t = clean(s, 30).replace(/\s*1\s*[,·・]\s*2\s*$/, "").trim(); // ~1,2 · ~1·2
  if (COMMON.test(t)) t = t.replace(/\s*[12]$/, "");
  return t;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "로그인이 필요해요." }, 401);

    const body = await req.json();
    const grade = GRADES.includes(String(body.grade)) ? String(body.grade) : "고1";
    const text = String(body.text ?? "").replace(/\r/g, "").trim().slice(0, MAX_CHARS);
    if (text.replace(/\s/g, "").length < MIN_CHARS) return json({ error: "활동 내용을 조금 더 붙여 넣어 주세요." }, 400);

    // 하루 횟수 제한 (관리자는 제한 없음)
    const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await admin.from("note_imports").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      if ((count ?? 0) >= DAILY) return json({ error: `활동 한 번에 정리하기는 하루 ${DAILY}번까지 할 수 있어요.` }, 429);
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: JSON.stringify({
        model: MODEL,
        max_completion_tokens: 12000,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `[학년] ${grade}\n[붙여 넣은 생기부]\n${text}` },
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
    if (!ai) {
      await admin.from("note_imports").insert({ user_id: user.id, grade, chars: text.length, items: 0, ok: false });
      return json({ error: "정리하지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
    }
    if (ai.invalid) return json({ invalid: true, reason: clean(ai.reason, 120) || "활동 내용으로 보기 어려워요." });

    // 정리된 칸 — 저장 규칙(note_add)에 맞게 다듬는다
    const seen = new Set<string>();
    const items = (Array.isArray(ai.items) ? ai.items : [])
      .filter((x: any) => KINDS.includes(x?.kind))
      .map((x: any) => {
        const kind = x.kind;
        const subject = kind === "subject" ? subjectName(x.subject) : "";
        const content = kind === "book" ? clean(x.content, 80) : clean(x.content, 300);
        const author = kind === "book" ? clean(x.author, 30) : "";
        return { kind, subject, content, author };
      })
      .filter((x: any) => x.content.length >= 4 && (x.kind !== "subject" || x.subject))
      .filter((x: any) => {
        const k = `${x.kind}|${x.subject}|${x.kind === "book" ? x.content : ""}`;
        if (x.kind !== "autonomy" && x.kind !== "club" && x.kind !== "career" && seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 40);

    await admin.from("note_imports").insert({ user_id: user.id, grade, chars: text.length, items: items.length, ok: true });
    return json({ items });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});