# Prompt Forge（提示词工坊）

输入框工具行左侧多一个 `Prompt` 按钮：点一下，把草稿改写成「能直接执行」的提示词；再点一下，在**优化稿**和**原文**之间来回切。

- 宿主半边 `index.js`：HTTP 路由 `POST /promptforge/optimize`，调当前模型完成改写
- 客户端半边 `client.js`：注册到插槽 `conversation.input.left` 的胶囊按钮
- 包名 `dsh-prompt-forge`，是一个 DSH bundle（`dsh.bundle.patch`），自带 Config 设置项

## 它做什么

1. 在输入框写任意草稿（一句话也行）。
2. 点 `Prompt`：调用 profile 默认模型改写，结果写回输入框，按钮变成 `↩ 原文`。
3. 点 `↩ 原文` 切回原措辞；再点 `✦ 优化版` 切回改写稿。
4. 手动改过草稿后，「原文/优化稿」这对缓存自动失效，下一次点击重新改写。

状态：`idle` → `busy`（改写中…）→ `optimized ⇄ original`；错误就地显示，6 秒后消失。

## 改写依据：提示词心法

按钮背后是一份写给改写模型的规则（`index.js` 里的 `DOCTRINE_HEAD` / `DOCTRINE_TAIL` 与 `buildDoctrine()`，可以自行调）。这套规则来自一份个人整理的 AI 使用手册——《AI 使用心法》，它把「怎么让 AI 把活干好」归纳成十来个可以照着做的动作；方法论源头是 Anthropic 官方博客的三篇长文：**《找到你的未知》**（动手前先把「自己不知道什么」找出来）、**《删掉 80%》**（把上下文与要求压缩到真正决定结果的那 20%）、**《更有野心》**（别只要一个能跑的东西，把标准和野心一起抬上去）。

落到提示词改写上，就是下面这几条：

| 心法要点 | 在改写里的落地 |
| --- | --- |
| 判据代替禁令 | 把「不要啰嗦」「写好一点」换成可外部验证的验收标准：条数、字数、必须包含的结构、必须给出的证据 |
| 先找未知再动手 | 判断 / 设计 / 调研类任务，开头要求对方先提 3 个「内行必问、外行想不到」的问题，只问不答 |
| 关键处留白 | 口味、价值取舍、风险偏好这类只有人能拍板的选择，写成「这一项由我决定，先给我选项」 |
| 便宜原型优先 | 大任务先要一个 10 分钟能看完的最小可运行版本，再迭代 |
| 抬一层野心 | 只「做完」不够，同一份交付里再给一个更高标准的版本，或一个被低估的更优解 |
| 上下文五层 | 身份 / 项目 / 能力 / 参考 / 即时；原文缺哪层就用「【待补：…】」占位，不编造 |
| 目标具体且难 | 把「优化一下」「处理一下」这类模糊动词换成可验收的结果描述 |
| 逆向面试 | 动手前先用三个问题面试委托人，把没想到的东西问出来 |

版面：`目标 / 背景与约束 / 验收标准（可外部验证）/ 交付格式 / 先问再答`。只输出提示词正文——不带前言、不带代码围栏（宿主还会再兜底剥一次围栏和「改写后：」这类前缀）。

## 安装

需要一个已安装 DSH、带 Web GUI 的 profile。

```bash
# 1) 先装本包的依赖：Config 的字段 schema 依赖 @deepseek-ai/schemastery
pnpm install

# 2) 把本目录注册成 bundle（把 <本目录> 换成你 clone 下来的绝对路径）
```

第 2 步用 DSH 的插件管理器：`plugin_manager` 的 `install_bundle`，`target` 传本目录的绝对路径。装完在插件列表里应能看到 `dsh-prompt-forge`（`active`），输入框工具行左侧出现 `Prompt` 按钮。

> 如果只想用、不想改代码，也可以先 `pnpm pack` 出 tgz 再装这个 tgz；以目录形式安装时 DSH 会把本目录链接进 profile，改完源码重新安装即可生效。

## 配置

插件详情页会按下面的 schema 生成设置表单（字段都是 live 的，改完立即生效，不用重启）：

| 字段 | 类型 / 默认值 | 作用 |
| --- | --- | --- |
| `model` | string / `''` | 改写用的模型。留空＝跟随 profile 默认模型；也可写 `provider/model` 或只写 `model` |
| `temperature` | number / `0.35` | 改写温度。越低越贴原文，越高越敢重组结构 |
| `askFirst` | boolean / `true` | 「先问再答」开关。关掉后不再要求对方先提问，改为在正文里写出「已知前提」与「仍待确认」各 1–3 条 |
| `extraRules` | string / `''` | 追加到改写规则末尾的额外要求，例如团队自己的交付格式 |

## 接口

`POST /promptforge/optimize`，body `{ "text": "..." }`

```json
{ "ok": true, "value": { "optimized": "...", "provider": "deepseek-account", "model": "deepseek-flash" } }
{ "ok": false, "error": { "code": "empty-draft", "message": "the draft is empty" } }
```

限制：草稿 ≤ 20000 字符，请求体 ≤ 200 KB，单次改写 ≤ 120 秒；非 `POST` 返回 405。

## 为什么这样实现（而不是别的做法）

- **不用 `host.call`**：那是未公开的 package-private RPC；改用宿主 `ctx.webServer.register` + 浏览器同源 `fetch`（文档相对路径 `promptforge/optimize`），跨版本更稳。
- **`conversation.input.left`**：官方声明的「输入框工具行左侧」区，`kind: list`、`replaceRisk: none`；用自己的 id 只会在旁边加一格，不会顶掉别的插件。
- **读写草稿用槽位标准注入的 `useInput` / `inputActions.setDraft`**：不碰编辑器内部实现。
- **按钮自带状态机、不做弹层**：输入框上方弹层可能被容器 `overflow` 裁掉；原地切换草稿既满足「一个按钮来回切」，也没有裁切风险。
- **Config 用 `@deepseek-ai/schemastery`**：与 DSH 设置页同一套 schema 体系，字段声明了 `.volatile()` 才能进表单、并且写值直接提交到运行中的插件引用（不重挂载插件行）。

## 验证记录

- `node --check`：`index.js` / `client.js` 均通过。
- `node --test`：7 个用例全通过（「先问再答」两种正文、Config 默认值读取、模型覆盖）。
- `plugin_manager install_bundle` → `application: applied`、`enabled: true`、`warnings: []`（0.2.0）。
- Config：`Config.listConfigs` 里该行 `status: "schema"`，`model` / `temperature` / `askFirst` / `extraRules` 四个字段都投影进设置表单。
- 插槽实测：`conversation.input.left` 占用者含 `prompt-forge`（order 1100，active）。
- 端到端：输入「帮我写个周末去苏州的行程，两天一夜，带爸妈，不要太累。」→ 返回按心法结构化的改写（先问再答 / 验收标准 / 由我决定），模型 `deepseek-account/deepseek-flash`。

## 后续可加

- 第二个按钮：只产出「未知清单」，不重写全文。
- 同一服务暴露成 agent 工具 `prompt_forge_optimize`，让 agent 也能按心法改写用户给的提示词。
- 把 `DOCTRINE` 外置成可选的规则文件，方便团队共享自己的改写规范。

## License

[MIT](LICENSE)
