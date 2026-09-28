import { describe, expect, it } from "vitest";
import { wallpaperConnectionMessage } from "./wallpaperSyncStatus";

describe("wallpaper connection guidance", () => {
  it("distinguishes an outdated server API from a network failure", () => {
    expect(wallpaperConnectionMessage(404, false)).toContain("更新并重启服务端");
    expect(wallpaperConnectionMessage(0, false)).toContain("检查服务器地址、网络或服务状态");
  });

  it("explains authentication errors and keeps cached state read-only", () => {
    const message = wallpaperConnectionMessage(401, true);
    expect(message).toContain("访问令牌无效或未填写");
    expect(message).toContain("缓存，设置为只读");
  });
});
