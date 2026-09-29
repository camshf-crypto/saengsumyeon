import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

/* 결제 승인 메뉴 — 대기 건수가 있으면 주황 숫자 */
function OrdersLink({ count, mobile = false }) {
  if (mobile) {
    return (
      <Link to="/admin/orders" className="flex items-center justify-between border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-orange">
        결제 승인
        {count > 0 && <span className="rounded-full bg-sm-orange px-2 py-0.5 text-[12px] text-white">{count}</span>}
      </Link>
    );
  }
  return (
    <Link
      to="/admin/orders"
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
        count > 0 ? "border border-sm-orange text-sm-orange hover:bg-orange-50" : "border border-gray-300 text-gray-600 hover:border-gray-400"
      }`}
    >
      결제 승인
      {count > 0 && <span className="rounded-full bg-sm-orange px-1.5 text-[11.5px] leading-[18px] text-white">{count}</span>}
    </Link>
  );
}

/* 탐구보고서 메뉴 — 누르면 /inquiry 화면(안내 + 내 탐구 목록)으로 들어간다 */
const REPORT_MENU = "기억에 남는 탐구보고서 작성";

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();

  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState(0); // 입금 확인 대기

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

  // 관리자만 — 입금 확인 대기 건수를 실시간으로
  useEffect(() => {
    if (!isAdmin) {
      setPendingOrders(0);
      return;
    }
    const count = () =>
      supabase.rpc("admin_orders").then(({ data }) => setPendingOrders((data ?? []).filter((o) => o.status === "pending").length));
    count();
    const ch = supabase
      .channel("header-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "pay_orders" }, count)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [isAdmin]);

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
                <>
                  <Link
                    to="/admin"
                    className="rounded-lg bg-sm-orange px-3 py-1.5 font-bold text-white transition hover:bg-orange-600"
                  >
                    관리자
                  </Link>
                  <OrdersLink count={pendingOrders} />
                </>
              )}
              <Link
                to="/inquiry"
                className={`px-1.5 py-1.5 font-bold transition hover:text-sm-orange ${pathname === "/inquiry" ? "text-sm-orange" : "text-sm-navy"}`}
              >
                {REPORT_MENU}
              </Link>
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
              className="relative flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg border border-gray-300"
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
              {/* 관리자 — 결제 승인 대기가 있으면 점 */}
              {isAdmin && pendingOrders > 0 && !open && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-sm-orange" />
              )}
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
              to="/inquiry"
              className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-navy"
            >
              {REPORT_MENU}
            </Link>
            <Link
              to="/my"
              className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-navy"
            >
              내 기록
            </Link>
            {isAdmin && (
              <>
                <Link
                  to="/admin"
                  className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-orange"
                >
                  관리자
                </Link>
                <OrdersLink count={pendingOrders} mobile />
              </>
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