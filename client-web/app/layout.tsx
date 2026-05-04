import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/Providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Hr-Profi — Xodim portali",
  description: "Kelish-ketishni qayd etish va shaxsiy hisobotlar.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Hr-Profi",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Tiny inline boot script that applies the persisted theme *before* React
// hydrates — avoids the FOUC of a white screen flashing for dark-mode users.
const themeBootScript = `
(function(){
  try {
    var v = localStorage.getItem('wtp.client.theme') || 'system';
    var dark = v === 'dark' || (v === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
