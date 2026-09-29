import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { track } from "../../lib/track";
import StepBar from "./StepBar";
import Paywall from "./Paywall";
import { isFreeInquiry } from "./freeInquiry";
import InquirySwitcher from "./InquirySwitcher";

/*
 * 탐구 준비 — 상위 1% 주제로 탐구 방법 추천 + 탐구팩
 * /inquiry/new  (결과 화면에서 { topic, focus }를 들고 옴) → 새로 만들고 /inquiry/:id 로 바뀜
 * /inquiry/:id  (저장된 탐구 다시 열기)
 * 노트북·태블릿 화면 기준. 휴대폰에서는 안내를 띄우고 한 줄로 보여준다.
 */

const METHODS = [
  { k: "lit", label: "문헌 탐구", desc: "논문·기사·도서·공식자료를 찾아 비교해요" },
  { k: "case", label: "사례 탐구", desc: "여러 사례를 같은 기준으로 비교해요" },
  { k: "data", label: "데이터 탐구", desc: "공공데이터·통계로 수치와 관계를 봐요" },
  { k: "survey", label: "설문조사 탐구", desc: "문항을 받아 친구들에게 직접 조사해요" },
  { k: "exp", label: "실험 탐구", desc: "변인·순서·기록표를 받아 직접 측정해요" },
  { k: "obs", label: "관찰 탐구", desc: "기준표를 받아 일정 기간 기록해요" },
];
const METHOD_NAME = Object.fromEntries(METHODS.map((m) => [m.k, m.label]));

/* 위쪽 단계 표시 */

