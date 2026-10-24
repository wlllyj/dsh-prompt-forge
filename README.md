# Prompt Forge（提示词工坊）

输入框工具行左侧多两个胶囊按钮：

- `✦ Prompt`：点一下，把草稿改写成「能直接执行」的提示词；再点一下，在**优化稿**和**原文**之间来回切。
- `未知`：不改写正文，只列出「内行会追问、而你可能没想到」的 3–5 个问题，显示在输入框上方的面板里，可一键插入输入框。

同一个改写能力还作为 agent 工具 `prompt_forge_optimize` 暴露给模型，agent 也能按心法改写你给的提示词。

- 宿主半边 `index.js`：`POST /promptforge/optimize`、`POST /promptforge/unknowns` 两条路由 + 工具注册
- 客户端半边 `client.js`：`conversation.input.left`（两个胶囊）+ `conversation.input.dock`（未知清单面板）
- 规则写在 `doctrine.md`，团队可以直接改，不用碰代码
- 包名 `dsh-prompt-forge`，是一个 DSH bundle（`dsh.bundle.patch`），自带 Config 设置项

## 它做什么

1. 在输入框写任意草稿（一句话也行）。
2. 点 `✦ Prompt`：调用 profile 默认模型改写，结果写回输入框，按钮变成 `↩ 原文`。
3. 点 `↩ 原文` 切回原措辞；再点 `✦ 优化版` 切回改写稿。
4. 点 `未知`：面板出现在输入框上方，列出 3–5 个未知问题；`插入到输入框` 把清单接到草稿末尾，`关闭` 收起面板。
5. 手动改过草稿后，「原文/优化稿」这对缓存自动失效，下一次点击重新改写。

状态：`idle` → `busy`（改写中…）→ `optimized ⇄ original`；错误就地显示，6 秒后消失。两个按钮各管各的，`未知` 不会动草稿。

## 改写依据：提示词心法

规则写在 [`doctrine.md`](doctrine.md)，由它驱动改写模型。这套规则来自一份个人整理的 AI 使用手册——《AI 使用心法》，把「怎么让 AI 把活干好」归纳成十来个可以照着做的动作；方法论源头是 Anthropic 官方博客的三篇长文：**《找到你的未知》**（动手前先把「自己不知道什么」找出来）、**《删掉 80%》**（把上下文与要求压缩到真正决定结果的那 20%）、**《更有野心》**（别只要一个能跑的东西，把标准和野心一起抬上去）。

落到提示词改写上，就是下面这几条：

| 心法要点 | 在改写里的落地 |
| --- | --- |
| 判据代替禁令 | 把「不要啰嗦」「写好一点」换成可外部验证的验收标准：条数、字数、必须包含的结构、必须给出的证据 |
| 先找未知再动手 | 判断 / 设计 / 调研类任务，开头要求对方先提 3 个「内行必问、外行想不到」的问题，只问不答（可用 `askFirst` 关掉，改为写出「我推断的前提」与「仍需确认」） |
| 关键处留白 | 口味、价值取舍、风险偏好这类只有人能拍板的选择，写成「这一项由我决定，先给我选项」 |
| 便宜原型优先 | 大任务先要一个 10 分钟能看完的最小可运行版本，再迭代 |
| 抬一层野心 | 只「做完」不够，同一份交付里再给一个更高标准的版本，或一个被低估的更优解 |
| 上下文五层 | 身份 / 项目 / 能力 / 参考 / 即时；原文缺哪层就用「【待补：…】」占位，不编造 |
| 目标具体且难 | 把「优化一下」「处理一下」这类模糊动词换成可验收的结果描述 |
| 逆向面试 | 动手前先用三个问题面试委托人，把没想到的东西问出来 |

版面：`目标 / 背景与约束 / 未知与待确认 / 验收标准（可外部验证）/ 交付格式`，最后一节按 `askFirst` 开关换成「先问再答」或「已知前提与待确认」。只输出提示词正文——不带前言、不带代码围栏（宿主还会再兜底剥一次围栏和「改写后：」这类前缀）。

### 改规则（不用改代码）

`doctrine.md` 每次请求都会重新读，改完存盘立刻生效。团队共享时有两种做法：

- 直接改仓库里的 `doctrine.md`，fork / PR 都行；
- 或者把规则放到别处（比如团队内部的规范仓库），在设置里把 `doctrinePath` 指过去（支持绝对路径，或相对插件目录的路径）。

`index.js` 里的 `BUILTIN_DOCTRINE` 是文件缺失时的兜底副本，`node --test` 会校验它和 `doctrine.md` 一致——改完规则文件记得同步一下兜底。

## 安装

