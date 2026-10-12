import { describe, expect, it } from "vitest";
import { mergePersonalDraft, parseResumeImport, resumeData, currentPersonalEntries, personalArchiveText, personalBackgroundText, newPersonalEntry, profileDateBounds, recommendedBackgroundIds, safeProfileUrl, selectedBackgroundExperiences, validatePersonalEntry } from "./personalProfile";
import type { PersonalProfile, PersonalEntry } from "./personalProfile";

describe("personal profile facts and output boundaries", () => {
  it("preserves partial-date precision and validates real calendar dates", () => {
    expect(profileDateBounds("2026")).toEqual([20260101, 20261231]);
    expect(profileDateBounds("2024-02")).toEqual([20240201, 20240229]);
    expect(profileDateBounds("2024-02-29")).toEqual([20240229, 20240229]);
    for (const date of ["0000", "2026-02-29", "2026-13", "2026-04-31", "2026-2", "today"]) expect(profileDateBounds(date)).toBeNull();
  });
  it("allows uncertain overlapping ranges but rejects impossible ordering and future current status", () => {
    const item = { ...newPersonalEntry(), title: "实习", status: "ended" as const, start: "2026", end: "2026-02" };
    expect(validatePersonalEntry(item, "2026-10-12")).toBeNull();
    expect(validatePersonalEntry({ ...item, start: "2026-03", end: "2026-02" }, "2026-10-12")).toContain("早于");
    expect(validatePersonalEntry({ ...item, start: "2027", status: "active", end: "" }, "2026-10-12")).toContain("计划中");
    expect(validatePersonalEntry({ ...item, end: "2027" }, "2026-10-12")).toContain("尚未到来");
    expect(currentPersonalEntries([{ ...item, status: "active", start: "2027" }], "2026-10-12")).toEqual([]);
    expect(validatePersonalEntry({ ...item, start: "2026-03", status: "active", end: "not a date" }, "2026-10-12")).toBeNull();
  });
  it("uses kind-specific status and denies unsafe evidence links", () => {
    const item = { ...newPersonalEntry("education"), title: "教育", status: "ended" as const };
    expect(validatePersonalEntry(item, "2026-10-12")).toContain("状态");
    for (const url of ["javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com", "not-a-url"]) expect(safeProfileUrl(url)).toBeNull();
    expect(safeProfileUrl("https://example.com/project")).toBe("https://example.com/project");
  });
  it("keeps private and removed facts out of background even with stale selected IDs", () => {
    const { profile, experiences } = profileTestSeed();
    const privateItem = { ...newPersonalEntry(), id: "private", title: "私人经历" };
    const removedItem = { ...experiences[0], id: "removed", title: "已移除经历", removed: true };
    const items = [...experiences, privateItem, removedItem];
    const selected = selectedBackgroundExperiences(items, items.map(item => item.id));
    const background = personalBackgroundText(profile, selected, true, "learning");
    expect(background).not.toContain("私人经历");
    expect(background).not.toContain("已移除经历");
    const archive = personalArchiveText(profile, items);
    expect(archive).toContain("私人经历");
    expect(archive).not.toContain("已移除经历");
    expect(archive).not.toContain("请区分");
  });
  it("recommends by purpose, excludes plans and keeps study preferences out of career output", () => {
    const { profile, experiences } = profileTestSeed();
    const plan = { ...experiences[0], id: "future", status: "planned" as const };
    expect(recommendedBackgroundIds([...experiences, plan], "learning")).not.toContain("demo-work");
    expect(recommendedBackgroundIds([...experiences, plan], "general")).not.toContain("future");
    const resume = personalBackgroundText(profile, experiences, true, "resume");
    expect(resume).not.toContain(profile.preference);
    expect(resume).toContain("本科 / 学士");
    expect(resume).toContain("2022 → 2026-06");
  });
});

