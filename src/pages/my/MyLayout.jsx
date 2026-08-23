import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";

const MENU = [
  { to: "/my", label: "수강하기", end: true },
  { to: "/my/materials", label: "교재 · 학습자료" },
  { to: "/my/orders", label: "결제 내역" },
  { to: "/my/profile", label: "나의 정보" },
  { to: "/my/refund", label: "환불 신청" },
];

export default function MyLayout() {
  const { profile } = useAuth();

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
        {/* 사이드바 */}
        <aside>
          <div className="rounded-xl bg-sm-navy px-5 py-6 text-white">
            <p className="text-lg font-extrabold tracking-tight">마이클래스</p>
            <p className="mt-1 text-xs text-blue-200">{profile?.name ?? "수강생"}님</p>
          </div>

          <nav className="mt-5">
            <ul className="space-y-1">
              {MENU.map((m) => (
                <li key={m.to}>
                  <NavLink
                    to={m.to}
                    end={m.end}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2.5 text-sm transition ${
                        isActive
                          ? "bg-orange-50 font-bold text-sm-orange"
                          : "text-gray-600 hover:text-sm-navy"
                      }`
                    }
                  >
                    {m.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* 본문 */}
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}