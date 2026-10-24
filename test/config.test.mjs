import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BUILTIN_DOCTRINE,
  Config,
  TOOL_NAME,
  UNKNOWNS_DOCTRINE,
  applyModelOverride,
  budgetInstruction,
  buildDoctrine,
  buildSystem,
  buildTool,
  callModel,
  cleanRewrite,
  complexityBudget,
  composeSystem,
  correctionInstruction,
  loadDoctrine,
  readConfig,
  reviewRewrite,
  splitItems,
  splitSections,
} from '../index.js'

const route = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' }
const PACKAGE_DIR = path.dirname(fileURLToPath(new URL('../index.js', import.meta.url)))

test('the doctrine keeps the ask-first section when the switch is on', () => {
  const on = buildDoctrine(true)
  assert.match(on, /先问再答：开/u)
  assert.match(on, /只问不答/u)
  assert.doesNotMatch(on, /先问再答：关/u)
})

test('the doctrine swaps the section when the switch is off', () => {
  const off = buildDoctrine(false)
  assert.match(off, /先问再答：关/u)
  assert.match(off, /我据此推断的前提/u)
  assert.match(off, /仍需要你确认的点/u)
  assert.doesNotMatch(off, /先问再答：开/u)
})

test('both doctrines still carry the shared rules', () => {
  for (const text of [buildDoctrine(true), buildDoctrine(false)]) {
    assert.match(text, /判据代替禁令/u)
    assert.match(text, /上下文五层/u)
    assert.match(text, /只输出改写后的提示词正文/u)
  }
})

test('buildDoctrine falls back to the built-in body when no base is given', () => {
  assert.match(buildDoctrine(true, ''), /判据代替禁令/u)
  assert.match(buildDoctrine(true, '   '), /判据代替禁令/u)
  assert.match(buildDoctrine(true, 'CUSTOM BASE'), /^CUSTOM BASE/u)
})

test('the shipped doctrine.md matches the built-in fallback', () => {
  assert.equal(
    loadDoctrine('', PACKAGE_DIR),
    BUILTIN_DOCTRINE,
    'doctrine.md 与 index.js 的 BUILTIN_DOCTRINE 不一致：改完规则文件后同步内置兜底副本',
  )
})

