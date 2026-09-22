import { describe, expect, it } from "vitest";
import {
  rechartsCompatEsm,
  rewriteRechartsCompatImports,
} from "./recharts-compat";

describe("Recharts production ESM compatibility", () => {
  it("rewrites the crashing isEqual subpath without changing the helper", () => {
    expect(
      rewriteRechartsCompatImports(
        "import isEqual from 'es-toolkit/compat/isEqual';",
      ),
    ).toBe("import { isEqual } from 'es-toolkit/compat';");
  });
  it("preserves a local alias and double quotes", () => {
    expect(
      rewriteRechartsCompatImports(
        'import readValue from "es-toolkit/compat/get";',
      ),
    ).toBe("import { get as readValue } from 'es-toolkit/compat';");
  });
  it("rewrites all matching import declarations", () => {
    const source =
      "import get from 'es-toolkit/compat/get';\nimport sortBy from 'es-toolkit/compat/sortBy';\nconst value = get(data, 'x');";
    expect(rewriteRechartsCompatImports(source)).not.toContain("compat/");
    expect(rewriteRechartsCompatImports(source)).toContain(
      "const value = get(data, 'x');",
    );
  });
  it("does not rewrite other packages or named ESM imports", () => {
    const source =
      "import { get } from 'es-toolkit/compat';\nimport value from 'other/get';";
    expect(rewriteRechartsCompatImports(source)).toBe(source);
  });
  it("is idempotent", () => {
    const once = rewriteRechartsCompatImports(
      "import throttle from 'es-toolkit/compat/throttle';",
    );
    expect(rewriteRechartsCompatImports(once)).toBe(once);
  });
  it("runs before production transforms, not in the working dev optimizer", () => {
    expect(rechartsCompatEsm()).toMatchObject({
      apply: "build",
      enforce: "pre",
    });
  });
});
