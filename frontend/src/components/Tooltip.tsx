"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyContribution, TooltipPosition, Theme } from "@/lib/types";
import { formatDate, formatCurrency, formatTokenCount } from "@/lib/utils";

interface TooltipProps {
  day: DailyContribution | null;
  position: TooltipPosition | null;
  visible: boolean;
  theme: Theme;
}

export function Tooltip({ day, position, visible, theme }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<TooltipPosition | null>(null);

  // Adjust position to prevent overflow
  useEffect(() => {
    if (!visible || !position || !tooltipRef.current) {
      setAdjustedPosition(null);
      return;
    }

    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x + 15; // Offset from cursor
    let y = position.y + 15;

    // Prevent horizontal overflow
    if (x + rect.width > viewportWidth - 10) {
      x = position.x - rect.width - 15;
    }

    // Prevent vertical overflow
    if (y + rect.height > viewportHeight - 10) {
      y = position.y - rect.height - 15;
    }

    // Ensure minimum position
    x = Math.max(10, x);
    y = Math.max(10, y);

    setAdjustedPosition({ x, y });
  }, [visible, position]);

  if (!visible || !day || !adjustedPosition) return null;

  const { totals, tokenBreakdown } = day;

  return (
    <div
      ref={tooltipRef}
      className="fixed z-50 pointer-events-none"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      <div
        className="rounded-lg shadow-lg border p-3 min-w-[200px]"
        style={{
          backgroundColor: theme.background,
          borderColor: theme.meta,
          color: theme.text,
        }}
      >
        {/* Date */}
        <div className="font-semibold mb-2" style={{ color: theme.text }}>
          {formatDate(day.date)}
        </div>

        {/* Divider */}
        <div className="border-t my-2" style={{ borderColor: theme.meta }} />

        {/* Cost (highlighted) */}
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm" style={{ color: theme.meta }}>
            Cost
          </span>
          <span
            className="font-bold text-lg"
            style={{
              color:
                day.intensity >= 3
                  ? theme.grade4
                  : day.intensity >= 2
                  ? theme.grade3
                  : theme.text,
            }}
          >
            {formatCurrency(totals.cost)}
          </span>
        </div>

        {/* Divider */}
        <div className="border-t my-2" style={{ borderColor: theme.meta }} />

        {/* Token breakdown */}
        <div className="space-y-1 text-sm">
          <TokenRow label="Input" value={tokenBreakdown.input} color={theme.meta} textColor={theme.text} />
          <TokenRow label="Output" value={tokenBreakdown.output} color={theme.meta} textColor={theme.text} />
          <TokenRow label="Cache Read" value={tokenBreakdown.cacheRead} color={theme.meta} textColor={theme.text} />
          <TokenRow label="Cache Write" value={tokenBreakdown.cacheWrite} color={theme.meta} textColor={theme.text} />
          {tokenBreakdown.reasoning > 0 && (
            <TokenRow label="Reasoning" value={tokenBreakdown.reasoning} color={theme.meta} textColor={theme.text} />
          )}
        </div>

        {/* Divider */}
        <div className="border-t my-2" style={{ borderColor: theme.meta }} />

        {/* Total tokens */}
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium" style={{ color: theme.meta }}>
            Total
          </span>
          <span className="font-semibold" style={{ color: theme.text }}>
            {formatTokenCount(totals.tokens)} tokens
          </span>
        </div>

        {/* Messages count */}
        <div className="flex justify-between items-center mt-1">
          <span className="text-sm" style={{ color: theme.meta }}>
            Messages
          </span>
          <span className="text-sm" style={{ color: theme.text }}>
            {totals.messages.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

interface TokenRowProps {
  label: string;
  value: number;
  color: string;
  textColor: string;
}

function TokenRow({ label, value, color, textColor }: TokenRowProps) {
  if (value === 0) return null;

  return (
    <div className="flex justify-between items-center">
      <span style={{ color }}>{label}</span>
      <span className="font-mono" style={{ color: textColor }}>
        {formatTokenCount(value)}
      </span>
    </div>
  );
}
