import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

// "/#curriculum" 처럼 해시가 붙은 항목은 랜딩 안의 섹션으로 스크롤된다
const GNB = [
  { to: "/course/hapgyeok-pass", label: "합격패스" },
  { to: "/#curriculum", label: "6강 커리큘럼" },
  { to: "/free", label: "무료 오픈특강" },
];

export default function Header() {
  const { user, profile, cartCount, isMaster, signOut } = useAuth();
  const nav = useNavigate();

  async function handleLogout() {
    await signOut();
    nav("/");
  }

  return (
    <header className="border-b border-gray-200">
      {/* 상단 유틸바 */}
      <div className="border-b border-gray-100 bg-gray-50">
        <div className="mx-auto flex h-9 max-w-6xl items-center justify-end gap-4 px-5 text-xs text-gray-500">
          {isMaster && (
            <Link to="/admin" className="font-bold text-sm-orange">
              관리자
            </Link>
          )}
          {user ? (
            <>
              <span className="font-semibold text-sm-navy">{profile?.name ?? "수강생"}님</span>
              <Link to="/my" className="hover:text-sm-orange">나의 강의실</Link>
              <button onClick={handleLogout} className="hover:text-sm-orange">로그아웃</button>
            </>
          ) : (
            <>
              <Link to="/login" className="hover:text-sm-orange">로그인</Link>
              <Link to="/signup" className="hover:text-sm-orange">회원가입</Link>
            </>
          )}
          <Link to="/cart" className="flex items-center gap-1 hover:text-sm-orange">
            장바구니
            {cartCount > 0 && (
              <span className="rounded-full bg-sm-orange px-1.5 py-px text-[10px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* 로고 + GNB */}
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-10 px-5">
        <Link to="/" className="text-xl font-black tracking-tight text-sm-navy">
          생수면<span className="text-sm-orange">.</span>
        </Link>

        <nav className="flex flex-1 items-center gap-7">
          {GNB.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              className={({ isActive }) =>
                `text-[15px] font-bold tracking-tight transition ${
                  isActive ? "text-sm-orange" : "text-gray-700 hover:text-sm-orange"
                }`
              }
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}