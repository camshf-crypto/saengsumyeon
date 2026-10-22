// 생수면 · 흔한가 결과 → 탐구 결과물 만들기 버튼 (8단계)
// 경로: src/pages/output/MakeOutputButton.jsx
//
// 흔한가 결과 화면에서:
//   import MakeOutputButton from '../output/MakeOutputButton';
//   <MakeOutputButton topic={학생이_넣은_주제} score={흔함점수} suggestion={추천주제} />

import { useNavigate } from 'react-router-dom';

export default function MakeOutputButton({ topic, score, suggestion }) {
  const navigate = useNavigate();
  const go = (t) => navigate(`/output/new?topic=${encodeURIComponent(t)}`);
  const common = typeof score === 'number' && score >= 60;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-[#0B6BCB] bg-[#F5FAFF] p-5 text-[#0F2233]">
      <span className="text-sm font-bold text-[#0B6BCB]">다음 단계 · 탐구 결과물 만들기</span>
      <span className="text-xl font-black leading-snug">
        {common
          ? `흔함 ${score}점이어도 괜찮아요. 결과물을 움직이는 웹으로 만들면 안 흔해져요.`
          : '안 흔한 주제, 결과물까지 안 흔하게 만들어 볼까요?'}
      </span>
      <span className="text-[15px] leading-relaxed text-[#4F6275]">
        값을 바꿔 보는 시뮬레이터, 내가 잰 숫자로 그린 그래프처럼 선생님이 직접 눌러 보는 결과물이에요. 보고서엔 링크와 QR로 붙여요.
      </span>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => go(topic)} className="min-h-[48px] rounded-xl bg-[#0B6BCB] px-5 font-bold text-white">
          이 주제로 결과물 만들기
        </button>
        {suggestion && suggestion !== topic && (
          <button onClick={() => go(suggestion)} className="min-h-[48px] rounded-xl border border-[#0B6BCB] bg-white px-5 font-bold text-[#0B6BCB]">
            추천 주제로 만들기
          </button>
        )}
      </div>
      <span className="text-[13px] text-[#4F6275]">무료로 3개까지 만들 수 있어요</span>
    </div>
  );
}