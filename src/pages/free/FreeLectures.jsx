import { useState } from "react";
import { Link } from "react-router-dom";

/* ── 영상 추가는 여기만 고치면 된다 ──────────────────────
   id: 유튜브 주소의 v= 뒤 11자리
   https://www.youtube.com/watch?v=dQw4w9WgXcQ  →  dQw4w9WgXcQ
------------------------------------------------------- */
const VIDEOS = [
  {
    id: "l1MofUx-Fqk",
    title: "대입면접, 무엇부터 준비해야 할까",
    desc: "면접 준비를 어디서부터 시작해야 하는지 전체 그림을 잡아드립니다.",
    length: "",
  },
  // 영상이 늘어나면 아래처럼 추가하면 된다
  // { id: "", title: "", desc: "", length: "" },
];

const CHANNEL_URL = "https://youtu.be/pd0BxIvz5rY";

// ※ 숫자는 실증 가능한 값으로 유지할 것
const CREDIT = [
  ["4,000명+", "누적 스피치 · 면접 코칭"],
  ["111만+", "유튜브 강의 누적 조회"],
  ["고입 · 대입", "면접 코칭 전문 분야"],
];

const CAREER = [
  "세움스피치 대표 · 현장 면접교육을 직접 진행합니다",
  "학생부종합전형 면접을 매년 현장에서 지도해 왔습니다",
  "고입 자기소개서 · 면접부터 대입 학생부종합전형까지 지도",
];

/* ── 합격 후기 ─────────────────────────────────────────
   videoId : 유튜브 11자리. 비우면 썸네일 자리만 표시된다.
   썸네일은 유튜브에서 자동으로 가져온다.
--------------------------------------------------- */
const REVIEWS = [
  {
    videoId: "aN2Zv4W_ka4",
    tag: "간호학과 2관왕",
    sub: "경쟁률 30:1 · 세명대 · 한서대 동시 합격",
    quote: "첨삭받은 예상질문 두 개가 다음날 면접에 그대로 나왔어요",
  },
  {
    videoId: "4aFj8vu7JT4",
    tag: "3일 준비 합격",
    sub: "숭실대 국어국문학과 · 면접 반영 50%",
    quote: "1차 발표가 화요일, 면접이 금요일이었어요. 3일 만에 준비하고 붙었습니다",
  },
  {
    videoId: "2euAQc0uzWM",
    tag: "소극적인 성격에서 시작",
    sub: "건국대 자유전공학부 · 학생부종합전형",
    quote: "눈을 마주치는 것도 힘들었는데, 발성부터 배우고 생기부 질문을 다 뽑아냈어요",
  },
];

const FIT_YES = [
  "면접을 처음 준비해서 어디서부터 시작해야 할지 모르겠는 학생",
  "학생부를 읽어봤지만 어떤 질문이 나올지 감이 안 오는 학생",
  "예상질문은 만들었는데 답변을 어떻게 구성해야 할지 막막한 학생",
  "답변을 외우기는 했지만 꼬리질문이 들어오면 흔들리는 학생",
  "학원을 여러 번 오가기보다 혼자 반복해서 준비할 방법이 필요한 학생",
];

const FIT_NO = [
  "제시문 면접만을 집중적으로 준비해야 하는 학생",
  "이미 학교나 학원에서 충분한 1:1 면접 코칭을 받고 있는 학생",
  "강의만 틀어놓고 직접 답변을 작성하거나 말해보는 연습을 하지 않을 학생",
];

const RESULTS = [
  ["01", "내 학생부에서 나올 질문을 스스로 찾을 수 있다", "무작정 예상질문을 외우는 것이 아니라 질문이 만들어지는 지점을 봅니다."],
  ["02", "질문을 받았을 때 답변의 뼈대를 잡을 수 있다", "두서없이 말하지 않고 핵심부터 답하는 구조를 익힙니다."],
  ["03", "내 경험을 면접 답변으로 바꿀 수 있다", "좋은 활동이 없어서가 아니라, 가지고 있는 경험을 어떻게 설명해야 하는지 배웁니다."],
  ["04", "예상하지 못한 꼬리질문에도 대응할 수 있다", "외운 문장이 아니라 내 경험을 이해하고 말하는 연습을 합니다."],
];

