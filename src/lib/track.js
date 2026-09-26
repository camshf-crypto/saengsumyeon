/*
 * 가입 단계 기록 — 여러 화면(결과, 로그인, 로그인 후, 가입 마무리)이 함께 쓴다
 * 기록이 실패해도 화면 동작에는 영향이 없게 한다
 */
import { supabase } from "./supabase";
import { getClientId } from "./clientId";

export function track(type, detail = null) {
  supabase
    .rpc("log_ref_event", { p_type: type, p_code: detail, p_client_id: getClientId() })
    .then(({ error }) => error && console.warn("track failed", type, error));
}