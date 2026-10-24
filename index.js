/**
 * Prompt Forge — host half.
 *
 * Three JSON endpoints for the one composer button (rewrite the draft / list the
 * unknowns / read and write the plugin settings). The plugin is user-invoked
 * only: nothing here is exposed to a model, so an agent never calls it on its own.
 * The doctrine itself lives in ./doctrine.md so a team can edit it without
 * touching code; `BUILTIN_DOCTRINE` is the fallback when that file is missing.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import z from '@deepseek-ai/schemastery'

/** The settings form the plugin row renders: every field is live (volatile). */
export const Config = z.object({
  model: z
    .string()
    .default('')
    .description('改写用的模型：留空跟随 profile 默认模型；也可写成 provider/model')
    .volatile(),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .default(0.35)
    .description('改写温度：越低越贴原文，越高越敢改结构')
    .volatile(),
  askFirst: z
    .boolean()
    .default(true)
    .description('先问再答：改写稿里是否包含「先提出三个内行必问的问题，只问不答」的开场')
    .volatile(),
  extraRules: z
    .string()
    .default('')
    .description('追加到改写规则末尾的额外要求（可留空）')
    .volatile(),
  doctrinePath: z
    .string()
    .default('')
    .description('自定义规则文件：留空用插件自带的 doctrine.md；可填绝对路径或相对插件目录的路径')
    .volatile(),
})

/** Route prefix owned by this bundle. */
const ROUTE = '/promptforge'

/** Hard cap on one request body (a prompt, not a document). */
const MAX_BODY_BYTES = 200_000

/** Hard cap on the submitted prompt. */
const MAX_PROMPT_CHARS = 20_000

/** One rewrite call may not outlive this. */
const CALL_TIMEOUT_MS = 120_000

/** This package's own directory, so the doctrine file resolves under any cwd. */
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))

/** The rules shipped with the package; keep in sync with ./doctrine.md. */
export const BUILTIN_DOCTRINE = `你是「AI 使用心法」的提示词改写器。用户会交给你一段原始提示词；你输出改写后的提示词正文。

## 改写依据（心法要点）
1. 判据代替禁令：把「不要啰嗦」「写得好一点」这类禁令，换成可外部验证的验收标准（条数、字数、必须包含的结构、必须给出的证据）。
2. 先找未知再动手：动手前先找出这个任务里「内行会追问、而委托人很可能没想到」的未知，不要直接猜着做。这一次具体怎么写，见文末的「未知」段。
3. 关键处留白、判断处具体：需要人来拍板的选择（口味、价值取舍、风险偏好）写成「这一项由我决定，先给我选项」，不要让 AI 替你猜。
4. 便宜原型优先：工作量大的任务，先要一个 10 分钟能看完的最小可运行版本，再迭代。
5. 抬一层野心：明确「只求做完」是不够的，要求在同一份交付里再给出一个更高标准的版本或一个被低估的更优解。
6. 上下文五层：身份（谁在做）、项目（背景与历史）、能力（可用的工具与材料）、参考（好/坏样例）、即时（这一次的具体要求）。原文缺失的层，用「【待补：…】」占位保留，不要编造。
7. 目标具体且难：把「优化一下」「处理一下」这类模糊动词，换成可验收的结果描述。
8. 逆向面试：要求对方在动手前用三个问题面试你，把你没想到的东西问出来。

## 改写规则
- 保留原文的意图、素材、专有名词与限制，不扩大需求、不虚构事实与实现细节。
- 篇幅跟任务复杂度匹配：一句话的任务，改写完也只是一小段；不要用固定模板把短任务撑长。宿主每次都会给出这一篇的字数与节数上限，必须遵守。
- 结构按需增节，默认只用两节：「目标」「验收标准（可外部验证）」。只有原文确实缺失、且必须由人来补的上下文，才加「背景与待确认」；只有产出物的格式本身就是关键约束时，才加「交付格式」。禁止为了凑对称而补节。
- 验收标准必须能由第三方逐条核对：数字、条数、字数、必须包含的结构、必须给出的证据、可复现的动作。禁止写「简洁」「清晰」「专业」「合理」「适当」「尽量」「写得好」这类形容词判据——那等于没改。
- 每一节都要给出前面没有的信息。如果某一节只是把「目标」换个说法再讲一遍，直接删掉它，宁缺勿凑。
- 每个标题必须单独占一行、以 Markdown 二级标题 \`## \` 开头（例：\`## 目标\`）。不要写「目标：……」这种行内标签，也不要加粗代替标题——阅读的人要把每一节单独取出来用。
- 只输出改写后的提示词正文：不要前言、不要解释改了什么、不要 Markdown 代码围栏。`

