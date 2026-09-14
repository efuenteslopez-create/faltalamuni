import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { AuthProvider } from "@/lib/flm/auth";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { BottomNav } from "@/components/layout/BottomNav";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "Falta la Muni — El mapa ciudadano de tu comuna",
    template: "%s · Falta la Muni",
  },
  description:
    "Problemas a la vista. Soluciones también. Reporta problemas urbanos de tu comuna, hazles seguimiento y verifica las soluciones.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Falta la Muni",
  },
  icons: {
    icon: "/icons/icon-192.svg",
    apple: "/icons/icon-192.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#FAF7F1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ServiceWorkerRegister />
        <AuthProvider>
          <SiteHeader />
          <div className="min-h-[70vh] pb-24 md:pb-10">{children}</div>
          <footer className="hidden border-t border-flm-line md:block">
            <div className="flm-container flex items-center justify-between py-6 text-sm text-flm-muted">
              <p className="font-bold text-flm-ink">
                Falta <span className="text-flm-accent">la Muni</span>
              </p>
              <p>Hecho con vecinos, para vecinos.</p>
            </div>
          </footer>
          <BottomNav />
        </AuthProvider>
      </body>
    </html>
  );
}
