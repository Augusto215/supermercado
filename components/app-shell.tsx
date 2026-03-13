"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { usePayroll } from "@/components/payroll-provider";

const NAV_ITEMS = [
  { href: "/", label: "Painel" },
  { href: "/colaboradores", label: "Colaboradores" },
  { href: "/campos", label: "Campos" },
  { href: "/automacoes", label: "Automacoes" }
];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  const pathname = usePathname();
  const { rows, runAutomations } = usePayroll();
  const competenciaAtual = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric"
  }).format(new Date());

  return (
    <div className="app-shell">
      <aside className="side-panel">
        <div className="brand-block">
          <span className="brand-chip">PAINEL INTELIGENTE</span>
          <h1>Central de Automacoes</h1>
          <p>Controle de folha, ponto RHiD e ajustes operacionais em um fluxo unico.</p>
        </div>

        <nav className="nav-menu" aria-label="Navegacao principal">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link key={item.href} href={item.href} className={`nav-item${isActive ? " active" : ""}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="side-highlight">
          <span>Equipe carregada</span>
          <strong>{rows.length} colaboradores</strong>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="overline">Painel Operacional</p>
            <h2>Folha Filial 01</h2>
          </div>
          <div className="topbar-actions">
            <label className="month-picker">
              <span>Competencia</span>
              <select defaultValue={competenciaAtual}>
                <option value={competenciaAtual}>{competenciaAtual}</option>
                <option value="fevereiro de 2026">fevereiro de 2026</option>
                <option value="janeiro de 2026">janeiro de 2026</option>
              </select>
            </label>

            <button className="primary-btn" onClick={runAutomations}>
              Rodar automacoes
            </button>
          </div>
        </header>

        <section className="content-wrap">{children}</section>
      </main>
    </div>
  );
}