/** Appended to the doctrine while the "ask first" switch is on. */
export const ASK_FIRST_ON = `## 「未知」怎么写（先问再答：开）
在改写稿最前面加一段「先问再答」：要求对方先提出 3 个「内行必问、外行想不到」的问题，只问不答，等回答之后再动手。这一段单独成节，不要混进其他段落。
这一段本身要短：一句话的任务 1–2 句，普通任务 2–3 句，不要把它写成一篇说明。`

/** Appended to the doctrine while the switch is off. */
export const ASK_FIRST_OFF = `## 「未知」怎么写（先问再答：关）
不要要求对方先提问。改为在「未知与待确认」一节里写出「我据此推断的前提」与「仍需要你确认的点」，各 1–3 条。`

/** System prompt of the unknowns-only mode (the second tab of the panel). */
export const UNKNOWNS_DOCTRINE = `你是「AI 使用心法」的未知审查员。用户给你一段他想交给 AI 做的任务或提示词。

你的任务：只列出未知，不改写原文、不评价好坏、不替用户回答。
要求：
- 每条都是「内行必问、外行想不到」的问题，覆盖目标、素材与边界、验收标准、口味取舍、风险与代价。
- 一条只写一个问句：不写解释、不写建议、不写「为什么」。
- 不要重复原文已经写明的信息；没有那么多未知就少写几条，绝不凑数。
- 中文输出，只输出编号列表、一行一条：\`1. 问题？\`。不要前言、不要总结、不要代码围栏。`

/**
 * Compose the system prompt for one rewrite.
 * @param {boolean} askFirst whether the rewrite opens by asking before answering.
 * @param {string} [base] the doctrine body; defaults to {@link BUILTIN_DOCTRINE}.
 * @returns {string} the system prompt.
 */
export function buildDoctrine(askFirst, base = BUILTIN_DOCTRINE) {
  const body = typeof base === 'string' && base.trim() !== '' ? base.trim() : BUILTIN_DOCTRINE
  return `${body}\n\n${askFirst ? ASK_FIRST_ON : ASK_FIRST_OFF}`
}

/**
 * Read the doctrine file, falling back to the built-in copy.
 * Re-read on every call so edits to the file (and to a team-shared file) apply
 * without reloading the plugin.
 * @param {string} [customPath] absolute path, or one relative to the package dir.
 * @param {string} [dir] package dir override (tests).
 * @returns {string} the doctrine body.
 */
export function loadDoctrine(customPath = '', dir = PACKAGE_DIR) {
  const wanted = typeof customPath === 'string' ? customPath.trim() : ''
  const target = wanted === '' ? path.join(dir, 'doctrine.md') : path.isAbsolute(wanted) ? wanted : path.resolve(dir, wanted)
  try {
    const text = readFileSync(target, 'utf8').trim()
    if (text !== '') return text
  } catch {
    // Missing or unreadable: the shipped copy still works.
  }
  return BUILTIN_DOCTRINE
}

/**
 * Read one Config field. Volatile fields arrive as refs (`get()`); plain values pass through.
 * @param {unknown} field the config field or ref.
 * @param {unknown} fallback value when the field is absent.
 * @returns {any} the current value.
 */
export function readConfig(field, fallback) {
  if (field !== null && typeof field === 'object' && typeof (/** @type {any} */ (field)).get === 'function') {
    const value = /** @type {any} */ (field).get()
    return value === undefined ? fallback : value
  }
  return field === undefined ? fallback : field
}

/**
 * Apply the configured model override to the resolved route.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} route the profile default.
 * @param {string} override `model` or `provider/model`.
 * @returns {{ provider: string, model: string, reasoningEffort?: string }} the route to call.
 */
export function applyModelOverride(route, override) {
  const text = typeof override === 'string' ? override.trim() : ''
  if (text === '') return route
  const slash = text.indexOf('/')
  if (slash > 0) {
    return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
  }
  return { ...route, model: text }
}

/**
 * Read a JSON body with a size cap.
 * @param {import('node:http').IncomingMessage} req request stream.
 * @returns {Promise<any>} the parsed body.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const parts = []
    let size = 0
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { code: 'body-too-large' }))
        req.destroy()
        return
      }
      parts.push(buf)
    })
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(Object.assign(new Error('invalid json body'), { code: 'invalid-json' }))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Write one JSON reply.
 * @param {import('node:http').ServerResponse} res response.
 * @param {number} status HTTP status.
 * @param {unknown} payload JSON body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Strip the wrappers a model tends to add around an otherwise clean answer.
 * @param {string} text raw streamed text.
 * @returns {string} the body.
 */
