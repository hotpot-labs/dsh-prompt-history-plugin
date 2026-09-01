// @vitest-environment jsdom
/**
 * 针对 HistoryNav 组件的 DOM 级集成测试：真实渲染组件，在
 * `[data-composer-card] textarea`（rc.2 结构）上派发 keydown，
 * 断言 setDraft 调用与默认行为拦截。
 */
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apply } from '../src/client/index.js'
import { HISTORY_STORAGE_KEY } from '../src/client/history.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Props = Record<string, unknown>

/** 通过 apply() 捕获注册的 slot 组件。 */
function captureComponent(): React.ComponentType<Props> {
  let component: React.ComponentType<Props> | undefined
  const ctx = {
    slots: {
      inject: (_slot: string, factory: () => void) => factory(),
      register: (_def: unknown, comp: React.ComponentType<Props>) => {
        component = comp
      },
    },
  }
  apply(ctx as never)
  if (component === undefined) throw new Error('slot component not registered')
  return component
}

interface Harness {
  textarea: HTMLTextAreaElement
  state: { draft: string }
  setDraftCalls: string[]
  root: Root
  host: HTMLDivElement
  container: HTMLDivElement
}

async function renderNav(history: string[], draft: string): Promise<Harness> {
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))

  // rc.2 composer 结构：[data-composer-card] 内的原生 textarea
  const host = document.createElement('div')
  host.setAttribute('data-composer-card', '')
  const textarea = document.createElement('textarea')
  host.appendChild(textarea)
  document.body.appendChild(host)

  const state = { draft }
  const setDraftCalls: string[] = []
  const props: Props = {
    useInput: (selector: (s: { draft: string }) => unknown) => selector(state),
    // rc.2 标准 props：useSession 选择 ConversationSnapshot；无 user 节点
    useSession: (selector: (s: { nodes: readonly never[] }) => unknown) => selector({ nodes: [] }),
    inputActions: {
      setDraft: (text: string) => {
        setDraftCalls.push(text)
        state.draft = text
      },
    },
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const Comp = captureComponent()
  await act(async () => {
    root.render(React.createElement(Comp, props))
  })
  return { textarea, state, setDraftCalls, root, host, container }
}

/** 在元素上派发 keydown，返回默认行为是否被拦截。 */
function press(el: HTMLElement, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event.defaultPrevented
}

function setCaret(el: HTMLTextAreaElement, offset: number): void {
  el.selectionStart = offset
  el.selectionEnd = offset
}

let harness: Harness | undefined

afterEach(async () => {
  if (harness !== undefined) {
    const { root, host, container } = harness
    await act(async () => {
      root.unmount()
    })
    host.remove()
    container.remove()
    harness = undefined
  }
  window.localStorage.clear()
})

describe('HistoryNav 键盘交互（rc.2 textarea 结构）', () => {
  it('空草稿按 ↑ 回填最新一条，↑↓ 往返，越过最新恢复空草稿', async () => {
    harness = await renderNav(['第一条', '第二条'], '')
    const { textarea, setDraftCalls } = harness

    expect(press(textarea, 'ArrowUp')).toBe(true)
    expect(setDraftCalls).toEqual(['第二条'])

    expect(press(textarea, 'ArrowUp')).toBe(true)
    expect(setDraftCalls).toEqual(['第二条', '第一条'])

    expect(press(textarea, 'ArrowDown')).toBe(true)
    expect(setDraftCalls).toEqual(['第二条', '第一条', '第二条'])

    expect(press(textarea, 'ArrowDown')).toBe(true)
    expect(setDraftCalls).toEqual(['第二条', '第一条', '第二条', ''])
  })

  it('历史为空时 ↑/↓ 不拦截', async () => {
    harness = await renderNav([], '')
    expect(press(harness.textarea, 'ArrowUp')).toBe(false)
    expect(press(harness.textarea, 'ArrowDown')).toBe(false)
    expect(harness.setDraftCalls).toEqual([])
  })

  it('有文字且光标不在最前时 ↑ 不拦截（走默认光标移动）', async () => {
    harness = await renderNav(['历史'], '写到一半')
    harness.textarea.value = '写到一半'
    setCaret(harness.textarea, 2)
    expect(press(harness.textarea, 'ArrowUp')).toBe(false)
    expect(harness.setDraftCalls).toEqual([])
  })

  it('有文字且光标在最前时 ↑ 进入导航，↓ 越过最新恢复原草稿', async () => {
    harness = await renderNav(['历史'], '写到一半')
    harness.textarea.value = '写到一半'
    setCaret(harness.textarea, 0)

    expect(press(harness.textarea, 'ArrowUp')).toBe(true)
    expect(harness.setDraftCalls).toEqual(['历史'])

    // 越过最新一条：恢复暂存的草稿
    expect(press(harness.textarea, 'ArrowDown')).toBe(true)
    expect(harness.setDraftCalls).toEqual(['历史', '写到一半'])
  })

  it('导航中按 Escape 退出导航，之后 ↓ 不再拦截', async () => {
    harness = await renderNav(['历史'], '')
    expect(press(harness.textarea, 'ArrowUp')).toBe(true)
    expect(press(harness.textarea, 'Escape')).toBe(false)
    expect(press(harness.textarea, 'ArrowDown')).toBe(false)
    expect(harness.setDraftCalls).toEqual(['历史'])
  })

  it('焦点不在 composer 内时 ↑ 不拦截', async () => {
    harness = await renderNav(['历史'], '')
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    expect(press(outside, 'ArrowUp')).toBe(false)
    expect(harness.setDraftCalls).toEqual([])
    outside.remove()
  })
})
