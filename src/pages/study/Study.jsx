import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { LoginPopup } from "../../components/LoginGate";
import { NicknameModal, fetchNickname, needsNickname } from "../../components/NicknameEditor";

/*
 * 📚 전국 공부법 도감 — /study
 *   · 과목별로 전국 학생들의 공부법(3단계)을 본다 · 효과 있었음 순
 *   · 내 등급대와 그 아래는 무료 · 한 단계 위는 1단계만 보이고 [조각 10개로 열기] 또는 이용권
 *   · 모의고사 성적표로 인증하면 내 등급대가 정해지고 공부법에 '인증' 배지가 붙는다
 *   · 따라 해 볼게요 → 7일 뒤 효과 남기기
 * DB: sql/sm_52_study.sql · 인증 서버 함수: supabase/functions/study_verify
 */

// 지금은 공부법을 모으는 단계 — 다른 친구 공부법 보기(도감 · 열기 · 이용권 · 따라 하기)는 false 동안 숨긴다
// 도감을 열 때 true 로만 바꾸면 된다 (DB · 서버는 이미 준비돼 있음)
const BROWSE = false;

const NAVY = "#1E2A5A";
const PINK = "#FD1673";
const WIDTH = "mx-auto max-w-xl px-4 sm:px-5";
const BANK = { name: "국민은행", number: "649301-04-159726", holder: "세움러닝(김지윤)" };
const PRICE = { one: 2900, all: 4900 };
const YEARS = ["고1", "고2", "고3"];
const BANDS = [
  { v: null, l: "전체" },
  { v: 1, l: "1~2등급" },
  { v: 2, l: "3~4등급" },
  { v: 3, l: "5등급 이하" },
];
const bandLabel = (b) => BANDS.find((x) => x.v === b)?.l ?? "";
const errMsg = (e) => (e?.message || String(e || "")).replace(/^.*?exception:\s*/i, "") || "잠시 후 다시 해 주세요";
const won = (n) => `${Number(n || 0).toLocaleString()}원`;

function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[17px] font-extrabold text-gray-900">{title}</p>
          <button onClick={onClose} className="text-[24px] leading-none text-gray-400" aria-label="닫기">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* 한 번 보여 준 알림은 다시 안 띄운다 (이 브라우저 기준) */
const seen = (k) => { try { return localStorage.getItem("study-seen-" + k) === "1"; } catch { return false; } };
const markSeen = (k) => { try { localStorage.setItem("study-seen-" + k, "1"); } catch {} };

function useToast() {
  const [text, setText] = useState("");
  const show = useCallback((m) => {
    setText(m);
    clearTimeout(window.__studyToast);
    window.__studyToast = setTimeout(() => setText(""), 2400);
  }, []);
  const node = text ? (
    <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
      <div className="rounded-full bg-gray-900/90 px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-lg">{text}</div>
    </div>
  ) : null;
  return [node, show];
}

