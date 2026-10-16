import { Link } from "react-router-dom";

/*
 * 회원 전용 공통 로그인 안내 — 전과목 단어장 · 내 생기부 진단이 같은 모양을 쓴다
 *   <LoginGate .../>  : 화면 전체를 막을 때 (진단 · 로드맵 · 단어장 카드 화면에 주소로 바로 온 경우)
 *   <LoginPopup .../> : 화면은 보여 주고, 저장하거나 시작하려는 순간 띄울 때 (노트 작성 · 단원 고르기)
 */
function GateCard({ icon, title, desc, onClose }) {
  return (
    <div className="relative mx-auto w-full max-w-md rounded-2xl bg-white p-8 text-center ring-1 ring-gray-200">
      {onClose && (
        <button onClick={onClose} className="absolute right-4 top-3 text-[24px] leading-none text-gray-400" aria-label="닫기">
          ×
        </button>
      )}
      {icon && <div className="flex justify-center">{icon}</div>}
      <p className="mt-4 text-[19px] font-bold text-sm-navy">{title}</p>
      {desc && <p className="mt-2 text-[13.5px] leading-relaxed text-gray-500">{desc}</p>}
      <Link to="/login" className="mt-5 flex h-12 w-full items-center justify-center rounded-[10px] bg-sm-navy text-[15px] font-bold text-white">
        로그인하고 시작하기
      </Link>
      <Link to="/signup" className="mt-2 block text-[13px] font-semibold text-gray-500 underline">
        처음이면 회원가입
      </Link>
    </div>
  );
}

/* 화면 전체를 막는 안내 — 주소로 바로 들어온 회원 전용 화면 */
export default function LoginGate(props) {
  return (
    <div className="min-h-[70vh] bg-[#F4F5F7] px-5 py-16">
      <GateCard {...props} />
    </div>
  );
}

/* 화면은 보여 주고, 저장·시작하려는 순간 띄우는 안내 */
export function LoginPopup({ open, onClose, ...props }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <GateCard {...props} onClose={onClose} />
      </div>
    </div>
  );
}

/* 생기부 노트 아이콘 — 노트 · 진단 · 로드맵 화면에서 같이 쓴다 */
export function NoteIcon({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="9" y="5" width="30" height="38" rx="5" fill="#EEF2FF" stroke="#1E2A5A" strokeWidth="2.5" />
      <path d="M16 15h16M16 22h16M16 29h10" stroke="#1E2A5A" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="35" cy="35" r="8" fill="#FB923C" />
      <path d="M31.5 35l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}