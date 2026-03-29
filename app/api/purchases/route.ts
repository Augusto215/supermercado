import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("employee_purchases")
    .select("*")
    .order("dia", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

interface CreatePurchaseBody {
  funcionarioId: string;
  funcionarioNome: string;
  produto: string;
  dia: string;
  valor: number;
}

export async function POST(request: Request) {
  let body: CreatePurchaseBody;
  try {
    body = (await request.json()) as CreatePurchaseBody;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const { funcionarioId, funcionarioNome, produto, dia, valor } = body;

  if (!funcionarioNome || !produto || !dia || typeof valor !== "number" || valor <= 0) {
    return NextResponse.json({ error: "Dados incompletos." }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("employee_purchases")
    .insert({
      funcionario_id:   funcionarioId,
      funcionario_nome: funcionarioNome,
      produto,
      dia,
      valor
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
