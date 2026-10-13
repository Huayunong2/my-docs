import { newClientId } from "./clientId";
// Presentation and form validation only. SQLite through the API owns personal facts.
export type ProfileKind = "education" | "work" | "learning" | "project" | "achievement" | "milestone" | "certificate";
export type ProfileView = "overview" | "timeline" | "goals" | "context" | "analyses";
export type ExperienceStatus = "active" | "completed" | "paused" | "planned" | "ended" | "withdrawn";
export type BackgroundPurpose = "general" | "learning" | "resume";
export interface PersonalSource { kind: "article" | "knowledge" | "space" | "external"; targetId: string; title: string; url: string; date: string; available: boolean }
export interface PersonalGoal { id: string; title: string; description: string; status: "active" | "paused" | "completed" | "cancelled"; targetDate: string; nextStep: string; spaceId: string; spaceTitle: string; spaceAvailable: boolean; aiAllowed: boolean; removed: boolean; updatedAt: string }
export interface PersonalAnalysis { id: string; status: "running" | "completed" | "failed"; question: string; content: string; model: string; createdAt: string; profileRevision: number; entryIds: string[]; goalIds: string[]; error: string; imported: boolean; purpose: BackgroundPurpose; includeProfile: boolean; contextText:string; contextFingerprint:string; outdated:boolean }
export interface PersonalSnapshot { revision: number; updatedAt: string; profile: PersonalProfile; entries: PersonalEntry[]; goals: PersonalGoal[]; analyses: PersonalAnalysis[] }
export interface PersonalContextRequest { expectedRevision: number; purpose: BackgroundPurpose; includeProfile: boolean; entryIds: string[]; goalIds: string[] }
export interface PersonalContext { revision: number; text: string; fingerprint:string; entryCount: number; goalCount: number }
export const emptyPersonalProfile = (): PersonalProfile => ({ name:"",direction:"",city:"",bio:"",goal:"",preference:"",email:"",phone:"",website:"",skills:[] });
export const newPersonalGoal = (): PersonalGoal => ({id:"",title:"",description:"",status:"active",targetDate:"",nextStep:"",spaceId:"",spaceTitle:"",spaceAvailable:false,aiAllowed:false,removed:false,updatedAt:""});
export interface PersonalProfile { name: string; direction: string; city: string; bio: string; goal: string; preference: string; email: string; phone: string; website: string; skills: string[] }
export interface PersonalEntry {
  id: string; kind: ProfileKind; title: string; organization: string;
  start: string; end: string; status: ExperienceStatus;
  degree: string; major: string; position: string; role: string; focus: string;
  description: string; result: string; achievementType: "output"|"award"|"publication"; sourceNote: string; sourceUrl: string;
  sources: PersonalSource[]; parentId: string; tags: string[]; updatedAt: string;
  aiAllowed: boolean; removed: boolean;
}
export const profileKinds: Record<ProfileKind, string> = { education: "教育", work: "工作 / 实习", learning: "学习", project: "项目", achievement: "成果", milestone: "里程碑", certificate:"证书 / 资格" };
export const purposeLabels: Record<BackgroundPurpose, string> = { general: "了解我", learning: "学习规划", resume: "求职准备" };
export const statusChoices: Record<ProfileKind, Array<[ExperienceStatus, string]>> = {
  education: [["active", "在读"], ["completed", "已取得学历 / 学位"], ["paused", "暂停"], ["withdrawn", "中断"], ["planned", "计划中"]],
  work: [["active", "在职 / 实习中"], ["ended", "已结束"], ["planned", "计划中"]],
  learning: [["active", "学习中"], ["completed", "已完成"], ["paused", "暂停"], ["planned", "计划中"]],
  project: [["active", "进行中"], ["completed", "已完成"], ["paused", "暂停"], ["ended", "已终止"], ["planned", "计划中"]],
  achievement: [["completed", "已取得"], ["planned", "计划中"]],
  milestone: [["completed", "已发生"], ["planned", "计划中"]],
  certificate: [["completed", "已取得"], ["planned", "计划中"]],
};
export const statusLabel = (item: PersonalEntry) => statusChoices[item.kind].find(([status]) => status === item.status)?.[1] || "状态待确认";
export const experiencePeriod = (item: PersonalEntry) => item.kind === "achievement" || item.kind === "milestone" || item.kind==="certificate" ? (item.start || "日期未知") : `${item.start || "开始时间未知"} → ${item.status === "active" ? "至今" : item.end || (item.status === "planned" ? "计划时间待定" : "结束时间未知")}`;
export const newPersonalEntry = (kind: ProfileKind = "work"): PersonalEntry => ({
  id: "", kind, title: "", organization: "", start: "", end: "", status: kind === "achievement" || kind === "milestone" || kind==="certificate" ? "completed" : "planned",
  degree: "", major: "", position: "", role: "", focus: "", description: "", result: "", achievementType:"output", sourceNote: "", sourceUrl: "", aiAllowed: false, removed: false, sources: [], parentId: "", tags: [], updatedAt: "",
});