export default function FreeLectures() {
  const ready = VIDEOS.filter((v) => v.id);
  const [current, setCurrent] = useState(ready[0] ?? null);
  const [playingId, setPlayingId] = useState(null); // 후기 영상 인라인 재생

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <p className="text-sm font-bold text-sm-orange">무료 오픈특강</p>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">
        대입 면접 준비, 여기서 먼저 시작하세요
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-500">
        합격패스의 핵심 내용 일부를 무료로 공개합니다. 회원가입 없이 바로 보실 수 있습니다.
      </p>

      {/* 이 강의를 만든 사람 */}
      <section className="mt-8 rounded-2xl bg-sm-navy p-8 text-white">
        <p className="text-sm font-bold text-orange-300">이 강의를 만든 사람</p>

        <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
          <img
            src="/images/profile-kimjiyoon.png"
            alt="세움스피치 김지윤 대표"
            className="w-full shrink-0 rounded-2xl object-cover ring-1 ring-white/20 sm:w-60"
          />
          <div className="min-w-0">
            <h2 className="text-2xl font-extrabold leading-snug tracking-tight sm:text-[28px]">
              대입 면접 역전의 신화
              <br />
              합격률 93.7%
            </h2>
            <p className="mt-3 text-sm text-blue-200">세움스피치 김지윤 대표</p>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-3 gap-4 border-y border-white/15 py-6">
          {CREDIT.map(([n, l]) => (
            <div key={l}>
              <p className="text-base font-black leading-tight tracking-tight text-orange-300 sm:text-xl">
                {n}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-blue-200">{l}</p>
            </div>
          ))}
        </div>

        <ul className="mt-6 space-y-2.5">
          {CAREER.map((t) => (
            <li key={t} className="flex gap-2.5 text-[14.5px] leading-relaxed text-blue-100">
              <span className="font-black text-orange-300">·</span>
              {t}
            </li>
          ))}
        </ul>

        <p className="mt-7 border-t border-white/15 pt-6 text-[15px] font-bold leading-relaxed tracking-tight">
          면접에서 학생들이 어디서 가장 많이 막히는지
          <br className="sm:hidden" /> 실제 수업 현장에서 반복해서 확인하며 만든 과정입니다.
        </p>

        <p className="mt-5 text-[11px] leading-relaxed text-blue-300/70">
          [합격률 93.7%] 2025학년도 수시 면접 과정 수강생 중 1개 대학 이상 최초합격 기준, 자체 집계
          <br />
          [누적 4,000명] 세움스피치 대입·고입 면접 과정 누적 수강 인원 (2019.1.1~2025.12.31)
        </p>
      </section>

      {/* 합격 후기 */}
      {REVIEWS.some((r) => r.quote) && (
        <section className="mt-14">
          <p className="text-sm font-bold text-sm-orange">합격생 후기</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">
            먼저 준비한 학생들의 이야기
          </h2>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {REVIEWS.filter((r) => r.quote).map((r) => {
              const playing = playingId === r.videoId && r.videoId;

              return (
                <div
                  key={r.quote}
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
                >
                  {/* 썸네일 → 클릭하면 그 자리에서 재생 */}
                  {playing ? (
                    <div className="aspect-video bg-black">
                      <iframe
                        src={`https://www.youtube.com/embed/${r.videoId}?autoplay=1&rel=0`}
                        title={r.tag || "합격 후기"}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="h-full w-full"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => r.videoId && setPlayingId(r.videoId)}
                      disabled={!r.videoId}
                      className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-gray-100"
                    >
                      {r.videoId ? (
                        <img
                          src={`https://img.youtube.com/vi/${r.videoId}/hqdefault.jpg`}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-gray-400">썸네일 준비 중</span>
                      )}
                      {r.videoId && (
                        <span className="absolute flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-sm-orange">
                          <span className="ml-0.5 text-lg">▶</span>
                        </span>
                      )}
                    </button>
                  )}

                  <div className="p-5">
                    {r.tag && (
                      <span className="rounded bg-orange-50 px-2 py-1 text-[11px] font-bold text-sm-orange">
                        {r.tag}
                      </span>
                    )}
                    <p className="mt-3 text-[14px] font-bold leading-relaxed text-sm-navy">
                      “{r.quote}”
                    </p>
                    {r.sub && <p className="mt-2 text-[11.5px] text-gray-400">{r.sub}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 무료 오픈특강 */}
      <div className="mt-16 border-t border-gray-200 pt-14">
        <div className="text-center">
          <span className="inline-block rounded-full bg-sm-orange px-4 py-1.5 text-xs font-extrabold text-white">
            무료 공개
          </span>
          <p className="mt-4 text-2xl font-extrabold leading-snug tracking-tight text-sm-navy sm:text-3xl">
            면접 준비를 어디서부터 해야 하는지
            <br />
            이 영상 하나로 정리됩니다
          </p>
          <p className="mt-4 text-[16px] leading-relaxed text-gray-500">
            말로만 설명하지 않습니다. 실제 강의를 먼저 확인해보세요.
            <br />
            보시고 맞다고 생각되면 그때 신청하셔도 늦지 않습니다.
          </p>
        </div>

        {/* 이 영상에서 다루는 것 */}
        <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
          {[
            ["01", "면접관이 학생부의 어디를 보는지"],
            ["02", "답변의 뼈대를 어떻게 잡는지"],
            ["03", "꼬리질문에 왜 무너지는지"],
          ].map(([n, t]) => (
            <div
              key={n}
              className="flex items-center gap-3 rounded-xl bg-gray-50 px-5 py-5 sm:block"
            >
              <span className="text-[13px] font-black tracking-wider text-sm-orange">{n}</span>
              <p className="text-[16px] font-bold leading-snug tracking-tight text-sm-navy sm:mt-2 sm:text-[15px]">
                {t}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 영상 */}
      {ready.length === 0 ? (
        <div className="mt-8 rounded-xl border border-gray-200 py-20 text-center">
          <p className="text-gray-500">공개 예정입니다.</p>
          <p className="mt-2 text-xs text-gray-400">유튜브 채널에서 먼저 만나보실 수 있습니다.</p>
          <a
            href={CHANNEL_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-block rounded-lg bg-sm-orange px-6 py-3 text-sm font-extrabold text-white"
          >
            유튜브 채널 바로가기
          </a>
        </div>
      ) : (
        <div
          className={`mt-8 grid gap-6 ${ready.length > 1 ? "lg:grid-cols-[1fr_300px]" : ""}`}
        >
          <div>
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              <iframe
                key={current.id}
                src={`https://www.youtube.com/embed/${current.id}?rel=0`}
                title={current.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
            {/* 영상이 여러 편일 때만 제목·설명을 붙인다 */}
            {ready.length > 1 && (
              <>
                <p className="mt-4 text-lg font-extrabold tracking-tight text-sm-navy">
                  {current.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-500">{current.desc}</p>
              </>
            )}
          </div>

          {/* 영상이 여러 편일 때만 목록 */}
          {ready.length > 1 && (
            <aside className="rounded-xl border border-gray-200">
              <div className="border-b border-gray-100 px-5 py-4 text-sm font-extrabold text-sm-navy">
                무료 강의 {ready.length}편
              </div>
              <ul>
                {ready.map((v) => {
                  const on = current.id === v.id;
                  return (
                    <li key={v.id} className="border-b border-gray-100 last:border-0">
                      <button
                        onClick={() => setCurrent(v)}
                        className={`w-full px-5 py-4 text-left ${on ? "bg-orange-50" : ""}`}
                      >
                        <p
                          className={`text-sm font-bold ${
                            on ? "text-sm-orange" : "text-sm-navy"
                          }`}
                        >
                          {v.title}
                        </p>
                        {v.length && (
                          <p className="mt-1 text-xs text-gray-400">{v.length}</p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-gray-100 p-4">
                <a
                  href={CHANNEL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-gray-300 py-2.5 text-center text-xs font-bold text-gray-600"
                >
                  유튜브 채널에서 더 보기
                </a>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* ── 여기부터 구매 판단 ─────────────────────────── */}

      <div className="mt-16 border-t border-gray-200 pt-14">
        <p className="text-sm font-bold text-sm-orange">여기까지 보셨다면</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">
          대입 면접을 혼자 준비한다면,
          <br />
          이 구성으로 시작해도 충분합니다
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-gray-500">
          면접에서 필요한 모든 것을 무작정 많이 배우는 강의가 아닙니다.
          <br />
          고3이 실제 면접 전에 반드시 정리해야 하는 것부터 시작합니다.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-gray-50 p-6">
          {["학생부에서 질문 찾기", "답변 구조 만들기", "나만의 경험으로 말하기", "꼬리질문 대비하기"].map(
            (t, i) => (
              <span key={t} className="flex items-center gap-3">
                <span className="text-[15px] font-bold tracking-tight text-sm-navy">{t}</span>
                {i < 3 && <span className="font-black text-sm-orange">→</span>}
              </span>
            )
          )}
        </div>

        <p className="mt-5 text-[15px] leading-relaxed text-gray-500">
          혼자 준비하더라도{" "}
          <b className="text-sm-navy">“무엇부터 해야 하지?”라는 상태에서는 벗어날 수 있도록</b> 만든
          과정입니다.
        </p>
      </div>

      {/* 나한테 맞나 */}
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-sm-orange bg-white p-7">
          <p className="border-b border-gray-100 pb-3 text-[17px] font-extrabold tracking-tight text-sm-orange">
            지금 이런 상태라면 잘 맞습니다
          </p>
          <ul className="mt-4 space-y-3">
            {FIT_YES.map((t) => (
              <li key={t} className="flex gap-2 text-[14.5px] leading-relaxed text-gray-600">
                <span className="font-black text-sm-orange">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-7">
          <p className="border-b border-gray-100 pb-3 text-[17px] font-extrabold tracking-tight text-sm-navy">
            반대로, 이런 경우에는 추천하지 않습니다
          </p>
          <ul className="mt-4 space-y-3">
            {FIT_NO.map((t) => (
              <li key={t} className="flex gap-2 text-[14.5px] leading-relaxed text-gray-600">
                <span className="text-gray-300">—</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-6 text-center text-[15px] text-gray-500">
        이 강의는 <b className="text-sm-navy">‘보는 강의’보다 ‘직접 준비하게 만드는 강의’</b>에
        가깝습니다.
      </p>

      {/* 무엇이 남는가 */}
      <div className="mt-16">
        <p className="text-sm font-bold text-sm-orange">수강 후</p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-sm-navy">
          이 강의를 끝내고 나면
          <br />
          최소한 이것은 남아야 합니다
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {RESULTS.map(([n, t, d]) => (
            <div key={n} className="rounded-2xl bg-gray-50 p-6">
              <span className="text-[13px] font-black tracking-wider text-sm-orange">{n}</span>
              <b className="mt-2 block text-[17px] font-extrabold leading-snug tracking-tight text-sm-navy">
                {t}
              </b>
              <p className="mt-2.5 text-sm leading-relaxed text-gray-500">{d}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl bg-sm-navy p-8">
          <p className="text-[15px] leading-relaxed text-blue-200">
            면접을 완벽하게 만들어준다고 말하지 않겠습니다.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-blue-200">
            다만 처음 면접을 준비하는 고3이라면,{" "}
            <b className="font-extrabold text-white">
              무엇을 준비해야 하는지 알고, 내 학생부로 답변을 만들고, 실제 질문 앞에서 말해보는 데
              필요한 기본 구조
            </b>
            는 이 과정 안에 담았습니다.
          </p>
        </div>
      </div>

      {/* 커리큘럼으로 */}
      <div className="mt-12 rounded-2xl bg-sm-peach p-8 text-center">
        <p className="text-xl font-extrabold tracking-tight text-sm-navy">
          이제 내 학생부로 해볼 차례입니다
        </p>

        <Link
          to="/"
          className="mt-7 inline-block rounded-lg bg-sm-orange px-10 py-4 text-[15px] font-extrabold text-white"
        >
          커리큘럼 자세히 보기
        </Link>
      </div>

    </div>
  );
}