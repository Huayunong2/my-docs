import { Unzip, UnzipInflate } from "fflate";

const maxManifestBytes = 16 * 1024 * 1024;

/** Reads only the manifest from a ZIP stream; data.json and image payloads are not buffered. */
export async function readFullPackageManifest(file: Blob): Promise<unknown> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  let manifestSeen = false;
  let resolveManifest!: (value: unknown) => void;
  let rejectManifest!: (reason: Error) => void;
  const manifest = new Promise<unknown>((resolve, reject) => {
    resolveManifest = resolve;
    rejectManifest = reject;
  });
  void manifest.catch(() => undefined);

  unzip.onfile = (entry) => {
    if (entry.name !== "manifest.json") return;
    if (manifestSeen) {
      rejectManifest(new Error("迁移包包含重复清单。"));
      return;
    }
    manifestSeen = true;
    const parts: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (error, data, final) => {
      if (error) {
        rejectManifest(new Error("迁移包清单损坏。"));
        return;
      }
      size += data.length;
      if (size > maxManifestBytes) {
        rejectManifest(new Error("迁移包清单超过 16 MiB。"));
        return;
      }
      if (data.length) parts.push(data);
      if (!final) return;
      try {
        const combined = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          combined.set(part, offset);
          offset += part.length;
        }
        resolveManifest(JSON.parse(new TextDecoder().decode(combined)) as unknown);
      } catch {
        rejectManifest(new Error("迁移包清单不是有效 JSON。"));
      }
    };
    entry.start();
  };

  const reader = file.stream().getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      unzip.push(value ?? new Uint8Array(), done);
      if (done) break;
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error("无法读取迁移包；请确认 ZIP 文件完整。");
  } finally {
    reader.releaseLock();
  }
  if (!manifestSeen) throw new Error("ZIP 文件中没有迁移包清单。");
  return manifest;
}

export function validateFullPackageManifest(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("迁移包清单无效。");
  const manifest = value as Record<string, unknown>;
  if (manifest.formatVersion !== 1) throw new Error("不支持此迁移包版本。");
  if (manifest.dataFile !== "data.json") throw new Error("迁移包缺少业务数据文件。");
  if (!manifest.preferences || typeof manifest.preferences !== "object") throw new Error("迁移包缺少壁纸分配。");
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.presets)) throw new Error("迁移包中的壁纸清单无效。");
  if (manifest.assets.length > 1024 || manifest.presets.length > 30) throw new Error("迁移包中的壁纸或方案数量超出上限。");
  const summary = manifest.summary;
  if (!summary || typeof summary !== "object") throw new Error("迁移包缺少预览摘要。");
  const counts = summary as Record<string, unknown>;
  if (![counts.articleCount, counts.reviewCount, counts.knowledgeCount].every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
    || typeof counts.dateRange !== "string") {
    throw new Error("迁移包预览摘要无效。");
  }
  for (const name of ["profileEntryCount","profileGoalCount"]) {
    if (counts[name] !== undefined && (!Number.isSafeInteger(counts[name]) || Number(counts[name]) < 0)) throw new Error("个人档案预览数量无效。");
  }
  if (counts.hasPersonalProfile !== undefined && typeof counts.hasPersonalProfile !== "boolean") throw new Error("个人档案预览标识无效。");
  return manifest as {
    formatVersion: 1;
    dataFile: "data.json";
    summary: { articleCount: number; reviewCount: number; knowledgeCount: number; dateRange: string; profileEntryCount?: number; profileGoalCount?: number; hasPersonalProfile?: boolean };
    preferences: unknown;
    assets: Array<{ metadata?: { name?: string } }>;
    presets: unknown[];
  };
}
