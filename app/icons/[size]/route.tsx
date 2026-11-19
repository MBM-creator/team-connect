import { ImageResponse } from "next/og";

export const runtime = "edge";

// Generate Android install icons on demand, without storing binary assets in Git.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: rawSize } = await params;
  if (rawSize !== "192" && rawSize !== "512") {
    return new Response("Unsupported icon size", { status: 404 });
  }
  const size = Number(rawSize);
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#003923",
          borderRadius: Math.round(size * 0.20),
        }}
      >
        <div
          style={{
            display: "flex",
            width: "76%",
            height: "76%",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            color: "#000000",
            fontFamily: "Arial, sans-serif",
            fontWeight: 900,
            fontSize: Math.round(size * 0.36),
            letterSpacing: -Math.round(size * 0.017),
          }}
        >
          TC
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=3600" },
    },
  );
}
