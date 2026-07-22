import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("employee_birthdays")
    .select("*")
    .order("funcionario_nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

interface CreateBirthdayBody {
  funcionarioId: string;
  funcionarioNome: string;
  dataNascimento: string;
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request) {
  let body: CreateBirthdayBody;
  try {
    body = (await request.json()) as CreateBirthdayBody;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const { funcionarioId, funcionarioNome, dataNascimento } = body;

  if (!funcionarioId || !funcionarioNome || !isValidIsoDate(dataNascimento)) {
    return NextResponse.json({ error: "Dados incompletos ou data inválida." }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("employee_birthdays")
    .upsert(
      {
        funcionario_id: funcionarioId,
        funcionario_nome: funcionarioNome,
        data_nascimento: dataNascimento,
      },
      { onConflict: "funcionario_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
