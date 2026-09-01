/**
 * 提示词历史的纯逻辑层：localStorage 持久化 + readline 风格导航游标。
 *
 * 不依赖 React / DOM，构造时注入 storage 接口，便于单元测试。
 */

/** 浏览器 localStorage 的最小结构类型。 */
export interface KeyValueStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export const HISTORY_STORAGE_KEY = 'dsh-prompt-history:v1'
export const HISTORY_LIMIT = 100

/**
 * 跨会话持久化的提示词历史。最新条目在数组末尾。
 */
export class HistoryStore {
  private entries: string[]

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key: string = HISTORY_STORAGE_KEY,
    private readonly limit: number = HISTORY_LIMIT,
  ) {
    this.entries = this.load()
  }

  /** 当前全部历史（只读视图，旧 → 新）。 */
  list(): readonly string[] {
    return this.entries
  }

  /**
   * 记录一条已提交的提示词。
   *
   * - 空白文本（trim 后为空）直接忽略；
   * - 已存在的条目去重并移到末尾（最近使用优先）；
   * - 超过上限时丢弃最旧的条目。
   * @param text - 用户提交的提示词原文。
   */
  push(text: string): void {
    if (text.trim() === '') return
    const existing = this.entries.indexOf(text)
    if (existing !== -1) {
      this.entries.splice(existing, 1)
    }
    this.entries.push(text)
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit)
    }
    this.save()
  }

  private load(): string[] {
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    } catch {
      return []
    }
  }

  private save(): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(this.entries))
    } catch {
      // 存储不可用（隐私模式 / 配额满）时退化为纯内存历史。
    }
  }
}

/**
 * readline 风格的历史导航游标。
 *
 * - 未激活时 `prev(draft)` 暂存当前草稿（stash）并从最新一条开始进入
 *   导航模式（readline 语义）；
 * - `next()` 越过最新一条时返回 stash（恢复进入导航前的草稿）并退出
 *   导航模式；
 * - 任何非导航按键应由调用方触发 `reset()` 退出导航模式。
 */
export class HistoryNavigation {
  /** 当前指向的历史下标；null 表示未在导航。 */
  private index: number | null = null
  /** 进入导航时的未发送草稿，越过最新一条时恢复。 */
  private stash = ''

  constructor(private readonly store: Pick<HistoryStore, 'list'>) {}

  /** 是否处于导航模式。 */
  get active(): boolean {
    return this.index !== null
  }

  /**
   * 向旧移动一条。历史为空返回 null；到达最旧一条后停住不动。
   * @param currentDraft - 当前草稿；仅在激活瞬间被暂存，之后调用忽略。
   */
  prev(currentDraft = ''): string | null {
    const entries = this.store.list()
    if (entries.length === 0) return null
    if (this.index === null) {
      this.stash = currentDraft
      this.index = entries.length - 1
    } else if (this.index > 0) {
      this.index -= 1
    }
    return entries[this.index] ?? null
  }

  /**
   * 向新移动一条。未在导航返回 null；越过最新一条时恢复进入导航前的
   * 草稿（stash）并退出导航模式。
   */
  next(): string | null {
    if (this.index === null) return null
    const entries = this.store.list()
    this.index += 1
    if (this.index >= entries.length) {
      this.index = null
      const stash = this.stash
      this.stash = ''
      return stash
    }
    return entries[this.index] ?? null
  }

  /** 退出导航模式并丢弃暂存的草稿。 */
  reset(): void {
    this.index = null
    this.stash = ''
  }
}

/** 会话快照中 user 消息节点的最小结构类型。 */
export interface UserMessageNodeLike {
  kind: string
  seq: number
  content?: readonly { type: string; text?: string }[]
}

/**
 * 从 user 消息节点提取提示词纯文本（拼接所有 text block）。
 * @param node - 会话快照节点。
 * @returns 非 user 节点或无文本内容时返回 null。
 */
export function extractUserPromptText(node: UserMessageNodeLike): string | null {
  if (node.kind !== 'user' || !node.content) return null
  const text = node.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
  return text.trim() === '' ? null : text
}
