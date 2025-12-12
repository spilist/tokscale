# TUI Redesign Plan - Token Usage Tracker

## Overview
Redesign the CLI TUI to match the reference design (KakaoTalk_Photo_2025-12-12-19-15-39.png) with:
- Stacked bar chart for "Tokens per Day"
- Model-based color scheme
- New list-style model view with percentages
- Mouse click support for tab navigation
- Improved footer with scroll indicators

## Reference Design Analysis
From the screenshot:
- **Tabs**: "Overview" and "Models" (with inverted colors for active tab)
- **Chart**: Stacked bar chart showing tokens per day (Y: 0-1.6B, X: dates Sep 28 - Dec 12)
- **Legend**: Horizontal row with colored dots for top 5 models used in chart
- **Model List**: "All models" section with each model showing:
  - Colored dot + model name + percentage in parentheses
  - Second line indented: `In: XXM · Out: XXM`
- **Footer**: `↓ 1-18 of 27 models (↑↓ to scroll) | View: Stats | [● OpenCode] [● Claude] [● Codex] | Sort: Cost ↓ | (39 models) | Total: $20095.13`

## Color Scheme (Model/Provider Based)
| Provider | Color | Hex | Models |
|----------|-------|-----|--------|
| Anthropic | Orange | #FF6B35 | claude-*, sonnet-*, opus-*, haiku-* |
| OpenAI | Green | #10B981 | gpt-*, o1-*, o3-*, codex-* |
| Google/Vertex | Blue | #3B82F6 | gemini-* |
| Cursor | Purple | #8B5CF6 | auto, cursor-specific |
| OpenCode | Gray | #6B7280 | opencode-specific |
| DeepSeek | Cyan | #06B6D4 | deepseek-* |
| xAI | Yellow | #EAB308 | grok-* |
| Meta | Indigo | #6366F1 | llama-*, mixtral-* |
| Unknown | White | #FFFFFF | fallback |

## Technical Context
- Framework: `ink` (React for CLI)
- ink version: 5.x (supports useStdin for raw input handling)
- Mouse support: via `useStdin` with ANSI escape sequences, NOT a built-in `useMouse` hook
- Current TUI has: Model/Daily/Stats tabs, table-style model view, GitHub heatmap
- Terminal compatibility: Requires true color support (most modern terminals)

---

## Tasks

### Phase 1: Core Infrastructure

- [ ] 1.1 Create color utility module
  - **File**: `packages/cli/src/tui/utils/colors.ts`
  - **Implementation**:
    ```typescript
    export const PROVIDER_COLORS = {
      anthropic: "#FF6B35",  // Orange
      openai: "#10B981",     // Green
      google: "#3B82F6",     // Blue
      cursor: "#8B5CF6",     // Purple
      opencode: "#6B7280",   // Gray
      deepseek: "#06B6D4",   // Cyan
      xai: "#EAB308",        // Yellow
      meta: "#6366F1",       // Indigo
      unknown: "#FFFFFF",    // White
    } as const;
    
    export type ProviderType = keyof typeof PROVIDER_COLORS;
    
    export function getProviderFromModel(modelId: string): ProviderType {
      const lower = modelId.toLowerCase();
      if (/claude|sonnet|opus|haiku/.test(lower)) return "anthropic";
      if (/gpt|o1-|o3-|codex/.test(lower)) return "openai";
      if (/gemini/.test(lower)) return "google";
      if (/deepseek/.test(lower)) return "deepseek";
      if (/grok/.test(lower)) return "xai";
      if (/llama|mixtral/.test(lower)) return "meta";
      if (lower === "auto") return "cursor";
      return "unknown";
    }
    
    export function getModelColor(modelId: string): string {
      return PROVIDER_COLORS[getProviderFromModel(modelId)];
    }
    ```
  - **Verification**: `npx tsc --noEmit packages/cli/src/tui/utils/colors.ts` passes