test('loadDoctrine reads a custom path, absolute or relative', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'prompt-forge-'))
  try {
    writeFileSync(path.join(dir, 'custom.md'), '自定义规则：只输出三行。\n', 'utf8')
    assert.equal(loadDoctrine('', dir), BUILTIN_DOCTRINE, 'missing doctrine.md in that dir falls back')
    assert.equal(loadDoctrine(path.join(dir, 'custom.md'), dir), '自定义规则：只输出三行。')
    assert.equal(loadDoctrine('custom.md', dir), '自定义规则：只输出三行。')
    assert.equal(loadDoctrine('nope.md', dir), BUILTIN_DOCTRINE, 'a missing custom file falls back')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('composeSystem appends the user rules only when present', () => {
  assert.equal(composeSystem('BASE', ''), 'BASE')
  assert.equal(composeSystem('BASE', '  '), 'BASE')
  assert.equal(composeSystem('BASE', 'RULES'), 'BASE\n\n## 用户追加要求（同等优先）\nRULES')
})

test('buildSystem serves the rewrite or the unknowns doctrine', () => {
  const knobs = { askFirst: true, extraRules: '', doctrinePath: '' }
  const rewrite = buildSystem('prompt', knobs)
  assert.match(rewrite, /提示词改写器/u)
  assert.match(rewrite, /先问再答：开/u)

  const unknowns = buildSystem('unknowns', knobs)
  assert.match(unknowns, /未知审查员/u)
  assert.match(unknowns, /只列出未知/u)
  assert.doesNotMatch(unknowns, /提示词改写器/u)

  const withRules = buildSystem('unknowns', { ...knobs, extraRules: '英文输出' })
  assert.match(withRules, /英文输出/u)
})

test('the unknowns doctrine asks for a numbered list and no rewrite', () => {
  assert.match(UNKNOWNS_DOCTRINE, /3–5 条/u)
  assert.match(UNKNOWNS_DOCTRINE, /不改写原文/u)
  assert.match(UNKNOWNS_DOCTRINE, /不要代码围栏/u)
})

test('readConfig reads a volatile ref', () => {
  const config = Config({})
  assert.equal(readConfig(config.askFirst, false), true)
  assert.equal(readConfig(config.temperature, 0), 0.35)
  assert.equal(readConfig(config.model, 'x'), '')
  assert.equal(readConfig(config.extraRules, 'y'), '')
  assert.equal(readConfig(config.doctrinePath, 'z'), '')
})

test('readConfig passes plain values and falls back when absent', () => {
  assert.equal(readConfig(false, true), false)
  assert.equal(readConfig('', 'fallback'), '')
  assert.equal(readConfig(undefined, 7), 7)
})

test('applyModelOverride keeps the route when the field is empty', () => {
  assert.deepEqual(applyModelOverride(route, ''), route)
  assert.deepEqual(applyModelOverride(route, '   '), route)
  assert.deepEqual(applyModelOverride(route, undefined), route)
})

test('applyModelOverride swaps the model or the whole route', () => {
  assert.deepEqual(applyModelOverride(route, 'glm-4.6'), { ...route, model: 'glm-4.6' })
  assert.deepEqual(applyModelOverride(route, 'openai/gpt-5'), { provider: 'openai', model: 'gpt-5' })
})

test('cleanRewrite strips fences and label lines', () => {
  assert.equal(cleanRewrite('```text\n目标：X\n```'), '目标：X')
  assert.equal(cleanRewrite('改写后的提示词：目标：X'), '目标：X')
  assert.equal(cleanRewrite('  目标：X  '), '目标：X')
})

test('buildTool exposes the tool name, schema, and a reject path', async () => {
  const tool = buildTool({ get: () => undefined }, Config({}))
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(tool.name, 'prompt_forge_optimize')
  assert.deepEqual(tool.parameters.required, ['prompt'])
  assert.deepEqual(tool.parameters.properties.mode.enum, ['prompt', 'unknowns'])
  assert.deepEqual(tool.output.render(undefined, { ok: true }), [{ type: 'text', text: '{"ok":true}' }])

  const empty = await tool.execute({ prompt: '  ' }, { signal: undefined })
  assert.deepEqual(empty, { ok: false, code: 'empty-prompt', message: 'prompt must be a non-empty string' })

  const noModel = await tool.execute({ prompt: '写个周报' }, { signal: undefined })
  assert.equal(noModel.ok, false)
  assert.equal(noModel.code, 'no-llm')
})

test('splitSections turns each Markdown heading into its own row', () => {
  assert.deepEqual(splitSections('前言一句\n\n## 目标\n做 A\n\n## 验收标准\n- 三条都可得\n'), [
    { heading: null, body: '前言一句' },
    { heading: '目标', body: '做 A' },
    { heading: '验收标准', body: '- 三条都可得' },
  ])
})

test('splitSections keeps heading-less text whole and drops empty input', () => {
  assert.deepEqual(splitSections('  一段没有标题的正文  '), [{ heading: null, body: '一段没有标题的正文' }])
  assert.deepEqual(splitSections(''), [])
  assert.deepEqual(splitSections('## 只有一个标题\n正文'), [{ heading: '只有一个标题', body: '正文' }])
})

test('splitSections falls back to label paragraphs when no heading exists', () => {
  const rows = splitSections(
    '先问再答：动手前先问我三个问题。\n\n目标：做 A。\n\n验收标准（可外部验证）：\n- 三条\n\n交付格式：两张表。',
  )
  assert.deepEqual(
    rows.map((row) => row.heading),
    ['先问再答', '目标', '验收标准（可外部验证）', '交付格式'],
  )
  assert.equal(rows[0].body, '动手前先问我三个问题。')
  assert.equal(rows[2].body, '- 三条')
})

test('splitItems keeps one row per numbered item', () => {
  const rows = splitItems('1. 问题一？——原因一\n\n2. 问题二？——原因二')
  assert.deepEqual(rows.map((row) => row.body), ['1. 问题一？——原因一', '2. 问题二？——原因二'])
  assert.deepEqual(rows.map((row) => row.heading), [null, null])
})

test('splitItems splits run-together items and keeps unnumbered paragraphs whole', () => {
  assert.deepEqual(splitItems('1. 一？——因为甲\n2. 二？——因为乙').map((row) => row.body), [
    '1. 一？——因为甲',
    '2. 二？——因为乙',
  ])
  assert.deepEqual(splitItems('只有一段话'), [{ heading: null, body: '只有一段话' }])
  assert.deepEqual(splitItems('  '), [])
})

test('complexityBudget scales with the draft instead of one fixed template', () => {
  const tiny = complexityBudget('把这段会议记录整理成三条待办，明天发群里。')
  assert.equal(tiny.tier, 'tiny')
  assert.equal(tiny.maxSections, 2)
  assert.equal(tiny.maxChars, 150)

  const normal = complexityBudget('x'.repeat(200))
  assert.equal(normal.tier, 'normal')
  assert.equal(normal.maxSections, 4)

  const large = complexityBudget('x'.repeat(800))
  assert.equal(large.tier, 'large')
  assert.equal(large.maxSections, 5)
  assert.equal(large.maxChars, 1200)
})

test('budgetInstruction states the numbers the answer has to hit', () => {
  assert.match(budgetInstruction(complexityBudget('短活')), /不超过 150 字、最多 2 节/u)
  assert.match(budgetInstruction(complexityBudget('x'.repeat(800))), /不超过 1200 字、最多 5 节/u)
})

test('reviewRewrite catches padding, vague criteria and repeated sections', () => {
  const budget = complexityBudget('把会议记录整理成三条待办。')
  const bloated = [
    '## 目标',
    '把会议记录整理成三条待办。',
    '## 背景与约束',
    '把会议记录整理成三条待办。',
    '## 验收标准',
    '要简洁、要清晰、要专业。',
    '## 交付格式',
    '把会议记录整理成三条待办，明天发群里。',
  ].join('\n')
  const issues = reviewRewrite(bloated, budget)
  assert.ok(issues.includes('too-many-sections'), 'four sections over a three-section budget')
  assert.ok(issues.includes('vague-criteria'), 'adjective criteria are flagged')
  assert.ok(issues.includes('duplicate-section'), 'the same goal restated twice is flagged')

  const clean = ['## 目标', '把会议记录整理成 3 条待办。', '## 验收标准（可外部验证）', '- 恰好 3 条；每条 ≤ 30 字，包含动作、负责人、截止时间。'].join('\n')
  assert.deepEqual(reviewRewrite(clean, budget), [])
})

test('reviewRewrite flags an answer that is far longer than its budget', () => {
  const budget = complexityBudget('短活')
  assert.ok(reviewRewrite('## 目标\n' + '很长的一句'.repeat(60), budget).includes('too-long'))
})

test('correctionInstruction names every issue it was given', () => {
  const text = correctionInstruction(['too-long', 'vague-criteria'], complexityBudget('短活'))
  assert.match(text, /压到 150 字以内/u)
  assert.match(text, /形容词判据/u)
})

test('callModel retries once when the rewrite blows past its budget', async () => {
  const draft = '把这段会议记录整理成三条待办。'
  const padded = '## 目标\n把会议记录整理成三条待办。\n## 背景与约束\n把会议记录整理成三条待办。\n## 验收标准\n要简洁、要清晰。\n## 交付格式\n把会议记录整理成三条待办。'
  const tight = '## 目标\n把会议记录整理成 3 条待办。\n## 验收标准（可外部验证）\n- 恰好 3 条；每条 ≤ 30 字，含动作与负责人。'
  const systems = []
  const llm = {
    listProviders: () => [],
    stream(options) {
      const answer = systems.length === 0 ? padded : tight
      systems.push(options.system)
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: answer }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => route }
      return undefined
    },
  }
  const result = await callModel(ctx, { mode: 'prompt', config: Config({}), text: draft })
  assert.equal(result.text, tight, 'the corrective pass replaces the padded answer')
  assert.equal(systems.length, 2, 'exactly one corrective pass')
  assert.match(systems[1], /重写要求/u)
  assert.match(systems[0], /这一次的篇幅预算/u)
})

test('callModel leaves an acceptable rewrite alone', async () => {
  const tight = '## 目标\n把会议记录整理成 3 条待办。\n## 验收标准（可外部验证）\n- 恰好 3 条；每条 ≤ 30 字，含动作与负责人。'
  let calls = 0
  const llm = {
    listProviders: () => [],
    stream() {
      calls += 1
      return (async function* () {
        yield { type: 'text-delta', index: 0, text: tight }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const ctx = {
    get: (name) => {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => route }
      return undefined
    },
  }
  const result = await callModel(ctx, { mode: 'prompt', config: Config({}), text: '把会议记录整理成三条待办。' })
  assert.equal(result.text, tight)
  assert.equal(calls, 1)
})