export function cleanRewrite(text) {
  let out = text.trim()
  // ```lang\n...\n```
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/u.exec(out)
  if (fence) out = fence[1].trim()
  // A leading "改写后的提示词：" style label line.
  out = out.replace(/^(改写(?:后)?(?:的)?提示词|优化(?:后)?(?:的)?提示词|以下是[^：:]{0,20})[：:]\s*/u, '')
  return out.trim()
}

/**
 * Split a rewritten prompt into the sections the panel renders as pickable rows.
 * A heading line becomes its own row (heading kept so the chosen rows rebuild
 * the same Markdown); text before the first heading becomes a heading-less row.
 * @param {string} text the rewritten prompt.
 * @returns {{ heading: string | null, body: string }[]} the rows.
 */
export function splitSections(text) {
  const source = typeof text === 'string' ? text.trim() : ''
  if (source === '') return []
  /** @type {{ heading: string | null, body: string }[]} */
  const rows = []
  let heading = null
  let buffer = []
  const flush = () => {
    const body = buffer.join('\n').trim()
    if (body !== '') rows.push({ heading, body })
    buffer = []
  }
  for (const line of source.split('\n')) {
    const match = /^#{1,3}\s+(.+?)\s*$/u.exec(line)
    if (match === null) {
      buffer.push(line)
      continue
    }
    flush()
    heading = match[1].trim()
  }
  flush()
  if (rows.length === 1 && rows[0].heading === null) {
    // No Markdown heading at all: a model sometimes writes "目标：…" label
    // paragraphs instead. Those still become one pickable row each.
    return splitLabelRows(rows[0].body)
  }
  return rows.length === 0 ? [{ heading: null, body: source }] : rows
}

/**
 * Split heading-less prose into paragraph rows, lifting a leading "标签：" out
 * as the row heading.
 * @param {string} text the prose.
 * @returns {{ heading: string | null, body: string }[]} the rows.
 */
function splitLabelRows(text) {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
  if (paragraphs.length <= 1) return [{ heading: null, body: text }]
  return paragraphs.map((paragraph) => {
    const match = /^([^：:\n]{2,18})[：:]\s*/u.exec(paragraph)
    if (match === null) return { heading: null, body: paragraph }
    const body = paragraph.slice(match[0].length).trim()
    return body === '' ? { heading: null, body: paragraph } : { heading: match[1].trim(), body }
  })
}

/**
 * Split a blind-spot answer into one row per numbered item. Paragraphs without
 * numbering stay whole; a paragraph holding several numbered items is split at
 * the item boundaries.
 * @param {string} text the answer.
 * @returns {{ heading: string | null, body: string }[]} the rows.
 */
export function splitItems(text) {
  const source = typeof text === 'string' ? text.trim() : ''
  if (source === '') return []
  /** @type {string[]} */
  const items = []
  for (const chunk of source.split(/\n\s*\n/u)) {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue
    const starts = lines.map((line, index) => (/^\s*\d+[.)、]\s*/u.test(line) ? index : -1)).filter((index) => index >= 0)
    if (starts.length <= 1) {
      items.push(lines.join('\n').trim())
      continue
    }
    starts.forEach((from, index) => {
      const to = index + 1 < starts.length ? starts[index + 1] : lines.length
      items.push(lines.slice(from, to).join('\n').trim())
    })
  }
  return items.filter((item) => item !== '').map((body) => ({ heading: null, body }))
}

/**
 * Size budget for one rewrite, matched to how big the task in the draft is.
 * A one-line errand deserves a one-paragraph prompt, not a five-section template.
 * @param {string} draft the original prompt.
 * @returns {{ tier: 'tiny' | 'normal' | 'large', chars: number, maxSections: number, maxChars: number }} the budget.
 */
export function complexityBudget(draft) {
  const chars = typeof draft === 'string' ? draft.replace(/\s+/gu, ' ').trim().length : 0
  if (chars < 40) return { tier: 'tiny', chars, maxSections: 2, maxChars: 150 }
  if (chars < 200) return { tier: 'small', chars, maxSections: 3, maxChars: 240 }
  if (chars < 800) return { tier: 'normal', chars, maxSections: 4, maxChars: 900 }
  return { tier: 'large', chars, maxSections: 5, maxChars: Math.max(1200, Math.round(chars * 1.4)) }
}

/**
 * The budget line handed to the model next to the doctrine. It comes after the
 * doctrine, so it can downgrade a section the doctrine would otherwise add.
 * @param {ReturnType<typeof complexityBudget>} budget the budget.
 * @param {{ askFirst?: boolean }} [options] the switches in force.
 * @returns {string} the instruction.
 */
