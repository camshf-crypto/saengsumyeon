import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { track } from "../lib/track";
import { refLink } from "../lib/referral";

/*
 * 무료 횟수를 다 쓴 회원 — 친구 초대로 추가 횟수 받기 (탐구주제 진단의 친구 초대 화면과 같은 구성)
 * 독서 흔한가·지원동기 흔한가가 같이 쓴다. 초대 링크는 기존 친구 추천 링크(?ref=코드)
 *
 * title     : "이번 주 무료 2권을 다 썼어요"
 * question  : "다음 책도 궁금하죠?"
 * reward    : "+2권"  — 친구 1명당 받는 것
 * unit      : "권" | "번"
 * name      : "독서" | "지원동기" — 설명에 들어가는 진단 이름
 * weekly    : 일주일 무료 수 (2)
 * shareText : 친구에게 보낼 문구 (링크 앞에 붙는다)
 * bonusTable: 받은 보상을 세는 표 ("reading_bonus" | "motive_bonus")
 * nextOpen  : 다음 무료 1회가 열리는 시각 (ISO)
 * color     : 버튼 색 (진단마다 다르게)
 */

export const openDay = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${"일월화수목금토"[d.getDay()]})`;
};

export default function InviteGate({ title, question, reward, unit = "번", name = "", weekly = 2, shareText, bonusTable, nextOpen, onHome, color = "#3D6BEF" }) {
  const [info, setInfo] = useState(null); // { my_code, invited_count }
  const [rewarded, setRewarded] = useState(0); // 이 진단으로 보상 받은 친구 수
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.rpc("get_my_referral").then(({ data, error }) => {
      if (error) return console.warn("referral info failed", error);
      setInfo(Array.isArray(data) ? data[0] : data);
    });
    if (bonusTable) supabase.from(bonusTable).select("id", { count: "exact", head: true }).then(({ count }) => setRewarded(count ?? 0));
  }, [bonusTable]);

  const code = info?.my_code ?? null;
  const link = code ? refLink(code) : "";

  async function copy() {
    track("link_copy", code);
    try {
      await navigator.clipboard.writeText(`${shareText}\n${link}`);
      setMsg("링크가 복사됐어요. 카톡이나 DM에 붙여넣어 친구에게 보내주세요.");
    } catch {
      window.prompt("이 링크를 복사해 친구에게 보내 주세요", link);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-6 py-9 text-center">
      <p className="text-[19px] font-extrabold text-sm-navy">{title}</p>
      <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">
        {question}
        <br />
        친구 1명이 가입하고 진단하면 <b style={{ color }}>{reward}</b>를 드려요.
      </p>

      <button
        onClick={copy}
        disabled={!link}
        className="mt-6 h-[60px] w-full rounded-xl text-[17px] font-extrabold text-white disabled:opacity-40"
        style={{ background: color }}
      >
        친구에게 공유하고 {reward} 받기
      </button>
      {msg && <p className="mt-3 text-[13.5px] font-bold" style={{ color }}>{msg}</p>}

      <p className="mt-6 text-[13px] text-gray-400">
        지금까지 초대 {info?.invited_count ?? 0}명 · 보상 받은 친구 {rewarded}명
      </p>
      <p className="mt-4 text-[12.5px] leading-relaxed text-gray-400">
        친구가 링크로 들어와 새로 가입하고 {name} 진단 1번을 마치면 {reward}이 들어와요.
        <br />
        받은 {unit === "권" ? "권수" : "횟수"}는 기한 없이 쌓이고, 이번 주 무료 {weekly}{unit}을 다 쓴 뒤에 사용돼요.
        <br />
        기다리면 <b className="text-gray-500">{openDay(nextOpen) || "일주일 뒤"}</b>에 1{unit}이 다시 열려요.
      </p>

      <button onClick={onHome} className="mt-5 text-[13.5px] text-gray-400 underline">처음으로</button>
    </div>
  );
}