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

  const [theme, setTheme]       = useState<"dark" | "light">("dark");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") as "dark" | "light" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    }
  }, []);

  // Close drawer on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

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

  const navContent = (
    <>
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

      <div className="side-footer">
        <div className="side-stat">
          <span>Colaboradores carregados</span>
          <strong>{rows.length}</strong>
        </div>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {/* Sidebar desktop */}
      <aside className="side-panel">
        {navContent}
      </aside>

      {/* Drawer mobile */}
      {menuOpen && (
        <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />
      )}
      <aside className={`mobile-drawer${menuOpen ? " open" : ""}`}>
        <button className="drawer-close" onClick={() => setMenuOpen(false)}>✕</button>
        {navContent}
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left-group">
            <button className="hamburger-btn" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
              <span /><span /><span />
            </button>
            <div className="topbar-left">
              <p className="overline">Painel Operacional</p>
              <h2>Folha — Filial 01</h2>
            </div>
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
