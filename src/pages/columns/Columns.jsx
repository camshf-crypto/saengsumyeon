import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import Comments from "../../components/Comments";

/*
 * 입시 칼럼
 *   /columns      목록 — 다음 칼럼 예고 + 공개된 칼럼
 *   /columns/:id  읽기 — 본문 · 체크리스트(회원만) · 끝까지 읽기(+2점) · 관련 서비스 버튼 · 댓글
 * 본문 쓰는 법 (관리자 화면): 빈 줄 = 문단 나누기, "## " = 소제목, "> " = 강조 문장
 */

const CTA = {
  interview: { to: "/interview", title: "내 생기부로 예상질문 5개 무료로 받기", sub: "내 활동에서 면접관이 물을 질문을 바로 뽑아 줘요" },
  topic: { to: "/topic", title: "내 탐구주제, 흔한지 확인하기", sub: "9,780건 탐구주제와 비교해요" },
  reading: { to: "/reading", title: "내가 읽은 책, 흔한지 확인하기", sub: "독서 흔한가 진단" },
  motive: { to: "/motive", title: "내 지원동기, 흔한지 확인하기", sub: "지원동기 흔한가 진단" },
};

function whenLabel(iso) {
  const d = new Date(iso);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${days[d.getDay()]}요일 ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시`;
}
function dateLabel(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function Thumb({ c, big }) {
  const isImg = c.thumb && /^https?:\/\//.test(c.thumb);
  const size = big ? "h-[120px] w-full" : "h-[72px] w-[72px] sm:h-20 sm:w-20";
  if (isImg) return <img src={c.thumb} alt="" className={`${size} flex-none rounded-xl object-cover`} />;
  return (
    <span className={`${size} flex flex-none items-center justify-center rounded-xl bg-[#F4F5F7] text-[28px]`}>
      {c.thumb || "📰"}
    </span>
  );
}

function useToast() {
  const [msg, setMsg] = useState("");
  const t = useRef();
  const show = (m) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(""), 1800);
  };
  const node = msg ? (
    <div className="fixed bottom-24 left-1/2 md:bottom-8 z-50 -translate-x-1/2 rounded-[10px] bg-sm-navy/95 px-4 py-2.5 text-[13.5px] font-semibold text-white">
      {msg}
    </div>
  ) : null;
  return [node, show];
}

/* ───────── 목록 ───────── */

