import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

// 운영자 전용 테스트 로그인 — 사이트 어디에도 링크 없음, 주소를 아는 사람만 들어온다
// 테스트 계정(test1@test.com ~ test50@test.com)만 로그인되고, 실제 회원 계정은 여기서 못 들어간다
export default function TestLogin() {
  const nav = useNavigate();
  const { user } = useAuth();

  const [num, setNum] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 검색엔진에 잡히지 않게
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  async function login(e) {
    e.preventDefault();
    const n = Number(num);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      setErr("1~50 사이 번호를 넣어주세요.");
      return;
    }
    setBusy(true);
    setErr("");

    const { error } = await supabase.auth.signInWithPassword({
      email: `test${n}@test.com`,
      password: pw,
    });

    setBusy(false);
    if (error) {
      setErr("로그인 실패 — 번호나 비밀번호를 확인해 주세요.");
      return;
    }
    nav("/", { replace: true });
  }

  return (
    <div className="mx-auto max-w-sm px-5 py-14">
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">테스트 계정 로그인</h1>

      {user && (
        <p className="mt-2 text-[13px] text-gray-500">
          지금 로그인: <b className="text-gray-800">{user.email}</b>
        </p>
      )}

      <form onSubmit={login} className="mt-6 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-gray-700">test</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={num}
            onChange={(e) => setNum(e.target.value)}
            placeholder="번호 (1~50)"
            autoFocus
            className="h-12 flex-1 rounded-md border border-gray-300 px-3 text-[15px] outline-none focus:border-sm-navy"
          />
          <span className="text-[15px] font-bold text-gray-700">@test.com</span>
        </div>

        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="비밀번호"
          className="h-12 w-full rounded-md border border-gray-300 px-3 text-[15px] outline-none focus:border-sm-navy"
        />

        <button
          type="submit"
          disabled={busy || !num || !pw}
          className="h-12 w-full rounded-md bg-sm-navy text-[15px] font-bold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "들어가는 중…" : "로그인"}
        </button>
      </form>

      {err && <p className="mt-3 text-sm font-semibold text-red-500">{err}</p>}
    </div>
  );
}