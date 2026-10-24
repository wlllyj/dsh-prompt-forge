# Prompt Forge（提示词工坊）

给 DSH 的输入框加一个 `✦ Prompt` 按钮：点开一个面板，把你的草稿按「提示词心法」改写成能直接执行的提示词，或者先列出你没考虑到的未知。**改写结果不会自动覆盖草稿**——它按段/按条列出来，你勾选要用的部分，再决定「替换草稿」还是「追加到末尾」。

同一个改写能力还作为 agent 工具 `prompt_forge_optimize` 暴露给模型，agent 也能按同一套规则处理你给的提示词。

## 它做什么

1. 在输入框里写草稿，一句话也行。
2. 点工具行左侧的 `✦ Prompt`：输入框上方展开面板，两个页签——`改写提示词` / `未知清单`。
3. 点 `生成改写`（或 `扫描未知`），等模型返回。
4. 结果按行列出：改写稿按小节分（`目标`、`背景与约束`、`验收标准`……），未知清单按问题分。每行有勾选框，默认全选。
5. 调整勾选 → 点 `替换草稿`（只把选中的部分写进输入框）或 `追加到末尾`（接在你原有文字后面）。点 `关闭` 收起面板，草稿保持不动。

面板只读你的草稿：不点「替换/追加」，输入框里的文字一个字符都不会变。

## 改写依据：提示词心法

规则写在 [`doctrine.md`](doctrine.md)，由它驱动改写模型。这套规则来自一份个人整理的 AI 使用手册——《AI 使用心法》，把「怎么让 AI 把活干好」归纳成十来个可以照着做的动作；方法论源头是 Anthropic 官方博客的三篇长文：**《找到你的未知》**（动手前先把「自己不知道什么」找出来）、**《删掉 80%》**（把上下文与要求压缩到真正决定结果的那 20%）、**《更有野心》**（别只要一个能跑的东西，把标准和野心一起抬上去）。

落到提示词改写上，就是下面这几条：

| 心法要点 | 在改写里的落地 |
| --- | --- |
| 判据代替禁令 | 把「不要啰嗦」「写好一点」换成可外部验证的验收标准：条数、字数、必须包含的结构、必须给出的证据 |
| 先找未知再动手 | 改写稿开头单独一节，要求对方先提 3 个「内行必问、外行想不到」的问题，只问不答；可用 `askFirst` 关掉，改为写出「我推断的前提」与「仍需确认的点」 |
| 关键处留白 | 口味、价值取舍、风险偏好这类只有人能拍板的选择，写成「这一项由我决定，先给我选项」 |
| 便宜原型优先 | 大任务先要一个 10 分钟能看完的最小可运行版本，再迭代 |
| 抬一层野心 | 只「做完」不够，同一份交付里再给一个更高标准的版本，或一个被低估的更优解 |
| 上下文五层 | 身份 / 项目 / 能力 / 参考 / 即时；原文缺哪层就用「【待补：…】」占位，不编造 |
| 目标具体且难 | 把「优化一下」「处理一下」这类模糊动词换成可验收的结果描述 |
| 逆向面试 | 动手前先用三个问题面试委托人，把没想到的东西问出来 |

版面：主体是 `目标 / 背景与约束 / 未知与待确认 / 验收标准（可外部验证） / 交付格式`，开头另加一节讲「未知」怎么写（随 `askFirst` 切换措辞）；原文很短时不强行套满标题，但验收标准与「未知与待确认」必须有。只输出提示词正文——不带前言、不带代码围栏（宿主还会再兜底剥一次围栏和「改写后：」这类前缀）。

### 改规则（不用改代码）

`doctrine.md` 每次请求都会重新读，改完存盘立刻生效：

- 直接改仓库里的 `doctrine.md`，fork / PR 都行；
- 或者把规则放进团队自己的规范仓库，在设置里把 `doctrinePath` 指过去（绝对路径，或相对插件目录的路径）。

`index.js` 里的 `BUILTIN_DOCTRINE` 是文件缺失时的兜底副本；`node --test` 会校验它和 `doctrine.md` 逐字一致——改完规则文件记得同步一下兜底。

## 安装

需要一个已安装 DSH、带 Web GUI 的 profile。

```bash
# 1) 先装本包的依赖：Config 的字段 schema 依赖 @deepseek-ai/schemastery
pnpm install
```

```text
# 2) 把本目录注册成 bundle
plugin_manager → action: install_bundle → target: <本目录的绝对路径>
```

装完在插件列表里应能看到 `dsh-prompt-forge`（`active`），**刷新一次页面**，输入框工具行左侧会出现 `✦ Prompt`。

> 以目录形式安装时 DSH 会把本目录链接进 profile：改完源码重新 `install_bundle` 即可生效，不需要重启应用。也可以先 `pnpm pack` 出 tgz 再装，适合只使用、不改代码的场景。

## 配置

插件详情页会按下面的 schema 生成设置表单（字段都是 live 的，改完立即生效）：

| 字段 | 类型 / 默认值 | 作用 |
| --- | --- | --- |
| `model` | string / `''` | 生成用的模型。留空＝跟随 profile 默认模型；也可写 `provider/model` 或只写 `model` |
| `temperature` | number / `0.35` | 温度。越低越贴原文，越高越敢重组结构 |
| `askFirst` | boolean / `true` | 「先问再答」开关。关掉后不再要求对方先提问，改为在正文里写出「已知前提」与「仍待确认」各 1–3 条 |
| `extraRules` | string / `''` | 追加到改写规则末尾的额外要求，例如团队自己的交付格式 |
| `doctrinePath` | string / `''` | 自定义规则文件。留空＝用插件自带的 `doctrine.md`；可填绝对路径或相对插件目录的路径 |

