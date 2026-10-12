import {useSimpleDisplay} from "./simpleDisplay";
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

type SharedImage = {refs:number;url:string;promise:Promise<string>};
const images=new Map<string,SharedImage>();
export function acquireWallpaperImage(key:string,loader:()=>Promise<Blob>){
  let entry=images.get(key);
  if(!entry){
    const next:SharedImage={refs:0,url:"",promise:Promise.resolve("")};
    next.promise=loader().then(blob=>{next.url=URL.createObjectURL(blob);if(next.refs===0){URL.revokeObjectURL(next.url);if(images.get(key)===next)images.delete(key);}return next.url;}).catch(error=>{if(images.get(key)===next)images.delete(key);throw error;});
    images.set(key,next);entry=next;
  }
  entry.refs++;const selected=entry;let released=false;
  return {promise:selected.promise,release(){if(released)return;released=true;selected.refs--;queueMicrotask(()=>{if(selected.refs===0){if(selected.url)URL.revokeObjectURL(selected.url);if(images.get(key)===selected)images.delete(key);}});}};
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
  const simple=useSimpleDisplay();
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

  const key = id && !simple ? api.getServerUrl()+":"+id+":"+(cacheVersion??String(assetsRevision))+":"+variant : "";
  useEffect(() => {
    if (!id || !key) return;
    let active=true;
    const acquired=acquireWallpaperImage(key,()=>loadWallpaperImage(id,cacheVersion,variant));
    void acquired.promise.then(url=>{if(active)setLoaded({key,url});}).catch(()=>{if(active)setLoaded(null);});
    return ()=>{active=false;acquired.release();};
  }, [id, cacheVersion, variant, assetsRevision, key]);

  return { variant, url: loaded?.key === key ? loaded.url : null };
}
