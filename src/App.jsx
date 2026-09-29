import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { supabase } from "./lib/supabase";
import { getClientId } from "./lib/clientId";
import { saveRefCode } from "./lib/referral";
import Header from "./components/Header";
import Footer from "./components/Footer";
import LaunchPopup from "./components/LaunchPopup";

import Landing from "./pages/landing/Landing";
import Result from "./pages/landing/Result";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import AuthCallback from "./pages/auth/AuthCallback";
import MyPage from "./pages/my/MyPage";
import AdminTopics from "./pages/admin/AdminTopics";
import AdminOrders from "./pages/admin/AdminOrders";
import InquiryHome from "./pages/inquiry/InquiryHome";
import InquiryPrepare from "./pages/inquiry/InquiryPrepare";
import InquiryResult from "./pages/inquiry/InquiryResult";
import InquiryReport from "./pages/inquiry/InquiryReport";
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

/*
 * 화면 틀 — 탐구 준비·분석·보고서(/inquiry/…)는 노트북 작업 화면이라
 * 자체 머리(단계 표시)를 쓰고, 공통 머리·꼬리는 숨긴다
 * /inquiry (탐구보고서 첫 화면)는 일반 화면이라 공통 머리·꼬리를 쓴다
 */
function Layout({ children }) {
  const { pathname } = useLocation();
  // 앱처럼 쓰는 화면은 공통 머리·꼬리 없이
  const workspace = pathname.startsWith("/inquiry/") || pathname.startsWith("/admin/orders");

  if (workspace) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      {/* 메인에 들어오면 '기억에 남는 탐구보고서 오픈' 안내 */}
      {pathname === "/" && <LaunchPopup />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <RefCapture />
        <Layout>
          <Routes>
            {/* 진단 흐름: 주제 입력 → 결과(일부 공개) → 가입 → 결과 전체 */}
            <Route path="/" element={<Landing />} />
            {/* 결과는 로그인 없이도 보여야 한다. 잠금은 화면 안에서 처리 */}
            <Route path="/result" element={<Result />} />

            {/* 기억에 남는 탐구보고서 — 헤더 메뉴로 들어오는 첫 화면 (4단계 안내 + 내 탐구 목록) */}
            <Route path="/inquiry" element={<InquiryHome />} />
            {/* 탐구 준비 — /inquiry/new 는 새로 만들기, /inquiry/:id 는 다시 열기 */}
            <Route path="/inquiry/:id" element={<InquiryPrepare />} />
            {/* 결과 분석 — 직접 분석 / AI 분석 */}
            <Route path="/inquiry/:id/result" element={<InquiryResult />} />
            {/* 보고서 디자인 — 형식 고르기 · 디자인 고르기 · 편집 · PDF */}
            <Route path="/inquiry/:id/report" element={<InquiryReport />} />

            {/* 내 기록 — 권한은 화면 안에서 확인 */}
            <Route path="/my" element={<MyPage />} />

            {/* 인증 — 구글 로그인 후 /auth/callback으로 돌아온다 */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* 어드민 — 주소로만 접근. 권한은 화면 안에서 확인 */}
            <Route path="/admin" element={<AdminTopics />} />
            {/* 입금 확인 — 아이폰 홈 화면 앱으로 쓰고 새 주문은 푸시 알림 */}
            <Route path="/admin/orders" element={<AdminOrders />} />

            {/* 약관 */}
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/refund" element={<Refund />} />

            {/* 없어진 주소는 첫 화면으로 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  );
}