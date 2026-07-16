import fs from "node:fs";
import zlib from "node:zlib";

const manifestPath = "dist/.vite/manifest.json";
const budgetBytes = 180_000;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);

if (!entryKey) {
  throw new Error(`No application entry found in ${manifestPath}`);
}

const files = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  files.add(chunk.file);
  for (const imported of chunk.imports || []) visit(imported);
}
visit(entryKey);

const gzipBytes = [...files].reduce((total, file) => {
  const content = fs.readFileSync(`dist/${file}`);
  return total + zlib.gzipSync(content).length;
}, 0);

console.log(`Initial JavaScript gzip: ${gzipBytes} bytes (budget: ${budgetBytes})`);
if (gzipBytes > budgetBytes) process.exit(1);
