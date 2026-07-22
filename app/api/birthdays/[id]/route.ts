import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  let body: { funcionarioId?: string; funcionarioNome?: string; dataNascimento?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  if (body.dataNascimento !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.dataNascimento)) {
    return NextResponse.json({ error: "Data de nascimento inválida." }, { status: 422 });
  }

  const update: Record<string, unknown> = {};
  if (body.funcionarioId !== undefined) update.funcionario_id = body.funcionarioId;
  if (body.funcionarioNome !== undefined) update.funcionario_nome = body.funcionarioNome;
  if (body.dataNascimento !== undefined) update.data_nascimento = body.dataNascimento;

  const { data, error } = await supabase
    .from("employee_birthdays")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  const { error } = await supabase
    .from("employee_birthdays")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
