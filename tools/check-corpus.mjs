/**
 * 语料库自检：`node tools/check-corpus.mjs`
 *
 * 它**不测任何实现**，只测「语料库本身有没有写错」。实现方的 runner 才测实现。
 * 用途：
 *  1. 每次改夹具 / 改协议后，确认语料库仍然自洽（引用能解析、期望有据、畸形真的畸形）。
 *  2. 给实现方一个可照抄的「什么算合法」的判定代码。
 *
 * 退出码 0 = 全部通过；1 = 有失败项（会逐条打印）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DIR = join(ROOT, 'fixtures', '1.0')

const results = []
const pass = (id, msg) => results.push({ id, ok: true, msg })
const fail = (id, msg) => results.push({ id, ok: false, msg })
function check(id, condition, msg) {
  if (condition) pass(id, msg)
  else fail(id, msg)
  return Boolean(condition)
}

// ── 基础工具 ───────────────────────────────────────────────────────

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const readText = (name) => readFileSync(join(DIR, name), 'utf8')
const readBuf = (name) => readFileSync(join(DIR, name))

/** 极小 ZIP 读取（store / deflate-raw），只认中央目录 */
async function readZip(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件')
  const count = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = new TextDecoder().decode(bytes.slice(pointer + 46, pointer + 46 + nameLength))
    pointer += 46 + nameLength + extraLength + commentLength
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.slice(start, start + compressedSize)
    out.set(name, method === 0 ? raw : await inflate(raw))
  }
  return out
}

async function inflate(raw) {
  if (typeof DecompressionStream === 'undefined') throw new Error('当前 Node 不支持解压 deflate')
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function depthOf(value, depth = 1) {
  if (!value || typeof value !== 'object') return depth
  let max = depth
  for (const child of Object.values(value)) max = Math.max(max, depthOf(child, depth + 1))
  return max
}

const MIME_MAGIC = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/gif': [0x47, 0x49, 0x46, 0x38],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
  'image/avif': [0x00, 0x00, 0x00, 0x20],
}

function magicMatches(mime, buffer) {
  const magic = MIME_MAGIC[mime]
  if (!magic) return mime === 'image/svg+xml' ? /<svg/i.test(buffer.slice(0, 512).toString('utf8')) : true
  return magic.every((byte, index) => buffer[index] === byte)
}

/** 合法 key 与引用格式 */
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/
const REF_RE = /^(character|event|country|worldEntry|tag|period|world|map):([A-Za-z0-9._-]{1,64})$/

const SECTION_TYPES = {
  characters: 'character',
  events: 'event',
  countries: 'country',
  worldEntries: 'worldEntry',
  tags: 'tag',
  periods: 'period',
  worlds: 'world',
  maps: 'map',
}

/** 遍历对象里所有看起来像引用的字符串（只查已知语义的字段，避免误判正文） */
const REF_FIELDS = new Set(['parent', 'country', 'source', 'target', 'avatar', 'image', 'cover', 'thumbnail'])

function collectRefs(value, out = [], path = '') {
  if (typeof value === 'string') {
    if (value.startsWith('asset:')) out.push({ kind: 'asset', value: value.slice(6), path })
    else if (REF_RE.test(value) && (REF_FIELDS.has(path.split('.').pop()) || path.endsWith('[]'))) {
      out.push({ kind: 'ref', value, path })
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out, `${path}[]`)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectRefs(child, out, path ? `${path}.${key}` : key)
  }
  return out
}

// ── 1. 清单与哈希 ──────────────────────────────────────────────────

const indexPath = join(DIR, 'index.json')
if (!existsSync(indexPath)) {
  console.error('缺少 index.json，先跑 node tools/build-fixtures.mjs')
  process.exit(1)
}
const index = JSON.parse(readFileSync(indexPath, 'utf8'))

check('index', index.protocol === '1.0', 'index.protocol 为 1.0')
check('index', index.fixtures.length >= 10, `清单条目 ${index.fixtures.length} 个（>= 10）`)

