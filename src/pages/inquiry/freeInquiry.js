import { supabase } from "../../lib/supabase";

/*
 * 무료 체험 탐구인지 — 탐구 준비·결과 분석·보고서 화면이 같이 쓴다
 * 무료 체험 = 이 학생이 탐구팩까지 처음 만든 탐구 1건
 * 이 탐구는 보고서 디자인까지 무료, PDF 저장만 이용권이 필요하다
 * (서버 supabase/functions/inquiry 의 usable()과 같은 기준)
 */
export async function isFreeInquiry(userId, inquiryId) {
  if (!userId || !inquiryId) return false;
  const { data, error } = await supabase
    .from("inquiries")
    .select("id")
    .eq("user_id", userId)
    .not("pack", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) console.warn("free check failed", error);
  return data?.id === inquiryId;
}