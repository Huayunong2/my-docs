import { describe, expect, it } from "vitest";
import { parseKnowledgeCardImport, parseKnowledgeCardMarkdownImport, parseKnowledgeCardTextImport } from "./knowledgeImport";

describe("parseKnowledgeCardImport", () => {
  it("accepts a fenced cards object and normalizes interview aliases", () => {
    const result = parseKnowledgeCardImport(`
      \`\`\`json
      {"cards":[{"question":"什么是 RAII？","answer":"让资源生命周期绑定对象生命周期。","tags":"C++, 资源管理"}]}
      \`\`\`
    `);

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].card).toMatchObject({
      card_type: "fact",
      title: "什么是 RAII？",
      content: "让资源生命周期绑定对象生命周期。",
      tags: ["C++", "资源管理"],
    });
  });

  it("keeps valid rows visible when one row is invalid", () => {
    const result = parseKnowledgeCardImport(JSON.stringify({
      cards: [
        { title: "有效卡片", content: "这是一条可以复习的内容。", card_type: "method" },
        { title: "缺正文", card_type: "fact" },
      ],
    }));

    expect(result.rows[0].card?.card_type).toBe("method");
    expect(result.rows[1].error).toContain("content");
  });

  it("returns recovery-oriented errors for malformed top-level input", () => {
    expect(parseKnowledgeCardImport("not json").error).toContain("JSON 格式无法解析");
    expect(parseKnowledgeCardImport('{"items":[]}').error).toContain("cards 数组");
  });

  it("parses card markdown blocks and keeps metadata out of the body", () => {
    const result = parseKnowledgeCardMarkdownImport(`
      ## 什么是 RAII？
      RAII 让资源的生命周期绑定对象生命周期，适合管理需要成对释放的资源。

      标签：C++, 资源管理
      空间：C++ 基础
      来源：让资源的生命周期绑定对象生命周期

      ## 什么时候使用原子替换？
      先写入临时文件，完成后再替换目标文件。
      类型：方法
    `);

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].card).toMatchObject({
      title: "什么是 RAII？",
      tags: ["C++", "资源管理"],
      projects: ["C++ 基础"],
      source_excerpt: "让资源的生命周期绑定对象生命周期",
    });
    expect(result.rows[0].card?.content).not.toContain("标签：");
    expect(result.rows[1].card?.card_type).toBe("method");
  });

  it("requires a title when plain text is imported as one card", () => {
    expect(parseKnowledgeCardTextImport("正文", "").error).toContain("标题");
    expect(parseKnowledgeCardTextImport("正文", "一个事实").rows[0].card?.content).toBe("正文");
  });

  it("counts Unicode characters consistently at the card limits", () => {
    const accepted = parseKnowledgeCardTextImport("正文", "😀".repeat(160));
    const rejected = parseKnowledgeCardTextImport("正文", "😀".repeat(161));

    expect(accepted.rows[0].card?.title).toHaveLength(320);
    expect(accepted.error).toBeUndefined();
    expect(rejected.error).toContain("160");
  });
});