for (const item of index.fixtures) {
  const id = item.id
  if (!item.file) {
    fail(id, '清单缺 file 字段')
    continue
  }
  if (!existsSync(join(DIR, item.file))) fail(id, `夹具文件不存在：${item.file}`)
  else {
    const actual = sha256(readBuf(item.file))
    check(id, actual === item.sha256, `sha256 与清单一致（${actual.slice(0, 12)}…）`)
  }
  if (!existsSync(join(DIR, item.expect))) fail(id, `期望文件不存在：${item.expect}`)
  else {
    const actual = sha256(readBuf(item.expect))
    check(id, actual === item.expectSha256, '期望文件 sha256 与清单一致')
  }
}

// ── 2. 期望文件自身结构 ────────────────────────────────────────────

for (const item of index.fixtures) {
  const id = item.id
  let exp
  try {
    exp = JSON.parse(readText(item.expect))
  } catch {
    fail(id, '期望文件不是合法 JSON')
    continue
  }
  check(id, exp.fixture === id, '期望文件 fixture 与 id 一致')
  check(id, exp.protocol === '1.0', '期望文件写明 protocol 1.0')
  check(id, Array.isArray(exp.levels) && exp.levels.length > 0, '期望文件声明 levels')
  check(id, Array.isArray(exp.checks) && exp.checks.length > 0, '期望文件声明 checks')
  check(id, exp.expect && typeof exp.expect === 'object', '期望文件有 expect 主体')

  const body = exp.expect ?? {}
  const numbers = []
  if (body.read) for (const [k, v] of Object.entries(body.read)) if (!Number.isInteger(v) || v < 0) fail(id, `expect.read.${k} 不是非负整数`)
  if (body.relations?.edges !== undefined) numbers.push(['relations.edges', body.relations.edges])
  if (body.assets) for (const [k, v] of Object.entries(body.assets)) numbers.push([`assets.${k}`, v])
  for (const [name, value] of numbers) check(id, Number.isInteger(value) && value >= 0, `${name} 为非负整数`)

  if (body.relations?.byKind) {
    const sum = Object.values(body.relations.byKind).reduce((a, b) => a + b, 0)
    check(id, sum === body.relations.edges, `byKind 求和 ${sum} == edges ${body.relations.edges}`)
  }
}

// ── 3. 合法夹具：必须自洽 ──────────────────────────────────────────

async function loadFixture(file) {
  const buf = readBuf(file)
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const entries = await readZip(buf)
    const main = entries.get('ocbak.json') ?? entries.get('oc-data.json')
    if (!main) throw new Error('ZIP 里既没有 ocbak.json 也没有 oc-data.json')
    return { carrier: 'zip', envelope: JSON.parse(Buffer.from(main).toString('utf8')), entries }
  }
  return { carrier: 'json', envelope: JSON.parse(buf.toString('utf8')), entries: null }
}

const WELL_FORMED = index.fixtures.filter((f) => !f.id.startsWith('09'))