function profileTestSeed(): { profile: PersonalProfile; experiences: PersonalEntry[] } {
  return {
    profile: { name: "林知远", direction: "后端开发 · 系统编程", city: "杭州", bio: "喜欢把问题拆解清楚，把学到的东西做成能用的小工具。正在从课程学习走向独立完成项目。", goal: "未来三个月完成一个可部署的 Rust 项目，整理作品与技术文章。", preference: "每周约 8 小时；先看例子再理解原理；建议拆成一周内可以验证的步骤。", email:"",phone:"",website:"",skills:[] },
    experiences: [
      { ...newPersonalEntry("project"), id: "demo-project", title: "个人知识工作台", organization: "个人项目", start: "2026-07", status: "active", role: "独立设计与开发", description: "连接今日记录、知识条目和记忆复习。", result: "完成记录与知识浏览流程，整理部署说明。", sourceNote: "虚构示例：项目说明与阶段记录，尚未关联真实项目空间。", aiAllowed: true },
      { ...newPersonalEntry("learning"), id: "demo-learning", title: "Rust 与服务端开发", organization: "自学 · 项目实践", start: "2026-04", status: "active", focus: "所有权、异步编程、HTTP API、SQLite", description: "通过小项目检验理解，保留调试和设计笔记。", result: "实现带输入校验的 HTTP API。", sourceNote: "虚构示例：学习笔记。", aiAllowed: true },
      { ...newPersonalEntry("work"), id: "demo-work", title: "后端开发实习", organization: "示例科技公司", start: "2025-07", end: "2025-12", status: "ended", position: "后端开发实习生", description: "参与内部工具开发、接口联调和问题排查。", result: "交付内部查询页面，补充接口使用说明。", sourceNote: "虚构示例：实习阶段回顾。", aiAllowed: true },
      { ...newPersonalEntry("education"), id: "demo-education", title: "本科阶段", organization: "示例大学", start: "2022", end: "2026-06", status: "completed", degree: "本科 / 学士", major: "计算机科学与技术", description: "学习数据结构、操作系统、数据库和软件工程。", result: "完成毕业设计与论文。", sourceNote: "虚构示例：毕业材料，仅用于展示。", aiAllowed: true },
    ],
  };
}

describe("real profile interoperability and merge", () => {
  it("merges non-overlapping remote changes and exposes conflicting user fields",()=>{
    const base={name:"本人",bio:"原简介",city:"原城市"};
    const local={...base,bio:"本地简介"};
    const remote={...base,city:"另一设备城市"};
    expect(mergePersonalDraft(base,local,remote)).toEqual({draft:{name:"本人",bio:"本地简介",city:"另一设备城市"},conflicts:[]});
    const conflict=mergePersonalDraft(base,local,{...remote,bio:"另一设备简介"});
    expect(conflict.conflicts).toEqual(["bio"]);
    expect(conflict.draft.bio).toBe("另一设备简介");
  });
  it("keeps contact fields opt-in and does not convert ordinary outcomes into awards",()=>{
    const {profile,experiences}=profileTestSeed();
    const cv=resumeData({...profile,email:"private@example.invalid"},experiences,false);
    expect(cv.basics).not.toHaveProperty("email");
    expect(cv.awards).toEqual([]);
    expect(resumeData({...profile,email:"private@example.invalid"},experiences,true).basics.email).toBe("private@example.invalid");
  });
  it("imports standard credentials and awards as distinct types with fresh IDs and no AI permission",()=>{
    const parsed=parseResumeImport({basics:{name:"本人"},certificates:[{name:"技术资格",date:"2020",issuer:"颁发机构"}],awards:[{title:"真实奖项",date:"2021",awarder:"主办方"}]});
    expect(parsed.entries.map(e=>e.kind)).toEqual(["achievement","certificate"]);
    expect(parsed.entries[0].achievementType).toBe("award");
    expect(parsed.entries[1].organization).toBe("颁发机构");
    expect(parsed.entries.every(e=>!e.aiAllowed)).toBe(true);
    expect(new Set(parsed.entries.map(e=>e.id)).size).toBe(2);
  });
});
