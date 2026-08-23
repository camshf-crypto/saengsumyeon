import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  // 구매 흐름에서 튕겨온 경우엔 원래 가려던 곳으로, 그냥 로그인이면 랜딩으로
  const from = loc.state?.from ?? "/";

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(false); // 이메일 미인증
  const [resent, setResent] = useState(false);

  async function submit() {
    if (!email.trim() || !pw) return setErr("이메일과 비밀번호를 입력해 주세요.");

    setBusy(true);
    setErr("");
    setNeedConfirm(false);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pw,
    });
    setBusy(false);

    if (error) {
      // 인증 안 한 계정과 비밀번호 오류를 구분해서 안내한다
      if (/not confirmed|Email not confirmed/i.test(error.message)) {
        setNeedConfirm(true);
        setErr("이메일 인증이 완료되지 않았습니다.");
      } else {
        setErr("이메일 또는 비밀번호가 올바르지 않습니다.");
      }
      return;
    }
    nav(from, { replace: true });
  }

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) {
      setErr("재발송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setResent(true);
  }

  async function resetPassword() {
    if (!email.trim()) return setErr("비밀번호를 재설정할 이메일을 먼저 입력해 주세요.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    });
    setBusy(false);
    setErr(
      error
        ? "메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요."
        : "비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요."
    );
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange";

  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">로그인</h1>

      <div className="mt-8 space-y-3">
        <input
          className={input}
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <input
          className={input}
          type="password"
          placeholder="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

      {/* 이메일 미인증 안내 */}
      {needConfirm && (
        <div className="mt-3 rounded-xl bg-orange-50 p-4 text-[13px] leading-relaxed text-gray-600">
          <p>가입 시 보낸 메일에서 인증 링크를 눌러주세요. 스팸함도 확인해 보시고요.</p>
          <button
            onClick={resend}
            disabled={busy || resent}
            className="mt-3 w-full rounded-lg bg-white py-2.5 text-xs font-bold text-sm-navy disabled:opacity-50"
          >
            {resent ? "재발송 완료" : busy ? "보내는 중…" : "인증 메일 다시 보내기"}
          </button>
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-50"
      >
        {busy ? "로그인 중…" : "로그인"}
      </button>

      <button
        onClick={resetPassword}
        disabled={busy}
        className="mt-4 block w-full text-center text-sm text-gray-400 underline"
      >
        비밀번호를 잊으셨나요?
      </button>

      <p className="mt-5 text-center text-sm text-gray-500">
        아직 회원이 아니신가요?{" "}
        <Link to="/signup" className="font-bold text-sm-navy underline">회원가입</Link>
      </p>
    </div>
  );
}