for (const item of WELL_FORMED) {
  const id = item.id
  let loaded
  try {
    loaded = await loadFixture(item.file)
  } catch (error) {
    fail(id, `解析失败：${error.message}`)
    continue
  }
  const { envelope } = loaded
  const expected = JSON.parse(readText(item.expect)).expect ?? {}

  if (envelope.format !== 'ocbak') {
    // ── legacy 夹具：故意不带 key / 信封，验证的是「适配层能认出来」 ──
    const version = envelope.version
    check(id, version === 1 || version === 2, `legacy version 为 1 或 2（${version}）`)
    check(id, envelope.data && typeof envelope.data === 'object', 'legacy 有 data 对象')
    for (const section of ['characters', 'events', 'countries', 'worldEntries', 'tags']) {
      check(id, Array.isArray(envelope.data?.[section]), `legacy 有 data.${section} 数组`)
      for (const row of envelope.data?.[section] ?? []) {
        if ('key' in row) fail(id, `legacy 行不该有 key（${section}）`)
      }
    }
    if (version === 2) {
      check(id, envelope.meta?.format === 'oc-editor-backup', 'v2 带 meta.format = oc-editor-backup')
      check(id, Array.isArray(envelope.data.maps), 'v2 带 data.maps')
      check(id, Array.isArray(envelope.data.worlds), 'v2 带 data.worlds')
      check(id, envelope.data.periods === undefined, 'v2 不含 data.periods（E 的已知导出缺口）')
    }
    if (version === 1) {
      check(id, Array.isArray(envelope.data.meta), 'v1 带 data.meta 单例数组')
      check(id, Array.isArray(envelope.data.periods), 'v1 带 data.periods')
    }
    // 计数：只比两方都有的段
    const actual = {}
    for (const section of Object.keys(expected.read ?? {})) {
      if (Array.isArray(envelope.data?.[section])) actual[section] = envelope.data[section].length
      else if (section === 'worlds') actual[section] = Array.isArray(envelope.data?.worlds) ? envelope.data.worlds.length : Array.isArray(envelope.data?.meta) ? 1 : 0
      else if (section === 'periods') actual[section] = 0
    }
    for (const [section, want] of Object.entries(expected.read ?? {})) {
      if (actual[section] === undefined) continue
      check(id, actual[section] === want, `${section} 计数 ${actual[section]} == 期望 ${want}`)
    }
    continue
  }

  // ── 协议原生夹具：逐条对规范 ──
  check(id, /^1\.\d+$/.test(envelope.protocol ?? ''), `信封 protocol 合法（${envelope.protocol}）`)
  check(id, typeof envelope.producer?.app === 'string' && typeof envelope.producer?.version === 'string', '信封 producer 完整')
  check(id, typeof envelope.createdAt === 'string' && !Number.isNaN(Date.parse(envelope.createdAt)), '信封 createdAt 可解析')
  check(id, envelope.scope?.kind === 'library' || envelope.scope?.kind === 'subgraph', '信封 scope 合法')
  check(id, envelope.data && typeof envelope.data === 'object', '信封 data 为对象')
  check(id, Array.isArray(envelope.relations), '信封 relations 是数组')
  check(id, Array.isArray(envelope.assets), '信封 assets 是数组')

  const includes = envelope.includes?.sections
  const isSubgraph = envelope.scope?.kind === 'subgraph'

  // 对象键
  const keysByType = new Map()
  for (const [section, rows] of Object.entries(envelope.data ?? {})) {
    const type = SECTION_TYPES[section] ?? section
    const seen = new Set()
    for (const row of rows) {
      if (!KEY_RE.test(row.key ?? '')) fail(id, `${section} 里存在非法 key：${JSON.stringify(row.key)}`)
      if (seen.has(row.key)) fail(id, `${section} 里 key 重复：${row.key}`)
      seen.add(row.key)
    }
    keysByType.set(type, seen)
    if (!isSubgraph && Array.isArray(includes) && includes.includes(section)) {
      check(id, rows.length > 0, `${section} 在 includes 里声明了，应为非空（${rows.length}）`)
    }
  }

  // 引用可解析
  const assetKeys = new Set((envelope.assets ?? []).map((a) => a.key))
  let unresolvedRefs = 0
  let unresolvedAssets = 0
  for (const [, rows] of Object.entries(envelope.data ?? {})) {
    for (const row of rows) {
      for (const ref of collectRefs(row)) {
        if (ref.kind === 'asset') {
          if (!assetKeys.has(ref.value)) unresolvedAssets++
        } else {
          const [, type, key] = ref.value.match(REF_RE) ?? []
          if (!keysByType.get(type)?.has(key)) unresolvedRefs++
        }
      }
      if (Array.isArray(row.tags)) {
        for (const tag of row.tags) {
          const [, type, key] = typeof tag === 'string' ? tag.match(REF_RE) ?? [] : []
          if (type !== 'tag' || !keysByType.get('tag')?.has(key)) unresolvedRefs++
        }
      }
    }
  }
  for (const edge of envelope.relations ?? []) {
    for (const end of [edge.source, edge.target]) {
      const [, type, key] = typeof end === 'string' ? end.match(REF_RE) ?? [] : []
      if (!type || !keysByType.get(type)?.has(key)) unresolvedRefs++
    }
    check(id, typeof edge.kind === 'string' && edge.kind.length > 0, `边有 kind（${edge.source ?? '?'}→${edge.target ?? '?'}）`)
  }

  const expectedUnresolved = expected.relations?.unresolved
  if (expectedUnresolved !== undefined) {
    check(id, unresolvedRefs === expectedUnresolved, `未解析引用 ${unresolvedRefs} == 期望 ${expectedUnresolved}`)
  }
  if (expected.assets?.unresolved !== undefined) {
    check(id, unresolvedAssets === expected.assets.unresolved, `未解析素材 ${unresolvedAssets} == 期望 ${expected.assets.unresolved}`)
  }
  if (expected.relations?.edges !== undefined) {
    check(id, (envelope.relations ?? []).length === expected.relations.edges, `边数 ${(envelope.relations ?? []).length} == 期望 ${expected.relations.edges}`)
  }

  // 素材二选一 + mime 与魔数
  for (const asset of envelope.assets ?? []) {
    const hasData = typeof asset.data === 'string'
    const hasPath = typeof asset.path === 'string'
    check(id, hasData !== hasPath, `素材 ${asset.key} 的 data / path 二选一`)
    if (hasData && asset.mime && MIME_MAGIC[asset.mime]) {
      const bytes = Buffer.from(asset.data, 'base64')
      check(id, magicMatches(asset.mime, bytes), `素材 ${asset.key} 魔数与 mime 一致`)
    }
  }

  // 子图自洽
  if (envelope.scope?.kind === 'subgraph') {
    check(id, Array.isArray(envelope.scope.root) && envelope.scope.root.length > 0, '子图有 root')
    const present = new Set([...keysByType].flatMap(([type, keys]) => [...keys].map((k) => `${type}:${k}`)))
    const dangling = (envelope.relations ?? []).filter((e) => !present.has(e.source) || !present.has(e.target))
    check(id, dangling.length === 0, `子图内不存在悬空边（${dangling.length}）`)
  }
}

