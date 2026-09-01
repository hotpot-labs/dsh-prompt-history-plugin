# dsh-prompt-history-plugin

[DeepSeek Harness (dsh)](https://github.com/deepseek-harness/deepseek-harness) web 的输入历史导航插件。在对话输入框中按 **↑ / ↓** 即可浏览之前提交过的提示词并回填到输入框，就像 shell 的历史记录一样。历史保存在浏览器本地（`localStorage`），跨会话共享。

![预览](.github/assets/preview.gif)

[English README](README.md)

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-prompt-history-plugin
```

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:hotpot-labs/dsh-prompt-history-plugin
```

## 使用

1. 在 dsh web 中打开任意会话。
2. 输入框**为空**，或**光标已在最前面**时，按 **↑** 回填最近一条提示词；继续按 **↑** 逐条向旧浏览，按 **↓** 逐条向新浏览。
3. 输入框有文字时，第一次按 **↑** 走默认行为把光标移到最前，再按一次 **↑** 进入历史导航；进入时你写到一半的草稿会被暂存。
4. 在最新一条上再按 **↓** 恢复暂存的草稿（或空输入框）并退出历史导航。
5. 导航过程中按任意可打印键、**Enter**、**Backspace** 或 **Escape** 退出导航模式（按键本身照常生效）。

## 功能特性

- **shell 风格历史导航**：↑ 向旧、↓ 向新，readline 式草稿暂存——翻完历史还能切回你原来写到一半的内容。
- **自动记录**：凡是被宿主真实接受的提交都会入历史——无论用 Enter 还是发送按钮提交。
- **跨会话持久化**：历史存于 `localStorage`（键 `dsh-prompt-history:v1`），上限 100 条，去重并按最近使用排序。
- **零冲突**：导航只在草稿为空或光标位于最前时启动，不会抢 `/`、`@` 触发菜单或多行草稿光标移动的 ↑/↓；IME 输入法组合期间的按键一律放行。
- **无额外 UI**：插件不渲染任何可见元素，只为现有输入框增加行为。

## 开发

### 工作原理

本插件是纯 web client bundle。client 入口向 `conversation.composer.dock` slot 注册一个渲染 `null` 的组件，借此获得 session 作用域的标准 props：

- `useConversation`（新版 cohort）或 `useSession`（0.1.1-rc.2，其快照同为 `ConversationSnapshot`）：订阅会话快照，diff 出新出现的 `user` 节点，提取其 text block 写入历史存储。只有被宿主接受的提交才会被记录。
- `useInput`：镜像当前草稿，供键盘处理器同步读取。
- `inputActions.setDraft(text)`：把历史条目回填进输入框。

键盘监听挂在 `document` 的**捕获阶段**，只要焦点在 composer 输入框内（新版为 `[data-composer-input]` contenteditable，0.1.1-rc.2 为 `[data-composer-card]` 内的原生 textarea）且满足导航前提，就能先于宿主自身的处理器截获 ↑/↓。

### 构建与测试

```sh
npm install
npm run build       # host（tsc）+ client（tsdown，懒加载 CJS 包装）
npm run typecheck
npm test
npm pack --dry-run  # 确认 tarball 只包含 lib/ + patch + README
```

本地安装到 dsh profile：

```sh
dsh plugin --profile web add ./dsh-prompt-history-plugin
```

## 常见问题

**为什么输入框里有文字时，第一次按 ↑ 只是光标移到最前？**
这是刻意设计：光标不在最前时 ↑ 保持默认的光标移动，光标到最前后再按 ↑ 才进入历史导航。这样 ↑/↓ 永远不会与光标移动和 `/`、`@` 触发菜单冲突。进入导航时未发送的草稿会被暂存，按 ↓ 越过最新一条即可切回。

**历史存在哪里？**
浏览器的 `localStorage`，键为 `dsh-prompt-history:v1`。清除站点数据会一并清掉历史。历史不会发送到任何其他地方。

**斜杠命令也会被记录吗？**
会。只要在会话中表现为 user 节点的消息都会被记录，包括以 `/` 开头的消息。
