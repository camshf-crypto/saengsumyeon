import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const day = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");

const REASONS = [
  ["stage1_fail", "학생부종합전형 1단계 불합격"],
  ["change_mind", "단순 변심"],
  ["etc", "기타"],
];

// 1단계 불합격으로 신청할 때 반드시 올려야 하는 서류
const DOCS = [
  {
    key: "application",
    label: "① 원서접수증",
    hint: "지원한 모든 대학의 접수증. 지원자 인적사항과 지원 대학·전형명이 보이도록 촬영해 주세요.",
    multiple: true,
  },
  {
    key: "result",
    label: "② 1단계 불합격 조회 화면",
    hint: "지원한 모든 대학의 결과를 각각. 지원자 인적사항과 불합격 여부가 함께 보이도록 촬영해 주세요.",
    multiple: true,
  },
  {
    key: "id_card",
    label: "③ 신분증 사본",
    hint: "이름과 사진이 보이도록 하되, 주민등록번호 뒷자리는 가리고 촬영해 주세요.",
    multiple: false,
  },
];

const REQ_STATUS = {
  requested: ["접수됨", "bg-blue-50 text-blue-600"],
  approved: ["승인", "bg-orange-50 text-sm-orange"],
  rejected: ["반려", "bg-gray-100 text-gray-400"],
  done: ["환불 완료", "bg-gray-100 text-gray-500"],
};

