import { lazy, Suspense, useEffect, useRef, useState } from "react";
const ImageViewer = lazy(() => import("./ReadingImageViewer").catch(() => ({default: ViewerUnavailable})));
function ViewerUnavailable({onClose,returnFocus}:{onClose:()=>void;returnFocus:{current:HTMLButtonElement|null}}) {
  return <span role="alert" className="reading-image-loading">图片查看器暂时无法打开，正文图片仍可阅读。<button type="button" onClick={()=>{onClose();returnFocus.current?.focus({preventScroll:true});}}>返回阅读</button></span>;
}
export interface ReadingImageItem { src: string; alt: string }
export default function ReadingImage({ src, alt }: ReadingImageItem) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [gallery, setGallery] = useState<ReadingImageItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(()=>setFailed(false),[src]);
  return <><button ref={trigger} type="button" className="reading-image-trigger not-prose" disabled={!src || failed} aria-label={`查看图片：${alt || "正文图片"}`} onClick={() => {
    // Only collect URLs that already passed through ReactMarkdown's sanitizing pipeline.
    const images = Array.from(trigger.current?.closest(".markdown-content")?.querySelectorAll<HTMLImageElement>("img[data-reading-image]") || []);
    const items = images.map(image => ({src:image.getAttribute("src") || "", alt:image.alt})).filter(item => item.src);
    const current = Math.max(0, images.findIndex(image => image === trigger.current?.querySelector("img")));
    setIndex(current); setGallery(items.length ? items : [{src,alt}]);
  }}><img data-reading-image src={src || undefined} alt={alt} loading="lazy" onError={() => setFailed(true)}/>{failed ? <span role="status">图片暂时无法加载</span> : <span className="reading-image-hint">轻触查看 · 支持缩放</span>}</button>{gallery && <Suspense fallback={<span className="reading-image-loading" role="status">正在打开图片…</span>}><ImageViewer items={gallery} initialIndex={index} returnFocus={trigger} onClose={() => setGallery(null)}/></Suspense>}</>;
}
