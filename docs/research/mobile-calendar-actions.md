# 移动端月历操作入口调研（2026-08-26）

## 结论

当前月历把“点击日期编辑”和右上角状态图标叠在同一个日期格中。桌面端可以依靠 hover 和较大的可视空间理解这个操作，但移动端会把整格点击直接带到编辑页，日期状态入口只剩一个小图标，容易让“请假/休息”等功能不可发现。

本轮采用“移动端点击日期先打开操作 Sheet，明确选择编辑记录或设置日期状态；桌面端继续整格编辑、保留独立状态按钮”的渐进方案。Sheet 使用仓库已有的 Radix Dialog 原语，不新增 UI 框架；底部布局适合拇指操作，并通过 `Dialog.Title`、`Dialog.Description` 和焦点管理保持无障碍语义。

## 一手资料与适用原则

- [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog)：Dialog 会让底层内容 inert，支持焦点捕获、Esc 关闭、标题/描述的屏幕阅读器播报；适合作为移动端日期操作 Sheet 的无障碍基础。
- [React DayPicker accessibility](https://daypicker.dev/v8/using-daypicker/accessibility)：日期选择器应保留键盘导航、焦点管理和可读标签；本月历是业务自绘日期格，因此操作按钮必须提供清晰的 `aria-label`，不能只依赖颜色或图标。
- [React DayPicker custom components](https://daypicker.dev/guides/custom-components)：自定义日期内容时应转发 `aria-*`、`tabIndex`、`ref` 和事件；本项目不重写 DayPicker 的日期选择器，只在业务月历外层增加动作入口，避免破坏已有键盘语义。

## 设计决策

1. 移动端日期格的主点击动作改为“打开日期操作”，Sheet 中用至少一行高度的按钮明确列出“编辑记录”和“设置/编辑日期状态”。
2. 有记录的日期只显示编辑动作；无记录日期同时显示状态动作，避免诱导用户给已有记录设置豁免状态。
3. 桌面端保持当前高密度月历：整格编辑，右上角状态按钮只在无记录日期显示。
4. 状态按钮的文案仍以“请假、休息、生病、出差、其他”为主，颜色只是辅助信息；保存逻辑和后端契约不变。
5. 本轮不引入新的日期库或全量重写月历，先用已安装的 Radix Dialog 完成低风险入口修复。
