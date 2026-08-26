# Agent Note: Web 客户端稳定视口契约（--app-height / --app-width）

Status: implemented

[English](2026-08-26-stable-viewport-contract.md) | 中文

## Problem

会话滚动到底部时出现布局跳动、底部留白和弹层越出视口。四个独立原因叠加：

1. `html, body, #root` 以 `100vh` 定尺寸时解析的是 *layout* viewport,在移动端 Safari 和 Android Chrome 上包含地址栏下方区域。地址栏每次收合都让整个文档重排。
2. `AppFrame` 中列网格缺少 `min-height: 0`,网格项默认的 `min-height: auto` 拒绝收缩到内容高度以下,把 composer 推出可视区,而不是让转录区滚动。
3. 九处 client CSS 携带 `100vh`/`60vh` 式字面量(模态、面板、代码查看器),在同批事件上各自重排。
4. 触发式弹层(Menu、ModelSelect、SubagentHeaderLineage、JobListAction、MessageFeedbackActions)以 `calc(100dvh - N)` 封顶——一个无条件上限,不知道触发器在哪。距视口底 5px 的触发器仍允许 `(100dvh - N)` 高的菜单,越过选这个单位本来想尊重的边缘。

## Decision

两层,各对应一类原因。

**壳层钉扎。** `packages/client/web/src/viewport.ts`(`installStableViewport`,在 `AppWebEntry.run()` 顶部运行,首帧即稳定)把 `visualViewport.{height,width}`(回退 `inner{Height,Width}`)写入 `:root` 的 `--app-height` 与 `--app-width`,在 resize/orientationchange 上重绑。`base.css` 在挂载链上读 `height: var(--app-height, 100dvh)`;`100%` 为不支持动态单位的引擎收尾。`AppFrame` 网格列带 `min-height: 0`。

**触发器感知钳制。** `packages/client/ui-primitives/src/useAvailableHeight.ts` 量取触发器边缘到视口边缘的可用空间(`side: 'top' | 'bottom' | 'right'`,`visualViewport.height ?? innerHeight`,在 resize 和捕获阶段 scroll 上重量),返回 px 数值。五个触发式弹层把它内联写为 `--menu-max-height`;其 CSS 读 `max-height: var(--menu-max-height, <原设计上限>)`,回退覆盖预测量首帧,无 hook 的引擎保持旧上限。hook 必须在所有条件性早返回(`return null` 路径)之前运行——违反 hooks 规则是本设计在同一变更内引入并修掉的唯一回归。

居中模态(SettingsRoot、OnboardingModal、ImageLightbox、RiskConfirmation)只做单位迁移:它们不随触发器移动,`calc(var(--app-height, 100dvh) - N)` 对它们就是正确上限。

**契约与门禁。** client CSS Modules 不得使用任何数值型 layout-viewport 单位——`100vh`、`50vw`、`52vh`、`100svh`……全部禁止;分数写作 `calc(var(--app-height, 100dvh) * 0.6)`。裸 `dvh`/`dvw` 允许(动态单位原生跟踪同样事件)。`scripts/verify-client-viewport-units.ts`(接入 `pnpm run hygiene`)以逐文件 line:column 报告强制该集合,新装的 UI 插件无法静默重新引入跳动。`packages/client/AGENTS.md` 记录契约。

`html/body/#root` 挂载链**保持宽度不钉扎**:pinch-zoom 期间 `visualViewport.width` 比 layout viewport 窄,把文档钳到它会让全部内容重排。`--app-width` 只被弹层/面板 CSS 消费——恰好需要贴合可视区的表面。

## Alternatives considered

- **只用 `100dvh`,不做 JS 钉扎**——放弃:多数引擎上 `dvh` 忽略软键盘,而键盘弹出时 composer 必须收缩;来自 `visualViewport` 的 JS 钉扎是唯一跟踪它的来源。
- **纯 CSS 弹层上限(`calc(100dvh - N)`)**——作为既有设计的失败模式被放弃:不知道触发器位置的上限无法约束触发式表面;只有测量可以。
- **复用 `useAnchoredMaxHeight`**——放弃:它是底部锚定(只对视口底封顶),对屏上任意位置的触发器语义错误;`useAvailableHeight` 按各 side 从真实触发器矩形计算空间。
- **用 `--app-width` 钳挂载链宽度**——放弃:pinch-zoom 会通过一个比 layout viewport 窄的变量让整个文档重排;仅弹层消费把影响半径留在需要该上限的表面上。
- **`@supports (height: 100dvh)` 渐进增强**——在 RiskConfirmation 里发现它仍存活后被放弃:该块位于迁移后规则之后、同特异性,在每个 dvh 引擎上静默废掉 `var(--app-height, …)`,迁移在那里从未生效。一条链,不要覆盖块。

## Consequences

- 代价:`:root` 上一个必须在首帧前启动的 JS 钉扎 style 元素;每个触发式弹层一个必须先于早返回的 hook;此后所有 client CSS 用两个自定义属性而非熟悉的视口单位定尺寸。
- 换来:文档高度对地址栏和键盘事件惰性;网格列收缩而不是把 composer 推出屏幕;弹层不论触发器在哪都钳在可视区内,两个轴都是;门禁让契约在新插件和贡献者漂移下存活。
- 在底部附近打开的弹层现在从触发器向下内部滚动而不是溢出——视觉上是更小的菜单,这是有意的行为变更;预测量首帧仍显示旧设计上限一帧。
- 分数上限(`52vh`、`50vw`)迁移为 `calc(var(--app-*) * n)` 表达式;它们对钉扎的 px 值求值,不再跳动,代价是 CSS 源码里的 `var()` 间接。

## Testing

`packages/client/ui-primitives/tests/use-available-height.client.spec.ts`(jsdom)按 side 钉住 hook 数学、cap 优先级、`innerHeight` 回退与非负性。`apps/web/tests/viewport-height.e2e.ts`(浏览器道)钉住挂载后的 `--app-height` 并断言模型选择弹层底边留在其内。`pnpm run verify-client-viewport-units` 证明 CSS 面干净(106 文件)并拒绝植入的 `50vh`/`30vw` 样本。