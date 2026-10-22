// 생수면 · 탐구 결과물 만들기 화면
// 5-1 주제 → 종류 → 질문 / 5-2 틀 갤러리 · 틀 상세 / 5-3 테마·배치 → 만드는 중 → /output/:id
// 경로: src/pages/output/OutputCreate.jsx
// 라우트 예: <Route path="/output/new" element={<OutputCreate />} />
// 흔한가에서 넘어올 때: /output/new?topic=탐구주제

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OUTPUT_TYPES, TEMPLATES, THEMES, recommendType, typeOf, templatesOf } from '../../data/outputCatalog';
import { supabase } from '../../lib/supabase'; // 생수면 Supabase 클라이언트 경로에 맞게

const EXAMPLES = [
  '세율을 올리면 세수는 계속 늘까?',
  '온도에 따른 아밀레이스 분해 속도',
  '백신은 어떻게 몸에 기억을 남길까?',
  '우리 반 급식 잔반량 분석',
  '학년별 SNS 사용 시간 설문',
  '원자력 vs 태양광',
  '자율주행차의 트롤리 딜레마',
  '한글이 나라의 글자가 되기까지',
];

const STEP_LABELS = ['주제', '결과물 종류', '탐구 설계', '틀 고르기', '모양', '완성'];

// 유형 아이콘 (선 아이콘)
const TYPE_ICONS = {
  sim: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  exp: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10',
  explain: 'M5 5h5v5H5zM14 14h5v5h-5zM10 7.5h4a2 2 0 0 1 2 2V14',
  dash: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  survey: 'M8 4h8l1 2h3v15H4V6h3zM8 12l2 2 4-4M8 17h8',
  compare: 'M3 5h8v14H3zM13 5h8v14h-8zM5 9h4M15 9h4M5 13h4M15 13h4',
  quiz: 'M9 9a3 3 0 1 1 4 2.8c-.7.3-1 1-1 1.7V14M12 18h0M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
};

