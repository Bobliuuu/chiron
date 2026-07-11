import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chiron — Community Event Assistant",
  description:
    "Chat to find and publish local nonprofit events. Fewer, better recommendations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AuthGate>{children}</AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
