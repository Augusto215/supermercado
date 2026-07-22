"use client";

import { useEffect, useState } from "react";

interface DbRow {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  data_nascimento: string;
}

interface BirthdayToday {
  id: string;
  funcionarioNome: string;
  dataNascimento: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthDay(isoDate: string): string {
  return isoDate.slice(5, 10);
}

function formatBirthDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

/** Card compacto com os aniversariantes do dia — pensado para o topo do Painel RHiD. */
export function BirthdaysTodayWidget(): JSX.Element | null {
  const [birthdaysToday, setBirthdaysToday] = useState<BirthdayToday[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/birthdays")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DbRow[]) => {
        if (!Array.isArray(data)) return;
        const hoje = todayIso();
        setBirthdaysToday(
          data
            .filter((row) => monthDay(row.data_nascimento) === monthDay(hoje))
            .map((row) => ({ id: row.id, funcionarioNome: row.funcionario_nome, dataNascimento: row.data_nascimento }))
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || birthdaysToday.length === 0) return null;

  return (
    <section className="panel birthdays-today-banner">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>🎉 Aniversariantes de hoje</h3>
        <div className="birthdays-today-list">
          {birthdaysToday.map((b) => (
            <span key={b.id} className="birthday-chip">
              🎂 {b.funcionarioNome} <small>({formatBirthDate(b.dataNascimento)})</small>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
