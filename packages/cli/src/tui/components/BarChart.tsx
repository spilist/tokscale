import { Box, Text } from "ink";
import type { ReactNode } from "react";

export interface ChartDataPoint {
  date: string;
  models: { modelId: string; tokens: number; color: string }[];
  total: number;
}

interface BarChartProps {
  data: ChartDataPoint[];
  width: number;
  height: number;
}

const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function getDominantColor(models: { modelId: string; tokens: number; color: string }[]): string {
  if (models.length === 0) return "white";
  return models.reduce((max, m) => (m.tokens > max.tokens ? m : max), models[0]).color;
}

export function BarChart({ data, width, height }: BarChartProps) {
  if (data.length === 0) return <Text dimColor>No chart data</Text>;

  const safeHeight = Math.max(height, 1);
  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const chartWidth = Math.max(width - 8, 20);
  const barWidth = Math.max(1, Math.floor(chartWidth / Math.min(data.length, 52)));
  const visibleBars = Math.min(data.length, Math.floor(chartWidth / barWidth));
  const visibleData = data.slice(-visibleBars);

  const rows: ReactNode[] = [];
  
  for (let row = safeHeight - 1; row >= 0; row--) {
    const rowThreshold = ((row + 1) / safeHeight) * maxTotal;
    const prevThreshold = (row / safeHeight) * maxTotal;
    const thresholdDiff = rowThreshold - prevThreshold;

    const barElements = visibleData.map((point, i) => {
      if (point.total <= prevThreshold) {
        return (
          <Text key={i} dimColor>
            {" ".repeat(barWidth)}
          </Text>
        );
      }

      const color = getDominantColor(point.models);

      if (point.total >= rowThreshold) {
        return (
          <Text key={i} color={color}>
            {"█".repeat(barWidth)}
          </Text>
        );
      }

      const ratio = thresholdDiff > 0 ? (point.total - prevThreshold) / thresholdDiff : 1;
      const blockIndex = Math.min(8, Math.max(1, Math.floor(ratio * 8)));
      return (
        <Text key={i} color={color}>
          {BLOCKS[blockIndex].repeat(barWidth)}
        </Text>
      );
    });

    const yLabel = row === safeHeight - 1 ? formatNumber(maxTotal).padStart(6) : "      ";
    rows.push(
      <Box key={row}>
        <Text dimColor>{yLabel}│</Text>
        {barElements}
      </Box>
    );
  }

  const dateLabels: string[] = [];
  if (visibleData.length > 0) {
    const labelInterval = Math.max(1, Math.floor(visibleData.length / 3));
    for (let i = 0; i < visibleData.length; i += labelInterval) {
      const dateStr = visibleData[i].date;
      const d = new Date(dateStr);
      const label = isNaN(d.getTime()) 
        ? dateStr.slice(5) 
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      dateLabels.push(label);
    }
  }

  const axisWidth = Math.min(chartWidth, visibleBars * barWidth);
  const labelPadding = dateLabels.length > 0 ? Math.floor(axisWidth / dateLabels.length) : 0;

  return (
    <Box flexDirection="column">
      <Text bold>Tokens per Day</Text>
      {rows}
      <Box>
        <Text dimColor>{"     0│"}</Text>
        <Text dimColor>{"─".repeat(axisWidth)}</Text>
      </Box>
      {dateLabels.length > 0 && (
        <Box>
          <Text dimColor>{"       "}</Text>
          <Text dimColor>
            {dateLabels.map((l) => l.padEnd(labelPadding)).join("")}
          </Text>
        </Box>
      )}
    </Box>
  );
}
