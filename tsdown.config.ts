import { defineConfig } from 'tsdown'

/**
 * 插件的浏览器侧。dsh 客户端模块系统会以 /plugins/<id>/client.js 提供
 * 本文件，并期望懒加载 CJS 工厂产物：bundle 通过
 * window.__ModuleLoader__.load 注册自身，并通过注入的 `require` 解析其
 * externals（react、冻结模块表）。产出这一形态的仓库内置 preset 并未
 * 发布，因此本配置复现它：cjs 格式、browser 平台、banner/footer 包装、
 * .js 扩展名，以及平台模块表保持外部化。
 */
export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  platform: 'browser',
  dts: false,
  outDir: 'lib',
  // 宿主构建（tsc）也输出到 lib/；永远不要清空它。
  clean: false,
  outExtensions: () => ({ js: '.js' }),
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  outputOptions: {
    banner: 'window.__ModuleLoader__.load({ id: "dsh-prompt-history-plugin", factory: (require) => {',
    footer: 'return module.exports; } });',
    // 懒加载 CJS 工厂只提供 `require`；CJS bundle 直接引用
    // `exports`/`module`，因此在包装内定义它们。
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
