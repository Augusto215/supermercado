import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface ImportRow {
  funcionarioId: string;
  funcionarioNome: string;
  dataNascimento: string;
}

interface ImportBody {
  rows: ImportRow[];
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha para importar." }, { status: 422 });
  }

  const validRows = body.rows.filter(
    (row) => row.funcionarioId && row.funcionarioNome && isValidIsoDate(row.dataNascimento)
  );

  if (validRows.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha valida (funcionario + data) encontrada." }, { status: 422 });
  }

  const dbRows = validRows.map((row) => ({
    funcionario_id: row.funcionarioId,
    funcionario_nome: row.funcionarioNome,
    data_nascimento: row.dataNascimento,
  }));

  const { data, error } = await supabase
    .from("employee_birthdays")
    .upsert(dbRows, { onConflict: "funcionario_id" })
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: data?.length ?? 0, rows: data });
}
