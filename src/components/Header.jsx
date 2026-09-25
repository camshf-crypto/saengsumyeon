import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();

  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);

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

  // 화면을 옮기면 메뉴를 닫는다
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function handleLogout() {
    setOpen(false);
    await signOut();
    nav("/");
  }

  return (
    <header className="relative border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5 sm:h-16">
        <Link to="/" className="text-lg font-black tracking-tight text-sm-navy sm:text-xl">
          생수면<span className="text-sm-orange">.</span>
        </Link>

        {/* 데스크톱 */}
        <div className="ml-auto hidden items-center gap-2.5 text-[13px] sm:flex">
          {user ? (
            <>
              {isAdmin && (
                <Link
                  to="/admin"
                  className="rounded-lg bg-sm-orange px-3 py-1.5 font-bold text-white transition hover:bg-orange-600"
                >
                  관리자
                </Link>
              )}
              <Link
                to="/my"
                className="px-1.5 py-1.5 font-bold text-gray-600 transition hover:text-sm-orange"
              >
                내 기록
              </Link>
              <span className="font-semibold text-sm-navy">
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

        {/* 모바일 — 로그인 전에는 버튼만, 로그인 후에는 햄버거 */}
        <div className="ml-auto flex items-center gap-2 text-[13px] sm:hidden">
          {user ? (
            <button
              onClick={() => setOpen(!open)}
              aria-label="메뉴"
              aria-expanded={open}
              className="flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg border border-gray-300"
            >
              <span
                className={`block h-[1.5px] w-4 bg-sm-navy transition ${
                  open ? "translate-y-[6.5px] rotate-45" : ""
                }`}
              />
              <span
                className={`block h-[1.5px] w-4 bg-sm-navy transition ${open ? "opacity-0" : ""}`}
              />
              <span
                className={`block h-[1.5px] w-4 bg-sm-navy transition ${
                  open ? "-translate-y-[6.5px] -rotate-45" : ""
                }`}
              />
            </button>
          ) : (
            <>
              <Link to="/login" className="px-2 py-1.5 font-semibold text-gray-600">
                로그인
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-sm-navy px-3 py-1.5 font-bold text-white"
              >
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>

      {/* 모바일 펼침 메뉴 */}
      {open && user && (
        <div className="absolute inset-x-0 top-full z-20 border-b border-gray-200 bg-white shadow-sm sm:hidden">
          <div className="px-5 py-3">
            <p className="py-2.5 text-[13px] font-semibold text-gray-400">
              {profile?.name ?? "회원"}님
            </p>
            <Link
              to="/my"
              className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-navy"
            >
              내 기록
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-orange"
              >
                관리자
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="block w-full border-t border-gray-100 py-3.5 text-left text-[15px] font-bold text-gray-500"
            >
              로그아웃
            </button>
          </div>
        </div>
      )}
    </header>
  );
}