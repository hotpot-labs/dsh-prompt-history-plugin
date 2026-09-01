/**
 * dsh-prompt-history-plugin 浏览器端入口。
 *
 * 在 `conversation.composer.dock` slot 注册一个渲染 null 的组件，
 * 借助 session 作用域 slot 的标准 props（useConversation 或 useSession /
 * useInput / inputActions）：
 *
 * 1. 订阅会话快照，把新出现的 user 消息节点记录进 localStorage 历史；
 * 2. 在 document 捕获阶段监听 keydown——焦点在 composer
 *    （新版 `[data-composer-input]` contenteditable，rc.2 为
 *    `[data-composer-card]` 内的 textarea）且满足启动条件时，
 *    ↑ 进入历史导航并逐条向旧回填，↓ 向新回填、越过最新一条恢复
 *    进入导航前的草稿（stash）。
 *
 * 会话快照 hook 兼容两个 cohort：新版 ui-conversation 在 session 标准
 * props 里提供 `useConversation`；0.1.1-rc.2 只提供 `useSession`，但其
 * 选择的就是同一个 ConversationSnapshot。两者都缺席时退化为只导航
 * （沿用 localStorage 里已有的历史），不记录、不崩溃。
 *
 * ↑ 的启动条件是「草稿为空，或光标已在最前」：输入框有文字时第一次
 * 按 ↑ 走默认行为把光标移到最前，再按一次才进入导航，因此不会与
 * `/`、`@` 触发菜单及多行编辑的光标移动争夺 ↑/↓；IME 组合期间的
 * 按键一律放行。
 */
import * as React from 'react'

import { extractUserPromptText, HistoryNavigation, HistoryStore } from './history.js'

const PLUGIN_NAME = 'dsh-prompt-history-plugin'

/** 宿主 SnapshotSelectorHook 的最小结构类型。 */
type SnapshotSelectorHook<S> = <T>(selector: (snapshot: S) => T) => T

interface InputState {
  readonly draft: string
}

interface ConversationSnapshot {
  readonly nodes: readonly {
    kind: string
    seq: number
    content?: readonly { type: string; text?: string }[]
  }[]
}

interface InputActions {
  setDraft: (text: string) => void
}

/** session 作用域 slot 组件自动获得的标准 props（只取用到的部分）。 */
interface HistoryNavProps {
  /** 新版 cohort：会话快照选择器 hook。 */
  useConversation?: SnapshotSelectorHook<ConversationSnapshot>
  /** 0.1.1-rc.2：session hook 选择的就是 ConversationSnapshot。 */
  useSession?: SnapshotSelectorHook<ConversationSnapshot>
  useInput: SnapshotSelectorHook<InputState>
  inputActions: InputActions
}

/** composer 输入框的稳定选择器：新版为 Lexical contenteditable
 * （`[data-composer-input]`），0.1.1-rc.2 为 `[data-composer-card]` 内的
 * 原生 textarea。 */
const COMPOSER_SELECTOR = '[data-composer-input], [data-composer-card] textarea'

/**
 * 判断光标是否位于输入框最前（光标前没有任何字符）。
 * rc.2 的原生 textarea 直接读 selectionStart；新版 Lexical
 * contenteditable 用 Selection range 探测光标前的文本是否为空。
 * @param el - 匹配到的 composer 元素（textarea 本体或 contenteditable 根）。
 */
function caretAtStart(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) {
    return el.selectionStart === 0 && el.selectionEnd === 0
  }
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  const probe = range.cloneRange()
  probe.selectNodeContents(el)
  probe.setEnd(range.startContainer, range.startOffset)
  return probe.toString() === ''
}

/**
 * 历史导航行为组件。渲染 null，不产出任何 UI。
 */
