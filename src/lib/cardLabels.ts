import type { KnowledgeCardStatus, KnowledgeCardType } from "./api";

export const cardTypeLabels: Record<KnowledgeCardType, string> = {
  fact: "事实",
  method: "方法",
  concept: "概念",
  decision: "决策",
  case: "案例",
  quote: "表述",
  principle: "原则",
};

export const cardStatusLabels: Record<KnowledgeCardStatus, string> = {
  draft: "待确认",
  confirmed: "已沉淀",
  outdated: "已过时",
};

export const reviewStateLabels: Record<string, string> = {
  new: "新卡",
  learning: "学习中",
  mature: "已掌握",
};
