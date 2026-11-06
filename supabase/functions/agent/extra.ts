// agent/extra.ts — agent/index.ts 에서 나눈 파일 (나누기 전과 같은 코드)
import { clean, logUsage, openai } from "./core.ts";
import { AREA_LABEL, TRACK_LABEL, liveBoards } from "./study.ts";
import { pick } from "./tools.ts";

export async function findSeniors(db: any, a: any) {
  const track = TRACK_LABEL[a?.track] ? a.track : "";
  if (!track) return { error: "계열이 필요해요" };
  const [live, { data: profs }] = await Promise.all([
    liveBoards(db),
    db.from("senior_profiles").select("key,university,department,interest,school_type,metrics,summary,books").eq("track", track).eq("live", true).limit(500),
  ]);
  const profOf = new Map((profs ?? []).map((p: any) => [p.key, p]));
  const dept = clean(a?.department, 20).replace(/학과|학부|과$/g, "");
  const u = clean(a?.university, 10).replace(/대학교|대학/g, "대").replace(/대$/, "");
  const run = async (kw: string) => {
    let q = db.from("senior_cases").select("board_id,profile_key,university,track,grade,area,label,body,sort").eq("track", track);
    if ([1, 2, 3].includes(Number(a?.grade))) q = q.in("grade", [Number(a.grade), 0]);
    if (AREA_LABEL[a?.area]) q = q.in("area", [a.area, "gr"]);
    if (u) q = q.ilike("university", `%${u}%`);
    if (kw) q = q.or(`body.ilike.%${kw}%,label.ilike.%${kw}%`);
    const { data } = await q.order("sort").limit(400);
    // 퍼즐 판에서 온 줄은 공개된 판만 · 선배 카드에서 온 줄은 공개된 카드만
    return (data ?? []).filter((r: any) => (r.profile_key ? profOf.has(r.profile_key) : live.has(Number(r.board_id))));
  };
  const kw = clean(a?.keyword, 20).replace(/[%,()]/g, "");
  let rows = await run(kw);
  let widened = false;
  if (!rows.length && kw) { rows = await run(""); widened = true; }
  if (!rows.length) return { found: 0, note: `아직 ${TRACK_LABEL[track]} 계열 선배 사례가 없어요. 사례가 없다고 밝히고 일반 정보로 답한다.` };
  // 같은 학과 선배를 앞으로
  // 학과 이름 또는 관심 분야(예: 자유전공 선배의 '심리학')가 맞으면 앞으로
  const deptHit = (r: any) => {
    const p: any = profOf.get(r.profile_key);
    return dept && p && (String(p.department ?? "").includes(dept) || String(p.interest ?? "").includes(dept)) ? 0 : 1;
  };
  rows.sort((x: any, y: any) => deptHit(x) - deptHit(y));
  // 선배(또는 판)마다 고르게 — 한 사람에서 최대 4줄, 모두 14줄
  const per: Record<string, number> = {};
  const pick: any[] = [];
  for (const r of rows) {
    if (r.area === "gr") continue; // 성적 지표는 아래 seniors 에 따로
    const k = r.profile_key ?? `b${r.board_id}`;
    if ((per[k] ?? 0) >= 4) continue;
    per[k] = (per[k] ?? 0) + 1;
    const pf: any = profOf.get(r.profile_key);
    pick.push({ who: pf ? `${pf.university} ${pf.department}${pf.interest ? `(관심: ${pf.interest})` : ""} 선배` : `${r.university} ${TRACK_LABEL[r.track]} 선배`, grade: `${r.grade}학년`, area: AREA_LABEL[r.area] ?? r.area, label: r.label, text: clean(r.body, 220) });
    if (pick.length >= 14) break;
  }
  // 이번에 나온 선배 카드 — 합격 학과 · 학교 유형 · 성적 지표 · 한 줄 특징
  const keys = [...new Set(rows.map((r: any) => r.profile_key).filter(Boolean))].slice(0, 5);
  const seniors = keys.map((k: any) => {
    const p: any = profOf.get(k); const m = p.metrics ?? {};
    return {
      who: `${p.university} ${p.department} 합격 선배`, interest: p.interest || undefined, school_type: p.school_type,
      grades: [m.gpa_all ? `5등급 환산 전 과목 ${m.gpa_all}(${m.gpa_all_band})` : "", m.gpa_main ? `국영수사과 ${m.gpa_main}` : "", m.trend ? `추이 ${m.trend}${m.trend_word ? ` · ${m.trend_word}` : ""}` : "", m.elective ? `진로선택 ${m.elective}` : "", m.grade_note ?? ""].filter(Boolean).join(" · ") || "성적 정보 없음",
      major_subjects: m.major_subjects ?? "", summary: p.summary, books: (p.books ?? []).slice(0, 4),
    };
  });
  return {
    found: pick.length + seniors.length, total_matches: rows.length, keyword_widened: widened,
    schools: [...new Set([...seniors.map((s: any) => s.who.split(" ")[0]), ...pick.map((p) => p.who.split(" ")[0])])],
    seniors, cases: pick,
    note: "실제 합격 선배 생기부를 정제한 것. 성적은 선배 때의 9등급제 성적을 5등급제로 환산한 추정치다(누적 비율 기준). 지금 학생(5등급제)과 대략 비교할 수 있지만 정확한 값이 아니라고 함께 말한다. 근거로 쓰되 문장을 길게 그대로 옮기지 말고 흐름(1학년 관심 → 2학년 연결 → 3학년 심화)을 요약한다. 선배가 했다고 지어내지 않는다. 선배 활동을 그대로 따라 하라고 하지 말고 이 학생에게 맞게 비튼다 (똑같이 하면 흔해진다).",
  };
}

