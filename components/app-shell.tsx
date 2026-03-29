"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { usePayroll } from "@/components/payroll-provider";

const NAV_ITEMS = [
  { href: "/painel",               label: "Painel RHiD",          icon: "📊" },
  { href: "/diferenca-caixa",      label: "Diferença de Caixa",   icon: "💰" },
  { href: "/compras-funcionarios", label: "Compras Funcionários",  icon: "🛒" },
  { href: "/automacoes",           label: "Regras",                icon: "⚡" }
];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  const pathname = usePathname();
  const router   = useRouter();
  const { rows } = usePayroll();

  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "dark" | "light" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  return (
    <div className="app-shell">
      <aside className="side-panel">
        <div>
          <div className="brand-block">
            <img src="/logo.png" alt="R Cruz Supermercado" className="brand-logo" />
            <h1>R Cruz Supermercado</h1>
            <p>Folha, ponto e operações em um só lugar.</p>
          </div>

          <nav className="nav-menu" aria-label="Navegação principal">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${pathname === item.href ? " active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="side-footer">
          <div className="side-stat">
            <span>Colaboradores carregados</span>
            <strong>{rows.length}</strong>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <p className="overline">Painel Operacional</p>
            <h2>Folha — Filial 01</h2>
          </div>
          <div className="topbar-actions">
            <button className="theme-btn" onClick={toggleTheme} title="Alternar tema">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <button className="logout-btn" onClick={() => void handleLogout()}>
              Sair
            </button>
          </div>
        </header>

        <section className="content-wrap">{children}</section>
      </main>
    </div>
  );
}
