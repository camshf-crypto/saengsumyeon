import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [cartCount, setCartCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // 프로필 + 장바구니 개수를 한 번에 갱신
  async function refresh(uid) {
    if (!uid) {
      setProfile(null);
      setCartCount(0);
      return;
    }
    const [p, c] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("cart_items").select("id", { count: "exact", head: true }).eq("user_id", uid),
    ]);
    if (p.error) console.error("profile load", p.error);
    setProfile(p.data ?? null);
    setCartCount(c.count ?? 0);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      refresh(u?.id).finally(() => setLoading(false));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      refresh(u?.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = {
    user,
    profile,
    loading,
    cartCount,
    isMaster: profile?.role === "master",
    refreshProfile: () => refresh(user?.id),
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
      setCartCount(0);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
