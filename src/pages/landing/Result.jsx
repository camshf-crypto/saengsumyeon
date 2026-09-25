import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { getClientId } from "../../lib/clientId";
import "./landing.css";

// 로그인하러 다녀와도 결과가 남아 있도록 localStorage에 보관한다
const KEY = "sm_diagnosis";

const MAX = {
  소재: 40,
  대상: 20,
  조건: 20,
  방식: 20,
}; // 항목별 만점

/*
 * 진행률 곡선 — 처음 6초는 천천히 출발해 점점 빨라지고,
 * 그 뒤로는 멈춘 것처럼 보이지 않게 계속 조금씩 오른다 (99를 넘지 않음)
 * 응답이 오면 100%로 빠르게 채운다
 */
function curve(sec) {
  const p = sec < 6 ? 50 * Math.pow(sec / 6, 1.5) : 50 + 49 * (1 - Math.exp(-(sec - 6) / 8));
  return Math.min(99, Math.round(p));
}

/* 진행률에 따라 바뀌는 안내 문구 */
function stageOf(p) {
  if (p >= 100) return "거의 다 됐어요";
  if (p >= 75) return "더 나은 주제를 찾고 있어요";
  if (p >= 40) return "비슷한 탐구와 비교하고 있어요";
  return "탐구주제를 읽고 있어요";
}

/* 비로그인일 때 가리는 스타일과 대상 항목 (소재·대상은 공개) */
const LOCKED = { filter: "blur(6px)", userSelect: "none", pointerEvents: "none" };
const LOCKED_KEYS = ["조건", "방식"];

