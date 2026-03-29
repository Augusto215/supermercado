import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  // Return the most recent import batch (grouped by importado_em, last one wins)
  const { data: latest, error: latestError } = await supabase
    .from("cash_differences")
    .select("importado_em")
    .order("importado_em", { ascending: false })
    .limit(1)
    .single();

  if (latestError || !latest) {
    // No data yet — return empty array
    return NextResponse.json([]);
  }

  const { data, error } = await supabase
    .from("cash_differences")
    .select("*")
    .eq("importado_em", latest.importado_em)
    .order("diferenca", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

interface CashDiffRow {
  operador: string;
  dia: string;
  valorEsperado: number | null;
  valorContado: number | null;
  diferenca: number;
}

interface SaveCashDiffsBody {
  rows: CashDiffRow[];
  arquivo: string;
}

export async function POST(request: Request) {
  let body: SaveCashDiffsBody;
  try {
    body = (await request.json()) as SaveCashDiffsBody;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha para salvar." }, { status: 422 });
  }

  // All rows in this batch share the same importado_em timestamp so we can group them later
  const now = new Date().toISOString();

  const toInsert = body.rows.map((row) => ({
    operador:       row.operador,
    dia:            row.dia,
    valor_esperado: row.valorEsperado ?? null,
    valor_contado:  row.valorContado ?? null,
    diferenca:      row.diferenca,
    arquivo:        body.arquivo ?? null,
    importado_em:   now,
  }));

  const { error } = await supabase
    .from("cash_differences")
    .insert(toInsert);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: toInsert.length }, { status: 201 });
}
