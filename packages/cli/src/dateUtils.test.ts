import { describe, expect, it } from "bun:test";
import { formatLocalDate } from "./dateUtils.js";

describe("formatLocalDate", () => {
  it("returns local date, not UTC date (TZ=Asia/Seoul)", () => {
    // UTC 2025-06-16 23:00 = KST 2025-06-17 08:00
    // If the implementation uses UTC, it would return "2025-06-16" (wrong).
    const ts = 1750111200000;
    const date = new Date(ts);
    expect(formatLocalDate(date)).toBe("2025-06-17");
  });

  it("zero-pads single-digit month and day", () => {
    // 2025-01-05 in KST
    const date = new Date(2025, 0, 5);
    expect(formatLocalDate(date)).toBe("2025-01-05");
  });
});
