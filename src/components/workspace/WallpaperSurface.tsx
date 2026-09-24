import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";
import {
  builtInWallpapers,
  loadWallpaperAssetFiles,
  wallpaperIdForDate,
  wallpaperSurfaces,
  type WallpaperModule,
  type WallpaperPreferences,
  type WallpaperSurfaceId,
} from "../../lib/wallpapers";

type SurfaceProps<T extends ElementType> = {
  target: WallpaperSurfaceId;
  as?: T;
} & ComponentPropsWithoutRef<T>;

type WallpaperSurfaceContextValue = {
  module: WallpaperModule;
  preferences: WallpaperPreferences;
  date: Date;
  assetsRevision: number;
};

type LoadedSurfaceImages = {
  id: string;
  desktopUrl: string;
  mobileUrl: string;
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
  const builtIn = builtInWallpapers.find((asset) => asset.id === wallpaperId);
  const [loaded, setLoaded] = useState<LoadedSurfaceImages | null>(null);

  useEffect(() => {
    let current = true;
    const urls = new Set<string>();
    setLoaded(null);
    if (!wallpaperId || builtIn) {
      return () => {
        current = false;
      };
    }

    void loadWallpaperAssetFiles(wallpaperId)
      .then((files) => {
        if (!current || !files) return;
        const desktopBlob = files.desktopBlob ?? files.mobileBlob;
        const mobileBlob = files.mobileBlob ?? files.desktopBlob;
        if (!desktopBlob || !mobileBlob) return;
        const makeUrl = (blob: Blob) => {
          const url = URL.createObjectURL(blob);
          urls.add(url);
          return url;
        };
        const desktopUrl = makeUrl(desktopBlob);
        const mobileUrl = mobileBlob === desktopBlob ? desktopUrl : makeUrl(mobileBlob);
        setLoaded({ id: wallpaperId, desktopUrl, mobileUrl });
      })
      .catch(() => {
        if (current) setLoaded(null);
      });

    return () => {
      current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [wallpaperId, context?.assetsRevision]);

  const images = builtIn
    ? { desktopUrl: builtIn.desktopUrl, mobileUrl: builtIn.mobileUrl }
    : loaded?.id === wallpaperId
      ? loaded
      : null;
  const styleWithWallpaper = images && preference
    ? {
        ...style,
        "--wallpaper-surface-desktop": `url("${images.desktopUrl}")`,
        "--wallpaper-surface-mobile": `url("${images.mobileUrl}")`,
        "--wallpaper-surface-overlay": String(preference.overlay / 100),
      } as CSSProperties
    : style;
  const Component = (as ?? "div") as ElementType;

  return createElement(Component, {
    ...props,
    style: styleWithWallpaper,
    "data-wallpaper-surface": images ? target : undefined,
  });
}
