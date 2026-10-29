import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { getClientId } from "../lib/clientId";

/*
 * 광고칸 — 관리자 '가입 · 결제 > 광고'에서 올린 업체 배너를 보여 준다 (sql/sm_67_ads.sql)
 *
 *   <AdSlot slot="home_top" />    메인 맨 위(탐구주제 검색창 위) 배너 1개 · 1200×240
 *                                  업체 3곳까지 · 5초마다 다음 배너로 넘어간다 (아래 점을 눌러도 넘어감)
 *   <AdSlot slot="home_right" />  메인 오른쪽 · 띠 배너(900×200) 4개를 위아래로 쌓는다 · 업체 4곳까지
 *
 * 켜져 있고 기간 안인 광고만 · 순서는 관리자에서 정한 '순서'대로
 * 화면에 절반 이상 보이면 '노출', 누르면 '클릭'을 남긴다 (서버가 하루·기기당 1번만 센다)
 * 맨 위: 광고가 없으면 칸 자체가 안 보인다
 * 오른쪽: 광고가 있는 만큼 + 자리가 남으면 맨 아래 '광고 문의' 칸 하나 → /advertise
 *
 *   <AdSlot slot="home_top" variant="card" pick={n} onHide={…} />
 *       물꼬 채팅 답 아래 — 대화 속 카드 모양 (배너 + 업체명 · '광고' 표시 · ⋯ 메뉴)
 *       맨 위 배너 광고를 같이 쓴다 · pick 으로 답마다 다른 업체가 나온다
 */
const imgUrl = (path) => supabase.storage.from("ads").getPublicUrl(path).data.publicUrl;
// .then 을 붙여야 서버로 실제로 보내진다 (안 붙이면 요청이 만들어지기만 하고 안 나간다)
const track = (id, kind) => supabase.rpc("ad_track", { p_ad: id, p_kind: kind, p_client: getClientId() }).then(() => {});

/* 배너 한 장 — 보이면 노출 1번 */
function Banner({ ad, ratio, className = "" }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current) return;
    let done = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !done) {
          done = true;
          track(ad.id, "view");
          io.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    io.observe(box.current);
    return () => io.disconnect();
  }, [ad.id]);

  return (
    <a
      ref={box}
      href={ad.link_url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      onClick={() => track(ad.id, "click")}
      className={`relative block w-full min-w-0 max-w-full overflow-hidden rounded-[6px] bg-gray-100 ${className}`}
      style={{ aspectRatio: ratio }}
    >
      {/* 칸 비율은 style 로 고정 (어떤 화면에서도 배너가 커지거나 잘리지 않게) */}
      <img src={imgUrl(ad.image_path)} alt={ad.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
    </a>
  );
}

/* 채팅 속 광고 카드 — 배너 + 업체명 · 광고 · ⋯ (보이면 노출 1번 · 누르면 클릭) */
function ChatCard({ ad, className = "", onHide }) {
  const box = useRef(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    let done = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !done) { done = true; track(ad.id, "view"); io.disconnect(); }
    }, { threshold: 0.5 });
    io.observe(box.current);
    return () => io.disconnect();
  }, [ad.id]);

  return (
    <div ref={box} className={`relative w-full min-w-0 ${className}`}>
      <a href={ad.link_url} target="_blank" rel="sponsored noopener noreferrer" onClick={() => track(ad.id, "click")}
        className="block overflow-hidden rounded-2xl bg-white ring-1 ring-black/10 transition hover:ring-black/20">
        <div className="relative w-full bg-gray-100" style={{ aspectRatio: "5 / 1" }}>
          <img src={imgUrl(ad.image_path)} alt={ad.title || ad.advertiser || "광고"} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="flex items-start gap-2 px-3.5 py-2.5 pr-11">
          <div className="min-w-0 flex-1">
            {ad.advertiser && <p className="truncate text-[12px] font-semibold text-gray-500">{ad.advertiser}</p>}
            {ad.title && <p className="line-clamp-2 text-[14.5px] font-extrabold leading-snug text-gray-900">{ad.title}</p>}
          </div>
          <span className="mt-0.5 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">광고</span>
        </div>
      </a>
      {/* ⋯ 메뉴 — 광고 없이 쓰기 · 광고 문의 */}
      <button type="button" aria-label="광고 메뉴" onClick={() => setMenu((v) => !v)}
        className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full text-[16px] font-black leading-none text-gray-400 hover:bg-gray-100">⋯</button>
      {menu && (
        <div className="absolute bottom-10 right-2 z-10 w-44 overflow-hidden rounded-xl bg-white text-[13px] shadow-lg ring-1 ring-black/10">
          {onHide && <button type="button" onClick={() => { setMenu(false); onHide(); }} className="block w-full px-3.5 py-2.5 text-left font-bold text-gray-800 hover:bg-gray-50">광고 없이 쓰기</button>}
          <Link to="/advertise" className="block px-3.5 py-2.5 font-bold text-gray-800 hover:bg-gray-50">광고 문의</Link>
        </div>
      )}
    </div>
  );
}

