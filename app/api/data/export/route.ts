import { loadRhidReportData } from "@/lib/rhid-report";

function isTruthyParam(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function escapeCsvValue(value: string | number): string {
  const text = String(value ?? "");
  const escaped = text.replace(/"/g, "\"\"");
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const forceRefresh = isTruthyParam(url.searchParams.get("refresh")) || isTruthyParam(url.searchParams.get("force"));
  const report = await loadRhidReportData({ forceRefresh });
  const headers = [
    "id",
    "nome",
    "faltas",
    "atrasoTotalMin",
    "horasExtrasTotaisMin",
    "bancoHorasMin",
    "statusFaltas",
    "alertaAtraso",
    "motivoDesconto",
    "valorDesconto",
    "valorValeRefeicao"
  ];
  const rows = report.processedRows.map((row) =>
    [
      row.id,
      row.nome,
      row.faltas,
      row.atrasoTotalMin,
      row.horasExtrasTotaisMin,
      row.bancoHorasMin,
      row.statusFaltas,
      row.alertaAtraso,
      row.motivoDesconto,
      row.valorDesconto,
      row.valorValeRefeicao
    ]
      .map(escapeCsvValue)
      .join(",")
  );
  const csv = `\uFEFF${headers.join(",")}\n${rows.join("\n")}`;
  const dateStamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="rhid_relatorio_${dateStamp}.csv"`
    }
  });
}
