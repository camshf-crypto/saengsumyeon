import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { PREORDER as P, GRADES } from "./preorderConfig";

const won = (n) => n.toLocaleString("ko-KR") + "원";

export default function Preorder() {
  const { user, profile } = useAuth();

  const [f, setF] = useState({
    name: "", phone: "", email: "", school: "", grade: "고3", major: "", depositor: "", memo: "",
  });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [count, setCount] = useState(null);
  const reached = count !== null && count >= P.target; // 목표 인원 달성

  // 로그인 상태면 정보를 미리 채운다
  useEffect(() => {
    if (!profile) return;
    setF((prev) => ({
      ...prev,
      name: prev.name || profile.name || "",
      phone: prev.phone || profile.phone || "",
      email: prev.email || user?.email || "",
      school: prev.school || profile.school || "",
      grade: profile.grade || prev.grade,
      depositor: prev.depositor || profile.name || "",
    }));
  }, [profile, user]);

  useEffect(() => {
    supabase.rpc("paid_preorder_count").then(({ data }) => setCount(data ?? 0));
  }, [done]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function validate() {
    if (!f.name.trim()) return "이름을 입력해 주세요.";
    if (!/^01[016-9]\d{7,8}$/.test(f.phone.replace(/-/g, ""))) return "휴대폰 번호를 확인해 주세요.";
    if (!f.email.includes("@")) return "이메일을 확인해 주세요.";
    if (!f.school.trim()) return "재학 고등학교를 입력해 주세요.";
    if (!f.major.trim()) return "지원 예정 학과를 입력해 주세요.";
    if (!f.depositor.trim()) return "입금자명을 입력해 주세요.";
    if (!agree) return "안내사항에 동의해 주세요.";
    return "";
  }

  async function submit() {
    const msg = validate();
    if (msg) return setErr(msg);

    setBusy(true);
    setErr("");
    const { error } = await supabase.from("preorders").insert({
      user_id: user?.id ?? null,
      name: f.name.trim(),
      phone: f.phone.replace(/-/g, ""),
      email: f.email.trim(),
      school: f.school.trim(),
      major: f.major.trim(),
      grade: f.grade,
      depositor: f.depositor.trim(),
      amount: P.deposit,
      memo: f.memo.trim() || null,
      agreed_terms: true,
    });
    setBusy(false);

    if (error) {
      console.error("preorder", error);
      setErr("신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function copyAccount() {
    navigator.clipboard?.writeText(`${P.bank} ${P.account}`);
    alert("계좌번호를 복사했습니다.");
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-3 text-[15px] outline-none focus:border-sm-orange";

  /* ── 신청 완료 ───────────────────────────────────────── */
  if (done) {
    return (
      <div className="mx-auto max-w-lg px-5 py-16">
        <p className="text-2xl font-extrabold tracking-tight text-sm-navy">
          신청이 접수되었습니다
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          아래 계좌로 계약금 <b className="text-sm-navy">{won(P.deposit)}</b>을 입금해 주세요.
          <br />
          입금이 확인되면 문자로 안내드립니다.
        </p>

        <div className="mt-6 rounded-xl bg-sm-peach p-6">
          <p className="text-xs font-bold text-sm-orange">입금 계좌</p>
          <p className="mt-2 text-xl font-extrabold tracking-tight text-sm-navy">
            {P.bank} {P.account}
          </p>
          <p className="mt-1 text-sm text-gray-600">예금주 {P.holder}</p>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-white px-4 py-3">
            <span className="text-sm text-gray-500">입금자명</span>
            <b className="text-sm-navy">{f.depositor}</b>
          </div>
          <button
            onClick={copyAccount}
            className="mt-3 w-full rounded-lg bg-sm-orange py-3 text-sm font-extrabold text-white"
          >
            계좌번호 복사
          </button>
        </div>

        <ul className="mt-6 space-y-1.5 text-[13px] leading-relaxed text-gray-500">
          <li>· 입금자명이 다르면 확인이 어렵습니다. 위 이름 그대로 입금해 주세요.</li>
          <li>· 신청 마감은 {P.deadline}입니다.</li>
          {!reached && (
            <li>· {P.target}명 미달 시 {P.refundDate}까지 계약금 전액을 환불해 드립니다.</li>
          )}
          <li>· 잔금 {won(P.balance)}은 제작 확정 후 별도 안내드립니다.</li>
        </ul>

        <Link
          to="/"
          className="mt-8 block rounded-lg border border-gray-300 py-3.5 text-center text-sm font-bold text-gray-600"
        >
          홈으로
        </Link>
      </div>
    );
  }

  /* ── 신청 폼 ─────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-lg px-5 py-14">
      <p className="text-sm font-bold text-sm-orange">사전 신청</p>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">
        생수면 대입면접 합격패스
      </h1>

      {/* 안내 */}
      <div className="mt-6 rounded-xl bg-sm-peach p-6">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-gray-600">계약금</span>
          <b className="text-2xl font-extrabold text-sm-orange">{won(P.deposit)}</b>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-sm text-gray-500">
          <span>총 수강료</span>
          <span>
            {won(P.total)} <span className="text-xs">(잔금 {won(P.balance)})</span>
          </span>
        </div>

        <ul className="mt-4 space-y-1.5 border-t border-orange-200 pt-4 text-[13px] leading-relaxed text-gray-600">
          <li>· 신청 마감: <b className="text-sm-navy">{P.deadline}</b></li>
          {reached ? (
            <li>
              · <b className="text-sm-navy">{P.target}명이 모여 제작이 확정되었습니다.</b> 지금
              신청하셔도 함께 수강하실 수 있습니다.
            </li>
          ) : (
            <>
              <li>· {P.target}명 이상 신청 시 제작이 확정됩니다. ({P.confirmDate} 안내)</li>
              <li>· 미달 시 {P.refundDate}까지 계약금 전액을 환불해 드립니다.</li>
            </>
          )}
          <li>· 강의 공개 예정: {P.openDate}</li>
        </ul>

        {count !== null && (
          <div className="mt-4 rounded-lg bg-white p-4">
            <div className="flex justify-between text-xs text-gray-500">
              <span>{reached ? "제작이 확정되었습니다" : "현재 신청"}</span>
              <span className="font-bold text-sm-orange">
                {reached ? `${count}명 신청` : `${count} / ${P.target}명`}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-sm-orange transition-all"
                style={{ width: `${Math.min((count / P.target) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 입력 */}
      <div className="mt-8 space-y-3">
        <input className={input} placeholder="이름" value={f.name} onChange={set("name")} />
        <input className={input} placeholder="휴대폰 번호 ('-' 없이)" value={f.phone} onChange={set("phone")} />
        <input className={input} placeholder="이메일" value={f.email} onChange={set("email")} />
        <input className={input} placeholder="재학 고등학교" value={f.school} onChange={set("school")} />

        <div className="flex gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
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

        <div>
          <input
            className={input}
            placeholder="지원 예정 학과"
            value={f.major}
            onChange={set("major")}
          />
          <p className="mt-1 text-xs text-gray-400">
            아직 확정되지 않았다면 관심 있는 계열이나 학과를 적어주세요. 계열별 자료 준비에
            참고합니다.
          </p>
        </div>

        <div>
          <input
            className={input}
            placeholder="입금자명"
            value={f.depositor}
            onChange={set("depositor")}
          />
          <p className="mt-1 text-xs text-gray-400">
            실제로 입금하실 이름입니다. 신청자와 다르면 여기에 입금자 이름을 적어주세요.
          </p>
        </div>

        <textarea
          className={`${input} resize-none`}
          rows={3}
          placeholder="문의사항이 있으면 적어주세요 (선택)"
          value={f.memo}
          onChange={set("memo")}
        />
      </div>

      {/* 동의 */}
      <label className="mt-6 flex cursor-pointer items-start gap-2 text-[13px] leading-relaxed text-gray-600">
        <input
          type="checkbox"
          checked={agree}
          onChange={() => setAgree(!agree)}
          className="mt-0.5 h-4 w-4 accent-orange-500"
        />
        <span>
          <b className="text-sm-navy">[필수]</b> 위 안내사항을 확인했으며, 신청 접수를 위해
          개인정보(이름, 연락처, 이메일)를 수집·이용하는 데 동의합니다.
        </span>
      </label>

      {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-sm-orange py-4 text-[15px] font-extrabold text-white disabled:opacity-50"
      >
        {busy ? "접수 중…" : "신청하고 계좌 안내받기"}
      </button>

      <p className="mt-4 text-center text-xs text-gray-400">
        신청 후 안내되는 계좌로 입금하시면 접수가 완료됩니다.
      </p>
    </div>
  );
}