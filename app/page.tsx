"use client";

import { useEffect, useState } from "react";
import { RhidAnalysisPanel } from "@/components/rhid-analysis-panel";
import { type RhidReportData } from "@/lib/types";

export default function HomePage(): JSX.Element {
  const [report, setReport] = useState<RhidReportData | null>(null);

  useEffect(() => {
    fetch("/api/data")
      .then((res) => res.json())
      .then(setReport);
  }, []);

  if (!report) {
    return <div>Loading...</div>;
  }

  return (
    <div className="page-stack">
      <RhidAnalysisPanel report={report} onReportUpdate={setReport} />
    </div>
  );
}
