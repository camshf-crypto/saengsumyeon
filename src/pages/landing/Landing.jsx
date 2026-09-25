import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./landing.css";
import { SUBJECT_HINTS } from "./subjects"; // 과목 추천 목록 (직접 입력도 가능)

const GRADES = ["고1", "고2", "고3"];
const TERMS = ["1학기", "2학기"];
const TOPIC_MAX = 100; // 탐구주제 최대 글자 수

/* 학년·학기 선택칸 화살표 — 브라우저 기본 화살표 대신 ▼ 모양으로 통일 */
const ARROW = {
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 7'%3E%3Cpath d='M0 0h10L5 7z' fill='%231f2937'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 18px center",
  backgroundSize: "11px 8px",
  paddingRight: "40px",
};

/* DB에 들어 있는 학과 131개 */
const DEPARTMENTS = [
  "IT융합학과", "가족자원경영학과", "간호학과", "건축공학과", "건축학과", "게임학과",
  "경영학과", "경제학과", "경찰학과", "공간정보공학과", "과학교육과", "관광과",
  "광고홍보학과", "교육학과", "교통공학과", "국어교육과", "국어국문학과", "국제통상학과",
  "국제학과", "금융학과", "기계공학과", "기계항공학과", "기독교교육과", "농업경제학과",
  "농업생명과학과", "도시공학과", "도시행정학과", "독일어과", "동물자원과학과", "러시아어과",
  "로봇학과", "무역학과", "문헌정보학과", "문화콘텐츠학과", "물리치료학과", "물리학과",
  "미디어커뮤니케이션학과", "미래에너지공학과", "바이오공학과", "바이오식품공학과",
  "반도체공학과", "방사선학과", "법학과", "보건의료학과", "불어불문학과", "사이버보안학과",
  "사학과", "사회복지학과", "사회학과", "산림환경학과", "산업·시각디자인전공", "산업공학과",
  "산업심리학과", "생명공학과", "생명과학과", "세무회계학과", "소방학과", "소비자학과",
  "소프트웨어학과", "수의예과", "수학과", "수학교육과", "스마트팜과학과", "스페인어과",
  "스포츠재활학과", "식량식물자원학과", "식품공학과", "식품생명공학과", "식품영양학과",
  "신소재공학과", "신학과", "실내디자인학과", "심리학과", "아동복지학부", "안경광학과",
  "앙트러프러너십전공", "약학과", "언론정보학과", "역사학과", "연극영화학과", "영어교육과",
  "영어영문학과", "외식·조리전공학과", "유럽문화학과", "유아교육과", "윤리교육과",
  "응급구조학과", "의공학과", "의생명공학과", "의예과", "인공지능학과", "일본어학과",
  "자동차공학과", "자유전공", "작업치료학과", "전기공학과", "전자공학과", "전자재료공학과",
  "전자전기공학", "정보통신학과", "정치외교학과", "제약공학과", "주거환경학과", "중국어학과",
  "지리교육과", "지리학과", "철도시스템학과", "철학과", "체육교육학과", "체코슬로바키아어학과",
  "초등교육학과", "치위생학과", "컴퓨터공학과", "토목공학과", "통계학과", "특수교육학과",
  "패션학과", "펄프제지공학과", "한국어학과", "한국우주공학과", "한의예과", "해양학과",
  "행정학과", "호텔경영학과", "화공생명공학과", "화장품공학과", "화학공학과", "화학과",
  "화학교육과", "환경공학과", "환경원예공학과",
];

/* 추천 검색 — 띄어쓰기·로마숫자(Ⅰ/1) 차이는 무시하고, 앞글자가 맞는 것을 먼저 보여준다 */
const norm = (s) => s.replace(/\s/g, "").replace(/Ⅰ/g, "1").replace(/Ⅱ/g, "2").toLowerCase();

function suggest(q, options) {
  const n = norm(q);
  if (!n) return [];
  const hits = options.filter((o) => norm(o).includes(n));
  if (hits.length === 1 && hits[0] === q) return []; // 이미 고른 값이면 닫는다
  return hits
    .sort((a, b) => Number(norm(b).startsWith(n)) - Number(norm(a).startsWith(n)))
    .slice(0, 6);
}