/* PDF 판 → 글 (관리자 '선배 사례 가져오기') — 이미 정제한 PDF를 칸별 글로 옮긴다 */
export function toB64(buf: Uint8Array) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function importBoard(db: any, userId: string, b: any) {
  const { data: blob, error } = await db.storage.from("sb-files").download(`boards/${b.id}/full.pdf`);
  if (error || !blob) return { error: "PDF를 찾지 못했어요" };
  const b64 = toB64(new Uint8Array(await blob.arrayBuffer()));
  const sys = `이 PDF는 대학 합격생 학교생활기록부의 한 영역(${AREA_LABEL[b.area] ?? b.area}) ${b.grade}학년 부분이다. 이름 · 학교는 이미 지운 정제본이다. JSON만 출력.
- 적힌 내용을 칸(항목)별로 그대로 옮긴다. 요약하거나 고치거나 지어내지 않는다. 읽을 수 없는 부분은 뺀다.
- label: 칸 이름 (창체면 자율활동 · 동아리활동 · 진로활동 등, 세특이면 과목 이름, 행특이면 '행동특성', 성적이면 과목 이름)
- text: 그 칸의 글 전체 (성적이면 '1학기 2등급 · 2학기 2등급' 처럼 숫자를 글로)
- 사람 이름 · 학교 이름 · 지역 · 선생님 이름이 남아 있으면 ○○로 바꾼다.
{"items":[{"label":"","text":""}]}`;
  const res = await openai({
    model: "gpt-5-mini", max_completion_tokens: 12000, reasoning_effort: "minimal", response_format: { type: "json_object" },
    messages: [{ role: "system", content: sys }, { role: "user", content: [{ type: "file", file: { filename: `board_${b.id}.pdf`, file_data: `data:application/pdf;base64,${b64}` } }, { type: "text", text: "이 PDF의 글을 칸별로 옮겨 줘." }] }],
  });
  const raw = await res.text();
  let out: any = null, inT = 0, outT = 0;
  try {
    const j = JSON.parse(raw);
    inT = Number(j.usage?.prompt_tokens ?? 0); outT = Number(j.usage?.completion_tokens ?? 0);
    out = JSON.parse(j.choices?.[0]?.message?.content ?? "");
  } catch { console.error("senior import", res.status, raw.slice(0, 400)); }
  await logUsage(db, userId, inT, outT, Boolean(out), "senior_import");
  const items = (Array.isArray(out?.items) ? out.items : []).map((x: any, i: number) => ({
    board_id: b.id, record_id: b.record_id, university: b.university, track: b.track, grade: b.grade, area: b.area,
    label: clean(x?.label, 40), body: String(x?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 3000), sort: i,
  })).filter((x: any) => x.body.length >= 5);
  if (!items.length) return { error: res.ok ? "글을 뽑지 못했어요" : `AI 오류 ${res.status}` };
  await db.from("senior_cases").delete().eq("board_id", b.id);
  const { error: e2 } = await db.from("senior_cases").insert(items);
  if (e2) { console.error("senior save", e2); return { error: "저장하지 못했어요" }; }
  return { lines: items.length };
}

/* 화면에 보여 줄 '지금 하는 일' — 도구마다 우리말로 */
export function stepLabel(name: string, a: any) {
  const u = clean(a?.university, 20), d = clean(a?.department, 20);
  const who = [u, d].filter(Boolean).join(" ");
  switch (name) {
    case "search_units": return `${who || "대학"} 모집 정보 찾는 중`;
    case "get_rules": return `${u || "대학"} 전형 방법 읽는 중`;
    case "get_changes": return `${u || "대학"} 바뀐 점 확인하는 중`;
    case "get_results": return `${who || "대학"} 입결 확인하는 중`;
    case "get_jeongsi_results": return `${who || "대학"} 정시 입결 확인하는 중`;
    case "get_interview_style": return `${u || "대학"} 면접 스타일 찾는 중`;
    case "get_recommended_subjects": return `${who || "학과"} 권장과목 찾는 중`;
    case "get_topic_cases": return `${d || "학과"} 실제 탐구 사례 찾는 중`;
    case "get_book_recs": return `${d || "학과"} 추천 도서 찾는 중`;
    case "get_study_tips": return `${a?.subject && a.subject !== "전과목" ? a.subject + " " : ""}선배 공부법 찾는 중`;
    case "my_record": return "내 생기부 노트 자세히 읽는 중";
    case "school_eval": return `${clean(a?.school, 20) || "학교"} ${clean(a?.subject, 20) ? clean(a.subject, 20) + " " : ""}평가계획 확인하는 중`;
    case "list_universities": return "자료 있는 대학 확인하는 중";
    case "check_topic": return "탐구주제 흔한가 진단하는 중 (10초쯤 걸려요)";
    case "check_motive": return `${u ? u + " 기준으로 " : ""}지원동기 흔한가 진단하는 중 (10초쯤 걸려요)`;
    case "interview_questions": return `${who || "대학"} 면접 기준으로 예상질문 뽑는 중 (30초쯤 걸려요)`;
    case "tail_practice": return a?.action === "next" ? "내 답변 듣고 다음 꼬리질문 만드는 중" : `${u || "대학"} 면접관처럼 꼬리질문 만드는 중`;
    case "check_reading": return `'${clean(a?.title, 20) || "책"}' 독서 흔한가 진단하는 중 (10초쯤 걸려요)`;
    case "find_seniors": return `${TRACK_LABEL[a?.track] ?? ""} 합격 선배 생기부에서 비슷한 사례 찾는 중`;
    case "propose_action": return a?.kind === "study_test" ? "자기주도학습법 시험 준비해 둘지 정하는 중" : "면접 준비에 넣을지 정하는 중";
    default: return "자료 찾는 중";
  }
}