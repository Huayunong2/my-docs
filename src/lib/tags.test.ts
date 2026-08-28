import { describe, expect, it } from "vitest";
import { normalizeSpaceName, normalizeSpaceNames } from "./tags";

describe("space name normalization", () => {
  it("collapses whitespace without applying the shorter tag limit", () => {
    const name = `  ${"知识".repeat(30)}   项目  `;
    expect(normalizeSpaceName(name)).toBe(`${"知识".repeat(30)} 项目`);
    expect(normalizeSpaceName(name).length).toBeGreaterThan(24);
  });

  it("deduplicates names case-insensitively and caps the directory", () => {
    const names = normalizeSpaceNames([" Web ", "web", ...Array.from({ length: 20 }, (_, index) => `P${index}`)]);
    expect(names[0]).toBe("Web");
    expect(names).toHaveLength(12);
    expect(new Set(names.map((name) => name.toLocaleLowerCase())).size).toBe(names.length);
  });
});
