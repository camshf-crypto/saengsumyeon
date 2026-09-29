import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

/*
 * 관리자 주문 확인 — /admin/orders
 * 아이폰 사파리에서 '홈 화면에 추가'하면 앱처럼 쓰고, 새 주문이 오면 푸시 알림을 받는다
 * 승인하는 순간 이용권이 지급된다 (1건 1개 · 10건 10개)
 * 화면을 켜 두면 새 주문이 실시간으로 맨 위에 뜬다
 */

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// 홈 화면 앱 설정을 이 화면에서만 붙인다 (학생 화면에는 영향 없음)
function useAdminApp() {
  useEffect(() => {
    const add = (tag, attrs) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      el.dataset.adminApp = "1";
      document.head.appendChild(el);
    };
    add("link", { rel: "manifest", href: "/admin.webmanifest" });
    add("link", { rel: "apple-touch-icon", href: "/admin-icon-180.png" });
    add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
    add("meta", { name: "apple-mobile-web-app-title", content: "생수면 관리" });
    add("meta", { name: "theme-color", content: "#18224F" });
    return () => document.querySelectorAll("[data-admin-app]").forEach((el) => el.remove());
  }, []);
}

// VAPID 공개키 → 브라우저가 원하는 형식
function keyBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

const PRODUCT = { one: "탐구 1건", ten: "탐구 10건" };
const STATUS = {
  pending: { label: "확인 대기", cls: "bg-orange-100 text-orange-700" },
  approved: { label: "승인", cls: "bg-green-100 text-green-700" },
  rejected: { label: "미입금", cls: "bg-gray-200 text-gray-500" },
};

// 몇 분 전
function ago(t) {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : new Date(t).toLocaleDateString("ko-KR");
}