export function budgetInstruction(budget, options = {}) {
  const askLine = options.askFirst === false ? '' : ' 规则要求「先问再答」，但这一段不要单独成节：压成一句话（先问我哪几个问题再动手）写进「验收标准」第一条。'
  if (budget.tier === 'tiny') {
    return `原文只有一两句（${budget.chars} 字）：改写后不超过 ${budget.maxChars} 字、最多 ${budget.maxSections} 节——只写「目标」和「验收标准」两节。${askLine}不要补「背景与待确认」「交付格式」。`
  }
  if (budget.tier === 'small') {
    return `原文较短（${budget.chars} 字）：改写后不超过 ${budget.maxChars} 字、最多 ${budget.maxSections} 节。默认只写「目标」「验收标准」「先后未知」三节；原文没有真正的上下文缺口时，不要去补「背景与待确认」「交付格式」。`
  }
  if (budget.tier === 'normal') {
    return `原文中等（${budget.chars} 字）：改写后不超过 ${budget.maxChars} 字、最多 ${budget.maxSections} 节。每一节都必须给出前面没有的信息，只是换个说法复述「目标」的节，直接删掉。`
  }
  return `原文较长（${budget.chars} 字）：改写后不超过 ${budget.maxChars} 字、最多 ${budget.maxSections} 节。删掉所有复述与套话，只留下决定结果的要求。`
}

/** Adjective "criteria" that a third party cannot check — they mean nothing. */
const VAGUE_CRITERIA = /简洁|清晰|专业|合理|适当|尽量|尽可能|写得好|通俗易懂|逻辑清楚/u

/** Whitespace and punctuation, dropped before comparing two sections. */
const NOISE = /[\s\p{P}]/gu

/**
 * Check a rewrite against the same standards the doctrine asks for, so the host
 * can ask once more instead of shipping an over-long or padded result.
 * @param {string} text the rewritten prompt.
 * @param {ReturnType<typeof complexityBudget>} budget the budget it was asked to hit.
 * @returns {string[]} issue codes; empty means acceptable.
 */
export function reviewRewrite(text, budget) {
  const rows = splitSections(text)
  const issues = []
  if (rows.length > budget.maxSections) issues.push('too-many-sections')
  const length = String(text ?? '').trim().length
  if (length > Math.round(budget.maxChars * 1.15)) issues.push('too-long')
  const criteria = rows.find((row) => /验收标准/u.test(row.heading ?? '') || /^验收标准/u.test(row.body))
  if (criteria !== undefined && VAGUE_CRITERIA.test(criteria.body)) issues.push('vague-criteria')
  const normalized = rows.map((row) => row.body.replace(NOISE, ''))
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left]
      const b = normalized[right]
      if (a.length < 12 || b.length < 12) continue
      if (a === b || a.includes(b) || b.includes(a)) issues.push('duplicate-section')
    }
  }
  return [...new Set(issues)]
}

/** How each issue is explained back to the model on the retry. */
const ISSUE_TEXT = {
  'too-many-sections': (budget) => `节数超了：最多 ${budget.maxSections} 节，把重复的、可以并进别节的删掉。`,
  'too-long': (budget) => `太长：整份必须压到 ${budget.maxChars} 字以内（连标题算）。按顺序删：先删只复述目标的句子，再删修饰词，最后才删条目；宁可少一条验收标准，也不要超字数。`,
  'vague-criteria': () =>
    '「验收标准」里出现了形容词判据（简洁/清晰/专业…），换成第三方能逐条核对的数字、条数或可复现动作。',
  'duplicate-section': () => '有两节在说同一件事（通常是把「目标」换个说法又讲一遍），删掉其中一节。',
}

/**
 * The corrective paragraph appended on the retry.
 * @param {string[]} issues issue codes from {@link reviewRewrite}.
 * @param {ReturnType<typeof complexityBudget>} budget the budget.
 * @returns {string} the instruction.
 */
export function correctionInstruction(issues, budget) {
  const lines = issues.map((issue) => `- ${ISSUE_TEXT[issue]?.(budget) ?? issue}`)
  return `上一次输出不合格，按下面几条重写一遍：\n${lines.join('\n')}\n仍然只输出改写后的提示词正文。`
}

/**
 * How many unknowns a draft deserves: the same tiers the rewrite uses, so a
 * one-line errand gets two questions instead of five padded ones.
 * @param {string} draft the original prompt.
 * @returns {{ tier: 'tiny' | 'small' | 'normal' | 'large', maxItems: number, maxChars: number, maxItemChars: number }} the budget.
 */