/* 글 목록 한 칸 */
function List({ title, items }) {
  if (!items?.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-extrabold text-sm-navy">{title}</h3>
      <ul className="space-y-1.5 text-[14px] leading-relaxed text-gray-700">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-sm-orange">·</span>
            <span>{typeof x === "string" ? x : JSON.stringify(x)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* 빈 기록표 — 실험·관찰 */
function RecordTable({ table }) {
  if (!table?.rows?.length || !table?.cols?.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-extrabold text-sm-navy">
        기록표 {table.unit ? <span className="text-[12.5px] font-bold text-gray-400">단위 {table.unit}</span> : null}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-3 py-2 text-left text-gray-500"> </th>
              {table.cols.map((c) => (
                <th key={c} className="border border-gray-200 px-3 py-2 text-gray-500">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r}>
                <td className="border border-gray-200 px-3 py-2.5 font-bold text-sm-navy">{r}</td>
                {table.cols.map((c) => (
                  <td key={c} className="border border-gray-200 px-3 py-2.5" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-gray-400">인쇄해서 채우거나, 결과 올리기에서 바로 입력하면 돼요.</p>
    </section>
  );
}

/* 문헌·사례·데이터 — 자료 조사를 직접 할지, AI가 찾아줄지 */
const RESEARCH = ["lit", "case", "data"];

function ResearchChoice({ onPick, busy }) {
  return (
    <div className="rounded-2xl border-2 border-sm-navy/10 bg-indigo-50/60 p-5">
      <p className="text-[16px] font-extrabold text-sm-navy">자료 조사를 어떻게 할까요?</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <button onClick={() => onPick("self")} disabled={busy} className="rounded-xl border-2 border-gray-200 bg-white p-4 text-left hover:border-sm-navy disabled:opacity-50">
          <p className="text-[15.5px] font-extrabold text-sm-navy">내가 직접 찾기</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">아래 검색어·찾을 곳을 보고<br />내가 자료를 모아요</p>
        </button>
        <button onClick={() => onPick("ai")} disabled={busy} className="rounded-xl border-2 border-sm-navy bg-sm-navy p-4 text-left text-white disabled:opacity-50">
          <p className="text-[15.5px] font-extrabold">AI가 찾아주기</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-indigo-100">AI가 인터넷에서 실제 자료를 찾아<br />링크·요약까지 정리해요</p>
        </button>
      </div>
    </div>
  );
}

/*
 * 자료 목록 — AI가 찾은 자료 + 내가 찾아 추가한 자료
 * '보고서에 쓰기'로 고른 자료만 3단계에서 AI가 읽고 요약한다
 */
function SourceList({ list, onOpen, onToggle, onAdd, onRemove, showAi }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const shown = list.map((x, i) => ({ ...x, i })).filter((x) => showAi || x.added_by === "me");
  const picked = list.filter((x) => x.selected).length;
  const okUrl = /^https?:\/\/\S+\.\S+/.test(url.trim());

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-extrabold text-sm-navy">{showAi ? "자료 고르기" : "내가 찾은 자료"}</h3>
        <span className="rounded-full bg-sm-navy px-2.5 py-0.5 text-[12px] font-bold text-white">보고서에 쓸 자료 {picked}개</span>
      </div>
      <p className="rounded-lg bg-orange-50 px-4 py-2.5 text-[12.5px] leading-relaxed text-orange-900">
        {showAi ? "AI가 인터넷에서 찾은 자료예요. " : ""}
        <b>직접 열어서 확인하고, 보고서에 쓸 자료만 골라요.</b> 고른 자료만 3단계에서 AI가 읽고 요약해요.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((x) => (
          <div key={x.i} className={`rounded-xl border-2 p-4 ${x.selected ? "border-sm-navy bg-indigo-50/40" : "border-gray-200"}`}>
            <p className="text-[12px] font-bold text-sm-orange">
              {x.added_by === "me" ? "내가 찾은 자료" : `${x.kind ?? ""}${x.publisher ? ` · ${x.publisher}` : ""}`}
            </p>
            <p className="mt-1 text-[14px] font-bold leading-snug text-sm-navy">{x.title}</p>
            {x.summary && <p className="mt-2 text-[12.5px] leading-relaxed text-gray-600">{x.summary}</p>}
            {x.use && <p className="mt-1.5 text-[12.5px] leading-relaxed text-sm-navy"><b>이렇게 써요</b> · {x.use}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a
                href={x.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => onOpen(x.i)}
                className={`flex h-10 items-center justify-center rounded-lg border text-[13px] font-bold ${x.opened ? "border-green-400 text-green-700" : "border-sm-navy text-sm-navy"}`}
              >
                {x.opened ? "확인했어요 ✓" : "열어서 확인 ↗"}
              </a>
              <button
                onClick={() => onToggle(x.i)}
                className={`h-10 rounded-lg text-[13px] font-bold ${x.selected ? "bg-sm-navy text-white" : "border border-gray-300 text-gray-600"}`}
              >
                {x.selected ? "보고서에 쓰기 ✓" : "보고서에 쓰기"}
              </button>
            </div>
            {x.added_by === "me" && (
              <button onClick={() => onRemove(x.i)} className="mt-2 text-[12px] font-bold text-gray-400 underline">지우기</button>
            )}
          </div>
        ))}
      </div>

      {/* 내가 찾은 자료 추가 */}
      <div className="rounded-xl border border-dashed border-gray-300 p-4">
        <p className="text-[13.5px] font-bold text-sm-navy">내가 찾은 자료 추가</p>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="자료 제목" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-sm-navy" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="링크 (https://…)" className="rounded-lg border border-gray-300 px-3 py-2 text-[13px] outline-none focus:border-sm-navy" />
          <button
            disabled={!title.trim() || !okUrl}
            onClick={() => {
              onAdd({ title: title.trim(), url: url.trim() });
              setTitle("");
              setUrl("");
            }}
            className="rounded-lg bg-sm-navy px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            추가
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] text-gray-400">링크가 없는 책은 제목만 적고 3단계에서 내용을 직접 적어요.</p>
      </div>
    </section>
  );
}

/* 방법별 탐구팩 본문 */
function PackBody({ method, pack }) {
  const p = pack?.pack ?? {};
  const [copied, setCopied] = useState(false);

  // 설문 문항을 구글 폼에 붙여넣기 좋게
  function copySurvey() {
    const text = [
      p.intro,
      "",
      ...(p.questions ?? []).map(
        (q, i) => `${i + 1}. ${q.text}${q.options?.length ? "\n" + q.options.map((o) => `  - ${o}`).join("\n") : ""}`
      ),
    ].join("\n");
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => window.prompt("복사해 주세요", text));
  }

  if (method === "survey")
    return (
      <div className="space-y-6">
        {p.target && <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>조사 대상</b> · {p.target} {p.sample ? `(권장 ${p.sample})` : ""}</p>}
        {p.intro && <p className="rounded-lg bg-orange-50 px-4 py-3 text-[13px] leading-relaxed text-orange-900"><b>설문 첫머리 안내</b> · {p.intro}</p>}
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-extrabold text-sm-navy">설문 문항 · {p.questions?.length ?? 0}개</h3>
            <button onClick={copySurvey} className="ml-auto rounded-lg border border-sm-navy px-3 py-1.5 text-[13px] font-bold text-sm-navy">
              {copied ? "복사했어요 · 구글 폼에 붙여넣기" : "구글 폼용으로 복사"}
            </button>
          </div>
          <ol className="divide-y divide-gray-100">
            {(p.questions ?? []).map((q, i) => (
              <li key={i} className="flex gap-3 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sm-navy text-[12px] font-extrabold text-white">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-[14px] font-bold text-sm-navy">{q.text}</p>
                  {q.options?.length > 0 && <p className="mt-1 text-[12.5px] text-gray-500">{q.options.map((o, j) => `${j + 1} ${o}`).join("  ·  ")}</p>}
                </div>
                <span className="h-fit rounded bg-indigo-50 px-2 py-0.5 text-[11.5px] font-bold text-gray-500">{q.type}</span>
              </li>
            ))}
          </ol>
        </section>
        <List title="배포 방법" items={p.distribute} />
      </div>
    );

  if (method === "exp")
    return (
      <div className="space-y-6">
        {p.hypothesis && <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>가설</b> · {p.hypothesis}</p>}
        {p.variables && (
          <section className="grid grid-cols-3 gap-3 text-[13.5px]">
            <div className="rounded-lg bg-indigo-50 p-3"><p className="text-[12px] font-bold text-gray-500">바꾸는 것</p><p className="mt-1 font-bold text-sm-navy">{p.variables.change}</p></div>
            <div className="rounded-lg bg-orange-50 p-3"><p className="text-[12px] font-bold text-gray-500">재는 것</p><p className="mt-1 font-bold text-sm-navy">{p.variables.measure}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-[12px] font-bold text-gray-500">같게 둘 것</p><p className="mt-1 font-bold text-sm-navy">{(p.variables.control ?? []).join(", ")}</p></div>
          </section>
        )}
        <List title="준비물" items={p.materials} />
        <List title={`실험 순서${p.repeats ? ` · ${p.repeats}` : ""}`} items={p.procedure} />
        <RecordTable table={p.record_table} />
        {p.safety?.length > 0 && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="text-[14px] font-extrabold text-red-700">안전 주의</h3>
            <ul className="mt-1 space-y-1 text-[13px] text-red-800">{p.safety.map((s, i) => <li key={i}>· {s}</li>)}</ul>
          </section>
        )}
      </div>
    );

  if (method === "obs")
    return (
      <div className="space-y-6">
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>관찰 대상</b> · {p.target} &nbsp; <b>기간</b> · {p.period}</p>
        {p.criteria?.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-[15px] font-extrabold text-sm-navy">판단 기준</h3>
            <div className="grid grid-cols-2 gap-2">
              {p.criteria.map((c, i) => (
                <div key={i} className="rounded-lg bg-gray-50 p-3 text-[13px]"><b className="text-sm-navy">{c.level}</b> · {c.desc}</div>
              ))}
            </div>
          </section>
        )}
        <RecordTable table={p.record_table} />
        <List title="매번 확인할 것" items={p.checklist} />
      </div>
    );

  if (method === "lit")
    return (
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-[15px] font-extrabold text-sm-navy">찾을 자료</h3>
          <div className="grid grid-cols-2 gap-3">
            {(p.sources ?? []).map((s, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-4">
                <p className="text-[12px] font-bold text-sm-orange">{s.kind}</p>
                <p className="mt-1 text-[14px] font-bold text-sm-navy">{s.what}</p>
                <p className="mt-2 text-[12.5px] text-gray-500">검색어 · {(s.keywords ?? []).join(", ")}</p>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-gray-400">자료 제목은 직접 찾은 것만 적어요. AI는 없는 자료를 만들지 않아요.</p>
        </section>
        <List title="찾아볼 곳" items={p.where} />
        <List title="자료를 비교할 기준" items={p.criteria} />
        <List title="자료마다 적어둘 것" items={p.record} />
      </div>
    );

  if (method === "case")
    return (
      <div className="space-y-6">
        <section className="grid grid-cols-3 gap-3">
          {(p.cases ?? []).map((c, i) => (
            <div key={i} className="rounded-xl border border-gray-200 p-4">
              <p className="text-[16px] font-extrabold text-sm-navy">{c.name}</p>
              <p className="mt-1 text-[13px] text-gray-600">{c.why}</p>
            </div>
          ))}
        </section>
        <List title="비교 기준" items={p.criteria} />
        <List title="사례마다 기록할 것" items={p.record} />
        <List title="찍어두면 좋은 장면" items={p.photo} />
      </div>
    );

  // data
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-[15px] font-extrabold text-sm-navy">필요한 데이터</h3>
        {(p.datasets ?? []).map((d, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-4">
            <p className="text-[14px] font-bold text-sm-navy">{d.what}</p>
            <p className="mt-1 text-[12.5px] text-gray-500">찾을 곳 · {d.where} &nbsp; 검색어 · {(d.keywords ?? []).join(", ")}</p>
          </div>
        ))}
      </section>
      {p.variables && (
        <p className="rounded-lg bg-gray-50 px-4 py-3 text-[14px]"><b>비교 기준</b> · {p.variables.x} &nbsp; <b>확인할 값</b> · {p.variables.y}</p>
      )}
      <List title="분석 순서" items={p.analysis} />
    </div>
  );
}

/*
 * AI 함수 호출 — 서버가 오류 코드(403·404·429·502)와 함께 보낸 이유를 꺼내서 돌려준다
 * (supabase.functions.invoke는 오류 코드면 data를 비우고 이유를 error.context 안에 넣는다)
 */
async function callInquiry(body) {
  const { data, error } = await supabase.functions.invoke("inquiry", { body });
  if (!error) return data?.error ? { message: data.error, paywall: data.paywall, inquiry: data.inquiry } : { data };

  let message = "탐구팩을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
  try {
    const res = error.context;
    const status = res?.status;
    const payload = await res?.json?.();
    if (payload?.error) message = payload.error;
    if (payload?.paywall) return { message, paywall: true, inquiry: payload.inquiry ?? null }; // 결제 대기로 저장된 탐구
    else if (status === 404) message = "탐구 준비 기능이 아직 서버에 올라가지 않았어요. (inquiry 함수 배포 확인)";
    console.error("inquiry failed", status, payload ?? error);
  } catch (e) {
    console.error("inquiry failed", error);
  }
  return { message };
}

export default function InquiryPrepare() {
  const { id } = useParams();
  const { state } = useLocation();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [inq, setInq] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false); // 탐구팩 만드는 중
  const [searching, setSearching] = useState(false); // AI가 자료 찾는 중
  const [wall, setWall] = useState(null); // 결제 팝업 { reason }
  const [building, setBuilding] = useState(false); // 결제 대기 탐구 → 탐구팩 만드는 중
  const buildingRef = useRef(false);
  const [needPick, setNeedPick] = useState(false); // '보고서에 쓰기' 자료를 안 골랐을 때 팝업
  const sourceArea = useRef(null); // 팝업에서 '자료 고르러 가기' 누르면 여기로 내려간다
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (user) supabase.rpc("is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, [user]);
  // 무료 체험 탐구인지 (null = 확인 중) — 보고서 디자인까지 무료, PDF 저장만 이용권
  const [free, setFree] = useState(null);
  useEffect(() => {
    if (!user || !inq?.id) return;
    isFreeInquiry(user.id, inq.id).then(setFree);
  }, [user, inq?.id, Boolean(inq?.pack)]);
  const locked = inq && !inq.paid && !isAdmin && free === false; // 이용권이 필요한 탐구

  // 잠겨 있는 동안 — 관리자가 승인하는 순간 실시간으로 받아서 연다 (예비로 30초마다, 화면으로 돌아올 때도)
  const [justOpened, setJustOpened] = useState(false);
  useEffect(() => {
    if (!inq?.id || inq.paid || isAdmin || !user) return;
    const check = () =>
      supabase.from("inquiries").select("paid").eq("id", inq.id).maybeSingle().then(({ data }) => {
        if (!data?.paid) return;
        setInq((x) => ({ ...x, paid: true }));
        setWall(null);
        setJustOpened(true);
      });
    const ch = supabase
      .channel(`prepare-order-${inq.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pay_orders", filter: `user_id=eq.${user.id}` }, (e) => {
        if (e.new?.status === "approved") check();
      })
      .subscribe();
    const t = setInterval(() => document.visibilityState === "visible" && check(), 30000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [inq?.id, inq?.paid, isAdmin, user]);

  // 팝업은 Esc로도 닫기
  useEffect(() => {
    if (!needPick) return;
    const onKey = (e) => e.key === "Escape" && setNeedPick(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [needPick]);

  // 결제 후(이용권으로 열림) 다시 불러오기
  async function reload() {
    const { data } = await supabase.from("inquiries").select("*").eq("id", inq.id).maybeSingle();
    if (data) setInq((x) => ({ ...data, research_view: x?.research_view }));
    setWall(null);
    if (data?.paid) setJustOpened(true);
    if (data && !data.pack) buildPack(data); // 결제 대기였던 탐구 → 이제 탐구팩 만들기
  }

  // 결제 대기 탐구의 탐구팩 만들기 — 같은 진단으로 start를 다시 부르면 서버가 저장된 줄을 채운다
  async function buildPack(row = inq) {
    if (buildingRef.current || !row?.query_id) return;
    buildingRef.current = true;
    setBuilding(true);
    setErr("");
    const { data, message, paywall } = await callInquiry({ action: "start", query_id: row.query_id });
    buildingRef.current = false;
    setBuilding(false);
    if (paywall) return setWall({ reason: "start" });
    if (message) return setErr(message);
    setInq(data.inquiry);
  }

  // 결제 대기 탐구가 입금 승인으로 열리면(paid) 바로 탐구팩 만들기
  useEffect(() => {
    if (inq?.id && !inq.pack && inq.paid) buildPack(inq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inq?.id, inq?.paid, Boolean(inq?.pack)]);
  const started = useRef(false);

  // 새로 만들기 또는 불러오기
  useEffect(() => {
    if (authLoading || !user || started.current) return;
    started.current = true;

    (async () => {
      if (id === "new") {
        if (!state?.topic && !state?.query_id) return nav("/", { replace: true });
        setBusy(true);
        const { data, message, paywall, inquiry: pending } = await callInquiry({
          action: "start",
          query_id: state.query_id,
          topic: state.topic,
          focus: state.focus,
          department: state.department,
          subject: state.subject,
          grade: state.grade,
          term: state.term,
        });
        setBusy(false);
        if (paywall) {
          setWall({ reason: "start" });
          // 주제는 '결제 대기'로 저장됨 → 그 탐구 화면으로 바꿔 두고 결제 창을 띄운다
          if (pending) {
            setInq(pending);
            return nav(`/inquiry/${pending.id}`, { replace: true });
          }
          return setErr(message);
        }
        if (message) return setErr(message);
        setInq(data.inquiry);
        nav(`/inquiry/${data.inquiry.id}`, { replace: true });
      } else {
        const { data, error } = await supabase.from("inquiries").select("*").eq("id", id).maybeSingle();
        if (error || !data) return setErr("탐구를 찾지 못했어요.");
        setInq(data);
      }
      track("pack_view");
    })();
  }, [authLoading, user, id, state, nav]);

  // 방법 바꾸기
  async function switchMethod(method) {
    if (!inq || method === inq.method || busy) return;
    setBusy(true);
    const { data, message } = await callInquiry({ action: "pack", inquiry_id: inq.id, method });
    setBusy(false);
    if (message) return setErr(message);
    setErr("");
    setInq(data.inquiry);
  }

  // 자료 조사 방식 고르기 — 처음 고른 것만 research_mode에 남긴다
  async function pickResearch(m) {
    if (m === "ai" && locked) return setWall({ reason: "research" });
    track(m === "ai" ? "research_ai" : "research_self", inq.method);
    let row = inq;
    if (!inq.research_mode) {
      const { data } = await supabase.from("inquiries").update({ research_mode: m }).eq("id", inq.id).select("*").single();
      if (data) row = data;
    }
    setInq({ ...row, research_view: m });
    if (m === "ai" && !row.sources?.list?.some((x) => x.added_by !== "me")) findSources(row);
  }

  // AI가 실제 자료 찾기 (웹 검색, 30초~1분)
  async function findSources(row = inq) {
    setSearching(true);
    setErr("");
    const { data, message } = await callInquiry({ action: "research", inquiry_id: row.id });
    setSearching(false);
    if (message) return setErr(message);
    setInq({ ...data.inquiry, research_view: "ai" });
  }

  // 자료 목록 저장 (열어봄·고름·추가·삭제 공통)
  function saveList(list) {
    const sources = { ...(inq.sources ?? {}), list };
    setInq((x) => ({ ...x, sources }));
    supabase.from("inquiries").update({ sources }).eq("id", inq.id).then(({ error }) => error && console.warn(error));
  }
  const listOf = () => inq.sources?.list ?? [];

  function openSource(i) {
    track("source_open", inq.method);
    saveList(listOf().map((x, k) => (k === i ? { ...x, opened: true } : x)));
  }
  function toggleSource(i) {
    saveList(listOf().map((x, k) => (k === i ? { ...x, selected: !x.selected } : x)));
  }
  function addSource({ title, url }) {
    saveList([...listOf(), { title, url, added_by: "me", selected: true, opened: true }]);
  }
  function removeSource(i) {
    saveList(listOf().filter((_, k) => k !== i));
  }

  // 결과 올리기 — 문헌·사례·데이터는 '보고서에 쓰기'로 고른 자료가 1개 이상 있어야 넘어간다
  function goResult() {
    if (RESEARCH.includes(inq.method) && !listOf().some((x) => x.selected)) {
      track("result_blocked_no_source", inq.method);
      return setNeedPick(true);
    }
    if (locked) return setWall({ reason: "result" });
    nav(`/inquiry/${inq.id}/result`);
  }
  function goPick() {
    setNeedPick(false);
    sourceArea.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // 메모 저장 (입력을 멈추고 0.8초 뒤)
  const memoTimer = useRef(null);
  function onMemo(v) {
    setInq((x) => ({ ...x, memo: v }));
    clearTimeout(memoTimer.current);
    memoTimer.current = setTimeout(() => {
      supabase.from("inquiries").update({ memo: v }).eq("id", inq.id).then(({ error }) => error && console.warn(error));
    }, 800);
  }

  if (authLoading) return <div className="py-40 text-center text-gray-400">불러오는 중…</div>;
  if (!user) return <div className="py-40 text-center text-gray-500">로그인이 필요합니다.</div>;

  const pack = inq?.pack;
  const hasList = (inq?.sources?.list ?? []).length > 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="flex h-[60px] items-center gap-6 border-b border-gray-200 bg-white px-6">
        <button onClick={() => nav("/")} className="text-[20px] font-extrabold text-sm-navy">
          생수면<span className="text-sm-orange">.</span>
        </button>
        <div className="hidden md:block"><StepBar active={1} id={inq?.id ?? id} stage={inq?.stage} /></div>
        <div className="ml-auto"><InquirySwitcher currentId={inq?.id} /></div>
      </header>

      {/* 휴대폰 안내 */}
      <p className="bg-orange-50 px-5 py-3 text-center text-[13px] font-bold text-orange-800 md:hidden">
        탐구 준비부터는 노트북·태블릿에서 보기 편해요. 같은 계정으로 로그인하면 이어서 볼 수 있어요.
      </p>

      {err && <p className="mx-auto mt-6 max-w-3xl rounded-lg bg-red-50 px-4 py-3 text-center text-[14px] font-bold text-red-600">{err}</p>}

      {!inq && !err && (
        <div className="py-40 text-center">
          <p className="text-[16px] font-bold text-sm-navy">탐구 방법을 고르고, 탐구팩을 만들고 있어요</p>
          <p className="mt-2 text-[13px] text-gray-500">20~40초 걸려요</p>
        </div>
      )}

      {/* 결제 대기 — 주제만 저장된 탐구 */}
      {inq && !inq.pack && (
        <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-[12px] font-bold text-sm-orange">{building ? "탐구팩 만드는 중" : "결제 대기"}</p>
          <h1 className="mt-2 text-[19px] font-extrabold leading-snug text-sm-navy">{inq.suggestion}</h1>
          <p className="mt-1 text-[12.5px] text-gray-500">{[inq.department, inq.grade, inq.subject].filter(Boolean).join(" · ")}</p>
          <p className="mt-4 text-[13.5px] leading-relaxed text-gray-600">
            {building ? (
              "탐구 방법을 고르고 탐구팩을 만들고 있어요. 20~40초 걸려요."
            ) : (
              <>
                이 주제는 ‘내 탐구’에 저장해 두었어요.
                <br />
                이용권으로 열면 탐구 방법 추천과 탐구팩을 바로 만들어 드려요.
              </>
            )}
          </p>
          {!building && (
            <button
              onClick={() => (inq.paid ? buildPack() : setWall({ reason: "start" }))}
              className="mt-6 h-[52px] w-72 rounded-xl bg-sm-navy text-[15px] font-extrabold text-white"
            >
              {inq.paid ? "탐구팩 만들기" : "이용권으로 열기"}
            </button>
          )}
          {!building && !inq.paid && (
            <p className="mt-3 text-[12px] text-gray-400">입금했다면 관리자 승인 뒤 이 화면이 자동으로 열려요.</p>
          )}
        </div>
      )}

      {inq?.pack && (
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-5 lg:flex-row">
          {/* 왼쪽 — 탐구 방법 */}
          <aside className="space-y-2 lg:w-[250px] lg:shrink-0">
            <p className="px-1 text-[12px] font-bold text-gray-500">탐구 방법</p>
            {METHODS.map((m) => {
              const on = inq.method === m.k;
              const rec = pack?.recommended === m.k;
              // AI가 고른 방법(지금 탐구팩)만 쓴다 — 다른 방법은 흐리게 막는다
              const off = !on;
              return (
                <button
                  key={m.k}
                  type="button"
                  disabled={off || busy}
                  aria-disabled={off}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    on ? "border-sm-navy bg-sm-navy text-white" : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 opacity-60"
                  }`}
                >
                  <p className="text-[14px] font-extrabold">
                    {m.label} {rec && <span className={`text-[11.5px] ${on ? "text-orange-200" : "text-sm-orange"}`}>AI 추천</span>}
                  </p>
                  <p className={`mt-0.5 text-[12px] ${on ? "text-indigo-100" : "text-gray-400"}`}>{m.desc}</p>
                </button>
              );
            })}
            <p className="px-1 text-[12px] leading-relaxed text-gray-500">
              AI가 이 주제에 가장 잘 맞는 방법을 골랐어요. 탐구팩은 이 방법으로 만들어져요.
            </p>
            {busy && <p className="px-1 text-[12.5px] font-bold text-sm-orange">탐구팩을 만드는 중…</p>}
          </aside>

          {/* 가운데 — 탐구팩 */}
          <main className="min-w-0 flex-1 space-y-5 rounded-2xl border border-gray-200 bg-white p-6">
            <div>
              <p className="text-[12px] font-bold text-sm-orange">{METHOD_NAME[inq.method]} 탐구팩</p>
              <h1 className="mt-1 text-[19px] font-extrabold leading-snug text-sm-navy">{inq.suggestion}</h1>
              <p className="mt-1 text-[12.5px] text-gray-500">{inq.department} · {inq.grade} · {inq.subject}</p>
            </div>
            {pack?.reason && <p className="rounded-lg bg-orange-50 px-4 py-3 text-[13px] leading-relaxed text-orange-900"><b>왜 이 방법?</b> {pack.reason}</p>}
            {pack?.purpose && <p className="text-[14px] leading-relaxed text-gray-700"><b className="text-sm-navy">탐구 목적</b> · {pack.purpose}</p>}
            {RESEARCH.includes(inq.method) && (
              <div ref={sourceArea} className="scroll-mt-5 space-y-5">
                {(() => {
                  const view = inq.research_view ?? inq.research_mode;
                  if (!view) return <ResearchChoice onPick={pickResearch} busy={searching} />;
                  if (view === "ai")
                    return searching ? (
                      <p className="rounded-xl bg-indigo-50 px-4 py-6 text-center text-[14px] font-bold text-sm-navy">
                        AI가 인터넷에서 실제 자료를 찾고 있어요… (30초~1분)
                      </p>
                    ) : inq.sources?.list?.some((x) => x.added_by !== "me") ? (
                      <>
                        <SourceList list={inq.sources.list} onOpen={openSource} onToggle={toggleSource} onAdd={addSource} onRemove={removeSource} showAi />
                        <button onClick={() => pickResearch("self")} className="text-[12.5px] font-bold text-gray-500 underline">
                          검색어를 보고 직접 더 찾기
                        </button>
                      </>
                    ) : (
                      <button onClick={() => findSources()} className="h-11 w-full rounded-lg bg-sm-navy text-[14px] font-bold text-white">
                        AI가 자료 찾기
                      </button>
                    );
                  return (
                    <>
                      <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
                        <p className="text-[13px] text-gray-600">아래 <b>검색어·찾을 곳</b>을 보고 직접 찾아서, 찾은 자료를 추가해요.</p>
                        <button onClick={() => pickResearch("ai")} className="ml-auto shrink-0 rounded-lg border border-sm-navy px-3 py-1.5 text-[12.5px] font-bold text-sm-navy">
                          {inq.sources?.list?.some((x) => x.added_by !== "me") ? "AI가 찾은 자료 보기" : "AI가 찾아주기"}
                        </button>
                      </div>
                      <SourceList list={listOf()} onOpen={openSource} onToggle={toggleSource} onAdd={addSource} onRemove={removeSource} showAi={false} />
                    </>
                  );
                })()}
              </div>
            )}

            {/* AI가 찾은 자료를 보는 중에는 탐구팩(검색어 안내)을 아래로 접어둔다 */}
            {(inq.research_view ?? inq.research_mode) === "ai" && RESEARCH.includes(inq.method) ? (
              <details className="rounded-xl border border-gray-200 p-4">
                <summary className="cursor-pointer text-[13.5px] font-bold text-sm-navy">탐구팩 (검색어·비교 기준) 펼쳐 보기</summary>
                <div className="mt-4"><PackBody method={inq.method} pack={pack} /></div>
              </details>
            ) : (
              <PackBody method={inq.method} pack={pack} />
            )}
          </main>

          {/* 오른쪽 — 할 일 · 선배 비교 · 메모 */}
          <aside className="space-y-4 lg:w-[320px] lg:shrink-0">
            {pack?.seniors?.count > 0 && (
              <div className="rounded-2xl bg-sm-navy p-5 text-white">
                <p className="text-[11.5px] font-bold text-orange-200">같은 학과 실제 세특 기록에서 찾았어요</p>
                <p className="mt-1 text-[15px] font-extrabold">비슷한 탐구 {pack.seniors.count >= 50 ? "50건 이상" : `${pack.seniors.count}건`}</p>
                <ul className="mt-2 space-y-1 text-[12.5px] text-indigo-100">
                  {pack.seniors.examples.map((e, i) => <li key={i}>· {e}</li>)}
                </ul>
                <p className="mt-2 text-[12.5px] text-white">직접 한 결과로 비교하면 이 기록들과 달라져요.</p>
              </div>
            )}

            <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-[12px] font-bold text-gray-500">AI가 준비한 것</p><p className="mt-1 text-[13px] font-bold text-sm-navy">방법 · 탐구팩 · 기록표</p></div>
                <div><p className="text-[12px] font-bold text-gray-500">내가 할 것</p><p className="mt-1 text-[13px] font-bold text-sm-orange">{pack?.do ?? "탐구하고 기록하기"}</p></div>
              </div>
              {pack?.memo_points?.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-[12.5px] font-bold text-sm-navy">탐구하면서 메모해 둘 것</p>
                  <ul className="mt-1 space-y-0.5 text-[12.5px] text-gray-600">{pack.memo_points.map((m, i) => <li key={i}>· {m}</li>)}</ul>
                </div>
              )}
              <textarea
                value={inq.memo ?? ""}
                onChange={(e) => onMemo(e.target.value)}
                rows={4}
                placeholder="막힌 점, 예상과 다른 점을 적어두면 보고서에 그대로 들어가요"
                className="w-full resize-none rounded-lg border border-gray-300 p-3 text-[13px] outline-none focus:border-sm-navy"
              />
            </div>

            {justOpened && (
              <p className="rounded-xl bg-green-50 px-4 py-3 text-center text-[13.5px] font-bold text-green-700">
                입금이 확인돼서 열렸어요! 결과를 올려 보세요.
              </p>
            )}
            <button
              onClick={goResult}
              className={`h-[52px] w-full rounded-xl text-[15px] font-extrabold text-white ${locked ? "bg-gray-400" : "bg-sm-navy"}`}
            >
              {locked ? "결과 올리기 · 이용권 필요" : "탐구 끝나면 · 결과 올리기"}
            </button>
            {locked && (
              <p className="text-center text-[12px] leading-relaxed text-gray-500">
                무료 체험 1건은 이미 썼어요.
                <br />
                이용권으로 열면 결과 분석·보고서 디자인·PDF까지 쓸 수 있어요.
              </p>
            )}
          </aside>
        </div>
      )}

      {/* '보고서에 쓰기' 자료를 안 고르고 결과 올리기를 눌렀을 때 */}
      {needPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={() => setNeedPick(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[420px] rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[18px] font-extrabold text-sm-navy">보고서에 쓸 자료를 골라 주세요</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
              {hasList ? (
                <>
                  자료 카드의 <b className="text-sm-navy">‘보고서에 쓰기’</b>를 하나 이상 눌러야 해요.
                  <br />
                  고른 자료만 3단계에서 AI가 읽고 비교표를 채워요.
                </>
              ) : (
                <>
                  아직 모은 자료가 없어요. 직접 찾거나 AI에게 찾아 달라고 한 뒤,
                  <br />
                  <b className="text-sm-navy">‘보고서에 쓰기’</b>로 쓸 자료를 골라요.
                </>
              )}
            </p>
            <button onClick={goPick} className="mt-5 h-12 w-full rounded-xl bg-sm-navy text-[15px] font-extrabold text-white">
              자료 고르러 가기
            </button>
          </div>
        </div>
      )}

      <Paywall open={Boolean(wall)} reason={wall?.reason} inquiryId={inq?.id} onClose={() => setWall(null)} onUnlocked={reload} />
    </div>
  );
}