import { supabase } from "../../lib/supabase";

/*
 * 무료 체험 — 탐구 준비·결과 분석·보고서 화면이 같이 쓴다
 * 무료 체험 = 학생이 2단계에서 "무료 체험 1건을 사용할게요"를 누른 탐구 1건 (inquiries.free_trial)
 * 이 탐구는 AI 자료 찾기부터 보고서 디자인까지 무료, PDF 저장만 이용권
 * (서버 supabase/functions/inquiry 의 usable()·use_free와 같은 기준)
 */

/* 이 학생이 무료 체험을 이 탐구가 아닌 다른 탐구에 이미 썼는지 */
export async function trialUsedElsewhere(userId, inquiryId) {
  if (!userId) return false;
  let q = supabase.from("inquiries").select("id").eq("user_id", userId).eq("free_trial", true).limit(1);
  if (inquiryId) q = q.neq("id", inquiryId);
  const { data, error } = await q;
  if (error) console.warn("trial check failed", error);
  return Boolean(data?.length);
}