import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { getClientId } from "../../lib/clientId";
import { RETURN_KEY } from "./Login";
import { getRefCode, clearRefCode } from "../../lib/referral";

// 구글 로그인을 마치고 돌아오는 화면
// 1) 세션 확인 → 2) 로그인 전 익명 진단을 내 기록으로 연결 → 3) 원래 가던 곳으로
export default function AuthCallback() {
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const ran = useRef(false); // 개발 모드에서 두 번 실행되는 것 방지

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // 구글 화면에서 취소하거나 오류가 나면 주소에 error가 붙어서 돌아온다
    const params = new URLSearchParams(
      window.location.search + window.location.hash.replace("#", "&")
    );
    if (params.get("error")) {
      setErr("구글 로그인이 취소되었거나 실패했습니다.");
      return;
    }

    let sub;
    let timer;

    async function finish(session) {
      sub?.unsubscribe();
      clearTimeout(timer);

      // 로그인 전에 남긴 익명 진단을 내 기록으로 이어붙인다
      const { error } = await supabase.rpc("claim_my_queries", {
        p_client_id: getClientId(),
      });
      if (error) console.warn("claim failed", error);

      // 추천 링크로 들어온 새 회원이면 추천한 사람과 연결한다
      // (가입 전에 이미 진단했다면 이 자리에서 추천인에게 +3회가 지급된다)
      const ref = getRefCode();
      if (ref) {
        const { data: rr, error: re } = await supabase.rpc("claim_referral", { p_code: ref });
        if (re) console.warn("referral claim failed", re);
        else {
          console.info("referral:", rr); // ok | self | not_new | no_code
          clearRefCode(); // 한 번 확인했으면 결과와 상관없이 지운다
        }
      }

      // 로그인 화면에서 보관해 둔 진단 정보를 꺼낸다
      let back = null;
      try {
        back = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "null");
        sessionStorage.removeItem(RETURN_KEY);
      } catch {
        back = null;
      }

      // 학년·약관 동의를 아직 안 받은 사람은 가입 마무리 화면으로
      const meta = session.user.user_metadata ?? {};
      if (!meta.agreed_at && !meta.grade) {
        nav("/signup", { state: back, replace: true });
        return;
      }

      if (back?.topic) nav("/result", { state: back, replace: true });
      else nav("/", { replace: true });
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) return finish(data.session);

      // 세션이 아직 안 만들어졌으면 잠깐 기다린다
      sub = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) finish(session);
      }).data.subscription;

      timer = setTimeout(() => {
        sub?.unsubscribe();
        setErr("로그인 확인에 시간이 너무 오래 걸립니다. 다시 시도해 주세요.");
      }, 8000);
    });

    return () => {
      sub?.unsubscribe();
      clearTimeout(timer);
    };
  }, [nav]);

  if (err) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <p className="text-lg font-extrabold text-sm-navy">{err}</p>
        <Link
          to="/login"
          replace
          className="mt-6 inline-block rounded-lg bg-sm-orange px-6 py-3 text-sm font-extrabold text-white"
        >
          다시 로그인하기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 py-24 text-center">
      <p className="text-sm font-bold text-gray-500">로그인 확인 중…</p>
    </div>
  );
}