function HistoryNav(props: HistoryNavProps): null {
  const { useInput, inputActions } = props
  // 双 cohort 兼容：优先 useConversation，退回 rc.2 的 useSession
  // （其快照同为 ConversationSnapshot）。该 prop 身份随 session 绑定
  // 稳定，切换会话时组件整体重挂载，不存在中途换 hook 的问题。
  const useSnapshot = props.useConversation ?? props.useSession

  const storeRef = React.useRef<HistoryStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = new HistoryStore(window.localStorage)
  }
  const navRef = React.useRef<HistoryNavigation | null>(null)
  if (navRef.current === null) {
    navRef.current = new HistoryNavigation(storeRef.current)
  }

  // 记录新提交的 user 消息。首个快照（挂载 / 切换会话时的回放）只标记
  // 已见，不重复记录——它们当初提交时已经入过历史。
  const nodes = useSnapshot !== undefined
    ? useSnapshot((snapshot) => snapshot.nodes)
    : undefined
  const seenSeqsRef = React.useRef<Set<number> | null>(null)
  React.useEffect(() => {
    const store = storeRef.current
    if (!store || nodes === undefined) return
    if (seenSeqsRef.current === null) {
      seenSeqsRef.current = new Set(nodes.map((node) => node.seq))
      return
    }
    const seen = seenSeqsRef.current
    for (const node of nodes) {
      if (seen.has(node.seq)) continue
      seen.add(node.seq)
      const text = extractUserPromptText(node)
      if (text !== null) store.push(text)
    }
  }, [nodes])

  // 镜像当前草稿，供 keydown handler 同步读取。
  const draft = useInput((state) => state.draft)
  const draftRef = React.useRef(draft)
  draftRef.current = draft

  const inputActionsRef = React.useRef(inputActions)
  inputActionsRef.current = inputActions

  React.useEffect(() => {
    const store = storeRef.current
    const nav = navRef.current
    if (!store || !nav) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const composer = typeof target?.closest === 'function' ? target.closest(COMPOSER_SELECTOR) : null
      if (composer === null) {
        // 焦点离开 composer 时退出导航模式。
        if (nav.active) nav.reset()
        return
      }

      // IME 组合期间与带修饰键的快捷键一律放行。
      if (event.isComposing || event.keyCode === 229) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (store.list().length === 0) return

        if (event.key === 'ArrowUp') {
          // 启动条件：草稿为空，或光标已在最前（光标前没有任何字符）。
          // 有文字且光标不在最前时放行默认行为（光标先移到最前），
          // 再按一次 ↑ 才进入导航——不与 `/`、`@` 触发菜单及多行
          // 编辑的光标移动冲突。进入导航时暂存当前草稿（stash），
          // ↓ 越过最新一条时恢复。
          if (!nav.active) {
            const current = draftRef.current
            if (current.trim() !== '' && !caretAtStart(composer)) return
          }
          const value = nav.prev(draftRef.current)
          if (value === null) return
          event.preventDefault()
          event.stopPropagation()
          inputActionsRef.current.setDraft(value)
          return
        }

        // ArrowDown：仅在导航模式中有意义。
        if (!nav.active) return
        event.preventDefault()
        event.stopPropagation()
        const value = nav.next()
        // next() 越过最新一条时返回 stash，恢复进入导航前的草稿。
        inputActionsRef.current.setDraft(value ?? '')
        return
      }

      // 导航模式中按其他键（输入字符、删除、Enter、Escape）退出导航，
      // 按键本身不拦截、照常生效。
      if (nav.active) nav.reset()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return null
}

export const name = PLUGIN_NAME

export const inject = ['slots'] as const

interface SlotDefinition {
  name: string
  id: string
  order: number
}

interface SlotsService {
  inject: (slot: string, factory: () => void) => void
  register: (def: SlotDefinition, component: React.ComponentType<HistoryNavProps>) => void
}

interface Context {
  slots: SlotsService
}

/**
 * 注册 composer dock 上的历史导航行为。
 * @param ctx - Cordis client context。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'prompt-history',
        order: 100,
      },
      HistoryNav,
    ),
  )
}
