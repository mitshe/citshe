import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-brand",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "citshe",
  description: "Workspace manager for AI coding agents",
};

// viewport-fit=cover lets us pad around the notch / home indicator with the
// env(safe-area-inset-*) values (see the .pt-safe/.pb-safe utilities).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16161a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} antialiased`}
          suppressHydrationWarning
        >
          <Providers>{children}</Providers>
          <Toaster />
        </body>
      </html>
    </AuthProvider>
  );
}
