-- 가입 시 학교·학년·마케팅 동의까지 저장하도록 트리거 갱신
-- 01_schema.sql 실행 후 이어서 실행

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, name, phone, school, grade, marketing_agreed)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', '수강생'),
          new.raw_user_meta_data->>'phone',
          new.raw_user_meta_data->>'school',
          new.raw_user_meta_data->>'grade',
          coalesce((new.raw_user_meta_data->>'marketing_agreed')::boolean, false));
  return new;
end;
$$;
