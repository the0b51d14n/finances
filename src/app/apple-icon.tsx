import { ImageResponse } from "next/og";

/** Icône d'écran d'accueil iPhone (iOS applique lui-même l'arrondi). */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ff7a1a",
          color: "#1a0d02",
          fontSize: 100,
          fontWeight: 800,
        }}
      >
        €
      </div>
    ),
    size,
  );
}
