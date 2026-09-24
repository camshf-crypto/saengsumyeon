import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

const GRADES = ["고1", "고2", "고3"];

export default function Signup() {
  const nav = useNavigate();
  const { state } = useLocation(); // 결과 화면에서 넘어온 진단 정보

  const [f, setF] = useState({
    email: "",
    password: "",
    password2: "",
    name: "",
    grade: state?.grade ?? "고3",
  });
  const [agree, setAgree] = useState({ terms: false, privacy: false, marketing: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); // 인증 메일을 보낸 경우
  const [resent, setResent] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const allChecked = agree.terms && agree.privacy && agree.marketing;

  function toggleAll() {
    const v = !allChecked;
    setAgree({ terms: v, privacy: v, marketing: v });
  }

  function validate() {
    if (!f.email.includes("@")) return "이메일을 확인해 주세요.";
    if (f.password.length < 8) return "비밀번호는 8자 이상 입력해 주세요.";
    if (f.password !== f.password2) return "비밀번호가 서로 다릅니다.";
    if (!f.name.trim()) return "이름을 입력해 주세요.";
    if (!agree.terms || !agree.privacy) return "필수 약관에 동의해 주세요.";
    return "";
  }

  // 진단을 하다 온 경우엔 결과로, 아니면 첫 화면으로
  async function goBack() {
    // 가입 전에 남긴 익명 진단을 내 기록으로 이어붙인다
    const { error } = await supabase.rpc("claim_my_queries");
    if (error) console.warn("claim failed", error);

    if (state?.topic) nav("/result", { state, replace: true });
    else nav("/", { replace: true });
  }

  async function submit() {
    const msg = validate();
    if (msg) return setErr(msg);

    setBusy(true);
    setErr("");
    const { data, error } = await supabase.auth.signUp({
      email: f.email.trim(),
      password: f.password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          name: f.name.trim(),
          grade: f.grade,
          marketing_agreed: agree.marketing,
        },
      },
    });
    setBusy(false);

    if (error) {
      setErr(
        error.message.includes("already registered")
          ? "이미 가입된 이메일입니다."
          : error.message
      );
      return;
    }

    // 이미 가입된 이메일이면 Supabase가 빈 identities를 돌려준다
    if (data?.user && data.user.identities?.length === 0) {
      setErr("이미 가입된 이메일입니다. 로그인해 주세요.");
      return;
    }

    // 이메일 인증이 꺼져 있으면 바로 세션이 생긴다 → 결과로 돌아간다
    if (data?.session) {
      await goBack();
      return;
    }

    // 인증이 필요한 경우에만 안내 화면
    setSent(true);
  }

  async function resend() {
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: f.email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) {
      setErr("재발송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setResent(true);
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange";

  /* ── 인증 메일 발송 안내 ─────────────────────────────── */
  if (sent) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-2xl font-extrabold tracking-tight text-sm-navy">
          인증 메일을 보냈습니다
        </p>
        <p className="mt-4 text-sm leading-relaxed text-gray-600">
          <b className="text-sm-navy">{f.email}</b> 으로 보낸 메일에서
          <br />
          인증 링크를 눌러주세요.
        </p>

        <div className="mt-8 rounded-xl bg-gray-50 p-5 text-left text-[13px] leading-relaxed text-gray-500">
          <p className="font-bold text-sm-navy">메일이 안 보이나요?</p>
          <p className="mt-2">· 스팸함을 확인해 주세요.</p>
          <p>· 도착까지 1~2분 걸릴 수 있습니다.</p>
          <p>· 주소를 잘못 입력했다면 다시 가입해 주세요.</p>
        </div>

        <button
          onClick={resend}
          disabled={busy || resent}
          className="mt-6 w-full rounded-lg border border-gray-300 py-3.5 text-sm font-bold text-gray-600 disabled:opacity-50"
        >
          {resent ? "재발송 완료" : busy ? "보내는 중…" : "인증 메일 다시 보내기"}
        </button>

        {err && <p className="mt-3 text-sm font-semibold text-red-500">{err}</p>}

        <Link
          to="/login"
          state={state}
          className="mt-6 block text-sm text-gray-400 underline"
        >
          인증을 마쳤다면 로그인
        </Link>
      </div>
    );
  }

  /* ── 가입 폼 ─────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">회원가입</h1>
      <p className="mt-2 text-sm text-gray-500">
        가입하면 진단 결과 전체를 바로 확인하실 수 있습니다.
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

      <div className="mt-6 space-y-3">
        <input className={input} placeholder="이메일" value={f.email} onChange={set("email")} />
        <input className={input} type="password" placeholder="비밀번호 (8자 이상)" value={f.password} onChange={set("password")} />
        <input className={input} type="password" placeholder="비밀번호 확인" value={f.password2} onChange={set("password2")} />
        <input className={input} placeholder="이름" value={f.name} onChange={set("name")} />
        <div className="flex gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setF({ ...f, grade: g })}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-bold transition ${
                f.grade === g
                  ? "border-sm-orange bg-orange-50 text-sm-orange"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* 약관 */}
      <div className="mt-7 rounded-xl border border-gray-200 p-4">
        <label className="flex cursor-pointer items-center gap-2 font-bold text-sm-navy">
          <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 accent-orange-500" />
          전체 동의
        </label>
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-[13px] text-gray-600">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={agree.terms} onChange={() => setAgree({ ...agree, terms: !agree.terms })} className="h-4 w-4 accent-orange-500" />
            <span>[필수] 이용약관 동의</span>
            <Link to="/terms" target="_blank" className="ml-auto text-gray-400 underline">보기</Link>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={agree.privacy} onChange={() => setAgree({ ...agree, privacy: !agree.privacy })} className="h-4 w-4 accent-orange-500" />
            <span>[필수] 개인정보 수집·이용 동의</span>
            <Link to="/privacy" target="_blank" className="ml-auto text-gray-400 underline">보기</Link>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={agree.marketing} onChange={() => setAgree({ ...agree, marketing: !agree.marketing })} className="h-4 w-4 accent-orange-500" />
            <span>[선택] 마케팅 정보 수신 동의</span>
          </label>
        </div>
      </div>

      {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-50"
      >
        {busy ? "가입 중…" : "가입하기"}
      </button>

      <p className="mt-5 text-center text-sm text-gray-500">
        이미 계정이 있으신가요?{" "}
        <Link to="/login" state={state} className="font-bold text-sm-navy underline">
          로그인
        </Link>
      </p>
    </div>
  );
}