## 接口与工具

两条路由，body 都是 `{ "text": "..." }`，返回的 `parts` 就是面板里一行一条的数据（前端只负责勾选和拼接）：

```jsonc
// POST /promptforge/optimize  → 按小节切开
{ "ok": true, "value": {
  "text": "…完整改写稿…",
  "parts": [ { "heading": null, "body": "先问再答：…" }, { "heading": "目标", "body": "…" } ],
  "provider": "deepseek-account", "model": "deepseek-flash" } }

// POST /promptforge/unknowns  → 按编号问题切开
{ "ok": true, "value": {
  "text": "1. …——为什么",
  "parts": [ { "heading": null, "body": "1. …——为什么" }, { "heading": null, "body": "2. …" } ],
  "provider": "…", "model": "…" } }

// 失败
{ "ok": false, "error": { "code": "empty-draft", "message": "the draft is empty" } }
```

限制：草稿 ≤ 20000 字符，请求体 ≤ 200 KB，单次调用 ≤ 120 秒；非 `POST` 返回 405。

agent 工具 `prompt_forge_optimize`：

| 参数 | 说明 |
| --- | --- |
| `prompt`（必填） | 要处理的原始提示词 |
| `mode` | `prompt`（默认，完整改写）/ `unknowns`（只列未知） |

返回 `{ ok, mode, text, provider, model }`；参数为空或调用失败时返回 `{ ok: false, code, message }`，模型可据此自我修正。

## 为什么这样实现（而不是别的做法）

- **只做一个按钮，两个页签**：输入框工具行很窄，塞两个胶囊会挤掉别的插件；面板里放页签，功能不少，占地不变。
- **改写结果不自动回填**：改写是一种重写，接不接、接哪几段该由人决定。所以结果按 `parts` 列成可勾选的行，`替换` / `追加` 是两个显式动作。
- **切段放在宿主做**：`splitSections` / `splitItems` 在 `index.js` 里，浏览器只渲染 `parts`。逻辑可被 `node --test` 覆盖，客户端保持薄。
- **面板放 `conversation.input.dock`**：官方声明为「composer 卡片上方的整宽条目」，是唯一有纵向空间放多行文本的槽位；胶囊按钮里塞不下 5 行问题。
- **两个槽位之间用模块级 store 通信**：按钮与面板是同一次 `apply()` 里注册的两个组件，没有共同父级可传 props，模块级 store + `useState` 订阅最省事，也不依赖未公开的 client service。
- **读写草稿用槽位标准注入的 `useInput` / `inputActions.setDraft`**：不碰编辑器内部实现。
- **样式只用官方主题 token**（`--dsw-alias-bg-layer-*`、`--dsw-alias-border-l1`、`--dsw-alias-brand-primary` 等 14 个之一），不写死颜色，浅色/深色主题都对。
- **不用 `host.call`**：那是未公开的 package-private RPC；改用宿主 `ctx.webServer.register` + 浏览器同源 `fetch`（文档相对路径 `promptforge/optimize`），跨版本更稳。
- **`conversation.input.left` 用自己的 id**：`kind: list`、`replaceRisk: none`，只会在旁边加一格，不会顶掉别的插件。
- **Config 用 `@deepseek-ai/schemastery`**：与 DSH 设置页同一套 schema 体系；字段声明 `.volatile()` 才能进表单，并且写值直接提交到运行中的插件引用（不重挂载插件行）。
- **空答案重试一次**：推理型模型偶尔把预算全花在 reasoning 上、正文为空；`streamOnce` 会翻倍 `maxTokens` 并去掉 `reasoningEffort` 再试一次，避免面板里出现空白。
- **规则外置成 `doctrine.md` 而不是写死在代码里**：改写标准属于团队知识，不属于代码；外置后改规则不用发版，也能被 diff 审阅。

## 验证记录

- `node --test`：19 个用例全通过（两种「未知」段、规则文件加载与兜底、追加要求拼接、切段/切条、工具 schema 与拒绝路径、模型覆盖等）。
- `plugin_manager install_bundle` → `application: applied`、`enabled: true`、`warnings: []`。
- 插槽实测：`conversation.input.left` 有 `prompt-forge`（order 1100），`conversation.input.dock` 有 `prompt-forge-panel`（order 130），均 `active`。
- Config：`Config.listConfigs` 里该行 `status: "schema"`，五个字段都投影进设置表单。
- 工具：`Tool.listTools` 里出现 `prompt_forge_optimize`。
- 端到端：`/promptforge/optimize` 返回带 `parts` 的分节改写；`/promptforge/unknowns` 返回带 `parts` 的编号问题列表。

## 已知限制

- 改写是单次调用，没有流式打字效果；长文本只能等结果。
- 面板高度上限 `46vh`，很长的改写稿要在面板内滚动。
- 勾选粒度是「小节 / 条目」级，不能在行内局部取舍。
- 页签之间各自保留上一次结果，切换不会重跑；改过草稿后需要重新生成。

## 后续可加

- 改写稿与原文的并排 diff。
- 未知清单里点一条就把它作为追问发给模型。
- 团队共享规则做成 preset / 可安装的规则包。

## License

[MIT](LICENSE)