/** A partial date denotes an interval. Comparing bounds avoids inventing a month/day. */
export function profileDateBounds(value: string): [number, number] | null {
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) return null;
  if (month === undefined) return [year * 10000 + 101, year * 10000 + 1231];
  if (month < 1 || month > 12) return null;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day === undefined) return [year * 10000 + month * 100 + 1, year * 10000 + month * 100 + days];
  return day >= 1 && day <= days ? [year * 10000 + month * 100 + day, year * 10000 + month * 100 + day] : null;
}
export function safeProfileUrl(value: string): string | null {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function validatePersonalEntry(item: PersonalEntry, today: string): string | null {
  if (!item.title.trim()) return "请填写经历标题";
  if (!statusChoices[item.kind].some(([status]) => status === item.status)) return "请确认该类型的经历状态";
  for (const [label, value] of [["开始", item.start], ["结束", item.status === "active" ? "" : item.end]]) {
    if (value && !profileDateBounds(value)) return `${label}时间请填写有效的年份、年月或日期，例如 2026、2026-07、2026-07-12`;
  }
  const start = profileDateBounds(item.start), end = profileDateBounds(item.end), now = profileDateBounds(today);
  if (start && end && item.status !== "active" && end[1] < start[0]) return "结束时间不能早于开始时间";
  if (start && now && item.status !== "planned" && start[0] > now[1]) return "尚未开始的经历请标为计划中";
  if (end && now && item.status !== "planned" && item.status !== "active" && end[0] > now[1]) return "结束时间尚未到来，请确认经历状态或日期";
  if (item.sourceUrl && !safeProfileUrl(item.sourceUrl)) return "来源链接仅支持不含账号密码的 HTTP 或 HTTPS 地址";
  return null;
}
export function currentPersonalEntries(items: PersonalEntry[], today: string) {
  const now = profileDateBounds(today);
  return items.filter(item => !item.removed && item.status === "active" && (!item.start || (profileDateBounds(item.start)?.[0] ?? Infinity) <= (now?.[1] ?? 0)));
}
export function recommendedBackgroundIds(items: PersonalEntry[], purpose: BackgroundPurpose) {
  return items.filter(item => !item.removed && item.aiAllowed && item.status !== "planned"
    && (purpose === "general" || purpose === "learning" && item.kind !== "work" || purpose === "resume" && item.kind !== "learning" && item.kind !== "milestone"))
    .map(item => item.id);
}
export function selectedBackgroundExperiences(items: PersonalEntry[], selectedIds: string[]) {
  return items.filter(item => !item.removed && item.aiAllowed && selectedIds.includes(item.id));
}
function experienceLines(item: PersonalEntry) {
  const details = item.kind === "education" ? [["学历 / 学位", item.degree], ["专业", item.major]]
    : item.kind === "work" ? [["岗位", item.position]] : item.kind === "project" ? [["个人角色", item.role]] : [["学习方向", item.focus]];
  return [`\n### ${item.title}`, `类型：${profileKinds[item.kind]}；状态：${statusLabel(item)}`, `组织 / 主题：${item.organization || "未填写"}`, `时间：${experiencePeriod(item)}`,
    ...details.filter(([, value]) => value).map(([label, value]) => `${label}：${value}`),
    `经历 / 贡献：${item.description || "未填写"}`, `成果：${item.result || "未填写"}`,
    `依据说明：${item.sourceNote || "未提供；仅为本人填写"}`, ...(item.sourceUrl ? [`来源链接：${safeProfileUrl(item.sourceUrl) || "链接无效"}`] : [])];
}
export function personalBackgroundText(profile: PersonalProfile, items: PersonalEntry[], includeProfile: boolean, purpose: BackgroundPurpose) {
  const lines = [`# 背景说明 · ${purposeLabels[purpose]}`, "以下内容由本人填写；本人填写不代表独立验证。"];
  if (includeProfile) {
    lines.push(`\n## 自我介绍\n称呼：${profile.name}\n关注方向：${profile.direction}\n简介：${profile.bio}`);
    if (purpose !== "resume") lines.push(`\n## 当前目标（意愿）\n${profile.goal || "未填写"}\n\n## 学习偏好与时间限制\n${profile.preference || "未填写"}`);
  }
  if (items.length) lines.push("\n## 所选经历", ...items.flatMap(experienceLines));
  lines.push("\n请区分已有经历、计划与分析建议；信息不足时明确说明，不推断学历、职责或量化成果。");
  return lines.join("\n");
}
export function personalArchiveText(profile: PersonalProfile, items: PersonalEntry[]) {
  return ["# 完整个人档案", "包含所有未移除的经历，也包含未允许选入背景的经历。正式备份与迁移请使用设置中的完整迁移包。",
    `\n## 概况\n称呼：${profile.name}\n关注方向：${profile.direction}\n城市：${profile.city || "未填写"}\n简介：${profile.bio}\n\n## 当前目标\n${profile.goal}\n\n## 学习偏好\n${profile.preference}`,
    ...items.filter(item => !item.removed).flatMap(item => [...experienceLines(item), `背景使用：${item.aiAllowed ? "允许选择" : "不允许"}`])].join("\n");
}

export function personalSourceHref(source: PersonalSource): string | null {
  if (!source.available) return null;
  if (source.kind === "article") return "/today?date=" + encodeURIComponent(source.date);
  if (source.kind === "knowledge") return "/knowledge/" + encodeURIComponent(source.targetId);
  if (source.kind === "space") return "/knowledge?project=" + encodeURIComponent(source.title);
  return safeProfileUrl(source.url);
}
export function resumeData(profile: PersonalProfile, entries: PersonalEntry[], includeContacts: boolean) {
  const actual = entries.filter(entry => !entry.removed && entry.status !== "planned");
  const selectedIds=new Set(actual.map(entry=>entry.id));
  const highlights=(entry:PersonalEntry)=>[...entry.result.split("\n").filter(Boolean),...actual.filter(child=>child.parentId===entry.id&&child.kind==="achievement"&&child.achievementType==="output").map(child=>child.title+(child.result?"："+child.result:""))];
  const projects=actual.filter(entry=>entry.kind==="project" || entry.kind==="achievement"&&(entry.achievementType||"output")==="output"&&!selectedIds.has(entry.parentId));
  return {
    basics: { name:profile.name,label:profile.direction,summary:profile.bio,
      ...(includeContacts ? {email:profile.email,phone:profile.phone,url:profile.website,location:{city:profile.city}} : {}) },
    education: actual.filter(e=>e.kind==="education"||e.kind==="learning").map(e=>({institution:e.organization,area:e.kind==="learning"?e.focus:e.major,studyType:e.kind==="learning"?"学习 / 培训":e.degree + (e.status==="active" ? "（在读）" : ""),startDate:e.start,endDate:e.status==="active" ? undefined : e.end})),
    work: actual.filter(e=>e.kind==="work").map(e=>({name:e.organization,position:e.position||e.title,startDate:e.start,endDate:e.status==="active" ? undefined : e.end,summary:e.description,highlights:highlights(e)})),
    projects: projects.map(e=>({name:e.title,startDate:e.start,endDate:e.status==="active" ? undefined : e.end,description:[e.role,e.description].filter(Boolean).join("："),highlights:highlights(e),url:e.sourceUrl})),
    awards: actual.filter(e=>e.kind==="achievement"&&e.achievementType==="award").map(e=>({title:e.title,date:e.start,awarder:e.organization,summary:e.result||e.description})),
    certificates:actual.filter(e=>e.kind==="certificate").map(e=>({name:e.title,date:e.start,issuer:e.organization,url:e.sourceUrl})),
    publications:actual.filter(e=>e.kind==="achievement"&&e.achievementType==="publication").map(e=>({name:e.title,publisher:e.organization,releaseDate:e.start,summary:e.result||e.description,url:e.sourceUrl})),
    skills: profile.skills.map(name=>({name})),
  };
}
export function parseResumeImport(raw: unknown): {profile:PersonalProfile;entries:PersonalEntry[]} {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw new Error("请选择 JSON Resume 格式的简历文件。");
  const data=raw as Record<string,unknown>;
  const str=(value:unknown)=>typeof value==="string" ? value : "";
  const obj=(value:unknown)=>value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
  const list=(value:unknown)=>Array.isArray(value) ? value.map(obj) : [];
  const basics=obj(data.basics);
  const profile={...emptyPersonalProfile(),name:str(basics.name),direction:str(basics.label),bio:str(basics.summary),email:str(basics.email),phone:str(basics.phone),website:str(basics.url),city:str(obj(basics.location).city),skills:list(data.skills).map(s=>str(s.name)).filter(Boolean)};
  const entries:PersonalEntry[]=[];
  for(const [key,kind] of [["education","education"],["work","work"],["projects","project"],["awards","achievement"],["publications","achievement"],["certificates","certificate"]] as const){
    for(const row of list(data[key])){
      const start=str(row.startDate)||str(row.date)||str(row.releaseDate),end=str(row.endDate);
      const title=str(row.title)||str(row.name)||str(row.institution)||str(row.position);
      if(!title) continue;
      const single=kind==="achievement"||kind==="certificate";
      entries.push({...newPersonalEntry(kind),id:newClientId(),title,achievementType:key==="awards"?"award":key==="publications"?"publication":"output",organization:str(row.institution)||(kind==="work" ? str(row.name) : str(row.awarder)||str(row.issuer)||str(row.publisher)),degree:str(row.studyType),major:str(row.area),position:str(row.position),start,end,status:single ? "completed" : end ? kind==="work" ? "ended" : "completed" : "active",description:str(row.summary)||str(row.description),result:Array.isArray(row.highlights) ? row.highlights.filter((v):v is string=>typeof v==="string").join("\n") : "",sourceNote:"从本人选择的 JSON 简历导入，已通过导入预览确认。",sourceUrl:str(row.url)});
    }
  }
  if(entries.length>200) throw new Error("一次最多导入 200 条经历。");
  if(!profile.name && !entries.length) throw new Error("文件没有可识别的基本资料或经历。");
  return {profile,entries};
}

export function mergePersonalDraft<T extends object>(base:T,local:T,remote:T):{draft:T;conflicts:Array<keyof T>} {
  const draft={...remote};
  const conflicts:Array<keyof T>=[];
  for(const key of Object.keys(local) as Array<keyof T>){
    const unchanged=JSON.stringify(local[key])===JSON.stringify(base[key]);
    if(unchanged)continue;
    const changedRemotely=JSON.stringify(remote[key])!==JSON.stringify(base[key]);
    if(changedRemotely && JSON.stringify(local[key])!==JSON.stringify(remote[key])) conflicts.push(key);
    else draft[key]=local[key];
  }
  return {draft,conflicts};
}
