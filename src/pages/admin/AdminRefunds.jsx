import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const dt = (d) => (d ? new Date(d).toLocaleString("ko-KR") : "-");
const day = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");

const REASONS = {
  stage1_fail: "1단계 불합격",
  change_mind: "단순 변심",
  etc: "기타",
};

const DOC_LABEL = {
  application: "원서접수증",
  result: "1단계 불합격 조회",
  id_card: "신분증",
};

const STATUS = {
  requested: ["접수됨", "bg-blue-50 text-blue-600"],
  approved: ["승인", "bg-orange-50 text-sm-orange"],
  rejected: ["반려", "bg-gray-100 text-gray-400"],
  done: ["환불 완료", "bg-gray-100 text-gray-500"],
};

// 이용한 부분을 뺀 환불액 계산 (기간 기준과 강의 수 기준 중 큰 쪽 공제)
function suggestAmount(order, enrollment, progress) {
  const paid = order?.paid_amount ?? 0;
  if (!enrollment) return paid;

  const total = new Date(enrollment.expires_at) - new Date(enrollment.starts_at);
  const used = Date.now() - new Date(enrollment.starts_at);
  const byDay = total > 0 ? Math.min(Math.max(used / total, 0), 1) : 0;
  const byLecture = progress.total > 0 ? progress.done / progress.total : 0;

  const ratio = Math.max(byDay, byLecture);
  return Math.max(Math.floor((paid * (1 - ratio)) / 100) * 100, 0);
}