// ── 4. 畸形夹具：必须真的是那个畸形 ────────────────────────────────

{
  const text = readText('09a-truncated.ocbak')
  let threw = false
  try {
    JSON.parse(text)
  } catch {
    threw = true
  }
  check('09a-truncated', threw, '确实是截断的 JSON')
}

{
  const envelope = JSON.parse(readText('09b-missing-section.ocbak'))
  check('09b-missing-section', !Array.isArray(envelope.data.events), '确实缺 data.events')
}

{
  const envelope = JSON.parse(readText('09c-deep.ocbak'))
  const depth = depthOf(envelope)
  check('09c-deep', depth > 64, `嵌套深度 ${depth} > 64`)
}

{
  const entries = await readZip(readBuf('09d-zip-slip.ocbak'))
  const escaping = [...entries.keys()].filter((name) => name.includes('..') || name.startsWith('/') || /^[A-Za-z]:/.test(name))
  check('09d-zip-slip', escaping.length > 0, `确实含越界条目（${escaping.join(', ')}）`)
  check('09d-zip-slip', entries.has('ocbak.json'), '同时含合法 ocbak.json（用于确认拒绝发生在路径检查而不是解析失败）')
}

{
  const envelope = JSON.parse(readText('09e-mime-mismatch.ocbak'))
  const asset = envelope.assets[0]
  const bytes = Buffer.from(asset.data, 'base64')
  check('09e-mime-mismatch', !magicMatches(asset.mime, bytes), `${asset.mime} 与魔数确实不符`)
  check('09e-mime-mismatch', envelope.data.characters.length === 3, '其余对象完好（只该拒素材，不该拒整份文件）')
}

{
  const envelope = JSON.parse(readText('09f-unknown-major.ocbak'))
  check('09f-unknown-major', !/^1\./.test(envelope.protocol), `protocol 确实不是 1.x（${envelope.protocol}）`)
}

{
  const envelope = JSON.parse(readText('09g-duplicate-key.ocbak'))
  const keys = envelope.data.characters.map((row) => row.key)
  check('09g-duplicate-key', new Set(keys).size !== keys.length, '确实有重复 key')
}

// ── 5. 结果 ───────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok)
for (const result of results) console.log(`${result.ok ? '  ok  ' : ' FAIL '} ${result.id.padEnd(20)} ${result.msg}`)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
if (failed.length > 0) {
  console.log(`\n${failed.length} 项失败：`)
  for (const result of failed) console.log(`  - ${result.id}: ${result.msg}`)
  process.exit(1)
}
console.log('语料库自洽。')
