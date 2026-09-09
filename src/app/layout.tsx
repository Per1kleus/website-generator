import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NativeShell } from "@/components/NativeShell";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: { default: "Website Generator", template: "%s · Website Generator" },
  description:
    "Generate, edit and deploy a business website or digital menu from your phone.",
  manifest: "/manifest.webmanifest",
  applicationName: "Website Generator",
  appleWebApp: {
    capable: true,
    title: "Generator",
    // Lets the app paint under the status bar so safe-area insets do the work.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  formatDetection: { telephone: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover is what makes env(safe-area-inset-*) report real values.
  viewportFit: "cover",
  // Never block pinch-zoom: capping this fails WCAG 1.4.4.
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d11" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only-focusable">
          Skip to main content
        </a>
        {children}
        <NativeShell />
        <ServiceWorker />
      </body>
    </html>
  );
}
