// 독서 흔한가 — 학생이 읽은 책이 얼마나 흔한지 진단
// 배포: npx supabase functions deploy reading --project-ref xhywexuazwipwvzrldwo
//
// 요청 { title, author?, department, grade, subject, client_id }  (로그인하면 Authorization 헤더로 본인 확인)
// 응답 { score, verdict_level, level, level_reason, reason, angles[], alternatives[], next, stats, remaining }
//      무료를 다 쓰면 { quota_exceeded: true, next_open }, 책이 아니면 { invalid: true }
// 무료: 회원 일주일에 2권(다 쓰면 친구 초대 1명당 2권 추가 — reading_bonus), 비회원 1권
//
// 책 통계는 책 데이터를 넣은 뒤 만드는 DB 함수 두 개에서 가져온다 (없으면 AI 판단만으로 동작)
//   reading_book_stats(p_title, p_department, p_subject) → { total, dept, subject_rank, subject_total }
//   reading_candidates(p_department, p_subject, p_exclude) → [{ title, author, dept_count }]  덜 흔한 책 후보

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODEL = "gpt-5-mini"; // 독서 진단은 판단이 복잡하지 않아 mini로 (gpt-5의 약 1/5 비용)
const WEEKLY = 2; // 회원: 일주일(최근 7일)에 2권 무료
const WEEK_MS = 7 * 24 * 3600 * 1000;
const ANON_LIMIT = 1; // 비회원: 브라우저당 1권 (전체 기간)

/*
 * 회원의 남은 독서 진단 — 최근 7일 무료 2권 + 친구 초대로 받은 추가 권수
 *  - 무료 2권: 최근 7일 안에 무료로 쓴 수를 뺀다. 가장 오래된 것이 7일 지나면 1권씩 다시 열린다
 *  - 추가 권수: reading_bonus(친구 초대 보상)에서 받은 수 − 추가로 쓴 수
 * 돌려주는 값: { weekly, bonus, next } — next는 다음 무료 1권이 열리는 시각 (무료가 남아 있으면 null)
 */
async function creditsOf(admin: any, userId: string) {
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const [{ data: recent }, { data: gained }, { count: bonusUsed }] = await Promise.all([
    admin.from("reading_queries").select("created_at").eq("user_id", userId).eq("used_bonus", false).gte("created_at", since).order("created_at", { ascending: true }),
    admin.from("reading_bonus").select("amount").eq("user_id", userId),
    admin.from("reading_queries").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("used_bonus", true),
  ]);
  const used = recent?.length ?? 0;
  const weekly = Math.max(0, WEEKLY - used);
  const bonus = Math.max(0, (gained ?? []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0) - (bonusUsed ?? 0));
  // 무료를 다 썼으면, 7일 전에 쓴 것 중 가장 오래된 것이 7일을 채우는 때 1권이 다시 열린다
  const next = weekly > 0 || !recent?.length ? null : new Date(new Date(recent[0].created_at).getTime() + WEEK_MS).toISOString();
  return { weekly, bonus, next };
}
const CACHE_DAYS = 30; // 같은 책·학과·과목·학년은 30일 동안 저장된 결과를 다시 쓴다 (AI 비용 아끼기)

const SYSTEM = `고등학생이 생기부 독서활동으로 읽은 책이 얼마나 흔한지 진단한다. JSON만 출력.

무효(책 제목이 아닌 말·의미 없는 문자열·부적절한 내용)면 {"invalid":true,"invalid_reason":"한 문장"}.

판단:
- [우리 데이터]가 있으면 가장 중요하게 쓴다. 같은 학과 기록에서 많이 나올수록 흔하다
- [우리 데이터]가 없으면 이 책이 이 학과·과목 지원자의 필독서·추천도서로 널리 알려졌는지로 판단한다
- score 0~100 (높을수록 흔함): 학과 필독서 대표작 85~100 / 자주 보이는 추천서 65~84 / 가끔 보이는 책 40~64 / 드문 책 15~39 / 거의 없는 책 0~14
- level: 이 학년·학과 학생 기준 책의 수준 "초급"(입문 교양서) | "중급"(개념을 깊이 다루는 교양서) | "고급"(전공 입문서·원전·논쟁적 학술서)

같은 책 다르게 읽기(angles) 3개 — 흔한 요약 대신 이 학생만의 독서가 되게:
- tag는 "과목 연결" / "비판적 읽기" / "진로 연결" 각 1개
- title은 무엇을 어떻게 읽을지 한 문장(30자 안팎), how는 구체적으로 무엇을 하면 되는지 한두 문장
- 책에 실제로 나오는 내용만 쓴다. 모르면 책의 핵심 주제 수준으로만 쓴다

덜 흔한 책(alternatives) 3권 — 초급·중급·고급 각 1권:
- [덜 흔한 책 후보]가 있으면 반드시 그 안에서만 고른다 (from_candidates true)
- 후보가 없으면 실제로 출간된 책만 쓴다. 조금이라도 확실하지 않으면 그 수준은 비운다 (지어내지 않는다)
- why는 이 학생이 왜 이 책을 읽으면 좋은지 한 문장

이어 읽기(next) 1권 — 이 책을 읽고 생길 질문 하나와, 그 질문 때문에 이어서 읽을 책:
- question은 "~일까?" 같은 학생의 질문 한 문장, why는 이어지는 이유 한 문장
- alternatives와 같은 책이어도 된다. 실제로 있는 책만

모든 글은 쉬운 말, "~예요" 존댓말. reason은 score와 맞게 2~3문장.

{"invalid":false,"title":"정확한 책 제목","author":"저자","score":0,"level":"초급","level_reason":"한 문장","reason":"",
"angles":[{"tag":"과목 연결","title":"","how":""},{"tag":"비판적 읽기","title":"","how":""},{"tag":"진로 연결","title":"","how":""}],
"alternatives":[{"level":"초급","title":"","author":"","why":"","from_candidates":false},{"level":"중급","title":"","author":"","why":"","from_candidates":false},{"level":"고급","title":"","author":"","why":"","from_candidates":false}],
"next":{"question":"","title":"","author":"","why":""}}`;