const Chip = ({ on, children, onClick }) => (
  <button onClick={onClick} className={`h-9 flex-none rounded-full px-3.5 text-[13px] font-bold ${on ? "bg-[#1E2A5A] text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}>
    {children}
  </button>
);

/* ═════════════ 화면 ═════════════ */
export default function Study() {
  const { user, loading } = useAuth();
  const [me, setMe] = useState(null);
  const [subject, setSubject] = useState("수학");
  const [year, setYear] = useState(null);
  const [band, setBand] = useState(null);
  const [sort, setSort] = useState("effect");
  const [tab, setTab] = useState(BROWSE ? "all" : "mine"); // all · tried · mine · admin · reward
  const [phoneFor, setPhoneFor] = useState(null); // 쿠폰 받을 번호를 적을 공부법 id
  const [list, setList] = useState(null);
  const [sheet, setSheet] = useState(null); // post · verify · pass · rate
  const [rateTarget, setRateTarget] = useState(null);
  const [login, setLogin] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [nickAsk, setNickAsk] = useState(null);
  const [reward, setReward] = useState(null); // 1등급 공부법 1,000원 이벤트
  const [notice, setNotice] = useState(null); // 반려 · 쿠폰 보냄 알림 팝업
  const sheetRef = useRef(null);
  sheetRef.current = sheet; // 인증 창에서 결과를 이미 봤으면 팝업을 또 띄우지 않으려고
  const askedPhone = useRef(false); // 들어오자마자 번호 창은 한 번만
  const loadReward = useCallback(async () => {
    const { data } = await supabase.rpc("study_reward_status");
    setReward(data);
    // 쿠폰 반려 · 쿠폰 보냄은 팝업으로 먼저 알린다
    const done = Object.entries(data?.mine ?? {}).find(([id, r]) => (r.status === "rejected" || r.status === "sent") && !seen(`rw-${id}-${r.status}`));
    if (done) {
      const [id, r] = done;
      markSeen(`rw-${id}-${r.status}`);
      setNotice(r.status === "rejected"
        ? { icon: "😢", title: "쿠폰 신청이 반려됐어요", body: r.reason || "내용을 조금 더 구체적으로 적어 주세요", tip: "공부법을 지우고 단계마다 교재 · 하루 얼마나 · 언제를 넣어 다시 쓰면 다시 신청돼요." }
        : { icon: "🎁", title: "다이소 1,000원 쿠폰을 보냈어요!", body: "적어 준 번호로 카카오 선물하기 쿠폰을 보냈어요. 문자를 확인해 주세요.", tip: "보낸 뒤 번호는 바로 지웠어요." });
    }
    // 쿠폰 대상인데 번호를 아직 안 적었으면 바로 번호 창을 연다
    if (!askedPhone.current) {
      const need = Object.entries(data?.mine ?? {}).find(([, r]) => (r.status === "pending" || r.status === "approved") && !r.has_phone);
      if (need) { askedPhone.current = true; setPhoneFor(Number(need[0])); }
    }
  }, []);
  const [toastNode, toast] = useToast();

  const loadMe = useCallback(async () => {
    const { data } = await supabase.rpc("study_me");
    setMe(data);
    // 관리자가 모의고사 인증을 반려했으면 팝업으로 알린다
    const v = data?.verify;
    if (v?.status === "rejected" && v.id && !seen(`sv-${v.id}`)) {
      markSeen(`sv-${v.id}`);
      if (sheetRef.current === "verify") return; // 방금 인증 창에서 반려 결과를 봤어요
      setNotice({ icon: "😢", title: "모의고사 인증이 반려됐어요", body: v.reason || "성적표를 확인하지 못했어요", tip: "이름 · 학교 · 수험번호는 가리고, 등급 칸이 잘 보이게 다시 찍어 올려 주세요.", verify: true });
    }
  }, []);
  const loadList = useCallback(async () => {
    if (tab === "mine" && !user) return setList([]);
    setList(null);
    const { data, error } = await supabase.rpc("study_list", {
      p_subject: tab === "all" ? subject : null, p_school_year: year, p_band: band, p_sort: sort, p_tab: tab === "admin" ? "all" : tab, p_offset: 0,
    });
    setList(error ? [] : data ?? []);
  }, [subject, year, band, sort, tab, user]);

  useEffect(() => {
    if (loading) return;
    loadMe();
    loadReward();
    if (user) supabase.rpc("sm_is_admin").then(({ data }) => setAdmin(!!data));
  }, [user, loading, loadMe]);
  useEffect(() => {
    if (!loading && tab !== "admin" && tab !== "reward") loadList();
  }, [loading, loadList, tab]);

  const needLogin = (fn) => (user ? fn() : setLogin(true));
  const withNick = (fn) =>
    needLogin(async () => {
      const info = await fetchNickname();
      if (needsNickname(info)) setNickAsk(() => fn);
      else fn();
    });

  const [verifyFor, setVerifyFor] = useState(null); // 방금 올린 공부법 (인증 안내용)
  const [phoneNext, setPhoneNext] = useState(null);  // 인증 뒤 열 쿠폰 번호 창
  const replace = (p) => setList((l) => (l ? l.map((x) => (x.id === p.id ? p : x)) : l));
  const call = async (fn, args, ok) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      toast(errMsg(error));
      return null;
    }
    if (ok) toast(ok);
    return data;
  };

  const mg = reward?.max_grade ?? 2; // 쿠폰 주는 등급 (sm_58 에서 정함)
  const myGrade = me?.grades?.[subject];
  const myBand = myGrade ? myGrade.band : 2;
  const pass = me?.passes?.[subject] || me?.passes?.["*"];

  return (
    <div className="min-h-screen bg-[#F4F5F7] pb-28">
      <div className={`${WIDTH} pt-6`}>
        {/* 머리 */}
        <div className="px-1">
          {BROWSE ? (
            <>
              <h1 className="mt-1 text-[23px] font-extrabold leading-snug text-gray-900">다음 등급으로 가는<br />전국 학생들의 공부법</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-500">좋아요 순이 아니라 <b className="text-gray-800">따라 해 보고 효과 있었음</b>이 많은 순서예요.</p>
            </>
          ) : (
            <>
              <h1 className="mt-1 text-[23px] font-extrabold leading-snug text-gray-900">나만의 공부법을<br />모으고 있어요</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-500">전국 학생들의 공부법 도감을 준비 중이에요. 지금 쓴 공부법은 <b className="text-gray-800">도감이 열릴 때 먼저 올라가요.</b></p>
            </>
          )}
          {/* 이벤트 배너가 떠 있으면 버튼은 배너 쪽 2개만 둔다 */}
          {!reward?.active && <div className="mt-4 flex gap-2">
            <button onClick={() => withNick(() => setSheet("post"))} className="h-11 flex-1 rounded-xl text-[14px] font-extrabold text-white" style={{ background: NAVY }}>+ 내 공부법 올리기</button>
            <button onClick={() => needLogin(() => setSheet("verify"))} className="h-11 flex-1 rounded-xl text-[14px] font-extrabold" style={{ background: "#FFF0F5", color: PINK }}>모의고사로 등급 인증</button>
          </div>}
        </div>

        {/* 1등급 공부법 1,000원 이벤트 */}
        {reward?.active && (
          <div className="mt-3 overflow-hidden rounded-2xl p-4 text-white" style={{ background: `linear-gradient(135deg, ${PINK}, #FF6A3D)` }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[18px] font-extrabold leading-snug">1~{mg}등급이면 공부법 쓰고<br />다이소 1,000원 쿠폰 받자</p>
                <p className="mt-1 text-[12px] opacity-90">① 공부법 쓰기 → ② 모의고사 성적표 인증 → ③ 확인 후 모바일 쿠폰 발송</p>
              </div>
              <span className="text-[38px] leading-none">🎁</span>
            </div>
            <button onClick={() => withNick(() => setSheet("post"))} className="mt-3 h-11 w-full rounded-xl bg-white text-[14px] font-extrabold" style={{ color: PINK }}>공부법 쓰고 쿠폰 받기</button>
            <p className="mt-2 text-[11px] opacity-85">공부법을 다 쓰면 모의고사 성적표 인증으로 바로 이어져요 · 쿠폰은 한 사람 1장 · 1~{mg}등급으로 인증된 과목만</p>
            {reward.contact && (
              <button onClick={async () => {
                if (!window.confirm("생수면 소식 연락을 끌까요? 보관한 번호를 바로 지워요.")) return;
                const { error } = await supabase.rpc("study_contact_off");
                if (error) return toast(errMsg(error));
                toast("연락 동의를 껐어요. 번호를 지웠어요");
                loadReward();
              }} className="mt-1 text-[11px] underline opacity-85">생수면 소식 연락 동의 끄기</button>
            )}
          </div>
        )}

        {/* 7일 지난 따라 하기 → 효과 남기기 */}
        {BROWSE && me?.my_tries_due > 0 && (
          <button onClick={() => setTab("tried")} className="mt-3 w-full rounded-2xl px-4 py-3 text-left text-[13.5px] font-bold text-white" style={{ background: PINK }}>
            따라 해 본 공부법 {me.my_tries_due}개, 효과 있었는지 알려 주세요 (+조각 1개씩) →
          </button>
        )}

        {/* 탭 — 모으는 단계에 관리자가 아니면 탭 없이 제목만 */}
        {!BROWSE && !admin ? (
          <p className="mt-5 text-[15px] font-extrabold text-gray-900">내가 올린 공부법</p>
        ) : (
        <div className="mt-4 flex gap-1 rounded-xl bg-gray-200/70 p-1">
          {[...(BROWSE ? [["all", "도감"], ["tried", "따라 하는 중"]] : []), ["mine", "내가 올린 공부법"], ...(admin ? [["admin", "인증"], ["reward", "보상"]] : [])].map(([k, l]) => (
            <button key={k} onClick={() => (["all", "admin", "reward"].includes(k) ? setTab(k) : needLogin(() => setTab(k)))}
              className={`h-9 flex-1 whitespace-nowrap rounded-lg px-1 text-[12.5px] font-bold ${tab === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>{l}</button>
          ))}
        </div>
        )}

        {tab === "admin" ? (
          <AdminVerify toast={toast} />
        ) : tab === "reward" ? (
          <AdminReward toast={toast} onChange={loadReward} />
        ) : (
          <>
            {BROWSE && tab === "all" && (
              <>
                <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
                  {(me?.subjects ?? ["국어", "수학", "영어", "사회탐구", "과학탐구"]).map((s) => (
                    <Chip key={s} on={subject === s} onClick={() => setSubject(s)}>{s}</Chip>
                  ))}
                </div>

                {/* 내 등급대 안내 */}
                <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-[12.5px] leading-relaxed text-gray-600 ring-1 ring-black/5">
                  {pass ? (
                    <><b className="text-gray-900">{subject} 이용권</b> · {pass}까지 모든 등급 공부법을 볼 수 있어요</>
                  ) : myGrade ? (
                    <><b className="text-gray-900">{subject} {myGrade.grade}등급 인증 ✓</b> · {bandLabel(myBand)} 이하 공부법은 무료예요{myBand > 1 && " · 한 단계 위는 열어서 볼 수 있어요"}</>
                  ) : (
                    <>지금은 <b className="text-gray-900">3~4등급대 이하</b>까지 무료로 볼 수 있어요. 모의고사로 인증하면 내 등급대가 정해져요.</>
                  )}
                  {!pass && (
                    <button onClick={() => needLogin(() => setSheet("pass"))} className="ml-1 font-bold underline" style={{ color: PINK }}>이용권 보기</button>
                  )}
                </div>

                <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
                  {BANDS.map((b) => <Chip key={String(b.v)} on={band === b.v} onClick={() => setBand(b.v)}>{b.l}</Chip>)}
                  <span className="mx-1 w-px flex-none bg-gray-300" />
                  <Chip on={year === null} onClick={() => setYear(null)}>전 학년</Chip>
                  {YEARS.map((y) => <Chip key={y} on={year === y} onClick={() => setYear(y)}>{y}</Chip>)}
                </div>
                <div className="mt-2 flex justify-end gap-3 text-[12.5px] font-bold">
                  {[["effect", "효과 있었음 순"], ["new", "최신순"]].map(([k, l]) => (
                    <button key={k} onClick={() => setSort(k)} className={sort === k ? "text-gray-900" : "text-gray-400"}>{l}</button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-2 flex flex-col gap-3">
              {list === null ? (
                <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중...</p>
              ) : list.length === 0 ? (
                <div className="rounded-2xl bg-white px-4 py-10 text-center ring-1 ring-black/5">
                  <p className="text-[14px] font-bold text-gray-700">{tab === "mine" ? (user ? "아직 올린 공부법이 없어요" : "로그인하면 내 공부법을 쓸 수 있어요") : tab === "tried" ? "따라 하는 공부법이 없어요" : "아직 이 조건의 공부법이 없어요"}</p>
                </div>
              ) : (
                list.map((p) => (
                  <PostCard key={p.id} p={p} me={me} reward={reward?.mine?.[String(p.id)]} maxGrade={mg} onPhone={() => setPhoneFor(p.id)}
                    canVerify={!!reward?.active && me?.verify?.status !== "pending"} verifyWait={me?.verify?.status === "pending"}
                    onVerify={() => { setVerifyFor(p); setSheet("verify"); }}
                    onUnlock={() => needLogin(async () => {
                      if (!window.confirm(`조각 10개로 이 공부법을 열까요? (지금 ${me?.balance ?? 0}개)`)) return;
                      const d = await call("study_unlock", { p_id: p.id }, "열었어요! 올린 학생에게 조각 2개가 갔어요");
                      if (d) { replace(d); loadMe(); }
                    })}
                    onPass={() => needLogin(() => setSheet("pass"))}
                    onOpen={async () => { // 이용권이 있으면 열 때 기록 (올린 학생 보상)
                      const { data } = await supabase.rpc("study_get", { p_id: p.id });
                      if (data) replace(data);
                    }}
                    onTry={() => needLogin(async () => { const d = await call("study_try", { p_id: p.id }, "담았어요! 7일 뒤 효과를 물어볼게요"); if (d) replace(d); })}
                    onRate={() => { setRateTarget(p); setSheet("rate"); }}
                    onReport={() => needLogin(async () => {
                      if (!window.confirm("이 공부법을 신고할까요? (홍보·욕설·개인정보 등)")) return;
                      await call("study_report", { p_id: p.id }, "신고했어요. 확인할게요");
                    })}
                    onDelete={async () => {
                      if (!window.confirm("내 공부법을 지울까요?")) return;
                      const { error } = await supabase.rpc("study_delete", { p_id: p.id });
                      if (error) return toast(errMsg(error));
                      setList((l) => l.filter((x) => x.id !== p.id));
                    }}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      <PostSheet open={sheet === "post"} me={me} subject={subject} onClose={() => setSheet(null)}
        onDone={async (p) => {
          setSheet(null);
          const { data: rs } = await supabase.rpc("study_reward_status");
          setReward(rs);
          if (rs?.mine?.[String(p.id)]) setPhoneFor(p.id); // 이미 인증돼 보상 대상이면 쿠폰 받을 번호부터
          else if (rs?.active && !p.verified && p.grade <= (rs.max_grade ?? 2)) { setVerifyFor(p); setSheet("verify"); } // 다음 단계: 모의고사 인증
          else toast("올렸어요! 도감이 열리면 먼저 올라가요");
          setSubject(p.subject);
          if (BROWSE) setTab("all");
          else if (tab !== "mine") setTab("mine");
          loadList();
        }} />
      <VerifySheet open={sheet === "verify"} user={user} me={me} intro={verifyFor} maxGrade={mg} phonePost={phoneNext}
        onPhoneDone={() => { setPhoneNext(null); setSheet(null); setVerifyFor(null); loadReward(); toast("확인 후 다이소 1,000원 쿠폰을 보내 드려요"); }}
        onClose={() => {
          setSheet(null); setVerifyFor(null); setPhoneNext(null); // 번호를 안 적고 닫으면 카드의 '쿠폰 받을 번호 적기'로
        }}
        onDone={async () => {
          loadMe(); loadList();
          const { data: rs } = await supabase.rpc("study_reward_status");
          setReward(rs);
          const need = Object.entries(rs?.mine ?? {}).find(([, r]) => (r.status === "pending" || r.status === "approved") && !r.has_phone);
          if (need) setPhoneNext(Number(need[0]));
        }} />
      <PassSheet open={sheet === "pass"} subject={subject} me={me} onClose={() => setSheet(null)} onDone={() => { setSheet(null); loadMe(); toast("입금 확인 후 바로 열려요"); }} />
      <Sheet open={sheet === "rate"} onClose={() => setSheet(null)} title="7일 따라 해 보니 어땠어요?">
        {rateTarget && (
          <>
            <p className="text-[13px] text-gray-500">{rateTarget.subject} · {rateTarget.nick}님의 공부법</p>
            <div className="mt-3 flex flex-col gap-2">
              {[["good", "효과 있었음 👍"], ["meh", "그냥 그럼 😐"], ["bad", "나랑은 안 맞음 👎"]].map(([k, l]) => (
                <button key={k} onClick={async () => {
                  const d = await call("study_rate", { p_id: rateTarget.id, p_effect: k }, "남겼어요! 조각 1개를 받았어요");
                  if (d) { replace(d); loadMe(); setSheet(null); }
                }} className="h-12 rounded-xl bg-[#F4F5F7] text-[15px] font-bold text-gray-800 active:scale-[.99]">{l}</button>
              ))}
            </div>
          </>
        )}
      </Sheet>
      <PhoneSheet postId={phoneFor} onClose={() => setPhoneFor(null)} onDone={() => { setPhoneFor(null); loadReward(); toast("확인 후 다이소 1,000원 쿠폰을 보내 드려요"); }} />
      <LoginPopup open={login} onClose={() => setLogin(false)} title="로그인하고 공부법을 나눠요" desc="닉네임만 보이고, 학교·이름은 받지 않아요." />
      {nickAsk && <NicknameModal onClose={() => setNickAsk(null)} onDone={() => { const fn = nickAsk; setNickAsk(null); fn?.(); }} />}
      {notice && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-5" onClick={() => setNotice(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-[18px] font-extrabold text-gray-900">{notice.title}</p>
            <p className="mt-2 rounded-xl bg-[#F8F9FB] px-3 py-2.5 text-[14px] font-bold leading-relaxed text-gray-800">{notice.body}</p>
            {notice.tip && <p className="mt-2 text-[12.5px] leading-relaxed text-gray-500">{notice.tip}</p>}
            {notice.verify ? (
              <div className="mt-4 flex gap-2">
                <button onClick={() => setNotice(null)} className="h-11 flex-1 rounded-xl bg-gray-100 text-[14px] font-bold text-gray-600">닫기</button>
                <button onClick={() => { setNotice(null); setSheet("verify"); }} className="h-11 flex-1 rounded-xl text-[14px] font-extrabold text-white" style={{ background: PINK }}>다시 인증하기</button>
              </div>
            ) : (
              <button onClick={() => setNotice(null)} className="mt-4 h-11 w-full rounded-xl text-[14px] font-extrabold text-white" style={{ background: NAVY }}>확인</button>
            )}
          </div>
        </div>
      )}
      {toastNode}
    </div>
  );
}

/* ───────── 공부법 카드 ───────── */
function PostCard({ p, me, reward, maxGrade = 2, onPhone, canVerify, verifyWait, onVerify, onUnlock, onPass, onOpen, onTry, onRate, onReport, onDelete }) {
  const [open, setOpen] = useState(false);
  const rated = p.good + p.meh + p.bad;
  const goodPct = rated ? Math.round((p.good / rated) * 100) : null;
  const toggle = () => {
    if (!open && !p.locked && !p.mine) onOpen();
    setOpen(!open);
  };
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md px-2 py-0.5 text-[11.5px] font-extrabold text-white" style={{ background: p.band === 1 ? PINK : p.band === 2 ? NAVY : "#6B7280" }}>
          {p.grade_before && p.grade_before !== p.grade ? `${p.grade_before}등급 → ${p.grade}등급` : `${p.grade}등급`}
        </span>
        <span className="rounded-md bg-[#EEF1F8] px-2 py-0.5 text-[11.5px] font-bold" style={{ color: NAVY }}>{p.detail || p.subject}</span>
        {p.exam_type && <span className="rounded-md bg-[#EEF1F8] px-2 py-0.5 text-[11.5px] font-bold" style={{ color: NAVY }}>{examTypeLabel(p.exam_type)}</span>}
        {p.verified ? (
          <span className="rounded-md bg-[#E8F7EE] px-2 py-0.5 text-[11.5px] font-extrabold text-[#15803D]">✓ 모의고사 인증</span>
        ) : (
          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-500">직접 적은 등급</span>
        )}
        <span className="text-[12px] text-gray-500">{p.school_year}{p.region ? ` · ${p.region}` : ""} · {p.nick}</span>
      </div>
      {p.mine && reward && (
        <div className={`mt-2 rounded-lg px-2.5 py-1.5 text-[12px] font-bold ${reward.status === "sent" ? "bg-[#E8F7EE] text-[#15803D]" : reward.status === "rejected" ? "bg-red-50 text-red-600" : "bg-[#FFF0F5]"}`}
          style={reward.status === "pending" || reward.status === "approved" ? { color: PINK } : undefined}>
          {reward.status === "sent" ? "🎁 다이소 1,000원 쿠폰을 보냈어요"
            : reward.status === "rejected" ? `보상 반려 · ${reward.reason} (지우고 다시 쓰면 다시 신청돼요)`
            : reward.status === "approved" ? "🎁 확인 완료! 쿠폰 보내는 중이에요"
            : "🎁 보상 확인 중 · 확인되면 다이소 1,000원 쿠폰을 보내 드려요"}
          {(reward.status === "pending" || reward.status === "approved") && !reward.has_phone && (
            <button onClick={onPhone} className="ml-1 underline">쿠폰 받을 번호 적기</button>
          )}
        </div>
      )}

      {p.mine && !reward && !p.verified && p.grade <= maxGrade && (canVerify || verifyWait) && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-[#FFF0F5] px-2.5 py-2 text-[12px] font-bold" style={{ color: PINK }}>
          <span>{verifyWait ? "⏳ 모의고사 성적표 확인 중 · 확인되면 쿠폰 대상이 돼요" : "🎁 마지막 단계 · 모의고사 성적표로 인증하면 쿠폰을 받아요"}</span>
          {!verifyWait && <button onClick={onVerify} className="h-8 flex-none rounded-lg px-3 text-[12px] font-extrabold text-white" style={{ background: PINK }}>인증하기</button>}
        </div>
      )}
      {p.fit?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.fit.map((f) => <span key={f} className="rounded-full bg-[#EEF1F8] px-2 py-0.5 text-[11px] font-bold" style={{ color: NAVY }}>{f} 친구에게</span>)}
        </div>
      )}
      {p.locked && (
        <p className="mt-3 text-[12px] font-extrabold" style={{ color: PINK }}>한 단계 위 공부법 · 1단계만 미리 보기</p>
      )}
      {!p.locked && p.materials && <p className="mt-2 text-[12.5px] text-gray-600"><b className="text-gray-800">교재·강의</b> {p.materials}</p>}
      <ol className="mt-2 flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => {
          const t = p.steps?.[i];
          const hidden = p.locked && i > 0;
          return (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white" style={{ background: hidden ? "#D1D5DB" : NAVY }}>{i + 1}</span>
              {hidden ? (
                <span className="select-none text-[14px] leading-relaxed text-gray-400 blur-[5px]">이 단계는 열면 보여요 이 단계는 열면 보여요</span>
              ) : (
                <span className={`text-[14.5px] leading-relaxed text-gray-800 ${!open && i > 0 ? "line-clamp-1" : ""}`}>{t}</span>
              )}
            </li>
          );
        })}
      </ol>

      {!p.locked && open && p.dropped && (
        <p className="mt-2 rounded-lg bg-[#FFF7F7] px-2.5 py-1.5 text-[12.5px] text-gray-600"><b className="text-red-500">안 맞았던 방법</b> {p.dropped}</p>
      )}
      {!p.locked && open && (p.hours != null || p.note) && (
        <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
          {p.hours != null && <span className="rounded-md bg-[#F4F5F7] px-2 py-1 text-gray-600">하루 {Number(p.hours)}시간</span>}
          {p.note && <span className="rounded-md bg-[#F4F5F7] px-2 py-1 text-gray-600">오른 시기 · {p.note}</span>}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[12px] text-gray-500">
        <span className={BROWSE ? "" : "invisible"}>따라 함 {p.tries} · {goodPct == null ? "효과 기록 아직" : <>효과 있었음 <b style={{ color: PINK }}>{goodPct}%</b> ({rated}명)</>}</span>
        {!p.locked && <button onClick={toggle} className="font-bold text-gray-500">{open ? "접기" : "자세히"}</button>}
      </div>

      <div className="mt-3 flex gap-2">
        {p.locked ? (
          <>
            <button onClick={onUnlock} className="h-10 flex-1 rounded-xl text-[13.5px] font-extrabold text-white" style={{ background: PINK }}>조각 10개로 열기</button>
            <button onClick={onPass} className="h-10 flex-1 rounded-xl bg-[#FFF0F5] text-[13.5px] font-extrabold" style={{ color: PINK }}>이용권으로 다 보기</button>
          </>
        ) : p.mine ? (
          <>
            <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-[#F4F5F7] text-[13px] font-bold text-gray-500">{BROWSE ? `내 공부법 · 열람 ${p.opens}` : "도감이 열리면 먼저 올라가요"}</span>
            <button onClick={onDelete} className="h-10 rounded-xl px-3 text-[12.5px] font-bold text-gray-400 ring-1 ring-gray-200">지우기</button>
          </>
        ) : p.effect ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-[#F4F5F7] text-[13px] font-bold text-gray-500">
            내 평가 · {{ good: "효과 있었음", meh: "그냥 그럼", bad: "안 맞음" }[p.effect]}
          </span>
        ) : p.can_rate ? (
          <button onClick={onRate} className="h-10 flex-1 rounded-xl text-[13.5px] font-extrabold text-white" style={{ background: PINK }}>7일 해 보니 어땠어요?</button>
        ) : p.tried ? (
          <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-[#EEF1F8] text-[13px] font-bold" style={{ color: NAVY }}>
            따라 하는 중 · {Math.max(1, 7 - Math.floor((Date.now() - new Date(p.tried_at)) / 86400000))}일 뒤 효과 남기기
          </span>
        ) : (
          <button onClick={onTry} className="h-10 flex-1 rounded-xl text-[13.5px] font-extrabold text-white" style={{ background: NAVY }}>따라 해 볼게요</button>
        )}
      </div>
      {!p.mine && <button onClick={onReport} className="mt-2 text-[11px] text-gray-400 underline">신고</button>}
    </div>
  );
}

/* ───────── 올리기 ───────── */
// 세부 과목 — 2022 개정. 학년에 따라 다르게 보여 준다
//   고1: 모두가 듣는 공통과목 · 고2: 국어·수학·영어에서 거의 다 듣는 일반선택 (사회·과학은 학생마다 달라 큰 과목으로만)
const DETAILS = {
  고1: {
    국어: ["공통국어1", "공통국어2"],
    수학: ["공통수학1", "공통수학2"],
    영어: ["공통영어1", "공통영어2"],
    사회탐구: ["통합사회1", "통합사회2", "한국사1", "한국사2"],
    과학탐구: ["통합과학1", "통합과학2"],
  },
  고2: {
    국어: ["문학", "독서와 작문", "화법과 언어"],
    수학: ["대수", "미적분Ⅰ", "확률과 통계"],
    영어: ["영어Ⅰ", "영어Ⅱ"],
  },
};
const POST_YEARS = ["고1", "고2"]; // 공부법은 고1·고2만 받는다
const EXAM_TYPES = [["school", "내신용"], ["mock", "모의고사용"]]; // 하나만 고른다 (예전 '둘 다'는 화면에서 뺌)
const examTypeLabel = (k) => ({ school: "내신용", mock: "모의고사용", both: "내신·모의" })[k] ?? "";

const FITS = ["개념이 약한", "문제 푸는 속도가 느린", "실수가 많은", "시간이 부족한", "기출이 약한", "암기가 약한"];
const STEP_MIN = 15;

function GradeRow({ value, onChange }) {
  return (
    <div className="mt-1.5 grid grid-cols-9 gap-1">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
        <button key={g} onClick={() => onChange(g)} className={`h-9 rounded-lg text-[14px] font-extrabold ${value === g ? "bg-[#1E2A5A] text-white" : "bg-[#F4F5F7] text-gray-600"}`}>{g}</button>
      ))}
    </div>
  );
}

function PostSheet({ open, me, subject: initSubject, onClose, onDone }) {
  const [subject, setSubject] = useState(initSubject);
  const [detail, setDetail] = useState("");
  const [examType, setExamType] = useState(null);
  const [year, setYear] = useState("고1");
  const [region, setRegion] = useState("");
  const [before, setBefore] = useState(null); // 이 방법 쓰기 전 등급
  const [grade, setGrade] = useState(null);   // 지금 등급 (인증 안 했을 때)
  const [materials, setMaterials] = useState("");
  const [steps, setSteps] = useState(["", "", ""]);
  const [dropped, setDropped] = useState("");
  const [fit, setFit] = useState([]);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setSubject(initSubject); setErr(""); } }, [open, initSubject]);
  if (!open) return null;
  const verified = me?.grades?.[subject];
  const nowGrade = verified ? verified.grade : grade;
  const stepsOk = steps.every((s) => s.trim().length >= STEP_MIN);
  // 아직 안 채운 칸 — 버튼에 무엇이 빠졌는지 바로 보여 준다
  const stepShort = steps.findIndex((s) => s.trim().length < STEP_MIN);
  const missing = !subject ? "과목을 골라 주세요"
    : !examType ? "내신용 · 모의고사용을 골라 주세요"
    : !before ? "이 방법을 쓰기 전 등급을 골라 주세요"
    : !nowGrade ? "지금 등급을 골라 주세요"
    : materials.trim().length < 2 ? "쓴 교재 · 강의를 2글자 이상 적어 주세요"
    : stepShort >= 0 ? `${"①②③"[stepShort]} 단계를 ${STEP_MIN}자 이상 써 주세요 (지금 ${steps[stepShort].trim().length}자)`
    : "";
  const ok = !missing && stepsOk;
  const toggleFit = (f) => setFit((x) => (x.includes(f) ? x.filter((y) => y !== f) : x.length >= 2 ? [x[1], f] : [...x, f]));

  const submit = async () => {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("study_post", {
      p_subject: subject, p_school_year: year, p_region: region || null, p_steps: steps.map((s) => s.trim()),
      p_hours: hours === "" ? null : Number(hours), p_note: note.trim() || null, p_grade: verified ? null : grade,
      p_grade_before: before, p_materials: materials.trim(), p_dropped: dropped.trim() || null, p_fit: fit,
      p_detail: detail.trim() || null, p_exam_type: examType,
    });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setSteps(["", "", ""]); setNote(""); setHours(""); setMaterials(""); setDropped(""); setFit([]); setBefore(null); setDetail(""); setExamType(null);
    onDone(data);
  };

  const field = "h-11 w-full rounded-xl border border-gray-200 px-3 text-[14px] outline-none focus:border-[#1E2A5A]";
  const label = (t, req) => <p className="mt-4 text-[13px] font-bold text-gray-700">{t}{req ? <span style={{ color: PINK }}> *</span> : <span className="font-medium text-gray-400"> (선택)</span>}</p>;
  return (
    <Sheet open onClose={onClose} title="내 공부법 올리기">
      <p className="text-[12.5px] text-gray-500">{BROWSE ? "누가 내 공부법을 열면 조각을 받아요. " : "도감이 열리면 내 공부법이 먼저 올라가요. "}학교 이름·실명·연락처는 쓰지 마세요. <span style={{ color: PINK }}>*</span>는 꼭 적어 주세요.</p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          {label("학년", true)}
          <div className="mt-1.5 flex gap-1.5">{POST_YEARS.map((y) => <Chip key={y} on={year === y} onClick={() => { setYear(y); setDetail(""); }}>{y}</Chip>)}</div>
        </div>
        <div>
          {label("지역", false)}
          <select value={region} onChange={(e) => setRegion(e.target.value)} className={`${field} mt-1.5 h-9`}>
            <option value="">안 밝힘</option>
            {(me?.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {label("과목", true)}
      <div className="mt-1.5 flex flex-wrap gap-2">{(me?.subjects ?? []).map((s) => <Chip key={s} on={subject === s} onClick={() => { setSubject(s); setDetail(""); }}>{s}</Chip>)}</div>

      {(DETAILS[year]?.[subject] ?? []).length > 0 && (
        <>
          {label("세부 과목", false)}
          <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-2xl bg-[#F8F9FB] p-3">
            {DETAILS[year][subject].map((d) => (
              <button key={d} onClick={() => setDetail(detail === d ? "" : d)}
                className={`h-8 rounded-full px-3 text-[12.5px] font-bold ${detail === d ? "bg-[#1E2A5A] text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}>{d}</button>
            ))}
          </div>
        </>
      )}

      {label("어떤 시험용 공부법이에요?", true)}
      <div className="mt-1.5 flex gap-2">
        {EXAM_TYPES.map(([k, l]) => <Chip key={k} on={examType === k} onClick={() => setExamType(k)}>{l}</Chip>)}
      </div>

      {/* 성적 변화 */}
      {label("성적 변화", true)}
      <div className="mt-1.5 rounded-2xl bg-[#F8F9FB] p-3">
        <p className="text-[12px] font-bold text-gray-500">이 방법을 쓰기 전 등급</p>
        <GradeRow value={before} onChange={setBefore} />
        <p className="mt-3 text-[12px] font-bold text-gray-500">지금 등급</p>
        {verified ? (
          <p className="mt-1.5 rounded-xl bg-[#E8F7EE] px-3 py-2.5 text-[13px] font-bold text-[#15803D]">✓ {verified.grade}등급 인증 ({verified.exam})</p>
        ) : (
          <>
            <GradeRow value={grade} onChange={setGrade} />
            <p className="mt-1 text-[11.5px] text-gray-500">'직접 적은 등급'으로 보여요. 모의고사로 인증하면 인증 배지가 붙어요.</p>
          </>
        )}
        {before && nowGrade && (
          <p className="mt-2 text-center text-[15px] font-extrabold" style={{ color: before > nowGrade ? PINK : NAVY }}>
            {before}등급 → {nowGrade}등급 {before > nowGrade ? `(${before - nowGrade}등급 올림!)` : before === nowGrade ? "(유지)" : ""}
          </p>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 40))} placeholder="언제 올랐어요? (예: 6월 모의 → 9월 모의)" className={`${field} mt-2 bg-white`} />
      </div>

      {label("쓴 교재 · 강의", true)}
      <p className="mt-0.5 text-[11.5px] text-gray-500">교재 이름이나 강의 이름을 <b>2글자 이상</b> 적어 주세요</p>
      <div className="relative">
        <input value={materials} onChange={(e) => setMaterials(e.target.value.slice(0, 80))} placeholder="예: 쎈, 마플 시너지, ○○ 선생님 인강" className={`${field} mt-1.5 pr-12`} />
        <span className={`absolute right-3 top-1/2 mt-[3px] -translate-y-1/2 text-[11px] font-bold ${materials.trim().length >= 2 ? "text-[#15803D]" : "text-gray-400"}`}>{materials.trim().length >= 2 ? "✓" : `${materials.trim().length}/2`}</span>
      </div>

      {label("내 방법 3단계", true)}
      <p className="mt-0.5 text-[11.5px] text-gray-500">단계마다 <b>무슨 교재로 · 하루 얼마나 · 언제</b>가 들어가게 {STEP_MIN}자 이상 써 주세요</p>
      {["① 처음에 (예: 개념원리 한 단원씩, 하루 1시간 예제만 손으로 다시 풀기)", "② 그다음 (예: 쎈 B단계 하루 15문제, 틀린 건 왜 틀렸는지 한 줄 적기)", "③ 시험 직전 (예: 시험 1주 전부터 단원별 공식을 백지에 유도해 보기)"].map((ph, i) => {
        const n = steps[i].trim().length;
        return (
          <div key={i} className="relative">
            <textarea value={steps[i]} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value.slice(0, 150) : x)))} rows={2} placeholder={ph}
              className="mt-2 w-full rounded-xl border border-gray-200 p-3 pb-6 text-[14px] leading-relaxed outline-none focus:border-[#1E2A5A]" />
            <span className={`absolute bottom-2.5 right-3 text-[11px] font-bold ${n >= STEP_MIN ? "text-[#15803D]" : "text-gray-400"}`}>{n >= STEP_MIN ? "✓" : `${n}/${STEP_MIN}`}</span>
          </div>
        );
      })}

      {label("해 봤는데 안 맞았던 방법", false)}
      <input value={dropped} onChange={(e) => setDropped(e.target.value.slice(0, 120))} placeholder="예: 인강 2배속으로 몰아 듣기는 남는 게 없었음" className={`${field} mt-1.5`} />

      {label("이런 친구에게 추천해요 (2개까지)", false)}
      <div className="mt-1.5 flex flex-wrap gap-2">
        {FITS.map((f) => <Chip key={f} on={fit.includes(f)} onClick={() => toggleFit(f)}>{f}</Chip>)}
      </div>

      {label("하루 공부 시간", false)}
      <input value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, "").slice(0, 4))} inputMode="decimal" placeholder="이 과목 하루 평균 몇 시간 (예: 2)" className={`${field} mt-1.5`} />

      {err && <p className="mt-3 text-[13px] font-semibold text-red-500">{err}</p>}
      <button onClick={submit} disabled={!ok || busy} className="mt-5 h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50" style={{ background: NAVY }}>
        {busy ? "올리는 중..." : ok ? "공부법 올리기" : missing}
      </button>
    </Sheet>
  );
}