export default function AdminOrders() {
  useAdminApp();
  const { user, loading: authLoading } = useAuth();

  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("pending"); // pending | all
  const [push, setPush] = useState("unknown"); // unknown | on | off | denied | unsupported
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_orders");
    if (error) {
      setErr(error.message.includes("권한") ? "관리자 계정으로 로그인해 주세요." : "주문을 불러오지 못했어요.");
      return;
    }
    setErr("");
    setRows(data ?? []);
  }, []);

  // 처음 불러오기 + 실시간으로 새 주문 받기
  useEffect(() => {
    if (authLoading || !user) return;
    load();
    const ch = supabase
      .channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "pay_orders" }, () => load())
      .subscribe();
    // 앱으로 돌아올 때 다시 불러오기
    const onShow = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [authLoading, user, load]);

  // 알림 상태 확인 + 알림 받는 파일 등록
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPush("unsupported");
      return;
    }
    navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" }).then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setPush(Notification.permission === "denied" ? "denied" : sub ? "on" : "off");
    });
  }, []);

  // 알림 켜기 — 반드시 버튼을 눌러서 (아이폰 규칙)
  async function enablePush() {
    try {
      if (!VAPID) return setErr("알림 키(VITE_VAPID_PUBLIC_KEY)가 설정되지 않았어요.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setPush("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) }));
      const j = sub.toJSON();
      const { error } = await supabase.rpc("save_push_subscription", {
        p_endpoint: j.endpoint,
        p_p256dh: j.keys.p256dh,
        p_auth: j.keys.auth,
        p_device: navigator.userAgent,
      });
      if (error) throw error;
      setPush("on");
    } catch (e) {
      console.error("push failed", e);
      setErr("알림을 켜지 못했어요. 홈 화면 아이콘으로 열었는지 확인해 주세요.");
    }
  }

  async function decide(o, approve) {
    if (!approve && !window.confirm(`${o.depositor} · ${o.amount.toLocaleString()}원\n입금이 확인되지 않아 주문을 닫을까요?`)) return;
    if (approve && !window.confirm(`${o.depositor} · ${o.amount.toLocaleString()}원\n입금 확인했어요. 이용권 ${o.product === "ten" ? 10 : 1}개를 줄까요?`)) return;
    setBusyId(o.id);
    const { error } = await supabase.rpc("admin_decide_order", { p_id: o.id, p_approve: approve });
    setBusyId(null);
    if (error) return setErr("처리하지 못했어요. 다시 시도해 주세요.");
    load();
  }

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <div className="py-40 text-center text-gray-500">관리자 계정으로 로그인해 주세요.</div>;

  const pending = rows.filter((o) => o.status === "pending");
  const shown = tab === "pending" ? pending : rows;
  const today = new Date().toDateString();
  const todaySum = rows.filter((o) => o.status !== "rejected" && new Date(o.created_at).toDateString() === today).reduce((a, o) => a + o.amount, 0);

  return (
    <div className="min-h-screen bg-gray-100 pb-10" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="sticky top-0 z-10 bg-sm-navy px-5 pb-4 pt-5 text-white">
        <p className="text-[12px] font-bold text-orange-200">생수면 관리</p>
        <p className="mt-1 text-[22px] font-extrabold">입금 확인 {pending.length}건</p>
        <p className="mt-0.5 text-[12.5px] text-indigo-100">오늘 접수 {todaySum.toLocaleString()}원 (미입금 제외)</p>
      </header>

      <div className="space-y-3 p-4">
        {/* 알림 */}
        {push !== "on" && (
          <div className="rounded-xl bg-white p-4">
            {isIOS() && !isStandalone() ? (
              <>
                <p className="text-[14px] font-extrabold text-sm-navy">알림을 받으려면 홈 화면에 추가해 주세요</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
                  사파리 아래 <b>공유 버튼</b> → <b>홈 화면에 추가</b> → 홈 화면의 <b>생수면 관리</b> 아이콘으로 다시 열고 ‘알림 켜기’를 눌러요.
                </p>
              </>
            ) : push === "unsupported" ? (
              <p className="text-[12.5px] text-gray-600">이 브라우저는 알림을 받을 수 없어요. 아이폰은 iOS 16.4 이상, 홈 화면 앱에서 돼요.</p>
            ) : push === "denied" ? (
              <p className="text-[12.5px] text-gray-600">알림이 꺼져 있어요. 설정 → 알림 → 생수면 관리에서 허용해 주세요.</p>
            ) : (
              <>
                <p className="text-[14px] font-extrabold text-sm-navy">새 주문 알림 받기</p>
                <p className="mt-1 text-[12.5px] text-gray-600">학생이 ‘입금했어요’를 누르면 바로 알려드려요.</p>
                <button onClick={enablePush} className="mt-3 h-11 w-full rounded-lg bg-sm-navy text-[14px] font-bold text-white">알림 켜기</button>
              </>
            )}
          </div>
        )}
        {push === "on" && <p className="text-center text-[12px] font-bold text-green-700">🔔 새 주문 알림이 켜져 있어요</p>}

        {err && <p className="rounded-lg bg-red-50 px-4 py-3 text-center text-[13px] font-bold text-red-600">{err}</p>}

        {/* 탭 */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-white p-1">
          {[["pending", `확인 대기 ${pending.length}`], ["all", `전체 ${rows.length}`]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`h-10 rounded-md text-[13.5px] font-bold ${tab === k ? "bg-sm-navy text-white" : "text-gray-500"}`}>{l}</button>
          ))}
        </div>

        {/* 주문 목록 */}
        {!shown.length && <p className="py-16 text-center text-[13.5px] text-gray-400">{tab === "pending" ? "확인할 주문이 없어요" : "주문이 없어요"}</p>}
        {shown.map((o) => (
          <div key={o.id} className="rounded-xl bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[18px] font-extrabold text-sm-navy">{o.depositor}</p>
                <p className="mt-0.5 text-[13px] text-gray-600">{PRODUCT[o.product] ?? o.product} · <b className="text-sm-navy">{o.amount.toLocaleString()}원</b></p>
                <p className="mt-0.5 truncate text-[11.5px] text-gray-400">{o.email}</p>
                {o.receipt && <p className="mt-0.5 text-[11.5px] text-gray-500">현금영수증 {o.receipt}</p>}
              </div>
              <div className="shrink-0 text-right">
                <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STATUS[o.status]?.cls}`}>{STATUS[o.status]?.label}</span>
                <p className="mt-1.5 text-[11.5px] text-gray-400">{ago(o.created_at)}</p>
                {o.used > 0 && <p className="text-[11px] text-gray-400">탐구 {o.used}건 열림</p>}
              </div>
            </div>
            {o.status === "pending" && (
              <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
                <button onClick={() => decide(o, false)} disabled={busyId === o.id} className="h-11 rounded-lg border border-gray-300 text-[13.5px] font-bold text-gray-600 disabled:opacity-50">미입금</button>
                <button onClick={() => decide(o, true)} disabled={busyId === o.id} className="h-11 rounded-lg bg-sm-navy text-[14px] font-bold text-white disabled:opacity-50">입금 확인 · 승인</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}