export function unknownsBudget(draft) {
  const { tier } = complexityBudget(draft)
  if (tier === 'tiny') return { tier, maxItems: 2, maxChars: 70, maxItemChars: 28 }
  if (tier === 'small') return { tier, maxItems: 3, maxChars: 120, maxItemChars: 32 }
  if (tier === 'normal') return { tier, maxItems: 5, maxChars: 260, maxItemChars: 42 }
  return { tier, maxItems: 6, maxChars: 420, maxItemChars: 60 }
}

/**
 * The count line handed to the model for the unknowns mode.
 * @param {ReturnType<typeof unknownsBudget>} budget the budget.
 * @returns {string} the instruction.
 */
export function unknownsInstruction(budget) {
  return `这一份最多 ${budget.maxItems} 条、整份不超过 ${budget.maxChars} 字、每条不超过 ${budget.maxItemChars} 字。按重要性排序：最可能改变结果的那个未知放第一条。宁可少写一条，也不要凑数。`
}

/**
 * Check an unknowns list against its budget: too many questions, too wordy, or
 * an explanation that the doctrine asked it to drop.
 * @param {string} text the model's list.
 * @param {ReturnType<typeof unknownsBudget>} budget the budget it was asked to hit.
 * @returns {string[]} issue codes; empty means acceptable.
 */
export function reviewUnknowns(text, budget) {
  const rows = splitItems(text)
  const issues = []
  if (rows.length > budget.maxItems) issues.push('too-many-items')
  if (String(text ?? '').trim().length > Math.round(budget.maxChars * 1.3)) issues.push('too-long')
  const longest = rows.reduce((max, row) => Math.max(max, row.body.replace(NOISE, '').length), 0)
  if (longest > budget.maxItemChars + 10) issues.push('item-too-long')
  if (rows.some((row) => /——|--|因为|之所以/u.test(row.body))) issues.push('has-explanation')
  return [...new Set(issues)]
}

/** How each unknowns issue is explained back to the model on the retry. */
const UNKNOWNS_ISSUE_TEXT = {
  'too-many-items': (budget) => `条数超了：最多 ${budget.maxItems} 条，删掉最外围的问题，只留最可能改变结果的那几条。`,
  'too-long': (budget) => `太长：整份压到 ${budget.maxChars} 字以内。`,
  'item-too-long': (budget) => `单条太长：每条不超过 ${budget.maxItemChars} 字，只留问句本身。`,
  'has-explanation': () => '不要写「——为什么」这类解释，只写问句。',
}

/**
 * The corrective paragraph appended on the unknowns retry.
 * @param {string[]} issues issue codes from {@link reviewUnknowns}.
 * @param {ReturnType<typeof unknownsBudget>} budget the budget.
 * @returns {string} the instruction.
 */
export function unknownsCorrection(issues, budget) {
  const lines = issues.map((issue) => `- ${UNKNOWNS_ISSUE_TEXT[issue]?.(budget) ?? issue}`)
  return `上一次输出不合格，按下面几条重写一遍：\n${lines.join('\n')}\n仍然只输出编号列表，一行一条问句。`
}

/**
 * Pick the route/model for the call: the profile default, else the first
 * registered provider and its first model.
 * @param {any} llm the llm service.
 * @param {any} agentDefaultModel the default-model service, when present.
 * @returns {Promise<{ provider: string, model: string, reasoningEffort?: string }>} the route.
 */
async function resolveRoute(llm, agentDefaultModel) {
  const selection = agentDefaultModel?.currentSelection?.()
  if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') {
    return selection
  }
  const providers = llm.listProviders()
  const provider = providers.find((entry) => typeof entry === 'object' && entry !== null)
  if (!provider) throw Object.assign(new Error('no model provider is registered'), { code: 'no-provider' })
  const models = await llm.listModels(provider.id)
  const model = models[0]
  if (!model) throw Object.assign(new Error(`provider ${provider.id} has no models`), { code: 'no-model' })
  return { provider: provider.id, model: model.id }
}

/**
 * Read every knob the two modes share.
 * @param {any} config the validated plugin config (volatile refs).
 * @returns {{ askFirst: boolean, temperature: number, extraRules: string, doctrinePath: string, model: string }} the knobs.
 */
function readKnobs(config) {
  const rawTemperature = Number(readConfig(config?.temperature, 0.35))
  return {
    askFirst: readConfig(config?.askFirst, true) !== false,
    temperature: Number.isFinite(rawTemperature) ? Math.min(2, Math.max(0, rawTemperature)) : 0.35,
    extraRules: String(readConfig(config?.extraRules, '') ?? '').trim(),
    doctrinePath: String(readConfig(config?.doctrinePath, '') ?? '').trim(),
    model: String(readConfig(config?.model, '') ?? '').trim(),
  }
}