- [ ] 1.2 Update useData hook for chart data
  - **File**: `packages/cli/src/tui/hooks/useData.ts`
  - **New Types**:
    ```typescript
    export interface ChartDataPoint {
      date: string;
      models: { modelId: string; tokens: number; color: string }[];
      total: number;
    }
    
    export interface TUIData {
      // ... existing fields ...
      chartData: ChartDataPoint[];
      modelPercentages: Map<string, number>;
      topModels: string[]; // top 5 models by cost for legend
    }
    ```
  - **Computation Logic** (add after existing data processing):
    ```typescript
    // Group by date and model for chart
    const dateModelMap = new Map<string, Map<string, number>>();
    for (const contrib of graph.contributions) {
      const dateStr = contrib.date;
      if (!dateModelMap.has(dateStr)) {
        dateModelMap.set(dateStr, new Map());
      }
      for (const source of contrib.sources) {
        const modelMap = dateModelMap.get(dateStr)!;
        const current = modelMap.get(source.modelId) || 0;
        modelMap.set(source.modelId, current + source.tokens.input + source.tokens.output);
      }
    }
    
    const chartData: ChartDataPoint[] = Array.from(dateModelMap.entries())
      .map(([date, modelMap]) => ({
        date,
        models: Array.from(modelMap.entries()).map(([modelId, tokens]) => ({
          modelId,
          tokens,
          color: getModelColor(modelId),
        })),
        total: Array.from(modelMap.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate percentages
    const totalCost = report.totalCost;
    const modelPercentages = new Map<string, number>();
    for (const entry of modelEntries) {
      modelPercentages.set(entry.model, (entry.cost / totalCost) * 100);
    }
    
    // Top 5 models by cost
    const topModels = [...modelEntries]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)
      .map(e => e.model);
    ```
  - **Verification**: `yarn cli tui` loads without errors, `chartData` has entries

### Phase 2: Chart Components

- [ ] 2.1 Create BarChart component
  - **File**: `packages/cli/src/tui/components/BarChart.tsx`
  - **Props**: 
    ```typescript
    interface BarChartProps {
      data: ChartDataPoint[];
      width: number;
      height: number; // number of rows for the chart (typically 8-10)
    }
    ```
  - **Full Implementation**:
    ```typescript
    import { Box, Text } from "ink";
    import type { ChartDataPoint } from "../hooks/useData.js";
    
    const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    
    function formatNumber(n: number): string {
      if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
      return n.toString();
    }
    
    export function BarChart({ data, width, height }: BarChartProps) {
      if (data.length === 0) return <Text dimColor>No data</Text>;
      
      const maxTotal = Math.max(...data.map(d => d.total));
      const barWidth = Math.max(1, Math.floor((width - 6) / data.length)); // -6 for Y axis
      
      // Render rows from top to bottom
      const rows: JSX.Element[] = [];
      for (let row = height - 1; row >= 0; row--) {
        const threshold = (row / height) * maxTotal;
        const rowContent = data.map((point, i) => {
          // Find which model's segment is at this height
          let cumulative = 0;
          for (const model of point.models) {
            cumulative += model.tokens;
            if (cumulative >= threshold && cumulative - model.tokens < threshold) {
              const blockIndex = Math.min(8, Math.floor(((cumulative - threshold) / (maxTotal / height)) * 8));
              return <Text key={i} color={model.color}>{BLOCKS[blockIndex].repeat(barWidth)}</Text>;
            }
            if (cumulative > threshold) {
              return <Text key={i} color={model.color}>{"█".repeat(barWidth)}</Text>;
            }
          }
          return <Text key={i}>{" ".repeat(barWidth)}</Text>;
        });
        
        rows.push(
          <Box key={row}>
            <Text dimColor>{row === height - 1 ? formatNumber(maxTotal).padStart(5) : "     "}│</Text>
            {rowContent}
          </Box>
        );
      }
      
      // X axis
      const xLabels = data.filter((_, i) => i % Math.ceil(data.length / 3) === 0)
        .map(d => new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      
      return (
        <Box flexDirection="column">
          <Text bold>Tokens per Day</Text>
          {rows}
          <Box>
            <Text dimColor>{"    0│"}</Text>
            <Text dimColor>{"─".repeat(width - 6)}</Text>
          </Box>
          <Box>
            <Text dimColor>{"      "}{xLabels.join("     ".padEnd(Math.floor((width - 6) / xLabels.length)))}</Text>
          </Box>
        </Box>
      );
    }
    ```
  - **Verification**: Renders chart with colored bars, Y-axis shows max value

