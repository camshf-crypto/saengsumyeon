// 📚 전국 공부법 도감 — 모의고사 성적표로 과목 등급 인증
// 배포: npx supabase functions deploy study_verify --project-ref xhywexuazwipwvzrldwo
// 비밀값: OPENAI_API_KEY (다른 함수와 같은 키)
//
// 요청 (로그인 필수)
//   { action: "verify", path }               학생: 저장소 study-verify/<내 id>/... 에 올린 사진을 AI가 읽는다
//                                            → 확실하면 바로 인증 · 애매하면 관리자 확인 대기
//   { action: "decide", id, approve, grades?, reason? }   관리자: 승인 / 반려 (grades 로 등급을 고쳐서 승인 가능)
//   { action: "image", id }                  관리자: 확인용 사진 주소 (10분)
//
// 원칙: 사진은 인증이 끝나면(자동 승인 · 반려 · 관리자 결정) 바로 지운다. 등급 숫자와 시험 이름만 남긴다

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BUCKET = "study-verify";
const MODEL = "gpt-4o";
const SUBJECTS = ["국어", "수학", "영어", "사회탐구", "과학탐구"];
const DAILY_LIMIT = 3;

const SYSTEM = `너는 한국 고등학생 모의고사 성적표 사진을 읽는 검사원이다.
사진이 다음 중 하나인지 판단한다:
- 시도교육청 전국연합학력평가(학력평가) 개인 성적표 또는 성적 확인 화면
- 한국교육과정평가원 모의평가 개인 성적표 또는 성적 확인 화면
학교 내신 성적표, 생활기록부, 학원 자체 시험, 손으로 쓴 메모는 성적표가 아니다.

과목 등급을 아래 5개 이름으로만 정리한다 (사진에 있는 것만):
- 국어, 수학, 영어
- 사회탐구: 통합사회, 생활과 윤리, 윤리와 사상, 한국지리, 세계지리, 동아시아사, 세계사, 경제, 정치와 법, 사회·문화 중 등급이 가장 좋은 것
- 과학탐구: 통합과학, 물리학, 화학, 생명과학, 지구과학(Ⅰ·Ⅱ) 중 등급이 가장 좋은 것
한국사·제2외국어는 넣지 않는다. 등급은 1~9 정수. 점수·백분위가 아니라 '등급' 칸의 숫자만 쓴다.

조작 의심: 숫자 글꼴·크기·색이 주변과 다르거나, 칸이 어긋나거나, 같은 성적표 안에서 서로 맞지 않는 값(예: 원점수와 등급이 크게 어긋남)이 있으면 true.
이름·학교·수험번호가 가려지지 않고 읽히면 name_visible=true.

json 으로만 답한다:
{"is_report":true,"kind":"학력평가|모의평가|기타","year":2026,"month":9,"school_year":"고2","grades":{"국어":2,"수학":1},"edited_suspect":false,"name_visible":false,"confidence":0.0,"note":"한 줄 설명"}`;

/* AI 사용량 기록 (실패해도 인증에는 영향 없음) */
const PRICE: Record<string, [number, number]> = { "gpt-4o": [2.5, 10] };
async function logUsage(db: any, userId: string, usage: any, ok: boolean) {
  try {
    const [pi, po] = PRICE[MODEL] ?? [0, 0];
    const inT = Number(usage?.prompt_tokens ?? 0), outT = Number(usage?.completion_tokens ?? 0);
    await db.from("ai_usage").insert({ service: "study_verify", user_id: userId, model: MODEL, input_tokens: inT, output_tokens: outT, cost_usd: (inT * pi + outT * po) / 1e6, ok });
  } catch (e) {
    console.warn("usage log failed", e);
  }
}

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function cleanGrades(g: any) {
  const out: Record<string, number> = {};
  for (const k of SUBJECTS) {
    const v = Number(g?.[k]);
    if (Number.isInteger(v) && v >= 1 && v <= 9) out[k] = v;
  }
  return out;
}

