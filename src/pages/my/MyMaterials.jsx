import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/AuthContext";

const WORKBOOK_SLUG = "workbook-pack";
const won = (n) => (n ?? 0).toLocaleString("ko-KR") + "원";
const ymd = (d) => (d ? new Date(d).toLocaleDateString("ko-KR") : "-");

export default function MyMaterials() {
  const nav = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [workbook, setWorkbook] = useState(null); // 워크북 수강권
  const [materials, setMaterials] = useState([]);
  const [product, setProduct] = useState(null);   // 교재 구매용 상품
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;

    (async () => {
      const [{ data: enrolls }, { data: prod }] = await Promise.all([
        supabase
          .from("enrollments")
          .select("id, course_id, expires_at, status, courses(slug)")
          .eq("user_id", user.id)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString()),
        supabase.from("products").select("*").eq("slug", "workbook").maybeSingle(),
      ]);

      const book = (enrolls ?? []).find((e) => e.courses?.slug === WORKBOOK_SLUG) ?? null;
      setWorkbook(book);
      setProduct(prod ?? null);

      if (book) {
        const { data: mats } = await supabase
          .from("course_materials")
          .select("id, title, file_path")
          .eq("course_id", book.course_id)
          .order("sort_order");
        setMaterials(mats ?? []);
      }
      setLoading(false);
    })();
  }, [user]);

  // 비공개 버킷이라 매번 짧게 유효한 서명 URL을 발급받는다
  async function download(path, title) {
    const { data, error } = await supabase.storage.from("materials").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      console.error("signed url", error);
      alert("파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = title;
    a.click();
  }

  async function buyBook() {
    if (!product) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("cart_items")
      .upsert({ user_id: user.id, product_id: product.id, qty: 1 }, { onConflict: "user_id,product_id" })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      console.error("cart insert", error);
      alert("장바구니에 담지 못했습니다.");
      return;
    }
    await refreshProfile();
    nav("/order", { state: { cartItemIds: [data.id] } });
  }

  if (loading) return <div className="py-32 text-center text-gray-400">불러오는 중…</div>;

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-sm-navy">교재 · 학습자료</h1>

      {workbook ? (
        <div className="mt-5 rounded-xl border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-extrabold tracking-tight text-sm-navy">대입면접 워크북</p>
              <p className="mt-1 text-[13px] text-gray-500">
                PDF로 제공됩니다 · 이용 기간 {ymd(workbook.expires_at)}까지
              </p>
            </div>
            <span className="whitespace-nowrap rounded-md bg-orange-50 px-2.5 py-1 text-xs font-bold text-sm-orange">
              보유 중
            </span>
          </div>

          {materials.length === 0 ? (
            <p className="mt-5 rounded-lg bg-gray-50 p-4 text-sm text-gray-400">
              자료가 아직 등록되지 않았습니다.
            </p>
          ) : (
            <ul className="mt-5 space-y-2">
              {materials.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3"
                >
                  <span className="min-w-0 truncate text-sm font-bold text-sm-navy">{m.title}</span>
                  <button
                    onClick={() => download(m.file_path, m.title)}
                    className="shrink-0 rounded-lg bg-sm-orange px-4 py-2 text-xs font-extrabold text-white"
                  >
                    PDF 다운받기
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-5 text-xs leading-relaxed text-gray-400">
            개인 학습용으로만 사용하실 수 있습니다. 복제·배포 시 이용이 제한될 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border-2 border-dashed border-sm-orange bg-orange-50 p-7">
          <p className="font-extrabold tracking-tight text-sm-navy">
            대입면접 워크북이 아직 없습니다
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
            강의를 들으며 채우는 워크북입니다. 학생부 예상질문 추출 워크시트와
            인성·전공 빈출질문이 들어 있습니다. 강의만 신청하신 경우 여기서 추가하실 수 있습니다.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <b className="text-2xl font-extrabold text-sm-navy">{won(product?.price ?? 39000)}</b>
            <button
              onClick={buyBook}
              disabled={busy || !product}
              className="rounded-lg bg-sm-orange px-6 py-3 text-sm font-extrabold text-white disabled:opacity-50"
            >
              {busy ? "담는 중…" : "교재 구매하기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}