import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const nav = useNavigate();
  const { state } = useLocation(); // 결과 화면에서 넘어온 진단 정보

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 진단을 하다 온 경우엔 결과로, 아니면 첫 화면으로
  async function goBack() {
    // 로그인 전에 남긴 익명 진단을 내 기록으로 이어붙인다
    const { error } = await supabase.rpc("claim_my_queries");
    if (error) console.warn("claim failed", error);

    if (state?.topic) nav("/result", { state, replace: true });
    else nav("/", { replace: true });
  }

  async function submit(e) {
    e.preventDefault();
    if (!email.includes("@")) return setErr("이메일을 확인해 주세요.");
    if (!password) return setErr("비밀번호를 입력해 주세요.");

    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);

    if (error) {
      setErr(
        error.message.includes("Invalid login credentials")
          ? "이메일 또는 비밀번호가 맞지 않습니다."
          : error.message.includes("Email not confirmed")
          ? "이메일 인증을 먼저 완료해 주세요."
          : error.message
      );
      return;
    }

    await goBack();
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange";

  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">로그인</h1>

      {/* 결과 화면에서 넘어온 주제를 다시 보여준다 */}
      {state?.topic && (
        <div className="mt-6 rounded-xl bg-gray-50 p-4">
          <p className="text-[11.5px] font-bold text-gray-400">진단한 탐구주제</p>
          <p className="mt-1.5 text-[14px] font-bold leading-relaxed text-sm-navy">
            {state.topic}
          </p>
        </div>
      )}

      <form className="mt-6 space-y-3" onSubmit={submit}>
        <input
          className={input}
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className={input}
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {err && <p className="text-sm font-semibold text-red-500">{err}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-50"
        >
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-gray-500">
        아직 회원이 아니신가요?{" "}
        <Link to="/signup" state={state} className="font-bold text-sm-navy underline">
          회원가입
        </Link>
      </p>
    </div>
  );
}