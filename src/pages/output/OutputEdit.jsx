// 생수면 · 탐구 결과물 완성·편집 화면 (6-2)
// 경로: src/pages/output/OutputEdit.jsx
// 라우트 예: <Route path="/output/:id" element={<OutputEdit />} />
// 필요 패키지: npm i qrcode.react html-to-image

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { toPng } from 'html-to-image';
import { supabase } from '../../lib/supabase'; // 생수면 Supabase 클라이언트 경로에 맞게
import { THEMES, typeOf } from '../../data/outputCatalog';
import OutputRenderer from './OutputRenderer';

const ACCENTS = ['#D7263D', '#E8730C', '#1E9E62', '#1D6FE0', '#7B3FE4', '#111111'];
const EDIT_LIMIT = 20;

export default function OutputEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const resultRef = useRef(null);

  const [output, setOutput] = useState(null);
  const [edits, setEdits] = useState([]);
  const [version, setVersion] = useState(0);      // 결과물을 다시 그릴 때 올림
  const [panel, setPanel] = useState(null);        // 열려 있는 '다음에 뭘 해 볼까?' 보기
  const [device, setDevice] = useState('web');     // web / phone
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);      // { kind: 'ok' | 'upsell' | 'error', text }
  const [ranges, setRanges] = useState({});        // 시뮬레이터 값 범위 입력
  const [copied, setCopied] = useState(false);

  // 불러오기
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('research_outputs').select('*').eq('id', id).single();
      if (error || !data) { setNotice({ kind: 'error', text: '결과물을 찾을 수 없어요' }); return; }
      setOutput(data);
      const { data: log } = await supabase.from('research_output_edits')
        .select('request, applied, created_at').eq('output_id', id).order('created_at');
      setEdits(log ?? []);
    })();
  }, [id]);

  if (!output) {
    return <div className="flex min-h-screen items-center justify-center bg-[#F3F7FA] text-[#4F6275]">{notice?.text ?? '불러오는 중…'}</div>;
  }

  const type = typeOf(output.output_type);
  const editsLeft = EDIT_LIMIT - (output.edit_count ?? 0);
  const shareUrl = `${window.location.origin}/r/${output.slug}`;

  const readError = async (error) => {
    try { return (await error.context.json()).error; } catch { return '잠시 후 다시 해 주세요'; }
  };

  // ── 바로 고치기 (무료) ──
  const quick = async (label, patch) => {
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.functions.invoke('build-output', { body: { mode: 'quick', id, label, patch } });
    setBusy(false);
    if (error) { setNotice({ kind: 'error', text: await readError(error) }); return; }
    setOutput((o) => ({ ...o, theme: data.theme, layout: data.layout, content: data.content }));
    setEdits((e) => [...e, { request: label, applied: true }]);
    setVersion((v) => v + 1);
  };

  // ── 말로 고치기 (AI, 20번) ──
  const edit = async (text) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true); setNotice(null);
    const { data, error } = await supabase.functions.invoke('build-output', { body: { mode: 'edit', id, request: msg } });
    setBusy(false);
    if (error) { setNotice({ kind: 'error', text: await readError(error) }); return; }
    setRequest('');
    setEdits((e) => [...e, { request: msg, applied: data.applied }]);
    setOutput((o) => ({ ...o, edit_count: EDIT_LIMIT - data.edits_left, ...(data.applied ? { content: data.content } : {}) }));
    if (data.applied) { setVersion((v) => v + 1); setNotice({ kind: 'ok', text: '고쳤어요' }); }
    else setNotice({ kind: 'upsell', text: `${data.reason} · ${data.upsell}` });
  };

  const saveImage = async () => {
    if (!resultRef.current) return;
    const url = await toPng(resultRef.current, { pixelRatio: 2 });
    const a = document.createElement('a');
    a.href = url; a.download = `${output.content?.title ?? '탐구결과물'}.png`; a.click();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const options = [
    { id: 'theme', label: '분위기(테마) 바꾸기', desc: '같은 내용, 다른 느낌으로' },
    { id: 'layout', label: '배치 바꾸기', desc: '좌우형 ↔ 위아래형' },
    { id: 'accent', label: '강조색 바꾸기', desc: '그래프·숫자 색' },
    ...(output.output_type === 'sim' ? [{ id: 'range', label: '값 범위 바꾸기', desc: '슬라이더 최소·최대' }] : []),
    { id: 'report', label: '보고서 문장 받기', desc: '탐구 과정·결론에 붙여 넣기' },
    { id: 'share', label: '공유·저장하기', desc: '링크, QR, 이미지' },
  ];

  return (
    <div className="min-h-screen bg-[#F3F7FA] text-[#0F2233]">
      {/* 위쪽 바 */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[#D6E2EC] bg-white px-4 py-2.5">
        <button onClick={() => navigate('/output/new')} className="text-sm text-[#4F6275]">← 새로 만들기</button>
        <span className="min-w-0 flex-1 truncate font-bold">{output.content?.title}</span>
        <div className="flex gap-1 rounded-xl border border-[#D6E2EC] p-1">
          {[['web', '웹'], ['phone', '휴대폰']].map(([d, label]) => (
            <button key={d} onClick={() => setDevice(d)}
              className={`min-h-[36px] rounded-lg px-3 text-sm ${device === d ? 'bg-[#0F2233] text-white' : 'text-[#4F6275]'}`}>{label}</button>
          ))}
        </div>
        <button onClick={() => setPanel('share')} className="min-h-[40px] rounded-xl bg-[#0B6BCB] px-4 text-sm font-bold text-white">공유</button>
      </header>

      <div className="flex flex-wrap gap-4 p-4">
        {/* 왼쪽: 다음에 뭘 해 볼까 + 말로 고치기 + 과정 기록 */}
        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 lg:max-w-[380px]">
          <div className="flex flex-col gap-2 rounded-2xl border border-[#D6E2EC] bg-white p-4">
            <span className="text-[17px] font-bold">다음에 뭘 해 볼까?</span>
            <span className="text-[13px] text-[#4F6275]">여기 있는 건 무료예요 · 횟수 안 줄어요</span>

            {options.map((op) => (
              <div key={op.id} className={`rounded-xl ${panel === op.id ? 'bg-[#F3F7FA]' : ''}`}>
                <button onClick={() => setPanel(panel === op.id ? null : op.id)} className="flex w-full items-start gap-3 p-2.5 text-left">
                  <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${panel === op.id ? 'border-[5px] border-[#0B6BCB]' : 'border-[#B9CCDC]'}`} />
                  <span className="flex flex-col"><span className="font-bold">{op.label}</span><span className="text-[13px] text-[#4F6275]">{op.desc}</span></span>
                </button>

                {panel === op.id && (
                  <div className="flex flex-wrap gap-2 px-2.5 pb-3 pl-9">
                    {op.id === 'theme' && Object.entries(THEMES).map(([tid, th]) => (
                      <button key={tid} disabled={busy} onClick={() => quick(`분위기를 ${th.name}으로`, { theme: tid })}
                        className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-2.5 text-sm ${output.theme === tid ? 'border-[#0B6BCB]' : 'border-[#D6E2EC]'} bg-white`}>
                        <span className="h-4 w-4 rounded" style={{ background: th.bg, outline: '1px solid #D6E2EC' }} />{th.name}
                      </button>
                    ))}

                    {op.id === 'layout' && [['side', '좌우형'], ['stack', '위아래형']].map(([lid, label]) => (
                      <button key={lid} disabled={busy} onClick={() => quick(`배치를 ${label}으로`, { layout: lid })}
                        className={`min-h-[40px] rounded-lg border bg-white px-3 text-sm ${output.layout === lid ? 'border-[#0B6BCB]' : 'border-[#D6E2EC]'}`}>{label}</button>
                    ))}

                    {op.id === 'accent' && ACCENTS.map((c) => (
                      <button key={c} disabled={busy} aria-label={`강조색 ${c}`} onClick={() => quick(`강조색을 ${c}로`, { accent: c })}
                        className="h-10 w-10 rounded-full border-2 border-white" style={{ background: c, outline: output.content?.style?.accent === c ? '2px solid #0F2233' : '1px solid #D6E2EC' }} />
                    ))}

                    {op.id === 'range' && (output.content?.body?.variables ?? []).map((v) => (
                      <div key={v.key} className="flex w-full flex-wrap items-center gap-2 text-sm">
                        <span className="w-24 font-bold">{v.label}</span>
                        <input type="number" defaultValue={v.min} aria-label={`${v.label} 최소`} onChange={(e) => setRanges((r) => ({ ...r, [v.key]: { ...r[v.key], min: Number(e.target.value) } }))}
                          className="w-20 rounded-lg border border-[#D6E2EC] px-2 py-1.5" />
                        <span>~</span>
                        <input type="number" defaultValue={v.max} aria-label={`${v.label} 최대`} onChange={(e) => setRanges((r) => ({ ...r, [v.key]: { ...r[v.key], max: Number(e.target.value) } }))}
                          className="w-20 rounded-lg border border-[#D6E2EC] px-2 py-1.5" />
                      </div>
                    ))}
                    {op.id === 'range' && (
                      <button disabled={busy}
                        onClick={() => quick('값 범위 바꾸기', { ranges: (output.content?.body?.variables ?? []).map((v) => ({ key: v.key, min: ranges[v.key]?.min ?? v.min, max: ranges[v.key]?.max ?? v.max })) })}
                        className="min-h-[40px] rounded-lg bg-[#0F2233] px-4 text-sm font-bold text-white">적용</button>
                    )}

                    {op.id === 'report' && (
                      <div className="flex w-full flex-col gap-2">
                        <p className="rounded-lg bg-white p-3 text-sm leading-relaxed">{output.content?.report_sentence}</p>
                        <button onClick={() => navigator.clipboard.writeText(output.content?.report_sentence ?? '')}
                          className="min-h-[40px] self-start rounded-lg border border-[#D6E2EC] bg-white px-3 text-sm">문장 복사</button>
                      </div>
                    )}

                    {op.id === 'share' && (
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex items-center gap-2 rounded-lg bg-white p-2.5 text-sm">
                          <span className="min-w-0 flex-1 truncate">{shareUrl}</span>
                          <button onClick={copyLink} className="shrink-0 rounded-md bg-[#0B6BCB] px-3 py-1.5 font-bold text-white">{copied ? '복사됨' : '복사'}</button>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg bg-white p-2"><QRCodeSVG value={shareUrl} size={96} fgColor={output.content?.style?.accent ?? '#0F2233'} /></div>
                          <span className="text-[13px] leading-relaxed text-[#4F6275]">보고서에 QR을 붙이면<br />선생님이 직접 움직여 볼 수 있어요</span>
                        </div>
                        <button onClick={saveImage} className="min-h-[40px] self-start rounded-lg border border-[#D6E2EC] bg-white px-3 text-sm">이미지로 저장</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 말로 고치기 */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-[#D6E2EC] bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[17px] font-bold">말로 고치기</span>
              <span className="text-[13px] text-[#4F6275]">{editsLeft}번 남음</span>
            </div>
            <div className="flex gap-2">
              <label htmlFor="req" className="sr-only">고칠 내용</label>
              <input id="req" value={request} onChange={(e) => setRequest(e.target.value)} maxLength={200}
                onKeyDown={(e) => e.key === 'Enter' && edit(request)}
                placeholder={busy ? '고치는 중…' : '예: 제목을 더 짧게 해 줘'} disabled={busy || editsLeft <= 0}
                className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-[#B9CCDC] px-3" />
              <button onClick={() => edit(request)} disabled={busy || editsLeft <= 0 || !request.trim()}
                className="min-h-[44px] rounded-xl bg-[#0B6BCB] px-4 font-bold text-white disabled:opacity-40">보내기</button>
            </div>
            {notice && (
              <div className={`rounded-xl p-3 text-sm leading-relaxed ${
                notice.kind === 'ok' ? 'bg-[#E7F6EE] text-[#1B6B44]' : notice.kind === 'upsell' ? 'border border-[#F2D9A6] bg-[#FFF6E5] text-[#5C4A26]' : 'bg-[#FDF2F2] text-[#9A2B2B]'}`}>
                {notice.text}
              </div>
            )}
          </div>

          {/* 탐구 과정 기록 */}
          <div className="flex flex-col gap-2.5 rounded-2xl border border-[#D6E2EC] bg-white p-4">
            <span className="text-[17px] font-bold">탐구 과정 기록</span>
            <span className="text-[13px] text-[#4F6275]">이 기록이 보고서의 '탐구 과정'이 돼요</span>
            {[
              { k: '탐구주제', v: output.topic },
              { k: '결과물 종류', v: type?.name },
              ...Object.entries(output.answers ?? {}).map(([k, v]) => ({ k, v })),
              ...edits.map((e, i) => ({ k: `수정 ${i + 1}${e.applied ? '' : ' (틀로 안 됨)'}`, v: e.request })),
            ].map((row, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#0B6BCB]" />
                <span className="flex flex-col"><span className="text-[13px] text-[#4F6275]">{row.k}</span><span className="text-[15px] leading-relaxed">{row.v}</span></span>
              </div>
            ))}
          </div>
        </aside>

        {/* 오른쪽: 결과물 */}
        <main className="flex min-w-0 flex-[999_1_560px] justify-center">
          <div ref={resultRef} className={device === 'phone' ? 'w-[390px] max-w-full' : 'w-full'}>
            <OutputRenderer key={version} output={output} />
          </div>
        </main>
      </div>
    </div>
  );
}