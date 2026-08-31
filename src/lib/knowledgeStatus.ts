import type { KnowledgeCardStatus } from "./api";

/** Return the next safe lifecycle state for a knowledge entry's quick action. */
export function nextKnowledgeCardStatus(status: KnowledgeCardStatus): KnowledgeCardStatus {
  return status === "draft" || status === "outdated" ? "confirmed" : "outdated";
}