/* 입력칸 바로 아래에 뜨는 추천 목록 */
function SuggestList({ items, onPick }) {
  if (!items.length) return null;
  return (
    <ul className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl bg-white py-1 text-left shadow-lg ring-1 ring-black/10">
      {items.map((it) => (
        <li key={it}>
          <button
            type="button"
            // 누르는 순간 입력칸 포커스가 빠져 목록이 닫히지 않게
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(it)}
            className="block w-full px-4 py-2.5 text-left text-[14.5px] text-gray-800 hover:bg-orange-50"
          >
            {it}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Landing() {
  const nav = useNavigate();

  const [department, setDepartment] = useState("");
  const [grade, setGrade] = useState("");
  const [term, setTerm] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [focus, setFocus] = useState(null); // "dept" | "subject" | null

  const tooLong = topic.trim().length > TOPIC_MAX;

  const ready =
    department.trim() !== "" &&
    grade !== "" &&
    term !== "" &&
    subject.trim() !== "" &&
    topic.trim().length >= 5 &&
    topic.trim().length <= TOPIC_MAX;

  function submit(e) {
    e.preventDefault();
    if (!ready) return;
    // 결과를 먼저 보여주고, 회원가입은 결과 화면 안에서 받는다
    nav("/result", {
      state: {
        department: department.trim(),
        grade,
        term,
        subject: subject.trim(),
        topic: topic.trim(),
      },
    });
  }

  return (
    <div className="lp">
      {/* 히어로 — 여기서 바로 입력받는다 */}
      <header className="hero">
        <div className="wrap">
          <p className="mid">
            내 탐구주제 <u>흔한가</u>?
          </p>
          <h1>탐구주제 진단</h1>

          <form className="tform" onSubmit={submit}>
            {/* 학과 — 타이핑하면 아래에 추천이 뜬다 */}
            <div className="relative">
              <input
                className="tfield tfull"
                type="text"
                autoComplete="off"
                aria-label="희망 학과"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                onFocus={() => setFocus("dept")}
                onBlur={() => setFocus(null)}
                placeholder="희망 학과 (예: 간호학과)"
              />
              {focus === "dept" && (
                <SuggestList
                  items={suggest(department, DEPARTMENTS)}
                  onPick={(v) => {
                    setDepartment(v);
                    setFocus(null);
                  }}
                />
              )}
            </div>

            <div className="trow relative">
              <select
                className="tfield"
                style={ARROW}
                aria-label="학년"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              >
                <option value="">학년</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>

              <select
                className="tfield"
                style={ARROW}
                aria-label="학기"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              >
                <option value="">학기</option>
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              {/* 과목 — 직접 입력. 타이핑하면 줄 아래에 추천이 뜬다 */}
              <input
                className="tfield"
                type="text"
                autoComplete="off"
                aria-label="과목"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => setFocus("subject")}
                onBlur={() => setFocus(null)}
                placeholder="과목 직접 입력 (예: 화학Ⅰ)"
              />
              {focus === "subject" && (
                <SuggestList
                  items={suggest(subject, SUBJECT_HINTS)}
                  onPick={(v) => {
                    setSubject(v);
                    setFocus(null);
                  }}
                />
              )}
            </div>

            {/* 탐구주제 — 입력은 자유롭게, 100자를 넘으면 확인하기 버튼만 막는다 */}
            <div className="relative">
              <textarea
                id="topic"
                className="tinput"
                rows={3}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="탐구주제를 적어주세요&#10;예) 카페인이 청소년의 수면에 미치는 영향"
              />
              <span
                className={`pointer-events-none absolute bottom-3 right-4 text-[12px] ${
                  tooLong ? "font-bold text-red-500" : "text-gray-400"
                }`}
              >
                {topic.trim().length}/{TOPIC_MAX}
              </span>
            </div>
            {tooLong && (
              <p className="text-[13px] font-bold text-white">
                탐구주제는 {TOPIC_MAX}자 이내로 줄여주세요.
              </p>
            )}

            <button className="tbtn" type="submit" disabled={!ready}>
              확인하기
            </button>
          </form>

          <p className="foot">입력하신 내용은 진단과 서비스 개선을 위해 저장됩니다.</p>
        </div>
      </header>
    </div>
  );
}