- [ ] 2.2 Create Legend component
  - **File**: `packages/cli/src/tui/components/Legend.tsx`
  - **Implementation**:
    ```typescript
    import { Box, Text } from "ink";
    import { getModelColor } from "../utils/colors.js";
    
    interface LegendProps {
      models: string[]; // top N model IDs
    }
    
    export function Legend({ models }: LegendProps) {
      return (
        <Box gap={2}>
          {models.map((modelId, i) => (
            <Box key={modelId} gap={0}>
              <Text color={getModelColor(modelId)}>●</Text>
              <Text> {modelId}</Text>
              {i < models.length - 1 && <Text dimColor>  ·</Text>}
            </Box>
          ))}
        </Box>
      );
    }
    ```
  - **Verification**: Shows 5 colored dots with model names

### Phase 3: View Redesign

- [ ] 3.1 Redesign Header with clickable tabs
  - **File**: `packages/cli/src/tui/components/Header.tsx`
  - **Before**:
    ```typescript
    export type TabType = "model" | "daily" | "stats";
    // ... Tab components for Model, Daily, Stats
    ```
  - **After**:
    ```typescript
    import { Box, Text } from "ink";
    
    export type TabType = "overview" | "models";
    
    interface HeaderProps {
      activeTab: TabType;
      onTabClick?: (tab: TabType) => void;
    }
    
    export function Header({ activeTab, onTabClick }: HeaderProps) {
      return (
        <Box paddingX={1} gap={2}>
          <Tab name="Overview" id="overview" active={activeTab === "overview"} onClick={onTabClick} />
          <Tab name="Models" id="models" active={activeTab === "models"} onClick={onTabClick} />
          <Text dimColor>(tab to cycle)</Text>
        </Box>
      );
    }
    
    function Tab({ name, id, active, onClick }: { name: string; id: TabType; active: boolean; onClick?: (tab: TabType) => void }) {
      if (active) {
        return <Text backgroundColor="white" color="black" bold> {name} </Text>;
      }
      return <Text dimColor>{name}</Text>;
    }
    ```
  - **Verification**: Two tabs render, active tab has inverted colors

- [ ] 3.2 Create OverviewView component
  - **File**: `packages/cli/src/tui/components/OverviewView.tsx`
  - **Implementation**:
    ```typescript
    import { Box, Text } from "ink";
    import { BarChart } from "./BarChart.js";
    import { Legend } from "./Legend.js";
    import { ModelListItem } from "./ModelListItem.js";
    import type { TUIData } from "../hooks/useData.js";
    
    interface OverviewViewProps {
      data: TUIData | null;
      width: number;
      height: number;
      scrollOffset: number;
      selectedIndex: number;
    }
    
    export function OverviewView({ data, width, height, scrollOffset, selectedIndex }: OverviewViewProps) {
      if (!data) return null;
      
      const chartHeight = 8;
      const legendHeight = 1;
      const headerHeight = 2; // "All models" + divider
      const listHeight = height - chartHeight - legendHeight - headerHeight - 2;
      
      const visibleModels = data.modelEntries.slice(scrollOffset, scrollOffset + listHeight);
      
      return (
        <Box flexDirection="column" gap={1}>
          <BarChart data={data.chartData} width={width} height={chartHeight} />
          <Legend models={data.topModels} />
          
          <Box flexDirection="column">
            <Text bold>All models</Text>
            <Text dimColor>{"─".repeat(Math.min(30, width))}</Text>
            {visibleModels.map((entry, i) => (
              <ModelListItem
                key={entry.model}
                modelId={entry.model}
                percentage={data.modelPercentages.get(entry.model) || 0}
                inputTokens={entry.input}
                outputTokens={entry.output}
                isSelected={i + scrollOffset === selectedIndex}
              />
            ))}
          </Box>
        </Box>
      );
    }
    ```

