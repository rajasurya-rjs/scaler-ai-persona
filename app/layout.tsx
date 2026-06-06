import type { Metadata, Viewport } from "next";
import "./globals.css";

const name = process.env.NEXT_PUBLIC_PERSONA_NAME ?? "AI Persona";

export const metadata: Metadata = {
  title: `${name} — AI Persona`,
  description: `Ask anything about ${name}'s background, projects, and availability. RAG-grounded on a real resume + GitHub.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05060a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
