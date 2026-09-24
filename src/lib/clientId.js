/**
 * 로그인 전 진단을 나중에 계정과 이어붙이기 위한 브라우저 식별자.
 * 개인정보가 아니라 무작위 문자열이며, 브라우저를 지우면 사라진다.
 */
const KEY = "sm_client_id";

export function getClientId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // 시크릿 모드 등 저장이 막힌 경우
    return null;
  }
}