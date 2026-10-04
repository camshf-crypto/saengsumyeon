import { useState } from "react";
import GradeInput from "./GradeInput";

// 내 학과 포지션 리포트 (1단계: 내신만으로 위치 찾기)
// 화면 4개를 한 흐름으로 묶고, 학생이 넣은 값은 여기서 들고 다닌다.
// 지금은 1번 화면만 연결됨 — 2~4번은 다음 단계에서 같은 폴더에 추가

// 과목 유형: 사회·과학 융합선택은 석차등급이 없어서 등급 칸을 비운다
export const SUBJECT_TYPES = ["공통", "일반선택", "진로선택", "융합선택"];

const EMPTY_ROW = { name: "", type: "공통", credit: 4, grade: "", achieve: "A" };

// TODO 실제 연결 전까지 확인용 예시 성적
const SAMPLE_ROWS = [
  { name: "공통국어1", type: "공통", credit: 4, grade: 2, achieve: "A" },
  { name: "공통수학1", type: "공통", credit: 4, grade: 2, achieve: "B" },
  { name: "공통영어1", type: "공통", credit: 4, grade: 1, achieve: "A" },
  { name: "통합사회1", type: "공통", credit: 4, grade: 2, achieve: "A" },
  { name: "통합과학1", type: "공통", credit: 4, grade: 2, achieve: "B" },
];

export default function PositionReport() {
  const [step, setStep] = useState(1);
  const [student, setStudent] = useState({
    grade: "고1",
    major: "간호학과",
    semester: "1학년 1학기",
    rows: SAMPLE_ROWS,
  });

  function addRow() {
    setStudent((s) => ({ ...s, rows: [...s.rows, { ...EMPTY_ROW }] }));
  }

  function updateRow(i, patch) {
    setStudent((s) => ({
      ...s,
      rows: s.rows.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...patch };
        // 융합선택으로 바꾸면 등급을 비운다 (석차등급 미표기 과목)
        if (patch.type === "융합선택") next.grade = "";
        return next;
      }),
    }));
  }

  function removeRow(i) {
    setStudent((s) => ({ ...s, rows: s.rows.filter((_, idx) => idx !== i) }));
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-50 px-5 py-8">
      {/* 상단: 서비스명 + 진행 단계 */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-bold text-sm-orange">생수면 · 내 학과 포지션</p>
        <p className="text-xs text-gray-500">{step} / 4</p>
      </div>

      {step === 1 && (
        <GradeInput
          student={student}
          setStudent={setStudent}
          addRow={addRow}
          updateRow={updateRow}
          removeRow={removeRow}
          onNext={() => setStep(2)}
        />
      )}

      {step > 1 && (
        <div className="mt-10 rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {step}번 화면은 다음 단계에서 만들어요.
          <button
            type="button"
            onClick={() => setStep(1)}
            className="mt-4 block w-full rounded-lg border border-gray-300 py-3 font-bold text-gray-600"
          >
            성적 입력으로 돌아가기
          </button>
        </div>
      )}
    </div>
  );
}