export function ColumnList() {
  const [list, setList] = useState(null);
  const [next, setNext] = useState(null);
  const { user } = useAuth();
  const uid = user?.id ?? null;

  useEffect(() => {
    supabase.rpc("col_list", { p_limit: 50 }).then(({ data }) => setList(data || []));
    supabase.rpc("col_next").then(({ data }) => setNext(data || null));
  }, [uid]);

  // 시리즈별 진행 (읽은 수 / 전체)
  const series = {};
  (list || []).forEach((c) => {
    if (!c.series) return;
    series[c.series] = series[c.series] || { total: 0, read: 0 };
    series[c.series].total += 1;
    if (c.read) series[c.series].read += 1;
  });

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <h1 className="text-[24px] font-bold tracking-tight text-sm-navy">입시 칼럼</h1>
        <p className="mt-1 text-[13.5px] text-gray-500">매주 화 · 목 오후 5시 · 3분이면 읽어요</p>

        {next && (
          <div className="relative mt-5 overflow-hidden rounded-2xl bg-sm-navy px-6 py-6 text-white">
            <small className="relative text-[12px] font-bold text-orange-300">다음 칼럼 · {whenLabel(next.publish_at)} 공개</small>
            <b className="relative mt-1.5 block text-[19px] font-bold tracking-tight">{next.title}</b>
            <span className="relative mt-1.5 block text-[12.5px] text-slate-300">물결 단계(Lv.11)부터는 하루 먼저 볼 수 있어요</span>
          </div>
        )}

        {Object.keys(series).length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.entries(series).map(([name, s]) => (
              <div key={name} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <b className="text-[14px] font-bold text-gray-900">{name}</b>
                  <small className="text-[12px] tabular-nums text-gray-500">{s.read}/{s.total}편 읽음</small>
                </div>
                <div className="mt-2 flex gap-1">
                  {Array.from({ length: s.total }).map((_, i) => (
                    <i key={i} className={`h-1 flex-1 rounded-full ${i < s.read ? "bg-sm-orange" : "bg-gray-200"}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-4 sm:px-5">
          {list === null && <p className="py-12 text-center text-[14px] text-gray-500">불러오는 중…</p>}
          {list?.length === 0 && <p className="py-12 text-center text-[14px] text-gray-500">첫 칼럼을 준비하고 있어요</p>}
          {list?.map((c) => (
            <Link key={c.id} to={`/columns/${c.id}`} className="flex items-center gap-4 border-b border-gray-100 py-4 last:border-0">
              <Thumb c={c} />
              <div className="min-w-0 flex-1">
                <span className="text-[11.5px] font-bold text-indigo-700">
                  {c.series ? `${c.series} ${c.series_no ?? ""}편` : "입시 칼럼"}
                  {c.early && <em className="ml-1.5 rounded bg-indigo-50 px-1.5 py-px not-italic text-indigo-700">물결 먼저 보기</em>}
                </span>
                <h3 className="mt-0.5 text-[15.5px] font-semibold leading-snug text-gray-900">{c.title}</h3>
                <div className="mt-1 flex gap-2 text-[12.5px] text-gray-500">
                  <span>{dateLabel(c.publish_at)}</span>
                  <span>{c.minutes}분</span>
                  <span>댓글 {c.comments}</span>
                  {c.read ? <span className="font-semibold text-emerald-600">✓ 읽음</span> : c.is_new && <span className="font-bold text-sm-orange">NEW</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── 본문 그리기 ───────── */

function Body({ text }) {
  const blocks = (text || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((b, i) => {
    if (b.startsWith("## ")) return <h2 key={i} className="mb-2 mt-8 text-[18px] font-bold tracking-tight text-sm-navy">{b.slice(3)}</h2>;
    if (b.startsWith("> "))
      return (
        <p key={i} className="my-6 border-l-4 border-sm-orange py-1 pl-4 text-[16px] font-bold leading-relaxed text-sm-navy">
          {b.replace(/^>\s?/gm, "")}
        </p>
      );
    return (
      <p key={i} className="my-4 whitespace-pre-line text-[15.5px] leading-[1.85] text-gray-800">
        {b}
      </p>
    );
  });
}

/* ───────── 읽기 ───────── */

export function ColumnRead() {
  const { id } = useParams();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const nav = useNavigate();
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  const [read, setRead] = useState(false);
  const [toastNode, toast] = useToast();
  const endRef = useRef(null);

  useEffect(() => {
    setC(null);
    setErr("");
    supabase.rpc("col_get", { p_id: Number(id) }).then(({ data, error }) => {
      if (error) return setErr(error.message);
      setC(data);
      setRead(Boolean(data?.read));
    });
  }, [id, uid]);

  // 맨 아래(체크리스트 끝)에 닿으면 '끝까지 읽음'
  useEffect(() => {
    if (!c || !uid || read || !endRef.current) return;
    const ob = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      ob.disconnect();
      const { data } = await supabase.rpc("col_read", { p_id: c.id });
      setRead(true);
      if (data?.first) {
        const { data: chk } = await supabase.rpc("lv_check");
        if (chk?.level_up) toast(`끝까지 읽었어요 · Lv.${chk.info.level}이 됐어요`);
        else toast("끝까지 읽었어요 · +2점");
      }
    });
    ob.observe(endRef.current);
    return () => ob.disconnect();
  }, [c, uid, read]);

  if (err)
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-[15px] text-gray-600">{err}</p>
        <Link to="/columns" className="mt-4 inline-block font-bold text-sm-navy">칼럼 목록으로</Link>
      </div>
    );
  if (!c) return <div className="py-24 text-center text-[14px] text-gray-500">불러오는 중…</div>;

  const cta = CTA[c.cta];

  return (
    <div className="bg-white">
      <article className="mx-auto max-w-2xl px-5 pb-20 pt-6 sm:pt-10">
        <Link to="/columns" className="text-[13px] font-semibold text-gray-500 hover:text-sm-navy">‹ 입시 칼럼</Link>

        <div className="mt-5 text-[12px] font-bold text-indigo-700">
          {c.series ? `${c.series} ${c.series_no ?? ""}편` : "입시 칼럼"}
          {c.series && c.series_total > 0 && <span className="ml-2 font-semibold text-gray-400">{c.series_read}/{c.series_total}편 읽음</span>}
        </div>
        <h1 className="mt-2 text-[24px] font-bold leading-snug tracking-tight text-sm-navy sm:text-[28px]">{c.title}</h1>
        <div className="mt-2 text-[12.5px] text-gray-500">생수면 입시연구소 · {dateLabel(c.publish_at)} · {c.minutes}분</div>
        {c.summary && <p className="mt-5 rounded-xl bg-[#F4F5F7] px-4 py-3.5 text-[14px] leading-relaxed text-gray-700">{c.summary}</p>}

        <div className="mt-4">
          <Body text={c.body} />
        </div>

        {/* 체크리스트 — 회원만 */}
        {c.checklist_count > 0 && (
          <div className="relative mt-8 overflow-hidden rounded-2xl border-[1.5px] border-sm-navy p-5">
            <h4 className="mb-2 text-[15px] font-bold text-sm-navy">내 생기부에 바로 쓰는 체크리스트</h4>
            {c.locked ? (
              <>
                <ul className="select-none blur-[5px]">
                  {Array.from({ length: Math.max(c.checklist_count, 4) }).map((_, i) => (
                    <li key={i} className="py-1.5 text-[14px]">□ 이 항목은 회원에게만 보여요 확인해 보세요</li>
                  ))}
                </ul>
                <div className="absolute inset-x-0 bottom-0 top-[56px] flex flex-col items-center justify-center gap-2 bg-white/70 px-4 text-center">
                  <b className="text-[14.5px] text-sm-navy">체크리스트는 회원만 볼 수 있어요</b>
                  <span className="text-[12.5px] text-gray-500">가입하면 바로 Lv.2에서 시작해요</span>
                  <button onClick={() => nav("/signup")} className="mt-1 rounded-[10px] bg-[#FEE500] px-5 py-2.5 text-[14px] font-bold text-[#191919]">
                    카카오로 시작하기
                  </button>
                </div>
              </>
            ) : (
              <ul>
                {(c.checklist || []).map((t, i) => (
                  <li key={i} className="flex gap-2.5 py-1.5 text-[14.5px] text-gray-800">
                    <span className="mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] border-sm-orange" />
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div ref={endRef} />
        {uid && read && (
          <div className="mt-5 rounded-xl bg-emerald-50 py-3 text-center text-[13.5px] font-bold text-emerald-700">끝까지 읽었어요</div>
        )}

        {cta && (
          <Link to={cta.to} className="mt-5 flex items-center gap-3 rounded-2xl border-[1.5px] border-sm-orange bg-orange-50/60 p-4">
            <div className="min-w-0">
              <b className="block text-[15px] font-bold text-[#7C2D12]">{cta.title}</b>
              <span className="text-[12.5px] text-[#9A3412]">{cta.sub}</span>
            </div>
            <span className="ml-auto text-[20px] text-sm-orange">→</span>
          </Link>
        )}

        <Comments kind="column" target={c.id} toast={toast} />
      </article>
      {toastNode}
    </div>
  );
}