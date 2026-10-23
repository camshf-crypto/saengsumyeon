import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

/*
 * 관리자 '가입 · 결제' 묶음 — [광고] 탭
 *   <AdsPanel from to />
 * DB: sql/sm_67_ads.sql (ads · ad_events · 저장소 ads)
 * 업체 배너 올리기 · 자리 · 순서 · 링크 · 기간 · 켜기/끄기 · 노출/클릭 숫자 (업체에 보고할 때 쓰기)
 * 자리 2가지 — 메인 맨 위 배너(업체 3곳까지, 돌아가며) / 오른쪽 띠 배너(업체 4곳까지) (화면은 src/components/AdSlot.jsx)
 * 노출·클릭은 하루·기기당 1번으로 센다
 */

const n = (v) => Number(v ?? 0).toLocaleString();
const ctr = (c, v) => (Number(v) ? `${((Number(c) / Number(v)) * 100).toFixed(1)}%` : "-");
const imgUrl = (path) => supabase.storage.from("ads").getPublicUrl(path).data.publicUrl;
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// 광고 자리 — slot(어느 칸) + size(배너 모양)
const PLACES = [
  { k: "top", slot: "home_top", size: "strip", label: "메인 맨 위 배너", hint: "1200 × 240 (5:1) · 업체 3곳까지 · 5초마다 돌아가요", ratio: "aspect-[5/1]" },
  { k: "strip", slot: "home_right", size: "strip", label: "오른쪽 띠 배너", hint: "900 × 200 (가로로 긴 배너) · 업체 4곳까지 · 4개가 쌓여요", ratio: "aspect-[9/2]" },
];
const placeOf = (a) => PLACES.find((p) => p.slot === a.slot && p.size === a.size) ?? PLACES[1];
const EMPTY = { id: null, slot: "home_right", size: "strip", sort: 100, advertiser: "", title: "", image_path: "", link_url: "https://", starts_on: today(), ends_on: "", active: true, memo: "" };

