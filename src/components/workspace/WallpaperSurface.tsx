import {
  createElement,
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import {
  wallpaperIdForDate,
  wallpaperSurfaces,
  type WallpaperAssetMetadata,
  type WallpaperModule,
  type WallpaperPreferences,
  type WallpaperSurfaceId,
} from "../../lib/wallpapers";
import { useResponsiveWallpaperImage } from "../../lib/useResponsiveWallpaperImage";

type SurfaceProps<T extends ElementType> = {
  target: WallpaperSurfaceId;
  as?: T;
} & ComponentPropsWithoutRef<T>;

type WallpaperSurfaceContextValue = {
  module: WallpaperModule;
  preferences: WallpaperPreferences;
  assets: WallpaperAssetMetadata[];
  date: Date;
  assetsRevision: number;
};

const WallpaperSurfaceContext = createContext<WallpaperSurfaceContextValue | null>(null);

export function WallpaperSurfaceProvider({
  value,
  children,
}: {
  value: WallpaperSurfaceContextValue;
  children: ReactNode;
}) {
  return (
    <WallpaperSurfaceContext.Provider value={value}>
      {children}
    </WallpaperSurfaceContext.Provider>
  );
}

export function WallpaperSurface<T extends ElementType = "div">({
  target,
  as,
  style,
  ...props
}: SurfaceProps<T>) {
  const context = useContext(WallpaperSurfaceContext);
  const surface = wallpaperSurfaces.find((item) => item.id === target);
  const preference =
    context && surface && surface.module === context.module
      ? context.preferences[surface.module].surfaces[target]
      : undefined;
  const wallpaperId =
    context && preference ? wallpaperIdForDate(preference, context.date) : null;
  const cacheVersion = context?.assets.find((asset) => asset.id === wallpaperId)?.cacheVersion;
  const { url } = useResponsiveWallpaperImage(
    wallpaperId,
    cacheVersion,
    context?.assetsRevision,
  );
  const hasWallpaper = !!wallpaperId && !!url;
  const styleWithWallpaper = hasWallpaper && preference
    ? {
        ...style,
        "--wallpaper-surface-desktop": "url(\"" + url + "\")",
        "--wallpaper-surface-mobile": "url(\"" + url + "\")",
        "--wallpaper-surface-overlay": String(preference.overlay / 100),
      } as CSSProperties
    : style;
  const Component = (as ?? "div") as ElementType;

  return createElement(Component, {
    ...props,
    style: styleWithWallpaper,
    "data-wallpaper-surface": hasWallpaper ? target : undefined,
  });
}
