import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { track } from "../../lib/track";
import { announceNickname, uploadAvatar } from "../../components/NicknameEditor";
import SchoolPicker, { schoolData } from "../../components/SchoolPicker";

const GRADES = ["고1", "고2", "고3"];

// 닉네임 규칙 — 서버(mulgyeol_nickname_check · mulgyeol_set_nickname)와 같은 규칙
const NICK_RULE = /^[가-힣A-Za-z0-9]{2,10}$/;
const ADJ = ["푸른", "맑은", "잔잔한", "반짝", "시원한", "작은", "깊은", "졸린", "신난", "느긋한"];
const NOUN = ["물방울", "파도", "물결", "조약돌", "바다", "시냇물", "물개", "모래알", "소라", "윤슬"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const suggest = () => {
    // 숫자는 붙여도 안 붙여도 된다 — 추천은 숫자 없는 것 2개 + 숫자 붙은 것 1개
    const out = new Set();
    while (out.size < 2) out.add(`${pick(ADJ)}${pick(NOUN)}`);
    out.add(`${pick(ADJ)}${pick(NOUN)}${100 + Math.floor(Math.random() * 900)}`);
    return [...out];
  };

// 체크박스 — 색 채우지 않고 흰 네모에 V 표시만
function Check({ checked, onChange }) {
  return (
    <span className="relative inline-flex h-[18px] w-[18px] flex-none items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="absolute inset-0 m-0 cursor-pointer appearance-none rounded border border-gray-400 bg-white"
      />
      {checked && (
        <svg className="pointer-events-none relative" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  );
}

// 구글·카카오 로그인 뒤 처음 온 사람에게 이름·닉네임·학년·약관 동의를 받는 화면
// 로그인 안 한 채로 들어오면 로그인 화면으로 보낸다
export default function Signup() {
  const nav = useNavigate();
  const { state } = useLocation(); // 결과 화면에서 넘어온 진단 정보

  const [email, setEmail] = useState("");
  const [uid, setUid] = useState(null);
  const [photo, setPhoto] = useState(null); // 고른 사진 미리보기
  const [file, setFile] = useState(null); // 고른 사진 — 닉네임을 저장한 뒤 올린다
  const [photoMsg, setPhotoMsg] = useState("");
  const [f, setF] = useState({ name: "", nickname: "", grade: state?.grade ?? "고3" });
  const [school, setSchool] = useState(null); // 학교 { name, code, region }
  const [agree, setAgree] = useState({ terms: false, privacy: false, marketing: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // 닉네임 확인 — idle | checking | ok | bad
  const [nick, setNick] = useState({ status: "idle", msg: "" });
  const [ideas, setIdeas] = useState(suggest);
  const checkId = useRef(0);

  // 진단을 하다 온 경우엔 결과로, 아니면 첫 화면으로
  function goBack() {
    if (state?.topic) nav("/result", { state, replace: true });
    else nav("/", { replace: true });
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;

      // 로그인 전이면 로그인부터
      if (!user) {
        nav("/login", { state, replace: true });
        return;
      }

      const meta = user.user_metadata ?? {};

      // 이미 마무리한 사람은 바로 돌려보낸다
      if (meta.agreed_at || meta.grade) {
        goBack();
        return;
      }

      setEmail(user.email ?? "");
      setUid(user.id);
      setF((prev) => ({ ...prev, name: meta.full_name || meta.name || "" }));
      setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 닉네임을 입력하면 0.4초 뒤 서버에 중복·규칙을 물어본다
  useEffect(() => {
    const v = f.nickname.trim();
    if (!v) {
      setNick({ status: "idle", msg: "" });
      return;
    }
    if (!NICK_RULE.test(v)) {
      setNick({ status: "bad", msg: "한글·영어·숫자 2~10자로 써 주세요 (띄어쓰기·기호 안 돼요)" });
      return;
    }
    const my = ++checkId.current;
    setNick({ status: "checking", msg: "확인 중…" });
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("mulgyeol_nickname_check", { p_nickname: v });
      if (my !== checkId.current) return; // 그사이 다시 입력했으면 버린다
      if (error) setNick({ status: "idle", msg: "" });
      else if (data?.ok) setNick({ status: "ok", msg: "사용할 수 있어요" });
      else setNick({ status: "bad", msg: data?.reason || "쓸 수 없는 닉네임이에요" });
    }, 400);
    return () => clearTimeout(t);
  }, [f.nickname]);

  function pickPhoto(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    if (!picked.type.startsWith("image/")) return setPhotoMsg("사진 파일만 올릴 수 있어요");
    setFile(picked);
    setPhoto(URL.createObjectURL(picked));
    setPhotoMsg("");
  }

  const allChecked = agree.terms && agree.privacy && agree.marketing;

  function toggleAll() {
    const v = !allChecked;
    setAgree({ terms: v, privacy: v, marketing: v });
  }

  async function submit() {
    const nickname = f.nickname.trim();
    if (!f.name.trim()) return setErr("이름을 입력해 주세요.");
    if (!nickname) return setErr("닉네임을 정해 주세요.");
    if (nick.status === "bad") return setErr(nick.msg);
    if (!school) return setErr("학교를 골라 주세요. 목록에 없으면 '직접 입력'을 눌러요.");
    if (!agree.terms || !agree.privacy) return setErr("필수 약관에 동의해 주세요.");

    setBusy(true);
    setErr("");

    // 1) 닉네임 먼저 — 중복이면 여기서 멈춘다 (데이터베이스가 같은 닉네임을 막는다)
    const { error: nickErr } = await supabase.rpc("mulgyeol_set_nickname", { p_nickname: nickname });
    if (nickErr) {
      setBusy(false);
      setNick({ status: "bad", msg: nickErr.message || "쓸 수 없는 닉네임이에요" });
      setErr(nickErr.message || "닉네임을 저장하지 못했어요.");
      return;
    }

    announceNickname(nickname);

    // 프로필 사진 (골랐을 때만) — 실패해도 가입은 계속한다 (내 레벨에서 다시 올리면 된다)
    if (file && uid) {
      try {
        await uploadAvatar(uid, file);
      } catch {
        /* 넘어간다 */
      }
    }

    // 2) 이름·학년·약관
    const { error } = await supabase.auth.updateUser({
      data: {
        name: f.name.trim(),
        grade: f.grade,
        ...schoolData(school), // 학교 — 물꼬가 우리 학교 수행평가 · 시험 일정에 맞춰 답할 때 쓴다
        marketing_agreed: agree.marketing,
        agreed_at: new Date().toISOString(),
      },
    });
    setBusy(false);

    if (error) {
      setErr("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    track("signup_done");
    goBack();
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-sm font-bold text-gray-500">확인 중…</p>
      </div>
    );
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange";
  const nickColor =
    nick.status === "ok" ? "text-emerald-600" : nick.status === "bad" ? "text-red-500" : "text-gray-400";

  return (
    <div className="mx-auto max-w-md px-5 py-14">
      <h1 className="text-2xl font-extrabold tracking-tight text-sm-navy">가입 마무리</h1>
      <p className="mt-2 text-sm text-gray-500">
        프로필 · 학년 · 학교와 약관 동의만 확인하면 진단 결과 전체를 볼 수 있습니다.
      </p>

      {/* 결과 화면에서 넘어온 주제를 다시 보여준다 */}
      {state?.topic && (
        <div className="mt-6 rounded-xl bg-gray-50 p-4">
          <p className="text-[11.5px] font-bold text-gray-400">진단한 탐구주제</p>
          <p className="mt-1.5 text-[14px] font-bold leading-relaxed text-sm-navy">
            {state.topic}
          </p>
        </div>
      )}

      {/* 프로필 사진 — 안 골라도 된다 */}
      <div className="mt-6 flex items-center gap-4">
        <label className="relative flex h-[72px] w-[72px] flex-none cursor-pointer items-center justify-center overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-300">
          {photo ? (
            <img src={photo} alt="" className="h-full w-full object-cover" />
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
          )}
          <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-sm-orange text-white ring-2 ring-white">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <input type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
        </label>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-sm-navy">프로필 사진 {photo ? "바꾸기" : "넣기"} <span className="font-medium text-gray-400">(선택)</span></p>
          <p className={`mt-0.5 text-[12.5px] ${photoMsg ? "font-bold text-red-500" : "text-gray-400"}`}>
            {photoMsg || "좋아하는 캐릭터·그림도 돼요 · 글과 댓글에 보여요"}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {/* 로그인 계정 이메일은 보여주기만 한다 */}
        <input className={`${input} bg-gray-50 text-gray-500`} value={email} readOnly />
        <input
          className={input}
          placeholder="이름 (다른 사람에게는 보이지 않아요)"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />

        {/* 닉네임 — 댓글에 이름 대신 보인다 */}
        <div>
          <input
            className={`${input} ${nick.status === "bad" ? "border-red-400 focus:border-red-400" : nick.status === "ok" ? "border-emerald-500 focus:border-emerald-500" : ""}`}
            placeholder="닉네임 (댓글에 보여요)"
            value={f.nickname}
            onChange={(e) => setF({ ...f, nickname: e.target.value.slice(0, 10) })}
          />
          <p className={`mt-1.5 text-[12.5px] ${nickColor} ${nick.status === "ok" || nick.status === "bad" ? "font-bold" : ""}`}>
            {nick.msg || "2~10자 · 숫자는 넣어도 되고 안 넣어도 돼요 · 같은 닉네임은 한 명만"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-gray-400">이건 어때요?</span>
            {ideas.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setF({ ...f, nickname: n })}
                className="rounded-full bg-orange-50 px-3 py-1 text-[12.5px] font-bold text-sm-orange"
              >
                {n}
              </button>
            ))}
            <button type="button" onClick={() => setIdeas(suggest())} className="px-1 text-[12px] text-gray-400 underline-offset-2 hover:underline">
              다른 거
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setF({ ...f, grade: g })}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-bold transition ${
                f.grade === g
                  ? "border-sm-orange bg-orange-50 text-sm-orange"
                  : "border-gray-300 text-gray-600"
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        {/* 학교 — 찾아서 고르기 · 목록에 없으면 직접 입력 */}
        <div className="pt-1">
          <SchoolPicker onChange={setSchool} />
        </div>
      </div>

      {/* 약관 */}
      <div className="mt-7 rounded-xl border border-gray-200 p-4">
        <label className="flex cursor-pointer items-center gap-2 font-bold text-sm-navy">
          <Check checked={allChecked} onChange={toggleAll} />
          전체 동의
        </label>
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-[13px] text-gray-600">
          <label className="flex cursor-pointer items-center gap-2">
            <Check checked={agree.terms} onChange={() => setAgree({ ...agree, terms: !agree.terms })} />
            <span>[필수] 이용약관 동의</span>
            <Link to="/terms" target="_blank" className="ml-auto text-gray-400 underline">보기</Link>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <Check checked={agree.privacy} onChange={() => setAgree({ ...agree, privacy: !agree.privacy })} />
            <span>[필수] 개인정보 수집·이용 동의</span>
            <Link to="/privacy" target="_blank" className="ml-auto text-gray-400 underline">보기</Link>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <Check checked={agree.marketing} onChange={() => setAgree({ ...agree, marketing: !agree.marketing })} />
            <span>[선택] 마케팅 정보 수신 동의</span>
          </label>
        </div>
      </div>

      {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy || nick.status === "checking"}
        className="mt-6 w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-50"
      >
        {busy ? "저장 중…" : "시작하기"}
      </button>
    </div>
  );
}