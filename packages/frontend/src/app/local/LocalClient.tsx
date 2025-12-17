"use client";

import { useState } from "react";
import type { TokenContributionData } from "@/lib/types";
import { DataInput } from "@/components/DataInput";
import { GraphContainer } from "@/components/GraphContainer";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";

export default function LocalClient() {
  const [data, setData] = useState<TokenContributionData | null>(null);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--color-bg-default)" }}>
      <Navigation />

      <main className="flex-1 max-w-7xl mx-auto px-6 py-10 w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--color-fg-default)" }}>
            Local Viewer
          </h1>
          <p style={{ color: "var(--color-fg-muted)" }}>
            View your token usage data locally without submitting
          </p>
        </div>

        {!data ? (
          <DataInput onDataLoaded={setData} />
        ) : (
          <div className="space-y-8">
            <div
              className="rounded-2xl border p-5"
              style={{ backgroundColor: "var(--color-bg-default)", borderColor: "var(--color-border-default)" }}
            >
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span style={{ color: "var(--color-fg-muted)" }}>Data loaded:</span>
                <span className="font-semibold" style={{ color: "var(--color-fg-default)" }}>
                  {data.meta.dateRange.start} - {data.meta.dateRange.end}
                </span>
                <span style={{ color: "var(--color-border-default)" }}>|</span>
                <span className="font-semibold" style={{ color: "var(--color-primary)" }}>
                  ${data.summary.totalCost.toFixed(2)} total
                </span>
                <span style={{ color: "var(--color-border-default)" }}>|</span>
                <span style={{ color: "var(--color-fg-muted)" }}>
                  {data.summary.activeDays} active days
                </span>
                <button
                  onClick={() => setData(null)}
                  className="ml-auto px-4 py-2 text-sm font-medium rounded-lg transition-opacity hover:opacity-80"
                  style={{ color: "var(--color-fg-muted)" }}
                >
                  Load Different Data
                </button>
              </div>
            </div>
            <GraphContainer data={data} />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
