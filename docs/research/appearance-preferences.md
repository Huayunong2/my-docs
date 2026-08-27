# 外观偏好调研（2026-08-26）

## 结论

应用当前把深浅色模式留在运行时内存中，刷新后只重新读取系统偏好；强调色则单独写入本地存储。这个行为会让用户以为“主题设置没有保存”。本轮采用三态模式：跟随系统、浅色、深色。用户一旦明确选择浅色/深色就持久化；选择跟随系统时监听 `matchMedia("(prefers-color-scheme: dark)")` 的变化。

## 一手资料与适用原则

- [MDN `prefers-color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-color-scheme)：这是浏览器读取用户/操作系统主题偏好的标准媒体特性，覆盖主流设备和浏览器；“跟随系统”应建立在这个标准上。
- [MDN `color-scheme`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)：`color-scheme` 会影响浏览器表单控件、滚动条等原生 UI；应用支持浅色和深色时应声明 `light dark`，减少控件与页面主题不一致。
- [W3C C39 `prefers-reduced-motion`](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)：用户可以通过系统设置要求减少动态效果，CSS 应尊重该偏好，避免动画成为使用障碍。

## 设计决策

1. 在设置页外观分组增加“显示模式”三选一：跟随系统、浅色、深色；使用 `aria-pressed` 表达当前选择。
2. 侧栏现有“切换深色/浅色”保留，作为快捷操作：当前深色切浅色，当前浅色切深色；它不改变用户已理解的快捷入口。
3. 主题模式写入 `localStorage`，只保存用户偏好，不把系统实时状态写成固定值。
4. `:root` 声明 `color-scheme: light dark`，应用自身仍由 React 的 `.dark` 类控制，以兼容现有 Tailwind 主题 token。
5. 对 CSS 动画和过渡增加 `prefers-reduced-motion: reduce` 覆盖；不新增第三方主题库，也不在本轮重构所有组件的动画实现。