async function ask(user: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
    body: JSON.stringify({
      model: MODEL,
      max_completion_tokens: 8000,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("openai error", res.status, body.slice(0, 800));
    return null;
  }
  try {
    return JSON.parse(JSON.parse(body).choices?.[0]?.message?.content ?? "");
  } catch (e) {
    console.error("parse failed", e);
    return null;
  }
}

/* 흔함 지수 → 판정 단계 (문구는 화면에서) */
function verdictLevel(score: number) {
  if (score >= 85) return 4; // 아주 흔해요
  if (score >= 65) return 3; // 흔한 편이에요
  if (score >= 40) return 2; // 조금 흔해요
  if (score >= 15) return 1; // 괜찮은 편이에요
  return 0; // 드문 편이에요
}

const clean = (v: unknown, n = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/*
 * 친구 추천 보상 — 추천 링크로 가입한 친구가 이 진단을 처음 하면, 추천한 학생에게 추가 횟수를 준다
 * referrals: { referrer_id(추천한 학생), referred_user_id(가입한 친구) } — 탐구주제 추천과 같은 표
 * 같은 친구로는 한 번만 (bonus 표의 user_id+friend_id 중복 막기), 자기 자신은 제외
 */
async function rewardReferrer(admin: any, friendId: string, table: string, bonusTable: string, amount: number) {
  try {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", friendId);
    if ((count ?? 0) !== 1) return; // 방금 한 것이 이 친구의 첫 진단일 때만
    const { data: ref } = await admin
      .from("referrals").select("referrer_id").eq("referred_user_id", friendId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!ref?.referrer_id || ref.referrer_id === friendId) return;
    const { error } = await admin.from(bonusTable).insert({ user_id: ref.referrer_id, friend_id: friendId, amount, reason: "referral" });
    if (error && !String(error.message).includes("duplicate")) console.warn("referral bonus failed", error);
  } catch (e) {
    console.warn("referral bonus failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user ?? null; // 비회원이면 null

    const body = await req.json();
    const title = clean(body.title, 80);
    const author = clean(body.author, 40);
    const department = clean(body.department, 40);
    const grade = clean(body.grade, 10);
    const subject = clean(body.subject, 40);
    const clientId = clean(body.client_id, 64);
    if (title.length < 1) return json({ error: "책 제목을 적어 주세요." }, 400);
    if (!user && !clientId) return json({ error: "잠시 후 다시 시도해 주세요." }, 400);

    // 관리자는 횟수 제한 없음
    let isAdmin = false;
    if (user) {
      const { data } = await admin.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      isAdmin = Boolean(data);
    }

    // 남은 횟수 — 회원: 이번 주 무료 2권 먼저, 다 쓰면 친구 초대로 받은 추가 권수 / 비회원: 1권
    let credit = { weekly: 0, bonus: 0, next: null as string | null };
    let anonLeft = 0;
    if (user) credit = await creditsOf(admin, user.id);
    else {
      const { count } = await admin.from("reading_queries").select("id", { count: "exact", head: true }).is("user_id", null).eq("client_id", clientId);
      anonLeft = Math.max(0, ANON_LIMIT - (count ?? 0));
    }
    const canUse = isAdmin || (user ? credit.weekly + credit.bonus > 0 : anonLeft > 0);
    if (!canUse) {
      return json({ quota_exceeded: true, is_member: Boolean(user), next_open: credit.next, weekly: WEEKLY });
    }
    const useBonus = Boolean(user) && !isAdmin && credit.weekly <= 0; // 이번 주 무료를 다 썼으면 추가 권수에서 쓴다

    // 같은 책·학과·과목·학년을 최근에 진단했으면 그 결과를 다시 쓴다
    const since = new Date(Date.now() - CACHE_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: cached } = await admin
      .from("reading_queries")
      .select("result")
      .ilike("title", title)
      .eq("department", department)
      .eq("subject", subject)
      .eq("grade", grade)
      .not("result", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let result: any = cached?.result ?? null;

    if (!result) {
      // 우리 데이터 — 책 데이터를 넣은 뒤 만드는 DB 함수. 아직 없으면 null (AI 판단만)
      let stats: any = null;
      let candidates: any[] = [];
      const st = await admin.rpc("reading_book_stats", { p_title: title, p_department: department, p_subject: subject });
      if (!st.error && st.data) stats = st.data;
      const cand = await admin.rpc("reading_candidates", { p_department: department, p_subject: subject, p_exclude: title });
      if (!cand.error && Array.isArray(cand.data)) candidates = cand.data.slice(0, 30);

      const ai = await ask(
        `[학생]
희망 학과: ${department}
학년: ${grade}
과목: ${subject}
읽은 책: ${title}${author ? ` (저자: ${author})` : ""}

[우리 데이터] ${stats ? JSON.stringify(stats) : "(아직 없음 — 널리 알려진 정도로 판단)"}

[덜 흔한 책 후보] ${
          candidates.length ? candidates.map((c: any) => `${c.title}${c.author ? ` / ${c.author}` : ""} (같은 학과 ${c.dept_count ?? 0}번)`).join("; ") : "(없음)"
        }`
      );
      if (!ai) return json({ error: "진단하지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
      if (ai.invalid) return json({ invalid: true, invalid_reason: clean(ai.invalid_reason, 120) });

      const score = Math.max(0, Math.min(100, Math.round(Number(ai.score) || 0)));
      const LV = ["초급", "중급", "고급"];
      // 후보 목록에서 고른 책이면 같은 학과 기록 수를 붙인다
      const countOf = (t: string) => candidates.find((c: any) => String(c.title).trim() === String(t).trim())?.dept_count ?? null;
      result = {
        title: clean(ai.title, 80) || title,
        author: clean(ai.author, 40) || author,
        score,
        verdict_level: verdictLevel(score),
        level: LV.includes(ai.level) ? ai.level : "중급",
        level_reason: clean(ai.level_reason, 160),
        reason: clean(ai.reason, 500),
        angles: (ai.angles ?? []).slice(0, 3).map((a: any) => ({ tag: clean(a.tag, 12), title: clean(a.title, 80), how: clean(a.how, 240) })),
        alternatives: (ai.alternatives ?? [])
          .filter((b: any) => b?.title && LV.includes(b.level))
          .slice(0, 3)
          .map((b: any) => ({
            level: b.level,
            title: clean(b.title, 80),
            author: clean(b.author, 40),
            why: clean(b.why, 200),
            verified: Boolean(b.from_candidates && countOf(b.title) != null), // 우리 데이터에 있는 책
            dept_count: countOf(b.title),
          })),
        next: ai.next?.title
          ? { question: clean(ai.next.question, 120), title: clean(ai.next.title, 80), author: clean(ai.next.author, 40), why: clean(ai.next.why, 200) }
          : null,
        stats, // { total, dept, subject_rank, subject_total } 또는 null
        has_data: Boolean(stats),
      };
    }

    await admin.from("reading_queries").insert({
      user_id: user?.id ?? null,
      client_id: clientId || null,
      title,
      author: author || null,
      department,
      grade,
      subject,
      result,
      used_bonus: useBonus,
    });

    // 이 학생이 친구 추천으로 가입했고 이번이 첫 진단이면, 추천한 학생에게 +2권
    if (user) await rewardReferrer(admin, user.id, "reading_queries", "reading_bonus", 2);

    // 이번 진단을 쓴 뒤 남은 수 (회원: 방금 쓴 것까지 넣어 다시 계산)
    let remaining: number | null = null;
    let nextOpen: string | null = null;
    let bonusLeft = 0;
    if (!isAdmin) {
      if (user) {
        const c = await creditsOf(admin, user.id);
        remaining = c.weekly + c.bonus;
        bonusLeft = c.bonus;
        nextOpen = c.next;
      } else remaining = Math.max(0, anonLeft - 1);
    }
    return json({ ...result, remaining, bonus_left: bonusLeft, next_open: nextOpen, is_member: Boolean(user) });
  } catch (e) {
    console.error("unhandled", e);
    return json({ error: "서버 오류가 발생했습니다." }, 500);
  }
});