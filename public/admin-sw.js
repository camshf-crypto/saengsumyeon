/*
 * 관리자 알림 받기 — 홈 화면에 추가한 관리자 앱이 꺼져 있어도 푸시를 보여준다
 * 등록 범위: /admin (학생 화면에는 영향 없음)
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// 서버가 보낸 알림 보여주기
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "생수면", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "생수면 관리자", {
      body: d.body || "",
      icon: "/admin-icon-192.png",
      badge: "/admin-icon-192.png",
      tag: d.tag || "order",
      data: { url: d.url || "/admin/orders" },
    })
  );
});

// 알림을 누르면 주문 화면 열기 (이미 열려 있으면 그 창으로)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/admin/orders";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes("/admin")) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});