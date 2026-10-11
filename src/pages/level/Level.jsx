import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { supabase } from "../../lib/supabase";
import Avatar from "../../components/Avatar";
import { NicknameModal } from "../../components/NicknameEditor";

// 고른 사진을 가운데 정사각형으로 잘라 256×256 webp 로 줄인다
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("사진을 읽지 못했어요"))), "image/webp", 0.85);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("사진 파일만 올릴 수 있어요"));
    img.src = URL.createObjectURL(file);
  });
}

/*
 * 내 레벨 (/my/level)
 * 레벨 카드 · 오늘 할 일 · 내 쿠폰 · 파도 혜택(무료 입시설명회 신청) · 6단계 혜택 · 점수 얻는 법
 * 설명회는 학생이 신청하고, 당일 부모님과 같이 들어오면 된다
 */

const STAGES = [
  { no: 1, name: "새싹", range: "Lv.1~5", color: "#059669", items: ["나만 그래? · 댓글 · 출석 · 퍼즐", "Lv.3부터 자유게시판 글쓰기"], pieces: 1 },
  { no: 2, name: "물방울", range: "Lv.6~10", color: "#2563EB", items: ["대학 사다리 (준비 중)", "나만 그래? 질문 제안 (준비 중)"], pieces: 2, coupon: true },
  { no: 3, name: "물결", range: "Lv.11~15", color: "#4F46E5", items: ["새 칼럼 하루 먼저 보기", "퍼즐 힌트 (준비 중)"], pieces: 3, coupon: true },
  { no: 4, name: "파도", range: "Lv.16~20", color: "#E8590C", items: ["무료 입시설명회 신청 (부모님과 함께)", "칼럼 주제 신청 (준비 중)"], pieces: 5, coupon: true },
  { no: 5, name: "바다", range: "Lv.21~25", color: "#0369A1", items: ["강사 코멘트 신청 (준비 중)"], pieces: 7, coupon: true },
  { no: 6, name: "대양", range: "Lv.26~30", color: "#6D28D9", items: ["Lv.30 '대서양' 이름"], pieces: 10, coupon: true },
];

// 뱃지 아이콘 (선)
const BADGE_ICON = {
  att7: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" /></>,
  cmt10: <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />,
  best: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  note10: <><path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6z" /><path d="M6 3v18M10 8h5M10 12h5" /></>,
  read5: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  post5: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  puzzle: <path d="M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4h2a2 2 0 100-4H6V6h4z" />,
  wave: <path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5 0M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5 0" />,
};

const POINTS = [
  ["출석", "2점", "하루 1번"],
  ["나만 그래? 응답", "1점", "하루 5점"],
  ["댓글 (10자 이상)", "2점", "하루 10점"],
  ["내 생기부 노트 기록", "3점", "하루 9점"],
  ["입시 칼럼 끝까지 읽기", "2점", "하루 4점"],
  ["자유게시판 글", "3점", "하루 6점"],
  ["내 글 · 댓글이 '나도 그래' 받기", "2점", "하루 10점"],
];

function dateTime(iso) {
  const d = new Date(iso);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const h = d.getHours();
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${days[d.getDay()]}) ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ""}`;
}
function dLeft(iso) {
  const d = new Date(iso);
  const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (days <= 0) return "오늘까지";
  if (days <= 30) return `D-${days}`;
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}까지`;
}

