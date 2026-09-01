import { describe, expect, it } from 'vitest'

import {
  extractUserPromptText,
  HistoryNavigation,
  HistoryStore,
  type KeyValueStorage,
} from '../src/client/history.js'

/** 内存版 storage，替代浏览器 localStorage。 */
function createMemoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

describe('HistoryStore', () => {
  it('starts empty when storage has no value', () => {
    const store = new HistoryStore(createMemoryStorage())
    expect(store.list()).toEqual([])
  })

  it('pushes entries newest-last and persists them', () => {
    const storage = createMemoryStorage()
    const store = new HistoryStore(storage)
    store.push('第一条')
    store.push('second prompt')
    expect(store.list()).toEqual(['第一条', 'second prompt'])

    // 重新构造（模拟下次打开浏览器）能读回历史
    const reloaded = new HistoryStore(storage)
    expect(reloaded.list()).toEqual(['第一条', 'second prompt'])
  })

  it('ignores blank text', () => {
    const store = new HistoryStore(createMemoryStorage())
    store.push('')
    store.push('   \n  ')
    expect(store.list()).toEqual([])
  })

  it('dedupes by moving the existing entry to the end', () => {
    const store = new HistoryStore(createMemoryStorage())
    store.push('a')
    store.push('b')
    store.push('a')
    expect(store.list()).toEqual(['b', 'a'])
  })

  it('drops the oldest entries beyond the limit', () => {
    const store = new HistoryStore(createMemoryStorage(), 'test-key', 3)
    store.push('1')
    store.push('2')
    store.push('3')
    store.push('4')
    expect(store.list()).toEqual(['2', '3', '4'])
  })

  it('falls back to empty history on corrupted storage', () => {
    const storage = createMemoryStorage()
    storage.setItem('dsh-prompt-history:v1', '{not json')
    const store = new HistoryStore(storage)
    expect(store.list()).toEqual([])

    storage.setItem('dsh-prompt-history:v1', '[1, "ok", null]')
    const filtered = new HistoryStore(storage)
    expect(filtered.list()).toEqual(['ok'])
  })

  it('survives storage write failures', () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const store = new HistoryStore(broken)
    store.push('in-memory only')
    expect(store.list()).toEqual(['in-memory only'])
  })
})

describe('HistoryNavigation', () => {
  function setup(entries: string[]) {
    const storage = createMemoryStorage()
    const store = new HistoryStore(storage)
    for (const entry of entries) store.push(entry)
    return { store, nav: new HistoryNavigation(store) }
  }

  it('starts inactive and prev() enters navigation at the newest entry', () => {
    const { nav } = setup(['a', 'b', 'c'])
    expect(nav.active).toBe(false)
    expect(nav.prev()).toBe('c')
    expect(nav.active).toBe(true)
  })

  it('walks back to the oldest entry and stays there', () => {
    const { nav } = setup(['a', 'b'])
    expect(nav.prev()).toBe('b')
    expect(nav.prev()).toBe('a')
    expect(nav.prev()).toBe('a')
  })

  it('next() past the newest entry restores the empty draft and exits', () => {
    const { nav } = setup(['a', 'b'])
    nav.prev()
    nav.prev()
    expect(nav.next()).toBe('b')
    expect(nav.next()).toBe('')
    expect(nav.active).toBe(false)
  })

  it('stashes the current draft on activation and restores it past the newest entry', () => {
    const { nav } = setup(['a', 'b'])
    // 输入框有文字时光标在最前激活导航，暂存草稿
    expect(nav.prev('写到一半的草稿')).toBe('b')
    expect(nav.prev('写到一半的草稿')).toBe('a')
    expect(nav.next()).toBe('b')
    // 越过最新一条恢复 stash 而不是空串
    expect(nav.next()).toBe('写到一半的草稿')
    expect(nav.active).toBe(false)
  })

  it('stash is only captured at activation, not on later prev() calls', () => {
    const { nav } = setup(['a'])
    nav.prev('原始草稿')
    nav.prev('被忽略的值')
    expect(nav.next()).toBe('原始草稿')
  })

  it('reset() drops the stash', () => {
    const { nav } = setup(['a'])
    nav.prev('原始草稿')
    nav.reset()
    expect(nav.active).toBe(false)
    // 重新进入按空 stash 处理
    expect(nav.prev()).toBe('a')
    expect(nav.next()).toBe('')
  })

  it('next() is a no-op when not navigating', () => {
    const { nav } = setup(['a'])
    expect(nav.next()).toBeNull()
  })

  it('prev() on empty history returns null and stays inactive', () => {
    const { nav } = setup([])
    expect(nav.prev()).toBeNull()
    expect(nav.active).toBe(false)
  })

  it('reset() exits navigation mode', () => {
    const { nav } = setup(['a', 'b'])
    nav.prev()
    expect(nav.active).toBe(true)
    nav.reset()
    expect(nav.active).toBe(false)
    // 重新进入时又从最新一条开始
    expect(nav.prev()).toBe('b')
  })
})

describe('extractUserPromptText', () => {
  it('joins text blocks of user nodes', () => {
    const text = extractUserPromptText({
      kind: 'user',
      seq: 1,
      content: [
        { type: 'text', text: '你好' },
        { type: 'image' },
        { type: 'text', text: '世界' },
      ],
    })
    expect(text).toBe('你好\n世界')
  })

  it('returns null for non-user nodes', () => {
    expect(
      extractUserPromptText({ kind: 'assistant', seq: 2, content: [{ type: 'text', text: 'x' }] }),
    ).toBeNull()
  })

  it('returns null for user nodes without text', () => {
    expect(extractUserPromptText({ kind: 'user', seq: 3 })).toBeNull()
    expect(extractUserPromptText({ kind: 'user', seq: 4, content: [] })).toBeNull()
    expect(extractUserPromptText({ kind: 'user', seq: 5, content: [{ type: 'text', text: '  ' }] })).toBeNull()
  })
})