/* 최근 14일 노출·클릭 막대 */
function Daily({ rows }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.views)));
  return (
    <div className="flex h-20 items-end gap-[3px]">
      {rows.map((r) => (
        <div key={r.day} className="flex flex-1 flex-col items-center" title={`${r.day} 노출 ${r.views} · 클릭 ${r.clicks}`}>
          <div className="relative flex h-16 w-full items-end justify-center">
            <i className="block w-full max-w-[14px] rounded-t bg-indigo-200" style={{ height: `${(Number(r.views) / max) * 100}%`, minHeight: Number(r.views) ? 2 : 0 }} />
            <i className="absolute bottom-0 block w-full max-w-[14px] rounded-t bg-sm-orange" style={{ height: `${(Number(r.clicks) / max) * 100}%`, minHeight: Number(r.clicks) ? 2 : 0 }} />
          </div>
          <span className="mt-1 text-[9.5px] text-gray-400">{String(r.day).slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

/* 광고 문의 — /advertise 에서 업체가 남긴 문의 (sql/sm_69_ad_inquiry.sql) */
const INQ = { new: ["새 문의", "bg-red-50 text-red-600"], contacted: ["연락함", "bg-amber-50 text-amber-700"], contract: ["계약", "bg-emerald-50 text-emerald-700"], hold: ["보류", "bg-gray-100 text-gray-500"] };
const PLACE_L = { top: "맨 위 배너", right: "오른쪽 띠 배너", both: "둘 다", undecided: "상담 후 결정" };
function Inquiries() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(true);
  const load = () => supabase.rpc("admin_ad_inquiries").then(({ data, error }) => setRows(error ? [] : data ?? []));
  useEffect(() => { supabase.rpc("ad_inquiry_cleanup"); load(); }, []);
  async function update(r, status, memo) {
    await supabase.rpc("admin_ad_inquiry_update", { p_id: r.id, p_status: status, p_memo: memo ?? r.admin_memo ?? null });
    load();
  }
  if (rows === null) return null;
  const fresh = rows.filter((r) => r.status === "new").length;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <b className="text-[15px] text-sm-navy">광고 문의</b>
        {fresh > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">새 문의 {fresh}</span>}
        <span className="text-[12px] text-gray-400">전체 {rows.length}건 · 문의 페이지 /advertise · 1년 지나면 자동 삭제</span>
        <span className="ml-auto text-[12px] text-gray-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {rows.length === 0 && <p className="py-6 text-center text-[13px] text-gray-400">아직 들어온 문의가 없어요.</p>}
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-gray-100 bg-[#FAFAFB] p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${INQ[r.status]?.[1]}`}>{INQ[r.status]?.[0]}</span>
                <b className="text-gray-900">{r.company}</b>
                <span className="text-gray-600">{r.person}</span>
                {r.phone && <a href={`tel:${r.phone}`} className="text-indigo-600 underline">{r.phone}</a>}
                {r.email && <a href={`mailto:${r.email}`} className="text-indigo-600 underline">{r.email}</a>}
                <span className="ml-auto text-[11.5px] text-gray-400">{new Date(r.created_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
              <p className="mt-1 text-gray-600">원하는 자리 · {PLACE_L[r.place] ?? "-"}{r.period ? ` · 기간 ${r.period}` : ""}</p>
              {r.message && <p className="mt-1 whitespace-pre-wrap text-gray-800">{r.message}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {Object.entries(INQ).map(([k, [l]]) => (
                  <button key={k} onClick={() => update(r, k)} className={`h-7 rounded-md border px-2 text-[12px] font-bold ${r.status === k ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300 text-gray-600"}`}>{l}</button>
                ))}
                <input defaultValue={r.admin_memo ?? ""} onBlur={(e) => e.target.value !== (r.admin_memo ?? "") && update(r, r.status, e.target.value)}
                  placeholder="메모 (칸 밖을 누르면 저장)" className="h-7 min-w-[180px] flex-1 rounded-md border border-gray-300 px-2 text-[12px] outline-none focus:border-sm-navy" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdsPanel({ from, to }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(null); // 고치는 중인 광고 (null 이면 닫힘)
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.rpc("admin_ads", { p_from: from || null, p_to: to || null });
    if (error) return setErr(error.message.includes("admin_ads") ? "sm_67_ads.sql 을 먼저 실행해 주세요" : error.message);
    setErr("");
    setList(data ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // 배너 이미지 올리기 — 저장소 ads/home/시간-이름
  async function upload(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setErr("이미지는 5MB 이하로 올려 주세요");
    setBusy(true);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `home/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("ads").upload(path, file, { contentType: file.type });
    setBusy(false);
    if (error) return setErr(`이미지를 올리지 못했어요: ${error.message}`);
    setErr("");
    set("image_path", path);
  }

  async function save() {
    setBusy(true);
    const { error } = await supabase.rpc("admin_ad_save", {
      p_id: form.id,
      p_advertiser: form.advertiser,
      p_title: form.title,
      p_image_path: form.image_path,
      p_link_url: form.link_url,
      p_starts_on: form.starts_on || null,
      p_ends_on: form.ends_on || null,
      p_active: form.active,
      p_memo: form.memo || null,
      p_slot: form.slot,
      p_size: form.size,
      p_sort: Number(form.sort) || 100,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setErr("");
    setForm(null);
    load();
  }

  async function toggle(a) {
    await supabase.rpc("admin_ad_save", {
      p_id: a.id, p_advertiser: a.advertiser, p_title: a.title, p_image_path: a.image_path, p_link_url: a.link_url,
      p_starts_on: a.starts_on, p_ends_on: a.ends_on, p_active: !a.active, p_memo: a.memo, p_slot: a.slot, p_size: a.size, p_sort: a.sort,
    });
    load();
  }

  async function remove(a) {
    if (!window.confirm(`'${a.advertiser}' 광고를 지울까요? 노출·클릭 기록도 같이 지워져요.\n기록을 남기려면 '끄기'를 쓰세요.`)) return;
    const { data: path, error } = await supabase.rpc("admin_ad_delete", { p_id: a.id });
    if (error) return setErr(error.message);
    if (path) await supabase.storage.from("ads").remove([path]);
    load();
  }

  const inp = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-sm-navy";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[16px] font-extrabold text-sm-navy">메인 광고</p>
          <p className="mt-0.5 text-[12.5px] text-gray-500">맨 위 배너(3곳까지) · 오른쪽 띠 배너(4곳까지) · 켜져 있고 기간 안인 광고가 '순서'대로 보여요 · 노출·클릭은 하루·기기당 1번으로 세요</p>
        </div>
        <button onClick={() => setForm({ ...EMPTY, starts_on: today() })} className="h-10 rounded-lg bg-sm-navy px-4 text-[14px] font-bold text-white">
          + 광고 추가
        </button>
      </div>

      <Inquiries />

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] font-bold text-red-600">{err}</p>}

      {/* 추가·수정 */}
      {form && (
        <div className="rounded-xl border-2 border-sm-navy bg-white p-5">
          <p className="text-[15px] font-extrabold text-sm-navy">{form.id ? "광고 고치기" : "새 광고"}</p>
          <p className="mt-3 text-[12.5px] font-bold text-gray-600">광고 자리</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            {PLACES.map((p) => {
              const on = placeOf(form).k === p.k;
              return (
                <button key={p.k} type="button" onClick={() => setForm((f) => ({ ...f, slot: p.slot, size: p.size }))} className={`rounded-xl border-2 p-3 text-left ${on ? "border-sm-navy bg-indigo-50" : "border-gray-200"}`}>
                  <b className="block text-[13.5px] text-sm-navy">{p.label}</b>
                  <span className="text-[11.5px] text-gray-500">{p.hint}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
            <div>
              <div className={`flex ${placeOf(form).ratio} items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50`}>
                {form.image_path ? <img src={imgUrl(form.image_path)} alt="" className="h-full w-full object-cover" /> : <span className="text-[12.5px] text-gray-400">배너 이미지</span>}
              </div>
              <label className="mt-2 block cursor-pointer rounded-lg border border-gray-300 py-2 text-center text-[13px] font-bold text-gray-700">
                {busy ? "올리는 중…" : form.image_path ? "이미지 바꾸기" : "이미지 올리기"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
              </label>
              <p className="mt-1 text-[11.5px] text-gray-400">권장 {placeOf(form).hint.split(" · ")[0]} · 5MB 이하</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12.5px] font-bold text-gray-600">업체명 *<input value={form.advertiser} onChange={(e) => set("advertiser", e.target.value)} className={inp} /></label>
              <label className="text-[12.5px] font-bold text-gray-600">배너 설명 (이미지 대신 읽히는 글)<input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="예: ○○수학 겨울방학 특강" className={inp} /></label>
              <label className="text-[12.5px] font-bold text-gray-600 sm:col-span-2">누르면 갈 주소 *<input value={form.link_url} onChange={(e) => set("link_url", e.target.value.trim())} className={inp} /></label>
              <label className="text-[12.5px] font-bold text-gray-600">순서 (작을수록 위·왼쪽)<input type="number" value={form.sort ?? 100} onChange={(e) => set("sort", e.target.value)} className={inp} /></label>
              <div />
              <label className="text-[12.5px] font-bold text-gray-600">시작일<input type="date" value={form.starts_on ?? ""} onChange={(e) => set("starts_on", e.target.value)} className={inp} /></label>
              <label className="text-[12.5px] font-bold text-gray-600">끝나는 날 (비우면 계속)<input type="date" value={form.ends_on ?? ""} onChange={(e) => set("ends_on", e.target.value)} className={inp} /></label>
              <label className="text-[12.5px] font-bold text-gray-600 sm:col-span-2">메모 (계약 금액·담당자 등 · 학생에게 안 보임)<input value={form.memo ?? ""} onChange={(e) => set("memo", e.target.value)} className={inp} /></label>
              <label className="flex items-center gap-2 text-[13.5px] font-bold text-gray-700">
                <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="h-5 w-5" /> 켜기 (바로 보이기)
              </label>
            </div>
          </div>
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
            이용자 대부분이 고등학생이에요. 술·담배·도박·대출·성인·다이어트약 등 청소년에게 맞지 않는 광고는 올리지 마세요. 링크 들어간 곳도 한 번 확인해 주세요.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className="h-11 flex-1 rounded-lg bg-sm-navy text-[14px] font-bold text-white disabled:opacity-50">저장</button>
            <button onClick={() => setForm(null)} className="h-11 rounded-lg border border-gray-300 px-5 text-[14px] font-bold text-gray-600">닫기</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {list === null && !err && <p className="py-10 text-center text-[13px] text-gray-400">불러오는 중…</p>}
      {list?.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 py-10 text-center text-[13.5px] text-gray-500">아직 광고가 없어요. 광고가 없으면 메인에 광고칸이 안 보여요.</p>}
      {list?.map((a) => (
        <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-[180px_1fr_260px]">
            <img src={imgUrl(a.image_path)} alt={a.title} className={`${placeOf(a).ratio} w-full self-start rounded-lg object-cover`} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[15.5px] text-gray-900">{a.advertiser}</b>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">{placeOf(a).label} · 순서 {a.sort}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${a.live ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                  {a.live ? "보이는 중" : !a.active ? "꺼짐" : "기간 밖"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12.5px] text-gray-500">{a.title}</p>
              <a href={a.link_url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[12.5px] text-indigo-600 underline">{a.link_url}</a>
              <p className="mt-1 text-[12px] text-gray-500">{a.starts_on} ~ {a.ends_on ?? "계속"}{a.memo ? ` · ${a.memo}` : ""}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-gray-50 py-2"><p className="text-[11px] text-gray-500">노출 (기간)</p><b className="text-[16px] text-sm-navy">{n(a.views)}</b></div>
                <div className="rounded-lg bg-gray-50 py-2"><p className="text-[11px] text-gray-500">클릭 (기간)</p><b className="text-[16px] text-sm-orange">{n(a.clicks)}</b></div>
                <div className="rounded-lg bg-gray-50 py-2"><p className="text-[11px] text-gray-500">클릭률</p><b className="text-[16px] text-gray-900">{ctr(a.clicks, a.views)}</b></div>
              </div>
              <p className="mt-1.5 text-[11.5px] text-gray-400">전체 누적 · 노출 {n(a.views_all)} · 클릭 {n(a.clicks_all)} · 클릭률 {ctr(a.clicks_all, a.views_all)}</p>
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-bold text-gray-500">최근 14일 <span className="font-normal text-indigo-300">■ 노출</span> <span className="font-normal text-sm-orange">■ 클릭</span></p>
              <Daily rows={a.daily ?? []} />
              <div className="mt-3 flex gap-1.5">
                <button onClick={() => setForm({ ...a, ends_on: a.ends_on ?? "" })} className="h-9 flex-1 rounded-lg border border-gray-300 text-[12.5px] font-bold text-gray-700">고치기</button>
                <button onClick={() => toggle(a)} className="h-9 flex-1 rounded-lg border border-gray-300 text-[12.5px] font-bold text-gray-700">{a.active ? "끄기" : "켜기"}</button>
                <button onClick={() => remove(a)} className="h-9 rounded-lg border border-red-200 px-3 text-[12.5px] font-bold text-red-500">지우기</button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}