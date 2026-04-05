import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  let body: { descricao?: string; dia?: string; valor?: number; funcionarioId?: string; funcionarioNome?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.descricao !== undefined)      update.descricao        = body.descricao;
  if (body.dia !== undefined)            update.dia              = body.dia;
  if (body.valor !== undefined)          update.valor            = body.valor;
  if (body.funcionarioId !== undefined)  update.funcionario_id   = body.funcionarioId;
  if (body.funcionarioNome !== undefined) update.funcionario_nome = body.funcionarioNome;

  const { data, error } = await supabase
    .from("employee_vales")
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
    .from("employee_vales")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new Response(null, { status: 204 });
}
