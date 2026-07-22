/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Habilita instrumentation.ts, usado para iniciar o agendador de
    // atualização automática do RHiD (ver lib/scheduler.ts).
    instrumentationHook: true
  }
};

export default nextConfig;
