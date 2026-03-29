import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { type ReactNode } from "react";

import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"]
});

export const metadata: Metadata = {
  title: "R Cruz Supermercado | Painel de Automações",
  description: "Painel de folha, ponto RHiD e automações operacionais.",
  icons: { icon: "/logo.png", apple: "/logo.png" }
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): JSX.Element {
  return (
    <html lang="pt-BR" className={montserrat.variable}>
      <body>{children}</body>
    </html>
  );
}
