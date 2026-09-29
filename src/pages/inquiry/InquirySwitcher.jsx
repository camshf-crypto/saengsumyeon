import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

/*
 * 내 탐구 — 탐구 준비·결과 분석·보고서 디자인 화면 위쪽 오른편 + 사이트 위쪽 헤더
 *  variant "button": 탐구 화면용 [내 탐구 ▼] 버튼
 *  variant "header": 사이트 헤더 글자 메뉴 (label로 이름 바꿈)
 *  variant "mobile": 모바일 펼침 메뉴 안 — 목록이 아래로 그대로 펼쳐진다
 * 누르면 내가 만든 탐구 목록이 열리고, 고르면 그 탐구의 2 탐구 준비 화면으로 간다
 * (목록의 단계 표시는 어디까지 했는지 알려주는 용도 — 이어서 하려면 위쪽 단계 버튼으로)
 */

const STAGE_LABEL = {
  prepare: "2 탐구 준비",
  doing: "2 탐구 준비",
  analyze: "3 결과 분석",
  design: "4 보고서 디자인",
};

export default function InquirySwitcher({ currentId, label = "내 탐구", variant = "button" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null); // null = 아직 안 불러옴
  const box = useRef(null);

  // 열 때마다 새로 불러온다 (다른 탭에서 만든 탐구도 보이게)
  useEffect(() => {
    if (!open || !user) return;
    supabase
      .from("inquiries")
      .select("id, suggestion, stage, method, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) console.warn("inquiry list failed", error);
        setList(data ?? []);
      });
  }, [open, user]);

  // 바깥 누르거나 Esc → 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !box.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 다른 탐구로 이동 — 어느 단계든 2 탐구 준비부터 연다
  // 화면 상태가 섞이지 않게 페이지를 새로 연다
  function go(x) {
    setOpen(false);
    if (x.id === currentId) return;
    window.location.assign(`/inquiry/${x.id}`);
  }

  const mobile = variant === "mobile";
  const trigger = {
    button: `flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-bold ${open ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300 bg-white text-sm-navy hover:border-sm-navy"}`,
    header: `flex items-center gap-1 px-1.5 py-1.5 font-bold transition ${open ? "text-sm-orange" : "text-sm-navy hover:text-sm-orange"}`,
    mobile: "flex w-full items-center justify-between border-t border-gray-100 py-3.5 text-left text-[15px] font-bold text-sm-navy",
  }[variant];

  return (
    <div ref={box} className={mobile ? "" : "relative"}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={trigger}>
        {label} <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className={
            mobile
              ? "mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white"
              : "absolute right-0 top-11 z-50 w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
          }
        >
          <p className="border-b border-gray-100 px-4 py-3 text-[13px] font-extrabold text-sm-navy">
            내 탐구 {list ? <span className="font-bold text-gray-400">{list.length}개</span> : null}
          </p>
          <div className="max-h-[420px] overflow-y-auto">
            {!list && <p className="px-4 py-6 text-center text-[13px] text-gray-400">불러오는 중…</p>}
            {list?.length === 0 && (
              <div className="px-4 py-6 text-center">
                <p className="text-[13px] text-gray-500">아직 만든 탐구가 없어요. 주제 진단부터 시작해요.</p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    window.location.assign("/");
                  }}
                  className="mt-3 rounded-lg bg-sm-navy px-4 py-2 text-[13px] font-bold text-white"
                >
                  주제 진단하러 가기
                </button>
              </div>
            )}
            {list?.map((x) => {
              const on = x.id === currentId;
              const waiting = !x.method; // 결제 대기 (주제만 저장, 탐구팩 아직 없음)
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => go(x)}
                  className={`block w-full border-b border-gray-50 px-4 py-3 text-left ${on ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                >
                  <p className="line-clamp-2 text-[13.5px] font-bold leading-snug text-sm-navy">{x.suggestion || "제목 없는 탐구"}</p>
                  <p className="mt-1 flex items-center gap-2 text-[11.5px]">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${waiting ? "bg-orange-50 text-sm-orange" : "bg-gray-100 text-gray-600"}`}>
                      {waiting ? "결제 대기" : STAGE_LABEL[x.stage] ?? "2 탐구 준비"}
                    </span>
                    <span className="text-gray-400">{new Date(x.created_at).toLocaleDateString("ko-KR")}</span>
                    {on && <span className="ml-auto font-bold text-indigo-600">지금 보는 탐구</span>}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}