- [ ] 3.3 Create ModelListItem component
  - **File**: `packages/cli/src/tui/components/ModelListItem.tsx`
  - **Implementation**:
    ```typescript
    import { Box, Text } from "ink";
    import { getModelColor } from "../utils/colors.js";
    
    interface ModelListItemProps {
      modelId: string;
      percentage: number;
      inputTokens: number;
      outputTokens: number;
      isSelected: boolean;
    }
    
    function formatTokens(n: number): string {
      if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return n.toString();
    }
    
    export function ModelListItem({ modelId, percentage, inputTokens, outputTokens, isSelected }: ModelListItemProps) {
      const color = getModelColor(modelId);
      const bgColor = isSelected ? "blue" : undefined;
      
      return (
        <Box flexDirection="column">
          <Box backgroundColor={bgColor}>
            <Text color={color}>●</Text>
            <Text color={isSelected ? "white" : undefined}> {modelId} </Text>
            <Text dimColor>({percentage.toFixed(1)}%)</Text>
          </Box>
          <Text dimColor>  In: {formatTokens(inputTokens)} · Out: {formatTokens(outputTokens)}</Text>
        </Box>
      );
    }
    ```

- [ ] 3.4 Redesign Footer component
  - **File**: `packages/cli/src/tui/components/Footer.tsx`
  - **Before**:
    ```typescript
    interface FooterProps {
      enabledSources: Set<SourceType>;
      sortBy: SortType;
      totalCost: number;
      modelCount: number;
    }
    ```
  - **After**:
    ```typescript
    import { Box, Text } from "ink";
    import type { SourceType, SortType } from "../App.js";
    
    interface FooterProps {
      enabledSources: Set<SourceType>;
      sortBy: SortType;
      totalCost: number;
      modelCount: number;
      scrollPosition: number;  // NEW
      totalItems: number;      // NEW
      visibleItems: number;    // NEW
    }
    
    export function Footer({ enabledSources, sortBy, totalCost, modelCount, scrollPosition, totalItems, visibleItems }: FooterProps) {
      const formatCost = (cost: number) => cost >= 1000 ? `$${(cost / 1000).toFixed(1)}K` : `$${cost.toFixed(2)}`;
      const scrollEnd = Math.min(scrollPosition + visibleItems, totalItems);
      
      return (
        <Box paddingX={1} justifyContent="space-between">
          <Box gap={1}>
            <Text dimColor>↓ {scrollPosition + 1}-{scrollEnd} of {totalItems} models (↑↓ to scroll)</Text>
            <Text>|</Text>
            <SourceBadge name="OpenCode" enabled={enabledSources.has("opencode")} />
            <SourceBadge name="Claude" enabled={enabledSources.has("claude")} />
            <SourceBadge name="Codex" enabled={enabledSources.has("codex")} />
            <SourceBadge name="Cursor" enabled={enabledSources.has("cursor")} />
            <SourceBadge name="Gemini" enabled={enabledSources.has("gemini")} />
            <Text>|</Text>
            <Text dimColor>Sort: {sortBy === "cost" ? "Cost" : sortBy === "name" ? "Name" : "Tokens"} ↓</Text>
          </Box>
          <Box gap={1}>
            <Text dimColor>({modelCount} models)</Text>
            <Text>|</Text>
            <Text color="green" bold>Total: {formatCost(totalCost)}</Text>
          </Box>
        </Box>
      );
    }
    
    function SourceBadge({ name, enabled }: { name: string; enabled: boolean }) {
      return (
        <Text color={enabled ? "green" : "gray"}>
          [{enabled ? "●" : "○"} {name}]
        </Text>
      );
    }
    ```

