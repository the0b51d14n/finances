import { ImageResponse } from "next/og";

/** Icônes de l'application (onglet, PWA Android/ordinateur), générées au build. */
export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const size = Number(await id);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1012",
        }}
      >
        <div
          style={{
            width: "78%",
            height: "78%",
            borderRadius: "22%",
            background: "#ff7a1a",
            color: "#1a0d02",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.5,
            fontWeight: 800,
          }}
        >
          €
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
