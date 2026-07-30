"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface AlertRow {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  dia: string;
  atraso_min: number;
  tem_atraso: boolean;
  batida_incompleta: boolean;
}

interface PontoAlertsSummaryCardProps {
  dataIni?: string;
  dataFinal?: string;
}

/** Resumo dos alertas de ponto (batida incompleta / atraso) do período, com atalho para a página dia a dia. */
export function PontoAlertsSummaryCard({ dataIni, dataFinal }: PontoAlertsSummaryCardProps): JSX.Element {
  const [rows, setRows] = useState<AlertRow[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (dataIni) params.set("dataIni", dataIni);
    if (dataFinal) params.set("dataFinal", dataFinal);
    fetch(`/api/ponto-alertas?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rows: AlertRow[] } | null) => setRows(data?.rows ?? []))
      .catch(() => setRows([]));
  }, [dataIni, dataFinal]);

  const { batidaIncompleta, comAtraso } = useMemo(() => {
    const list = rows ?? [];
    const batidaSet = new Set(list.filter((r) => r.batida_incompleta).map((r) => r.funcionario_id));
    const atrasoSet = new Set(list.filter((r) => r.tem_atraso).map((r) => r.funcionario_id));
    return {
      batidaIncompleta: [...batidaSet].map((id) => list.find((r) => r.funcionario_id === id)!.funcionario_nome),
      comAtraso: [...atrasoSet].map((id) => list.find((r) => r.funcionario_id === id)!.funcionario_nome),
    };
  }, [rows]);

  return (
    <article className="ranking-card">
      <h4>Alertas de ponto (batida / atraso)</h4>
      {rows === null ? (
        <p className="empty-text">Carregando...</p>
      ) : batidaIncompleta.length === 0 && comAtraso.length === 0 ? (
        <p className="empty-text">Nenhum alerta de ponto no período.</p>
      ) : (
        <ul>
          {batidaIncompleta.slice(0, 5).map((nome) => (
            <li key={`batida-${nome}`}>
              <div><strong>{nome}</strong><span>Batida incompleta</span></div>
            </li>
          ))}
          {comAtraso.slice(0, 5).map((nome) => (
            <li key={`atraso-${nome}`}>
              <div><strong>{nome}</strong><span>Atraso em algum dia</span></div>
            </li>
          ))}
        </ul>
      )}
      <Link href="/alertas-ponto" className="secondary-btn" style={{ marginTop: 12, display: "inline-block" }}>
        Ver alertas dia a dia →
      </Link>
    </article>
  );
}
