import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./landing.css";

const GRADES = ["고1", "고2", "고3"];
const TERMS = ["1학기", "2학기"];

/* DB에 들어 있는 과목 분류 그대로 — 학생 입력과 매칭하려면 값이 같아야 한다 */
const SUBJECTS = [
  "국어",
  "수학",
  "영어",
  "사회",
  "과학",
  "한국사",
  "교양",
  "예술",
  "체육",
  "기술·가정/정보",
  "제2외국어/한문",
  "전문 교과 I",
  "전문 교과 II",
];

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

export default function Landing() {
  const nav = useNavigate();

  const [department, setDepartment] = useState("");
  const [grade, setGrade] = useState("");
  const [term, setTerm] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");

  const ready =
    department.trim() !== "" &&
    grade !== "" &&
    term !== "" &&
    subject !== "" &&
    topic.trim().length >= 5;

  function submit(e) {
    e.preventDefault();
    if (!ready) return;
    // 결과를 먼저 보여주고, 회원가입은 결과 화면 안에서 받는다
    nav("/result", {
      state: {
        department: department.trim(),
        grade,
        term,
        subject,
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
            {/* 학과는 131개라 타이핑하면 걸러지도록 */}
            <input
              className="tfield tfull"
              type="text"
              list="dept-list"
              aria-label="희망 학과"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="희망 학과 (예: 간호학과)"
            />
            <datalist id="dept-list">
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>

            <div className="trow">
              <select
                className="tfield"
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

              <select
                className="tfield"
                aria-label="과목"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">과목</option>
                {SUBJECTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              id="topic"
              className="tinput"
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="탐구주제를 적어주세요&#10;예) 카페인이 청소년의 수면에 미치는 영향"
            />

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