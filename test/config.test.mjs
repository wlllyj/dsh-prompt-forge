import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BUILTIN_DOCTRINE,
  CONFIG_DEFAULTS,
  Config,
  PACKAGE_NAME,
  UNKNOWNS_DOCTRINE,
  budgetInstruction,
  buildDoctrine,
  buildSystem,
  callModel,
  cleanRewrite,
  complexityBudget,
  configValues,
  correctionInstruction,
  loadDoctrine,
  normalizeConfigInput,
  pickConfigKeys,
  readConfig,
  reviewRewrite,
  reviewUnknowns,
  splitItems,
  splitSections,
  unknownsBudget,
  unknownsCorrection,
  unknownsInstruction,
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

test('pickConfigKeys drops keys the schema no longer declares', () => {
  assert.deepEqual(pickConfigKeys({ temperature: 0.5, model: 'x', extraRules: 'y', askFirst: false }), {
    temperature: 0.5,
    askFirst: false,
  })
  assert.deepEqual(pickConfigKeys(null), {})
})

test('buildSystem serves the rewrite or the unknowns doctrine', () => {
  const knobs = { askFirst: true, doctrinePath: '' }
  const rewrite = buildSystem('prompt', knobs)
  assert.match(rewrite, /提示词改写器/u)
  assert.match(rewrite, /先问再答：开/u)

  const unknowns = buildSystem('unknowns', knobs)
  assert.match(unknowns, /未知审查员/u)
  assert.match(unknowns, /只列出未知/u)
  assert.doesNotMatch(unknowns, /提示词改写器/u)
})

test('the unknowns doctrine asks for a short unnumbered list and no rewrite', () => {
  assert.match(UNKNOWNS_DOCTRINE, /没有那么多未知就少写几条/u)
  assert.match(UNKNOWNS_DOCTRINE, /不写解释/u)
  assert.match(UNKNOWNS_DOCTRINE, /不改写原文/u)
  assert.match(UNKNOWNS_DOCTRINE, /不要代码围栏/u)
  assert.doesNotMatch(UNKNOWNS_DOCTRINE, /3–5 条/u, 'the count now comes from the budget, not a fixed range')
})

test('readConfig reads a volatile ref', () => {
  const config = Config({})
  assert.equal(readConfig(config.askFirst, false), true)
  assert.equal(readConfig(config.temperature, 0), 0.8)
  assert.equal(readConfig(config.doctrinePath, 'z'), '')
})

test('readConfig passes plain values and falls back when absent', () => {
  assert.equal(readConfig(false, true), false)
  assert.equal(readConfig('', 'fallback'), '')
  assert.equal(readConfig(undefined, 7), 7)
})

