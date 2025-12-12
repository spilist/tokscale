import { Box, Text } from "ink";
import { getModelColor } from "../utils/colors.js";

interface LegendProps {
  models: string[];
}

export function Legend({ models }: LegendProps) {
  if (models.length === 0) return null;

  return (
    <Box gap={1} flexWrap="wrap">
      {models.map((modelId, i) => (
        <Box key={`${modelId}-${i}`} gap={0}>
          <Text color={getModelColor(modelId)}>●</Text>
          <Text> {modelId}</Text>
          {i < models.length - 1 && <Text dimColor>  ·</Text>}
        </Box>
      ))}
    </Box>
  );
}
