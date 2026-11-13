// agent/area.ts — 입시 로드맵 창체(자율 · 동아리 · 진로) '전공에 더 가깝게 · 활동 하나 더'
//   활동명 · 내용은 학생이 로드맵에서 직접 적는다. 생기부를 더 잘 쓰고 싶을 때만 여기로 온다 (2026-11-13)
//   ① '(로드맵) 동아리 '건축동아리 부스 운영' 하나 더' → 그 활동 + 희망 학과를 보고 이어서 할 활동 3개 (질문 카드)
//   ② 카드에서 고름 → record_activities 에 '할 계획'으로 넣고 로드맵에 바로 보인다 · '다른 걸로 다시' → ① 다시
import { MODEL, cachedOf, clean, logUsage, openai } from "./core.ts";

const KIND: Record<string, string> = { 자율: "autonomy", 동아리: "club", 진로: "career" };
const FULL: Record<string, string> = { 자율: "자율 · 자치활동", 동아리: "동아리활동", 진로: "진로활동" };
export const AREA_MORE = /^\(로드맵\)\s*(자율|동아리|진로)\s*'(.+?)'\s*하나 더$/;
// 카드 답 — "동아리 '건축동아리 부스 운영'에 이어서 넣을 활동은? → 활동 이름"
export const AREA_PICK = /^(자율|동아리|진로)\s*'(.+?)'에 이어서 넣을 활동은\?\s*→\s*(.+)$/;
const AGAIN = /^다른 걸로 다시/;
const cardSafe = (s: unknown, n: number) => clean(s, n).replace(/[|\]\[]/g, " ").replace(/\s+[—–-]\s+/g, ", ");

const SYSTEM = `너는 고등학생 입시 컨설턴트다. 학생이 이미 한 창의적 체험활동(자율 · 동아리 · 진로) 하나를 보고, 그 활동에서 이어서 하면 희망 학과에 더 가깝게 생기부를 쓸 수 있는 활동 3개를 제안한다. JSON만.
- 학생이 적은 활동에서 이어지는 것이어야 한다 (같은 동아리 · 같은 자치 역할 안에서 한 걸음 더)
- 희망 학과의 전공 개념 · 방법이 한 가지씩 들어가게 (학과를 모르면 활동 자체를 깊게)
- 고등학생이 학교 안에서 몇 주 안에 실제로 할 수 있는 것만 (대학 연구실 · 비싼 장비 · 외부 기관 승인 필요한 것 금지)
- title: 활동 이름 짧게 (25자 안) · what: 무엇을 하는지 한 문장 · why: 생기부에서 어떻게 보이는지(전공과 이어지는 점) 한 문장
- 쉬운 말, "~예요/~해요"
{"items":[{"title":"","what":"","why":""}]}`;

async function suggest(db: any, userId: string, area: string, base: string) {
  const [{ data: my }, { data: rows }] = await Promise.all([
    db.from("sm_my").select("grade, department").eq("user_id", userId).maybeSingle(),
    db.from("record_activities").select("grade, title, content").eq("user_id", userId).eq("kind", KIND[area]).order("created_at", { ascending: false }).limit(10),
  ]);
  const hit = (rows ?? []).find((r: any) => clean(r.title, 120) === clean(base, 120)) ?? null;
  const others = (rows ?? []).filter((r: any) => r !== hit).slice(0, 4).map((r: any) => `- ${clean(r.title, 60)}`).join("\n");
  const res = await openai({
    model: MODEL, max_completion_tokens: 4000, reasoning_effort: "low", response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `[영역] ${FULL[area]}\n[학년] ${my?.grade || "모름"}\n[희망 학과] ${clean(my?.department, 30) || "아직 안 정함"}\n[학생이 한 활동] ${clean(base, 120)}${hit?.content ? ` — ${clean(hit.content, 600)}` : ""}\n[같은 영역에 이미 적은 다른 활동]\n${others || "(없음)"}` },
    ],
  });
  const raw = await res.text();
  let items: any[] = [], usage: any = null;
  if (res.ok) { try { const j = JSON.parse(raw); usage = j.usage; items = JSON.parse(j.choices?.[0]?.message?.content ?? "{}").items ?? []; } catch { /* 빈 결과 */ } }
  else console.error("area openai", res.status, raw.slice(0, 300));
  await logUsage(db, userId, Number(usage?.prompt_tokens ?? 0), Number(usage?.completion_tokens ?? 0), items.length > 0, "agent", cachedOf(usage));
  return { dept: clean(my?.department, 30), items: items.slice(0, 3).map((x: any) => ({ title: cardSafe(x.title, 30), what: cardSafe(x.what, 140), why: cardSafe(x.why, 140) })).filter((x: any) => x.title && x.what) };
}

