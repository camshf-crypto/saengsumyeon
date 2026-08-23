import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const day = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");

const EMPTY = {
  code: "",
  name: "",
  discount_type: "percent",
  discount_value: 50,
  min_amount: 0,
  valid_days: 30,      // 발급일로부터 며칠간 유효한지
  max_uses: "",
  is_active: true,
};

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState([]);
  const [issued, setIssued] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 발급 폼
  const [issueCoupon, setIssueCoupon] = useState("");
  const [q, setQ] = useState("");

  async function load() {
    const [{ data: cs }, { data: uc }, { data: ms }] = await Promise.all([
      supabase.from("coupons").select("*").order("id"),
      supabase
        .from("user_coupons")
        .select("id, user_id, coupon_id, issued_at, expires_at, used_at, profiles(name, phone), coupons(name, code)")
        .order("issued_at", { ascending: false })
        .limit(200),
      supabase.from("profiles").select("id, name, phone, school").order("created_at", { ascending: false }),
    ]);
    setCoupons(cs ?? []);
    setIssued(uc ?? []);
    setMembers(ms ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) => {
    const v =
      e.target.type === "checkbox"
        ? e.target.checked
        : e.target.type === "number"
        ? Number(e.target.value)
        : e.target.value;
    setForm({ ...form, [k]: v });
  };

  function startEdit(c) {
    setEditId(c.id);
    setForm({
      code: c.code,
      name: c.name,
      discount_type: c.discount_type,
      discount_value: c.discount_value,
      min_amount: c.min_amount ?? 0,
      valid_days: 30,
      max_uses: c.max_uses ?? "",
      is_active: c.is_active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditId(null);
    setForm(EMPTY);
    setMsg("");
  }

  async function save() {
    if (!form.code.trim()) return setMsg("쿠폰 코드를 입력해 주세요.");
    if (!form.name.trim()) return setMsg("쿠폰명을 입력해 주세요.");
    if (form.discount_type === "percent" && (form.discount_value < 1 || form.discount_value > 100))
      return setMsg("할인율은 1~100 사이로 입력해 주세요.");

    setBusy(true);
    setMsg("");
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      min_amount: form.min_amount || 0,
      max_uses: form.max_uses === "" ? null : Number(form.max_uses),
      is_active: form.is_active,
    };

    const { error } = editId
      ? await supabase.from("coupons").update(payload).eq("id", editId)
      : await supabase.from("coupons").insert(payload);

    setBusy(false);
    if (error) {
      console.error("coupon save", error);
      setMsg(
        error.code === "23505"
          ? "이미 있는 쿠폰 코드입니다."
          : "저장하지 못했습니다. 권한을 확인해 주세요."
      );
      return;
    }
    reset();
    load();
  }

  async function toggle(c) {
    await supabase.from("coupons").update({ is_active: !c.is_active }).eq("id", c.id);
    load();
  }

  // 회원에게 쿠폰 발급
  async function issue(userId) {
    if (!issueCoupon) return alert("발급할 쿠폰을 먼저 선택해 주세요.");
    const c = coupons.find((x) => x.id === issueCoupon);
    const days = form.valid_days || 30;

    setBusy(true);
    const { error } = await supabase.from("user_coupons").insert({
      user_id: userId,
      coupon_id: issueCoupon,
      expires_at: new Date(Date.now() + days * 86400000).toISOString(),
    });
    setBusy(false);

    if (error) {
      console.error("issue", error);
      alert(
        error.code === "23505"
          ? "이미 발급받은 쿠폰입니다."
          : "발급하지 못했습니다."
      );
      return;
    }
    alert(`「${c?.name}」 쿠폰을 발급했습니다. (${days}일 유효)`);
    load();
  }

  async function revoke(id) {
    if (!confirm("이 쿠폰 발급을 취소할까요?")) return;
    await supabase.from("user_coupons").delete().eq("id", id);
    load();
  }

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  const keyword = q.trim().toLowerCase();
  const shownMembers = keyword
    ? members.filter(
        (m) =>
          (m.name ?? "").toLowerCase().includes(keyword) ||
          (m.phone ?? "").includes(keyword) ||
          (m.school ?? "").toLowerCase().includes(keyword)
      )
    : [];

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-sm-orange";

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">쿠폰 관리</h1>

      {/* 쿠폰 만들기 */}
      <section className="mt-5 rounded-xl border border-gray-200 p-6">
        <p className="text-sm font-extrabold text-sm-navy">
          {editId ? "쿠폰 수정" : "쿠폰 만들기"}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-gray-500">쿠폰 코드</label>
            <input
              className={input}
              placeholder="SEUM50"
              value={form.code}
              onChange={set("code")}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">쿠폰명 (학생에게 보임)</label>
            <input
              className={input}
              placeholder="세움스피치 수강생 50% 할인"
              value={form.name}
              onChange={set("name")}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">할인 방식</label>
            <select className={input} value={form.discount_type} onChange={set("discount_type")}>
              <option value="percent">정률 (%)</option>
              <option value="amount">정액 (원)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">
              할인 {form.discount_type === "percent" ? "율 (%)" : "금액 (원)"}
            </label>
            <input
              type="number"
              className={input}
              value={form.discount_value}
              onChange={set("discount_value")}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">최소 주문금액 (0이면 제한 없음)</label>
            <input type="number" className={input} value={form.min_amount} onChange={set("min_amount")} />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500">총 발급 한도 (비우면 무제한)</label>
            <input type="number" className={input} value={form.max_uses} onChange={set("max_uses")} />
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={set("is_active")}
            className="h-4 w-4 accent-orange-500"
          />
          사용 가능 상태로 두기
        </label>

        {msg && <p className="mt-3 text-sm font-semibold text-red-500">{msg}</p>}

        <div className="mt-5 flex gap-2">
          {editId && (
            <button
              onClick={reset}
              className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-bold text-gray-600"
            >
              취소
            </button>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-lg bg-sm-orange py-3 text-sm font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "저장 중…" : editId ? "수정 저장" : "쿠폰 만들기"}
          </button>
        </div>
      </section>

      {/* 쿠폰 목록 */}
      <section className="mt-8">
        <p className="text-sm font-extrabold text-sm-navy">쿠폰 {coupons.length}종</p>
        {coupons.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 py-14 text-center text-sm text-gray-400">
            만든 쿠폰이 없습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">코드</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">쿠폰명</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">할인</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">최소금액</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">발급/한도</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">상태</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">관리</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => {
                  const cnt = issued.filter((u) => u.coupon_id === c.id).length;
                  return (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.code}</td>
                      <td className="px-4 py-3 font-bold text-sm-navy">{c.name}</td>
                      <td className="px-4 py-3 text-center text-sm-orange">
                        {c.discount_type === "percent"
                          ? `${c.discount_value}%`
                          : won(c.discount_value)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">
                        {c.min_amount > 0 ? won(c.min_amount) : "-"}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">
                        {cnt}/{c.max_uses ?? "∞"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggle(c)}
                          className={`rounded px-2 py-0.5 text-xs font-bold ${
                            c.is_active
                              ? "bg-orange-50 text-sm-orange"
                              : "bg-gray-100 text-gray-400"
                          }`}
                        >
                          {c.is_active ? "사용중" : "중지"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => startEdit(c)}
                          className="text-xs font-semibold text-gray-500 hover:text-sm-orange"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 회원에게 발급 */}
      <section className="mt-8 rounded-xl border border-gray-200 p-6">
        <p className="text-sm font-extrabold text-sm-navy">회원에게 발급</p>
        <p className="mt-1 text-xs text-gray-400">
          세움스피치 수강 이력을 확인한 뒤 해당 학생에게 직접 발급합니다.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px]">
          <select
            className={input}
            value={issueCoupon}
            onChange={(e) => setIssueCoupon(e.target.value)}
          >
            <option value="">발급할 쿠폰 선택</option>
            {coupons
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (
                  {c.discount_type === "percent" ? `${c.discount_value}%` : won(c.discount_value)})
                </option>
              ))}
          </select>
          <div>
            <input
              type="number"
              className={input}
              value={form.valid_days}
              onChange={set("valid_days")}
              placeholder="유효일수"
            />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-gray-400">발급일로부터 유효한 일수입니다.</p>

        <input
          className={`${input} mt-4`}
          placeholder="이름 · 휴대폰 · 학교로 회원 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {keyword && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {shownMembers.length === 0 && (
              <li className="py-8 text-center text-sm text-gray-400">검색 결과가 없습니다.</li>
            )}
            {shownMembers.slice(0, 10).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-sm-navy">{m.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {m.phone} · {m.school || "학교 미입력"}
                  </p>
                </div>
                <button
                  onClick={() => issue(m.id)}
                  disabled={busy || !issueCoupon}
                  className="shrink-0 rounded-lg bg-sm-orange px-4 py-2 text-xs font-extrabold text-white disabled:opacity-40"
                >
                  발급
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 발급 내역 */}
      <section className="mt-8">
        <p className="text-sm font-extrabold text-sm-navy">발급 내역 {issued.length}건</p>
        {issued.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 py-14 text-center text-sm text-gray-400">
            발급된 쿠폰이 없습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">회원</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-left font-bold">쿠폰</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">발급일</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">만료일</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">상태</th>
                  <th className="border-b border-gray-200 px-4 py-3 text-center font-bold">관리</th>
                </tr>
              </thead>
              <tbody>
                {issued.map((u) => {
                  const expired = u.expires_at && new Date(u.expires_at) < new Date();
                  return (
                    <tr key={u.id} className="border-b border-gray-100">
                      <td className="px-4 py-3">
                        <span className="font-bold text-sm-navy">{u.profiles?.name ?? "-"}</span>
                        <span className="ml-2 text-xs text-gray-400">{u.profiles?.phone ?? ""}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{u.coupons?.name}</td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">
                        {day(u.issued_at)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">
                        {day(u.expires_at)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-bold ${
                            u.used_at
                              ? "bg-gray-100 text-gray-500"
                              : expired
                              ? "bg-gray-100 text-gray-400"
                              : "bg-orange-50 text-sm-orange"
                          }`}
                        >
                          {u.used_at ? "사용됨" : expired ? "만료" : "미사용"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {!u.used_at && (
                          <button
                            onClick={() => revoke(u.id)}
                            className="text-xs font-semibold text-gray-400 hover:text-red-500"
                          >
                            회수
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}