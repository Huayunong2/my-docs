import { useSyncExternalStore } from "react";
import { readLocalStorage, writeLocalStorage } from "./storage";
const event = "simple-display-changed";
export function simpleDisplay() { return readLocalStorage("simple-display") === "1"; }
export function setSimpleDisplay(value: boolean) { writeLocalStorage("simple-display", value ? "1" : "0"); document.documentElement.dataset.simpleDisplay = String(value); window.dispatchEvent(new Event(event)); }
function subscribe(callback: () => void) { window.addEventListener(event, callback); window.addEventListener("storage", callback); return () => { window.removeEventListener(event, callback); window.removeEventListener("storage", callback); }; }
export function useSimpleDisplay() { return useSyncExternalStore(subscribe, simpleDisplay, () => false); }
