import { describe, expect, it } from "vitest";
import { formatNumber, formatPercent, formatUsd } from "@/lib/format";

describe("formatUsd", () => {
  it("formats whole-dollar amounts with no decimals by default", () => {
    expect(formatUsd(1234)).toBe("$1,234");
  });

  it("formats small amounts with 2 decimals by default", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("respects an explicit decimals override", () => {
    expect(formatUsd(0.018_62, { decimals: 4 })).toBe("$0.0186");
  });
});

describe("formatNumber", () => {
  it("adds thousands separators and rounds", () => {
    expect(formatNumber(1_234_567.6)).toBe("1,234,568");
  });
});

describe("formatPercent", () => {
  it("formats with no decimals by default", () => {
    expect(formatPercent(42.6)).toBe("43%");
  });

  it("respects a decimals argument", () => {
    expect(formatPercent(42.567, 1)).toBe("42.6%");
  });
});
