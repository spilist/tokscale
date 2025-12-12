import { Box, Text } from "ink";
import type { SourceType, SortType, TabType } from "../App.js";

interface FooterProps {
  enabledSources: Set<SourceType>;
  sortBy: SortType;
  totalCost: number;
  modelCount: number;
  activeTab: TabType;
  scrollStart?: number;
  scrollEnd?: number;
  totalItems?: number;
}

export function Footer({ 
  enabledSources, 
  sortBy, 
  totalCost, 
  modelCount,
  activeTab,
  scrollStart,
  scrollEnd,
  totalItems,
}: FooterProps) {
  const formatCost = (cost: number) => {
    if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}K`;
    return `$${cost.toFixed(2)}`;
  };

  const showScrollInfo = activeTab === "overview" && totalItems && scrollStart !== undefined && scrollEnd !== undefined;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <SourceBadge name="1:OC" enabled={enabledSources.has("opencode")} />
          <SourceBadge name="2:CC" enabled={enabledSources.has("claude")} />
          <SourceBadge name="3:CX" enabled={enabledSources.has("codex")} />
          <SourceBadge name="4:CR" enabled={enabledSources.has("cursor")} />
          <SourceBadge name="5:GM" enabled={enabledSources.has("gemini")} />
          <Text dimColor>|</Text>
          <Text dimColor>Sort:</Text>
          <Text color="white">{sortBy === "cost" ? "Cost" : sortBy === "name" ? "Name" : "Tokens"}</Text>
          {showScrollInfo && (
            <>
              <Text dimColor>|</Text>
              <Text dimColor>↓ {scrollStart + 1}-{scrollEnd} of {totalItems} models</Text>
            </>
          )}
        </Box>
        <Box gap={1}>
          <Text dimColor>Total:</Text>
          <Text color="green" bold>{formatCost(totalCost)}</Text>
          <Text dimColor>({modelCount})</Text>
        </Box>
      </Box>
      <Box>
        <Text dimColor>
          ↑↓ scroll • tab/d view • c/n/t sort • 1-5 filter • r refresh • q quit
        </Text>
      </Box>
    </Box>
  );
}

function SourceBadge({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <Text color={enabled ? "green" : "gray"}>
      [{enabled ? "●" : "○"}{name}]
    </Text>
  );
}
