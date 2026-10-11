import { useState } from "react";

/*
 * 프로필 (여러 화면이 같이 쓴다)
 * 사진이 있으면 사진, 없거나 깨지면 닉네임 첫 글자 + 단계 색
 */
export default function Avatar({ src, nick, color, size = 40, round = false }) {
  const [broken, setBroken] = useState(false);
  const r = round ? "9999px" : `${Math.round(size * 0.28)}px`;
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className="flex-none bg-gray-100 object-cover"
        style={{ width: size, height: size, borderRadius: r, boxShadow: color ? `0 0 0 2px ${color}` : undefined }}
      />
    );
  }
  return (
    <span
      className="flex flex-none items-center justify-center font-extrabold text-white"
      style={{ width: size, height: size, borderRadius: r, background: color || "#141B3D", fontSize: size * 0.4 }}
    >
      {(nick || "생").slice(0, 1)}
    </span>
  );
}