function suggestText(area: string, base: string, dept: string, items: any[]) {
  if (!items.length) return `지금은 활동을 짜지 못했어요. 잠시 뒤 다시 '하나 더'를 눌러 주세요.`;
  const head = `**${FULL[area]} · ${clean(base, 40)}**에서 이어서 하면${dept ? ` **${dept}** 쪽으로` : ""} 생기부가 더 또렷해지는 활동이에요.`;
  const body = items.map((x, i) => `${i + 1}. **${x.title}** — ${x.what}\n   생기부에서는: ${x.why}`).join("\n");
  const q = `${area} '${cardSafe(base, 40)}'에 이어서 넣을 활동은?`;
  return `${head}\n\n${body}\n\n[[질문: ${q} | ${items.map((x) => `${x.title} — ${x.what}`).join(" | ")} | 다른 걸로 다시 짜 줘 — 세 개 다 마음에 안 들어요]]`;
}

// 방금 물꼬가 낸 카드에서 고른 활동의 설명 찾기 (카드 보기: '활동 이름 — 무엇을 하는지')
function whatOf(history: any[], title: string) {
  for (let k = history.length - 1; k >= 0; k--) {
    const c = String(history[k]?.role === "assistant" ? history[k].content ?? "" : "");
    const m = c.match(/\[\[질문:([\s\S]*?)\]\]/);
    if (!m) continue;
    for (const o of m[1].split("|").slice(1)) {
      const [label, ...d] = o.split(/\s+[—–-]\s+/);
      if (label.trim() === title.trim()) return d.join(" — ").trim();
    }
    return "";
  }
  return "";
}

export async function areaChat(db: any, user: any, message: string, emit: (t: string) => void, history: any[] = []): Promise<string | null> {
  const m = message.trim();
  const more = m.match(AREA_MORE);
  const pick = more ? null : m.match(AREA_PICK);
  if (!more && !pick) return null;
  const area = (more ?? pick)![1];
  const base = (more ?? pick)![2];
  if (more || AGAIN.test(pick![3])) {
    emit(`${FULL[area]} 기록 읽는 중`);
    emit("희망 학과에 가깝게 이어 갈 활동 짜는 중");
    const { dept, items } = await suggest(db, user.id, area, base);
    return suggestText(area, base, dept, items);
  }
  // 고른 활동 — 로드맵에 '할 계획'으로 넣는다 (학생이 하고 나면 로드맵에서 내용을 적어 둔다)
  const title = clean(pick![3], 120);
  const what = whatOf(history, title);
  const { data: my } = await db.from("sm_my").select("grade, department").eq("user_id", user.id).maybeSingle();
  const grade = ["고1", "고2", "고3"].includes(my?.grade) ? my.grade : "고1";
  const { error } = await db.from("record_activities").insert({
    user_id: user.id, grade, kind: KIND[area], subject: null, title,
    content: `(할 계획) ${what || `'${clean(base, 60)}'에서 이어서 하는 활동`}`, department: clean(my?.department, 30), source: null,
  });
  if (error) { console.error("area insert", error); return `로드맵에 넣지 못했어요. 잠시 뒤 다시 골라 주세요.`; }
  return `**로드맵 ${grade} ${FULL[area]}에 넣었어요** — ${title}\n\n${what ? `${what}\n\n` : ""}해 보고 나서 로드맵에서 무엇을 했는지 · 배운 점을 한 줄 더 적어 두면, 진단이 이 활동까지 보고 학과와 이어 줘요.\n[[노트]]`;
}