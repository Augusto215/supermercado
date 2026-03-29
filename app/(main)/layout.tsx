import { type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { PayrollProvider } from "@/components/payroll-provider";
import { loadPayrollRows } from "@/lib/parse-sheet";

export const dynamic = "force-dynamic";

interface MainLayoutProps {
  children: ReactNode;
}

export default async function MainLayout({ children }: MainLayoutProps): Promise<JSX.Element> {
  const initialRows = await loadPayrollRows();

  return (
    <PayrollProvider initialRows={initialRows}>
      <AppShell>{children}</AppShell>
    </PayrollProvider>
  );
}
