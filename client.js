/**
 * Prompt Forge — Client half.
 *
 * One pill in the composer tool row (`conversation.input.left`): `✦ Prompt`.
 * It opens a panel above the composer card (`conversation.input.dock`) with three
 * tabs — rewrite the draft, list the unknowns it hides, or edit this plugin's own
 * settings. The two generation tabs never touch the draft: each answer arrives as
 * pickable rows, and the user decides which rows to replace the draft with or
 * append to it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-forge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'prompt-forge'
    const SLOT = 'conversation.input.left'
    const DOCK = 'conversation.input.dock'
    /** One endpoint per generation tab; the Host answers both with `{ text, parts }`. */
    const ENDPOINTS = { prompt: 'promptforge/optimize', unknowns: 'promptforge/unknowns' }
    /** The settings endpoint: GET the live values, POST a new set. */
    const CONFIG_ENDPOINT = 'promptforge/config'
    /** The tabs, in display order. */
    const TABS = ['prompt', 'unknowns', 'settings']
    /** The settings form's fields, in display order (model follows the chat, not a field). */
    const FIELDS = [
      { name: 'temperature', kind: 'number', hint: 'settings.temperatureHint' },
      { name: 'askFirst', kind: 'checkbox', hint: 'settings.askFirstHint' },
      { name: 'doctrinePath', kind: 'text', placeholder: 'settings.doctrinePathPlaceholder' },
    ]

    const ZH = {
      'button.open': '✦ Prompt',
      'tip.open': '按提示词心法改写草稿，或先列出未知；结果勾选后再放进输入框',
      'panel.title': 'Prompt Forge',
      'tab.prompt': '改写提示词',
      'tab.unknowns': '未知清单',
      'hint.prompt': '改写不会直接覆盖草稿：勾选要用的段落，再决定替换还是追加。',
      'hint.unknowns': '只列出你没考虑到的未知，不改写正文。回答完这些，再让 AI 动手。',
      'action.run.prompt': '生成改写',
      'action.run.unknowns': '扫描未知',
      'action.busy': '生成中…',
      'action.retry': '重试',
      'action.selectAll': '全选',
      'action.selectNone': '清空',
      'action.replace': '替换草稿',
      'action.append': '追加到末尾',
      'action.close': '关闭',
      'error.empty': '先写点内容，再点 Prompt',
      'error.failed': '生成失败',
      'error.offline': '连不上改写服务',
      'error.nothing': '先勾选要放进输入框的部分',
      'tab.settings': '设置',
      'hint.settings': '改动写进 profile 的插件配置行，保存后立即生效，不用重启。',
      'settings.loading': '读取配置…',
      'settings.loadFailed': '读取配置失败',
      'settings.saveFailed': '保存失败',
      'settings.saved': '已保存',
      'settings.modelNote': '模型：跟随当前对话，不单独设置',
      'settings.temperature': '温度',
      'settings.temperatureHint': '0–2，越低越贴原文，越高越敢改结构，默认 1',
      'settings.askFirst': '先问再答',
      'settings.askFirstHint': '改写稿里加入「先提出三个内行必问的问题」的开场',
      'settings.doctrinePath': '规则文件',
      'settings.doctrinePathPlaceholder': '自定义规则文件路径，留空用插件自带的 doctrine.md',
      'action.save': '保存',
      'action.saving': '保存中…',
      'action.restore': '恢复默认',
      'action.reload': '重新读取',
    }
    const EN = {
      'button.open': '✦ Prompt',
      'tip.open': 'Rewrite the draft by the prompt doctrine, or list its unknowns first',
      'panel.title': 'Prompt Forge',
      'tab.prompt': 'Rewrite',
      'tab.unknowns': 'Unknowns',
      'hint.prompt': 'The draft is not overwritten: pick the rows you want, then replace or append.',
      'hint.unknowns': 'Only the unknowns you have not considered. Answer them before the AI starts.',
      'action.run.prompt': 'Rewrite it',
      'action.run.unknowns': 'Scan unknowns',
      'action.busy': 'Working…',
      'action.retry': 'Try again',
      'action.selectAll': 'All',
      'action.selectNone': 'None',
      'action.replace': 'Replace draft',
      'action.append': 'Append',
      'action.close': 'Close',
      'error.empty': 'Type something first',
      'error.failed': 'Generation failed',
      'error.offline': 'Cannot reach the rewrite service',
      'error.nothing': 'Pick at least one row first',
      'tab.settings': 'Settings',
      'hint.settings': 'Saved into your profile plugin config; effective immediately, no restart.',
      'settings.loading': 'Reading settings…',
      'settings.loadFailed': 'Could not read the settings',
      'settings.saveFailed': 'Could not save',
      'settings.saved': 'Saved',
      'settings.modelNote': 'Model: follows this conversation, not configurable',
      'settings.temperature': 'Temperature',
      'settings.temperatureHint': '0–2: lower stays close to the draft, higher reshapes it; default 1',
      'settings.askFirst': 'Ask first',
      'settings.askFirstHint': 'Open the rewrite with three insider questions to answer first',
      'settings.doctrinePath': 'Doctrine file',
      'settings.doctrinePathPlaceholder': 'Custom rules file; empty uses the bundled doctrine.md',
      'action.save': 'Save',
      'action.saving': 'Saving…',
      'action.restore': 'Restore defaults',
      'action.reload': 'Reload',
    }

    /** Stable fallback selector for seats without a composer state. */
    const noDraft = (selector) => selector({ draft: '' })

    /** The pill's base look; hover/active variants are added per render. */
    const pillStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: '26px',
      padding: '0 9px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      lineHeight: '1',
      fontFamily: 'inherit',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }

    /** Small bordered button used inside the panel. */
    const buttonStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      height: '22px',
      padding: '0 8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '11px',
      lineHeight: '1',
      fontFamily: 'inherit',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    /** The tab strip and one tab. */
    const tabStyle = (active) => ({
      ...buttonStyle,
      border: active ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
      color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
    })

    /** One pickable answer row. */
    const rowStyle = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '6px 8px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l1)',
      cursor: 'pointer',
    }

    /** Text of one row, keeping the model's line breaks. */
    const rowTextStyle = {
      fontSize: '12px',
      lineHeight: '1.65',
      color: 'var(--dsw-alias-label-primary)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      minWidth: '0',
    }

    /** One settings input; matches the theme's recessed surface. */
    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '5px 8px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      fontSize: '12px',
      lineHeight: '1.5',
      outline: 'none',
    }

    /** The label above one settings input. */
    const fieldLabelStyle = {
      fontSize: '11px',
      fontWeight: 600,
      color: 'var(--dsw-alias-label-secondary)',
    }

    /** The pill and the panel are two slot entries, so they share this store. */
    const emptyBucket = () => ({ status: 'idle', parts: [], selected: [], error: '' })
    /** The settings the Host ships with; the form starts from these. */
    const EMPTY_CONFIG = { temperature: 1, askFirst: true, doctrinePath: '' }
    const emptySettings = () => ({
      status: 'idle',
      values: EMPTY_CONFIG,
      defaults: null,
      saving: false,
      saved: false,
      error: '',
    })
    const store = {
      state: {
        open: false,
        tab: 'prompt',
        prompt: emptyBucket(),
        unknowns: emptyBucket(),
        settings: emptySettings(),
      },
      listeners: new Set(),
      get() {
        return store.state
      },
      set(patch) {
        store.state = { ...store.state, ...patch }
        store.emit()
      },
      bucket(tab) {
        return store.state[tab]
      },
      setBucket(tab, patch) {
        store.state = { ...store.state, [tab]: { ...store.state[tab], ...patch } }
        store.emit()
      },
      emit() {
        for (const listener of Array.from(store.listeners)) listener()
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => store.listeners.delete(listener)
      },
    }

    /** Subscribe to the store from a component. */
    function useStore() {
      const [state, setState] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setState(store.get())), [])
      return state
    }

    /**
     * POST one draft to a Host endpoint and resolve its rows.
     * @param {string} path the endpoint, relative to the GUI base.
     * @param {string} text the draft.
     * @param {(key: string) => string} t locale lookup.
     * @returns {Promise<{ heading: string | null, body: string }[]>} the rows.
     */
    async function request(path, text, t) {
      let response
      try {
        response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      } catch {
        throw new Error(t('error.offline'))
      }
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`${t('error.failed')} (HTTP ${response.status})`)
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        const message = payload?.error?.message
        throw new Error(typeof message === 'string' && message !== '' ? message : t('error.failed'))
      }
      const value = payload.value
      const rows = []
      if (Array.isArray(value?.parts)) {
        for (const part of value.parts) {
          const body = typeof part?.body === 'string' ? part.body : ''
          if (body.trim() === '') continue
          rows.push({ heading: typeof part.heading === 'string' ? part.heading : null, body })
        }
      }
      if (rows.length === 0 && typeof value?.text === 'string' && value.text.trim() !== '') {
        rows.push({ heading: null, body: value.text.trim() })
      }
      if (rows.length === 0) throw new Error(t('error.failed'))
      return rows
    }

    /** Rebuild Markdown from the selected rows. */
    function joinRows(rows) {
      return rows
        .map((row) => (row.heading === null ? row.body : `## ${row.heading}\n${row.body}`))
        .join('\n\n')
        .trim()
    }

    /**
     * Read the plugin's live settings from the Host.
     * @param {(key: string) => string} t locale lookup.
     * @returns {Promise<void>} resolves when the store is updated.
     */
    function readConfig(t) {
      store.set({ settings: { ...store.get().settings, status: 'loading', error: '' } })
      return fetch(CONFIG_ENDPOINT, { headers: { accept: 'application/json' } })
        .then((response) => response.json())
        .then((payload) => {
          if (payload?.ok !== true) throw new Error(payload?.error?.message ?? t('settings.loadFailed'))
          const value = payload?.value
          store.set({
            settings: {
              status: 'ready',
              values: { ...EMPTY_CONFIG, ...(value?.values ?? {}) },
              defaults: { ...EMPTY_CONFIG, ...(value?.defaults ?? {}) },
              saving: false,
              saved: false,
              error: '',
            },
          })
        })
        .catch((reason) => {
          const message = reason instanceof Error && reason.message !== '' ? reason.message : t('settings.loadFailed')
          store.set({ settings: { ...store.get().settings, status: 'error', error: message } })
        })
    }

    /**
     * Persist a set of settings through the Host (which writes the profile patch).
     * @param {object} values the full settings object.
     * @param {(key: string) => string} t locale lookup.
     * @returns {Promise<void>} resolves when the store is updated.
     */
    function saveConfig(values, t) {
      store.set({ settings: { ...store.get().settings, saving: true, saved: false, error: '' } })
      return fetch(CONFIG_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: values }),
      })
        .then((response) => response.json())
        .then((payload) => {
          if (payload?.ok !== true) throw new Error(payload?.error?.message ?? t('settings.saveFailed'))
          const value = payload?.value
          store.set({
            settings: {
              status: 'ready',
              values: { ...EMPTY_CONFIG, ...(value?.values ?? {}) },
              defaults: { ...EMPTY_CONFIG, ...(value?.defaults ?? store.get().settings.defaults ?? {}) },
              saving: false,
              saved: true,
              error: '',
            },
          })
        })
        .catch((reason) => {
          const message = reason instanceof Error && reason.message !== '' ? reason.message : t('settings.saveFailed')
          store.set({ settings: { ...store.get().settings, saving: false, saved: false, error: message } })
        })
    }

    /**
     * The single composer pill: opens or closes the panel.
     * @param {object} props standard kit for the slot (t).
     */
    function PromptForgeButton(props) {
      const state = useStore()
      const t = typeof props.t === 'function' ? props.t : (key) => ZH[key] ?? key
      const [hover, setHover] = React.useState(false)
      const active = state.open

      return h(
        'button',
        {
          type: 'button',
          'data-prompt-forge': 'button',
          onClick: () => store.set({ open: !store.get().open }),
          title: t('tip.open'),
          'aria-label': t('tip.open'),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            ...pillStyle,
            background: hover && !active ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
            color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
            border: active ? '1px solid var(--dsw-alias-brand-primary)' : '1px solid var(--dsw-alias-border-l1)',
          },
        },
        t('button.open'),
      )
    }

    /**
     * The panel above the composer card: tabs, one answer, pickable rows.
     * @param {object} props standard kit for the dock slot (useInput / inputActions / t).
     */
    function PromptForgePanel(props) {
      const state = useStore()
      const t = typeof props.t === 'function' ? props.t : (key) => ZH[key] ?? key
      const useInput = typeof props.useInput === 'function' ? props.useInput : noDraft
      const draftRaw = useInput((input) => (input === undefined ? '' : input.draft))
      const draft = typeof draftRaw === 'string' ? draftRaw : ''
      const actions = props.inputActions
      const [busy, setBusy] = React.useState(false)
      const tab = TABS.includes(state.tab) ? state.tab : 'prompt'
      const isSettings = tab === 'settings'
      const bucket = isSettings ? emptyBucket() : state[tab]

      /** Load the settings the first time the settings tab is shown. */
      React.useEffect(() => {
        if (!state.open || !isSettings) return
        if (store.get().settings.status === 'idle') readConfig(t)
      }, [state.open, isSettings])

      if (!state.open) return null

      const run = () => {
        if (busy) return
        if (draft.trim() === '') {
          store.setBucket(tab, { status: 'error', error: t('error.empty'), parts: [], selected: [] })
          return
        }
        setBusy(true)
        store.setBucket(tab, { status: 'busy', error: '', parts: [], selected: [] })
        request(ENDPOINTS[tab], draft, t)
          .then((rows) => {
            store.setBucket(tab, { status: 'done', parts: rows, selected: rows.map(() => true), error: '' })
          })
          .catch((reason) => {
            const message = reason instanceof Error && reason.message !== '' ? reason.message : t('error.failed')
            store.setBucket(tab, { status: 'error', error: message, parts: [], selected: [] })
          })
          .finally(() => setBusy(false))
      }

      const toggle = (index) => {
        const selected = bucket.selected.slice()
        selected[index] = !selected[index]
        store.setBucket(tab, { selected })
      }

      const selectAll = (value) => {
        store.setBucket(tab, { selected: bucket.parts.map(() => value) })
      }

      const deliver = (mode) => {
        const picked = bucket.parts.filter((_row, index) => bucket.selected[index] === true)
        if (picked.length === 0) {
          store.setBucket(tab, { status: 'error', error: t('error.nothing') })
          return
        }
        if (actions === undefined || typeof actions.setDraft !== 'function') return
        const text = joinRows(picked)
        if (mode === 'append') {
          const head = draft.trim()
          actions.setDraft(head === '' ? text : `${head}\n\n${text}`)
        } else {
          actions.setDraft(text)
        }
        store.set({ open: false })
        store.setBucket(tab, { status: 'idle', parts: [], selected: [], error: '' })
      }

      const pickedCount = bucket.parts.filter((_row, index) => bucket.selected[index] === true).length

      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
        h(
          'span',
          { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } },
          t('panel.title'),
        ),
        ...TABS.map((name) =>
          h(
            'button',
            {
              key: name,
              type: 'button',
              'data-prompt-forge': `tab-${name}`,
              onClick: () => store.set({ tab: name }),
              style: tabStyle(name === tab),
            },
            t(`tab.${name}`),
          ),
        ),
        h('span', { style: { flex: '1 1 auto' } }),
        h('button', { type: 'button', onClick: () => store.set({ open: false }), style: buttonStyle }, t('action.close')),
      )

      const hint = h('div', {
        style: { fontSize: '11px', lineHeight: '1.5', color: 'var(--dsw-alias-state-idle-primary)' },
      }, t(`hint.${tab}`))

      let body
      let footer
      if (isSettings) {
        const settings = state.settings
        const values = settings.values ?? EMPTY_CONFIG
        const setField = (name, value) => {
          const current = store.get().settings
          store.set({
            settings: {
              ...current,
              values: { ...(current.values ?? EMPTY_CONFIG), [name]: value },
              saved: false,
              error: '',
            },
          })
        }
        const fields = FIELDS.map((field) => {
          const value = values[field.name]
          let control
          if (field.kind === 'checkbox') {
            control = h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              h('input', {
                type: 'checkbox',
                checked: value === true,
                onChange: (event) => setField(field.name, event.target.checked),
                style: { accentColor: 'var(--dsw-alias-brand-primary)', margin: 0 },
              }),
              h(
                'span',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                field.hint === undefined ? '' : t(field.hint),
              ),
            )
          } else if (field.kind === 'textarea') {
            control = h('textarea', {
              rows: 3,
              value: String(value ?? ''),
              placeholder: field.placeholder === undefined ? '' : t(field.placeholder),
              onChange: (event) => setField(field.name, event.target.value),
              style: { ...inputStyle, resize: 'vertical', minHeight: '54px' },
            })
          } else {
            const numeric = field.kind === 'number'
            control = h('input', {
              type: numeric ? 'number' : 'text',
              min: numeric ? '0' : undefined,
              max: numeric ? '2' : undefined,
              step: numeric ? '0.05' : undefined,
              value: String(value ?? ''),
              placeholder: field.placeholder === undefined ? '' : t(field.placeholder),
              onChange: (event) => setField(field.name, numeric ? Number(event.target.value) : event.target.value),
              style: inputStyle,
            })
          }
          return h(
            'label',
            { key: field.name, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: fieldLabelStyle }, t(`settings.${field.name}`)),
            control,
            field.kind !== 'checkbox' && field.hint !== undefined
              ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-idle-primary)' } }, t(field.hint))
              : null,
          )
        })
        const statusLine = settings.saving
          ? t('action.busy')
          : settings.saved
            ? t('settings.saved')
            : ''
        body =
          settings.status === 'idle' || settings.status === 'loading'
            ? h(
              'div',
              { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', padding: '6px 2px' } },
              t('settings.loading'),
            )
            : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              h(
                'div',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                t('settings.modelNote'),
              ),
              ...fields,
              settings.error !== ''
                ? h(
                  'span',
                  { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } },
                  settings.error,
                )
                : null,
            )
        footer = h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              'data-prompt-forge': 'save',
              onClick: () => {
                if (!settings.saving) saveConfig(store.get().settings.values ?? EMPTY_CONFIG, t)
              },
              style: buttonStyle,
            },
            settings.saving ? t('action.saving') : t('action.save'),
          ),
          h(
            'button',
            {
              type: 'button',
              'data-prompt-forge': 'restore',
              onClick: () => {
                if (!settings.saving) saveConfig(store.get().settings.defaults ?? EMPTY_CONFIG, t)
              },
              style: buttonStyle,
            },
            t('action.restore'),
          ),
          settings.status === 'error'
            ? h(
              'button',
              { type: 'button', onClick: () => readConfig(t), style: buttonStyle },
              t('action.reload'),
            )
            : null,
          h('span', { style: { flex: '1 1 auto' } }),
          h(
            'span',
            { style: { fontSize: '11px', color: 'var(--dsw-alias-state-idle-primary)' } },
            statusLine,
          ),
        )
      } else if (busy || bucket.status === 'busy') {
        body = h(
          'div',
          { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', padding: '6px 2px' } },
          t('action.busy'),
        )
      } else if (bucket.status === 'done' && bucket.parts.length > 0) {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          ...bucket.parts.map((row, index) =>
            h(
              'label',
              {
                key: `${tab}-${index}`,
                'data-prompt-forge': 'row',
                style: {
                  ...rowStyle,
                  background:
                    bucket.selected[index] === true ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
                },
              },
              h('input', {
                type: 'checkbox',
                checked: bucket.selected[index] === true,
                onChange: () => toggle(index),
                style: { marginTop: '2px', accentColor: 'var(--dsw-alias-brand-primary)' },
              }),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' } },
                row.heading === null
                  ? null
                  : h(
                    'span',
                    { style: { fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } },
                    row.heading,
                  ),
                h('span', { style: rowTextStyle }, row.body),
              ),
            ),
          ),
        )
      } else {
        body = h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h('button', { type: 'button', 'data-prompt-forge': 'run', onClick: run, style: buttonStyle }, t(`action.run.${tab}`)),
          bucket.status === 'error'
            ? h(
              'span',
              { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } },
              bucket.error === '' ? t('error.failed') : bucket.error,
            )
            : null,
        )
      }

      footer =
        bucket.status === 'done' && bucket.parts.length > 0
          ? h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
            h('button', { type: 'button', onClick: () => selectAll(true), style: buttonStyle }, t('action.selectAll')),
            h('button', { type: 'button', onClick: () => selectAll(false), style: buttonStyle }, t('action.selectNone')),
            h('span', { style: { flex: '1 1 auto' } }),
            h(
              'span',
              { style: { fontSize: '11px', color: 'var(--dsw-alias-state-idle-primary)' } },
              `${pickedCount}/${bucket.parts.length}`,
            ),
            h(
              'button',
              { type: 'button', 'data-prompt-forge': 'replace', onClick: () => deliver('replace'), style: buttonStyle },
              t('action.replace'),
            ),
            h(
              'button',
              { type: 'button', 'data-prompt-forge': 'append', onClick: () => deliver('append'), style: buttonStyle },
              t('action.append'),
            ),
          )
          : bucket.status === 'error'
            ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              h('button', { type: 'button', onClick: run, style: buttonStyle }, t('action.retry')),
            )
            : null

      return h(
        'div',
        {
          'data-prompt-forge': 'panel',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            margin: '0 0 8px',
            padding: '10px 12px',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: '10px',
            background: 'var(--dsw-alias-bg-layer-1)',
            maxHeight: '28vh',
            overflow: 'auto',
          },
        },
        header,
        hint,
        body,
        footer,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, { zh: ZH, en: EN })
          } catch {
            return () => {}
          }
        }, 'dsh-prompt-forge: dictionaries')

        ctx.slots.inject(SLOT, () => {
          try {
            return ctx.slots.register(
              { name: SLOT, id: 'prompt-forge', order: 1100, locale: NS },
              PromptForgeButton,
            )
          } catch {
            return () => {}
          }
        })

        ctx.slots.inject(DOCK, () => {
          try {
            return ctx.slots.register(
              { name: DOCK, id: 'prompt-forge-panel', order: 130, locale: NS },
              PromptForgePanel,
            )
          } catch {
            return () => {}
          }
        })
      },
    }
  },
})
