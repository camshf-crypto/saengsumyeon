// 🏫 학교 찾기 — 가입 화면에서 학교 이름을 치면 전국 고등학교를 찾아 준다 (나이스 교육정보 개방 포털)
// 배포: npx supabase functions deploy school --project-ref xhywexuazwipwvzrldwo
// 비밀값(선택): NEIS_KEY — open.neis.go.kr 에서 받은 인증키. 없어도 되지만 한 번에 5개까지만 나온다
//
// 요청 { q: "개포" }
// 응답 { list: [{ code, name, region, kind, address }] }
//   region 은 "서울 강남구" 모양 (학교 평가계획 표 school_eval_subjects.region 과 같은 모양)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// 시도 이름 줄이기 — 서울특별시 → 서울
const SIDO: Record<string, string> = {
  서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주",
  대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원도: "강원",
  강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남", 전라북도: "전북", 전북특별자치도: "전북",
  전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주",
};

// 주소 "서울특별시 강남구 개포로 …" → "서울 강남구" · 세종은 "세종"
function regionOf(sido: string, addr: string) {
  const short = SIDO[sido] ?? sido;
  if (short === "세종") return "세종";
  const gu = String(addr || "").split(/\s+/)[1] ?? "";
  return /[시군구]$/.test(gu) ? `${short} ${gu}` : short;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { q } = await req.json().catch(() => ({}));
    const word = String(q ?? "").trim().replace(/고등학교$|고교$/, "").slice(0, 20);
    if (word.length < 1) return json({ list: [] });

    const url = new URL("https://open.neis.go.kr/hub/schoolInfo");
    url.searchParams.set("Type", "json");
    url.searchParams.set("pIndex", "1");
    url.searchParams.set("pSize", "20");
    url.searchParams.set("SCHUL_KND_SC_NM", "고등학교");
    url.searchParams.set("SCHUL_NM", word);
    const key = Deno.env.get("NEIS_KEY");
    if (key) url.searchParams.set("KEY", key);

    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await r.json().catch(() => null);
    const rows = data?.schoolInfo?.[1]?.row ?? []; // 결과가 없으면 schoolInfo 가 없다
    const list = rows.map((x: any) => ({
      code: x.SD_SCHUL_CODE,
      name: x.SCHUL_NM,
      region: regionOf(x.LCTN_SC_NM, x.ORG_RDNMA),
      kind: x.HS_SC_NM || "", // 일반고 · 특목고 · 특성화고 · 자율고
      address: x.ORG_RDNMA || "",
    }));
    // 이름이 친 글자로 시작하는 학교를 먼저
    list.sort((a: any, b: any) => Number(!a.name.startsWith(word)) - Number(!b.name.startsWith(word)));
    return json({ list });
  } catch (e) {
    return json({ list: [], error: String((e as Error)?.message ?? e) });
  }
});