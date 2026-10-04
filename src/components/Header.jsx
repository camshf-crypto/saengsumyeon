import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { fetchNickname, NICK_EVENT } from "./NicknameEditor";

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
const REPORT_MENU = "기억에 남는 탐구보고서";

/*
 * 헤더 메뉴 — children이 있으면 묶음 메뉴(컴퓨터: 펼침 목록 / 휴대폰: 아래로 나열)
 * also: 그 주소에 있을 때도 이 메뉴에 불을 켠다
 */
const MENU = [
  { to: "/mulgyeol", label: "나만 그래?", badge: "고등생활" }, // 커뮤니티 — 매일 밤 12시에 새 질문
  {
    label: "흔한가",
    children: [
      { to: "/topic", label: "탐구주제 흔한가", also: "/" }, // 메인(/)과 같은 화면
      { to: "/reading", label: "독서 흔한가" },
      { to: "/motive", label: "지원동기 흔한가" },
    ],
  },
  { to: "/interview", label: "면접 예상 질문" },
  { to: "/inquiry", label: REPORT_MENU },
  // 대학 사다리(/ladder)는 개발이 끝나면 다시 넣는다 — 주소로는 계속 들어갈 수 있다
  // { to: "/ladder", label: "대학 사다리" },
];

/* 지금 주소가 이 메뉴(또는 묶음 안 메뉴)에 해당하는지 */
const isOn = (m, pathname) =>
  m.children ? m.children.some((c) => isOn(c, pathname)) : pathname === m.to || pathname === m.also;

/* 메뉴 옆 작은 표시 (NEW) */
function Badge({ text }) {
  if (!text) return null;
  return (
    <span className="ml-1 rounded bg-[#1A5E9A] px-1 py-[1px] align-[1px] text-[9.5px] font-extrabold leading-none text-white">
      {text}
    </span>
  );
}

/* 컴퓨터 화면 묶음 메뉴 — 마우스를 올리거나 누르면 펼쳐진다 */
function DropMenu({ m, pathname }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const on = isOn(m, pathname);

  // 화면을 옮기면 닫는다
  useEffect(() => setOpen(false), [pathname]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1 whitespace-nowrap px-1.5 py-1.5 font-bold transition hover:text-sm-orange ${on ? "text-sm-orange" : "text-sm-navy"}`}
      >
        {m.label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={`transition ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-30 -translate-x-1/2 pt-1.5">
          <div className="min-w-[150px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg">
            {m.children.map((c) => (
              <Link
                key={c.to}
                to={c.to}
                className={`block whitespace-nowrap px-4 py-2.5 text-[13px] font-bold transition hover:bg-gray-50 ${isOn(c, pathname) ? "text-sm-orange" : "text-sm-navy"}`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* 휴대폰 묶음 메뉴 — 처음엔 닫혀 있고, 누르면 아래로 펼쳐진다 */
function MobileGroup({ m, pathname, onPick }) {
  const on = isOn(m, pathname);
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-gray-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 py-3.5 text-left text-[15px] font-bold ${on ? "text-sm-orange" : "text-sm-navy"}`}
      >
        {m.label}
        <svg width="14" height="14" viewBox="0 0 10 10" aria-hidden="true" className={`text-gray-400 transition ${open ? "rotate-180" : ""}`}>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mb-2 rounded-lg bg-gray-50 py-1">
          {m.children.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              onClick={onPick}
              className={`block py-2.5 pl-4 text-[14.5px] font-bold ${isOn(c, pathname) ? "text-sm-orange" : "text-sm-navy"}`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();

  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState(0); // 입금 확인 대기
  const [nick, setNick] = useState(null); // 나만 그래? 닉네임 — 있으면 이름 대신 보여준다

  // 닉네임 불러오기 + 어디서든 정하거나 바꾸면 바로 반영
  useEffect(() => {
    if (!user) {
      setNick(null);
      return;
    }
    let alive = true;
    fetchNickname().then((d) => alive && setNick(d?.is_auto ? null : d?.nickname ?? null));
    const onNick = (e) => setNick(e.detail || null);
    window.addEventListener(NICK_EVENT, onNick);
    return () => {
      alive = false;
      window.removeEventListener(NICK_EVENT, onNick);
    };
  }, [user]);

  const displayName = nick || profile?.name || "회원";

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
          {/* 서비스 메뉴 — 로그인 전에도 보인다 (어떤 서비스가 있는지 먼저 알 수 있게) */}
          {MENU.map((m) =>
            m.children ? (
              <DropMenu key={m.label} m={m} pathname={pathname} />
            ) : (
              <Link
                key={m.to}
                to={m.to}
                className={`whitespace-nowrap px-1.5 py-1.5 font-bold transition hover:text-sm-orange ${isOn(m, pathname) ? "text-sm-orange" : "text-sm-navy"}`}
              >
                {m.label}
                <Badge text={m.badge} />
              </Link>
            )
          )}
          <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
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
                to="/my"
                className="px-1.5 py-1.5 font-bold text-gray-600 transition hover:text-sm-orange"
              >
                마이페이지
              </Link>
              <span className="font-semibold text-sm-navy">
                {displayName}님
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

        {/* 모바일 — 로그인 전에는 회원가입 버튼 + 햄버거, 로그인 후에는 햄버거 */}
        <div className="ml-auto flex items-center gap-2 text-[13px] sm:hidden">
          {!user && (
            <Link to="/signup" className="rounded-lg bg-sm-navy px-3 py-1.5 font-bold text-white">
              회원가입
            </Link>
          )}
          {(
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
          )}
        </div>
      </div>

      {/* 모바일 펼침 메뉴 */}
      {open && (
        <div className="absolute inset-x-0 top-full z-20 border-b border-gray-200 bg-white shadow-sm sm:hidden">
          <div className="px-5 py-3">
            {user && (
              <p className="py-2.5 text-[13px] font-semibold text-gray-400">
                {displayName}님
              </p>
            )}
            {MENU.map((m) =>
              m.children ? (
                <MobileGroup key={m.label} m={m} pathname={pathname} onPick={() => setOpen(false)} />
              ) : (
                <Link
                  key={m.to}
                  to={m.to}
                  onClick={() => setOpen(false)}
                  className={`block border-t border-gray-100 py-3.5 text-[15px] font-bold first:border-t-0 ${isOn(m, pathname) ? "text-sm-orange" : "text-sm-navy"}`}
                >
                  {m.label}
                  <Badge text={m.badge} />
                </Link>
              )
            )}
            {!user && (
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-gray-500"
              >
                로그인
              </Link>
            )}
            {user && (
            <>
            <Link
              to="/my"
              className="block border-t border-gray-100 py-3.5 text-[15px] font-bold text-sm-navy"
            >
              마이페이지
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
            </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}