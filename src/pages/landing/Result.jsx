import { useEffect, useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";
import { getClientId } from "../../lib/clientId";
import "./landing.css";

const KEY = "sm_diagnosis"; // 가입·로그인을 다녀와도 결과가 남아 있도록 보관

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
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Result() {
  const nav = useNavigate();
  const { state } = useLocation();
  const { user } = useAuth();

  const saved = loadSaved();
  // 랜딩에서 새로 넘어왔으면 그 값을, 가입하고 돌아왔으면 보관해 둔 값을 쓴다
  const input = state?.topic ? state : saved?.input ?? null;

  const sameTopic = saved?.input?.topic === input?.topic;
  const [data, setData] = useState(sameTopic ? saved?.result : null);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(0);

  // 진단이 끝나는 시점은 알 수 없으므로, 천천히 차오르다 응답이 오면 채운다
  useEffect(() => {
    if (data || err) {
      setProgress(100);
      return;
    }
    setProgress(0);
    const started = Date.now();
    const t = setInterval(() => {
      const sec = (Date.now() - started) / 1000;
      setProgress(Math.min(95, Math.round(100 * (1 - Math.exp(-sec / 5)))));
    }, 120);
    return () => clearInterval(t);
  }, [data, err]);

  useEffect(() => {
    if (!input || data) return;
    let alive = true;

    (async () => {
      const { data: res, error } = await supabase.functions.invoke("diagnose", {
        body: {
          department: input.department,
          grade: input.grade,
          term: input.term,
          subject: input.subject,
          topic: input.topic,
          user_id: user?.id ?? null,
          client_id: getClientId(),
        },
      });

      if (!alive) return;
      if (error || res?.error) {
        console.error("diagnose failed", error, res);
        setErr("진단에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setData(res);
      // 점수가 나온 정상 결과만 보관한다 (한도 초과·무효는 보관하지 않음)
      if (!res?.quota_exceeded && !res?.invalid) {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ input, result: res }));
        } catch (e) {
          console.warn("결과 보관 실패", e);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [input, data, user]);

  if (!input) return <Navigate to="/" replace />;

  const { department, grade, term, subject, topic } = input;
  const unlocked = Boolean(user); // 로그인했으면 이유와 대안을 연다

  function reset() {
    sessionStorage.removeItem(KEY);
    nav("/");
  }

  /* 하루 진단 횟수를 다 쓴 경우 */
  if (data?.quota_exceeded) {
    const member = data.is_member;
    return (
      <div className="lp">
        <section className="rs">
          <div className="wrap">
            <p className="rs-topic">{topic}</p>
            <div className="rs-error">
              <p className="rs-invalid-t">
                {member ? "오늘 진단을 모두 사용했어요" : "오늘은 여기까지예요"}
              </p>
              <p>
                {member ? (
                  <>
                    하루 {data.daily_limit ?? 3}번까지 진단할 수 있어요
                    <br />
                    내일 다시 확인해 주세요
                  </>
                ) : (
                  <>
                    회원가입하면 하루 3번까지 진단할 수 있어요
                    <br />
                    이유와 대안 주제도 함께 볼 수 있고요
                  </>
                )}
              </p>
              <p className="rs-invalid-ex">
                이미 진단한 주제는 횟수와 상관없이 다시 볼 수 있어요
              </p>
              {member ? (
                <button onClick={reset}>처음으로</button>
              ) : (
                <button onClick={() => nav("/signup", { state: input })}>회원가입하기</button>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* 탐구주제로 성립하지 않는 입력 */
  if (data?.invalid) {
    return (
      <div className="lp">
        <section className="rs">
          <div className="wrap">
            <p className="rs-topic">{topic}</p>
            <div className="rs-error">
              <p className="rs-invalid-t">탐구주제로 읽기 어려워요</p>
              <p>
                {data.invalid_reason ||
                  "무엇을 알아보려는 건지 조금 더 구체적으로 적어주세요."}
              </p>
              <p className="rs-invalid-ex">예) 한글 자음의 조음 위치와 구강 구조의 관계</p>
              <button onClick={reset}>다시 입력하기</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="lp">
      <section className="rs">
        <div className="wrap">
          <p className="rs-meta">
            {department} · {grade} · {term} · {subject}
          </p>
          <p className="rs-topic">{topic}</p>

          {!data && !err && (
            <div className="rs-loading">
              <p>탐구주제를 진단하고 있어요</p>
              <div className="rs-prog">
                <b style={{ width: `${progress}%` }} />
              </div>
              <span className="rs-pct">{progress}%</span>
            </div>
          )}

          {err && (
            <div className="rs-error">
              <p>{err}</p>
              <button onClick={reset}>처음으로</button>
            </div>
          )}

          {data && !data.invalid && (
            <>
              {/* 공개 — 지수 */}
              <div className="rs-score">
                <span className="rs-label">흔함 지수</span>
                <strong className="rs-num">
                  {data.score}
                  <em>/100</em>
                </strong>
                <p className="rs-verdict">{verdictOf(data.score)}</p>
                <p className="rs-sub">AI가 실제 생기부 탐구 경향을 바탕으로 판단했어요</p>

                {data.breakdown && (
                  <div className="rs-bars">
                    {Object.entries(data.breakdown).map(([k, v]) => {
                      const max = k === "소재" ? 40 : 20; // 항목마다 만점이 다르다
                      return (
                        <div className="rs-bar" key={k}>
                          <span>{k}</span>
                          <i>
                            <b style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
                          </i>
                          <em>
                            {v}
                            <small>/{max}</small>
                          </em>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 이유와 대안 — 로그인해야 열린다 */}
              {unlocked ? (
                <div className="rs-open">
                  <p className="rs-lock-t">왜 흔한 주제일까?</p>
                  <p className="rs-lock-d">{data.reason}</p>

                  <p className="rs-lock-t">이렇게 바꿔보세요</p>
                  <ul className="rs-alts">
                    {(data.alternatives ?? []).map((a) => (
                      <li key={a.topic}>
                        <span className="rs-alt-label">{a.label}</span>
                        <p className="rs-alt-topic">{a.topic}</p>
                        <span className="rs-alt-score">
                          흔함 {data.score} → <b>{a.score}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rs-lock">
                  <div className="rs-blur" aria-hidden="true">
                    <p className="rs-lock-t">왜 흔한 주제일까?</p>
                    <p className="rs-lock-d">{data.reason}</p>
                    <p className="rs-lock-t">이렇게 바꿔보세요</p>
                    <p className="rs-lock-d">
                      {(data.alternatives ?? []).map((a) => (
                        <span key={a.topic}>
                          {a.topic} ({a.score}점)
                          <br />
                        </span>
                      ))}
                    </p>
                  </div>

                  <div className="rs-gate">
                    <p className="rs-gate-t">
                      이 주제가 왜 흔한지와
                      <br />
                      <b>상위 1% 탐구주제</b>로 변환할게요
                    </p>
                    <button
                      className="tbtn rs-gate-btn"
                      onClick={() => nav("/signup", { state: input })}
                    >
                      회원가입하고 보기
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

          <button className="rs-again" onClick={reset}>
            다른 주제 확인하기
          </button>
        </div>
      </section>
    </div>
  );
}