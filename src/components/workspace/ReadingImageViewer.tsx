import { useEffect, useRef, useState, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton, Button } from "../ui/button";
import type { ReadingImageItem } from "./ReadingImage";
import { simpleDisplay } from "../../lib/simpleDisplay";

export default function ReadingImageViewer({ items, initialIndex, onClose, returnFocus }: { items: ReadingImageItem[]; initialIndex: number; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const [index, setIndex] = useState(initialIndex);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const zoom = useRef<PanzoomObject | null>(null);
  const item = items[index];
  useEffect(() => {
    if (!image || !loaded) return;
    const instance = Panzoom(image, { minScale:1, maxScale:6, disablePan:true, animate: !simpleDisplay() && !matchMedia("(prefers-reduced-motion: reduce)").matches });
    zoom.current = instance;
    const allowPan=()=>instance.setOptions({disablePan:instance.getScale()<=1});
    image.addEventListener("panzoomchange",allowPan);
    const parent = image.parentElement!;
    const wheel = (event: WheelEvent) => { event.preventDefault(); instance.zoomWithWheel(event); };
    const reset = () => instance.reset();
    parent.addEventListener("wheel",wheel,{passive:false}); parent.addEventListener("dblclick",reset);
    return () => { parent.removeEventListener("wheel",wheel); parent.removeEventListener("dblclick",reset); image.removeEventListener("panzoomchange",allowPan); instance.destroy(); instance.resetStyle(); zoom.current=null; };
  },[image,loaded]);
  const move = (next: number) => { if (next>=0 && next<items.length) { setLoaded(false); setFailed(false); setIndex(next); } };
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="reading-image-overlay"/><Dialog.Content className="reading-image-viewer" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus({preventScroll:true}); }} onKeyDown={event => { if(event.key==="ArrowRight") {event.preventDefault();move(index+1);} if(event.key==="ArrowLeft") {event.preventDefault();move(index-1);} }}>
    <header><div><Dialog.Title>{item.alt || "正文图片"}</Dialog.Title><Dialog.Description>{index+1} / {items.length} · 双指缩放，拖动查看</Dialog.Description></div><Dialog.Close asChild><IconButton label="关闭图片"><X size={20}/></IconButton></Dialog.Close></header>
    <div className="reading-image-stage">{failed ? <div role="status"><p>图片暂时无法加载</p><Button onClick={() => {setLoaded(false);setFailed(false);setAttempt(value=>value+1);}}>重新加载</Button></div> : <img key={`${index}:${attempt}`} ref={setImage} src={item.src} alt={item.alt} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} draggable={false}/>}</div>
    <footer><IconButton label="上一张图片" disabled={index===0} onClick={()=>move(index-1)}><ChevronLeft size={20}/></IconButton><IconButton label="缩小图片" disabled={!loaded || failed} onClick={()=>zoom.current?.zoomOut()}><ZoomOut size={20}/></IconButton><IconButton label="复位图片" disabled={!loaded || failed} onClick={()=>zoom.current?.reset()}><RotateCcw size={18}/></IconButton><IconButton label="放大图片" disabled={!loaded || failed} onClick={()=>zoom.current?.zoomIn()}><ZoomIn size={20}/></IconButton><IconButton label="下一张图片" disabled={index===items.length-1} onClick={()=>move(index+1)}><ChevronRight size={20}/></IconButton></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
