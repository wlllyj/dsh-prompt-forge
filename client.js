/**
 * Prompt Forge — Client half.
 *
 * Two pills in the composer tool row (`conversation.input.left`):
 *   ✦ Prompt   rewrite the draft, then toggle optimized <-> original
 *   未知       list only the unknowns (no rewrite), shown in the dock panel
 * The panel above the composer card (`conversation.input.dock`) renders that
 * list and can insert it into the draft.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-forge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'prompt-forge'
    const SLOT = 'conversation.input.left'
    const DOCK = 'conversation.input.dock'
    const ENDPOINT_OPTIMIZE = 'promptforge/optimize'
    const ENDPOINT_UNKNOWNS = 'promptforge/unknowns'

    const ZH = {
      'button.optimize': '✦ Prompt',
      'button.optimizing': '改写中…',
      'button.original': '↩ 原文',
      'button.optimized': '✦ 优化版',
      'tip.optimize': '按 AI 使用心法改写输入框里的提示词',
      'tip.optimizing': '正在改写，请稍候',
      'tip.original': '切回原提示词',
      'tip.optimized': '切回优化后的提示词',
      'button.unknowns': '未知',
      'button.unknownsBusy': '找未知…',
      'tip.unknowns': '只列出你没考虑到的未知，不改写正文',
      'unknowns.title': '未知清单（先回答这些，再让我动手）',
      'unknowns.insert': '插入到输入框',
      'unknowns.close': '关闭',
      'error.empty': '先写点内容，再点 Prompt',
      'error.failed': '改写失败',
      'error.offline': '连不上改写服务',
    }
    const EN = {
      'button.optimize': '✦ Prompt',
      'button.optimizing': 'Rewriting…',
      'button.original': '↩ Original',
      'button.optimized': '✦ Optimized',
      'tip.optimize': 'Rewrite the draft by the AI-usage doctrine',
      'tip.optimizing': 'Rewriting, please wait',
      'tip.original': 'Switch back to the original prompt',
      'tip.optimized': 'Switch back to the optimized prompt',
      'button.unknowns': 'Unknowns',
      'button.unknownsBusy': 'Scanning…',
      'tip.unknowns': 'List what you have not considered, without rewriting',
      'unknowns.title': 'Unknowns (answer these before I start)',
      'unknowns.insert': 'Insert into the composer',
      'unknowns.close': 'Close',
      'error.empty': 'Type something first',
      'error.failed': 'Rewrite failed',
      'error.offline': 'Cannot reach the rewrite service',
    }

    /** Stable fallback selector for seats without a composer state. */
    const noDraft = (selector) => selector({ draft: '' })

    /** The pill's base look; hover/disabled variants are added per render. */
    const baseStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: '26px',
      padding: '0 9px',
      borderRadius: '999px',
      border: '1px solid var(--dsw-alias-border-l)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '12px',
      lineHeight: '1',
      fontFamily: 'inherit',
      whiteSpace: 'nowrap',
    }

    /** Link-style button used inside the unknowns panel. */
    const linkStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      height: '20px',
      padding: '0 6px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: '11px',
      lineHeight: '1',
      fontFamily: 'inherit',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }

    /**
     * The unknowns panel is a second slot entry, so the two halves of the
     * feature talk through one module-level store instead of React context.
     */
    const unknownsStore = {
      state: { text: '', original: '' },
      listeners: new Set(),
      get() {
        return unknownsStore.state
      },
      set(next) {
        unknownsStore.state = next
        for (const listener of Array.from(unknownsStore.listeners)) listener()
      },
      subscribe(listener) {
        unknownsStore.listeners.add(listener)
        return () => unknownsStore.listeners.delete(listener)
      },
    }

    /** Subscribe to the store from a component. */
    function useUnknowns() {
      const [state, setState] = React.useState(unknownsStore.get())
      React.useEffect(() => unknownsStore.subscribe(() => setState(unknownsStore.get())), [])
      return state
    }

    /** POST one draft to a Host endpoint and resolve its text. */
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
      const result = payload.value?.text
      if (typeof result !== 'string' || result.trim() === '') throw new Error(t('error.failed'))
      return result
    }

    /**
     * The composer pills: optimize with a toggle, or list the unknowns.
     * @param {object} props standard kit for the slot (useInput / inputActions / t).
     */
    function PromptForgeButton(props) {
      const useInput = typeof props.useInput === 'function' ? props.useInput : noDraft
      const draftRaw = useInput((state) => (state === undefined ? '' : state.draft))
      const draft = typeof draftRaw === 'string' ? draftRaw : ''
      const t = typeof props.t === 'function' ? props.t : (key) => ZH[key] ?? key
      const actions = props.inputActions

      /** Both wordings of the last optimization, kept while the box still holds one. */
      const [pair, setPair] = React.useState(null)
      const [view, setView] = React.useState('original')
      const [busy, setBusy] = React.useState(false)
      const [unknownBusy, setUnknownBusy] = React.useState(false)
      const [hover, setHover] = React.useState(null)
      const [error, setError] = React.useState(null)

      // The user edited the box: the stored pair no longer describes it.
      React.useEffect(() => {
        if (pair === null) return
        if (draft === pair.original || draft === pair.optimized) return
        setPair(null)
        setView('original')
      }, [draft, pair])

      React.useEffect(() => {
        if (error === null) return
        const timer = setTimeout(() => setError(null), 6000)
        return () => clearTimeout(timer)
      }, [error])

      const writeDraft = (text) => {
        if (actions !== undefined && typeof actions.setDraft === 'function') actions.setDraft(text)
      }

      const onOptimize = () => {
        if (busy || unknownBusy) return
        if (pair !== null) {
          if (view === 'optimized') {
            writeDraft(pair.original)
            setView('original')
          } else {
            writeDraft(pair.optimized)
            setView('optimized')
          }
          return
        }
        if (draft.trim() === '') {
          setError(t('error.empty'))
          return
        }
        setBusy(true)
        setError(null)
        request(ENDPOINT_OPTIMIZE, draft, t)
          .then((optimized) => {
            setPair({ original: draft, optimized })
            setView('optimized')
            writeDraft(optimized)
          })
          .catch((reason) => {
            setError(reason instanceof Error && reason.message !== '' ? reason.message : t('error.failed'))
          })
          .finally(() => setBusy(false))
      }

      const onUnknowns = () => {
        if (busy || unknownBusy) return
        if (draft.trim() === '') {
          setError(t('error.empty'))
          return
        }
        setUnknownBusy(true)
        setError(null)
        request(ENDPOINT_UNKNOWNS, draft, t)
          .then((text) => unknownsStore.set({ text, original: draft }))
          .catch((reason) => {
            setError(reason instanceof Error && reason.message !== '' ? reason.message : t('error.failed'))
          })
          .finally(() => setUnknownBusy(false))
      }

      let label = t('button.optimize')
      let title = t('tip.optimize')
      if (busy) {
        label = t('button.optimizing')
        title = t('tip.optimizing')
      } else if (pair !== null && view === 'optimized') {
        label = t('button.original')
        title = t('tip.original')
      } else if (pair !== null) {
        label = t('button.optimized')
        title = t('tip.optimized')
      }
      const disabled = busy || unknownBusy || (pair === null && draft.trim() === '')
      const unknownLabel = unknownBusy ? t('button.unknownsBusy') : t('button.unknowns')
      const unknownDisabled = busy || unknownBusy || draft.trim() === ''

      const pill = (key, text, tip, onClick, isDisabled, active) =>
        h(
          'button',
          {
            type: 'button',
            'data-prompt-forge': key,
            onClick,
            disabled: isDisabled,
            title: tip,
            'aria-label': tip,
            onMouseEnter: () => setHover(key),
            onMouseLeave: () => setHover((current) => (current === key ? null : current)),
            style: {
              ...baseStyle,
              background: hover === key && !isDisabled ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
              opacity: isDisabled ? 0.45 : 1,
              cursor: isDisabled ? 'default' : 'pointer',
              color: active ? 'var(--dsw-alias-label-primary-bluish)' : 'var(--dsw-alias-label-secondary)',
            },
          },
          text,
        )

      return h(
        'div',
        {
          'data-prompt-forge': 'seat',
          style: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: '0' },
        },
        pill('button', label, title, onOptimize, disabled, pair !== null && view === 'optimized'),
        pill('unknowns', unknownLabel, t('tip.unknowns'), onUnknowns, unknownDisabled, false),
        error === null
          ? null
          : h(
            'span',
            {
              'data-prompt-forge': 'error',
              title: error,
              style: {
                fontSize: '11px',
                color: 'var(--dsw-alias-state-error-primary)',
                maxWidth: '220px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            },
            error,
          ),
      )
    }

    /**
     * The unknowns panel above the composer card. Renders nothing until the
     * "未知" pill has produced a list.
     * @param {object} props standard kit for the dock slot.
     */
    function PromptForgeUnknownsPanel(props) {
      const state = useUnknowns()
      const t = typeof props.t === 'function' ? props.t : (key) => ZH[key] ?? key
      const useInput = typeof props.useInput === 'function' ? props.useInput : noDraft
      const draftRaw = useInput((socket) => (socket === undefined ? '' : socket.draft))
      const draft = typeof draftRaw === 'string' ? draftRaw : ''
      const actions = props.inputActions

      if (state.text === '') return null

      const insert = () => {
        if (actions === undefined || typeof actions.setDraft !== 'function') return
        const head = draft.trim()
        actions.setDraft(head === '' ? state.text : `${head}\n\n${state.text}`)
        unknownsStore.set({ text: '', original: '' })
      }

      return h(
        'div',
        {
          'data-prompt-forge': 'unknowns-panel',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            margin: '0 0 8px',
            padding: '8px 10px',
            border: '1px solid var(--dsw-alias-border-l)',
            borderRadius: '10px',
            maxHeight: '38vh',
            overflow: 'auto',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(
            'span',
            { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } },
            t('unknowns.title'),
          ),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', { type: 'button', onClick: insert, style: linkStyle }, t('unknowns.insert')),
          h('button', { type: 'button', onClick: () => unknownsStore.set({ text: '', original: '' }), style: linkStyle }, t('unknowns.close')),
        ),
        h(
          'div',
          {
            style: {
              fontSize: '12px',
              lineHeight: '1.7',
              color: 'var(--dsw-alias-label-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            },
          },
          state.text,
        ),
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
              { name: DOCK, id: 'prompt-forge-unknowns', order: 130, locale: NS },
              PromptForgeUnknownsPanel,
            )
          } catch {
            return () => {}
          }
        })
      },
    }
  },
})
