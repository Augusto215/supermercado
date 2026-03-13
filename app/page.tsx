import { RhidAnalysisPanel } from "@/components/rhid-analysis-panel";
import { loadRhidReportData } from "@/lib/rhid-report";

export const dynamic = "force-dynamic";

export default async function HomePage(): Promise<JSX.Element> {
  const report = await loadRhidReportData();

  return (
    <div className="page-stack">
      <RhidAnalysisPanel report={report} />
    </div>
  );
}