export default function MyRefund() {
  const { user } = useAuth();

  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // 작성 중인 요청서
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState("stage1_fail");
  const [detail, setDetail] = useState("");
  const [univ, setUniv] = useState("");
  const [bank, setBank] = useState({ name: "", number: "", holder: "" });
  const [files, setFiles] = useState({});   // key -> File[]
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const [{ data: ords }, { data: reqs }] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_no, paid_amount, paid_at, pg_method, order_items(name_snapshot)")
        .eq("user_id", user.id)
        .eq("status", "paid")
        .order("paid_at", { ascending: false }),
      supabase
        .from("refund_requests")
        .select("id, order_id, reason, status, admin_note, requested_at, refund_amount, orders(order_no, paid_amount)")
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false }),
    ]);
    setOrders(ords ?? []);
    setRequests(reqs ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  function open(order) {
    setTarget(order);
    setReason("stage1_fail");
    setDetail("");
    setUniv("");
    setBank({ name: "", number: "", holder: "" });
    setFiles({});
    setAgree(false);
    setErr("");
  }

  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const OK_TYPES = ["application/pdf"];

  function pickFiles(key, list, multiple) {
    const arr = Array.from(list);

    const badType = arr.find((f) => !OK_TYPES.includes(f.type));
    if (badType) return setErr(`${badType.name} — PDF 파일만 첨부할 수 있습니다.`);

    const tooBig = arr.find((f) => f.size > MAX_SIZE);
    if (tooBig) return setErr(`${tooBig.name} — 파일당 10MB를 넘을 수 없습니다.`);

    setErr("");
    setFiles((f) => ({ ...f, [key]: multiple ? [...(f[key] ?? []), ...arr] : arr.slice(0, 1) }));
  }

  function removeFile(key, idx) {
    setFiles((f) => ({ ...f, [key]: (f[key] ?? []).filter((_, i) => i !== idx) }));
  }

  const needDocs = reason === "stage1_fail";
  const needBank = target?.pg_method === "VIRTUAL_ACCOUNT";

  function validate() {
    if (!agree) return "환불 처리를 위한 개인정보 수집·이용에 동의해 주세요.";
    if (needDocs) {
      if (!univ.trim()) return "지원한 대학을 모두 입력해 주세요.";
      for (const d of DOCS) {
        if ((files[d.key] ?? []).length === 0) return `${d.label}을(를) 첨부해 주세요.`;
      }
    }
    if (needBank && (!bank.name.trim() || !bank.number.trim() || !bank.holder.trim()))
      return "환불 받으실 계좌 정보를 입력해 주세요.";
    return "";
  }

  async function submit() {
    const msg = validate();
    if (msg) return setErr(msg);

    setBusy(true);
    setErr("");

    // 1) 첨부 서류 업로드
    const uploaded = [];
    try {
      for (const d of DOCS) {
        for (const file of files[d.key] ?? []) {
          const safe = file.name.replace(/[^\w.\-]/g, "_");
          const path = `refund/${user.id}/${target.id}/${d.key}_${Date.now()}_${safe}`;
          const { error } = await supabase.storage.from("refund-docs").upload(path, file);
          if (error) throw error;
          uploaded.push({ type: d.key, path, name: file.name });
        }
      }
    } catch (e) {
      setBusy(false);
      console.error("upload", e);
      setErr("파일 업로드에 실패했습니다. 파일 크기와 형식을 확인해 주세요.");
      return;
    }

    // 2) 신청서 저장
    const { error } = await supabase.from("refund_requests").insert({
      order_id: target.id,
      user_id: user.id,
      reason,
      detail: detail.trim() || null,
      university_list: needDocs ? univ.trim() : null,
      bank_name: needBank ? bank.name.trim() : null,
      account_number: needBank ? bank.number.replace(/[^\d]/g, "") : null,
      account_holder: needBank ? bank.holder.trim() : null,
      files: uploaded,
    });
    setBusy(false);

    if (error) {
      console.error("refund insert", error);
      setErr(
        error.code === "23505"
          ? "이미 접수된 환불 신청이 있습니다."
          : "환불 신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
      return;
    }

    setTarget(null);
    alert("환불 신청이 접수되었습니다. 서류 확인 후 개별 안내드립니다.");
    load();
  }

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  const openIds = requests
    .filter((r) => r.status === "requested" || r.status === "approved")
    .map((r) => r.order_id);

  const input =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-sm-orange";

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">환불 신청</h1>

      <p className="mt-3 rounded-xl bg-gray-50 p-4 text-[13px] leading-relaxed text-gray-500">
        환불 금액은 이용한 부분을 제외하고 산정됩니다. 학생부종합전형 1단계 불합격 시에는 전액 환불
        특약이 적용될 수 있으며, 이 경우 서류 제출이 필요합니다. 자세한 기준은{" "}
        <Link to="/refund" target="_blank" className="font-bold underline">
          환불 규정
        </Link>
        을 확인해 주세요.
      </p>

      {/* 신청 내역 */}
      {requests.length > 0 && (
        <section className="mt-8">
          <p className="text-sm font-extrabold text-sm-navy">신청 내역</p>
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {requests.map((r) => {
              const [label, cls] = REQ_STATUS[r.status] ?? ["-", "bg-gray-100 text-gray-400"];
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-sm-navy">
                        {REASONS.find(([k]) => k === r.reason)?.[1] ?? r.reason}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {r.orders?.order_no} · {day(r.requested_at)} 신청
                        {r.refund_amount != null && ` · 환불액 ${won(r.refund_amount)}`}
                      </p>
                    </div>
                    <span className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold ${cls}`}>
                      {label}
                    </span>
                  </div>
                  {r.admin_note && (
                    <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                      안내: {r.admin_note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 환불 가능한 결제 */}
      <section className="mt-8">
        <p className="text-sm font-extrabold text-sm-navy">환불 가능한 결제</p>
        {orders.length === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 py-16 text-center text-sm text-gray-400">
            환불 신청할 수 있는 결제가 없습니다.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {orders.map((o) => {
              const already = openIds.includes(o.id);
              return (
                <li key={o.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-sm-navy">
                      {o.order_items?.map((i) => i.name_snapshot).join(", ")}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {day(o.paid_at)} · {o.order_no} · {won(o.paid_amount)}
                    </p>
                  </div>
                  <button
                    onClick={() => open(o)}
                    disabled={already}
                    className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold text-gray-600 disabled:opacity-40"
                  >
                    {already ? "신청됨" : "환불요청서 작성"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── 환불요청서 ─────────────────────────────────── */}
      {target && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 px-4 py-10">
          <div className="mx-auto w-full max-w-lg rounded-2xl bg-white p-7">
            <p className="text-lg font-extrabold tracking-tight text-sm-navy">환불요청서</p>
            <p className="mt-1 text-xs text-gray-400">
              {target.order_no} · {won(target.paid_amount)} · {day(target.paid_at)} 결제
            </p>

            {/* 사유 */}
            <div className="mt-6">
              <p className="text-sm font-bold text-sm-navy">환불 사유</p>
              <div className="mt-2 space-y-2">
                {REASONS.map(([key, label]) => (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
                      reason === key ? "border-sm-orange bg-orange-50" : "border-gray-200"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={reason === key}
                      onChange={() => setReason(key)}
                      className="h-4 w-4 accent-orange-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* 1단계 불합격 전용 */}
            {needDocs && (
              <>
                <div className="mt-6">
                  <p className="text-sm font-bold text-sm-navy">지원한 대학</p>
                  <p className="mt-1 text-xs text-gray-400">
                    학생부종합전형으로 지원한 대학을 빠짐없이 적어주세요. 제출 서류와 대조합니다.
                  </p>
                  <textarea
                    value={univ}
                    onChange={(e) => setUniv(e.target.value)}
                    rows={3}
                    placeholder={"예)\n○○대 학생부종합(학교장추천)\n○○대 학생부종합(일반)"}
                    className={`${input} mt-2 resize-none`}
                  />
                </div>

                <div className="mt-6">
                  <p className="text-sm font-bold text-sm-navy">제출 서류</p>
                  <div className="mt-3 space-y-4">
                    {DOCS.map((d) => {
                      const list = files[d.key] ?? [];
                      return (
                        <div key={d.key} className="rounded-lg border border-gray-200 p-4">
                          <p className="text-[13px] font-bold text-sm-navy">{d.label}</p>
                          <p className="mt-1 text-xs leading-relaxed text-gray-400">{d.hint}</p>

                          <label className="mt-3 block cursor-pointer rounded-lg border border-dashed border-gray-300 py-3 text-center text-xs font-bold text-gray-500 hover:border-sm-orange hover:text-sm-orange">
                            파일 선택
                            <input
                              type="file"
                              accept="application/pdf"
                              multiple={d.multiple}
                              className="hidden"
                              onChange={(e) => pickFiles(d.key, e.target.files, d.multiple)}
                            />
                          </label>
                          <p className="mt-1.5 text-center text-[11px] text-gray-400">
                            PDF · 파일당 10MB 이하
                            {d.multiple && " · 여러 개 첨부 가능"}
                          </p>

                          {list.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {list.map((f, i) => (
                                <li
                                  key={i}
                                  className="flex items-center justify-between gap-2 rounded bg-gray-50 px-3 py-2 text-xs"
                                >
                                  <span className="min-w-0 truncate text-gray-600">
                                    {f.name}
                                    <span className="ml-2 text-gray-400">
                                      {(f.size / 1024 / 1024).toFixed(1)}MB
                                    </span>
                                  </span>
                                  <button
                                    onClick={() => removeFile(d.key, i)}
                                    className="shrink-0 text-gray-400 hover:text-red-500"
                                  >
                                    삭제
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-gray-400">
                    모든 서류는 PDF로 첨부해 주세요. 사진으로 촬영한 경우 휴대폰 기본 카메라의 문서
                    스캔 기능이나 PDF 변환 앱을 이용하시면 됩니다.
                    <br />
                    원서접수증과 불합격 조회 화면의 대학이 일치하지 않거나 일부 대학의 결과가 누락된 경우
                    환불이 승인되지 않습니다.
                  </p>
                </div>
              </>
            )}

            {/* 가상계좌 결제였으면 환불 계좌 필요 */}
            {needBank && (
              <div className="mt-6">
                <p className="text-sm font-bold text-sm-navy">환불 받으실 계좌</p>
                <p className="mt-1 text-xs text-gray-400">
                  가상계좌로 결제하셔서 계좌 입금으로 환불됩니다. 예금주는 신청자 본인이어야 합니다.
                </p>
                <div className="mt-2 space-y-2">
                  <input
                    className={input}
                    placeholder="은행명"
                    value={bank.name}
                    onChange={(e) => setBank({ ...bank, name: e.target.value })}
                  />
                  <input
                    className={input}
                    placeholder="계좌번호 ('-' 없이)"
                    value={bank.number}
                    onChange={(e) => setBank({ ...bank, number: e.target.value })}
                  />
                  <input
                    className={input}
                    placeholder="예금주"
                    value={bank.holder}
                    onChange={(e) => setBank({ ...bank, holder: e.target.value })}
                  />
                </div>
              </div>
            )}

            {/* 상세 사유 */}
            <div className="mt-6">
              <p className="text-sm font-bold text-sm-navy">상세 내용 (선택)</p>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                placeholder="추가로 알려주실 내용이 있으면 적어주세요."
                className={`${input} mt-2 resize-none`}
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
                <b className="text-sm-navy">[필수]</b> 환불 처리를 위해 제출한 서류와 계좌 정보를 수집·
                이용하는 데 동의합니다. 수집한 정보는 환불 처리 완료 후 관련 법령에 따른 보존 기간이
                경과하면 파기됩니다.
              </span>
            </label>

            {err && <p className="mt-4 text-sm font-semibold text-red-500">{err}</p>}

            <p className="mt-4 text-xs leading-relaxed text-gray-400">
              접수 후 서류 확인을 거쳐 영업일 기준 3~5일 이내에 처리하며, 결과는 개별 안내드립니다.
            </p>

            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setTarget(null)}
                disabled={busy}
                className="flex-1 rounded-lg border border-gray-300 py-3 text-sm font-bold text-gray-600"
              >
                닫기
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="flex-1 rounded-lg bg-sm-orange py-3 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {busy ? "접수 중…" : "환불 신청하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}