import type { Metadata, Viewport } from "next";
import { Lora, Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DocuSearch",
  description: "Upload documents and ask questions with cited answers",
  icons: {
    icon: "/apple-icon.png", 
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#efe7db",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lora.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Definite height (not min-height) is what lets the descendant message
          list resolve `flex-1 + min-h-0 + overflow-y-auto` into a real scroll
          box. `dvh` so mobile browser chrome doesn't cut off the input bar. */}
      <body className="flex h-dvh flex-col overflow-hidden">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