/* ───────── 모의고사 인증 ───────── */
function VerifySheet({ open, user, me, intro, maxGrade = 2, phonePost, onPhoneDone, onClose, onDone }) {
  const [agree, setAgree] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setRes(null); setErr(""); setFile(null); } }, [open]);
  if (!open) return null;
  const pending = me?.verify?.status === "pending";

  const submit = async () => {
    if (!file || !agree || !user) return;
    setBusy(true);
    setErr("");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("study-verify").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (up.error) throw up.error;
      const { data, error } = await supabase.functions.invoke("study_verify", { body: { action: "verify", path } });
      if (error) {
        let m = error.message;
        try { const j = await error.context?.json(); if (j?.error) m = j.error; } catch {}
        throw new Error(m);
      }
      if (data?.error) throw new Error(data.error);
      setRes(data);
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="모의고사로 등급 인증">
      {res ? (
        <div className="text-center">
          <p className="text-[40px]">{res.status === "approved" ? "🎉" : res.status === "pending" ? "⏳" : "😢"}</p>
          <p className="mt-1 text-[17px] font-extrabold text-gray-900">
            {res.status === "approved" ? "인증됐어요!" : res.status === "pending" ? "확인하고 있어요" : "인증하지 못했어요"}
          </p>
          {res.status === "approved" && (
            <p className="mt-2 text-[13.5px] text-gray-600">{res.exam}<br />{Object.entries(res.grades || {}).map(([k, v]) => `${k} ${v}등급`).join(" · ")}</p>
          )}
          {res.status === "approved" && (intro ? !(Number(res.grades?.[intro.subject]) <= maxGrade) : !Object.values(res.grades || {}).some((v) => Number(v) <= maxGrade)) && (
            <p className="mt-3 rounded-xl bg-[#FFF0F5] px-3 py-2 text-[12.5px] font-bold leading-relaxed" style={{ color: PINK }}>
              다이소 쿠폰은 <b>1~{maxGrade}등급으로 인증된 과목</b>만 받을 수 있어요.<br />
              <span className="font-medium text-gray-600">공부법은 인증 배지와 함께 잘 올라갔어요.</span>
            </p>
          )}
          {res.status === "approved" && phonePost && (
            <div className="mt-4 rounded-2xl p-4 ring-2" style={{ background: "#FFF7FA", "--tw-ring-color": PINK }}>
              <p className="mb-2 text-left text-[16px] font-extrabold" style={{ color: PINK }}>🎁 마지막! 쿠폰 받을 휴대폰 번호</p>
              <PhoneForm postId={phonePost} onDone={onPhoneDone} onLater={onClose} />
            </div>
          )}
          {res.status === "pending" && <p className="mt-2 text-[13px] text-gray-600">사진이 조금 애매해서 관리자가 직접 확인해요. 보통 하루 안에 끝나요.</p>}
          {res.status === "rejected" && <p className="mt-2 text-[13px] text-gray-600">{res.reason}</p>}
          <p className="mt-3 text-[11.5px] text-gray-400">{res.status === "pending" ? "확인이 끝나면 사진은 바로 지워져요" : "올린 사진은 지웠어요. 등급 숫자만 남아요"}</p>
          {!(res.status === "approved" && phonePost) && <button onClick={onClose} className="mt-4 h-11 w-full rounded-xl bg-gray-900 text-[14px] font-bold text-white">확인</button>}
        </div>
      ) : pending ? (
        <p className="py-6 text-center text-[13.5px] text-gray-600">확인 중인 인증이 있어요. 끝나면 알려 드릴게요.</p>
      ) : (
        <>
          {intro && (
            <div className="mb-3 rounded-xl px-3 py-2.5 text-[13px] font-bold leading-relaxed" style={{ background: "#FFF0F5", color: PINK }}>
              ✓ 공부법을 올렸어요! 마지막 단계예요.<br />
              <span className="text-gray-700">{intro.subject} 등급이 보이는 모의고사 성적표를 올리면 다이소 쿠폰 대상이 돼요.</span>
            </div>
          )}
          {me?.verify?.status === "rejected" && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-600">지난 인증: {me.verify.reason}</p>}
          <div className="rounded-xl bg-[#F4F5F7] p-3 text-[12.5px] leading-relaxed text-gray-600">
            <b className="text-gray-900">이렇게 올려 주세요</b><br />
            · 최근 1년 안에 본 <b>학력평가 · 모의평가</b> 개인 성적표 (사진이나 성적 확인 화면 캡처)<br />
            · <b style={{ color: PINK }}>이름 · 학교 · 수험번호는 가리고</b> 찍어 주세요<br />
            · 학교 내신 성적표 · 생활기록부는 받지 않아요
          </div>
          <label className="mt-3 flex h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-white text-center">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="text-[26px]">📄</span>
            <span className="text-[13px] font-bold text-gray-600">{file ? file.name : "성적표 사진 고르기"}</span>
          </label>
          <label className="mt-3 flex items-start gap-2 text-[12.5px] leading-relaxed text-gray-600">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            <span>등급 인증을 위해 성적표 사진을 확인하는 데 동의해요. 확인이 끝나면 사진은 바로 지우고 <b>과목 등급과 시험 이름만</b> 남겨요.</span>
          </label>
          {err && <p className="mt-3 text-[13px] font-semibold text-red-500">{err}</p>}
          <button onClick={submit} disabled={!file || !agree || busy} className="mt-4 h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50" style={{ background: PINK }}>
            {busy ? "성적표를 읽는 중... (20초쯤)" : "인증하기"}
          </button>
        </>
      )}
    </Sheet>
  );
}

