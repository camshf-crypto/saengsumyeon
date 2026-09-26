import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { supabase } from "./lib/supabase";
import { getClientId } from "./lib/clientId";
import { saveRefCode } from "./lib/referral";
import Header from "./components/Header";
import Footer from "./components/Footer";

import Landing from "./pages/landing/Landing";
import Result from "./pages/landing/Result";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import AuthCallback from "./pages/auth/AuthCallback";
import MyPage from "./pages/my/MyPage";
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

/*
 * 추천 링크(?ref=코드)로 들어오면 코드를 보관하고 방문을 기록한 뒤
 * 주소창에서 ?ref=를 지운다 (새로고침·재공유 때 중복 기록 방지)
 */
function RefCapture() {
  const { search, pathname } = useLocation();
  const nav = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const code = params.get("ref");
    if (!code) return;

    if (saveRefCode(code)) {
      supabase
        .rpc("log_ref_event", { p_type: "ref_visit", p_code: code, p_client_id: getClientId() })
        .then(({ error }) => error && console.warn("ref visit log failed", error));
    }

    params.delete("ref");
    const rest = params.toString();
    nav(`${pathname}${rest ? `?${rest}` : ""}`, { replace: true });
  }, [search, pathname, nav]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <RefCapture />
        <div className="flex min-h-screen flex-col bg-white">
          <Header />
          <main className="flex-1">
            <Routes>
              {/* 진단 흐름: 주제 입력 → 결과(일부 공개) → 가입 → 결과 전체 */}
              <Route path="/" element={<Landing />} />
              {/* 결과는 로그인 없이도 보여야 한다. 잠금은 화면 안에서 처리 */}
              <Route path="/result" element={<Result />} />

              {/* 내 기록 — 권한은 화면 안에서 확인 */}
              <Route path="/my" element={<MyPage />} />

              {/* 인증 — 구글 로그인 후 /auth/callback으로 돌아온다 */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/auth/callback" element={<AuthCallback />} />

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