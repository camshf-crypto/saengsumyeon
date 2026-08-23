import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import Header from "./components/Header";
import Footer from "./components/Footer";

import Landing from "./pages/landing/Landing";
import FreeLectures from "./pages/free/FreeLectures";
import Preorder from "./pages/preorder/Preorder";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import Cart from "./pages/cart/Cart";
import Order from "./pages/order/Order";
import PaymentComplete from "./pages/order/PaymentComplete";
import MyLayout from "./pages/my/MyLayout";
import MyCourses from "./pages/my/MyCourses";
import MyMaterials from "./pages/my/MyMaterials";
import MyProfile from "./pages/my/MyProfile";
import MyRefund from "./pages/my/MyRefund";
import MyOrders from "./pages/my/MyOrders";
import CoursePlayer from "./pages/my/CoursePlayer";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminHome from "./pages/admin/AdminHome";
import AdminMembers from "./pages/admin/AdminMembers";
import AdminSales from "./pages/admin/AdminSales";
import AdminCoupons from "./pages/admin/AdminCoupons";
import AdminPreorders from "./pages/admin/AdminPreorders";
import AdminLectures from "./pages/admin/AdminLectures";
import AdminOrders from "./pages/admin/AdminOrders";
import AdminRefunds from "./pages/admin/AdminRefunds";
import { Terms, Privacy, Refund } from "./pages/legal/Legal";

// 아직 안 만든 화면
function Placeholder({ name }) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-24 text-center">
      <p className="text-2xl font-extrabold text-sm-navy">{name}</p>
      <p className="mt-3 text-sm text-gray-500">준비 중인 화면입니다.</p>
    </div>
  );
}

// /#curriculum 같은 해시 주소로 들어오면 해당 섹션으로 스크롤
function ScrollToHash() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    // 랜딩이 그려진 뒤에 찾아야 해서 한 틱 미룬다
    const t = setTimeout(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [hash, pathname]);
  return null;
}

// 로그인이 필요한 화면
function Private({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

// 관리자 전용. 화면 차단은 안내용이고 실제 차단은 RLS가 한다.
function Admin({ children }) {
  const { user, isMaster, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (!isMaster) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToHash />
        <div className="flex min-h-screen flex-col bg-white">
          <Header />
          <main className="flex-1">
            <Routes>
              {/* 공개 */}
              <Route path="/" element={<Landing />} />
              <Route path="/course/:slug" element={<Landing />} />
              {/* 커리큘럼은 랜딩 안의 섹션이라 앵커로 보낸다 */}
              <Route path="/curriculum" element={<Navigate to="/#curriculum" replace />} />
              <Route path="/free" element={<FreeLectures />} />
              <Route path="/preorder" element={<Preorder />} />
              <Route path="/reviews" element={<Placeholder name="합격 후기" />} />

              {/* 인증 */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* 구매 흐름 */}
              <Route path="/cart" element={<Private><Cart /></Private>} />
              <Route path="/order" element={<Private><Order /></Private>} />
              {/* 이니시스가 이 주소로 되돌아온다. 경로를 바꾸면 PG에 재등록해야 한다 */}
              <Route path="/payment/complete" element={<Private><PaymentComplete /></Private>} />

              {/* 마이 — 사이드바 레이아웃 안에서 그린다 */}
              <Route path="/my" element={<Private><MyLayout /></Private>}>
                <Route index element={<MyCourses />} />
                <Route path="materials" element={<MyMaterials />} />
                <Route path="orders" element={<MyOrders />} />
                <Route path="profile" element={<MyProfile />} />
                <Route path="refund" element={<MyRefund />} />
              </Route>
              {/* 수강 화면은 넓게 써야 해서 레이아웃 밖에 둔다 */}
              <Route path="/my/course/:courseId" element={<Private><CoursePlayer /></Private>} />

              {/* 관리자 */}
              <Route path="/admin" element={<Admin><AdminLayout /></Admin>}>
                <Route index element={<AdminHome />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="refunds" element={<AdminRefunds />} />
                <Route path="lectures" element={<AdminLectures />} />
                <Route path="members" element={<AdminMembers />} />
                <Route path="sales" element={<AdminSales />} />
                <Route path="coupons" element={<AdminCoupons />} />
                <Route path="preorders" element={<AdminPreorders />} />
              </Route>

              {/* 약관 (PG 심사 필수) */}
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/refund" element={<Refund />} />

              <Route path="*" element={<Placeholder name="페이지를 찾을 수 없습니다" />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}