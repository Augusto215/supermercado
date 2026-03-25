"use client";

import { useCallback, useEffect, useState } from "react";
import { RhidAnalysisPanel } from "@/components/rhid-analysis-panel";
import { type RhidReportData } from "@/lib/types";

export default function PainelPage(): JSX.Element {
  const [report, setReport] = useState<RhidReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Carregando colaboradores...");
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    setLoadingMessage("Carregando colaboradores...");
    console.log("[RHiD][UI] Iniciando carregamento de /api/data");
    const controller = new AbortController();
    const slowHintTimer = setTimeout(() => {
      setLoadingMessage("Carregando departamentos...");
    }, 4_000);
    const slowerHintTimer = setTimeout(() => {
      setLoadingMessage("API lenta, tentando novamente...");
    }, 12_000);
    const abortTimer = setTimeout(() => {
      controller.abort();
    }, 45_000);

    try {
      const response = await fetch("/api/data", { cache: "no-store", signal: controller.signal });
      console.log("[RHiD][UI] Resposta recebida de /api/data", {
        ok: response.ok,
        status: response.status
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("[RHiD][UI] /api/data retornou erro", {
          status: response.status,
          bodyPreview: errorBody.slice(0, 300)
        });
        throw new Error(`Falha ao carregar dados (${response.status}).`);
      }

      const nextReport = (await response.json()) as RhidReportData;
      console.log("[RHiD][UI] Payload de /api/data", {
        sourceFile: nextReport.sourceFile,
        totalColaboradores: nextReport.processedRows.length,
        totalWarnings: nextReport.warnings.length,
        tempoMs: Date.now() - startedAt
      });
      console.log("[RHiD][UI] Preview completo do payload", nextReport);
      setLoadingMessage("Dados carregados.");
      setReport(nextReport);
    } catch (loadError) {
      const isAbort = loadError instanceof Error && loadError.name === "AbortError";
      console.error("[RHiD][UI] Erro no loading do painel", {
        tempoMs: Date.now() - startedAt,
        error: loadError
      });
      const message =
        isAbort
          ? "Tempo limite excedido ao carregar dados. Tente novamente."
          : loadError instanceof Error
            ? loadError.message
            : "Falha ao consultar a API RHiD.";
      setError(message);
    } finally {
      clearTimeout(slowHintTimer);
      clearTimeout(slowerHintTimer);
      clearTimeout(abortTimer);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (loading) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Carregando painel RHiD</h3>
          <p>{loadingMessage}</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel">
        <div className="panel-head split">
          <div>
            <h3>Falha ao carregar painel</h3>
            <p>{error}</p>
          </div>
          <button className="primary-btn" onClick={() => void loadReport()}>
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Painel sem dados</h3>
          <p>Nenhum retorno recebido da API RHiD.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <RhidAnalysisPanel report={report} onReportUpdate={setReport} />
    </div>
  );
}
