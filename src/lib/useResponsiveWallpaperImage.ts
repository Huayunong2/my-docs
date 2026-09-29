import { useEffect, useState } from "react";
import * as api from "./api";
import { loadWallpaperAssetFiles } from "./wallpapers";

export type WallpaperImageVariant = "desktop" | "mobile";

export function wallpaperImageVariantForWidth(width: number): WallpaperImageVariant {
  return width <= 767 ? "mobile" : "desktop";
}

export async function loadWallpaperImage(
  id: string,
  cacheVersion: string | undefined,
  variant: WallpaperImageVariant,
): Promise<Blob> {
  try {
    return await api.getWallpaperAssetFile(id, variant, cacheVersion);
  } catch {
    const local = await loadWallpaperAssetFiles(id);
    if (!local) throw new Error("wallpaper image unavailable");
    return variant === "mobile"
      ? local.mobileBlob ?? local.desktopBlob
      : local.desktopBlob ?? local.mobileBlob;
  }
}

function currentVariant(): WallpaperImageVariant {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia?.("(max-width: 767px)").matches
    ? "mobile"
    : wallpaperImageVariantForWidth(window.innerWidth);
}

export function useResponsiveWallpaperImage(
  id: string | null,
  cacheVersion?: string,
  assetsRevision = 0,
) {
  const [variant, setVariant] = useState(currentVariant);
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = (event: MediaQueryListEvent) => {
      setVariant(event.matches ? "mobile" : "desktop");
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const key = id ? id + ":" + (cacheVersion ?? "") + ":" + variant : "";
  useEffect(() => {
    if (!id) return;
    let active = true;
    let objectUrl = "";
    void loadWallpaperImage(id, cacheVersion, variant)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key, url: objectUrl });
      })
      .catch(() => {
        if (active) setLoaded(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, cacheVersion, variant, assetsRevision, key]);

  return { variant, url: loaded?.key === key ? loaded.url : null };
}
