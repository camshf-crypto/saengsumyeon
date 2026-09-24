import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import Header from "./components/Header";
import Footer from "./components/Footer";

import Landing from "./pages/landing/Landing";
import Result from "./pages/landing/Result";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import AdminTopics from "./pages/admin/AdminTopics";
import { Terms, Privacy, Refund } from "./pages/legal/Legal";

// 화면을 옮기면 항상 맨 위에서 시작한다
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <div className="flex min-h-screen flex-col bg-white">
          <Header />
          <main className="flex-1">
            <Routes>
              {/* 진단 흐름: 주제 입력 → 결과(일부 공개) → 가입 → 결과 전체 */}
              <Route path="/" element={<Landing />} />
              {/* 결과는 로그인 없이도 보여야 한다. 잠금은 화면 안에서 처리 */}
              <Route path="/result" element={<Result />} />

              {/* 인증 */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* 어드민 — 주소로만 접근. 권한은 화면 안에서 확인 */}
              <Route path="/admin" element={<AdminTopics />} />

              {/* 약관 */}
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/refund" element={<Refund />} />

              {/* 없어진 주소는 첫 화면으로 */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}