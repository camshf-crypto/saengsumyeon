import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { fetchNickname, NICK_EVENT, AVATAR_EVENT } from "./NicknameEditor";
import Avatar from "./Avatar";

/*
 * 헤더
 *   컴퓨터: 로고 | (오른쪽) 관리자 · 결제 승인 · 사진·레벨·닉네임(→ 마이페이지) · 로그아웃 — 서비스 메뉴는 메인 타일이 대신한다
 *   휴대폰: 로고 | ☰ → 당근 '전체 서비스'처럼 화면 전체에 서비스 목록이 열린다
 */

/* 결제 승인 메뉴 — 대기 건수가 있으면 주황 숫자 */
function OrdersLink({ count }) {
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

/* 전체 서비스 아이콘 (선) */
const ICON = {
  scan: <><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" /><path d="M8 12h8M8 9h5M8 15h6" /></>,
  book: <><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" /><path d="M4 19V5M9 7h6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>,
  note: <><path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6z" /><path d="M6 3v18M10 8h5M10 12h5" /></>,
  doc: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  poll: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  chat: <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />,
  news: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  puzzle: <path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z" />,
  ladder: <path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  out: <><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>,
};

/* 전체 서비스 묶음 — 당근처럼 제목 + 두 줄 목록 */
const SECTIONS = [
  {
    title: "생기부 · 진단",
    items: [
      { to: "/topic", label: "탐구주제 흔한가", icon: "scan", color: "#E8590C" },
      { to: "/reading", label: "독서 흔한가", icon: "book", color: "#0F9D58" },
      { to: "/motive", label: "지원동기 흔한가", icon: "mail", color: "#D97706" },
      { to: "/interview", label: "생기부 예상질문", icon: "mic", color: "#2563EB" },
      { to: "/my/note", label: "내 생기부 노트", icon: "note", color: "#4F46E5", login: true },
      { to: "/inquiry", label: "탐구보고서", icon: "doc", color: "#7C3AED" },
    ],
  },
  {
    title: "커뮤니티",
    items: [
      { to: "/mulgyeol", label: "나만 그래?", icon: "poll", color: "#1A5E9A" },
      { to: "/board", label: "옥상에서 외쳐!", icon: "chat", color: "#0D9488" },
      { to: "/sb", label: "합격 생기부 퍼즐", icon: "puzzle", color: "#DB2777" },
      { to: "/voice", label: "생수면 의견함", icon: "mail", color: "#0D9488" },
    ],
  },
  {
    title: "준비 중",
    items: [{ to: null, label: "대학 사다리", icon: "ladder", color: "#9CA3AF" }],
  },
];

function Svc({ item, onPick }) {
  const body = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 flex-none">
        {ICON[item.icon]}
      </svg>
      <span className="min-w-0 truncate">{item.label}</span>
    </>
  );
  if (!item.to) return <div className="flex items-center gap-3 py-3 text-[15.5px] font-semibold text-gray-400">{body}</div>;
  return (
    <Link to={item.to} onClick={onPick} className="flex items-center gap-3 py-3 text-[15.5px] font-semibold text-gray-900 active:opacity-60">
      {body}
    </Link>
  );
}

