// 입시 상담 AI(에이전트) — 대학 입시 DB + 내 생수면 기록(생기부 노트·진단·예상질문·지원동기·성적)을 보고 답한다
// 배포: npx supabase functions deploy agent --project-ref xhywexuazwipwvzrldwo --use-api
// DB: sql/sm_76_univ_admission.sql · sm_77_univ_admission_results.sql · sm_78_agent.sql
//
// 요청 (로그인 필수 · Authorization 헤더)
//   { message, chat_id? }   → 답변 하나 (chat_id 가 없으면 새 대화)
// 응답 { chat_id, answer, usage }  · 이번 주 사용량을 다 쓰고 이용권도 없으면 { need_pay: true }
// 흔한가 진단·예상질문·꼬리질문도 여기서 부르고, 그 기능들의 무료 횟수 대신 이 주간 사용량(토큰 비용)으로 센다
//
// 사용량: 질문 개수가 아니라 실제 AI 비용(ai_usage)으로 센다 — 화면에는 '이번 주 사용량 ○%'와 초기화 시각만 보여 준다
//   무료 회원: 주간 한도 FREE_WON (+ 친구 1명 가입마다 FRIEND_WON, FRIEND_MAX명까지) · 무료 답 아래에는 광고(화면 Agent.jsx)
//   이용권(agent30·agent180·agent365 — _shared/pass.ts): 승인일부터 기간만큼 · 주간 한도 PAID_WON · 광고 없음
//   매주 월요일 0시(한국 시간)에 초기화
// 대학 자료는 AI가 필요할 때 도구(tool)로 DB에서 직접 찾는다 → 지어내지 않고 DB에 있는 것만 말한다


