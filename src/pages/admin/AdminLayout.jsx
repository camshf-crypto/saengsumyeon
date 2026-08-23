import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";

const MENU = [
  { to: "/admin", label: "대시보드", end: true },
  { to: "/admin/preorders", label: "사전신청" },
  { to: "/admin/orders", label: "주문 관리" },
  { to: "/admin/refunds", label: "환불 처리" },
  { to: "/admin/lectures", label: "강의 관리" },
  { to: "/admin/members", label: "회원 관리" },
  { to: "/admin/sales", label: "매출 · 정산" },
  { to: "/admin/coupons", label: "쿠폰 관리" },
];

export default function AdminLayout() {
  const { profile } = useAuth();

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="grid gap-8 lg:grid-cols-[190px_1fr]">
        <aside>
          <div className="rounded-xl bg-sm-navy px-5 py-6 text-white">
            <p className="text-lg font-extrabold tracking-tight">관리자</p>
            <p className="mt-1 text-xs text-blue-200">{profile?.name ?? "master"}</p>
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

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}