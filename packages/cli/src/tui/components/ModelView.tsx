import { For, createMemo } from "solid-js";
import type { TUIData, SortType } from "../hooks/useData.js";
import { getModelColor } from "../utils/colors.js";
import { formatTokensCompact, formatCostFull } from "../utils/format.js";

const INPUT_COL_WIDTH = 12;
const OUTPUT_COL_WIDTH = 12;
const CACHE_COL_WIDTH = 12;
const TOTAL_COL_WIDTH = 14;
const COST_COL_WIDTH = 12;
const METRIC_COLUMNS_WIDTH = INPUT_COL_WIDTH + OUTPUT_COL_WIDTH + CACHE_COL_WIDTH + TOTAL_COL_WIDTH + COST_COL_WIDTH;
const SIDE_PADDING = 2;
const MIN_NAME_COLUMN = 24;


interface ModelViewProps {
  data: TUIData;
  sortBy: SortType;
  sortDesc: boolean;
  selectedIndex: number;
  height: number;
  width: number;
}

export function ModelView(props: ModelViewProps) {
  const sortedEntries = createMemo(() => {
    const entries = props.data.modelEntries;
    const sortBy = props.sortBy;
    const sortDesc = props.sortDesc;
    
    return [...entries].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "cost") cmp = a.cost - b.cost;
      else if (sortBy === "tokens") cmp = a.total - b.total;
      else cmp = a.model.localeCompare(b.model);
      return sortDesc ? -cmp : cmp;
    });
  });

  const nameColumnWidths = createMemo(() => {
    const available = Math.max(props.width - SIDE_PADDING - METRIC_COLUMNS_WIDTH, MIN_NAME_COLUMN);
    const nameColumn = Math.max(MIN_NAME_COLUMN, available);

    return {
      column: nameColumn,
      text: Math.max(nameColumn - 1, 1),
    };
  });

  const visibleEntries = createMemo(() => sortedEntries().slice(0, props.height - 3));

  return (
    <box flexDirection="column">
      <box flexDirection="row">
        <text fg="cyan" bold>
          {" Source/Model".padEnd(nameColumnWidths().column)}
          {"Input".padStart(INPUT_COL_WIDTH)}
          {"Output".padStart(OUTPUT_COL_WIDTH)}
          {"Cache".padStart(CACHE_COL_WIDTH)}
          {"Total".padStart(TOTAL_COL_WIDTH)}
          {"Cost".padStart(COST_COL_WIDTH)}
        </text>
      </box>
      <box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom borderColor="gray" />

      <For each={visibleEntries()}>
        {(entry, i) => {
          const isSelected = () => i() === props.selectedIndex;
          const sourceLabel = entry.source.charAt(0).toUpperCase() + entry.source.slice(1);
          const fullName = `${sourceLabel} ${entry.model}`;
          const widths = nameColumnWidths();
          const nameWidth = widths.text;
          let displayName = fullName;

          if (fullName.length > nameWidth) {
            displayName = nameWidth > 1 ? `${fullName.slice(0, nameWidth - 1)}…` : fullName.slice(0, 1);
          }

          return (
            <box flexDirection="row">
              <text fg={getModelColor(entry.model)} backgroundColor={isSelected() ? "blue" : undefined}>●</text>
              <text
                backgroundColor={isSelected() ? "blue" : undefined}
                fg={isSelected() ? "white" : undefined}
              >
                {displayName.padEnd(nameWidth)}
                {formatTokensCompact(entry.input).padStart(INPUT_COL_WIDTH)}
                {formatTokensCompact(entry.output).padStart(OUTPUT_COL_WIDTH)}
                {formatTokensCompact(entry.cacheRead).padStart(CACHE_COL_WIDTH)}
                {formatTokensCompact(entry.total).padStart(TOTAL_COL_WIDTH)}
              </text>
              <text
                fg="green"
                backgroundColor={isSelected() ? "blue" : undefined}
              >
                {formatCostFull(entry.cost).padStart(COST_COL_WIDTH)}
              </text>
            </box>
          );
        }}
      </For>
    </box>
  );
}