/* 맨 위 배너 — 5초마다 다음 업체로 (마우스를 올리면 멈춤) */
function TopRotator({ ads, className }) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (ads.length < 2 || hold) return;
    const t = setInterval(() => setI((x) => (x + 1) % ads.length), 5000);
    return () => clearInterval(t);
  }, [ads.length, hold]);
  const ad = ads[i % ads.length];
  return (
    <div className={`w-full min-w-0 ${className}`} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      <Banner key={ad.id} ad={ad} ratio="5 / 1" />
      {ads.length > 1 && (
        <div className="mt-1.5 flex justify-center gap-1.5">
          {ads.map((a, k) => (
            <button key={a.id} type="button" aria-label={`${k + 1}번째 광고`} onClick={() => setI(k)}
              className={`h-1.5 rounded-full transition-all ${k === i % ads.length ? "w-4 bg-gray-500" : "w-1.5 bg-gray-300"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/* 오른쪽 맨 아래 '광고 문의' 칸 하나 — 띠 배너와 같은 크기 · 누르면 광고 문의 페이지 */
function EmptySlot() {
  return (
    <Link
      to="/advertise"
      style={{ aspectRatio: "9 / 2" }}
      className="flex w-full min-w-0 items-center justify-center rounded-[6px] border border-dashed border-gray-300 bg-white transition hover:border-sm-orange"
    >
      <span className="text-[15px] font-bold text-sm-orange">광고 문의 ›</span>
    </Link>
  );
}

export default function AdSlot({ slot = "home_right", className = "", variant = "", pick = 0, onHide }) {
  const [ads, setAds] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.rpc("ads_active", { p_slot: slot }).then(({ data }) => alive && setAds(data ?? []));
    return () => { alive = false; };
  }, [slot]);

  if (ads === null) return null; // 불러오는 중

  // 채팅 속 카드 — 업체 하나 (pick 으로 돌아가며)
  if (variant === "card") return ads.length ? <ChatCard ad={ads[Math.abs(pick) % Math.min(ads.length, 3)]} className={className} onHide={onHide} /> : null;

  // 메인 맨 위 — 배너 1개, 업체 3곳이 돌아가며 (없으면 안 보임)
  if (slot === "home_top") return ads.length ? <TopRotator ads={ads.slice(0, 3)} className={className} /> : null;

  // 메인 오른쪽 — 띠 배너 4칸까지 + 자리가 남으면 맨 아래 '광고 문의' 칸 하나
  const shown = ads.slice(0, 4);
  return (
    <div className={`grid w-full min-w-0 gap-2 ${className}`}>
      {shown.map((a) => (
        <Banner key={a.id} ad={a} ratio="9 / 2" />
      ))}
      {shown.length < 4 && <EmptySlot />}
    </div>
  );
}