import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { passUntil } from "../_shared/pass.ts";
import { PROMPT_MODS, modsForTool, pickModules, studentContext, systemPrompt, updateMemory } from "./context.ts";
import { FREE_OPEN, HISTORY, MAX_ROUNDS, MODEL, cachedOf, chat, clean, cors, json, logUsage, matchUniv, openai } from "./core.ts";
import { importBoard, stepLabel } from "./extra.ts";
import { PLAN_GUIDE, PLAN_LINK_RULE, deptOf, hasPlan, makePlan, openingSteps, planAsk, planCard, planFromCard, planWeek, safe, saveWeek, weekStartKST } from "./plan.ts";
import { evalSchoolName, evalSubjects, gradeOf, monthPlan, openingOf, schoolMeta } from "./school.ts";
import { AREA_LABEL, ROUTINE_Q, SUBJ, SUBJECTS, TEST_DAYS, TEST_SUBJECTS, TRACK_LABEL, adherence, createTest, judge, proposeAction, quickForm, reviewOf, scoreOf, testTips, testView, tipsByIds } from "./study.ts";
import { suhaengChat } from "./suhaeng.ts";
import { TOPIC_QUOTA_MSG, callFn, formatCheck, pick, runTool } from "./tools.ts";
import { PLAN_CARD, route } from "./router.ts";
import { studyGate, studyQuota, usageOf } from "./usage.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(token);
    const user = u?.user;
    if (!user) return json({ error: "로그인하면 물꼬 입시 AI를 쓸 수 있어요", need_login: true }, 401);
    const body = await req.json().catch(() => ({}));

    // 남은 횟수만 묻기
    const paid = await passUntil(db, user.id);
    const usage = await usageOf(db, user.id, paid);
    // 이용권 전용 기능(공부법 도감 = 입시 플랜 · 학습 플랜 · 학습 다이어리 · 자기주도학습법)을 쓸 수 있나 — 이용권 또는 관리자
    const passOk = async () => FREE_OPEN || Boolean(paid) || Boolean((await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()).data);
    if (body.action === "status") return json({ usage, grade: await gradeOf(db, user.id, user.user_metadata ?? {}).catch(() => "") });
    // 물꼬가 먼저 말 걸기 (AI 안 부름 · 사용량 안 씀)
    // 입시 로드맵 '내 과목 고르기' — 가고 싶은 학과를 대학들이 권하는 과목 (univ_subject_reco · 2028학년도 권장과목)
    //   여러 대학 자료를 과목별로 모아 '핵심 n곳 · 권장 n곳' 많은 순 · 대학을 적으면 그 대학만
    if (body.action === "subject_reco") {
      const department = String(body.department ?? "").trim().slice(0, 30);
      const university = String(body.university ?? "").trim().slice(0, 30);
      if (!department || !university) return json({ list: [], note: "대학과 학과를 둘 다 알려 주세요" });
      // ① 대학 하나 고르기 — 권장과목 표에 있는 이름 중에서 (한양대 → 한양대학교, 'ERICA'를 적었을 때만 ERICA)
      const { data: names } = await db.from("univ_subject_reco").select("university").limit(5000);
      const all = [...new Set((names ?? []).map((r: any) => String(r.university)))] as string[];
      const sq = university.replace(/\s/g, ""), erica = /ERICA|에리카/i.test(sq);
      const short = (n: string) => n.replace(/\s/g, "").replace("여자대학교", "여대").replace("대학교", "대");
      const alias: Record<string, string> = { 고대: "고려대학교", 연대: "연세대학교", 성대: "성균관대학교", 숙대: "숙명여자대학교", 시립대: "서울시립대학교", 건대: "건국대학교", 동대: "동국대학교", 포스텍: "포항공과대학교", POSTECH: "포항공과대학교" };
      const key = (alias[sq.replace(/ERICA|에리카/i, "")] ?? sq.replace(/ERICA|에리카/i, "")).replace(/\s/g, "");
      const cands = all.filter((n) => { const k = n.replace(/\s/g, ""); return k === key || k === key + "학교" || short(n) === key || k.includes(key.replace(/(대학교|대)$/, "")); })
        .filter((n) => erica === /ERICA/i.test(n)).sort((x, y) => x.length - y.length);
      const uname = cands[0];
      if (!uname) return json({ list: [], note: `${university} 권장과목 자료가 아직 없어요`, univs: all.slice(0, 40) });
      const { data: rows0 } = await db.from("univ_subject_reco").select("university,campus,department,area,level,subjects,note").eq("university", uname).limit(400);
      const rows = (rows0 ?? []) as any[];
      // ② 학과 맞추기 — 같은 학과(기계공학과 ↔ 기계공학부) → 없으면 같은 계열 '전체' 줄 → 없으면 대학 안내
      const core = (x: string) => { const t = String(x ?? "").replace(/\s/g, ""); const c = t.replace(/(학과|학부|전공)$/, ""); return c.length >= 2 ? c : t.replace(/(과|부)$/, ""); };
      const partsOf = (d: string) => String(d ?? "").split(/[·,/()]| 및 /).map(core).filter((x) => x.length >= 2);
      const dq = core(department);
      // 이름이 같은 학과 먼저 (기계공학과 ↔ 기계공학부), 없으면 이름이 들어간 학과 (반도체공학과 ↔ 반도체시스템공학과)
      let hit = rows.filter((r) => partsOf(r.department).some((x) => x === dq));
      const exact = hit.length > 0;
      const loose = (x: string) => x.replace(/(공학|공|학)$/, "");
      const ld = loose(dq);
      if (!hit.length && ld.length >= 2) hit = rows.filter((r) => partsOf(r.department).some((x) => { const lx = loose(x); return lx.length >= 2 && (lx.startsWith(ld) || ld.startsWith(lx)); }) && !/전체|계열|전 모집단위|그 밖의/.test(String(r.department ?? "")));
      const NAT = /공학|공과|기계|전자|전기|컴퓨터|소프트|반도체|화학|물리|생명|수학|통계|의예|의학|약학|간호|수의|치의|한의|건축|에너지|신소재|재료|AI|인공지능|데이터|바이오|식품|환경|농|산림|원예|동물|자연|이학|과학|보건|방사선|우주|지구|항공|조선|해양|토목|건설|도시공학|산업공학/;
      const area = NAT.test(department) ? "자연" : "인문";
      if (!hit.length) hit = rows.filter((r) => /전체|계열|전 모집단위|전모집단위|그 밖의/.test(String(r.department ?? "")) && (r.area ? r.area === area : (area === "자연") === NAT.test(String(r.department ?? ""))));
      // 계열 줄이 여러 개면 학과 이름(경영 → '경영대학')이 적힌 줄을 먼저
      if (hit.length > 1 && ld.length >= 2) { const named = hit.filter((r) => String(r.department ?? "").includes(ld)); if (named.length) hit = named; }
      if (!hit.length) hit = rows.filter((r) => r.level === "안내" && /전체|전 모집단위|그 밖의/.test(String(r.department ?? "")) && !(area === "자연" ? /인문/ : /자연|공학/).test(String(r.department ?? "")));
      // ③ 학과 이름이 그대로 없으면 — AI가 이 대학 자료(계열 · 단과대학 · 비슷한 학과)에서 그 학과가 속한 줄을 고르고 이유를 쉬운 말로
      let why = "";
      if (!exact && rows.length) {
        const lines = [...new Map(rows.map((r) => [String(r.department ?? ""), r])).values()].slice(0, 150)
          .map((r: any) => `- ${r.department} [${r.level}] ${(Array.isArray(r.subjects) ? r.subjects.join(", ") : String(r.subjects ?? "")).slice(0, 90)}`).join("\n");
        const sys = `너는 고등학생에게 대학 권장과목을 알려 주는 입시 상담가다. [자료]는 ${uname}가 발표한 2028학년도 모집단위별 권장과목이다.
학생이 찾는 학과가 자료에 그대로 없을 수 있다. 그 학과가 이 대학에서 어느 줄에 해당하는지 고른다: 같은 학과의 다른 이름(학과↔학부↔전공), 그 학과가 속한 단과대학 · 계열(예: 기계공학과 → 공과대학 · 자연계열 · 공학계열 전체), 대학 전체 안내 순서로.
- pick 에는 [자료]의 '- ' 뒤 모집단위 이름을 글자 그대로 1~3개. 그 대학에 그 학과가 없고 계열 줄도 맞지 않으면 빈 배열.
- why 는 학생에게 하는 말 한두 문장 (존댓말 '~요'): 그 학과가 이 대학에서 어느 모집단위 · 계열로 보는지, 그래서 어떤 과목을 권하는지. 이 대학에 그 학과가 없으면 가까운 학과 이름을 알려 준다. 자료에 없는 과목 · 사실은 지어내지 않는다.
JSON만: {"pick": ["..."], "why": "..."}`;
        try {
          const res = await openai({ model: MODEL, reasoning_effort: "low", max_completion_tokens: 2000, response_format: { type: "json_object" },
            messages: [{ role: "system", content: sys }, { role: "user", content: `[자료]\n${lines}\n\n[학생이 찾는 학과] ${department}` }] });
          const j = await res.json();
          logUsage(db, user.id, j?.usage?.prompt_tokens ?? 0, j?.usage?.completion_tokens ?? 0, res.ok, "agent", cachedOf(j?.usage));
          const o = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
          const picked = (Array.isArray(o.pick) ? o.pick : []).map(String);
          const sel = rows.filter((r) => picked.includes(String(r.department ?? "")));
          if (sel.length) hit = sel;
          else if (Array.isArray(o.pick) && !o.pick.length && !hit.length) hit = [];
          why = clean(o.why, 300);
        } catch (e) { console.error("subject_reco ai", e); }
      }
      const split = (v: any): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/,\s*/)).map((x) => x.replace(/[()]/g, "").trim()).filter((x) => x.length >= 2 && x.length <= 20);
      const by = new Map<string, { name: string; core: number; reco: number }>();
      for (const r of hit) for (const n of split(r.subjects)) {
        const k = n.replace(/\s/g, "");
        if (!by.has(k)) by.set(k, { name: n, core: 0, reco: 0 });
        r.level === "핵심" ? by.get(k)!.core++ : by.get(k)!.reco++;
      }
      const list = [...by.values()].sort((x, y) => (y.core ? 1 : 0) - (x.core ? 1 : 0)).slice(0, 25);
      const notes = [...new Set(hit.map((r) => String(r.note ?? "").trim()).filter(Boolean))].slice(0, 3);
      const matched = [...new Set(hit.map((r) => String(r.department ?? "")))].slice(0, 3);
      return json({ department, university: uname, matched, exact, why, list, notes, note: list.length ? undefined : (notes[0] || why || `${uname} ${department} 권장과목 자료가 아직 없어요`) });
    }
    // 입시 로드맵 '내 과목 고르기' — 우리 학교 그 학년 평가계획 과목 (없으면 빈 목록 → 화면이 교육과정 기본 과목을 보여 준다)
    if (body.action === "school_subjects") {
      const meta = user.user_metadata ?? {};
      const g = Number(String(body.grade ?? "").match(/[123]/)?.[0] ?? 0) || Number(String(await gradeOf(db, user.id, meta).catch(() => "")).match(/[123]/)?.[0] ?? 0);
      const { school } = await schoolMeta(db, user.id, meta).catch(() => ({ school: "" }));
      const name = school ? await evalSchoolName(db, school).catch(() => "") : "";
      const { rows } = name && g ? await evalSubjects(db, name, g) : { rows: [] as any[] };
      const subjects = [...new Set(rows.map((r: any) => String(r.subject ?? "").trim()).filter(Boolean))].slice(0, 60);
      return json({ school: name || school || "", grade: g ? `고${g}` : "", subjects });
    }
    if (body.action === "month_plan") return json(await monthPlan(db, user).catch((e) => { console.error("month_plan", e); return { months: [] }; }));
    if (body.action === "opening") return json(await openingOf(db, user).catch((e) => { console.error("opening", e); return { text: "" }; }));

    // 면접 준비 화면(/prep) — 대학 하나의 면접 정보 (AI 안 부름 · 사용량 안 씀)
    //   { action: "univ_brief", university, department } → { university, style, rules, units, past(이 학교 기출 메인 질문), common(자주 나온 공통 기출 — 이 학교 기출이 적을 때), tracks(면접 있는 전형) }
    // 기출문제 학습(/prep) — 학생 답변 AI 피드백 (1차 · 최종). 학교별 답변 분석 기준(univ_answer_guides · sql/sm_85)으로 본다
    //   결제 없이 — 기출은 무료 3문제 + 친구 1명당 5문제 (studyQuota) · 생기부 예상질문(source interview)은 24,000원 결제한 학생만
    //   { action: "answer_feedback", university, department, question, kind, answer, round: 1|2, prev?, source: past|interview }
    //   → { feedback: { score, axes[{ name, weight, score }], school, criteria, strengths[3], improvements[3], questions[3], changed? }, quota }
    //   못 풀면 { need_invite, quota } (무료 문제를 다 씀) · { need_interview_pay } (예상질문인데 결제 전)
    //   축은 학교마다 다르다 — 그 학교 엑셀 평가요소 중 비중이 있는 것만 (예: 건국대 학업역량·공동체역량·진로)
    //   축 점수 = 그 기준을 이 답이 얼마나 채웠는지 0~100 · 종합 score = 학교 비중으로 가중 평균
    if (body.action === "answer_feedback") {
      const answer = String(body.answer ?? "").trim().slice(0, 1500);
      const question = clean(body.question, 300);
      if (answer.length < 15 || !question) return json({ error: "답변을 15자 이상 적어 주세요" }, 400);
      // 'ㅁㄴㅇㄹ' 같은 장난 답은 피드백 없이 돌려보낸다 (무료 문제도 안 씀) — 완성된 글자(한글 음절·영문)가 10자는 넘어야
      if ((answer.match(/[가-힣a-zA-Z]/g) ?? []).length < 10) return json({ error: "실제로 말하듯 문장으로 답해 주세요 (자음·모음만 쓴 답은 볼 수 없어요)" }, 400);
      // 결제 없이 — 기출은 무료 문제 수(3 + 친구당 5), 예상질문은 24,000원 결제한 학생만 (에이전트 주간 사용량과 따로)
      const source = body.source === "interview" ? "interview" : "past";
      const uname = clean(body.university, 40);
      const gate: any = await studyGate(db, user.id, uname, question, source);
      if (!gate.ok) {
        if (gate.need === "invite") return json({ need_invite: true, quota: gate.quota });
        if (gate.need === "school") return json({ need_school_pay: true, quota: gate.quota });
        if (gate.need === "school_max") return json({ error: `기출문제 학습은 학교 ${gate.quota.school_limit}곳까지예요`, quota: gate.quota });
        return json({ need_interview_pay: true, quota: gate.quota });
      }
      const round = Number(body.round) === 2 ? 2 : 1;
      const DEFAULT_AXES = ["인성", "전공적합성", "학업역량", "공동체역량", "진로", "자기주도"];

      // 학교 기준 찾기 — "단국대학교(죽전)" · "단국대" · "서울과기대" 도 맞춘다
      const bkey = (v: string) => String(v ?? "").replace(/\(.*?\)/g, "").replace(/\s/g, "").replace(/대학교$|대학$/, "대");
      let { data: guide } = await db.from("univ_answer_guides").select("*").eq("university", uname).maybeSingle();
      if (!guide) {
        const { data: all } = await db.from("univ_answer_guides").select("university").limit(500);
        const hit = (all ?? []).find((g: any) => bkey(g.university) === bkey(uname))
          ?? (all ?? []).find((g: any) => bkey(g.university).startsWith(bkey(uname)) || bkey(uname).startsWith(bkey(g.university)));
        if (hit) ({ data: guide } = await db.from("univ_answer_guides").select("*").eq("university", hit.university).maybeSingle());
      }
      const w = (guide?.weights ?? {}) as Record<string, number>;
      // 이 학교 평가요소 (비중 큰 순) — 자료가 없으면 일반 6축을 같은 비중으로
      const AXES = Object.entries(w).filter(([, v]) => Number(v) > 0).sort((x, y) => Number(y[1]) - Number(x[1])).map(([k]) => k);
      const weightOf: Record<string, number> = AXES.length ? Object.fromEntries(AXES.map((k) => [k, Number(w[k])])) : Object.fromEntries(DEFAULT_AXES.map((k) => [k, 1]));
      if (!AXES.length) AXES.push(...DEFAULT_AXES);
      const wLine = Object.entries(w).filter(([, v]) => Number(v) > 0).sort((x, y) => Number(y[1]) - Number(x[1])).map(([k, v]) => `${k} ${v}%`).join(", ");
      const univLine = guide
        ? `[${guide.university} 답변 평가 기준]
- 면접관 핵심 관점: ${guide.view}
- 질문 출제 특징: ${guide.question_style}
- 고득점 답변 구성: ${guide.best_answer}
- 선호하는 학생: ${guide.preferred}
- 평가톤: ${guide.tone}
- 평가요소 비중: ${wLine || "자료 없음"}`
        : `[학교 기준 자료 없음 — 일반 학생부종합 면접 기준(인성·전공적합성·학업역량·공동체·진로·자기주도)으로 본다]`;

      const sys = `너는 한국 대학 수시 면접(학생부종합) 평가위원이다. 고등학생이 기출 질문에 쓴 답변을 위 학교의 평가 기준으로 분석한다. JSON만 출력.
규칙:
- 학생 답을 대신 써 주지 않는다. 학생이 말하지 않은 경험·사실을 지어내지 않는다.
- axes: 이 학교 평가요소(${AXES.join(", ")})마다, 이 답변이 그 요소를 이 학교 기준(핵심 관점 · 고득점 답변 구성)으로 얼마나 보여 줬는지 0~100 정수.
  · 그 요소가 답에 거의 안 드러나면 낮게(0~30), 말로만 있으면 중간(30~60), 구체적 상황·행동·결과로 보이면 높게(60~100).
  · 질문에 맞지 않는 답, 너무 짧은 답(1분 250~350자 기준)은 전체적으로 낮게.
- criteria: '평가 기준 요약' 4~6문장. 이 학교가 이 문항에서 무엇을 보는지(학교 기준을 이 질문에 적용)와, 그 기준에서 이 답변이 어떻게 보이는지. "~한다/~이다" 평서문.
- strengths 3개: 강점 포인트. 답변 속 실제 내용에 근거한 한 문장씩, "~했다/~보인다" 평서문.
- improvements 3개: 개선 포인트. 이 학교 기준으로 무엇을 더 보여 줘야 하는지 한 문장씩, "~할 필요가 있다/~해야 한다" 평서문.
- questions 3개: 사유하는 질문. 학생이 답을 보완하려고 스스로 생각해 볼 질문, "~인가?" 형태. 학생 답의 소재를 그대로 짚는다.
${round === 2 ? "- 이번은 2차(최종) 답변이다. 1차 분석을 얼마나 반영했는지 보고 changed 에 나아진 점 한 문장(평서문). 남은 아쉬운 점만 improvements 에." : ""}
{"axes":{${AXES.map((a) => `"${a}":0`).join(",")}},"criteria":"","strengths":["","",""],"improvements":["","",""],"questions":["","",""]${round === 2 ? ',"changed":""' : ""}}`;
      const prompt = `${univLine}

[지원] ${uname} ${clean(body.department, 40)}
[질문 · ${clean(body.kind, 20) || "면접"}] ${question}
${round === 2 && body.prev ? `[1차 분석] ${clean(JSON.stringify({ score: body.prev.score, improvements: body.prev.improvements ?? body.prev.fix }), 700)}\n` : ""}[학생 답변 ${answer.length}자]
${answer}`;
      const res = await openai({ model: MODEL, max_completion_tokens: 5000, reasoning_effort: "low", response_format: { type: "json_object" },
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }] });
      const raw = await res.text();
      let out: any = null, inT = 0, outT = 0;
      try {
        const j = JSON.parse(raw);
        inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0);
        out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
      } catch { console.error("feedback", res.status, raw.slice(0, 400)); }
      await logUsage(db, user.id, inT, outT, Boolean(out), "prep"); // 기출 학습 비용은 따로 (에이전트 주간 사용량에 안 들어감)
      if (!out) return json({ error: "피드백을 만들지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v : []).map((x) => clean(x, 160).replace(/^["“”']+|["“”']+$/g, "")).filter(Boolean).slice(0, n);
      // 축 점수 0~100 · 종합 = 학교 비중으로 가중 평균 (계산은 서버가 — AI 숫자가 어긋나도 맞게)
      const axes = AXES.map((k) => ({ name: k, weight: weightOf[k], score: Math.max(0, Math.min(100, Math.round(Number(out.axes?.[k]) || 0))) }));
      const wsum = axes.reduce((x, a) => x + a.weight, 0) || 1;
      const feedback = {
        score: Math.round(axes.reduce((x, a) => x + a.weight * a.score, 0) / wsum),
        axes: axes.map((a) => ({ ...a, weight: Math.round((a.weight * 100) / wsum) })),
        school: guide?.university ?? null,
        criteria: clean(out.criteria, 900),
        strengths: arr(out.strengths, 3),
        improvements: arr(out.improvements, 3),
        questions: arr(out.questions, 3),
        changed: round === 2 ? clean(out.changed, 200) : undefined,
      };
      // 처음 피드백을 받은 문제면 한 줄 적는다 (이 문제의 2차 · 꼬리질문은 더 세지 않음)
      if (gate.isNew || source === "interview") {
        const { error: uErr } = await db.from("prep_study_uses").insert({ user_id: user.id, university: uname, question, source });
        if (uErr && !String(uErr.message).includes("duplicate")) console.warn("study use", uErr);
      }
      return json({ feedback, quota: await studyQuota(db, user.id) });
    }

    // 기출문제 학습 남은 문제 수 { used, limit, left, friends, free, per_friend, interview_paid }
    if (body.action === "study_quota") return json({ quota: await studyQuota(db, user.id) });

    // 기출문제 학습 Step 5 — 문제마다 꼬리질문 1개 (tail 함수를 서버끼리 불러 꼬리질문 무료 개수를 쓰지 않는다)
    //   { action: "study_tail", univ, department, main_type, main_q, answer, source }
    if (body.action === "study_tail") {
      const source = body.source === "interview" ? "interview" : "past";
      const univ = clean(body.univ, 40), mainQ = clean(body.main_q, 300);
      const quota = await studyQuota(db, user.id);
      if (source === "interview" && !quota.interview_paid) return json({ need_interview_pay: true, quota });
      if (source === "past") {
        const { data: had } = await db.from("prep_study_uses").select("id").eq("user_id", user.id).eq("university", univ).eq("question", mainQ).maybeSingle();
        if (!had && !quota.interview_paid) return json({ error: "먼저 이 문제의 AI 피드백을 받아 주세요" }, 400);
      }
      const r = await callFn("tail", { action: "start", univ, department: clean(body.department, 40) || "미정", main_type: body.main_type, main_q: mainQ, answer: body.answer }, token, true);
      return json(r);
    }


    // 내 입시 플랜 (/plan) — 지금 플랜 · 이번 주 할 일 (AI 안 부름)
    //   { action: "plan_status" } → { plan, tasks, week_start, history[{ week_start, total, done, items }], need_week, profile: { grade, department }, notes }
    if (body.action === "plan_status") {
      const ws = weekStartKST();
      const [{ data: plan }, { data: my }, { data: prof }, { count: notes }] = await Promise.all([
        db.from("study_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("sm_my").select("grade,department").eq("user_id", user.id).maybeSingle(),
        db.from("profiles").select("grade").eq("id", user.id).maybeSingle(),
        db.from("record_activities").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      const { data: tasks } = plan ? await db.from("plan_tasks").select("id,title,detail,link,done,sort,week_start").eq("user_id", user.id).eq("week_start", ws).order("sort") : { data: [] };
      // 지난 미션 기록 — 주마다 몇 개 중 몇 개 했는지 (최근 8주)
      const { data: past } = plan ? await db.from("plan_tasks").select("title,done,week_start").eq("user_id", user.id).lt("week_start", ws).order("week_start", { ascending: false }).limit(60) : { data: [] };
      const hm: Record<string, any> = {};
      for (const t of past ?? []) { const w = (hm[t.week_start] ??= { week_start: t.week_start, total: 0, done: 0, items: [] }); w.total++; if (t.done) w.done++; w.items.push({ title: t.title, done: t.done }); }
      const history = Object.values(hm).sort((x: any, y: any) => (x.week_start < y.week_start ? 1 : -1)).slice(0, 8);
      return json({ plan, tasks: tasks ?? [], week_start: ws, history, need_week: Boolean(plan) && !(tasks ?? []).length, notes: notes ?? 0,
        profile: { grade: plan?.grade || my?.grade || prof?.grade || "", department: plan?.department || my?.department || user.user_metadata?.major || "" } });
    }

    // 학습 다이어리에 넣기 — { action: "routine_save", text: 물꼬가 짠 루틴 답변 } → { count }
    //   답변 글을 루틴 줄(무엇 · 언제 · 몇 분 · 어떻게 · 요일)로 바꿔 plan_routines 에 넣는다 (예전 루틴은 끈다 · 체크 기록은 남김)
    if (body.action === "routine_save") {
      if (!(await passOk())) return json({ need_pay: true, pass_only: "diary" }); // 학습 다이어리는 이용권 전용
      const text = String(body.text ?? "").replace(/\[\[[^\]]*\]\]/g, "").trim().slice(0, 4000);
      if (text.length < 20) return json({ error: "넣을 루틴이 없어요" }, 400);
      const sys = `학생에게 짜 준 공부 루틴 글을 매일 체크할 루틴 목록으로 바꾼다. JSON만 출력.
- 글에 있는 것만. 지어내지 않는다. 같은 일은 한 줄로 합친다. 최대 10개.
- title: 체크할 일 (20자 안팎, "수학 문제 10개 풀기"처럼 했는지 알 수 있게)
- how: 어떻게 하는지 한 줄 (글에 공부법이 있으면 그대로 쉽게, 없으면 "")
- time_label: 아침 · 오전 · 오후 · 저녁 · 밤 · 또는 글에 있는 시각 (없으면 "")
- minutes: 글에 있는 분 (없으면 0)
- days: 하는 요일 숫자 1(월)~7(일). 매일이면 [1,2,3,4,5,6,7], 월~금이면 [1,2,3,4,5], 토요일만이면 [6]
- subject: 국어 · 수학 · 영어 · 사회탐구 · 과학탐구 · 한국사 · 전과목 중 하나. title 에 과목 이름은 빼도 된다
  · 공부 내용(개념 · 문제 · 오답 · 지문 · 단어 · 기출 · 풀이 · 정리 · 복습)이면 줄에 과목 이름이 없어도 글 전체가 다루는 과목으로 넣는다 (국어 루틴의 '오답·헷갈린 표현 정리'는 국어)
  · 전과목은 기상 · 수면 · 휴식 · 플래너 쓰기처럼 과목과 상관없는 생활 습관에만 쓴다
- 체크리스트 · 규칙처럼 따로 적힌 것(기상 시간 지켰나 등)도 매일 할 일이면 넣는다
- unit: 이 루틴이 고치려는 단원 · 약점 하나 (예: "미적분 극한", "비문학 과학 지문"). 글에 없으면 ""
{"unit":"","routines":[{"subject":"","title":"","how":"","time_label":"","minutes":0,"days":[1,2,3,4,5]}]}`;
      const out = await planAsk(db, user.id, sys, text);
      const list = (Array.isArray(out?.routines) ? out.routines : []).map((r: any, i: number) => ({
        user_id: user.id, subject: SUBJECTS.includes(r?.subject) ? r.subject : "전과목",
        title: clean(r?.title, 60), how: clean(r?.how, 200), time_label: clean(r?.time_label, 12),
        minutes: Math.max(0, Math.min(600, Number(r?.minutes) || 0)),
        days: [...new Set((Array.isArray(r?.days) ? r.days : []).map(Number).filter((d: number) => d >= 1 && d <= 7))].sort(),
        sort: i,
      })).filter((r: any) => r.title).map((r: any) => ({ ...r, days: r.days.length ? r.days : [1, 2, 3, 4, 5, 6, 7] })).slice(0, 10);
      if (!list.length) return json({ error: "루틴으로 바꾸지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      // AI가 공부 줄을 '전과목'으로 놓쳤으면 바로잡는다 — 글의 주 과목(가장 많이 나온 과목)으로. 생활 습관은 그대로
      const HABIT = /기상|수면|잠|취침|일어나|휴식|쉬기|스트레칭|운동|산책|플래너|계획\s*세우|체크|물\s*마시|핸드폰|폰/;
      const STUDYISH = /개념|문제|오답|지문|단어|기출|풀이|풀기|정리|복습|예습|암기|독해|문법|표현|해설|공식|모의/;
      const counts: Record<string, number> = {};
      for (const r of list) if (r.subject !== "전과목") counts[r.subject] = (counts[r.subject] ?? 0) + 1;
      if (!Object.keys(counts).length) for (const [re, sub] of SUBJ) { const n = (text.match(new RegExp(re.source, "g")) ?? []).length; if (n) counts[sub] = (counts[sub] ?? 0) + n; }
      const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (main) for (const r of list) if (r.subject === "전과목" && !HABIT.test(r.title) && STUDYISH.test(`${r.title} ${r.how}`)) r.subject = main;
      // 같은 과목 루틴만 새것으로 바꾼다 (수학 넣은 뒤 국어 넣어도 수학은 그대로) · 전과목은 제목이 같은 것만
      const subs = [...new Set(list.map((r: any) => r.subject).filter((x: string) => x !== "전과목"))];
      if (subs.length) await db.from("plan_routines").update({ active: false }).eq("user_id", user.id).eq("active", true).in("subject", subs);
      const alls = list.filter((r: any) => r.subject === "전과목").map((r: any) => r.title);
      if (alls.length) await db.from("plan_routines").update({ active: false }).eq("user_id", user.id).eq("active", true).eq("subject", "전과목").in("title", alls);
      const { data: keep } = await db.from("plan_routines").select("sort").eq("user_id", user.id).eq("active", true).order("sort", { ascending: false }).limit(1);
      const base = (keep?.[0]?.sort ?? -1) + 1;
      list.forEach((r: any, i: number) => { r.sort = base + i; });
      const { error } = await db.from("plan_routines").insert(list);
      if (error) { console.error("routine save", error); return json({ error: "저장하지 못했어요. 잠시 후 다시 해 주세요" }, 500); }
      // 다이어리에 넣으면 그 과목 '공부법 효과 시험'도 바로 만든다 (지금 10문제 → 일주일 뒤 비슷한 문제로 비교)
      //   이미 진행 중인 시험이 있으면 그걸로 · 과목을 모르거나(전과목) 사용량을 다 썼으면 다이어리만
      let test: any = null;
      if (main && TEST_SUBJECTS.includes(main)) {
        const { data: open } = await db.from("study_tests").select("id,unit").eq("user_id", user.id).eq("subject", main).neq("status", "done").maybeSingle();
        if (open) test = { subject: main, unit: open.unit, already: true };
        else if (usage.pct < 100) {
          const unit = clean(out?.unit, 40) || `${main} 기본 개념`;
          const r: any = await createTest(db, user, main, unit).catch(() => ({ error: "x" }));
          if (!r?.error) test = { subject: main, unit, n: (r.row?.set_a ?? []).length };
        }
      }
      return json({ count: list.length, test, link: test ? `/plan?tab=study&subject=${encodeURIComponent(test.subject)}` : null });
    }

    // 플랜 만들기 — { action: "plan_make", grade, department, did, goal?, concern? } → { plan, tasks }
    //   AI 비용은 물꼬 주간 사용량에 들어간다 (다 쓰고 이용권도 없으면 need_pay)
    if (body.action === "plan_make") {
      if (!(await passOk())) return json({ need_pay: true, pass_only: "plan" }); // 입시 플랜은 이용권 전용
      if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });
      const r: any = await makePlan(db, user.id, user.user_metadata ?? {}, body);
      if (r.error) return json({ error: r.error }, 400);
      return json({ plan: r.row, tasks: r.tasks, week_start: weekStartKST(), usage: await usageOf(db, user.id, paid) });
    }

    // 새 주 할 일 — { action: "plan_next_week" } → { tasks }  (이번 주 할 일이 이미 있으면 그대로)
    //   지난 할 일 중 한 것 · 못 한 것을 보고 이번 주 3~5개를 새로 짠다 (못 한 중요한 일은 이어서)
    if (body.action === "plan_next_week") {
      if (!(await passOk())) return json({ need_pay: true, pass_only: "plan" }); // 입시 플랜은 이용권 전용
      const ws = weekStartKST();
      const { data: plan } = await db.from("study_plans").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!plan) return json({ error: "먼저 플랜을 만들어 주세요" }, 400);
      const { data: cur } = await db.from("plan_tasks").select("id,title,detail,link,done,sort,week_start").eq("user_id", user.id).eq("week_start", ws).order("sort");
      if ((cur ?? []).length && !body.force) return json({ tasks: cur });
      if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });
      const { data: past } = await db.from("plan_tasks").select("title,done,week_start").eq("user_id", user.id).lt("week_start", ws).order("week_start", { ascending: false }).limit(15);
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const sys = `너는 생수면의 '물꼬 입시 AI'다. 학생의 입시 플랜에서 이번 주 할 일을 새로 짠다. JSON만 출력.
오늘은 ${today} (한국 시간)이다.
${PLAN_GUIDE}
규칙:
- 지난주에 못 한 일 중 중요한 것은 이번 주로 이어 넣고, 다 한 일은 다음 단계로 한 걸음 나아간다.
- 이번 달 계획(months)에서 이번 주에 맞는 것을 고른다. 3~5개, 하루 30분~1시간 크기.
- title(20자 안팎) · detail(어떻게 하는지 한 문장) · link. ${PLAN_LINK_RULE}
{"week":[{"title":"","detail":"","link":""}]}`;
      const prompt = `[학년] ${plan.grade}\n[목표] ${plan.goal || ""} ${plan.department || "아직 모름"}\n[플랜] ${JSON.stringify(plan.plan).slice(0, 2500)}\n[지난 할 일] ${(past ?? []).map((t: any) => `${t.week_start} ${t.done ? "✓" : "✗"} ${t.title}`).join(" / ") || "(없음)"}`;
      const out = await planAsk(db, user.id, sys, prompt);
      if (!out) return json({ error: "이번 주 할 일을 만들지 못했어요. 잠시 후 다시 해 주세요" }, 502);
      return json({ tasks: await saveWeek(db, user.id, plan.id, planWeek(out.week)), usage: await usageOf(db, user.id, paid) });
    }

    // ───────── 공부법 효과 시험 (sql/sm_94) ─────────
    //   { action: "test_status" } → { open: [시험], done: [끝난 시험] }  (AI 안 부름)
    //   { action: "test_make", subject, unit, from_id? } → { test }  (AI · 주간 사용량)  · 같은 과목 진행 중 시험이 있으면 그것을 준다
    //   { action: "test_submit", id, answers: [0~3 …] } → 시작 시험이면 { test, review, tips } · 다시 시험이면 { test, review, result, message, kept, tips? }
    // ───────── 선배 사례 가져오기 (관리자) ─────────
    //   { action: "senior_import", force_board? } → 아직 안 가져온 PDF 판을 2개씩 글로 옮긴다 → { done_now, left, total, errors }
    if (body.action === "senior_import") {
      const { data: adm } = await db.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!adm) return json({ error: "관리자만 할 수 있어요" }, 403);
      const [{ data: boards }, { data: recs }, { data: tiers }, { data: had }] = await Promise.all([
        db.from("sb_boards").select("id,record_id,grade,area,kind").eq("kind", "pdf"),
        db.from("sb_records").select("id,track_id,tier_id"),
        db.from("sb_tiers").select("id,schools"),
        db.from("senior_cases").select("board_id").limit(100000),
      ]);
      const recOf = new Map((recs ?? []).map((r: any) => [r.id, r]));
      const tierOf = new Map((tiers ?? []).map((t: any) => [t.id, t]));
      const done = new Set((had ?? []).map((r: any) => Number(r.board_id)));
      const all = (boards ?? []).map((b: any) => {
        const r: any = recOf.get(b.record_id) ?? {};
        const t: any = tierOf.get(r.tier_id) ?? {};
        return { ...b, track: r.track_id, university: String(t.schools ?? "").split(" · ")[0] };
      }).filter((b: any) => b.track && b.university);
      const todo = body.force_board ? all.filter((b: any) => Number(b.id) === Number(body.force_board)) : all.filter((b: any) => !done.has(Number(b.id)));
      const errors: string[] = [];
      let n = 0;
      for (const b of todo.slice(0, 2)) {
        const r: any = await importBoard(db, user.id, b);
        if (r.error) errors.push(`${b.university} ${TRACK_LABEL[b.track]} ${b.grade}학년 ${AREA_LABEL[b.area]}: ${r.error}`);
        else { n++; done.add(Number(b.id)); }
      }
      return json({ done_now: n, left: all.filter((b: any) => !done.has(Number(b.id))).length, total: all.length, errors });
    }

    // ───────── 해 줄까요? 카드 ─────────
    //   { action: "agent_action", id, decide: "run" | "cancel" } → { status, message, link }
    if (body.action === "agent_action") {
      const { data: act } = await db.from("agent_actions").select("*").eq("id", Number(body.id)).eq("user_id", user.id).maybeSingle();
      if (!act) return json({ error: "할 일을 찾지 못했어요" }, 404);
      if (act.status !== "pending") return json({ status: act.status, ...(act.result ?? {}) });
      const finish = async (status: string, result: any) => {
        await db.from("agent_actions").update({ status, result, done_at: new Date().toISOString() }).eq("id", act.id);
        return json({ status, ...result });
      };
      if (body.decide === "cancel") return finish("cancelled", { message: "알겠어요. 안 할게요." });
      const p = act.payload ?? {};
      if (act.kind === "prep_school") {
        const { error } = await db.from("prep_targets").upsert({ user_id: user.id, university: p.university, department: p.department ?? "", track: "학생부종합" }, { onConflict: "user_id,university,department" });
        if (error) { console.error("prep_school", error); return json({ error: "넣지 못했어요. 잠시 후 다시 해 주세요" }, 500); }
        return finish("done", { message: `${p.university}${p.department ? ` ${p.department}` : ""}를 수시 면접 준비에 넣었어요. 기출문제부터 연습해 봐요.`, link: "/prep", link_label: "면접 준비하러 가기" });
      }
      if (act.kind === "study_test") {
        if (!(await passOk())) return json({ need_pay: true, pass_only: "test" }); // 자기주도학습법(효과 시험)은 이용권 전용
        const { data: open } = await db.from("study_tests").select("id").eq("user_id", user.id).eq("subject", p.subject).neq("status", "done").maybeSingle();
        const link = `/plan?tab=study&subject=${encodeURIComponent(p.subject)}`;
        if (open) return finish("done", { message: `${p.subject} 자기주도학습법 시험이 이미 있어요. 학습 플랜에서 이어서 풀어요.`, link, link_label: "시험 보러 가기" });
        if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요" } : { need_pay: true, usage });
        const r: any = await createTest(db, user, p.subject, p.unit);
        if (r.error) return json({ error: r.error }, 502);
        return finish("done", { message: `${p.subject} '${p.unit}' 시작 시험 ${(r.row.set_a ?? []).length}문제를 만들었어요. 지금 풀고, 일주일 뒤 비슷한 문제로 다시 풀어 봐요.`, link, link_label: "시작 시험 풀기" });
      }
      return finish("failed", { message: "할 수 없는 일이에요" });
    }

    if (body.action === "test_status") {
      const { data: rows } = await db.from("study_tests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
      const open = (rows ?? []).filter((r: any) => r.status !== "done");
      const done = (rows ?? []).filter((r: any) => r.status === "done").slice(0, 6);
      const withTips = await Promise.all(open.map(async (r: any) => ({ ...testView(r), tips: r.status === "studying" ? await tipsByIds(db, r.tip_ids) : [] })));
      return json({ open: withTips, done: done.map((r: any) => testView(r, false)) });
    }

    if (body.action === "test_make") {
      if (!(await passOk())) return json({ need_pay: true, pass_only: "test" }); // 자기주도학습법(효과 시험)은 이용권 전용
      const subject = TEST_SUBJECTS.includes(body.subject) ? body.subject : "";
      const unit = clean(body.unit, 40);
      if (!subject) return json({ error: "과목을 골라 주세요" }, 400);
      if (unit.length < 2) return json({ error: "단원을 적어 주세요 (예: 이차함수, 비문학 독해)" }, 400);
      const { data: openRow } = await db.from("study_tests").select("*").eq("user_id", user.id).eq("subject", subject).neq("status", "done").maybeSingle();
      if (openRow) return json({ test: testView(openRow), existing: true });
      if (usage.pct >= 100) return json(paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage });
      // 이어서 하는 시험이면 (한 주 더 · 교체) 몇 번째 도전인지 이어 센다
      let round = 1;
      if (body.from_id) {
        const { data: prev } = await db.from("study_tests").select("round,result,unit,subject").eq("id", Number(body.from_id)).eq("user_id", user.id).maybeSingle();
        if (prev && prev.subject === subject && prev.unit === unit && prev.result === "한주더") round = (prev.round ?? 1) + 1;
      }
      const r: any = await createTest(db, user, subject, unit, round);
      if (r.error) return json({ error: r.error }, 502);
      return json({ test: testView(r.row), usage: await usageOf(db, user.id, paid) });
    }

    if (body.action === "test_submit") {
      const { data: row } = await db.from("study_tests").select("*").eq("id", Number(body.id)).eq("user_id", user.id).maybeSingle();
      if (!row) return json({ error: "시험을 찾지 못했어요" }, 404);
      const answers = (Array.isArray(body.answers) ? body.answers : []).map((x: unknown) => (x === null || x === undefined || x === "" || !Number.isInteger(Number(x)) ? null : Number(x)));
      if (answers.some((x: any) => x === null || x < 0 || x > 3)) return json({ error: "모든 문제에 답을 골라 주세요" }, 400);
      const now = new Date().toISOString();
      if (row.status === "pre") {
        if (answers.length !== row.set_a.length) return json({ error: "모든 문제에 답을 골라 주세요" }, 400);
        const score = scoreOf(row.set_a, answers);
        const review = reviewOf(row.set_a, answers);
        const wrong = [...new Set(review.filter((r: any) => !r.correct).map((r: any) => r.type))];
        const { data: gaveUp } = await db.from("study_tests").select("tip_ids").eq("user_id", user.id).eq("subject", row.subject).eq("unit", row.unit).eq("result", "교체");
        const usedTitles = (await tipsByIds(db, (gaveUp ?? []).flatMap((g: any) => g.tip_ids ?? []))).map((x: any) => x.title);
        const tips = await testTips(db, row.subject, row.unit, row.grade ?? "", usedTitles);
        const open = new Date(Date.now() + TEST_DAYS * 86400000).toISOString();
        await db.from("study_tests").update({ pre_answers: answers, pre_score: score, pre_at: now, wrong_types: wrong, tip_ids: tips.map((x: any) => x.id).filter(Boolean), post_open_at: open, status: "studying" }).eq("id", row.id);
        return json({ test: testView({ ...row, pre_score: score, pre_at: now, post_open_at: open, status: "studying" }), review, wrong_types: wrong, tips });
      }
      if (row.status === "studying") {
        if (Date.now() < new Date(row.post_open_at).getTime()) return json({ error: "다시 시험은 시작 시험 일주일 뒤에 열려요", post_open_at: row.post_open_at }, 400);
        if (answers.length !== row.set_b.length) return json({ error: "모든 문제에 답을 골라 주세요" }, 400);
        const score = scoreOf(row.set_b, answers);
        const kept = await adherence(db, user.id, row.subject, row.pre_at);
        const j = judge(row.pre_score ?? 0, score, row.set_b.length, row.round ?? 1, kept);
        await db.from("study_tests").update({ post_answers: answers, post_score: score, post_at: now, result: j.result, status: "done" }).eq("id", row.id);
        // 공부법을 바꿀 때는 — 지난번에 쓴 카드는 빼고 같은 과목 · 단원의 다른 카드를 고른다
        let tips: any[] = [];
        if (j.result === "교체") {
          const prevTitles = (await tipsByIds(db, row.tip_ids)).map((x: any) => x.title);
          tips = await testTips(db, row.subject, row.unit, row.grade ?? "", prevTitles);
        }
        return json({ test: testView({ ...row, post_score: score, post_at: now, result: j.result, status: "done" }, false), review: reviewOf(row.set_b, answers),
          result: j.result, message: j.message, kept, pre_score: row.pre_score, tips });
      }
      return json({ error: "이미 끝난 시험이에요" }, 400);
    }

    if (body.action === "univ_brief") {
      const raw = clean(body.university, 40);
      if (!raw) return json({ error: "대학을 적어 주세요" }, 400);
      const style = await runTool(db, user.id, "get_interview_style", { university: raw });
      const univ = await matchUniv(db, raw);
      let rules: any[] = [], units: any[] = [];
      if (univ) {
        const { data: r } = await db.from("univ_admission_rules")
          .select("year,season,track,track_type,quota_type,method,interview,interview_ratio,interview_type,csat_min")
          .eq("university", univ).eq("year", 2027).eq("season", "수시");
        rules = (r ?? []).filter((x: any) => x.interview || x.interview_ratio || x.interview_type || /면접/.test(String(x.method ?? "")))
          .map((x: any) => pick({ ...x, method: clean(x.method, 160), interview: clean(x.interview, 300) }, ["track", "track_type", "method", "interview", "interview_ratio", "interview_type", "csat_min"]));
        const dept = clean(body.department, 30).replace(/(학과|학부|전공)$/, "");
        if (dept.length >= 2) {
          const { data: u } = await db.from("univ_admission")
            .select("department,track,quota,csat_min,eval_detail").eq("university", univ).eq("year", 2027).eq("season", "수시")
            .ilike("department", `%${dept}%`).limit(20);
          units = (u ?? []).filter((x: any) => /면접/.test(String(x.eval_detail ?? "") + String(x.track ?? "")))
            .map((x: any) => pick({ ...x, eval_detail: clean(x.eval_detail, 160) }, ["department", "track", "quota", "csat_min", "eval_detail"]));
        }
      }
      // 기출 — 실제 면접 메인 질문 (tail_examples step 0). 꼬리 흐름은 보내지 않는다
      const names = [...new Set([raw, univ, (style as any)?.university, univ?.replace("대학교", "대")].filter(Boolean))];
      const { data: ex } = await db.from("tail_examples").select("question,kind,case_no").in("univ", names).eq("step", 0).order("case_no").limit(80);
      const seenQ = new Set<string>();
      const past = (ex ?? []).filter((r: any) => {
        const k = String(r.question ?? "").replace(/\s/g, "");
        if (!k || seenQ.has(k)) return false;
        seenQ.add(k);
        return true;
      }).slice(0, 40).map((r: any) => ({ q: clean(r.question, 300), kind: r.kind ?? "" }));
      // 그 학교 기출이 적으면 — 여러 대학에서 자주 나온 메인 질문(공통 기출)으로 채운다
      let common: any[] = [];
      if (past.length < 8) {
        const { data: all } = await db.from("tail_examples").select("univ,question,kind").eq("step", 0).limit(5000);
        const cnt = new Map<string, { q: string; kind: string; univs: Set<string> }>();
        for (const r of all ?? []) {
          const k = String(r.question ?? "").replace(/\s/g, "").replace(/[?.!]/g, "");
          if (!k || seenQ.has(String(r.question ?? "").replace(/\s/g, ""))) continue;
          // 다른 대학 이름이 들어간 질문은 빼고 (예: "○○대 인재상…")
          if (/대학교|대학의|대의 /.test(String(r.question))) continue;
          const c = cnt.get(k) ?? { q: clean(r.question, 300), kind: r.kind ?? "", univs: new Set<string>() };
          c.univs.add(r.univ);
          cnt.set(k, c);
        }
        common = [...cnt.values()].sort((x, y) => y.univs.size - x.univs.size).slice(0, 16 - past.length)
          .map((c) => ({ q: c.q, kind: c.kind, univ_count: c.univs.size }));
      }
      const tracks = [...new Set(rules.map((r: any) => r.track).filter(Boolean))];
      return json({ university: univ ?? (style as any)?.university ?? raw, style: (style as any)?.error ? null : style, rules: rules.slice(0, 12), units: units.slice(0, 10), past, common, tracks });
    }

    // 줄바꿈은 살린다 — 입력 카드는 "학년: …\n활동: …" 처럼 한 줄씩 온다 (clean 은 줄바꿈까지 없애서 카드가 안 읽혔다)
    const message = String(body.message ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000); // 수행평가 안내문을 통째로 붙여 넣을 수 있게 넉넉히
    if (message.length < 2) return json({ error: "질문을 적어 주세요" }, 400);
    // 사용량을 다 썼어도 하던 수행평가 · 탐구(카드 답 · 안내문 사진 · 완성본 · 디자인)는 끝까지 이어 간다
    //   — 그 단계들은 물꼬 사용량이 아니라 과제 개수(무료 3개)로 센다. 중간에 막히면 학생은 다음 과제(한두 달 뒤)에나 돌아온다
    //   일반 질문만 막는다 (아래 work 안에서 suhaengChat 이 처리하지 않은 말일 때)
    const overLimit = usage.pct >= 100;
    const limitBody = paid ? { error: "이번 주 사용량을 다 썼어요. 월요일 0시에 다시 채워져요", usage } : { need_pay: true, usage };

    // 대화 불러오기
    let chatRow: any = null;
    if (body.chat_id) {
      const { data } = await db.from("agent_chats").select("*").eq("id", Number(body.chat_id)).eq("user_id", user.id).maybeSingle();
      chatRow = data;
    }
    // 물꼬가 먼저 건 말(opening)에 답하는 거면 그 말을 대화 첫머리로 둔다 — '그 주제로 보고서 쓰기'가 무슨 말인지 알게
    const opening = !chatRow && typeof body.opening === "string" ? String(body.opening).slice(0, 2000) : "";
    if (opening) chatRow = { id: null, messages: [{ role: "assistant", content: opening, at: new Date().toISOString() }] };
    const histAll = ((chatRow?.messages ?? []) as any[]).slice(-HISTORY);
    const history = histAll.map((m, k) => ({
      role: m.role,
      // 학생 말은 그대로(조건 · 사실을 잊지 않게), 오래된 물꼬 답은 줄여서
      content: m.role === "assistant" && k < histAll.length - 4 && String(m.content ?? "").length > 900 ? `${String(m.content).slice(0, 900)} …(줄임)` : m.content,
    }));

    // 답 만들기 — emit 으로 지금 하는 일을 화면에 알린다 (stream: true 일 때)
    const work = async (emit: (t: string) => void) => {
      // '내 입시 플랜 짜기' 입력 카드를 보냈으면 (학년: … / 학과: … / 활동: …) — AI 대화 없이 바로 플랜을 만든다
      const isPlanCard = PLAN_CARD(message);
      console.log("route", route(message)); // 어디로 갔는지 로그 (하던 과제 단계는 suhaengChat 안에서 정한다)
      // 무료 사용량을 다 쓰면 — 채팅 · 카드(수행평가 · 탐구) 모두 새벽 5시까지 쉰다 (카드도 AI 토큰을 쓰니까 · 2026-11-06)
      if (overLimit) return { status: 200, body: limitBody };
      if (isPlanCard) { emit("내 활동 · 생기부 노트 읽는 중"); emit("목표 대학 권장과목 · 전형 · 공부법 찾는 중"); emit("목표에 맞게 입시 플랜 짜는 중 (30초쯤 걸려요)"); }
      const planDirect = isPlanCard ? await planFromCard(db, user, message, usage, paid) : null;
      // 수행평가 완성 (채팅 안에서 고르기 → 질문 → 완성본) — 진행 중이면 카드 답을 여기서 받는다
      const suh = isPlanCard ? null : await suhaengChat(db, user, message, token, emit, history).catch((e) => { console.error("suhaeng", e); return null; });
      const quick = planDirect ?? suh ?? await quickForm(db, user.id, user.user_metadata ?? {}, message);
      if (quick && !isPlanCard && !suh) emit("적을 칸 준비하는 중");
      else for (const st of await openingSteps(db, message)) emit(st);
      const student = quick ? "" : await studentContext(db, user.id, user.user_metadata ?? {});
      // 안내문은 기본 + 이번 질문에 필요한 부분만 (context.ts pickModules) — 비용을 줄인다 · 도구를 부르면 그 규칙을 그때 더 넣는다
      const mods = pickModules(message, history);
      console.log("mods", mods.join(",") || "(기본만)");
      const msgs: any[] = [{ role: "system", content: systemPrompt(student, mods) }, ...history, { role: "user", content: message }];
      // 학생이 자기가 한 탐구를 직접 말하면서 심화·이어서를 물으면 — 되묻지 말고 그 주제로 바로 제안하게 한 번 더 짚어 준다
      if (!quick && /(탐구|실험|조사|활동).{0,20}(했는데|했어|했고|진행했|해\s*봤|해봤)|(심화|이어서|발전|확장).{0,15}(탐구|주제)/.test(message) && message.replace(/\s/g, "").length > 18) {
        msgs.push({ role: "system", content: "학생이 이번 질문에 자기가 한 탐구 주제를 직접 말했다. 질문 카드·입력 카드 없이, 학생이 말한 그 주제를 더 깊게/다른 각도로 하는 주제 3개를 바로 제안하라 ('지난번 탐구주제' 이야기 금지)." });
      }

      let inT = 0, outT = 0, cT = 0, answer = quick ?? "", retried = false; // cT: 캐시된 입력 토큰 (싸게 계산)
      const proposed: number[] = []; // 이번 답에서 물꼬가 제안한 일 (해 줄까요? 카드)
      let seniorShown = 0; // 이번 답에서 보여 준 선배 사례 줄 수
      for (let round = 0; !quick && round <= MAX_ROUNDS; round++) {
        if (round > 0) emit(round === 1 ? "찾은 자료 맞춰 보는 중" : round === 2 ? "빠진 부분 더 찾아보는 중" : "자료 한 번 더 확인하는 중");
        const r = await chat(msgs, round < MAX_ROUNDS);
        if (!r) break;
        inT += Number(r.usage?.prompt_tokens ?? 0); outT += Number(r.usage?.completion_tokens ?? 0); cT += cachedOf(r.usage);
        const m = r.choices?.[0]?.message;
        if (!m) break;
        if (m.tool_calls?.length) {
          msgs.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
          let fixed = "";
          for (const tc of m.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* 빈 인자 */ }
            emit(stepLabel(tc.function?.name, args));
            let out: any;
            try { out = await runTool(db, user.id, tc.function?.name, args, token, !!paid); } catch (e) { console.error("tool", e); out = { error: "찾다가 문제가 생겼어요" }; }
            msgs.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 24000) });
            if (tc.function?.name === "propose_action" && out?.id) proposed.push(Number(out.id));
            if (tc.function?.name === "find_seniors" && out?.found > 0) seniorShown += Number(out.found);
            const ck = { check_topic: "topic", check_motive: "motive", check_reading: "reading" }[String(tc.function?.name)];
            if (ck && out && typeof out.score === "number" && !fixed) fixed = formatCheck(ck, out, { ...args, __paid: !!paid });
            if (ck === "topic" && out?.quota_exceeded && !fixed) {
              fixed = TOPIC_QUOTA_MSG;
            }
          }
          if (fixed) { answer = fixed; break; }
          // 이번에 부른 도구의 규칙이 안내문에 없었으면 지금 더 넣는다 (예: 공부법 질문인데 입결을 찾음 → 입결 답 규칙)
          for (const tc of m.tool_calls) {
            const k = modsForTool(String(tc.function?.name), mods);
            if (k) { mods.push(k); msgs.push({ role: "system", content: PROMPT_MODS[k] }); }
          }
          continue;
        }
        // 혹시 영어 도구 이름이 섞여 나오면 지운다 (예: "실제 사례(get_topic_cases)")
        answer = String(m.content ?? "").replace(/\s*\(?\b(get|search|list|my|check)_[a-z_]+\)?/g, "").trim();
        // 되묻기는 한 번만 — 바로 앞 답도 묻기만 했는데(학생이 카드로 답함) 이번에도 학과·과목·보기만 또 물으면, 묻지 말고 바로 답하게 한 번 더 부른다
        const cardsOnly = (t: string) => t.replace(/\[\[[^\]]*\]\]/g, "").replace(/먼저 하나만 물어볼게요\.?/g, "").trim().length < 40;
        const lastBot = [...history].reverse().find((h: any) => h.role === "assistant")?.content ?? "";
        const asksAgain = /\[\[\s*질문/.test(answer) || (/\[\[\s*입력/.test(answer) && !/\[\[\s*입력[^\]]*(탐구주제|지원동기|책 제목|면접 질문|내 답변|활동)/.test(answer));
        if (!retried && asksAgain && cardsOnly(answer) && /\[\[\s*(질문|입력)/.test(lastBot) && cardsOnly(lastBot)) {
          retried = true;
          msgs.push({ role: "assistant", content: m.content ?? "" });
          msgs.push({ role: "system", content: "방금 또 물었다. 학생은 이미 한 번 답했다. 더 묻지 말고(질문 카드·입력 카드 금지) 학생이 준 답과 [학생 정보]로 지금 바로 결과를 줘라. 빠진 값은 알맞게 정하고 한 줄로 밝힌다. 탐구주제면 학과에 맞는 실제 사례를 찾아 주제 3개를 바로 제안한다." });
          continue;
        }
        // 하루 · 주간 루틴을 짜 줬는데 저장 버튼을 안 붙였으면 — 붙인다 (누르면 학습 다이어리로)
        if (!/\[\[\s*루틴저장/.test(answer) && ROUTINE_Q.test(message.replace(/\s+/g, " ")) && (answer.match(/^\s*([-•*]|\d+[.)])\s/gm) ?? []).length >= 3) {
          answer = answer.trim() + "\n\n학습 다이어리에 넣으면 매일 체크할 수 있어요.\n[[루틴저장]]";
        }
        // [[플랜]] 버튼을 붙였는데 아직 플랜이 없으면 — 빈 화면으로 가지 않게 적는 칸으로 바꾼다
        if (/\[\[\s*플랜\s*\]\]/.test(answer) && !(await hasPlan(db, user.id))) {
          answer = answer.replace(/\[\[\s*플랜\s*\]\]/g, "").trim() + `\n\n목표 대학 · 학과를 알려 주면 그 목표에 맞춰 플랜을 짜 드릴게요.\n${await planCard(db, user.id, user.user_metadata ?? {})}`;
        }
        // 탐구 이야기에 수행평가 버튼이 붙으면 탐구 설계 버튼으로 바꾼다 (수행평가는 안내문 사진, 탐구는 내 주제를 깊게 — 섞이지 않게)
        if (/탐구/.test(message) && !/수행\s*평가/.test(message)) answer = answer.replace(/\[\[\s*수행평가\s*\]\]/g, "[[탐구설계]]");
        // 자료가 없다고 했으면 — '11월 안에 넣어요 + 건의함에 남겨 주세요' 와 건의함 버튼 (예전 [[대학요청]] 카드는 건의함으로 바꾼다)
        answer = answer.replace(/\[\[\s*대학요청\s*[:：]?[^\]]*\]\]/g, "").replace(/필요하면 아래에서 자료 추가를 요청해 주세요\.?/g, "").trim();
        //   수행평가 · 평가계획 답에는 붙이지 않는다 (안내문 사진으로 하면 되니까) · 한 답에 한 번만
        answer = answer.replace(/\s*11월 안에 넣어 드릴 예정이에요\.?/g, "");
        if (/자료가\s*(아직\s*)?없|아직\s*(생수면에\s*)?.{0,20}자료가\s*없|자료가\s*아직\s*없/.test(answer) && !/\[\[\s*건의함\s*\]\]/.test(answer) && !/수행\s*평가|평가\s*계획/.test(answer)) {
          if (!/건의함에 남겨/.test(answer)) answer += "\n\n꼭 필요한 자료가 있으면 건의함에 남겨 주세요 — 남긴 것부터 먼저 넣어요.";
          answer += "\n[[건의함]]";
        }
        // 생수면에서 한 탐구주제가 없는 학생(처음 쓰는 학생)에게 '지난번 탐구주제' 카드가 나오면 학과·과목 입력 카드로 바꾼다
        //   (먼저 한 번은 '지난번' 없이 다시 부르고, 그래도 나오면 카드만 바꾼다)
        if (/\[\[\s*질문:[^\]]*지난번/.test(answer) && !student.includes("[생수면에서 한 탐구주제")) {
          if (!retried) {
            retried = true;
            msgs.push({ role: "assistant", content: m.content ?? "" });
            msgs.push({ role: "system", content: "이 학생은 생수면에서 한 탐구주제가 없다. '지난번' 보기·이야기를 빼라. 질문이 넓으면 과목 카드(그 학과에 맞는 과목 3개 + 진로로 찾기 + 다른 과목) 하나만, 과목·진로·방향이 이미 있으면 바로 주제 3개를 제안하라. 학과를 모를 때만 학과 입력 카드를 낸다." });
            continue;
          }
          const dept = await deptOf(db, user.id, user.user_metadata ?? {});
          // 카드 안의 '지난번 …' 보기만 빼고, 보기가 하나도 안 남으면 학과 입력 카드로
          answer = answer.replace(/\[\[\s*질문:([^\]]*)\]\]/, (whole: string, inner: string) => {
            const parts = inner.split("|").map((x: string) => x.trim());
            const q = parts.shift() ?? "";
            const opts = parts.filter((o: string) => !/지난번|이어서/.test(o));
            if (/지난번/.test(q) || opts.length < 2) return `[[입력: 어떤 학과로 찾을까요? | ${dept ? `학과=${safe(dept, 30)}` : "학과"} | 과목 (선택)]]`;
            return `[[질문: ${q} | ${opts.join(" | ")}]]`;
          });
        }
        break;
      }
      if (!quick) await logUsage(db, user.id, inT, outT, !!answer, "agent", cT);
      // 해 줄까요? 카드 — 이번에 제안한 것만 남기고, 빠뜨렸으면 맨 끝에 붙인다
      if (answer) {
        answer = answer.replace(/\[\[\s*할일\s*[:：]\s*(\d+)\s*\]\]/g, (w: string, id: string) => (proposed.includes(Number(id)) ? `[[할일:${id}]]` : "")).trim();
        for (const id of [...new Set(proposed)].slice(0, 2)) if (!answer.includes(`[[할일:${id}]]`)) answer += `\n\n[[할일:${id}]]`;
        // 공부법 진단 카드(과목 · 많이 틀리는 단원)에 답했는데 물꼬가 효과 시험 제안을 빠뜨렸으면 — 서버가 대신 붙인다
        //   (AI가 도구를 부를 때도 있고 안 부를 때도 있어서, 진단 답 뒤에는 늘 '효과 시험 만들기' 카드가 나오게)
        if (!proposed.length && !/\[\[\s*할일/.test(answer)) {
          const fv = (k: string) => (message.match(new RegExp(`${k}\\s*[:：=]\\s*([^\\n]+)`))?.[1] ?? "").trim();
          const subjRaw = fv("과목"), unit = fv("많이\\s*틀리는\\s*단원");
          const subject = TEST_SUBJECTS.includes(subjRaw) ? subjRaw : (SUBJ.find(([re]) => re.test(subjRaw))?.[1] ?? "");
          if (subject && TEST_SUBJECTS.includes(subject) && unit.length >= 2 && !/^(없|모름|몰라)/.test(unit)) {
            const r: any = await proposeAction(db, user.id, { kind: "study_test", subject, unit }).catch(() => null);
            if (r?.proposed) answer += `\n\n이 공부법이 나한테 맞는지 확인해 볼까요? 지금 ${subject} '${clean(unit, 40)}' 10문제를 풀고, 일주일 뒤 비슷한 문제로 다시 풀어서 점수를 비교해요.\n\n[[할일:${r.id}]]`;
            else if (r?.already) answer += `\n\n${subject} 효과 시험은 이미 진행 중이에요. 학습 플랜(/plan) ${subject} 탭에서 이어서 풀어요.`;
          }
        }
        // 고2 · 고3 인데 지난 학년 활동이 생기부 노트에 하나도 없으면 — 탐구 · 로드맵 · 학과 · 생기부 질문 답 끝에 노트 버튼 (대화마다 한 번)
        {
          const gs = student.match(/\[학년 상태\] 고([23])[^\n]*지난 학년\([^)]*\) 생기부 노트 활동 (\d+)개/);
          const asked = /탐구|주제|세특|로드맵|플랜|학과|진로|생기부|동아리|활동|추천/.test(message);
          const shown = history.some((h: any) => /\[\[\s*노트\s*\]\]/.test(h.content ?? ""));
          if (gs && gs[2] === "0" && asked && !shown && !/\[\[\s*(노트|입력|질문)/.test(answer)) {
            answer += `\n\n고${Number(gs[1]) - 1 === 1 ? "1" : "1·고2"} 때 한 활동을 생기부 노트에 적어 두면, 다음부터 그 활동에 이어지는 탐구 · 세특 · 로드맵으로 맞춰 드려요.\n[[노트]]`;
          }
        }
        // 면접 기출 · 생기부 예상질문을 물었는데 면접 준비 버튼을 빠뜨렸으면 — 붙인다 (기출문제는 /prep 에서 연습)
        if (/기출|예상\s*질문|면접\s*질문/.test(message) && !/\[\[\s*(면접준비|입력|질문)/.test(answer)) { // 되묻는 카드가 있는 답에는 안 붙인다
          answer += "\n\n지원 대학 면접 기출문제는 수시 면접 준비에서 학교별로 연습할 수 있어요.\n[[면접준비]]";
        }
        // 선배 사례를 보여 줬으면 — 원본 보기 버튼 + 기록 (다음 날 다시 오는지 보려고)
        if (seniorShown > 0) {
          if (!/\[\[\s*선배\s*\]\]/.test(answer)) answer += "\n\n[[선배]]";
          await db.from("senior_events").insert({ user_id: user.id, cases: seniorShown }).then(() => {}, () => {});
        }
      }
      if (answer) answer = answer.replace(/\n?\[\[\s*친구초대\s*\]\]/g, ""); // 물꼬는 친구 초대 카드 안 씀
      if (!answer) return { status: 502, body: { error: "답을 만들지 못했어요. 잠시 뒤 다시 물어봐 주세요" } };

      emit(/\[\[\s*질문/.test(answer) ? "물어볼 것 고르는 중" : "답 정리하는 중");
      const now = new Date().toISOString();
      const saved = [...((chatRow?.messages ?? []) as any[]), { role: "user", content: message, at: now }, { role: "assistant", content: answer, at: now }];
      let chatId = chatRow?.id;
      if (chatId) {
        await db.from("agent_chats").update({ messages: saved, updated_at: now }).eq("id", chatId);
      } else {
        const { data: row, error } = await db.from("agent_chats").insert({ user_id: user.id, title: message.slice(0, 40), messages: saved }).select("id").single();
        if (error) throw error;
        chatId = row.id;
      }
      // 이 대화에서 시작한 수행평가에 대화 번호를 붙인다 (내 입시 홈에서 그 대화로 이동)
      if (suh) await db.from("school_tasks").update({ chat_id: chatId }).eq("user_id", user.id).eq("in_chat", true).is("chat_id", null);
      // 물꼬 노트 고치기 — 답을 먼저 보내고 뒤에서 (기다리지 않게)
      const memJob = updateMemory(db, user.id, message, answer).catch((e) => console.error("memory", e));
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(memJob); else await memJob;
      return { status: 200, body: { chat_id: chatId, answer, usage: await usageOf(db, user.id, paid) } };
    };

    if (!body.stream) {
      const r = await work(() => {});
      return json(r.body, r.status);
    }
    // 한 줄씩(JSON) 흘려보낸다: {"step":"…"} … 마지막에 {"status":200,"result":{…}}
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        try {
          const r = await work((t) => send({ step: t }));
          send({ status: r.status, result: r.body });
        } catch (e) {
          console.error(e);
          send({ status: 500, result: { error: "잠시 문제가 생겼어요. 다시 시도해 주세요" } });
        }
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { ...cors, "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
  } catch (e) {
    console.error(e);
    return json({ error: "잠시 문제가 생겼어요. 다시 시도해 주세요" }, 500);
  }
});