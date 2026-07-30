import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { refreshDailyPontoAlerts, resolveAlertPeriod } from "@/lib/ponto-alerts";

export const dynamic = "force-dynamic";

function toDateString(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dataIni = toDateString(url.searchParams.get("dataIni"));
  const dataFinal = toDateString(url.searchParams.get("dataFinal"));
  const tipo = url.searchParams.get("tipo"); // "atraso" | "batida" | null (todos)
  const period = resolveAlertPeriod(dataIni, dataFinal);

  let query = supabase
    .from("ponto_alertas_diarios")
    .select("*")
    .gte("dia", period.dataIni)
    .lte("dia", period.dataFinal)
    .order("dia", { ascending: false })
    .order("funcionario_nome", { ascending: true });

  if (tipo === "atraso") {
    query = query.eq("tem_atraso", true);
  } else if (tipo === "batida") {
    query = query.eq("batida_incompleta", true);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ period, rows: data });
}

export async function POST(request: Request) {
  let body: { dataIni?: string; dataFinal?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // corpo opcional
  }

  try {
    const result = await refreshDailyPontoAlerts({
      dataIni: body.dataIni,
      dataFinal: body.dataFinal,
    });

    return NextResponse.json({
      period: result.period,
      colaboradoresProcessados: result.colaboradoresProcessados,
      alertasEncontrados: result.alerts.length,
      persistidos: result.persistidos,
      removidos: result.removidos,
      warnings: result.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