export default function Level() {
  const { user, loading } = useAuth();
  const uid = user?.id ?? null;
  const [lv, setLv] = useState(null);
  const [today, setToday] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [events, setEvents] = useState([]);
  const [badges, setBadges] = useState([]);
  const [nick, setNick] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [upMsg, setUpMsg] = useState("");
  const [askNick, setAskNick] = useState(false);
  const [msg, setMsg] = useState("");

  const loadEvents = () => supabase.rpc("ev_list").then(({ data }) => setEvents(data || []));

  useEffect(() => {
    if (!uid) return;
    supabase.rpc("lv_check").then(({ data }) => data && setLv(data.info));
    supabase.rpc("lv_today").then(({ data }) => setToday(data));
    supabase.rpc("my_coupons").then(({ data }) => setCoupons(data || []));
    supabase.rpc("my_profile").then(({ data }) => {
      setNick(data?.nickname || "");
      setAvatar(data?.avatar_url || null);
    });
    loadEvents();
    supabase.rpc("my_badges").then(({ data }) => setBadges(data || []));
  }, [uid]);

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUpMsg("올리는 중…");
    try {
      const blob = await shrink(file);
      const path = `${uid}/avatar.webp`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/webp" });
      if (upErr) throw upErr;
      const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      const { error } = await supabase.rpc("sm_set_avatar", { p_url: url });
      if (error) throw error;
      setAvatar(url);
      setUpMsg("");
    } catch (err) {
      setUpMsg(err.message || "사진을 올리지 못했어요");
    }
  }

  async function clearPhoto() {
    await supabase.rpc("sm_set_avatar", { p_url: null });
    setAvatar(null);
  }

  async function apply(ev) {
    const { error } = await supabase.rpc("ev_apply", { p_event: ev.id });
    if (error) return setMsg(error.message);
    setMsg("신청했어요 · 설명회 1시간 전부터 여기서 입장 버튼이 열려요");
    loadEvents();
  }

  if (loading) return <div className="py-24 text-center text-gray-500">불러오는 중…</div>;
  if (!uid)
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="text-[22px] font-bold text-sm-navy">내 레벨</h1>
        <p className="mt-2 text-[14px] text-gray-600">가입하면 바로 Lv.2에서 시작해요.</p>
        <Link to="/signup" className="mt-6 inline-block rounded-[10px] bg-[#FEE500] px-6 py-3 text-[14.5px] font-bold text-[#191919]">
          카카오로 시작하기
        </Link>
      </div>
    );
  if (!lv) return <div className="py-24 text-center text-gray-500">불러오는 중…</div>;

  const todo = today
    ? [
        ["출석", today.att ? 1 : 0, 1, "+2"],
        ["나만 그래? 응답", Math.min(today.answers, 5), 5, "+1씩"],
        ["댓글 (10자 이상)", Math.min(today.comments, 5), 5, "+2씩"],
        ["내 생기부 노트 기록", Math.min(today.records, 3), 3, "+3씩"],
        ["칼럼 끝까지 읽기", Math.min(today.reads, 2), 2, "+2씩"],
      ]
    : [];

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      <div className="mx-auto max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-10">
        <h1 className="text-[24px] font-bold tracking-tight text-sm-navy">내 레벨</h1>

        {/* 레벨 카드 */}
        <div className="mt-4 rounded-2xl bg-sm-navy p-5 text-white">
          <div className="flex items-center gap-3">
            <label className="relative cursor-pointer" title="프로필 사진 바꾸기">
              <Avatar src={avatar} nick={nick} color={lv.color} size={52} />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] text-sm-navy shadow">✎</span>
              <input type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
            </label>
            <div className="min-w-0">
              {nick ? (
                <b className="block truncate text-[17px] font-bold">{nick}</b>
              ) : (
                <button onClick={() => setAskNick(true)} className="block text-[15px] font-bold text-orange-300 underline">
                  닉네임 정하기
                </button>
              )}
              <small className="text-[12.5px] text-slate-300">
                {upMsg || `${lv.name || lv.stage} 단계`}
                {avatar && !upMsg && (
                  <button onClick={clearPhoto} className="ml-2 text-[11.5px] text-slate-400 underline">
                    사진 지우기
                  </button>
                )}
              </small>
            </div>
            <b className="ml-auto text-[28px] font-extrabold tabular-nums">Lv.{lv.level}</b>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15">
            <i className="block h-full rounded-full bg-orange-300" style={{ width: `${lv.pct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[12.5px] text-slate-300">
            <span className="tabular-nums">{lv.points}점{lv.next ? ` / ${lv.next}점` : ""}</span>
            <span>{lv.max ? "최고 레벨" : `Lv.${lv.level + 1}까지 ${lv.need}점`}</span>
          </div>
        </div>

        {/* 오늘 할 일 */}
        {todo.length > 0 && (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5">
            <b className="text-[15px] text-gray-900">오늘 할 일</b>
            <div className="mt-2">
              {todo.map(([label, got, max, pt]) => (
                <div key={label} className="flex items-center gap-2.5 py-1.5 text-[14px] text-gray-700">
                  <span className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] text-[11px] font-black ${got >= max ? "border-sm-navy bg-sm-navy text-white" : "border-gray-300"}`}>
                    {got >= max ? "✓" : ""}
                  </span>
                  {label}
                  <small className="ml-auto text-[12px] tabular-nums text-gray-500">
                    {max > 1 ? `${got}/${max} · ` : ""}{pt}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 뱃지 */}
        {badges.length > 0 && (
          <section className="mt-3 rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-baseline">
              <b className="text-[15px] text-gray-900">뱃지</b>
              <small className="ml-2 text-[12.5px] tabular-nums text-gray-500">
                {badges.filter((b) => b.n >= b.goal).length}/{badges.length}
              </small>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {badges.map((b) => {
                const got = b.n >= b.goal;
                return (
                  <div key={b.key} className="flex flex-col items-center text-center" title={b.desc}>
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-full ${got ? "text-white" : "bg-[#F4F5F7] text-gray-300"}`}
                      style={got ? { background: lv.color } : {}}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                        {BADGE_ICON[b.key]}
                      </svg>
                    </span>
                    <b className={`mt-1.5 text-[12px] font-bold ${got ? "text-gray-900" : "text-gray-400"}`}>{b.title}</b>
                    <small className="text-[11px] leading-tight text-gray-400">{got ? b.desc : `${b.n}/${b.goal}`}</small>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 쿠폰 */}
        {coupons.length > 0 && (
          <div className="mt-3 grid gap-2">
            {coupons.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4">
                <div>
                  <b className="text-[15px] text-sm-navy">{c.title} · {c.amount.toLocaleString()}원</b>
                  <small className="block text-[12.5px] text-gray-600">예상질문 결제할 때 쓸 수 있어요</small>
                </div>
                <span className="ml-auto rounded-md bg-white px-2 py-1 text-[12px] font-bold text-sm-orange">{dLeft(c.expires_at)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 파도 혜택: 설명회 */}
        {events.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 pl-1 text-[15px] font-bold text-gray-900">무료 입시설명회</h2>
            {events.map((ev) => (
              <div key={ev.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <div className="bg-gradient-to-br from-[#C2410C] to-sm-orange px-5 py-4 text-white">
                  <small className="text-[12px] font-bold text-orange-100">🌀 파도 단계 혜택 · {ev.place}</small>
                  <b className="mt-1 block text-[17px] font-bold leading-snug">{ev.title}</b>
                </div>
                <div className="px-5 py-4 text-[14px] leading-7 text-gray-700">
                  <div><b className="text-gray-900">일시</b> {dateTime(ev.starts_at)} · {ev.minutes}분</div>
                  <div><b className="text-gray-900">남은 자리</b> {ev.left}가정</div>
                  <p className="mt-1 text-[12.5px] text-gray-500">부모님과 함께 들으면 좋아요. 신청은 학생 한 명만 하면 돼요.</p>
                  {ev.applied ? (
                    ev.join_url ? (
                      <a href={ev.join_url} target="_blank" rel="noreferrer" className="mt-3 block rounded-[10px] bg-sm-navy py-3 text-center text-[15px] font-bold text-white">
                        설명회 들어가기
                      </a>
                    ) : (
                      <div className="mt-3 rounded-[10px] bg-emerald-50 py-3 text-center text-[14px] font-bold text-emerald-700">
                        신청 완료 · 1시간 전부터 입장 버튼이 열려요
                      </div>
                    )
                  ) : ev.can_apply ? (
                    <button onClick={() => apply(ev)} disabled={ev.left <= 0} className="mt-3 h-12 w-full rounded-[10px] bg-sm-orange text-[15px] font-bold text-white disabled:opacity-50">
                      {ev.left <= 0 ? "자리가 다 찼어요" : "신청하기"}
                    </button>
                  ) : (
                    <div className="mt-3 rounded-[10px] bg-[#F4F5F7] py-3 text-center text-[13.5px] font-semibold text-gray-500">
                      Lv.{ev.min_level}부터 신청할 수 있어요 · 지금 Lv.{lv.level}
                    </div>
                  )}
                  {msg && <p className="mt-2 text-[13px] font-semibold text-sm-orange">{msg}</p>}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* 단계 혜택 */}
        <section className="mt-6">
          <h2 className="mb-2 pl-1 text-[15px] font-bold text-gray-900">단계별 혜택</h2>
          <div className="grid gap-2">
            {STAGES.map((s) => {
              const now = s.no === lv.stage_no;
              const done = s.no < lv.stage_no;
              return (
                <div key={s.no} className={`flex gap-3 rounded-2xl border bg-white p-4 ${now ? "border-2" : "border-gray-200"} ${!now && !done ? "opacity-60" : ""}`} style={now ? { borderColor: s.color } : {}}>
                  <span className="mt-0.5 h-3 w-3 flex-none rounded-full" style={{ background: s.color }} />
                  <div className="min-w-0 flex-1">
                    <b className="text-[15px] text-gray-900">{s.name}</b>
                    <small className="ml-1.5 text-[12px] text-gray-500">{s.range}</small>
                    <ul className="mt-1 text-[13px] leading-6 text-gray-700">
                      {s.items.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                      <li className="text-gray-500">
                        조각 +{s.pieces}{s.coupon ? " · 할인 쿠폰 1,000원 (1년)" : ""}
                      </li>
                    </ul>
                  </div>
                  {(now || done) && (
                    <span className={`h-fit flex-none rounded-md px-2 py-0.5 text-[11px] font-bold ${now ? "text-white" : "bg-emerald-50 text-emerald-700"}`} style={now ? { background: s.color } : {}}>
                      {now ? "지금" : "받음"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {lv.stage_no >= 2 && (
            <div className="mt-2 w-full rounded-2xl border border-dashed border-gray-300 bg-white py-3.5 text-center text-[13.5px] font-semibold text-gray-500">
              🪜 대학 사다리 · 대학 자료를 모으고 있어요. 열리면 바로 쓸 수 있어요
            </div>
          )}
        </section>

        {/* 점수 얻는 법 */}
        <section className="mt-6">
          <h2 className="mb-2 pl-1 text-[15px] font-bold text-gray-900">점수 얻는 법</h2>
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-2">
            {POINTS.map(([a, b, c]) => (
              <div key={a} className="flex items-center border-b border-gray-100 py-2.5 text-[14px] last:border-0">
                <span className="text-gray-700">{a}</span>
                <b className="ml-auto text-gray-900">{b}</b>
                <span className="w-20 text-right text-[12.5px] text-gray-500">{c}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 pl-1 text-[12px] text-gray-500">점수는 줄지 않아요. 지운 글 · 댓글의 점수는 빠져요.</p>
        </section>
      </div>
      {askNick && (
        <NicknameModal
          onClose={() => setAskNick(false)}
          onDone={(d) => {
            setAskNick(false);
            supabase.rpc("my_profile").then(({ data }) => setNick(data?.nickname || d?.nickname || ""));
          }}
        />
      )}
    </div>
  );
}