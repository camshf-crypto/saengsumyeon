import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";

/*
 * 닉네임 — 물결 댓글과 마이페이지에서 같이 쓴다
 * · 처음 댓글을 쓸 때 NicknameModal 팝업에서 직접 정한다
 * · 같은 닉네임은 한 명만 (대소문자 구분 없이) — 서버에서 막는다
 * · 한 번 정하면 7일에 한 번만 바꿀 수 있다
 */
const RULE = /^[가-힣A-Za-z0-9]{2,10}$/;
const RULE_MSG = "한글·영어·숫자 2~10자로 써 줘 (띄어쓰기·기호 안 돼)";

const until = (t) => {
  if (!t) return null;
  const d = new Date(t);
  return d > new Date() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : null;
};

/* 추천 닉네임 — 고르기 쉽게 몇 개 보여준다 (중복 여부는 저장할 때 서버가 확인) */
const ADJ = ["푸른", "맑은", "잔잔한", "반짝", "시원한", "작은", "깊은", "졸린", "신난", "느긋한"];
const NOUN = ["물방울", "파도", "물결", "조약돌", "바다", "시냇물", "물개", "모래알", "소라", "윤슬"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const suggest = () =>
  Array.from({ length: 3 }, () => `${pick(ADJ)}${pick(NOUN)}${100 + Math.floor(Math.random() * 900)}`);

/* 내 닉네임 상태 — { nickname, is_auto, can_change_at } · 아직 없으면 nickname이 null */
export async function fetchNickname() {
  const { data, error } = await supabase.rpc("mulgyeol_get_nickname");
  if (error) {
    console.warn("nickname failed", error);
    return null;
  }
  return data;
}

/* 닉네임이 정해지거나 바뀌면 헤더 등 다른 화면에 알린다 */
export const NICK_EVENT = "sm:nickname";
export function announceNickname(nickname) {
  window.dispatchEvent(new CustomEvent(NICK_EVENT, { detail: nickname }));
}

/* 아직 직접 정한 닉네임이 없으면 true */
export const needsNickname = (info) => !info?.nickname || info.is_auto;

/* 처음 댓글을 쓸 때 뜨는 팝업 */
export function NicknameModal({ onDone, onClose }) {
  const [value, setValue] = useState("");
  const [ideas, setIdeas] = useState(suggest);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const v = value.trim();
    if (!RULE.test(v)) return setErr(RULE_MSG);
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("mulgyeol_set_nickname", { p_nickname: v });
    setBusy(false);
    if (error) return setErr(error.message || "정하지 못했어. 다시 해줘");
    announceNickname(data.nickname);
    onDone(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-[17px] font-extrabold text-[#10262F]">닉네임을 정해줘</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-500">
          댓글에 이름 대신 보이는 이름이야. 같은 닉네임은 한 명만 쓸 수 있어.
        </p>

        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value.slice(0, 10));
            setErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoFocus
          placeholder="닉네임 (2~10자)"
          className="mt-4 h-12 w-full rounded-xl border border-[#D3DFE5] px-4 text-[15px] outline-none focus:border-[#1A5E9A]"
        />
        <p className={`mt-1.5 text-[12.5px] ${err ? "font-bold text-red-500" : "text-gray-400"}`}>
          {err || "한글·영어·숫자 2~10자 · 정하면 7일 동안 못 바꿔"}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-gray-400">이건 어때?</span>
          {ideas.map((n) => (
            <button
              key={n}
              onClick={() => {
                setValue(n);
                setErr("");
              }}
              className="rounded-full bg-[#E4EFF8] px-3 py-1 text-[12.5px] font-bold text-[#1A5E9A]"
            >
              {n}
            </button>
          ))}
          <button onClick={() => setIdeas(suggest())} className="px-1 text-[12px] text-gray-400 underline-offset-2 hover:underline">
            다른 거
          </button>
        </div>

        <div className="mt-5 grid grid-cols-[1fr_2fr] gap-2">
          <button onClick={onClose} className="h-12 rounded-xl border border-[#D3DFE5] text-[14.5px] font-bold text-gray-500">
            취소
          </button>
          <button
            onClick={save}
            disabled={busy || !value.trim()}
            className="h-12 rounded-xl bg-[#1A5E9A] text-[14.5px] font-bold text-white disabled:opacity-40"
          >
            {busy ? "확인 중…" : "이 닉네임으로 정하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* 닉네임 보기·바꾸기 — compact는 물결 댓글 입력칸 위, 기본은 마이페이지 카드 */
export default function NicknameEditor({ compact = false, onChange }) {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [first, setFirst] = useState(false); // 처음 정하기 팝업
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchNickname().then((d) => {
      setInfo(d);
      setLoaded(true);
    });
  }, [user]);

  if (!user || !loaded) return null;

  const none = needsNickname(info);
  const lockedUntil = none ? null : until(info.can_change_at);

  function start() {
    setValue(info.nickname);
    setErr("");
    setEditing(true);
  }

  async function save() {
    const v = value.trim();
    if (!RULE.test(v)) return setErr(RULE_MSG);
    setBusy(true);
    setErr("");
    const { data, error } = await supabase.rpc("mulgyeol_set_nickname", { p_nickname: v });
    setBusy(false);
    if (error) return setErr(error.message || "바꾸지 못했어");
    announceNickname(data.nickname);
    setInfo(data);
    setEditing(false);
    onChange?.(data.nickname);
  }

  function done(d) {
    setInfo(d);
    setFirst(false);
    onChange?.(d.nickname);
  }

  const form = (
    <div className={compact ? "mt-1" : "mt-3"}>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 10))}
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoFocus
          placeholder="새 닉네임"
          className="h-10 min-w-0 flex-1 rounded-lg border border-[#D3DFE5] px-3 text-[14px] outline-none focus:border-[#1A5E9A]"
        />
        <button
          onClick={save}
          disabled={busy}
          className="h-10 shrink-0 rounded-lg bg-[#1A5E9A] px-4 text-[13.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "…" : "저장"}
        </button>
        <button onClick={() => setEditing(false)} className="h-10 shrink-0 px-2 text-[13px] text-gray-500">
          취소
        </button>
      </div>
      <p className={`mt-1 text-[12px] ${err ? "font-bold text-red-500" : "text-gray-400"}`}>
        {err || "한글·영어·숫자 2~10자 · 바꾸면 7일 동안 다시 못 바꿔"}
      </p>
    </div>
  );

  // 물결 댓글 입력칸 위 — 닉네임이 없으면 아무것도 안 보인다 (처음 남길 때 팝업이 뜬다)
  if (compact) {
    if (none) return null;
    return (
      <div className="mb-2 text-[12.5px] text-gray-500">
        {!editing ? (
          <p>
            <b className="text-[#10262F]">{info.nickname}</b>로 남겨져
            {lockedUntil ? (
              <span className="text-gray-400"> · {lockedUntil}부터 바꿀 수 있어</span>
            ) : (
              <button onClick={start} className="ml-1.5 font-bold text-[#1A5E9A] underline-offset-2 hover:underline">
                바꾸기
              </button>
            )}
          </p>
        ) : (
          form
        )}
      </div>
    );
  }

  // 마이페이지
  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-gray-500">닉네임</p>
          <p className={`mt-1 text-lg font-extrabold ${none ? "text-gray-300" : "text-[#10262F]"}`}>
            {none ? "아직 없어요" : info.nickname}
          </p>
        </div>
        {!editing &&
          (none ? (
            <button onClick={() => setFirst(true)} className="shrink-0 rounded-lg bg-[#1A5E9A] px-3.5 py-2 text-[13.5px] font-bold text-white">
              정하기
            </button>
          ) : lockedUntil ? (
            <span className="text-right text-[12.5px] text-gray-400">
              {lockedUntil}부터
              <br />
              바꿀 수 있어요
            </span>
          ) : (
            <button onClick={start} className="shrink-0 rounded-lg border border-gray-300 px-3.5 py-2 text-[13.5px] font-bold text-gray-600">
              바꾸기
            </button>
          ))}
      </div>
      {editing && form}
      {first && <NicknameModal onDone={done} onClose={() => setFirst(false)} />}
    </div>
  );
}