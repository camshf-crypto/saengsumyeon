import { useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabase";

// 구글·카카오에 다녀오는 동안 화면 이동 state가 사라지므로 잠시 보관해 둔다
// (AuthCallback 화면에서 꺼내 쓴다)
export const RETURN_KEY = "sm_return_state";

// 인스타·카카오톡 같은 앱 안 브라우저에서는 구글이 로그인을 막는다
const IN_APP = /Instagram|FBAN|FBAV|KAKAOTALK|Line\/|NAVER\(inapp|Threads|Barcelona|everytimeApp/i;

export default function Login() {
  const { state } = useLocation(); // 결과 화면에서 넘어온 진단 정보
  const isSignup = !!state?.signup; // 회원가입 버튼으로 들어온 경우
  const inApp = IN_APP.test(navigator.userAgent);

  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(""); // 진행 중인 로그인 ("kakao" | "google")

  async function loginWith(provider) {
    setBusy(provider);
    setErr("");

    try {
      sessionStorage.setItem(RETURN_KEY, JSON.stringify(state ?? null));
    } catch {
      // 저장이 막혀도 로그인 자체는 진행한다
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // 구글은 계정이 여러 개면 고르게 한다
        ...(provider === "google" && { queryParams: { prompt: "select_account" } }),
      },
    });

    // 성공하면 로그인 화면으로 넘어가므로 여기엔 실패했을 때만 도달한다
    if (error) {
      setBusy("");
      setErr("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">
        {isSignup ? "회원가입" : "로그인"}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {isSignup
          ? "카카오 또는 구글 계정으로 바로 가입하고 진단 결과 전체를 확인하세요."
          : "카카오 또는 구글 계정으로 로그인하세요."}
      </p>

      {/* 결과 화면에서 넘어온 주제를 다시 보여준다 */}
      {state?.topic && (
        <div className="mt-6 rounded-xl bg-gray-50 p-4">
          <p className="text-[11.5px] font-bold text-gray-400">진단한 탐구주제</p>
          <p className="mt-1.5 text-[14px] font-bold leading-relaxed text-sm-navy">
            {state.topic}
          </p>
        </div>
      )}

      {/* 카카오 — 앱 안 브라우저에서도 동작해서 맨 위에 둔다
          카카오 공식 버튼 이미지를 그대로 쓴다 */}
      <button
        type="button"
        onClick={() => loginWith("kakao")}
        disabled={!!busy}
        aria-label="카카오로 시작하기"
        className="mt-6 flex h-12 w-full items-center justify-center rounded-md bg-[#FEE500] transition hover:brightness-95 disabled:opacity-50"
      >
        <img src="/kakao-start.png" alt="카카오로 시작하기" className="h-12 w-auto" />
      </button>

      {/* 구글 */}
      <button
        type="button"
        onClick={() => loginWith("google")}
        disabled={!!busy || inApp}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-md border border-gray-300 bg-gray-50 text-[15px] font-semibold text-gray-800 transition hover:bg-gray-100 disabled:opacity-50"
      >
        <img src="/google-g.png" alt="" className="h-5 w-5" />
        {busy === "google" ? "구글로 이동 중…" : isSignup ? "Google로 가입하기" : "Google로 로그인"}
      </button>

      {/* 앱 안 브라우저 안내 — 구글은 막히므로 카카오를 권한다 */}
      {inApp && (
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-[12.5px] leading-relaxed text-gray-500">
          지금 보고 계신 앱 안에서는 구글 로그인이 지원되지 않아요.
          <br />
          카카오로 로그인하시거나, 오른쪽 위 메뉴에서 <b>외부 브라우저로 열기</b>를 눌러주세요.
        </p>
      )}

      {err && <p className="mt-3 text-sm font-semibold text-red-500">{err}</p>}
    </div>
  );
}