export default function AdminRefunds() {
  const { isMaster, loading: authLoading } = useAuth();

  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("requested");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [urls, setUrls] = useState({});      // request id -> [{name, url, type}]
  const [calc, setCalc] = useState({});      // request id -> {suggested, note}
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("refund_requests")
      .select(
        "id, order_id, user_id, reason, detail, status, admin_note, requested_at, handled_at, " +
          "university_list, bank_name, account_number, account_holder, files, refund_amount, " +
          "profiles(name, phone), " +
          "orders(order_no, paid_amount, paid_at, pg_method, order_items(name_snapshot))"
      )
      .order("requested_at", { ascending: false });

    if (error) console.error("admin refunds", error);
    setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (isMaster) load();
    else if (!authLoading) setLoading(false);
  }, [isMaster, authLoading]);

  // 상세 열기 — 서류 서명 URL 발급 + 환불액 추산
  async function openDetail(r) {
    if (openId === r.id) return setOpenId(null);
    setOpenId(r.id);
    setNote("");

    // 첨부 서류
    if (!urls[r.id]) {
      const list = Array.isArray(r.files) ? r.files : [];
      const signed = [];
      for (const f of list) {
        const { data } = await supabase.storage
          .from("refund-docs")
          .createSignedUrl(f.path, 600);
        if (data?.signedUrl) signed.push({ ...f, url: data.signedUrl });
      }
      setUrls((u) => ({ ...u, [r.id]: signed }));
    }

    // 환불액 추산
    const { data: enrolls } = await supabase
      .from("enrollments")
      .select("id, course_id, starts_at, expires_at")
      .eq("order_id", r.order_id);

    const enrollment = enrolls?.[0] ?? null;
    let progress = { done: 0, total: 0 };

    if (enrollment) {
      const { data: lectures } = await supabase
        .from("lectures")
        .select("id")
        .eq("course_id", enrollment.course_id);
      const ids = (lectures ?? []).map((l) => l.id);
      if (ids.length > 0) {
        const { count } = await supabase
          .from("lecture_progress")
          .select("lecture_id", { count: "exact", head: true })
          .eq("user_id", r.user_id)
          .eq("is_completed", true)
          .in("lecture_id", ids);
        progress = { done: count ?? 0, total: ids.length };
      }
    }

    const isFullRefund = r.reason === "stage1_fail";
    const suggested = isFullRefund
      ? r.orders?.paid_amount ?? 0
      : suggestAmount(r.orders, enrollment, progress);

    setCalc((c) => ({
      ...c,
      [r.id]: {
        suggested,
        progress,
        enrollment,
        isFullRefund,
      },
    }));
    setAmount(String(suggested));
  }

  // 반려 / 승인 — 상태만 바꾼다
  async function mark(r, next) {
    setBusy(true);
    const { error } = await supabase
      .from("refund_requests")
      .update({
        status: next,
        admin_note: note.trim() || null,
        handled_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    setBusy(false);

    if (error) {
      console.error("refund update", error);
      alert("처리하지 못했습니다.");
      return;
    }
    setOpenId(null);
    load();
  }

  // 환불 실행 — 포트원 취소까지 서버에서 처리한다
  async function doRefund(r) {
    const amt = Number(amount);
    if (!amt || amt <= 0) return alert("환불 금액을 입력해 주세요.");
    if (amt > (r.orders?.paid_amount ?? 0)) return alert("결제 금액보다 클 수 없습니다.");

    const isFull = amt >= (r.orders?.paid_amount ?? 0);
    if (
      !confirm(
        `${won(amt)}을 ${isFull ? "전액" : "부분"} 환불합니다.\n` +
          "포트원에서 실제 결제가 취소되고 수강권이 회수됩니다. 진행할까요?"
      )
    )
      return;

    setBusy(true);
    const { data, error } = await supabase.functions.invoke("cancel-payment", {
      body: { refundRequestId: r.id, amount: amt, note: note.trim() || null },
    });
    setBusy(false);

    if (error || !data?.ok) {
      console.error("cancel-payment", error, data);
      const code = data?.error;
      alert(
        code === "missing_refund_account"
          ? "가상계좌 결제 건은 환불 계좌 정보가 필요합니다."
          : code === "pg_cancel_failed"
          ? `결제 취소에 실패했습니다.\n${data?.message ?? ""}`
          : code === "already_done"
          ? "이미 처리된 환불입니다."
          : "환불 처리 중 문제가 발생했습니다."
      );
      return;
    }

    alert(`환불이 완료되었습니다. (${won(data.refundAmount)})`);
    setOpenId(null);
    load();
  }

  if (authLoading || loading)
    return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;

  if (!isMaster) {
    return (
      <div className="mx-auto max-w-md px-5 py-32 text-center">
        <p className="text-xl font-extrabold text-sm-navy">접근 권한이 없습니다</p>
        <Link to="/" className="mt-6 inline-block text-sm text-gray-400 underline">
          홈으로
        </Link>
      </div>
    );
  }

  const shown = tab === "all" ? rows : rows.filter((r) => r.status === tab);
  const waiting = rows.filter((r) => r.status === "requested").length;

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">환불 처리</h1>

      {waiting > 0 && (
        <p className="mt-4 rounded-xl bg-orange-50 p-4 text-sm font-bold text-sm-orange">
          처리 대기 중인 환불 신청이 {waiting}건 있습니다.
        </p>
      )}

      {/* 탭 */}
      <div className="mt-6 flex flex-wrap gap-2">
        {[["requested", "접수됨"], ["approved", "승인"], ["done", "환불 완료"], ["rejected", "반려"], ["all", "전체"]].map(
          ([k, label]) => {
            const n = k === "all" ? rows.length : rows.filter((r) => r.status === k).length;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-lg border px-3.5 py-2 text-xs font-bold ${
                  tab === k
                    ? "border-sm-orange bg-orange-50 text-sm-orange"
                    : "border-gray-300 text-gray-500"
                }`}
              >
                {label} {n}
              </button>
            );
          }
        )}
      </div>

      {/* 목록 */}
      <ul className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {shown.length === 0 && (
          <li className="py-20 text-center text-sm text-gray-400">해당하는 신청이 없습니다.</li>
        )}

        {shown.map((r) => {
          const [label, cls] = STATUS[r.status] ?? ["-", "bg-gray-100 text-gray-400"];
          const open = openId === r.id;
          const info = calc[r.id];
          const docs = urls[r.id] ?? [];

          return (
            <li key={r.id}>
              <button
                onClick={() => openDetail(r)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-sm-navy">
                    {r.profiles?.name ?? "-"}
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      {r.profiles?.phone ?? ""}
                    </span>
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                      {REASONS[r.reason] ?? r.reason}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {r.orders?.order_no} · {dt(r.requested_at)} 신청
                    {Array.isArray(r.files) && r.files.length > 0 && ` · 서류 ${r.files.length}건`}
                  </p>
                </div>
                <b className="whitespace-nowrap text-sm font-extrabold text-sm-navy">
                  {won(r.orders?.paid_amount)}
                </b>
                <span className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold ${cls}`}>
                  {label}
                </span>
              </button>

              {/* 상세 */}
              {open && (
                <div className="border-t border-gray-100 bg-gray-50 px-5 py-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    {/* 주문 정보 */}
                    <div className="rounded-lg bg-white p-4 text-sm">
                      <p className="text-[13px] font-extrabold text-sm-navy">주문</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {r.orders?.order_items?.map((i) => i.name_snapshot).join(", ")}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        결제 {day(r.orders?.paid_at)} · {r.orders?.pg_method} ·{" "}
                        {won(r.orders?.paid_amount)}
                      </p>
                      {info?.enrollment && (
                        <p className="mt-2 text-xs text-gray-500">
                          수강 {day(info.enrollment.starts_at)} ~ {day(info.enrollment.expires_at)}
                          {info.progress.total > 0 &&
                            ` · 진도 ${info.progress.done}/${info.progress.total}강`}
                        </p>
                      )}
                    </div>

                    {/* 환불 계좌 */}
                    <div className="rounded-lg bg-white p-4 text-sm">
                      <p className="text-[13px] font-extrabold text-sm-navy">환불 방법</p>
                      {r.bank_name ? (
                        <>
                          <p className="mt-2 text-xs text-gray-600">
                            {r.bank_name} {r.account_number}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">예금주 {r.account_holder}</p>
                        </>
                      ) : (
                        <p className="mt-2 text-xs text-gray-400">
                          카드 결제 건 — 포트원에서 승인 취소로 처리
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 지원 대학 */}
                  {r.university_list && (
                    <div className="mt-4 rounded-lg bg-white p-4">
                      <p className="text-[13px] font-extrabold text-sm-navy">지원한 대학 (신청자 기재)</p>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                        {r.university_list}
                      </p>
                    </div>
                  )}

                  {/* 서류 */}
                  {Array.isArray(r.files) && r.files.length > 0 && (
                    <div className="mt-4 rounded-lg bg-white p-4">
                      <p className="text-[13px] font-extrabold text-sm-navy">제출 서류</p>
                      <p className="mt-1 text-xs text-gray-400">
                        원서접수증의 대학과 불합격 조회 화면의 대학이 모두 일치하는지 확인해 주세요.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {docs.length === 0 ? (
                          <span className="text-xs text-gray-400">불러오는 중…</span>
                        ) : (
                          docs.map((f, i) => (
                            <a
                              key={i}
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-600 hover:border-sm-orange hover:text-sm-orange"
                            >
                              {DOC_LABEL[f.type] ?? f.type} · {f.name}
                            </a>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {r.detail && (
                    <div className="mt-4 rounded-lg bg-white p-4">
                      <p className="text-[13px] font-extrabold text-sm-navy">신청자 메모</p>
                      <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{r.detail}</p>
                    </div>
                  )}

                  {/* 처리 */}
                  {(r.status === "requested" || r.status === "approved") && (
                    <div className="mt-5 rounded-lg bg-white p-4">
                      <p className="text-[13px] font-extrabold text-sm-navy">환불 처리</p>

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <div>
                          <label className="text-xs font-bold text-gray-500">환불 금액</label>
                          <input
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                            className="ml-2 w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sm-orange"
                          />
                        </div>
                        {info && (
                          <span className="text-xs text-gray-400">
                            {info.isFullRefund
                              ? "1단계 불합격 특약 → 전액 환불 기준"
                              : `이용분 공제 후 추산 ${won(info.suggested)}`}
                          </span>
                        )}
                      </div>

                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="처리 메모 (신청자에게 표시됩니다). 예: 포트원 승인 취소 완료"
                        className="mt-3 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sm-orange"
                      />

                      <p className="mt-3 text-xs leading-relaxed text-gray-400">
                        「환불 실행」을 누르면 포트원에서 결제가 실제로 취소되고, 주문 상태와 수강권이
                        함께 정리됩니다. 되돌릴 수 없으니 서류를 먼저 확인해 주세요.
                      </p>

                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => mark(r, "rejected")}
                          disabled={busy}
                          className="rounded-lg border border-gray-300 px-4 py-2.5 text-xs font-bold text-gray-600 disabled:opacity-50"
                        >
                          반려
                        </button>
                        {r.status === "requested" && (
                          <button
                            onClick={() => mark(r, "approved")}
                            disabled={busy}
                            className="rounded-lg border border-sm-orange px-4 py-2.5 text-xs font-bold text-sm-orange disabled:opacity-50"
                          >
                            승인 (보류)
                          </button>
                        )}
                        <button
                          onClick={() => doRefund(r)}
                          disabled={busy}
                          className="rounded-lg bg-sm-orange px-4 py-2.5 text-xs font-extrabold text-white disabled:opacity-50"
                        >
                          {busy ? "처리 중…" : "환불 실행"}
                        </button>
                      </div>
                    </div>
                  )}

                  {r.admin_note && r.status !== "requested" && (
                    <p className="mt-4 rounded-lg bg-white p-4 text-xs text-gray-500">
                      처리 메모: {r.admin_note}
                      {r.handled_at && ` · ${dt(r.handled_at)}`}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}