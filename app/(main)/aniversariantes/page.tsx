import { EmployeeBirthdaysPanel } from "@/components/employee-birthdays-panel";
import { supabase, type DbEmployeeBirthday } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AniversariantesPage(): Promise<JSX.Element> {
  // Renderiza já com os aniversários vindos do banco — a página abre preenchida,
  // sem o piscar de "nenhum aniversário" enquanto o navegador busca os dados.
  const { data } = await supabase
    .from("employee_birthdays")
    .select("*")
    .order("funcionario_nome", { ascending: true });

  return <EmployeeBirthdaysPanel initialBirthdays={(data as DbEmployeeBirthday[]) ?? []} />;
}
