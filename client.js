/**
 * Prompt Forge — Client half.
 *
 * One pill in the composer tool row (`conversation.input.left`). It hands the
 * draft to the Host half, swaps the composer text for the rewrite, and toggles
 * back to the original wording.
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-forge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'prompt-forge'
    const SLOT = 'conversation.input.left'
    const ENDPOINT = 'promptforge/optimize'

    const ZH = {
      'button.optimize': 'Prompt',
      'button.optimizing': '改写中…',
      'button.original': '↩ 原文',
      'button.optimized': '✦ 优化版',
      'tip.optimize': '按 AI 使用心法改写输入框里的提示词',
      'tip.optimizing': '正在改写，请稍候',
      'tip.original': '切回原提示词',
      'tip.optimized': '切回优化后的提示词',
      'error.empty': '先写点内容，再点 Prompt',
      'error.failed': '改写失败',
      'error.offline': '连不上改写服务',
    }
    const EN = {
      'button.optimize': 'Prompt',
      'button.optimizing': 'Rewriting…',
      'button.original': '↩ Original',
      'button.optimized': '✦ Optimized',
      'tip.optimize': 'Rewrite the draft by the AI-usage doctrine',
      'tip.optimizing': 'Rewriting, please wait',
      'tip.original': 'Switch back to the original prompt',
      'tip.optimized': 'Switch back to the optimized prompt',
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

    /** POST the draft to the Host half and resolve the rewritten text. */
    async function requestRewrite(text, t) {
      let response
      try {
        response = await fetch(ENDPOINT, {
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
      const optimized = payload.value?.optimized
      if (typeof optimized !== 'string' || optimized.trim() === '') throw new Error(t('error.failed'))
      return optimized
    }

    /**
     * The composer pill: optimize, then toggle optimized <-> original.
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
      const [error, setError] = React.useState(null)
      const [hover, setHover] = React.useState(false)

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

      const onClick = () => {
        if (busy) return
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
        requestRewrite(draft, t)
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
      const disabled = busy || (pair === null && draft.trim() === '')

      return h(
        'div',
        { 'data-prompt-forge': 'seat', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: '0' } },
        h(
          'button',
          {
            type: 'button',
            'data-prompt-forge': 'button',
            'data-state': busy ? 'busy' : pair === null ? 'idle' : view,
            onClick,
            disabled,
            title,
            'aria-label': title,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            style: {
              ...baseStyle,
              background: hover && !disabled ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
              opacity: disabled ? 0.45 : 1,
              cursor: disabled ? 'default' : 'pointer',
              color: pair !== null && view === 'optimized'
                ? 'var(--dsw-alias-label-primary-bluish)'
                : 'var(--dsw-alias-label-secondary)',
            },
          },
          label,
        ),
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
      },
    }
  },
})
