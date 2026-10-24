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
  buildDoctrine,
  buildSystem,
  buildTool,
  cleanRewrite,
  composeSystem,
  loadDoctrine,
  readConfig,
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