/** The plugin's package name, used to find its own Loader entry. */
export const PACKAGE_NAME = 'dsh-prompt-forge'

/** The defaults of the Config schema, so the panel can offer "restore default". */
export const CONFIG_DEFAULTS = {
  model: '',
  temperature: 0.35,
  askFirst: true,
  extraRules: '',
  doctrinePath: '',
}

/**
 * Project the live config into the settings form the panel renders.
 * @param {any} config the validated plugin config (volatile refs).
 * @returns {{ model: string, temperature: number, askFirst: boolean, extraRules: string, doctrinePath: string }} the current values.
 */
export function configValues(config) {
  const knobs = readKnobs(config)
  return {
    model: knobs.model,
    temperature: knobs.temperature,
    askFirst: knobs.askFirst,
    extraRules: knobs.extraRules,
    doctrinePath: knobs.doctrinePath,
  }
}

/**
 * Validate one settings submission from the panel. Unknown keys are ignored.
 * @param {unknown} input the posted object.
 * @returns {{ patch: Record<string, unknown>, errors: string[] }} accepted fields and the rejected ones.
 */
export function normalizeConfigInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { patch: {}, errors: ['body'] }
  }
  const errors = []
  const patch = {}
  if (Object.hasOwn(input, 'model')) {
    if (typeof input.model !== 'string') errors.push('model')
    else patch.model = input.model.trim()
  }
  if (Object.hasOwn(input, 'temperature')) {
    const value = Number(input.temperature)
    if (!Number.isFinite(value)) errors.push('temperature')
    else patch.temperature = Math.round(Math.min(2, Math.max(0, value)) * 100) / 100
  }
  if (Object.hasOwn(input, 'askFirst')) {
    if (typeof input.askFirst !== 'boolean') errors.push('askFirst')
    else patch.askFirst = input.askFirst
  }
  if (Object.hasOwn(input, 'extraRules')) {
    if (typeof input.extraRules !== 'string') errors.push('extraRules')
    else patch.extraRules = input.extraRules
  }
  if (Object.hasOwn(input, 'doctrinePath')) {
    if (typeof input.doctrinePath !== 'string') errors.push('doctrinePath')
    else patch.doctrinePath = input.doctrinePath.trim()
  }
  return { patch, errors }
}

/**
 * Append the user's extra rules to a base system prompt.
 * @param {string} base base system prompt.
 * @param {string} extraRules user rules (may be empty).
 * @returns {string} the composed system prompt.
 */
export function composeSystem(base, extraRules) {
  const extra = typeof extraRules === 'string' ? extraRules.trim() : ''
  return extra === '' ? base : `${base}\n\n## 用户追加要求（同等优先）\n${extra}`
}

/**
 * Build the system prompt of one mode.
 * @param {'prompt' | 'unknowns'} mode which surface is being served.
 * @param {{ askFirst: boolean, extraRules: string, doctrinePath: string }} knobs the shared knobs.
 * @returns {string} the system prompt.
 */
export function buildSystem(mode, knobs) {
  if (mode === 'unknowns') return composeSystem(UNKNOWNS_DOCTRINE, knobs.extraRules)
  return composeSystem(buildDoctrine(knobs.askFirst, loadDoctrine(knobs.doctrinePath)), knobs.extraRules)
}

/**
 * Run one model call and return its text.
 * @param {any} ctx host context (needs `llm`).
 * @param {{ mode: 'prompt' | 'unknowns', config: any, text: string, signal?: AbortSignal }} input the call.
 * @returns {Promise<{ text: string, provider: string, model: string }>} the answer.
 */
