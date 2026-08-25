// 사전신청 설정 — 날짜·금액·계좌는 여기만 고치면 전체에 반영된다.

export const PREORDER = {
  // 계약금
  deposit: 100000,
  total: 250000,        // 총 수강료
  balance: 150000,      // 잔금 (총액 − 계약금)

  // 목표 인원
  target: 50,

  // 일정  ※ 확정되면 아래 문구를 실제 날짜로 바꿀 것
  deadline: "2026년 9월 6일",       // 신청 마감
  confirmDate: "2026년 9월 8일",    // 제작 확정 여부 안내
  refundDate: "2026년 9월 12일",    // 미달 시 환불 완료 예정
  openDate: "2026년 9월 14일",       // 강의 공개 예정

  // 입금 계좌
  bank: "국민은행",
  account: "649301-04-159726",
  holder: "김지윤(세움러닝)",
};

export const GRADES = ["고3", "반수", "N수"];