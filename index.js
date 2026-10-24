/**
 * Prompt Forge — host half.
 *
 * Serves one JSON endpoint for the composer button: take the draft, ask the
 * configured model to rewrite it by the "AI 使用心法" doctrine, return the text.
 * The Client half (./client.js) owns the button, the draft swap and the toggle.
 */

/** Route prefix owned by this bundle. */
const ROUTE = '/promptforge'

/** Hard cap on one request body (a prompt, not a document). */
const MAX_BODY_BYTES = 200_000

/** Hard cap on the submitted prompt. */
const MAX_PROMPT_CHARS = 20_000

/** One rewrite call may not outlive this. */
const CALL_TIMEOUT_MS = 120_000

/**
 * The doctrine, as instructions for the rewriting model. Deliberately boring:
 * rules only, no examples, so the shape follows the submitted prompt.
 */
const DOCTRINE = `你是「AI 使用心法」的提示词改写器。用户会交给你一段原始提示词；你输出改写后的提示词正文。

## 改写依据（心法要点）
1. 判据代替禁令：把「不要啰嗦」「写得好一点」这类禁令，换成可外部验证的验收标准（条数、字数、必须包含的结构、必须给出的证据）。
2. 先找未知再动手：任务涉及判断、设计、调研、开放探索时，在开头要求对方先提出 3 个「内行必问、外行想不到」的问题，只问不答；或先给 3 个差异很大的方向，再展开。
3. 关键处留白、判断处具体：需要人来拍板的选择（口味、价值取舍、风险偏好）写成「这一项由我决定，先给我选项」，不要让 AI 替你猜。
4. 便宜原型优先：工作量大的任务，先要一个 10 分钟能看完的最小可运行版本，再迭代。
5. 抬一层野心：明确「只求做完」是不够的，要求在同一份交付里再给出一个更高标准的版本或一个被低估的更优解。
6. 上下文五层：身份（谁在做）、项目（背景与历史）、能力（可用的工具与材料）、参考（好/坏样例）、即时（这一次的具体要求）。原文缺失的层，用「【待补：…】」占位保留，不要编造。
7. 目标具体且难：把「优化一下」「处理一下」这类模糊动词，换成可验收的结果描述。
8. 逆向面试：要求对方在动手前用三个问题面试你，把你没想到的东西问出来。

## 改写规则
- 保留原文的意图、素材、专有名词与限制，不扩大需求、不虚构事实与实现细节。
- 用短小标题组织：「目标」「背景与约束」「验收标准（可外部验证）」「交付格式」「先问再答」。
- 原文只有一两句话时，不要强行套五个标题：保持简短，但必须补上验收标准与「先问再答」。
- 长度控制在原文的 1.2–2.5 倍，不注水、不复述。
- 只输出改写后的提示词正文：不要前言、不要解释改了什么、不要 Markdown 代码围栏。`

/**
 * Read a JSON body with a size cap.
 * @param {import('node:http').IncomingMessage} req request stream.
 * @returns {Promise<unknown>} the parsed body.
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
 * Strip the wrappers a model tends to add around an otherwise clean rewrite.
 * @param {string} text raw streamed text.
 * @returns {string} the prompt body.
 */
function cleanRewrite(text) {
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
 * Mount the endpoint.
 * @param {import('@deepseek-ai/dsh-core').Context} ctx host context.
 */
export function apply(ctx) {
  let disposed = false
  ctx.effect(() => () => { disposed = true }, 'dsh-prompt-forge: lifecycle')

  const route = `${ROUTE}/optimize`

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: route,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'use POST' } })
        return
      }
      if (disposed) {
        sendJson(res, 503, { ok: false, error: { code: 'disposed', message: 'plugin is unloading' } })
        return
      }

      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        const code = String(error?.code ?? 'bad-request')
        sendJson(res, code === 'body-too-large' ? 413 : 400, { ok: false, error: { code, message: 'could not read the request body' } })
        return
      }

      const draft = typeof body?.text === 'string' ? body.text : ''
      if (draft.trim() === '') {
        sendJson(res, 400, { ok: false, error: { code: 'empty-draft', message: 'the draft is empty' } })
        return
      }
      if (draft.length > MAX_PROMPT_CHARS) {
        sendJson(res, 413, { ok: false, error: { code: 'draft-too-long', message: `the draft is longer than ${MAX_PROMPT_CHARS} characters` } })
        return
      }

      const llm = ctx.get('llm')
      if (llm === undefined) {
        sendJson(res, 503, { ok: false, error: { code: 'no-llm', message: 'the llm service is not available' } })
        return
      }

      let route_
      try {
        route_ = await resolveRoute(llm, ctx.get('agentDefaultModel'))
      } catch (error) {
        sendJson(res, 503, { ok: false, error: { code: String(error?.code ?? 'no-model'), message: String(error?.message ?? error) } })
        return
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
      res.on('close', () => controller.abort())

      try {
        const stream = llm.stream({
          provider: route_.provider,
          model: route_.model,
          ...(route_.reasoningEffort === undefined ? {} : { reasoningEffort: route_.reasoningEffort }),
          system: DOCTRINE,
          messages: [{ role: 'user', content: [{ type: 'text', text: draft }] }],
          temperature: 0.35,
          maxTokens: 4000,
          signal: controller.signal,
        })

        let text = ''
        let failure
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') failure = chunk.reason.failure
          else if (chunk.type === 'finish' && chunk.reason?.kind === 'aborted') failure = chunk.reason.failure
        }

        if (failure !== undefined) {
          sendJson(res, 502, {
            ok: false,
            error: { code: String(failure.code ?? 'model-error'), message: String(failure.message ?? 'the model call failed') },
          })
          return
        }

        const optimized = cleanRewrite(text)
        if (optimized === '') {
          sendJson(res, 502, { ok: false, error: { code: 'empty-rewrite', message: 'the model returned an empty rewrite' } })
          return
        }

        sendJson(res, 200, {
          ok: true,
          value: { optimized, provider: route_.provider, model: route_.model },
        })
      } catch (error) {
        sendJson(res, 502, { ok: false, error: { code: String(error?.code ?? 'internal'), message: String(error?.message ?? error) } })
      } finally {
        clearTimeout(timer)
      }
    },
  })

  ctx.effect(() => () => { disposeRoute() }, 'dsh-prompt-forge: route')
}

export const inject = ['webServer']
