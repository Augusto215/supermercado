/**
 * Hook de instrumentação do Next.js — roda uma única vez quando o servidor sobe.
 * Usado para iniciar o agendador que mantém a apuração do RHiD e os alertas de
 * ponto atualizados automaticamente (ver lib/scheduler.ts).
 */
export async function register(): Promise<void> {
  // Só no runtime Node (evita rodar no runtime Edge/middleware).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPontoScheduler } = await import("@/lib/scheduler");
    startPontoScheduler();
  }
}
