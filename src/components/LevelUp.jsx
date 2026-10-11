import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

/*
 * 레벨업 팝업 (모든 화면 공통)
 * · 점수가 오를 만한 일(응답 · 댓글 · 글 · 출석) 뒤에는 checkLevel() 을 부른다
 * · 레벨이 올랐거나 단계 보상(조각 · 쿠폰)을 받았으면 어느 화면에서든 팝업이 뜬다
 * · 화면을 옮길 때도 한 번 확인한다 (다른 사람이 '나도 그래'를 눌러 줘서 오른 경우)
 */
const LEVEL_EVENT = "sm:levelup";

/* 레벨 확인 — 돌려주는 값: { info, level_up, prev_level, rewards } (로그인 안 했으면 null) */
export async function checkLevel() {
  const { data } = await supabase.rpc("lv_check");
  if (data && (data.level_up || (data.rewards || []).length)) {
    window.dispatchEvent(new CustomEvent(LEVEL_EVENT, { detail: data }));
  }
  return data;
}

function Popup({ data, onClose }) {
  const { info, level_up, prev_level, rewards = [] } = data;
  const pieces = rewards.reduce((a, r) => a + (r.pieces || 0), 0);
  const coupons = rewards.filter((r) => r.coupon);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0B0F1F]/55 px-5" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-extrabold text-white"
          style={{ background: info.color }}
        >
          {info.level}
        </div>
        <h3 className="mt-4 text-[20px] font-bold tracking-tight text-sm-navy">
          {level_up ? `Lv.${info.level} ${info.stage}이 됐어요` : `지금 Lv.${info.level} ${info.stage}이에요`}
        </h3>
        <p className="mt-1 text-[13px] text-gray-500">
          {level_up && prev_level ? `Lv.${prev_level}에서 올라왔어요 · ` : ""}
          {info.max ? "최고 레벨이에요" : `다음 레벨까지 ${info.need}점`}
        </p>
        {(pieces > 0 || coupons.length > 0) && (
          <div className="mt-5 grid gap-2 text-left">
            {pieces > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-[14px]">
                <svg className="h-5 w-5 flex-none text-sm-navy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z" />
                </svg>
                <div>
                  <b className="text-sm-navy">합격 생기부 조각 +{pieces}</b>
                  <small className="block text-[12px] text-gray-500">퍼즐에서 바로 쓸 수 있어요</small>
                </div>
              </div>
            )}
            {coupons.map((c) => (
              <div key={c.stage_no} className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-[14px]">
                <svg className="h-5 w-5 flex-none text-sm-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4z" />
                </svg>
                <div>
                  <b className="text-sm-navy">{c.stage} 달성 쿠폰 {c.coupon.toLocaleString()}원</b>
                  <small className="block text-[12px] text-gray-500">1년 안에 예상질문 결제할 때 쓸 수 있어요</small>
                </div>
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-bold text-white">
          확인
        </button>
      </div>
    </div>
  );
}

/* App 에 한 번만 둔다 */
export default function LevelUpHost() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { pathname } = useLocation();
  const [data, setData] = useState(null);

  useEffect(() => {
    const on = (e) => setData(e.detail);
    window.addEventListener(LEVEL_EVENT, on);
    return () => window.removeEventListener(LEVEL_EVENT, on);
  }, []);

  // 화면을 옮길 때마다 한 번 확인 (관리자 화면 제외)
  useEffect(() => {
    if (uid && !pathname.startsWith("/admin")) checkLevel();
  }, [uid, pathname]);

  if (!data) return null;
  return <Popup data={data} onClose={() => setData(null)} />;
}