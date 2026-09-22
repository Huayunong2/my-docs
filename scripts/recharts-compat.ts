import type { Plugin } from "vite";

/** Keep the same compat helpers while avoiding their CommonJS subpath shims. */
export function rewriteRechartsCompatImports(source: string): string {
  return source.replace(
    /^import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])es-toolkit\/compat\/([A-Za-z_$][\w$]*)\2\s*;?/gm,
    (_statement, local: string, _quote: string, exported: string) =>
      `import { ${exported}${local === exported ? "" : ` as ${local}`} } from 'es-toolkit/compat';`,
  );
}

export function rechartsCompatEsm(): Plugin {
  return {
    name: "recharts-compat-esm",
    enforce: "pre",
    apply: "build",
    transform(source, id) {
      if (!id.replaceAll("\\", "/").includes("/recharts/es6/")) return null;
      const code = rewriteRechartsCompatImports(source);
      return code === source ? null : { code, map: null };
    },
  };
}
// Recharts #7376: Vite 8/Rolldown can emit self-shadowing CJS initialization
// (e.g. var require_isEqual = require_isEqual()). Named ESM imports avoid it.
// This source-controlled adapter does not modify node_modules or disable minification.
