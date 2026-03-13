import type { Metadata } from "next";
import { type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { PayrollProvider } from "@/components/payroll-provider";
import { loadPayrollRows } from "@/lib/parse-sheet";

import "./globals.css";

export const metadata: Metadata = {
  title: "R Cruz Supermercado | Painel de Automacoes",
  description: "Painel moderno de folha com edicao manual por campo e automacoes operacionais."
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps): Promise<JSX.Element> {
  const initialRows = await loadPayrollRows();

  return (
    <html lang="pt-BR">
      <body>
        <PayrollProvider initialRows={initialRows}>
          <AppShell>{children}</AppShell>
        </PayrollProvider>
      </body>
    </html>
  );
}
