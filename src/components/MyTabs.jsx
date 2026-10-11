import { NavLink } from "react-router-dom";

/*
 * 마이페이지 · 내 레벨 위 탭 (두 화면이 같이 쓴다)
 * 헤더의 프로필을 누르면 마이페이지로 오고, 여기서 내 레벨과 오간다
 */
const TABS = [
  { to: "/my", label: "마이페이지" },
  { to: "/my/level", label: "내 레벨" },
];

export default function MyTabs() {
  return (
    <nav className="grid grid-cols-2 gap-1 rounded-xl bg-gray-200/70 p-1">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          replace
          className={({ isActive }) =>
            `flex h-10 items-center justify-center rounded-lg text-[14px] font-bold transition ${
              isActive ? "bg-white text-sm-navy shadow-sm" : "text-gray-500 hover:text-sm-navy"
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}