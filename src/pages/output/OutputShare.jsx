// 생수면 · 탐구 결과물 공유 화면 (7단계)
// 경로: src/pages/output/OutputShare.jsx
// 라우트 예: <Route path="/r/:slug" element={<OutputShare />} />
// 로그인 없이 열립니다 (SQL의 get_shared_output 함수 사용)

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase'; // 생수면 Supabase 클라이언트 경로에 맞게
import OutputRenderer from './OutputRenderer';

export default function OutputShare() {
  const { slug } = useParams();
  const [output, setOutput] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    supabase.rpc('get_shared_output', { p_slug: slug }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setMissing(true); return; }
      setOutput(row);
      document.title = `${row.content?.title ?? '탐구 결과물'} · 생수면`;
    });
  }, [slug]);

  if (missing) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F3F7FA] p-6 text-center text-[#0F2233]">
        <span className="text-xl font-bold">결과물을 찾을 수 없어요</span>
        <span className="text-[#4F6275]">링크가 바뀌었거나 지워진 결과물이에요.</span>
        <Link to="/output/new" className="rounded-xl bg-[#0B6BCB] px-5 py-3 font-bold text-white">나도 만들어 보기</Link>
      </div>
    );
  }
  if (!output) return <div className="flex min-h-screen items-center justify-center bg-[#F3F7FA] text-[#4F6275]">불러오는 중…</div>;

  const made = new Date(output.created_at).toLocaleDateString('ko-KR');

  return (
    <div className="min-h-screen bg-[#F3F7FA] text-[#0F2233] print:bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 print:max-w-none print:p-0">
        {/* 위쪽: 인쇄할 땐 숨김 */}
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <span className="text-sm text-[#4F6275]">탐구주제 · {output.topic}</span>
          <button onClick={() => window.print()} className="min-h-[40px] rounded-xl border border-[#B9CCDC] bg-white px-4 text-sm">PDF로 저장 · 인쇄</button>
        </div>

        <OutputRenderer output={output} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D6E2EC] bg-white p-4 print:border-0 print:p-0">
          <span className="text-sm text-[#4F6275]">생수면으로 만든 탐구 결과물 · {made}</span>
          <Link to="/output/new" className="rounded-xl bg-[#0B6BCB] px-4 py-2.5 text-sm font-bold text-white print:hidden">나도 내 탐구로 만들어 보기</Link>
        </div>
      </div>
    </div>
  );
}