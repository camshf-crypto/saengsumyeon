import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const GRADES = ["고1", "고2", "고3", "N수"];

export default function MyProfile() {
  const { user, profile, refreshProfile } = useAuth();

  const [f, setF] = useState({ name: "", phone: "", school: "", grade: "고3" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // 비밀번호 변경
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setF({
      name: profile.name ?? "",
      phone: profile.phone ?? "",
      school: profile.school ?? "",
      grade: profile.grade ?? "고3",
    });
  }, [profile]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim()) return setMsg("이름을 입력해 주세요.");
    if (!/^01[016-9]\d{7,8}$/.test(f.phone.replace(/-/g, "")))
      return setMsg("휴대폰 번호를 확인해 주세요.");

    setBusy(true);
    setMsg("");
    const { error } = await supabase
      .from("profiles")
      .update({
        name: f.name.trim(),
        phone: f.phone.replace(/-/g, ""),
        school: f.school.trim() || null,
        grade: f.grade,
      })
      .eq("id", user.id);
    setBusy(false);

    if (error) {
      console.error("profile update", error);
      setMsg("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    await refreshProfile();
    setMsg("저장했습니다.");
  }

  async function changePassword() {
    if (pw.next.length < 8) return setPwMsg("비밀번호는 8자 이상 입력해 주세요.");
    if (pw.next !== pw.confirm) return setPwMsg("비밀번호가 서로 다릅니다.");

    setPwBusy(true);
    setPwMsg("");
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    setPwBusy(false);

    if (error) {
      console.error("password", error);
      setPwMsg("변경하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.");
      return;
    }
    setPw({ next: "", confirm: "" });
    setPwMsg("비밀번호를 변경했습니다.");
  }

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-sm-orange";

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">나의 정보</h1>

      {/* 기본 정보 */}
      <section className="mt-5 rounded-xl border border-gray-200 p-6">
        <p className="text-sm font-extrabold text-sm-navy">기본 정보</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-gray-500">이메일</label>
            <p className="mt-1 rounded-lg bg-gray-50 px-4 py-2.5 text-sm text-gray-500">
              {user?.email}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              이메일은 변경할 수 없습니다. 수강권이 이 계정에 연결되어 있습니다.
            </p>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500">이름</label>
            <input className={input} value={f.name} onChange={set("name")} />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500">휴대폰 번호</label>
            <input className={input} value={f.phone} onChange={set("phone")} placeholder="'-' 없이" />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500">재학 고등학교</label>
            <input className={input} value={f.school} onChange={set("school")} />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500">학년</label>
            <div className="mt-1 flex gap-2">
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
          </div>
        </div>

        {msg && <p className="mt-4 text-sm font-semibold text-sm-orange">{msg}</p>}

        <button
          onClick={save}
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-sm-orange py-3 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {busy ? "저장 중…" : "저장"}
        </button>
      </section>

      {/* 비밀번호 */}
      <section className="mt-6 rounded-xl border border-gray-200 p-6">
        <p className="text-sm font-extrabold text-sm-navy">비밀번호 변경</p>

        <div className="mt-4 space-y-3">
          <input
            className={input}
            type="password"
            placeholder="새 비밀번호 (8자 이상)"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
          <input
            className={input}
            type="password"
            placeholder="새 비밀번호 확인"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
          />
        </div>

        {pwMsg && <p className="mt-4 text-sm font-semibold text-sm-orange">{pwMsg}</p>}

        <button
          onClick={changePassword}
          disabled={pwBusy}
          className="mt-5 w-full rounded-lg border border-gray-300 py-3 text-sm font-bold text-gray-600 disabled:opacity-50"
        >
          {pwBusy ? "변경 중…" : "비밀번호 변경"}
        </button>
      </section>
    </div>
  );
}