/* ───────── 이용권 (계좌이체) ───────── */
function PassSheet({ open, subject, me, onClose, onDone }) {
  const [which, setWhich] = useState("one"); // one · all
  const [dep, setDep] = useState("");
  const [usePieces, setUsePieces] = useState(false);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const product = which === "all" ? "studyall" : "study1";

  useEffect(() => {
    if (!open) return;
    supabase.rpc("pay_quote", { p_product: product, p_pieces: usePieces ? 99999 : 0, p_coupon: null }).then(({ data }) => setQuote(data));
  }, [open, product, usePieces]);
  if (!open) return null;
  const pend = (me?.pending_orders ?? []).find((o) => o.subject === (which === "all" ? "*" : subject));

  const submit = async () => {
    setBusy(true);
    setErr("");
    const { error } = await supabase.rpc("study_pass_order", { p_subject: which === "all" ? "*" : subject, p_depositor: dep.trim(), p_pieces: usePieces ? quote?.pieces ?? 0 : 0 });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    onDone();
  };

  return (
    <Sheet open onClose={onClose} title="한 단계 위 공부법, 다 열어 보기">
      <p className="text-[12.5px] text-gray-500">이용권이 있으면 모든 등급 공부법을 30일 동안 볼 수 있어요. 열어 볼 때마다 올린 학생에게 조각이 가요.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[["one", `${subject}만`, PRICE.one], ["all", "전 과목", PRICE.all]].map(([k, l, pr]) => (
          <button key={k} onClick={() => setWhich(k)} className={`rounded-2xl p-3 text-left ${which === k ? "ring-[3px]" : "ring-1 ring-gray-200"}`} style={which === k ? { "--tw-ring-color": PINK } : undefined}>
            <p className="text-[13px] font-bold text-gray-600">{l} · 30일</p>
            <p className="mt-0.5 text-[19px] font-extrabold text-gray-900">{won(pr)}</p>
          </button>
        ))}
      </div>

      {pend ? (
        <p className="mt-4 rounded-xl bg-[#FFF7ED] px-3 py-3 text-[13px] font-bold text-[#C2410C]">입금 확인 중이에요 ({won(pend.amount)} · {pend.depositor}). 확인되면 바로 열려요.</p>
      ) : (
        <>
          {quote?.max_pieces > 0 && (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-gray-700">
              <input type="checkbox" checked={usePieces} onChange={(e) => setUsePieces(e.target.checked)} />
              조각 {quote.max_pieces}개 써서 {won(quote.max_pieces * 50)} 할인 (최대 25%)
            </label>
          )}
          <div className="mt-3 rounded-xl bg-[#F4F5F7] p-3 text-[13px]">
            <div className="flex justify-between"><span className="text-gray-500">입금할 금액</span><b className="text-[16px] text-gray-900">{won(quote?.total ?? (which === "all" ? PRICE.all : PRICE.one))}</b></div>
            <div className="mt-1.5 flex justify-between"><span className="text-gray-500">은행</span><b>{BANK.name}</b></div>
            <div className="mt-1 flex justify-between"><span className="text-gray-500">계좌번호</span>
              <button onClick={() => navigator.clipboard?.writeText(BANK.number.replace(/-/g, ""))} className="font-bold underline">{BANK.number} 복사</button></div>
            <div className="mt-1 flex justify-between"><span className="text-gray-500">예금주</span><b>{BANK.holder}</b></div>
          </div>
          <input value={dep} onChange={(e) => setDep(e.target.value.slice(0, 20))} placeholder="입금자명"
            className="mt-3 h-11 w-full rounded-xl border border-gray-200 px-3 text-[14px] outline-none focus:border-[#1E2A5A]" />
          {err && <p className="mt-2 text-[13px] font-semibold text-red-500">{err}</p>}
          <button onClick={submit} disabled={dep.trim().length < 2 || busy} className="mt-3 h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50" style={{ background: PINK }}>
            {busy ? "접수 중..." : "입금했어요"}
          </button>
        </>
      )}
    </Sheet>
  );
}

