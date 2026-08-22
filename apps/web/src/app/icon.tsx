import { ImageResponse } from "next/og";

// Dynamic favicon: a lowercase "c" wordmark on the app's near-black surface,
// in the brand blue accent. Matches the sidebar "citshe" wordmark.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16161a",
          borderRadius: 7,
          color: "#3b82f6",
          fontSize: 26,
          fontWeight: 700,
          fontFamily:
            "'Space Grotesk', system-ui, -apple-system, sans-serif",
          letterSpacing: "-0.04em",
          // Nudge the glyph so it sits optically centered.
          lineHeight: 1,
          paddingBottom: 2,
        }}
      >
        c
      </div>
    ),
    { ...size },
  );
}
