# Prompt Forge（提示词工坊）

按 `D:\Deepseek Harness Workspace\日常使用\AI使用心法\` 的标准改写输入框里的提示词：输入框左侧一个胶囊按钮，点一下把草稿改写成「心法版」，再点一下在**优化后**和**原文**之间来回切。

- 宿主半边：`index.js`（HTTP 路由 `/promptforge/optimize`）
- 客户端半边：`client.js`（注册到插槽 `conversation.input.left`）
- 包名：`dsh-prompt-forge`，已在 profile `desktop` 中安装并启用

## 用法

1. 在输入框写任意草稿（一句话也行）。
2. 点左侧 `✦ 优化提示词`：调用当前 profile 默认模型（`deepseek-account / deepseek-flash`）改写，写回输入框，按钮变成 `↩ 原文`。
3. 点 `↩ 原文` 切回你原来的措辞；再点 `✦ 优化版` 切回改写版。
4. 手动编辑草稿后，缓存的「原文/优化版」对自动失效，下一次点击重新优化。

状态：`idle` → `busy`（优化中…）→ `optimized` ⇄ `original`；错误就地显示 6 秒后消失。

## 改写规范（宿主 `DOCTRINE`）

| 心法要点 | 在改写里的落地 |
| --- | --- |
| 判据代替禁令 | 把「不要啰嗦」换成可外部验证的验收标准（条数/字数/必须包含的结构/证据） |
| 先找未知再动手 | 判断类任务开头要求「先问三个内行必问、外行想不到的问题，只问不答」 |
| 关键处留白 | 价值取舍写成「这一项由我决定，先给我选项」 |
| 便宜原型优先 | 大任务先要 10 分钟能看完的最小版本 |
| 抬一层野心 | 同一份交付里再给一个更高标准的版本 |
| 上下文五层 | 身份/项目/能力/参考/即时缺失处用「【待补：…】」占位，不编造 |
| 目标具体且难 | 模糊动词换成可验收结果 |
| 逆向面试 | 动手前用三个问题面试委托人 |

版面：`目标 / 背景与约束 / 验收标准 / 交付格式 / 先问再答`；只输出提示词正文，不带前言、不带代码围栏（宿主会再兜底剥一次围栏与「改写后：」前缀）。

## 接口

`POST /promptforge/optimize`，body `{ "text": "..." }`

```json
{ "ok": true, "value": { "optimized": "...", "provider": "deepseek-account", "model": "deepseek-flash" } }
{ "ok": false, "error": { "code": "empty-draft", "message": "the draft is empty" } }
```

限制：草稿 ≤ 20000 字符，请求体 ≤ 200KB，单次改写 ≤ 120 秒；`GET` 返回 405。

## 为什么这样实现（而不是别的做法）

- **不用 `host.call`**：那是未公开的 package-private RPC；改用宿主 `ctx.webServer.register` + 浏览器同源 `fetch`，与已装的 git-graph 插件同一套路，跨版本更稳。
- **`conversation.input.left`**：官方声明的「输入框工具行左侧」区，`kind: list`、`replaceRisk: none`，新 id 只会在旁边加一格，不会顶掉别的插件。
- **读写草稿用标准注入的 `useInput` / `inputActions.setDraft`**：与 `dsh-mnemon-source-skills` 的 `SkillUseBridge` 同一 API，不碰编辑器内部实现。
- **按钮自带状态机、不做弹层**：输入框上方弹层可能被容器 `overflow` 裁掉，无法在本机目视验证；原地切换草稿文本既满足「一个按钮来回切」，也没有裁切风险。

## 验证记录（2026-10-24）

- `node --check`：`index.js` / `client.js` 均通过。
- `plugin_manager install_bundle` → `application: applied`、`enabled: true`、`warnings: []`。
- 插槽实测：`conversation.input.left` 占用者含 `prompt-forge`（order 1100，active）。
- 端到端：`POST /promptforge/optimize` 输入「帮我写个周末去苏州的行程，两天一夜，带爸妈，不要太累。」→ 返回按心法结构化的改写（先问再答 / 验收标准 / 由我决定），模型 `deepseek-account/deepseek-flash`。

## 后续可加

- `Config`：模型覆盖、温度、开关「是否先问再答」。
- 第二个按钮：只给「未知清单」不重写全文。
- 同一服务暴露成 agent 工具 `prompt_forge_optimize`，让 agent 也能按心法改写用户给的提示词。
