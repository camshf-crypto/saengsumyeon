import { SUBJECT_TYPES } from "./PositionReport";

const GRADES_SCHOOL = ["고1", "고2"];
const ACHIEVES = ["A", "B", "C", "D", "E"];

// 1번 화면: 학년·희망학과·과목별 성적 입력
// 필수: 과목명, 유형, 학점, 석차등급(융합선택 제외), 성취도
export default function GradeInput({ student, setStudent, addRow, updateRow, removeRow, onNext }) {
  const filled = student.rows.filter(
    (r) => r.name.trim() && (r.type === "융합선택" || r.grade !== "")
  ).length;
  const canNext = student.major.trim() && filled > 0;

  const cell =
    "h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-[14px] outline-none focus:border-sm-orange";

  return (
    <div className="mt-3 flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold leading-snug tracking-tight text-sm-navy">
        내 성적으로 학과 위치 찾기
      </h1>

      {/* 학년 · 희망학과 */}
      <section className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-bold text-gray-600">학년</p>
          <div className="flex gap-2">
            {GRADES_SCHOOL.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setStudent({ ...student, grade: g })}
                className={`h-11 flex-1 rounded-lg border text-[15px] font-bold transition ${
                  student.grade === g
                    ? "border-sm-orange bg-orange-50 text-sm-orange"
                    : "border-gray-300 text-gray-600"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="major" className="text-[13px] font-bold text-gray-600">
            희망학과
          </label>
          <input
            id="major"
            value={student.major}
            onChange={(e) => setStudent({ ...student, major: e.target.value })}
            placeholder="예) 간호학과"
            className="h-11 rounded-lg border border-gray-300 px-3 text-[15px] outline-none focus:border-sm-orange"
          />
        </div>
      </section>

      {/* 과목별 성적 */}
      <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-bold text-sm-navy">과목별 성적</p>
          <p className="text-xs text-gray-500">{student.semester}</p>
        </div>

        <div className="grid grid-cols-[1.5fr_1.1fr_0.6fr_0.7fr_0.7fr_24px] gap-1.5 text-[11.5px] font-bold text-gray-500">
          <span>과목</span><span>유형</span><span>학점</span><span>등급</span><span>성취도</span><span />
        </div>

        {student.rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1.5fr_1.1fr_0.6fr_0.7fr_0.7fr_24px] items-center gap-1.5">
            <input
              aria-label="과목명"
              value={r.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              className={cell}
            />
            <select
              aria-label="과목 유형"
              value={r.type}
              onChange={(e) => updateRow(i, { type: e.target.value })}
              className={cell}
            >
              {SUBJECT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <input
              aria-label="학점"
              type="number"
              min="1"
              max="8"
              value={r.credit}
              onChange={(e) => updateRow(i, { credit: Number(e.target.value) })}
              className={cell}
            />
            {r.type === "융합선택" ? (
              <span className="text-center text-xs text-gray-400">없음</span>
            ) : (
              <select
                aria-label="석차등급"
                value={r.grade}
                onChange={(e) => updateRow(i, { grade: e.target.value === "" ? "" : Number(e.target.value) })}
                className={cell}
              >
                <option value="">-</option>
                {[1, 2, 3, 4, 5].map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <select
              aria-label="성취도"
              value={r.achieve}
              onChange={(e) => updateRow(i, { achieve: e.target.value })}
              className={cell}
            >
              {ACHIEVES.map((a) => <option key={a}>{a}</option>)}
            </select>
            <button
              type="button"
              aria-label="과목 삭제"
              onClick={() => removeRow(i)}
              className="h-10 text-lg text-gray-400 hover:text-red-500"
            >
              ×
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={addRow}
            className="h-11 flex-1 rounded-lg border border-gray-300 text-sm font-bold text-gray-600"
          >
            과목 추가
          </button>
          {/* TODO 성적표 엑셀 업로드 — 다음 단계 */}
          <button
            type="button"
            disabled
            className="h-11 flex-1 rounded-lg border border-dashed border-gray-300 text-sm text-gray-400"
          >
            엑셀로 올리기 (준비 중)
          </button>
        </div>
        <p className="text-xs text-gray-500">사회·과학 융합선택은 등급이 없어서 성취도만 넣으면 돼요.</p>
      </section>

      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="mt-2 h-[52px] w-full rounded-lg bg-sm-orange text-[16px] font-extrabold text-white disabled:opacity-40"
      >
        내 위치 보기
      </button>
    </div>
  );
}