/* 판정 문구는 점수에서 직접 만든다 (AI 출력의 오타를 타지 않도록) */
function verdictOf(score) {
  if (score >= 85) return "아주 흔해요";
  if (score >= 65) return "흔한 편이에요";
  if (score >= 45) return "조금 흔해요";
  if (score >= 25) return "괜찮은 편이에요";
  return "드문 편이에요";
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/*
 * 진단 요청
 * 로그인 정보는 화면 상태를 기다리지 않고 세션에서 바로 읽는다
 * (로그인 정보가 늦게 들어오면서 요청이 두 번 나가던 문제 방지)
 */
async function runDiagnose(input) {
  const { data: s } = await supabase.auth.getSession();

  return supabase.functions.invoke("diagnose", {
    body: {
      ...input,
      user_id: s.session?.user?.id ?? null,
      client_id: getClientId(),
    },
  });
}

/* 안내 카드 — 무효 입력, 한도 초과, 오류에 공통으로 쓴다 */
function Notice({ topic, title, body, note, action }) {
  return (
    <div className="lp">
      <section className="rs">
        <div className="wrap">
          {topic && <p className="rs-topic">{topic}</p>}

          <div className="rs-error">
            {title && <p className="rs-invalid-t">{title}</p>}
            <p>{body}</p>
            {note && <p className="rs-invalid-ex">{note}</p>}
            <button onClick={action.onClick}>{action.label}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* 이유와 제안 — 잠금 상태에서도 같은 내용을 쓴다 */
function Detail({ data }) {
  const s = data.suggestion;

  return (
    <>
      <p className="rs-lock-t">왜 흔한 주제일까?</p>
      <p className="rs-lock-d">{data.reason}</p>

      {s && (
        <>
          <p className="rs-lock-t">이렇게 바꿔보세요</p>

          <div className="rs-sug">
            <p className="rs-sug-topic">{s.topic}</p>
            {s.how && (
              <p className="rs-sug-how">
                {s.how
                  .replace(/흔함\s*지수\s*\d+\s*(?:점)?\s*(?:→|->)\s*\d+\s*(?:점)?/g, "상위 1% 탐구주제")
                  .replace(/\d+\s*(?:점)?\s*(?:→|->)\s*\d+\s*(?:점)?/g, "상위 1% 탐구주제")}
              </p>
            )}

            {/* 항상 동일하게 표시 */}
            <div className="rs-sug-score">
              <strong>상위 1% 탐구주제</strong>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function Result() {
  const nav = useNavigate();
  const { state } = useLocation();
  const { user } = useAuth();

  const saved = loadSaved();

  // 랜딩에서 새로 넘어왔으면 그 값을,
  // 가입/로그인하고 돌아왔으면 보관해 둔 값을 쓴다
  const input = state?.topic ? state : saved?.input ?? null;
  const inputKey = input ? JSON.stringify(input) : null;

  const sameTopic = saved?.input?.topic === input?.topic;

  const [data, setData] = useState(sameTopic ? saved?.result : null);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false); // 응답이 왔는지 (100%를 잠깐 보여주고 결과로)

  // 같은 입력으로는 요청을 한 번만 보낸다
  const req = useRef({ key: null, promise: null });

  useEffect(() => {
    if (data || err || done) {
      setProgress(100);
      return;
    }

    setProgress(0);
    const started = Date.now();
    const t = setInterval(() => setProgress(curve((Date.now() - started) / 1000)), 200);
    return () => clearInterval(t);
  }, [data, err, done]);

  /*
   * Supabase 진단 호출
   * 화면이 다시 그려지거나 로그인 정보가 늦게 들어와도
   * 이미 보낸 요청이 있으면 새로 보내지 않고 그 결과를 기다린다
   */
  useEffect(() => {
    if (!inputKey || data) return;

    if (req.current.key !== inputKey) {
      req.current = { key: inputKey, promise: runDiagnose(input) };
    }

    let alive = true;

    req.current.promise.then(({ data: res, error }) => {
      if (!alive) return;

      setDone(true); // 막대를 100%로 채운다

      if (error || res?.error) {
        console.error("diagnose failed", error, res);
        setTimeout(() => alive && setErr("진단에 실패했습니다. 잠시 후 다시 시도해 주세요."), 450);
        return;
      }

      // 100%가 찬 걸 잠깐 보여준 뒤 결과로 넘어간다
      setTimeout(() => alive && setData(res), 450);

      // 정상 결과만 저장 (한도 초과 / 무효 입력은 저장하지 않는다)
      if (!res?.quota_exceeded && !res?.invalid) {
        try {
          localStorage.setItem(KEY, JSON.stringify({ input, result: res }));
        } catch (e) {
          console.warn("결과 보관 실패", e);
        }
      }
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, data]);

  // 입력값 자체가 없으면 메인으로
  if (!input) return <Navigate to="/" replace />;

  const { department, grade, term, subject, topic } = input;

  // 로그인했으면 이유와 제안을 보여준다
  const unlocked = Boolean(user);

  // 새로운 주제 진단
  function reset() {
    localStorage.removeItem(KEY);
    nav("/");
  }

  // 하루 진단 횟수를 다 쓴 경우
  if (data?.quota_exceeded) {
    const member = data.is_member;

    return (
      <Notice
        topic={topic}
        title={member ? "오늘 진단을 모두 사용했어요" : "오늘은 여기까지예요"}
        body={
          member
            ? `하루 ${data.daily_limit ?? 3}번까지 진단할 수 있어요. 내일 다시 확인해 주세요.`
            : "회원가입하면 하루 3번까지 진단할 수 있어요. 이유와 제안 주제도 함께 볼 수 있고요."
        }
        note="이미 진단한 주제는 횟수와 상관없이 다시 볼 수 있어요"
        action={
          member
            ? { label: "처음으로", onClick: reset }
            : { label: "회원가입하기", onClick: () => nav("/signup", { state: input }) }
        }
      />
    );
  }

  // 탐구주제로 성립하지 않는 입력
  if (data?.invalid) {
    return (
      <Notice
        topic={topic}
        title="탐구주제로 읽기 어려워요"
        body={data.invalid_reason || "무엇을 알아보려는 건지 조금 더 구체적으로 적어주세요."}
        note="예) 한글 자음의 조음 위치와 구강 구조의 관계"
        action={{ label: "다시 입력하기", onClick: reset }}
      />
    );
  }

  // 진단 실패
  if (err) {
    return <Notice topic={topic} body={err} action={{ label: "처음으로", onClick: reset }} />;
  }

  return (
    <div className="lp">
      <section className="rs">
        <div className="wrap">
          {/* 입력 정보 */}
          <p className="rs-meta">
            {department} · {grade} · {term} · {subject}
          </p>
          <p className="rs-topic">{topic}</p>

          {/* 로딩 */}
          {!data ? (
            <div className="rs-loading">
              <p>{stageOf(progress)}</p>
              <div className="rs-prog">
                <b style={{ width: `${progress}%`, transition: "width 0.4s ease" }} />
              </div>
              <span className="rs-pct">{progress}%</span>
            </div>
          ) : (
            <>
              {/* 공개 영역 — 흔함 지수 */}
              <div className="rs-score">
                <span className="rs-label">흔함 지수</span>
                <strong className="rs-num">
                  {data.score}
                  <em>/100</em>
                </strong>
                <p className="rs-verdict">{verdictOf(data.score)}</p>
                <p className="rs-sub">AI가 실제 생기부 탐구 경향을 바탕으로 판단했어요</p>

                {/* 세부 점수 — 비로그인이면 조건·방식만 흐리게 가린다 (소재·대상은 공개) */}
                {data.breakdown && (
                  <>
                    <div className="rs-bars">
                      {Object.entries(data.breakdown).map(([k, v]) => {
                        const max = MAX[k] ?? 20;
                        const hidden = !unlocked && LOCKED_KEYS.includes(k);
                        return (
                          <div className="rs-bar" key={k}>
                            <span>{k}</span>
                            <i style={hidden ? LOCKED : undefined} aria-hidden={hidden}>
                              <b style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
                            </i>
                            <em style={hidden ? LOCKED : undefined} aria-hidden={hidden}>
                              {v}
                              <small>/{max}</small>
                            </em>
                          </div>
                        );
                      })}
                    </div>

                    {!unlocked && (
                      <p className="mt-2 text-center text-[12.5px] font-bold text-gray-400">
                        조건·방식 점수는 가입 후 확인할 수 있어요
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* 이유와 제안 */}
              {unlocked ? (
                // 로그인 상태 — 전체 내용 공개
                <div className="rs-open">
                  <Detail data={data} />
                </div>
              ) : (
                // 비로그인 상태 — 이유/제안 블러 처리
                <div className="rs-lock">
                  <div className="rs-blur" aria-hidden="true">
                    <Detail data={data} />
                  </div>

                  <div className="rs-gate">
                    <p className="rs-gate-t">
                      이 주제가 왜 흔한지와
                      <br />
                      <b>상위 1% 탐구주제로 바꾸는 방법</b>을
                      <br />
                      알려드려요
                    </p>

                    <button
                      className="tbtn rs-gate-btn"
                      onClick={() => nav("/signup", { state: input })}
                    >
                      회원가입하고 제안받기
                    </button>

                    <button
                      className="rs-gate-sub"
                      onClick={() => nav("/login", { state: input })}
                    >
                      이미 계정이 있어요 · 로그인
                    </button>
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </section>
    </div>
  );
}