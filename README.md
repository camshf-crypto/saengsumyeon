# 생수면 대입면접 합격패스 — 온라인 강의몰

React + Vite + Tailwind + Supabase.
결제는 포트원(PortOne) + KG이니시스.

## 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

`.env.local`

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Supabase 준비

SQL Editor에서 순서대로 실행.

1. `sql/01_schema.sql` — 테이블 + RLS
2. `sql/01b_portone_patch.sql` — 결제 컬럼 + `confirm_order()`
3. `sql/01c_profile_trigger.sql` — 가입 트리거

Authentication > Providers > Email 에서 **Confirm email 을 꺼둘 것.**
켜져 있으면 가입 직후 바로 결제로 넘어가지 못한다.

관리자 계정은 가입 후 직접 승격.

```sql
update profiles set role = 'master' where id = '<auth.users의 uuid>';
```

## 폴더

```
src/
  lib/
    supabase.js       Supabase 클라이언트
    AuthContext.jsx   세션 + 프로필 + 장바구니 개수
  components/
    Header.jsx        상단 유틸바 + GNB
    Footer.jsx        사업자정보 (실제 값으로 교체 필요)
  pages/
    auth/Login.jsx
    auth/Signup.jsx
  App.jsx             라우팅
public/
  landing.html        판매 랜딩페이지 (정적, 참고용)
sql/                  Supabase 스키마
```

## 진행 상황

- [x] 1단계 DB 스키마
- [x] 2단계 회원가입 / 로그인 / 라우팅
- [ ] 3단계 상품 상세 → 장바구니
- [ ] 4단계 주문서 + 포트원 결제
- [ ] 5단계 결제 승인 → 수강권 발급
- [ ] 6단계 강의실 (플레이어 + 진도)
- [ ] 7단계 관리자

## 주의

- `/payment/complete` 라우트는 이니시스 리다이렉트 주소다. **경로를 바꾸면 PG에 재등록해야 한다.**
- 결제 금액 검증은 반드시 Edge Function에서. `confirm_order()`는 anon/authenticated 실행 권한이 없다.
- 강의 영상은 Storage에 직접 올리지 말 것. `lectures.video_provider` + `video_key`로 외부 스트리밍(Vimeo 기준) 사용.
- `Footer.jsx`의 사업자정보는 더미값이다. PG 심사 전 실제 값으로 교체.
