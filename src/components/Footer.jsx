import { Link } from "react-router-dom";

const BIZ = {
  company: "세움러닝(주)",
  ceo: "김지윤",
  bizNo: "817-31-01468",
  mailOrderNo: "2026-인천서해-0439",
  address: "인천광역시 서구 가정로 451, 1129-1130호",
  email: "company@seumlearning.com",
  privacyOfficer: "곽용신",
};

export default function Footer() {
  return (
    <footer className="mt-20 border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-bold text-gray-700">
          <Link to="/terms" className="hover:text-sm-orange">이용약관</Link>
          <Link to="/privacy" className="text-sm-navy hover:text-sm-orange">개인정보처리방침</Link>
          <Link to="/refund" className="hover:text-sm-orange">환불 규정</Link>
        </div>

        <div className="mt-5 space-y-1 text-xs leading-relaxed text-gray-500">
          <p>{BIZ.company} | 대표 {BIZ.ceo} | 사업자등록번호 {BIZ.bizNo}</p>
          <p>통신판매업신고번호 {BIZ.mailOrderNo} | 개인정보보호책임자 {BIZ.privacyOfficer}</p>
          <p>{BIZ.address}</p>
          <p>문의 {BIZ.email}</p>
          <p className="pt-3 text-gray-400">
            Copyright © {BIZ.company} All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}