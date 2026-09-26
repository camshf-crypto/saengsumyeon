/*
 * 친구 추천 코드 — 여러 화면(App, AuthCallback, Login, Result)이 함께 쓴다
 * 추천 링크(?ref=코드)로 들어오면 브라우저에 7일 동안 보관한다
 */
const KEY = "sm_ref";
const KEEP_DAYS = 7;

export function saveRefCode(code) {
  const c = String(code || "").trim().toLowerCase().slice(0, 12);
  if (!/^[a-z0-9]{4,12}$/.test(c)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: c, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function getRefCode() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!v?.code) return null;
    if (Date.now() - v.at > KEEP_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(KEY);
      return null;
    }
    return v.code;
  } catch {
    return null;
  }
}

export function clearRefCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 무시
  }
}

/* 내 추천 링크 */
export const refLink = (code) => `${window.location.origin}/?ref=${code}`;