test('cleanRewrite strips fences and label lines', () => {
  assert.equal(cleanRewrite('```text\n目标：X\n```'), '目标：X')
  assert.equal(cleanRewrite('改写后的提示词：目标：X'), '目标：X')
  assert.equal(cleanRewrite('  目标：X  '), '目标：X')
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

test('unknownsBudget shrinks the list for small tasks', () => {
  const tiny = unknownsBudget('把这段会议记录整理成三条待办，明天发群里。')
  assert.equal(tiny.tier, 'tiny')
  assert.equal(tiny.maxItems, 2)
  assert.equal(tiny.maxChars, 70)
  assert.equal(tiny.maxItemChars, 28)

  const normal = unknownsBudget('x'.repeat(200))
  assert.equal(normal.tier, 'normal')
  assert.equal(normal.maxItems, 5)

  const large = unknownsBudget('x'.repeat(800))
  assert.equal(large.tier, 'large')
  assert.equal(large.maxItems, 6)
})

test('unknownsInstruction states the count and the sizes', () => {
  assert.match(unknownsInstruction(unknownsBudget('短活')), /最多 2 条、整份不超过 70 字、每条不超过 28 字/u)
})

test('reviewUnknowns catches padding, verbosity and explanations', () => {
  const budget = unknownsBudget('把这段会议记录整理成三条待办，明天发群里。')
  const padded = [
    '1. 会议记录原文在哪里？——不知道原文就没法整理。',
    '2. 三条待办要分配给谁？——不知道负责人就没法分配。',
    '3. 要发到哪个群？——不知道群名就发不出去。',
  ].join('\n\n')
  const issues = reviewUnknowns(padded, budget)
  assert.ok(issues.includes('too-many-items'), 'three questions over a two-question budget')
  assert.ok(issues.includes('has-explanation'), 'the —— explanations are flagged')

  const wordy = ['1. 会议记录原文在哪里？', '2. 这三条待办分别要交给哪一位同事、按什么顺序做、做完由谁验收、如果对方没空又该由谁接手，请一并写清楚？'].join('\n\n')
  assert.ok(reviewUnknowns(wordy, budget).includes('item-too-long'), 'a single question over the line length is flagged')

  const clean = ['1. 会议记录原文在哪里？', '2. 三条待办分别交给谁？'].join('\n\n')
  assert.deepEqual(reviewUnknowns(clean, budget), [])
})

test('reviewUnknowns flags a list that is far longer than its budget', () => {
  const budget = unknownsBudget('短活')
  assert.ok(reviewUnknowns(`1. ${'很长的问句'.repeat(20)}？`, budget).includes('too-long'))
})

test('unknownsCorrection names every issue it was given', () => {
  const text = unknownsCorrection(['too-many-items', 'has-explanation'], unknownsBudget('短活'))
  assert.match(text, /最多 2 条/u)
  assert.match(text, /只写问句/u)
})

test('callModel retries once when the unknowns list is padded', async () => {
  const draft = '把这段会议记录整理成三条待办，明天发群里。'
  const padded = [
    '1. 会议记录原文在哪里？——不知道原文就没法整理。',
    '2. 三条待办要分配给谁？——不知道负责人就没法分配。',
    '3. 要发到哪个群？——不知道群名就发不出去。',
  ].join('\n\n')
  const clean = ['1. 会议记录原文在哪里？', '2. 三条待办分别交给谁？'].join('\n\n')
  const systems = []
  const llm = {
    listProviders: () => [],
    stream(options) {
      const answer = systems.length === 0 ? padded : clean
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
  const result = await callModel(ctx, { mode: 'unknowns', config: Config({}), text: draft })
  assert.equal(result.text, clean, 'the corrective pass replaces the padded list')
  assert.equal(systems.length, 2, 'exactly one corrective pass')
  assert.match(systems[0], /条数预算/u)
  assert.match(systems[1], /重写要求/u)
})

test('the settings defaults match the Config schema', () => {
  assert.equal(PACKAGE_NAME, 'dsh-prompt-forge')
  assert.deepEqual(Object.keys(CONFIG_DEFAULTS).sort(), ['askFirst', 'doctrinePath', 'temperature'])
  assert.equal(CONFIG_DEFAULTS.temperature, 0.8)
  assert.equal(CONFIG_DEFAULTS.askFirst, true)
  const shaped = Config({})
  assert.deepEqual(configValues(shaped), { ...CONFIG_DEFAULTS })
})

test('configValues reads volatile refs the same way the request path does', () => {
  const config = Config({ temperature: 1.1, askFirst: false })
  const values = configValues(config)
  assert.equal(values.temperature, 1.1)
  assert.equal(values.askFirst, false)
  assert.equal(values.doctrinePath, '')
})

test('normalizeConfigInput trims, clamps and rejects the wrong types', () => {
  const accepted = normalizeConfigInput({
    temperature: 9,
    askFirst: false,
    doctrinePath: '  ./rules.md ',
    ignored: 'x',
  })
  assert.deepEqual(accepted.errors, [])
  assert.deepEqual(accepted.patch, {
    temperature: 2,
    askFirst: false,
    doctrinePath: './rules.md',
  })

  const rejected = normalizeConfigInput({ temperature: 'hot', askFirst: 'yes', doctrinePath: [] })
  assert.deepEqual(rejected.errors.sort(), ['askFirst', 'doctrinePath', 'temperature'])
  assert.deepEqual(rejected.patch, {})

  assert.deepEqual(normalizeConfigInput(null).errors, ['body'])
  assert.deepEqual(normalizeConfigInput([1]).errors, ['body'])
})

test('normalizeConfigInput keeps a half-correct submission usable', () => {
  const result = normalizeConfigInput({ temperature: -3, askFirst: 'nope' })
  assert.deepEqual(result.errors, ['askFirst'])
  assert.deepEqual(result.patch, { temperature: 0 })
})
