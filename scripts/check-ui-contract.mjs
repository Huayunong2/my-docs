// Enforce the visible-control contract for existing and future business pages.
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const root=path.resolve(fileURLToPath(new URL("..",import.meta.url)));
const failures=[];
async function scan(directory){
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()){if(file!==path.join(root,"src/components/ui"))await scan(file);continue;}
  if(!entry.name.endsWith(".tsx")||entry.name.endsWith(".test.tsx"))continue;
  const source=await fs.readFile(file,"utf8"),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const literal=(node,name)=>{const a=node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)===name);return a?.initializer&&ts.isStringLiteral(a.initializer)?a.initializer.text:"";};
  const visit=node=>{
   if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
    const tag=node.tagName.getText(tree),type=literal(node,"type");let reason="";
    if(tag==="form"&&!node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)==="noValidate"))reason="表单通过应用内校验与错误反馈处理，不使用浏览器默认校验弹窗";
    if(["select","option","textarea"].includes(tag))reason="使用 ui/ 中的 SelectField/SelectItem 或 Textarea";
    if(tag==="input"&&!(type==="file"&&/\b(hidden|sr-only)\b/.test(literal(node,"className"))))reason="可见字段使用 Input、Checkbox、Radio 或日期选择器；系统文件入口必须隐藏";
    if(["Input","Field"].includes(tag)&&["date","datetime-local","time","month","week","checkbox","radio"].includes(type))reason="使用对应的共享选择组件，避免浏览器默认控件";
    if(reason){const {line}=tree.getLineAndCharacterOfPosition(node.getStart(tree));failures.push(`${path.relative(root,file)}:${line+1}: ${reason}`);}
   }
   ts.forEachChild(node,visit);
  };visit(tree);
 }
}
await scan(path.join(root,"src/components"));
if(failures.length){console.error(failures.join("\n"));process.exitCode=1;}else console.log("UI control contract passed: business pages use shared controls; only hidden file inputs remain.");
