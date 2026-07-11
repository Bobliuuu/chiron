import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chiron — Community Event Assistant",
  description:
    "Chat to find and publish local nonprofit events. Fewer, better recommendations.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
