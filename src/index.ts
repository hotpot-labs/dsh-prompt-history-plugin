/**
 * dsh-prompt-history-plugin host 侧入口。
 *
 * 本插件的全部功能都在浏览器端（client entry），host 侧不需要任何
 * 服务或 RPC channel，这里仅提供 bundle 解析所需的空入口。
 */
export const name = 'dsh-prompt-history-plugin'

/**
 * @param _ctx - Cordis host context（未使用）。
 */
export function apply(_ctx: unknown): void {}
