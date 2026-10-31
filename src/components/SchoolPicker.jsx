import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/*
 * 학교 고르기 — 가입 마무리(Signup) · 학교 입력 팝업(SchoolGate) 두 곳에서 같이 쓴다
 * 이름을 치면 전국 고등학교를 찾아 준다 (school 함수 · 나이스) · 목록에 없으면 직접 입력 + 시도
 * onChange(v) — v = { name, code, region } (다 고르기 전이면 null)
 */
const SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
const INPUT = "w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange";

export default function SchoolPicker({ onChange }) {
  const [school, setSchool] = useState(null); // 목록에서 고른 학교
  const [sq, setSq] = useState(""); // 검색어 (직접 입력이면 학교 이름)
  const [found, setFound] = useState([]);
  const [finding, setFinding] = useState(false);
  const [manual, setManual] = useState(false);
  const [sido, setSido] = useState("");
  const findId = useRef(0);

  // 고른 값을 부모에게 알린다
  useEffect(() => {
    if (manual) onChange(sq.trim() && sido ? { name: sq.trim(), code: null, region: sido } : null);
    else onChange(school);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school, manual, sq, sido]);

  // 이름을 치면 0.3초 뒤 찾는다
  useEffect(() => {
    const v = sq.trim();
    if (manual || school || !v) {
      setFound([]);
      setFinding(false);
      return;
    }
    const my = ++findId.current;
    setFinding(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.functions.invoke("school", { body: { q: v } });
      if (my !== findId.current) return;
      setFound(data?.list ?? []);
      setFinding(false);
    }, 300);
    return () => clearTimeout(t);
  }, [sq, manual, school]);

  if (school)
    return (
      <div className="flex items-center gap-3 rounded-lg border border-sm-orange bg-orange-50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-sm-navy">{school.name}</p>
          <p className="text-[12.5px] text-gray-500">{school.region}</p>
        </div>
        <button type="button" onClick={() => { setSchool(null); setSq(""); }} className="text-[12.5px] text-gray-400 underline">
          바꾸기
        </button>
      </div>
    );

  return (
    <div>
      <input
        className={INPUT}
        placeholder={manual ? "학교 이름 (예: 생수고등학교)" : "학교 이름으로 찾기 (예: 개포)"}
        value={sq}
        onChange={(e) => setSq(e.target.value.slice(0, 30))}
      />
      {!manual && sq.trim() && (
        <div className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {found.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => { setSchool(s); setFound([]); }}
              className="flex w-full items-baseline gap-2 border-b border-gray-100 px-4 py-2.5 text-left last:border-0 hover:bg-orange-50"
            >
              <span className="text-[14px] font-bold text-sm-navy">{s.name}</span>
              <span className="text-[12px] text-gray-400">{s.region}</span>
            </button>
          ))}
          {finding && <p className="px-4 py-2.5 text-[12.5px] text-gray-400">찾는 중…</p>}
          {!finding && found.length === 0 && <p className="px-4 py-2.5 text-[12.5px] text-gray-400">찾는 학교가 없어요</p>}
        </div>
      )}
      {manual && (
        <select className={`${INPUT} mt-2 bg-white ${sido ? "" : "text-gray-400"}`} value={sido} onChange={(e) => setSido(e.target.value)}>
          <option value="">지역 고르기</option>
          {SIDO.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      <p className="mt-1.5 text-[12.5px] text-gray-400">
        {manual ? "적어 주면 우리 학교 자료를 먼저 준비할게요 · " : "우리 학교 수행평가 · 시험 일정에 맞춰 알려 줘요 · "}
        <button type="button" onClick={() => { setManual(!manual); setFound([]); }} className="underline">
          {manual ? "다시 찾기" : "목록에 없어요 (직접 입력)"}
        </button>
      </p>
    </div>
  );
}

// 저장 — 학년 · 약관과 같은 곳(로그인 정보)에 둔다
export function schoolData(v) {
  return { school: v.name, school_code: v.code ?? null, school_region: v.region };
}