### Phase 4: App Integration

- [ ] 4.1 Update App.tsx state and types
  - **File**: `packages/cli/src/tui/App.tsx`
  - **Changes**:
    ```typescript
    // BEFORE
    export type TabType = "model" | "daily" | "stats";
    
    // AFTER
    export type TabType = "overview" | "models";
    
    // Add to AppState
    interface AppState {
      activeTab: TabType;
      enabledSources: Set<SourceType>;
      sortBy: SortType;
      sortDesc: boolean;
      selectedIndex: number;
      scrollOffset: number;  // NEW
    }
    
    // Initialize
    const [state, setState] = useState<AppState>({
      activeTab: "overview",  // Changed from "model"
      enabledSources: new Set(["opencode", "claude", "codex", "cursor", "gemini"]),
      sortBy: "cost",
      sortDesc: true,
      selectedIndex: 0,
      scrollOffset: 0,  // NEW
    });
    
    // Calculate visible range
    const listHeight = rows - 20; // Approximate
    const visibleRange = { start: state.scrollOffset, end: state.scrollOffset + listHeight };
    ```

- [ ] 4.2 Add mouse click support
  - **IMPORTANT**: ink does NOT have a `useMouse` hook. Use `useStdin` with ANSI escape sequences.
  - **Implementation** (add to App.tsx or create `hooks/useMouse.ts`):
    ```typescript
    import { useStdin } from "ink";
    import { useEffect, useCallback } from "react";
    
    interface MousePosition {
      x: number;
      y: number;
      button: "left" | "right" | "middle" | "release";
    }
    
    export function useMouseClick(onMouseClick: (pos: MousePosition) => void) {
      const { stdin, setRawMode } = useStdin();
      
      useEffect(() => {
        if (!stdin || !setRawMode) return;
        
        setRawMode(true);
        // Enable mouse tracking (X10 mode - clicks only)
        process.stdout.write("\x1b[?1000h");
        
        const handleData = (data: Buffer) => {
          const str = data.toString();
          // Parse CSI M mouse sequence: ESC [ M Cb Cx Cy
          const match = str.match(/\x1b\[M([\x20-\x7f])([\x20-\x7f])([\x20-\x7f])/);
          if (match) {
            const button = match[1].charCodeAt(0) - 32;
            const x = match[2].charCodeAt(0) - 33;
            const y = match[3].charCodeAt(0) - 33;
            const buttonType = (button & 3) === 0 ? "left" : (button & 3) === 1 ? "middle" : (button & 3) === 2 ? "right" : "release";
            onMouseClick({ x, y, button: buttonType });
          }
        };
        
        stdin.on("data", handleData);
        
        return () => {
          // Disable mouse tracking
          process.stdout.write("\x1b[?1000l");
          stdin.off("data", handleData);
        };
      }, [stdin, setRawMode, onMouseClick]);
    }
    ```
  - **Usage in App.tsx**:
    ```typescript
    const handleTabClick = useCallback((tab: TabType) => {
      setState(s => ({ ...s, activeTab: tab, selectedIndex: 0, scrollOffset: 0 }));
    }, []);
    
    useMouseClick(({ x, y, button }) => {
      if (button !== "left") return;
      // Tab bar is at y=0, "Overview" is x=1-9, "Models" is x=11-17
      if (y === 0) {
        if (x >= 1 && x <= 9) handleTabClick("overview");
        if (x >= 11 && x <= 17) handleTabClick("models");
      }
    });
    ```
  - **Verification**: Click on tab area changes active tab

