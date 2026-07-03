"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: "16px", fontFamily: "sans-serif" }}>
          <h2>Đã xảy ra lỗi</h2>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}>
            Thử lại
          </button>
        </div>
      </body>
    </html>
  );
}