/* 휴대폰 전체 서비스 화면 */
function AllServices({ onClose, user, isAdmin, pendingOrders, displayName, lv, avatar, onLogout }) {
  // 열려 있는 동안 뒤 화면이 스크롤되지 않게
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const mine = [
    { to: "/my/level", label: "내 레벨 · 뱃지", icon: "star", color: "#E8590C" },
    { to: "/my", label: "마이페이지", icon: "user", color: "#18224F" },
  ];
  const admin = [
    { to: "/admin", label: "관리자", icon: "shield", color: "#E8590C" },
    { to: "/admin/orders", label: `결제 승인${pendingOrders > 0 ? ` ${pendingOrders}` : ""}`, icon: "card", color: "#E8590C" },
    { to: "/admin/columns", label: "칼럼 관리", icon: "news", color: "#18224F" },
    { to: "/admin/community", label: "커뮤니티 관리", icon: "chat", color: "#18224F" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white sm:hidden">
      <div className="relative flex h-14 flex-none items-center justify-center border-b border-gray-100">
        <button onClick={onClose} aria-label="닫기" className="absolute left-2 flex h-10 w-10 items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-gray-900">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <b className="text-[17px] font-bold text-gray-900">전체 서비스</b>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-10">
        {/* 비회원만 — 가입 안내 (회원은 프로필 없이 바로 목록) */}
        {!user && (
          <div className="mt-4 rounded-2xl bg-[#F4F5F7] px-4 py-4">
            <b className="block text-[15px] font-bold text-gray-900">가입하면 바로 Lv.2에서 시작해요</b>
            <div className="mt-3 flex gap-2">
              <Link to="/signup" onClick={onClose} className="flex-1 rounded-[10px] bg-[#FEE500] py-2.5 text-center text-[14px] font-bold text-[#191919]">
                카카오로 시작하기
              </Link>
              <Link to="/login" onClick={onClose} className="rounded-[10px] border border-gray-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-gray-600">
                로그인
              </Link>
            </div>
          </div>
        )}

        {SECTIONS.map((s) => (
          <section key={s.title} className="mt-6">
            <h3 className="mb-1 text-[14px] font-bold text-gray-500">{s.title}</h3>
            <div className="grid grid-cols-2 gap-x-4">
              {s.items.map((it) => (
                <Svc key={it.label} item={it.login && !user ? { ...it, to: "/signup" } : it} onPick={onClose} />
              ))}
            </div>
          </section>
        ))}

        {user && (
          <section className="mt-6">
            <h3 className="mb-1 text-[14px] font-bold text-gray-500">나의 생수면</h3>
            <div className="grid grid-cols-2 gap-x-4">
              {mine.map((it) => (
                <Svc key={it.label} item={it} onPick={onClose} />
              ))}
              <button onClick={onLogout} className="flex items-center gap-3 py-3 text-left text-[15.5px] font-semibold text-gray-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 flex-none">
                  {ICON.out}
                </svg>
                로그아웃
              </button>
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="mt-6">
            <h3 className="mb-1 text-[14px] font-bold text-sm-orange">관리자</h3>
            <div className="grid grid-cols-2 gap-x-4">
              {admin.map((it) => (
                <Svc key={it.to} item={it} onPick={onClose} />
              ))}
            </div>
          </section>
        )}
      </div>
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
  const [lv, setLv] = useState(null); // 내 레벨
  const [avatar, setAvatar] = useState(null); // 프로필 사진

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

  // 레벨 · 사진 — 화면을 옮길 때마다 새로 (점수가 바뀌었을 수 있어서)
  useEffect(() => {
    if (!user) {
      setLv(null);
      setAvatar(null);
      return;
    }
    supabase.rpc("lv_me").then(({ data }) => setLv(data || null));
    supabase.rpc("my_profile").then(({ data }) => setAvatar(data?.avatar_url || null));
  }, [user, pathname]);

  // 팝업 · 내 레벨에서 사진을 바꾸면 바로 반영
  useEffect(() => {
    const onAvatar = (e) => setAvatar(e.detail || null);
    window.addEventListener(AVATAR_EVENT, onAvatar);
    return () => window.removeEventListener(AVATAR_EVENT, onAvatar);
  }, []);

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

  // 화면을 옮기면 전체 서비스를 닫는다
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

        {/* 컴퓨터 — 서비스 메뉴 없이 계정만 */}
        <div className="ml-auto hidden items-center gap-2.5 text-[13px] sm:flex">
          {user ? (
            <>
              {isAdmin && (
                <>
                  <Link to="/admin" className="rounded-lg bg-sm-orange px-3 py-1.5 font-bold text-white transition hover:bg-orange-600">
                    관리자
                  </Link>
                  <OrdersLink count={pendingOrders} />
                </>
              )}
              {/* 사진 · 레벨 · 닉네임 → 마이페이지 (마이페이지 위 탭에서 내 레벨로) */}
              <Link to="/my" title="마이페이지" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-gray-50">
                <Avatar src={avatar} nick={displayName} color={lv?.color} size={28} round />
                {lv && (
                  <span className="inline-flex h-[18px] items-center gap-1 rounded border border-gray-200 px-1.5 text-[11px] font-bold text-gray-700">
                    <i className="h-1.5 w-1.5 rounded-full" style={{ background: lv.color }} />
                    Lv.{lv.level}
                  </span>
                )}
                <span className="font-semibold text-sm-navy">{displayName}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-gray-300 px-3 py-1.5 font-bold text-gray-600 transition hover:border-gray-400 hover:text-sm-navy"
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="px-1.5 py-1.5 font-semibold text-gray-600 transition hover:text-sm-orange">
                로그인
              </Link>
              <Link to="/signup" className="rounded-lg bg-sm-navy px-3 py-1.5 font-bold text-white transition hover:bg-[#0F1B44]">
                회원가입
              </Link>
            </>
          )}
        </div>

        {/* 휴대폰 — 로그인 전에는 회원가입 + ☰, 로그인 후에는 닉네임 + ☰ */}
        <div className="ml-auto flex items-center gap-2 text-[13px] sm:hidden">
          {!user && (
            <Link to="/signup" className="rounded-lg bg-sm-navy px-3 py-1.5 font-bold text-white">
              회원가입
            </Link>
          )}
          {user && (
            <Link to="/my/level" className="max-w-[120px] truncate text-[13.5px] font-semibold text-sm-navy">
              {displayName}
            </Link>
          )}
          <button
            onClick={() => setOpen(true)}
            aria-label="전체 서비스"
            className="relative flex h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-lg"
          >
            <span className="block h-[2px] w-5 rounded bg-sm-navy" />
            <span className="block h-[2px] w-5 rounded bg-sm-navy" />
            <span className="block h-[2px] w-5 rounded bg-sm-navy" />
            {/* 관리자 — 결제 승인 대기가 있으면 점 */}
            {isAdmin && pendingOrders > 0 && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-sm-orange" />}
          </button>
        </div>
      </div>

      {open && (
        <AllServices
          onClose={() => setOpen(false)}
          user={user}
          isAdmin={isAdmin}
          pendingOrders={pendingOrders}
          displayName={displayName}
          lv={lv}
          avatar={avatar}
          onLogout={handleLogout}
        />
      )}
    </header>
  );
}