async function readReport(db: any, userId: string, img: Blob) {
  const mime = img.type || "image/jpeg";
  const b64 = toBase64(await img.arrayBuffer());
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: [
          { type: "text", text: "이 사진을 읽고 json 으로 답해 줘." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
        ] },
      ],
    }),
  });
  const data = await res.json().catch(() => null);
  await logUsage(db, userId, data?.usage, res.ok);
  if (!res.ok) throw new Error("성적표를 읽지 못했어요. 잠시 후 다시 해 주세요");
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    throw new Error("성적표를 읽지 못했어요. 더 밝고 선명한 사진으로 다시 올려 주세요");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: "로그인이 필요해요" }, 401);
    const body = await req.json().catch(() => ({}));
    const isAdmin = async () => !!(await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()).data;
    const removeImage = async (path?: string | null) => {
      if (path) await db.storage.from(BUCKET).remove([path]).catch(() => null);
    };

    // ── 학생: 인증 요청
    if (body.action === "verify") {
      const path = String(body.path ?? "");
      if (!path.startsWith(`${user.id}/`)) return json({ error: "사진을 다시 올려 주세요" }, 400);

      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await db.from("study_verifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
      if ((count ?? 0) >= DAILY_LIMIT) {
        await removeImage(path);
        return json({ error: `인증은 하루 ${DAILY_LIMIT}번까지 할 수 있어요` }, 429);
      }
      const { data: pend } = await db.from("study_verifications").select("id").eq("user_id", user.id).eq("status", "pending").limit(1);
      if (pend?.length) {
        await removeImage(path);
        return json({ error: "확인 중인 인증이 있어요. 끝나면 다시 해 주세요" }, 409);
      }

      const { data: img, error: dlErr } = await db.storage.from(BUCKET).download(path);
      if (dlErr || !img) return json({ error: "사진을 찾을 수 없어요. 다시 올려 주세요" }, 400);

      let ai: any;
      try {
        ai = await readReport(db, user.id, img);
      } catch (e) {
        await removeImage(path);
        return json({ error: (e as Error).message }, 502);
      }

      const grades = cleanGrades(ai?.grades);
      const y = Number(ai?.year), m = Number(ai?.month);
      const examMonth = y >= 2020 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}-01` : null;
      const ageDays = examMonth ? (Date.now() - new Date(examMonth).getTime()) / 86400000 : 9999;
      const exam = examMonth ? `${y}년 ${m}월 ${ai?.school_year ?? ""} ${ai?.kind === "모의평가" ? "모의평가" : "학력평가"}`.replace(/\s+/g, " ") : null;

      // 🧪 테스트 중: 1년 제한 끔 — 실제로 열 때 true 로 바꾸고 다시 배포
      const AGE_LIMIT = false;
      // 판단: 성적표가 아니면 반려 · 확실하면 자동 인증 · 애매하면 관리자 확인
      let status = "pending";
      let reason: string | null = null;
      if (!ai?.is_report || ai?.kind === "기타") {
        status = "rejected";
        reason = "모의고사(학력평가·모의평가) 성적표가 아닌 것 같아요";
      } else if (!Object.keys(grades).length) {
        status = "rejected";
        reason = "등급을 읽지 못했어요. 등급 칸이 잘 보이게 다시 찍어 주세요";
      } else if (AGE_LIMIT && ageDays > 430) {
        status = "rejected";
        reason = "최근 1년 안에 본 모의고사 성적표로 인증해 주세요";
      } else if (Number(ai?.confidence) >= 0.85 && !ai?.edited_suspect && ageDays >= -31) {
        status = "approved";
      }

      const { data: row, error } = await db.from("study_verifications").insert({
        user_id: user.id, status, image_path: status === "pending" ? path : null,
        exam, exam_month: examMonth, grades, ai, reason,
        decided_at: status === "pending" ? null : new Date().toISOString(),
      }).select("id").single();
      if (error) throw error;

      if (status === "approved") await db.rpc("study_apply_verification", { p_id: row.id });
      if (status !== "pending") await removeImage(path);

      return json({ status, exam, grades, reason, name_visible: !!ai?.name_visible });
    }

    // ── 관리자
    if (body.action === "decide" || body.action === "image") {
      if (!(await isAdmin())) return json({ error: "관리자만 할 수 있어요" }, 403);
      const { data: v } = await db.from("study_verifications").select("*").eq("id", body.id).maybeSingle();
      if (!v) return json({ error: "인증 요청을 찾을 수 없어요" }, 404);

      if (body.action === "image") {
        if (!v.image_path) return json({ url: null });
        const { data: s } = await db.storage.from(BUCKET).createSignedUrl(v.image_path, 600);
        return json({ url: s?.signedUrl ?? null });
      }

      if (v.status !== "pending") return json({ status: v.status });
      const approve = !!body.approve;
      const grades = body.grades ? cleanGrades(body.grades) : v.grades;
      if (approve && !Object.keys(grades).length) return json({ error: "등급을 하나 이상 넣어 주세요" }, 400);
      await db.from("study_verifications").update({
        status: approve ? "approved" : "rejected", grades,
        reason: approve ? null : String(body.reason || "성적표를 확인할 수 없었어요"),
        image_path: null, decided_at: new Date().toISOString(),
      }).eq("id", v.id);
      if (approve) await db.rpc("study_apply_verification", { p_id: v.id });
      await removeImage(v.image_path);
      return json({ status: approve ? "approved" : "rejected" });
    }

    return json({ error: "모르는 요청이에요" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "잠시 후 다시 해 주세요" }, 500);
  }
});