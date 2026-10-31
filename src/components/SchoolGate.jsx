import { useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { track } from "../lib/track";
import SchoolPicker, { schoolData } from "./SchoolPicker";

/*
 * 학교 입력 팝업 (App 에 한 번만 둔다) — 가입은 했는데 학교가 없는 회원(학교를 받기 전 가입자)에게
 * 어느 화면에 있든 바로 뜬다 · 닫기 없음 (학교를 저장해야 쓸 수 있다)
 * 가입 마무리를 아직 안 한 사람은 Signup 화면에서 학교를 받으니 여기선 띄우지 않는다
 */
const SKIP_PATHS = ["/signup", "/login", "/auth", "/admin", "/terms", "/privacy"];

export default function SchoolGate() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const meta = user?.user_metadata ?? {};
  const need = user && (meta.agreed_at || meta.grade) && !meta.school;
  if (!need || SKIP_PATHS.some((p) => pathname.startsWith(p))) return null;

  async function save() {
    if (!pick) return setErr("학교를 골라 주세요. 목록에 없으면 '직접 입력'을 눌러요.");
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.updateUser({ data: schoolData(pick) });
    setBusy(false);
    if (error) return setErr("저장하지 못했어요. 잠시 후 다시 해 주세요.");
    track("school_saved", pick.code ? "list" : "manual");
    // 저장되면 로그인 정보가 바뀌어 user 에 school 이 생기고 팝업이 저절로 닫힌다
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-6 pb-8 sm:rounded-3xl">
        <p className="text-[13px] font-extrabold text-sm-orange">한 번만 알려 줘</p>
        <h2 className="mt-1 text-[21px] font-black leading-snug text-sm-navy">
          어느 학교 다녀?
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-500">
          학교를 알면 물꼬가 우리 학교 수행평가 · 시험 일정에 맞춰 알려 줄 수 있어요
        </p>
        <div className="mt-5">
          <SchoolPicker onChange={setPick} />
        </div>
        {err && <p className="mt-3 text-[13px] font-semibold text-red-500">{err}</p>}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="mt-5 h-12 w-full rounded-2xl bg-sm-navy text-[15px] font-extrabold text-white disabled:opacity-50"
        >
          {busy ? "저장 중…" : "저장하고 계속하기"}
        </button>
      </div>
    </div>
  );
}