需要一个已安装 DSH、带 Web GUI 的 profile。

```bash
# 1) 先装本包的依赖：Config 的字段 schema 依赖 @deepseek-ai/schemastery
pnpm install

# 2) 把本目录注册成 bundle（把 <本目录> 换成你 clone 下来的绝对路径）
```

第 2 步用 DSH 的插件管理器：`plugin_manager` 的 `install_bundle`，`target` 传本目录的绝对路径。装完在插件列表里应能看到 `dsh-prompt-forge`（`active`），输入框工具行左侧出现 `✦ Prompt` 与 `未知` 两个按钮。

> 如果只想用、不想改代码，也可以先 `pnpm pack` 出 tgz 再装这个 tgz；以目录形式安装时 DSH 会把本目录链接进 profile，改完源码重新安装即可生效。

## 配置

插件详情页会按下面的 schema 生成设置表单（字段都是 live 的，改完立即生效，不用重启）：

| 字段 | 类型 / 默认值 | 作用 |
| --- | --- | --- |
| `model` | string / `''` | 改写用的模型。留空＝跟随 profile 默认模型；也可写 `provider/model` 或只写 `model` |
| `temperature` | number / `0.35` | 改写温度。越低越贴原文，越高越敢重组结构 |
| `askFirst` | boolean / `true` | 「先问再答」开关。关掉后不再要求对方先提问，改为在正文里写出「已知前提」与「仍待确认」各 1–3 条 |
| `extraRules` | string / `''` | 追加到改写规则末尾的额外要求，例如团队自己的交付格式 |
| `doctrinePath` | string / `''` | 自定义规则文件。留空＝用插件自带的 `doctrine.md`；可填绝对路径或相对插件目录的路径 |

## 接口与工具

两条路由，body 都是 `{ "text": "..." }`：

```jsonc
// POST /promptforge/optimize  → 改写后的完整提示词
{ "ok": true, "value": { "text": "...", "provider": "deepseek-account", "model": "deepseek-flash" } }
// POST /promptforge/unknowns  → 只有未知清单，不改写正文
{ "ok": true, "value": { "text": "1. …——为什么", "provider": "…", "model": "…" } }
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

- **不用 `host.call`**：那是未公开的 package-private RPC；改用宿主 `ctx.webServer.register` + 浏览器同源 `fetch`（文档相对路径 `promptforge/optimize`），跨版本更稳。
- **`conversation.input.left`**：官方声明的「输入框工具行左侧」区，`kind: list`、`replaceRisk: none`；用自己的 id 只会在旁边加一格，不会顶掉别的插件。
- **未知清单放 `conversation.input.dock`**：官方声明为「composer 卡片上方的整宽条目」，是唯一有纵向空间放多行文本的槽位；胶囊按钮里塞不下 5 行问题，写到草稿里又会污染原文。
- **两个槽位之间用模块级 store 通信**：它们是同一次 `apply()` 里注册的两个组件，没有共同父级可传 props，模块级 store + `useState` 订阅最省事，也不依赖未公开的 client service。
- **读写草稿用槽位标准注入的 `useInput` / `inputActions.setDraft`**：不碰编辑器内部实现。
- **不改写时不动草稿**：`未知` 只读草稿，面板的「插入」是你显式点的才写。
- **Config 用 `@deepseek-ai/schemastery`**：与 DSH 设置页同一套 schema 体系，字段声明了 `.volatile()` 才能进表单、并且写值直接提交到运行中的插件引用（不重挂载插件行）。
- **规则外置成 `doctrine.md` 而不是写死在代码里**：改写标准属于团队知识，不属于代码；外置后改规则不用发版，也能被 diff 审阅。

## 验证记录

- `node --test`：15 个用例全通过（两种「未知」段、规则文件加载与兜底、追加要求拼接、工具 schema 与拒绝路径、模型覆盖等）。
- `plugin_manager install_bundle` → `application: applied`、`enabled: true`、`warnings: []`。
- 插槽实测：`conversation.input.left` 有 `prompt-forge`（order 1100），`conversation.input.dock` 有 `prompt-forge-unknowns`（order 130），均 `active`。
- Config：`Config.listConfigs` 里该行 `status: "schema"`，五个字段都投影进设置表单。
- 工具：`Tool.listTools` 里出现 `prompt_forge_optimize`。
- 端到端：`/promptforge/optimize` 返回按心法结构化的改写；`/promptforge/unknowns` 返回编号问题列表。

## 后续可加

- 改写稿与原文的 diff 视图（现在只切不显示差异）。
- 未知清单里点一条就把它作为追问发给模型。
- 团队共享规则做成 preset / 可安装的规则包。

## License

[MIT](LICENSE)