/* ───────── 관리자: 인증 확인 ───────── */
function AdminVerify({ toast }) {
  const [rows, setRows] = useState(null);
  const [img, setImg] = useState({});
  const [edit, setEdit] = useState({});
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("study_admin_pending");
    setRows(error ? [] : data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const fn = async (body) => {
    const { data, error } = await supabase.functions.invoke("study_verify", { body });
    if (error || data?.error) { toast(data?.error || "실패했어요"); return null; }
    return data;
  };

  if (rows === null) return <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중...</p>;
  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-[15px] font-extrabold text-gray-900">확인할 것 <span style={{ color: PINK }}>{rows.length}건</span>
        <span className="ml-2 text-[12px] font-medium text-gray-500">AI가 애매하다고 넘긴 성적표 · 사진을 보고 승인 또는 반려해 주세요</span></p>
      {!rows.length && <p className="rounded-2xl bg-white py-6 text-center text-[13px] text-gray-500">지금 확인할 성적표는 없어요</p>}
      {rows.map((r) => {
        const g = edit[r.id] ?? r.grades ?? {};
        return (
          <div key={r.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
            <p className="text-[14px] font-extrabold text-gray-900">{r.nick} · {r.exam || "시험 이름 못 읽음"}</p>
            <p className="mt-1 text-[12px] text-gray-500">AI: {r.ai?.note} · 확신 {Math.round((r.ai?.confidence ?? 0) * 100)}%{r.ai?.edited_suspect ? " · ⚠️ 조작 의심" : ""}{r.ai?.name_visible ? " · 이름 보임" : ""}</p>
            {img[r.id] ? (
              <img src={img[r.id]} alt="성적표" className="mt-2 max-h-[420px] w-full rounded-xl object-contain ring-1 ring-gray-200" />
            ) : (
              <button onClick={async () => { const d = await fn({ action: "image", id: r.id }); if (d?.url) setImg({ ...img, [r.id]: d.url }); }}
                className="mt-2 h-9 rounded-lg bg-[#F4F5F7] px-3 text-[12.5px] font-bold text-gray-700">사진 보기</button>
            )}
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {["국어", "수학", "영어", "사회탐구", "과학탐구"].map((k) => (
                <label key={k} className="text-center text-[11px] text-gray-500">{k}
                  <input value={g[k] ?? ""} onChange={(e) => setEdit({ ...edit, [r.id]: { ...g, [k]: e.target.value.replace(/[^1-9]/g, "").slice(0, 1) } })}
                    className="mt-0.5 h-9 w-full rounded-lg border border-gray-200 text-center text-[14px] font-bold" />
                </label>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={async () => {
                const grades = Object.fromEntries(Object.entries(g).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, Number(v)]));
                if (await fn({ action: "decide", id: r.id, approve: true, grades })) { toast("인증했어요"); load(); }
              }} className="h-10 flex-1 rounded-xl text-[13.5px] font-extrabold text-white" style={{ background: NAVY }}>승인</button>
              <button onClick={async () => {
                const reason = window.prompt("반려 이유 (학생에게 보여요)", "모의고사 성적표인지 확인할 수 없었어요");
                if (reason == null) return;
                if (await fn({ action: "decide", id: r.id, approve: false, reason })) { toast("반려했어요"); load(); }
              }} className="h-10 flex-1 rounded-xl bg-[#F4F5F7] text-[13.5px] font-extrabold text-gray-700">반려</button>
            </div>
          </div>
        );
      })}
      <VerifyHistory key={rows.length} />
    </div>
  );
}

/* 모의고사 인증 전체 기록 — 통과 · 반려 · 확인 중, 과목별 등급, 누가 판단했는지 */
const VSTATUS = { approved: ["통과", "#15803D", "#E8F7EE"], rejected: ["반려", "#DC2626", "#FEF2F2"], pending: ["확인 중", "#B45309", "#FFF7ED"] };
const REWARD_L = { pending: "쿠폰 확인 중", approved: "쿠폰 보낼 차례", sent: "쿠폰 보냄", rejected: "쿠폰 반려" };
function VerifyHistory() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    supabase.rpc("study_admin_verifications").then(({ data, error }) => (error ? setErr(error.message) : setRows(data ?? [])));
  }, []);
  return (
    <div className="mt-4">
      <p className="text-[15px] font-extrabold text-gray-900">인증 기록 <span className="text-[12px] font-medium text-gray-500">최근 100건</span></p>
      {err ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] font-bold text-red-600">불러오지 못했어요 · {err} (sm_59 SQL을 실행했는지 확인해 주세요)</p>
        : rows === null ? <p className="py-6 text-center text-[13px] text-gray-400">불러오는 중...</p>
        : !rows.length ? <p className="mt-2 rounded-2xl bg-white py-6 text-center text-[13px] text-gray-500">아직 인증한 학생이 없어요</p>
        : (
        <div className="mt-2 flex flex-col gap-2">
          {rows.map((r) => {
            const [sl, sc, sb] = VSTATUS[r.status] ?? [r.status, "#374151", "#F3F4F6"];
            return (
              <div key={r.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="rounded-md px-2 py-0.5 text-[12px] font-extrabold" style={{ color: sc, background: sb }}>{sl}</span>
                  <b className="text-gray-900">{r.nick}</b>
                  <span className="text-gray-600">{r.exam || "시험 이름 못 읽음"}</span>
                  {r.by && <span className="text-[12px] text-gray-400">· {r.by}</span>}
                  <span className="ml-auto text-[12px] text-gray-400">{new Date(r.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(r.grades ?? {}).length ? Object.entries(r.grades).map(([k, v]) => (
                    <span key={k} className="rounded-lg bg-[#F4F5F7] px-2.5 py-1 text-[12.5px] font-bold text-gray-800">{k} <span style={{ color: Number(v) <= 3 ? PINK : NAVY }}>{v}등급</span></span>
                  )) : <span className="text-[12.5px] text-gray-400">읽은 등급 없음</span>}
                </div>
                {r.reason && <p className="mt-2 text-[12.5px] text-red-600">반려 이유 · {r.reason}</p>}
                {r.note && <p className="mt-1 text-[12px] text-gray-400">AI 메모 · {r.note}{r.confidence != null ? ` (확신 ${Math.round(Number(r.confidence) * 100)}%)` : ""}</p>}
                {r.posts?.length > 0 && (
                  <div className="mt-2 border-t border-gray-100 pt-2 text-[12.5px] text-gray-600">
                    <b className="text-gray-500">올린 공부법</b>{" "}
                    {r.posts.map((p, i) => (
                      <span key={i} className="mr-2">
                        {p.detail || p.subject} {p.grade}등급{p.verified ? " ✓" : ""}{p.reward ? ` · ${REWARD_L[p.reward] ?? p.reward}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────── 쿠폰 받을 번호 ───────── */
function PhoneSheet({ postId, onClose, onDone }) {
  if (!postId) return null;
  return (
    <Sheet open onClose={onClose} title="🎁 쿠폰 받을 번호">
      <PhoneForm postId={postId} onDone={onDone} onLater={onClose} />
    </Sheet>
  );
}

/* 쿠폰 받을 번호 적기 — 번호 창과 인증 결과 화면이 같이 쓴다 */
function PhoneForm({ postId, onDone, onLater }) {
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false); // 필수: 쿠폰 발송용
  const [keep, setKeep] = useState(false);   // 선택: 연락용 1년 보관
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setErr(""); }, [postId]);
  const digits = phone.replace(/[^0-9]/g, "");
  const save = async () => {
    setBusy(true);
    setErr("");
    const { error } = await supabase.rpc("study_reward_phone", { p_post: postId, p_phone: digits, p_keep: keep });
    setBusy(false);
    if (error) return setErr(errMsg(error));
    setPhone("");
    onDone();
  };
  return (
    <div className="text-left">
      <p className="text-[13px] leading-relaxed text-gray-600">이 공부법은 <b>다이소 1,000원 쿠폰</b> 대상이에요. 확인이 끝나면 이 번호로 모바일 쿠폰을 보내 드려요.</p>
      <input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 13))} inputMode="tel" placeholder="010-0000-0000"
        className="mt-3 h-12 w-full rounded-xl border border-gray-200 px-3 text-[16px] tracking-wide outline-none focus:border-[#1E2A5A]" />
      <div className="mt-3 flex flex-col gap-2 rounded-xl bg-[#F8F9FB] p-3 text-[12.5px] leading-relaxed text-gray-700">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
          <span><b style={{ color: PINK }}>[필수]</b> 쿠폰을 보내려고 휴대폰 번호를 받는 데 동의해요. 쿠폰을 보내면 바로 지워요.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="mt-1" />
          <span><b className="text-gray-500">[선택]</b> 생수면 새 소식·이벤트를 받으려고 번호를 <b>1년 동안</b> 보관하는 데 동의해요. 언제든 끌 수 있어요.</span>
        </label>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-gray-500">번호는 생수면 관리자만 보고, <b>다른 회사나 사람(제3자)에게 주지 않아요.</b> 쿠폰은 관리자가 카카오 선물하기로 보내요.</p>
      {err && <p className="mt-2 text-[13px] font-semibold text-red-500">{err}</p>}
      <button onClick={save} disabled={busy || !agree || !/^01[016789][0-9]{7,8}$/.test(digits)} className="mt-3 h-12 w-full rounded-xl text-[15px] font-extrabold text-white disabled:opacity-50" style={{ background: PINK }}>
        {busy ? "저장 중..." : "이 번호로 쿠폰 받을게요"}
      </button>
      <button onClick={onLater} className="mx-auto mt-2 block text-[12px] text-gray-400 underline">나중에 적을게요</button>
    </div>
  );
}

/* ───────── 관리자 페이지(/admin '공부' 묶음)에서 쓰는 인증 · 쿠폰 ───────── */
export function StudyAdminBox({ which }) {
  const [toastNode, toast] = useToast();
  return (
    <div className="max-w-3xl">
      {which === "verify" ? <AdminVerify toast={toast} /> : <AdminReward toast={toast} onChange={() => {}} />}
      {toastNode}
    </div>
  );
}

/* ───────── 관리자: 다이소 쿠폰 보상 ───────── */
function AdminReward({ toast, onChange }) {
  const [d, setD] = useState(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("study_admin_rewards");
    setD(error ? { rows: [] } : data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (id, approve) => {
    let reason = null;
    if (!approve) {
      reason = window.prompt("반려 이유 (학생에게 보여요)", "단계마다 교재·순서·시간을 더 구체적으로 적어 주세요");
      if (reason == null) return;
    }
    const { error } = await supabase.rpc("study_admin_reward", { p_post: id, p_approve: approve, p_reason: reason });
    if (error) return toast(errMsg(error));
    toast(approve ? "승인했어요. 쿠폰을 보내 주세요" : "반려했어요");
    load();
    onChange?.();
  };
  const sent = async (id) => {
    if (!window.confirm("다이소 쿠폰을 보냈나요? 보냄으로 바꾸면 번호가 지워져요.")) return;
    const { error } = await supabase.rpc("study_admin_reward_sent", { p_post: id });
    if (error) return toast(errMsg(error));
    toast("보냄 처리했어요. 번호를 지웠어요");
    load();
    onChange?.();
  };
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast("번호를 복사했어요"));
  const [contacts, setContacts] = useState(null);
  const [showContacts, setShowContacts] = useState(false);
  useEffect(() => {
    supabase.rpc("study_contacts_cleanup").then(() => supabase.rpc("study_admin_contacts")).then(({ data }) => setContacts(data ?? []));
  }, []);
  const fmt = (p) => String(p).replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
  if (!d) return <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중...</p>;
  const todo = d.rows.filter((r) => r.status === "approved");
  const wait = d.rows.filter((r) => r.status === "pending");
  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="rounded-2xl bg-white px-4 py-3 text-[13px] text-gray-600 ring-1 ring-black/5">
        보냄 {d.sent ?? 0}명 · 보낼 차례 {todo.length} · 확인할 것 {wait.length} · 남은 자리 {d.left ?? 0}
      </p>

      <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-gray-600">📱 연락 동의 (1년 보관) <b className="text-gray-900">{contacts?.length ?? 0}명</b> · 제3자 제공 안 함</p>
          <div className="flex gap-2">
            <button onClick={() => setShowContacts(!showContacts)} className="text-[12px] font-bold text-gray-500 underline">{showContacts ? "접기" : "보기"}</button>
            {contacts?.length > 0 && <button onClick={() => copy(contacts.map((c) => fmt(c.phone)).join("\n"))} className="text-[12px] font-bold underline" style={{ color: NAVY }}>번호 전체 복사</button>}
          </div>
        </div>
        {showContacts && (
          <div className="mt-2 max-h-60 overflow-y-auto border-t border-gray-100 pt-2">
            {(contacts ?? []).map((c, i) => (
              <p key={i} className="flex justify-between py-1 text-[12.5px] text-gray-700">
                <span>{c.nick}</span><span className="font-bold">{fmt(c.phone)}</span><span className="text-gray-400">~{String(c.until).slice(0, 10)}</span>
              </p>
            ))}
            {(contacts ?? []).length === 0 && <p className="py-2 text-[12.5px] text-gray-400">아직 동의한 사람이 없어요</p>}
          </div>
        )}
      </div>

      {todo.length > 0 && <p className="mt-1 text-[13px] font-extrabold text-gray-900">🎁 쿠폰 보낼 차례</p>}
      {todo.map((r) => (
        <div key={r.post_id} className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-extrabold text-gray-900">{r.nick} · {r.subject} {r.grade}등급</p>
            {r.phone ? (
              <button onClick={() => copy(r.phone)} className="mt-0.5 text-[15px] font-extrabold tracking-wide underline" style={{ color: NAVY }}>
                {r.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3")}
              </button>
            ) : (
              <p className="mt-0.5 text-[12.5px] text-gray-400">학생이 아직 번호를 안 적었어요</p>
            )}
          </div>
          <button disabled={!r.phone} onClick={() => sent(r.post_id)} className="h-10 flex-none rounded-xl px-3 text-[13px] font-extrabold text-white disabled:opacity-40" style={{ background: PINK }}>쿠폰 보냈어요</button>
        </div>
      ))}

      {wait.length > 0 && <p className="mt-1 text-[13px] font-extrabold text-gray-900">공부법 확인</p>}
      {d.rows.length === 0 && <p className="rounded-2xl bg-white py-10 text-center text-[13px] text-gray-500">확인할 보상이 없어요</p>}
      {wait.map((r) => (
        <div key={r.post_id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
          <p className="text-[13.5px] font-extrabold text-gray-900">{r.nick} · {r.subject}{r.detail ? `(${r.detail})` : ""} {r.grade_before ? `${r.grade_before}등급 → ` : ""}{r.grade}등급 인증{r.exam_type ? ` · ${examTypeLabel(r.exam_type)}` : ""} · {r.school_year}{r.phone ? " · 번호 있음" : " · 번호 아직"}</p>
          {r.materials && <p className="mt-1 text-[12.5px] text-gray-600"><b>교재·강의</b> {r.materials}</p>}
          <ol className="mt-2 flex flex-col gap-1 text-[14px] leading-relaxed text-gray-800">
            {(r.steps || []).map((t, i) => <li key={i}><b>{i + 1}.</b> {t}</li>)}
          </ol>
          {r.dropped && <p className="mt-1 text-[12.5px] text-gray-600"><b className="text-red-500">안 맞았던 방법</b> {r.dropped}</p>}
          {(r.hours != null || r.note || r.fit?.length > 0) && <p className="mt-1 text-[12px] text-gray-500">{r.hours != null && `하루 ${Number(r.hours)}시간 `}{r.note && `· ${r.note} `}{r.fit?.length > 0 && `· ${r.fit.join(", ")} 친구에게`}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => decide(r.post_id, true)} className="h-10 flex-1 rounded-xl text-[13.5px] font-extrabold text-white" style={{ background: NAVY }}>승인</button>
            <button onClick={() => decide(r.post_id, false)} className="h-10 flex-1 rounded-xl bg-[#F4F5F7] text-[13.5px] font-extrabold text-gray-700">반려</button>
          </div>
        </div>
      ))}
    </div>
  );
}