import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
const root = new URL('../../', import.meta.url)
async function loadPage(name: string): Promise<React.ComponentType> {
  const source = await readFile(new URL(`../src/pages/${name}.tsx`, import.meta.url), 'utf8')
  const exports: { default?: React.ComponentType } = {}
  const modules: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': jsx,
    'react-router-dom': { Link: 'a', useNavigate: () => () => undefined },
    '../components/ui/Button': { Button: 'button' },
    '../components/ui/Brand': { Brand: 'img' }, '../styles/home-coach.css': {},
  }
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  runInNewContext(compiled, { exports, require: (name: string) => {
    assert.ok(name in modules, `Unexpected page dependency: ${name}`); return modules[name]
  } })
  assert.ok(exports.default)
  return exports.default
}
async function mount(name: string) {
  const Page = await loadPage(name)
  let tree!: ReactTestRenderer
  await act(async () => { tree = create(React.createElement(Page)) })
  return tree
}

test('actual data-processing page describes own-account permission, minimal disclosure and encrypted-backup limits', async () => {
  const tree = await mount('DataInfo')
  try {
    const text = JSON.stringify(tree.toJSON())
    for (const phrase of ['默认使用明确标注的规则回复', '配置本人的模型连接并同意外发范围', '本次教练页面明确选择',
      '当前文字与当前会话中已披露范围的有限历史', '不附加日记、账单或其他应用记录',
      '由你的服务商账户承担', '操作建议须先核对，再由你主动点击执行',
      '普通本地导出不包含服务器保存的 AI 连接密钥', '恢复时还需单独保管的原加密密钥']) assert.ok(text.includes(phrase), phrase)
    assert.ok(!text.includes('近期记录摘要调用已配置的模型提供方'))
  } finally { await act(async () => tree.unmount()) }
})

test('actual onboarding reaches the privacy step through Next and discloses optional personal-model scope', async () => {
  const tree = await mount('Onboarding')
  try {
    for (let step = 0; step < 3; step++) {
      const next = tree.root.findAllByType('button').find(node => node.children.includes('下一步'))
      assert.ok(next)
      await act(async () => next.props.onClick())
    }
    const text = JSON.stringify(tree.toJSON())
    for (const phrase of ['知道数据去了哪里', '教练消息会发给应用服务端，默认使用规则回复',
      '配置本人的模型连接、同意外发范围', '本次教练页面明确选择', '当前文字与已披露范围的有限会话历史',
      '不附加应用记录', '可能产生 API 费用']) assert.ok(text.includes(phrase), phrase)
    assert.ok(!text.includes('消息和相关记录摘要会发送'))
  } finally { await act(async () => tree.unmount()) }
})

test('all current UI and user-facing privacy/export documentation reject obsolete shared-model and business-context claims', async () => {
  const files: string[] = []
  async function collect(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (['.ts', '.tsx', '.json', '.html', '.md'].includes(extname(path))) files.push(path)
    }
  }
  await collect(new URL('youji-app/src/', root).pathname)
  await collect(new URL('youji-app/public/', root).pathname)
  for (const name of ['README.md', 'youji-app/README.md', 'docs/COPYRIGHT_CURRENT.md',
    'docs/COPYRIGHT_CANDIDATE.md', 'docs/USER_OWNED_AI_20261010.md', 'deploy/local/README.md']) files.push(new URL(name, root).pathname)
  const obsolete = [
    /问题与相关记录摘要会交给在线模型/u,
    /近期记录摘要调用已配置的模型提供方/u,
    /消息和相关记录摘要会发送至服务端及配置的模型服务/u,
    /服务端配置的兼容模型接口/u,
    /模型回复仅为文字建议/u,
    /LLM_API_KEY\/BASE_URL\/MODEL/u,
    /AI 驱动的生活记录与教练应用/u,
  ]
  assert.ok(files.length > 150)
  for (const path of files) {
    const text = await readFile(path, 'utf8')
    for (const phrase of obsolete) assert.doesNotMatch(text, phrase, relative(root.pathname, path))
  }
  const settings = await readFile(new URL('youji-app/src/pages/Settings.tsx', root), 'utf8')
  assert.ok(settings.includes('本地导出不包含服务器保存的 AI 连接密钥'))
})
