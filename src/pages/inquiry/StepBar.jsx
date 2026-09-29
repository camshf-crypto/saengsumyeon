import { useNavigate } from "react-router-dom";

/*
 * 탐구 단계 탭 — 탐구 준비·결과 분석·보고서 화면이 같이 쓴다
 * 이미 도달한 단계까지만 누를 수 있다 (아직 안 한 단계는 흐리게)
 */
const STEPS = ["주제 진단", "탐구 준비", "결과 분석", "보고서 디자인"];
const REACHED = { prepare: 1, doing: 1, analyze: 2, design: 3, done: 3 };

export default function StepBar({ active, id, stage }) {
  const nav = useNavigate();
  const reached = Math.max(active, REACHED[stage] ?? active);
  const go = [
    () => nav("/my"),
    () => nav(`/inquiry/${id}`),
    () => nav(`/inquiry/${id}/result`),
    () => nav(`/inquiry/${id}/report`),
  ];

  return (
    <nav className="flex items-center gap-1.5" aria-label="탐구 단계">
      {STEPS.map((s, i) => {
        const can = i === 0 || (id && id !== "new" && i <= reached);
        const on = i === active;
        return (
          <div key={s} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => can && !on && go[i]()}
              disabled={!can}
              aria-current={on ? "step" : undefined}
              title={can ? "" : "앞 단계를 먼저 끝내면 열려요"}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition ${
                on
                  ? "border-sm-navy bg-sm-navy text-white"
                  : can
                  ? "border-sm-navy bg-indigo-50 text-sm-navy hover:bg-indigo-100"
                  : "cursor-not-allowed border-gray-300 bg-white text-gray-400"
              }`}
            >
              {i + 1} {s}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-gray-300" />}
          </div>
        );
      })}
    </nav>
  );
}