export async function callModel(ctx, input) {
  const llm = ctx.get('llm')
  if (llm === undefined) throw Object.assign(new Error('the llm service is not available'), { code: 'no-llm' })
  const knobs = readKnobs(input.config)
  let route
  try {
    route = applyModelOverride(await resolveRoute(llm, ctx.get('agentDefaultModel')), knobs.model)
  } catch (error) {
    throw Object.assign(new Error(String(error?.message ?? error)), { code: String(error?.code ?? 'no-model') })
  }

  const system = buildSystem(input.mode, knobs)
  if (input.mode === 'unknowns') {
    // Same discipline as the rewrite: a shrink budget by draft size, then one
    // corrective pass when the list is padded or wordy.
    const budget = unknownsBudget(input.text)
    const prompted = `${system}\n\n## 这一份的条数预算\n${unknownsInstruction(budget)}`
    const answer = await completeOnce(llm, route, prompted, knobs.temperature, input)
    const issues = reviewUnknowns(answer, budget)
    if (issues.length === 0) return { text: answer, provider: route.provider, model: route.model }

    const retried = await completeOnce(
      llm,
      route,
      `${prompted}\n\n## 重写要求\n${unknownsCorrection(issues, budget)}`,
      0.2,
      input,
    )
    const chosen = reviewUnknowns(retried, budget).length <= issues.length ? retried : answer
    return { text: chosen, provider: route.provider, model: route.model }
  }

  // A rewrite is checked against the budget of the draft it came from; one
  // corrective pass fixes an over-long or padded answer before it reaches the UI.
  const budget = complexityBudget(input.text)
  const prompted = `${system}\n\n## 这一次的篇幅预算\n${budgetInstruction(budget)}`
  const answer = await completeOnce(llm, route, prompted, knobs.temperature, input)
  const issues = reviewRewrite(answer, budget)
  if (issues.length === 0) return { text: answer, provider: route.provider, model: route.model }

  const retried = await completeOnce(
    llm,
    route,
    `${prompted}\n\n## 重写要求\n${correctionInstruction(issues, budget)}`,
    0.2,
    input,
  )
  const chosen = reviewRewrite(retried, budget).length <= issues.length ? retried : answer
  return { text: chosen, provider: route.provider, model: route.model }
}

/**
 * One complete answer, retrying once when a reasoning model streams no text.
 * @param {any} llm the llm service.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} route the route to call.
 * @param {string} system the system prompt.
 * @param {number} temperature the temperature.
 * @param {{ mode: 'prompt' | 'unknowns', text: string, signal?: AbortSignal }} input the call.
 * @returns {Promise<string>} the cleaned text (never empty).
 */
async function completeOnce(llm, route, system, temperature, input) {
  // A reasoning model occasionally spends the whole budget on reasoning and
  // streams no text; one retry turns that into a normal answer.
  let lastEmpty
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await streamOnce(llm, route, system, temperature, input, lastEmpty !== undefined)
    if (answer !== '') return answer
    lastEmpty = Object.assign(new Error('the model returned an empty answer'), { code: 'empty-answer', status: 502 })
  }
  throw lastEmpty
}

/**
 * One model call: stream it, join the text, strip wrappers.
 * @param {any} llm the llm service.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} route the route to call.
 * @param {string} system the system prompt.
 * @param {number} temperature the temperature.
 * @param {{ mode: 'prompt' | 'unknowns', text: string, signal?: AbortSignal }} input the call.
 * @param {boolean} retry whether this is the retry (budget doubles, reasoning shrinks).
 * @returns {Promise<string>} the cleaned answer, or '' when the model streamed no text.
 */
async function streamOnce(llm, route, system, temperature, input, retry) {
  /** Text budget for one call: reasoning tokens count against it. */
  const maxTokens = (input.mode === 'unknowns' ? 3000 : 4000) * (retry ? 2 : 1)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  const abort = () => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })

  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined || retry ? {} : { reasoningEffort: route.reasoningEffort }),
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: input.text }] }],
      temperature,
      maxTokens,
      signal: controller.signal,
    })

    let text = ''
    let failure
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        failure = chunk.reason.failure ?? { code: 'aborted', message: 'the model call was aborted' }
      }
    }

    if (failure !== undefined) {
      throw Object.assign(new Error(String(failure.message ?? 'the model call failed')), {
        code: String(failure.code ?? 'model-error'),
        status: 502,
      })
    }

    return cleanRewrite(text)
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', abort)
  }
}

/**
 * Register one POST endpoint that answers with one cleaning model call.
 * @param {any} ctx host context.
 * @param {{ path: string, mode: 'prompt' | 'unknowns', field: string, isDisposed: () => boolean, config: any }} spec the endpoint.
 * @returns {() => void} disposer.
 */
