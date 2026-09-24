const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxUploadBytes = 20 * 1024 * 1024;
const maxImagePixels = 16_777_216;
const maxImageEdge = 8192;
const displayMaxEdge = 3840;
const thumbnailMaxEdge = 360;

export type ProcessedWallpaperImage = {
  blob: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
};

function scaledSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function renderImage(
  source: ImageBitmap,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片。");
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

export async function processWallpaperFile(
  file: File,
): Promise<ProcessedWallpaperImage> {
  if (!acceptedTypes.has(file.type)) {
    throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
  }
  if (file.size > maxUploadBytes) {
    throw new Error("单张壁纸不能超过 20 MiB。");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取这张图片，请换一张 PNG、JPEG 或 WebP 图片。");
  }

  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    if (
      originalWidth > maxImageEdge ||
      originalHeight > maxImageEdge ||
      originalWidth * originalHeight > maxImagePixels
    ) {
      throw new Error(
        "图片分辨率过大；请使用每边不超过 8192 像素、总像素不超过 16 MP 的图片。",
      );
    }

    const displaySize = scaledSize(originalWidth, originalHeight, displayMaxEdge);
    const displayCanvas = renderImage(bitmap, displaySize.width, displaySize.height);
    const encodedWebp = await canvasBlob(displayCanvas, "image/webp", 0.86);
    const wasResized =
      displaySize.width !== originalWidth || displaySize.height !== originalHeight;
    let displayBlob =
      encodedWebp?.type === "image/webp" &&
      (wasResized || encodedWebp.size < file.size)
        ? encodedWebp
        : file;
    if (wasResized && displayBlob === file) {
      displayBlob =
        (await canvasBlob(displayCanvas, "image/png")) ?? displayBlob;
    }

    const thumbnailSize = scaledSize(
      originalWidth,
      originalHeight,
      thumbnailMaxEdge,
    );
    const thumbnailCanvas = renderImage(
      bitmap,
      thumbnailSize.width,
      thumbnailSize.height,
    );
    const encodedThumbnail = await canvasBlob(
      thumbnailCanvas,
      "image/webp",
      0.72,
    );
    const thumbnail =
      encodedThumbnail?.type === "image/webp"
        ? encodedThumbnail
        : (await canvasBlob(thumbnailCanvas, "image/png")) ?? thumbnailCanvasBlobFallback(thumbnailCanvas);

    return {
      blob: displayBlob,
      thumbnail,
      width: displaySize.width,
      height: displaySize.height,
      originalBytes: file.size,
      optimizedBytes: displayBlob.size,
    };
  } finally {
    bitmap.close();
  }
}

function thumbnailCanvasBlobFallback(canvas: HTMLCanvasElement): Blob {
  const data = canvas.toDataURL("image/png");
  const [header, encoded] = data.split(",");
  const mimeType = header.match(/data:(.*?);base64/)?.[1] ?? "image/png";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