export default function OutputCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState(params.get('topic') ?? '');
  const [typeId, setTypeId] = useState(null);       // null이면 추천 유형
  const [answers, setAnswers] = useState({});       // { 질문: 고른 답 }
  const [templateId, setTemplateId] = useState(null); // 고른 틀
  const [detailId, setDetailId] = useState(null);     // 상세 화면으로 연 틀
  const [preview, setPreview] = useState('web');      // web / phone / report
  const [useCounts, setUseCounts] = useState({});     // { 틀 id: 사용한 학생 수 }
  const [theme, setTheme] = useState('textbook');
  const [layout, setLayout] = useState('side');
  const [stage, setStage] = useState(0);              // 만드는 중: 0 저장 중 · 1 내용 쓰는 중 · 2 틀에 끼우기 · 3 완성
  const [buildError, setBuildError] = useState(null); // { message, code }

  // 로그인하고 돌아왔을 때 고르던 것 되살리기
  useEffect(() => {
    const saved = sessionStorage.getItem('outputDraft');
    if (!saved) return;
    sessionStorage.removeItem('outputDraft');
    try {
      const d = JSON.parse(saved);
      setTopic(d.topic); setTypeId(d.typeId); setAnswers(d.answers);
      setTemplateId(d.templateId); setTheme(d.theme); setLayout(d.layout);
      setStep(4);
    } catch { /* 무시 */ }
  }, []);

  // 틀별 "학생 N명이 만들었어요"
  useEffect(() => {
    supabase.rpc('template_use_counts').then(({ data }) => {
      if (!data) return;
      setUseCounts(Object.fromEntries(data.map((r) => [r.template_id, r.uses])));
    });
  }, []);

  const recommended = useMemo(() => recommendType(topic), [topic]);
  const selectedTypeId = typeId ?? recommended;
  const selectedType = typeOf(selectedTypeId);

  const pickType = (id) => {
    setTypeId(id);
    setAnswers({});       // 종류가 바뀌면 질문도 바뀜
    setTemplateId(null);  // 틀도 다시 고르기
  };

  const gallery = templatesOf(selectedTypeId);
  const detail = TEMPLATES.find((t) => t.id === detailId);
  const usesText = (id) => (useCounts[id] ? `학생 ${useCounts[id].toLocaleString()}명이 이 틀로 만들었어요` : '아직 아무도 안 쓴 틀이에요 · 가장 안 흔해요');

  const chooseTemplate = (id) => {
    setTemplateId(id);
    setDetailId(null);
    setStep(4);
  };

  // Edge Function 오류 메시지 꺼내기
  const readError = async (error) => {
    try { const body = await error.context.json(); return { message: body.error, code: body.code }; }
    catch { return { message: '잠시 후 다시 해 주세요' }; }
  };

  // ── 만들기: create(저장) → generate(AI) ──
  const build = async () => {
    setBuildError(null);

    // 회원 전용: 시작하려는 순간 로그인 요구, 고르던 것은 저장해 둠
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      sessionStorage.setItem('outputDraft', JSON.stringify({ topic, typeId: selectedTypeId, answers, templateId, theme, layout }));
      navigate(`/login?redirect=${encodeURIComponent('/output/new')}`); // 생수면 로그인 경로에 맞게
      return;
    }

    setStep(5);
    setStage(0);

    const created = await supabase.functions.invoke('build-output', {
      body: { mode: 'create', topic: topic.trim(), output_type: selectedTypeId, template_id: templateId, theme, layout, answers },
    });
    if (created.error) { setBuildError(await readError(created.error)); return; }

    setStage(1);
    const generated = await supabase.functions.invoke('build-output', {
      body: { mode: 'generate', id: created.data.id },
    });
    if (generated.error) { setBuildError({ ...(await readError(generated.error)), retryId: created.data.id }); return; }

    setStage(2);
    setTimeout(() => {
      setStage(3);
      navigate(`/output/${created.data.id}`);
    }, 600);
  };

  // generate만 다시 시도 (이미 저장된 결과물)
  const retryGenerate = async (id) => {
    setBuildError(null);
    setStage(1);
    const generated = await supabase.functions.invoke('build-output', { body: { mode: 'generate', id } });
    if (generated.error) { setBuildError({ ...(await readError(generated.error)), retryId: id }); return; }
    setStage(2);
    setTimeout(() => navigate(`/output/${id}`), 600);
  };

  const predicted = selectedType.questions[1] && answers[selectedType.questions[1].q];
  const chosen = selectedType.questions[0] && answers[selectedType.questions[0].q];

  const pickAnswer = (q, opt) => setAnswers((prev) => ({ ...prev, [q]: opt }));
  const allAnswered = selectedType.questions.every((qq) => answers[qq.q]);

  return (
    <div className="min-h-screen bg-[#F3F7FA] text-[#0F2233]">
      <div className="mx-auto flex max-w-5xl flex-col gap-7 px-5 pb-16 pt-6">

        {/* 위쪽 바 */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => navigate(-1)} className="text-sm text-[#4F6275]">← 돌아가기</button>
          <span className="rounded-full border border-[#D6E2EC] bg-white px-4 py-2 text-sm">
            탐구 결과물 만들기
          </span>
        </header>

        {/* 진행 단계 */}
        {step > 0 && (
          <nav aria-label="진행 단계" className="flex flex-wrap gap-2">
            {STEP_LABELS.slice(1).map((label, i) => {
              const n = i + 1;
              const current = step === n;
              const done = step > n;
              return (
                <button
                  key={label}
                  onClick={() => done && setStep(n)}
                  className={`flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm ${
                    current ? 'border-[#0B6BCB] bg-[#0B6BCB] text-white'
                    : done ? 'border-[#D6E2EC] bg-[#E3F0FC]'
                    : 'border-[#D6E2EC] bg-white text-[#4F6275]'}`}
                >
                  <b>{n}</b>{label}
                </button>
              );
            })}
          </nav>
        )}

        {/* ── 0. 주제 ───────────────────────────── */}
        {step === 0 && (
          <section className="flex flex-col items-center gap-6 py-14 text-center">
            <span className="rounded-full bg-[#E3F0FC] px-3 py-1.5 text-sm font-bold text-[#0B6BCB]">
              흔한 주제도, 결과물은 안 흔하게
            </span>
            <h1 className="text-4xl font-black leading-tight tracking-tight md:text-5xl">
              어떤 탐구를<br />결과물로 만들까?
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-[#4F6275]">
              탐구주제를 적으면, 직접 움직여 보는 나만의 웹 결과물로 만들어 드려요.
              보고서에 링크와 QR로 붙일 수 있어요.
            </p>

            <div className="flex w-full max-w-2xl flex-wrap gap-2 rounded-2xl border-2 border-[#0B6BCB] bg-white p-2.5">
              <label htmlFor="topic" className="sr-only">탐구주제</label>
              <input
                id="topic"
                value={topic}
                onChange={(e) => { setTopic(e.target.value); setTypeId(null); }}
                placeholder="예: 온도에 따른 효소 반응 속도"
                maxLength={200}
                className="min-h-[48px] min-w-0 flex-1 basis-72 bg-transparent px-3 text-lg outline-none"
              />
              <button
                disabled={!topic.trim()}
                onClick={() => setStep(1)}
                className="min-h-[48px] rounded-xl bg-[#0B6BCB] px-6 text-[17px] font-bold text-white disabled:opacity-40"
              >
                만들기 시작
              </button>
            </div>

            <div className="flex max-w-3xl flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setTopic(ex); setTypeId(null); }}
                  className="min-h-[44px] rounded-full border border-[#B9CCDC] bg-white px-4 text-[15px]"
                >
                  {ex}
                </button>
              ))}
            </div>
            <p className="text-sm text-[#4F6275]">흔한가에서 진단한 주제는 자동으로 넘어와요</p>
          </section>
        )}

        {/* ── 1. 결과물 종류 ──────────────────────── */}
        {step === 1 && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-[#4F6275]">탐구주제 · {topic}</span>
              <h2 className="text-3xl font-black tracking-tight">어떤 결과물로 만들고 싶어?</h2>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
              {OUTPUT_TYPES.map((t) => {
                const selected = t.id === selectedTypeId;
                return (
                  <button
                    key={t.id}
                    onClick={() => pickType(t.id)}
                    className={`flex min-h-[176px] flex-col gap-3 rounded-2xl border-2 p-5 text-left ${
                      selected ? 'border-[#0B6BCB] bg-[#E3F0FC]' : 'border-[#D6E2EC] bg-white'}`}
                  >
                    <div className="flex w-full items-start justify-between">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-[14px] ${
                        selected ? 'bg-[#0B6BCB]' : 'bg-[#EEF3F7]'}`}
                      >
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                          stroke={selected ? '#FFFFFF' : '#0F2233'} strokeWidth="2"
                          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d={TYPE_ICONS[t.id]} />
                        </svg>
                      </div>
                      {t.id === recommended && (
                        <span className="rounded-full bg-[#E3F0FC] px-2.5 py-1 text-xs font-bold text-[#08529C]">
                          이 주제에 추천
                        </span>
                      )}
                    </div>
                    <span className="text-[19px] font-bold">{t.name}</span>
                    <span className="text-[15px] leading-relaxed text-[#4F6275]">{t.desc}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-between gap-3">
              <button onClick={() => setStep(0)} className="min-h-[48px] rounded-xl border border-[#B9CCDC] bg-white px-5">이전</button>
              <button onClick={() => setStep(2)} className="min-h-[48px] rounded-xl bg-[#0B6BCB] px-7 font-bold text-white">다음: 탐구 설계</button>
            </div>
          </section>
        )}

        {/* ── 2. 질문 2개 (고르기만) ───────────────── */}
        {step === 2 && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-[#4F6275]">{selectedType.name} · 고르기만 하면 돼요</span>
              <h2 className="text-3xl font-black tracking-tight">탐구를 설계해 볼까?</h2>
            </div>

            {selectedType.questions.map((qq, qi) => (
              <div key={qq.q} className="flex flex-col gap-3.5 rounded-2xl border border-[#D6E2EC] bg-white p-6">
                <span className="text-sm font-bold text-[#0B6BCB]">질문 {qi + 1}</span>
                <span className="text-xl font-bold">{qq.q}</span>
                <div className="flex flex-wrap gap-2.5">
                  {qq.opts.map((opt) => {
                    const selected = answers[qq.q] === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => pickAnswer(qq.q, opt)}
                        className={`min-h-[48px] rounded-xl border-2 px-4 text-left ${
                          selected ? 'border-[#0B6BCB] bg-[#E3F0FC]' : 'border-[#D6E2EC] bg-white'}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <p className="text-sm text-[#4F6275]">
              고른 답은 보고서의 '탐구 설계'에 그대로 들어가요. 예상이 틀려도 괜찮아요 — 예상과 다른 결과가 더 좋은 소재예요.
            </p>

            <div className="flex flex-wrap justify-between gap-3">
              <button onClick={() => setStep(1)} className="min-h-[48px] rounded-xl border border-[#B9CCDC] bg-white px-5">이전</button>
              <button
                disabled={!allAnswered}
                onClick={() => setStep(3)}
                className="min-h-[48px] rounded-xl bg-[#0B6BCB] px-7 font-bold text-white disabled:opacity-40"
              >
                다음: 틀 고르기
              </button>
            </div>
          </section>
        )}

        {/* ── 3-a. 틀 갤러리 ────────────────────── */}
        {step === 3 && !detail && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-[#4F6275]">{selectedType.name} · 틀 {gallery.length}개</span>
              <h2 className="text-3xl font-black tracking-tight">어떤 모양으로 보여줄까?</h2>
              <p className="text-[15px] text-[#4F6275]">눌러서 크게 보고 고르세요. 색과 분위기는 다음 단계에서 또 바꿀 수 있어요.</p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
              {gallery.map((t) => (
                <button key={t.id} onClick={() => { setDetailId(t.id); setPreview('web'); }} className="group flex flex-col gap-2.5 text-left">
                  <div className={`overflow-hidden rounded-2xl border-2 bg-white ${templateId === t.id ? 'border-[#0B6BCB]' : 'border-[#D6E2EC]'}`}>
                    <img src={t.thumb} alt={`${t.name} 틀 미리보기`} loading="lazy"
                      className="aspect-[3/2] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[17px] font-bold">{t.name}</span>
                      <span className="truncate text-sm text-[#4F6275]">예: {t.example}</span>
                    </div>
                    <span className="shrink-0 rounded-lg border border-[#D6E2EC] bg-white px-2.5 py-1 text-xs text-[#4F6275]">
                      {useCounts[t.id] ? `${useCounts[t.id]}명` : 'NEW'}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap justify-between gap-3">
              <button onClick={() => setStep(2)} className="min-h-[48px] rounded-xl border border-[#B9CCDC] bg-white px-5">이전</button>
            </div>
          </section>
        )}

        {/* ── 3-b. 틀 상세 ─────────────────────── */}
        {step === 3 && detail && (
          <section className="flex flex-col gap-5">
            <button onClick={() => setDetailId(null)} className="self-start text-[15px] text-[#4F6275]">← 틀 목록으로 돌아가기</button>

            <div className="flex flex-wrap gap-8">
              {/* 미리보기 */}
              <div className="flex min-w-0 flex-[999_1_520px] flex-col items-center gap-4 rounded-3xl bg-[#E9EEF3] p-6">
                <div className="flex gap-1 rounded-2xl border border-[#D6E2EC] bg-white p-1">
                  {[['web', '웹'], ['phone', '휴대폰'], ['report', '보고서에 붙인 모습']].map(([id, label]) => (
                    <button key={id} onClick={() => setPreview(id)}
                      className={`min-h-[40px] rounded-xl px-4 text-sm ${preview === id ? 'bg-[#0F2233] text-white' : 'text-[#4F6275]'}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {preview === 'web' && (
                  <div className="w-full overflow-hidden rounded-xl border border-[#D6E2EC] bg-white shadow-sm">
                    <div className="flex items-center gap-1.5 border-b border-[#EEF1F4] px-4 py-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#F4B6C2]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#F6D58E]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#A7D8F0]" />
                      <span className="ml-3 h-5 flex-1 rounded-full bg-[#F3F5F7]" />
                    </div>
                    <img src={detail.thumb} alt={`${detail.name} 웹 미리보기`} className="w-full" />
                  </div>
                )}

                {preview === 'phone' && (
                  <div className="w-[260px] rounded-[36px] border-[10px] border-[#0F2233] bg-[#0F2233] shadow-lg">
                    <div className="h-[460px] overflow-hidden rounded-[26px] bg-white">
                      <img src={detail.thumb} alt={`${detail.name} 휴대폰 미리보기`} className="h-full w-full object-cover object-left-top" />
                    </div>
                  </div>
                )}

                {preview === 'report' && (
                  <div className="flex aspect-[1/1.414] w-full max-w-[420px] flex-col gap-3 bg-white p-8 shadow-md">
                    <span className="h-3 w-2/3 rounded bg-[#E3E8EE]" />
                    <span className="h-2 w-full rounded bg-[#EEF1F4]" />
                    <span className="h-2 w-5/6 rounded bg-[#EEF1F4]" />
                    <span className="mt-2 text-[11px] font-bold text-[#4F6275]">[그림 1] 탐구 결과물</span>
                    <img src={detail.thumb} alt={`${detail.name} 보고서 미리보기`} className="w-full border border-[#E3E8EE]" />
                    <div className="flex items-center gap-3">
                      <span className="grid h-14 w-14 shrink-0 grid-cols-4 gap-0.5 bg-white p-1 outline outline-1 outline-[#D6E2EC]" aria-hidden="true">
                        {Array.from({ length: 16 }).map((_, i) => (
                          <span key={i} className={(i * 7) % 3 === 0 ? 'bg-[#0F2233]' : 'bg-white'} />
                        ))}
                      </span>
                      <span className="text-[11px] leading-snug text-[#4F6275]">QR로 직접 움직여 볼 수 있어요<br />saengsumyeon.com/r/…</span>
                    </div>
                    <span className="h-2 w-full rounded bg-[#EEF1F4]" />
                    <span className="h-2 w-3/4 rounded bg-[#EEF1F4]" />
                  </div>
                )}
              </div>

              {/* 설명 */}
              <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
                <div className="flex flex-wrap items-center gap-1.5 text-sm text-[#4F6275]">
                  <span>결과물 종류</span><span>›</span><span>{selectedType.name}</span>
                </div>
                <h3 className="text-4xl font-black leading-tight tracking-tight">{detail.name}</h3>
                <p className="text-[17px] leading-relaxed text-[#4F6275]">{selectedType.desc}. 예시: {detail.example}</p>
                <span className="flex items-center gap-2 text-[15px]">
                  <span className="h-2 w-2 rounded-full bg-[#0B6BCB]" />{usesText(detail.id)}
                </span>

                <button onClick={() => chooseTemplate(detail.id)}
                  className="min-h-[56px] rounded-2xl bg-[#0F2233] text-lg font-bold text-white">
                  이 틀로 만들기
                </button>

                <div className="flex flex-col gap-2">
                  <span className="text-[17px] font-bold">이런 탐구에 잘 맞아요</span>
                  <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-[#4F6275]">
                    {selectedType.goodFor.map((g) => <li key={g}>{g}</li>)}
                  </ul>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[17px] font-bold">같은 종류의 다른 틀</span>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {gallery.filter((t) => t.id !== detail.id).slice(0, 6).map((t) => (
                      <button key={t.id} onClick={() => setDetailId(t.id)} className="w-28 shrink-0">
                        <img src={t.thumb} alt={t.name} className="aspect-[3/2] w-full rounded-lg border border-[#D6E2EC] object-cover" />
                        <span className="mt-1 block truncate text-xs text-[#4F6275]">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </section>
        )}

        {/* ── 4. 모양 (테마 · 배치) ───────────────── */}
        {step === 4 && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-[15px] text-[#4F6275]">같은 내용이라도 모양은 내 마음대로</span>
              <h2 className="text-3xl font-black tracking-tight">어떤 분위기로 만들까?</h2>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
              {Object.entries(THEMES).map(([id, th]) => (
                <button key={id} onClick={() => setTheme(id)}
                  className={`flex flex-col overflow-hidden rounded-2xl border-[3px] bg-white text-left ${theme === id ? 'border-[#0B6BCB]' : 'border-transparent'}`}>
                  <div className="flex h-36 flex-col gap-2 p-4" style={{ background: th.bg, fontFamily: th.font, color: th.ink }}>
                    <span className="text-lg font-bold" style={{ fontFamily: th.titleFont, color: th.head ?? th.ink }}>
                      {TEMPLATES.find((t) => t.id === templateId)?.name ?? '미리보기'}
                    </span>
                    <div className="flex flex-1 items-end gap-1.5 p-2" style={{ background: th.panel, borderRadius: th.radius }}>
                      {[40, 65, 90, 55, 75].map((h, i) => (
                        <span key={i} className="flex-1" style={{ height: `${h}%`, background: i === 2 ? th.accent : th.chip, borderRadius: 3 }} />
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 px-4 py-3">
                    <span className="font-bold">{th.name}</span>
                    <span className="text-sm text-[#4F6275]">{th.desc}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-[#D6E2EC] bg-white p-5">
              <span className="font-bold">배치</span>
              {[['side', '좌우형', 'M12 1v24M3 7h6M3 11h6'], ['stack', '위아래형', 'M1 17h32M5 13l6-6 5 3 6-6 7 4']].map(([id, label, icon]) => (
                <button key={id} onClick={() => setLayout(id)}
                  className={`flex min-h-[52px] items-center gap-2.5 rounded-xl border-2 px-4 ${layout === id ? 'border-[#0B6BCB] bg-[#E3F0FC]' : 'border-[#D6E2EC] bg-white'}`}>
                  <svg width="34" height="26" viewBox="0 0 34 26" fill="none" stroke="#0F2233" strokeWidth="1.6" aria-hidden="true">
                    <rect x="1" y="1" width="32" height="24" rx="3" /><path d={icon} />
                  </svg>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap justify-between gap-3">
              <button onClick={() => setStep(3)} className="min-h-[48px] rounded-xl border border-[#B9CCDC] bg-white px-5">이전</button>
              <button onClick={build} className="min-h-[48px] rounded-xl bg-[#0B6BCB] px-7 font-bold text-white">결과물 만들기</button>
            </div>
          </section>
        )}

        {/* ── 5. 만드는 중 ─────────────────────── */}
        {step === 5 && (
          <section className="flex justify-center py-10">
            <div className="flex w-full max-w-md flex-col gap-5 rounded-[28px] bg-white p-8 shadow-[0_10px_40px_rgba(15,34,51,0.08)]">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B6BCB]">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 14c3-3 5-3 8 0s5 3 8 0 3-2 4-2" /><path d="M12 3c2 3 3 4.5 3 6a3 3 0 0 1-6 0c0-1.5 1-3 3-6z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-black">결과물 만드는 중</h2>
                <p className="mt-1 text-[15px] text-[#4F6275]">잠깐이면 돼요. 창을 닫지 말아 주세요.</p>
              </div>

              <ol className="flex flex-col gap-3 rounded-2xl border border-[#E3E8EE] bg-[#F8FAFC] p-5">
                {[
                  ['탐구 설계 저장', ''],
                  ['내용 쓰는 중', '변수와 설명을 정리하고 있어요'],
                  ['틀에 끼우기', ''],
                  ['완성', ''],
                ].map(([label, sub], i) => {
                  const done = stage > i;
                  const now = stage === i && !buildError;
                  return (
                    <li key={label} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 items-center justify-center">
                        {done ? <span className="text-[#1E9E62]">✓</span>
                          : now ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#0B6BCB] border-t-transparent" />
                          : <span className="h-1.5 w-1.5 rounded-full bg-[#9AA8B6]" />}
                      </span>
                      <span className="flex flex-col">
                        <span className={done || now ? 'text-[#0F2233]' : 'text-[#8796A5]'}>{label}</span>
                        {now && sub && <span className="text-sm text-[#4F6275]">{sub}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* 기다리는 동안 보고서 문장 미리보기 */}
              {!buildError && stage <= 1 && (chosen || predicted) && (
                <div className="flex flex-col gap-1.5 rounded-2xl bg-[#E3F0FC] p-4">
                  <span className="text-sm font-bold text-[#08529C]">보고서에 이렇게 쓸 수 있어요</span>
                  <span className="text-[15px] leading-relaxed">
                    "{topic}"을(를) 탐구하기 위해 {chosen ? `'${chosen}'을(를) 바꿔 가며 ` : ''}확인했다.
                    {predicted ? ` 처음에는 '${predicted}'라고 예상했다.` : ''}
                  </span>
                </div>
              )}

              {buildError && (
                <div className="flex flex-col gap-3 rounded-2xl border border-[#F2C9C9] bg-[#FDF2F2] p-4">
                  <span className="font-bold text-[#9A2B2B]">{buildError.message}</span>
                  {buildError.code === 'FREE_LIMIT' ? (
                    <span className="text-sm text-[#7A3B3B]">맞춤 제작(4,900원)으로 더 만들 수 있어요.</span>
                  ) : (
                    <button onClick={() => (buildError.retryId ? retryGenerate(buildError.retryId) : build())}
                      className="min-h-[44px] rounded-xl bg-[#0F2233] font-bold text-white">
                      다시 시도
                    </button>
                  )}
                  <button onClick={() => { setBuildError(null); setStep(4); }} className="text-sm text-[#4F6275]">모양 고르기로 돌아가기</button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}