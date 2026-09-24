import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();

  const [isAdmin, setIsAdmin] = useState(false);

  // 어드민 여부는 서버에 물어본다 (admins 테이블은 직접 읽을 수 없다)
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    supabase.rpc("is_admin").then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        console.error("is_admin failed", error);
        return;
      }
      setIsAdmin(Boolean(data));
    });
    return () => {
      alive = false;
    };
  }, [user]);

  async function handleLogout() {
    await signOut();
    nav("/");
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5 sm:h-16">
        <Link to="/" className="text-lg font-black tracking-tight text-sm-navy sm:text-xl">
          생수면<span className="text-sm-orange">.</span>
        </Link>

        <div className="ml-auto flex items-center gap-2.5 text-[13px]">
          {isAdmin && (
            <Link
              to="/admin"
              className="rounded-lg bg-sm-orange px-3 py-1.5 font-bold text-white transition hover:bg-orange-600"
            >
              관리자
            </Link>
          )}

          {user ? (
            <>
              <span className="hidden font-semibold text-sm-navy sm:inline">
                {profile?.name ?? "회원"}님
              </span>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-gray-300 px-3 py-1.5 font-bold text-gray-600 transition hover:border-gray-400 hover:text-sm-navy"
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="px-1.5 py-1.5 font-semibold text-gray-600 transition hover:text-sm-orange"
              >
                로그인
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-sm-navy px-3 py-1.5 font-bold text-white transition hover:bg-[#0F1B44]"
              >
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}