- [ ] 4.3 Wire up new components
  - **File**: `packages/cli/src/tui/App.tsx`
  - **Changes**:
    ```typescript
    // BEFORE
    import { ModelView } from "./components/ModelView.js";
    import { DailyView } from "./components/DailyView.js";
    import { StatsView } from "./components/StatsView.js";
    
    // AFTER
    import { OverviewView } from "./components/OverviewView.js";
    // Note: ModelView kept for "Models" tab, DailyView/StatsView can be deleted
    
    // In render:
    {state.activeTab === "overview" && (
      <OverviewView 
        data={data}
        width={columns}
        height={contentHeight}
        scrollOffset={state.scrollOffset}
        selectedIndex={state.selectedIndex}
      />
    )}
    {state.activeTab === "models" && (
      <ModelView 
        data={data}
        sortBy={state.sortBy}
        sortDesc={state.sortDesc}
        selectedIndex={state.selectedIndex}
        height={contentHeight}
      />
    )}
    ```

### Phase 5: Testing & Polish

- [ ] 5.1 Test with real data
  - **Commands**:
    ```bash
    cd packages/cli && yarn build
    yarn cli tui
    ```
  - **Expected Output**:
    - Overview tab shows bar chart with colored bars
    - Legend shows top 5 models with correct colors
    - Model list shows percentages that sum to ~100%
    - Footer shows "↓ 1-N of M models"
  - **Click Test**: Click on "Models" tab → view changes

- [ ] 5.2 Edge case handling
  - **No data**: Show "No usage data found. Run token-tracker to generate."
  - **Single day**: Render single bar
  - **Terminal too narrow**: Minimum width check, show message if < 60 columns
  - **Implementation**:
    ```typescript
    if (!data || data.chartData.length === 0) {
      return (
        <Box flexDirection="column" alignItems="center" justifyContent="center" height={height}>
          <Text>No usage data found.</Text>
          <Text dimColor>Run token-tracker to analyze your usage.</Text>
        </Box>
      );
    }
    
    if (columns < 60) {
      return <Text color="yellow">Terminal too narrow. Minimum 60 columns required.</Text>;
    }
    ```

- [ ] 5.3 Final cleanup
  - Delete unused files: `DailyView.tsx`, `StatsView.tsx` (if not needed)
  - Run `yarn lint` to fix any issues
  - Run `yarn build` to verify compilation

---

## Current Progress
현재 진행 중인 작업: None

## Files to Create
| File | Description |
|------|-------------|
| `packages/cli/src/tui/utils/colors.ts` | Color utility for model → color mapping |
| `packages/cli/src/tui/components/BarChart.tsx` | Stacked bar chart component |
| `packages/cli/src/tui/components/Legend.tsx` | Chart legend component |
| `packages/cli/src/tui/components/OverviewView.tsx` | Main overview view with chart + model list |
| `packages/cli/src/tui/components/ModelListItem.tsx` | Individual model list item |

## Files to Modify
| File | Changes |
|------|---------|
| `packages/cli/src/tui/App.tsx` | Update state, add mouse support, wire new components |
| `packages/cli/src/tui/components/Header.tsx` | New tab names (Overview/Models), click support |
| `packages/cli/src/tui/components/Footer.tsx` | New layout with scroll indicator |
| `packages/cli/src/tui/hooks/useData.ts` | Add chartData, modelPercentages, topModels |

## Files to Delete (after verification)
| File | Reason |
|------|--------|
| `packages/cli/src/tui/components/DailyView.tsx` | Merged into OverviewView chart |
| `packages/cli/src/tui/components/StatsView.tsx` | Removed, stats shown in Overview |

## Dependencies
- `ink` already installed (React for CLI)
- No new dependencies needed

## Verification Checklist
- [ ] `yarn cli tui` launches without errors
- [ ] Bar chart displays with correct provider colors
- [ ] Tab clicks work (Overview ↔ Models)
- [ ] Scroll indicator shows correct position (e.g., "↓ 1-18 of 27 models")
- [ ] Model percentages displayed and sum to ~100%
- [ ] Colors match provider scheme (Anthropic=Orange, OpenAI=Green, etc.)
- [ ] Edge cases handled (no data, narrow terminal)
- [ ] TypeScript compilation passes
- [ ] Lint passes