function registerEndpoint(ctx, spec) {
  return ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}${spec.path}`,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use POST' } })
        return
      }
      if (spec.isDisposed()) {
        sendJson(res, 503, { ok: false, error: { code: 'disposed', message: 'plugin is unloading' } })
        return
      }

      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        const code = String(error?.code ?? 'bad-request')
        sendJson(res, code === 'body-too-large' ? 413 : 400, {
          ok: false,
          error: { code, message: 'could not read the request body' },
        })
        return
      }

      const text = typeof body?.[spec.field] === 'string' ? body[spec.field] : ''
      if (text.trim() === '') {
        sendJson(res, 400, { ok: false, error: { code: 'empty-draft', message: 'the draft is empty' } })
        return
      }
      if (text.length > MAX_PROMPT_CHARS) {
        sendJson(res, 413, {
          ok: false,
          error: { code: 'draft-too-long', message: `the draft is longer than ${MAX_PROMPT_CHARS} characters` },
        })
        return
      }

      const controller = new AbortController()
      res.on('close', () => controller.abort())

      try {
        const answer = await callModel(ctx, { mode: spec.mode, config: spec.config, text, signal: controller.signal })
        const parts = spec.mode === 'unknowns' ? splitItems(answer.text) : splitSections(answer.text)
        sendJson(res, 200, {
          ok: true,
          value: { text: answer.text, parts, provider: answer.provider, model: answer.model },
        })
      } catch (error) {
        sendJson(res, Number(error?.status ?? 502), {
          ok: false,
          error: { code: String(error?.code ?? 'internal'), message: String(error?.message ?? error) },
        })
      }
    },
  })
}

/**
 * Find this plugin's own Loader entry: the profile patch row that carries its config.
 * @param {any} editor the host `configEditor` service.
 * @returns {any} the entry, or undefined when the plugin was not loaded from a patch row.
 */
function findOwnEntry(editor) {
  const entries = typeof editor?.entries === 'function' ? editor.entries() : []
  return entries.find((entry) => entry?.options?.name === PACKAGE_NAME)
    ?? entries.find((entry) => entry?.options?.id === 'prompt-forge')
}

/**
 * Mount the settings endpoints the panel's settings tab talks to: GET the live
 * values, POST a new set. Writes go through the host `configEditor`, so they land
 * in the profile patch as a normal Loader override — and because every Config
 * field is volatile, the running plugin picks them up without a reload.
 * @param {any} ctx host context.
 * @param {{ config: any, isDisposed: () => boolean }} spec the endpoint owner.
 * @returns {() => void} disposer.
 */
function registerConfigEndpoints(ctx, spec) {
  return ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/config`,
    handler: async (req, res) => {
      if (spec.isDisposed()) {
        sendJson(res, 503, { ok: false, error: { code: 'disposed', message: 'plugin is unloading' } })
        return
      }

      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, value: { values: configValues(spec.config), defaults: CONFIG_DEFAULTS } })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use GET or POST' } })
        return
      }

      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        const code = String(error?.code ?? 'bad-request')
        sendJson(res, code === 'body-too-large' ? 413 : 400, {
          ok: false,
          error: { code, message: 'could not read the request body' },
        })
        return
      }

      const input = body !== null && typeof body === 'object' && body.config !== undefined ? body.config : body
      const { patch, errors } = normalizeConfigInput(input)
      if (errors.length > 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: 'invalid-config', message: `invalid fields: ${errors.join(', ')}` },
        })
        return
      }

      const editor = ctx.get('configEditor')
      if (editor === undefined) {
        sendJson(res, 503, {
          ok: false,
          error: { code: 'no-config-editor', message: 'this host has no configEditor service' },
        })
        return
      }
      const entry = findOwnEntry(editor)
      if (entry === undefined) {
        sendJson(res, 503, {
          ok: false,
          error: { code: 'no-entry', message: 'this plugin has no Loader entry to configure' },
        })
        return
      }

      try {
        await editor.edit(entry, (current, inherited) => ({ ...inherited, ...current, ...patch }))
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: { code: 'save-failed', message: String(error?.message ?? error) },
        })
        return
      }

      sendJson(res, 200, {
        ok: true,
        value: { values: { ...configValues(spec.config), ...patch }, defaults: CONFIG_DEFAULTS },
      })
    },
  })
}

/**
 * Mount the two endpoints.
 * @param {import('@deepseek-ai/dsh-core').Context} ctx host context.
 * @param {any} config the validated plugin config (volatile refs).
 */
export function apply(ctx, config) {
  let disposed = false
  ctx.effect(() => () => { disposed = true }, 'dsh-prompt-forge: lifecycle')

  const isDisposed = () => disposed
  const disposeOptimize = registerEndpoint(ctx, {
    path: '/optimize',
    mode: 'prompt',
    field: 'text',
    isDisposed,
    config,
  })
  ctx.effect(() => () => { disposeOptimize() }, 'dsh-prompt-forge: route optimize')

  const disposeUnknowns = registerEndpoint(ctx, {
    path: '/unknowns',
    mode: 'unknowns',
    field: 'text',
    isDisposed,
    config,
  })
  ctx.effect(() => () => { disposeUnknowns() }, 'dsh-prompt-forge: route unknowns')

  const disposeConfig = registerConfigEndpoints(ctx, { config, isDisposed })
  ctx.effect(() => () => { disposeConfig() }, 'dsh-prompt-forge: route config')
}

export const inject = ['webServer']
