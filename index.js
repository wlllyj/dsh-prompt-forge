/**
 * Prompt Forge — host half.
 *
 * Two JSON endpoints for the composer buttons (rewrite the draft / list the
 * unknowns), plus one model-facing tool so an agent can call the same rewrite.
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

/** The model-facing tool this bundle registers. */
export const TOOL_NAME = 'prompt_forge_optimize'

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
- 用短小标题组织：「目标」「背景与约束」「未知与待确认」「验收标准（可外部验证）」「交付格式」。
- 原文只有一两句话时，不要强行套五个标题：保持简短，但必须补上验收标准与「未知与待确认」。
- 长度控制在原文的 1.2–2.5 倍，不注水、不复述。
- 只输出改写后的提示词正文：不要前言、不要解释改了什么、不要 Markdown 代码围栏。`

/** Appended to the doctrine while the "ask first" switch is on. */
export const ASK_FIRST_ON = `## 「未知」怎么写（先问再答：开）
在改写稿最前面加一段「先问再答」：要求对方先提出 3 个「内行必问、外行想不到」的问题，只问不答，等回答之后再动手。这一段单独成节，不要混进其他段落。`

/** Appended to the doctrine while the switch is off. */
export const ASK_FIRST_OFF = `## 「未知」怎么写（先问再答：关）
不要要求对方先提问。改为在「未知与待确认」一节里写出「我据此推断的前提」与「仍需要你确认的点」，各 1–3 条。`

/** System prompt of the unknowns-only mode (the second composer pill). */
export const UNKNOWNS_DOCTRINE = `你是「AI 使用心法」的未知审查员。用户给你一段他想交给 AI 做的任务或提示词。

你的任务：只列出未知，不改写原文、不评价好坏、不替用户回答。
要求：
- 3–5 条，每条都是「内行必问、外行想不到」的问题，覆盖目标、素材与边界、验收标准、口味取舍、风险与代价。
- 每条写成一个问句，后面用一句话说明为什么这是未知（不知道它会怎样改变结果）。
- 不要重复原文已经写明的信息；不要凑数。
- 中文输出，只输出编号列表：\`1. 问题？——为什么\`，不要前言、不要总结、不要代码围栏。`

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
  // A reasoning model occasionally spends the whole budget on reasoning and
  // streams no text; one retry turns that into a normal answer.
  let lastEmpty
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await streamOnce(llm, route, system, knobs.temperature, input, lastEmpty !== undefined)
    if (answer !== '') {
      return { text: answer, provider: route.provider, model: route.model }
    }
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
        sendJson(res, 200, {
          ok: true,
          value: { text: answer.text, provider: answer.provider, model: answer.model },
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
 * The model-facing tool: the same rewrite the composer button does, callable by
 * an agent through the normal tool pipeline.
 * @param {any} ctx host context.
 * @param {any} config the plugin config (volatile refs).
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition} the definition.
 */
export function buildTool(ctx, config) {
  return {
    name: TOOL_NAME,
    description: [
      'Rewrite a prompt by the AI-usage doctrine: every instruction becomes an externally verifiable acceptance criterion,',
      'unknowns are surfaced before the work starts, and the output is structured for a model to follow.',
      'mode "prompt" returns the rewritten prompt; mode "unknowns" returns only the 3-5 blind-spot questions an expert',
      'would ask first, without rewriting. Use it when the user wants a prompt improved or stress-tested before sending it.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          description: 'The original prompt or task description to work on (verbatim from the user).',
        },
        mode: {
          type: 'string',
          enum: ['prompt', 'unknowns'],
          description: 'prompt = full rewrite (default); unknowns = only the blind-spot question list.',
        },
      },
      required: ['prompt'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: CALL_TIMEOUT_MS + 10_000,
    async execute(args, exec) {
      const input = typeof args === 'object' && args !== null ? args : {}
      const text = typeof input.prompt === 'string' ? input.prompt : ''
      if (text.trim() === '') {
        return { ok: false, code: 'empty-prompt', message: 'prompt must be a non-empty string' }
      }
      if (text.length > MAX_PROMPT_CHARS) {
        return { ok: false, code: 'prompt-too-long', message: `prompt is longer than ${MAX_PROMPT_CHARS} characters` }
      }
      const mode = input.mode === 'unknowns' ? 'unknowns' : 'prompt'
      try {
        const answer = await callModel(ctx, { mode, config, text, signal: exec.signal })
        return { ok: true, mode, text: answer.text, provider: answer.provider, model: answer.model }
      } catch (error) {
        return { ok: false, code: String(error?.code ?? 'internal'), message: String(error?.message ?? error) }
      }
    },
  }
}

/**
 * Mount the endpoints and the tool.
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

  ctx.effect(() => ctx.tools.register(buildTool(ctx, config)), 'dsh-prompt-forge: prompt_forge_optimize tool')
}

export const inject = ['webServer', 'tools']
