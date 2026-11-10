/**
 * 生成 fixtures/1.0 下的全部夹具与期望文件。
 *
 * 设计约束：
 * - 无第三方依赖，`node tools/build-fixtures.mjs` 即可重跑。
 * - 输出必须**可复现**：同一份源码跑两次，sha256 一致（时间戳为固定值）。
 * - 每个夹具都配一份 `<name>.expect.json`（结构化期望）；`index.json` 记 sha256。
 *
 * 改夹具时的规矩：先改这里，再跑 build，再跑 check-corpus。不要手改 fixtures 下的产物。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'fixtures', '1.0')
const EXPECTED = join(OUT, 'expected')
mkdirSync(EXPECTED, { recursive: true })

/** 固定时间，保证产物可复现（2026-11-10T05:00:00Z） */
const T = 1762750800000
const ISO = '2026-11-10T05:00:00.000Z'

/** 1×1 透明 PNG */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
/** 另一份字节不同但同格式的 PNG（用于素材去重之外的场景） */
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
/** JPEG 魔数开头的一段字节（用于 mime 与魔数不一致的夹具） */
const JPEG_FAKE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]).toString('base64')

// ── 极小 ZIP 写入（store-only，够用即可）───────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10) // 时间 / 日期固定 0，产物才可复现
    local.writeUInt16LE(0x0021, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x0021, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)

    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }

  const centralAll = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralAll.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralAll, eocd])
}

// ── 输出工具 ────────────────────────────────────────────────────────

const written = []

function emit(name, data) {
  const path = join(OUT, name)
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
  writeFileSync(path, buf)
  written.push({ name, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
}

/** 期望文件：夹具名 + 等级 + 检查项 + 期望 */
function expect(name, levels, checks, body) {
  emit(`${name}.expect.json`, {
    fixture: name,
    protocol: '1.0',
    levels,
    checks,
    ...body,
  })
}

// ── 共同世界数据 ────────────────────────────────────────────────────

const CHARACTERS = [
  { key: 'c-lin', name: '林', country: 'country:ct-ember', tags: ['tag:tag-fire', 'tag:tag-legend'] },
  { key: 'c-ash', name: '阿什', country: 'country:ct-ember', tags: ['tag:tag-north'] },
  { key: 'c-veil', name: '帷', country: 'country:ct-ash', tags: [] },
]

const edges = [
  { key: 'character:c-lin|membership|country:ct-ember', source: 'character:c-lin', target: 'country:ct-ember', kind: 'membership', label: '属于', directed: false },
  { key: 'character:c-ash|character|character:c-lin', source: 'character:c-lin', target: 'character:c-ash', kind: 'character', label: '挚友', directed: false, color: 'accent-1', arrow: 'none' },
  { key: 'event:ev-fall|event-character|character:c-lin', source: 'event:ev-fall', target: 'character:c-lin', kind: 'event-character', label: '参与', directed: true },
  { key: 'event:ev-fall|event-character|character:c-ash', source: 'event:ev-fall', target: 'character:c-ash', kind: 'event-character', label: '参与', directed: true },
  { key: 'event:ev-fall|event-country|country:ct-ember', source: 'event:ev-fall', target: 'country:ct-ember', kind: 'event-country', label: '发生于', directed: true },
  { key: 'country:ct-ash|nation|country:ct-ember', source: 'country:ct-ash', target: 'country:ct-ember', kind: 'nation', label: '关系', directed: false, color: 'accent-4' },
  { key: 'worldEntry:en-lantern|custom|worldEntry:en-tree', source: 'worldEntry:en-lantern', target: 'worldEntry:en-tree', kind: 'custom', label: '属于', directed: true, arrow: 'forward' },
]

const ASSETS = [
  { key: 'lin-avatar', mime: 'image/png', data: PNG, width: 1, height: 1 },
  { key: 'cover', mime: 'image/png', data: PNG2, width: 1, height: 1 },
]

function doc(text) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

// ── 04 / 06 / 07 / 08：协议原生形态（canonical）─────────────────────

function canonicalData({ withRelations = true, extra = {} } = {}) {
  const characters = CHARACTERS.map((c) => ({
    key: c.key,
    name: c.name,
    aliases: c.key === 'c-lin' ? ['Lin'] : [],
    country: c.country,
    tags: c.tags,
    avatar: c.key === 'c-lin' ? 'asset:lin-avatar' : null,
    bio: `${c.name}的一行简介`,
    document: doc(`${c.name}的正文。`),
    createdAt: T,
    updatedAt: T,
    ...(extra[c.key] ?? {}),
  }))

  return {
    worlds: [{ key: 'w-ember', name: '余烬', description: '灰烬之上的世界', createdAt: T, updatedAt: T }],
    countries: [
      { key: 'ct-ember', name: '余烬王朝', parent: null, tags: ['tag:tag-fire'], description: '旧王朝', createdAt: T, updatedAt: T, ...(extra['ct-ember'] ?? {}) },
      { key: 'ct-ash', name: '灰港', parent: 'country:ct-ember', tags: [], description: '海边的港', createdAt: T, updatedAt: T, ...(extra['ct-ash'] ?? {}) },
    ],
    characters,
    events: [
      {
        key: 'ev-fall',
        title: '王朝覆灭',
        time: '第一纪 末',
        endTime: '第一纪 末',
        location: '余烬王都',
        summary: '一夜之间',
        characters: ['character:c-lin', 'character:c-ash'],
        countries: ['country:ct-ember'],
        tags: ['tag:tag-fire'],
        document: doc('那一夜，灯灭了。'),
        createdAt: T,
        updatedAt: T,
        ...(extra['ev-fall'] ?? {}),
      },
    ],
    worldEntries: [
      { key: 'en-tree', title: '元素与生命树', category: '', parent: null, tags: ['tag:tag-legend'], document: doc('元素自树而生。'), createdAt: T, updatedAt: T, ...(extra['en-tree'] ?? {}) },
      { key: 'en-lantern', title: '长明灯', category: '', parent: 'worldEntry:en-tree', tags: [], document: doc('灯不曾熄。'), createdAt: T, updatedAt: T, ...(extra['en-lantern'] ?? {}) },
    ],
    tags: [
      { key: 'tag-fire', name: '火', category: '', color: '#C68D44' },
      { key: 'tag-north', name: '北方', category: '', color: '#6E6A63' },
      { key: 'tag-legend', name: '传说', category: '', color: '#B36651' },
    ],
    periods: [{ key: 'pd-first-age', name: '第一纪', startTime: '元年', endTime: '三百年', color: 'bg-line' }],
    ...(withRelations ? {} : {}),
  }
}

function canonicalEnvelope({ relations = edges, assets = ASSETS, scope = { kind: 'library' }, data = canonicalData(), ext = { ocstudio: { theme: 'paper' } } } = {}) {
  return {
    format: 'ocbak',
    protocol: '1.0',
    producer: { app: 'OC Studio', version: '0.20.3-beta' },
    createdAt: ISO,
    scope,
    includes: {
      sections: ['worlds', 'countries', 'characters', 'events', 'worldEntries', 'tags', 'periods'],
      assets: assets.length > 0 ? 'embedded' : 'none',
    },
    data,
    relations,
    assets: assets.map((a) =>
      a.data ? { ...a, sha256: createHash('sha256').update(Buffer.from(a.data, 'base64')).digest('hex') } : { ...a },
    ),
    ext,
  }
}

// 04：协议原生形态，最常见的一份（关系只留主干五种，不带 color / arrow 花样）
emit('04-canonical.ocbak', canonicalEnvelope({ relations: edges.slice(0, 5), ext: {} }))
expect('04-canonical', ['L1', 'L2'], ['read', 'relations', 'assets', 'roundtrip'], {
  expect: {
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 1 },
    relations: { edges: 5, byKind: { membership: 1, character: 1, 'event-character': 2, 'event-country': 1 }, unresolved: 0 },
    assets: { embedded: 2, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 0 },
    unknownFields: { preserved: 0 },
    ignored: [],
    errors: [],
  },
})

// 06：关系全集（color / arrow / directed 都要往返）
emit('06-relations.ocbak', canonicalEnvelope())
expect('06-relations', ['L1', 'L2'], ['relations', 'roundtrip'], {
  expect: {
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 1 },
    relations: {
      edges: 7,
      byKind: { membership: 1, character: 1, 'event-character': 2, 'event-country': 1, nation: 1, custom: 1 },
      withColor: 2,
      withArrow: 2,
      undirected: 3,
      unresolved: 0,
    },
    assets: { embedded: 2, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 0 },
    unknownFields: { preserved: 0 },
    ignored: [],
    errors: [],
  },
})

// 07：5 个未登记键，L2 必须原样保留，L1 允许丢但必须报数
const UNKNOWN_FIELDS = {
  'c-lin': { moodRing: 'amber', 'x-pet-skill': 'night-vision' },
  'ev-fall': { weatherBand: 'ash-rain' },
  'ct-ember': { flagVariant: 'weathered' },
  'en-tree': { timelineDensity: 0.4 },
}
emit(
  '07-unknown-fields.ocbak',
  canonicalEnvelope({
    data: canonicalData({ extra: UNKNOWN_FIELDS }),
  }),
)
expect('07-unknown-fields', ['L1', 'L2'], ['preserve'], {
  expect: {
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 1 },
    relations: { edges: 7, byKind: { membership: 1, character: 1, 'event-character': 2, 'event-country': 1, nation: 1, custom: 1 }, unresolved: 0 },
    assets: { embedded: 2, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 0 },
    unknownFields: { preserved: 5, keys: Object.entries(UNKNOWN_FIELDS).flatMap(([k, v]) => Object.keys(v).map((f) => `${k}.${f}`)) },
    ignored: [],
    errors: [],
  },
  notes: 'L1 允许 preserved < 5，但报告必须出现「未知字段 5 个」；L2 要求 preserved === 5 且往返后再导出仍在。',
})

// 08：子图导出（1 角色 + 它的世界闭包）
const subData = (() => {
  const full = canonicalData()
  return {
    worlds: full.worlds,
    countries: full.countries.filter((c) => c.key === 'ct-ember'),
    characters: full.characters.filter((c) => c.key === 'c-lin' || c.key === 'c-ash'),
    events: full.events,
    worldEntries: [],
    tags: full.tags,
    periods: [],
  }
})()
const subEdges = edges.filter((e) => e.kind !== 'nation' && e.kind !== 'custom')
emit(
  '08-subgraph.ocbak',
  canonicalEnvelope({ data: subData, relations: subEdges, assets: ASSETS.filter((a) => a.key === 'lin-avatar'), scope: { kind: 'subgraph', root: ['character:c-lin'], depth: -1 } }),
)
expect('08-subgraph', ['L1', 'L3'], ['scope', 'read'], {
  expect: {
    read: { worlds: 1, countries: 1, characters: 2, events: 1, worldEntries: 0, tags: 3, periods: 0 },
    relations: { edges: 5, byKind: { membership: 1, character: 1, 'event-character': 2, 'event-country': 1 }, unresolved: 0 },
    assets: { embedded: 1, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 0 },
    unknownFields: { preserved: 0 },
    ignored: [],
    errors: [],
  },
  notes: '闭包自洽：ct-ash 不应出现（只通过 c-veil 可达，而 c-veil 不在闭包内）；en-* 不应出现。',
})

// 05：素材四种状态（内联 / 仅路径 / 悬空引用 / 裸本地路径）
const assetsData = canonicalData()
assetsData.characters[0].avatar = 'asset:lin-avatar' // 内联，能落地
assetsData.characters[1].avatar = 'asset:gone-file' // 只有 path，没有 data → notCarried
assetsData.characters[2].avatar = 'asset:absent' // 表中没有 → unresolved
assetsData.worldEntries[0].image = '附件/old.png' // 裸本地路径 → localRefs
const assetsEnvelope = canonicalEnvelope({
  data: assetsData,
  assets: [
    ASSETS[0],
    { key: 'gone-file', mime: 'image/webp', path: 'assets/gone-file.webp', width: 8, height: 8 },
  ],
  ext: {},
})
emit('05-assets.ocbak', assetsEnvelope)
expect('05-assets', ['L1'], ['assets'], {
  expect: {
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 1 },
    relations: { edges: 7, byKind: { membership: 1, character: 1, 'event-character': 2, 'event-country': 1, nation: 1, custom: 1 }, unresolved: 0 },
    assets: { embedded: 1, notCarried: 1, unresolved: 1, rejected: 0, localRefs: 1 },
    unknownFields: { preserved: 0 },
    ignored: [],
    errors: [],
  },
  notes: 'includes.assets 声明 embedded，但其中一项只有 path —— 必须报 notCarried，不得当成功。',
})

// 09：畸形夹具
emit('09a-truncated.ocbak', Buffer.from('{"format":"ocbak","protocol":"1.0","data":{"characters":[{"key":"c-', 'utf8'))
expect('09a-truncated', ['L1'], ['reject'], {
  expect: { reject: true, errors: [{ code: 'PARSE_ERROR' }] },
})

const missing = canonicalEnvelope()
delete missing.data.events
emit('09b-missing-section.ocbak', missing)
expect('09b-missing-section', ['L1'], ['reject'], {
  expect: { reject: true, errors: [{ code: 'MISSING_SECTION', path: 'data.events' }] },
})

const deep = canonicalEnvelope()
let nest = { leaf: true }
for (let i = 0; i < 100; i++) nest = { down: nest }
deep.data.characters[0].xDeep = nest
emit('09c-deep.ocbak', deep)
expect('09c-deep', ['L1'], ['limits'], {
  expect: { reject: true, errors: [{ code: 'DEPTH_EXCEEDED' }] },
})

emit(
  '09d-zip-slip.ocbak',
  zip([
    ['../evil.txt', 'pwned'],
    ['ocbak.json', JSON.stringify(canonicalEnvelope(), null, 2)],
  ]),
)
expect('09d-zip-slip', ['L1'], ['reject'], {
  expect: { reject: true, errors: [{ code: 'ZIP_PATH_ESCAPE', entry: '../evil.txt' }] },
})

const mismatch = canonicalEnvelope()
mismatch.assets = [{ key: 'lin-avatar', mime: 'image/png', data: JPEG_FAKE, sha256: createHash('sha256').update(Buffer.from(JPEG_FAKE, 'base64')).digest('hex') }]
emit('09e-mime-mismatch.ocbak', mismatch)
expect('09e-mime-mismatch', ['L1'], ['assets', 'reject'], {
  expect: {
    reject: false,
    errors: [{ code: 'MIME_MISMATCH', scope: 'asset', key: 'lin-avatar' }],
    assets: { embedded: 0, notCarried: 0, unresolved: 0, rejected: 1, localRefs: 0 },
  },
  notes: '只拒这一个素材，不拒整份文件；其余对象照常导入。',
})

const unknownMajor = canonicalEnvelope()
unknownMajor.protocol = '2.0'
emit('09f-unknown-major.ocbak', unknownMajor)
expect('09f-unknown-major', ['L1'], ['reject'], {
  expect: { reject: true, errors: [{ code: 'UNKNOWN_MAJOR', protocol: '2.0' }] },
})

const dup = canonicalEnvelope()
dup.data.characters.push({ ...dup.data.characters[0] })
emit('09g-duplicate-key.ocbak', dup)
expect('09g-duplicate-key', ['L1'], ['reject'], {
  expect: { reject: true, errors: [{ code: 'KEY_DUPLICATE', type: 'character', key: 'c-lin' }] },
})

// ── 01 / 02 / 03：两个已知实现的 legacy 导出形态 ─────────────────────

function sLegacy() {
  return {
    version: 1,
    exportedAt: ISO,
    data: {
      characters: [
        {
          id: 1, name: '林', aliases: ['Lin'], race: '人类', element: '火', occupation: '守灯人', faction: '',
          nationalityLegacy: '', countryId: 1, height: '168', birthday: '—',
          avatarUrl: `data:image/png;base64,${PNG}`,
          headerUrl: '', bio: '林的一行简介', lifeStory: '',
          document: doc('林的正文。'),
          relatedCharacters: [{ characterId: 2, name: '阿什', relation: '挚友', color: 'accent-1', arrow: 'none' }],
          gallery: [], avatars: [], tags: [1, 3], order: 0, createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 2, name: '阿什', aliases: [], race: '人类', element: '风', occupation: '渔人', faction: '',
          nationalityLegacy: '', countryId: 1, height: '175', birthday: '—',
          avatarUrl: '附件/ash.webp',
          headerUrl: '', bio: '阿什的一行简介', lifeStory: '',
          document: doc('阿什的正文。'),
          relatedCharacters: [], gallery: [], avatars: [], tags: [2], order: 1, createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 3, name: '帷', aliases: [], race: '未知', element: '暗', occupation: '无', faction: '',
          nationalityLegacy: '', countryId: 2, height: '—', birthday: '—',
          avatarUrl: '', headerUrl: '', bio: '', lifeStory: '',
          relatedCharacters: [], gallery: [], avatars: [], tags: [], order: 2, createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      events: [
        {
          id: 1, title: '王朝覆灭', aliases: [], time: '第一纪 末', endTime: '第一纪 末', location: '余烬王都',
          summary: '一夜之间', content: '', document: doc('那一夜，灯灭了。'),
          characters: [1, 2], countries: [1], headerUrl: '',
          parentEventId: null, relations: [], tags: [1], images: [], isMajor: true, order: 0,
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      countries: [
        {
          id: 1, name: '余烬王朝', aliases: [], parentId: null, description: '旧王朝',
          document: undefined, system: '', geography: '', culture: '',
          flagUrl: '', headerUrl: '', tags: [1], order: 0, createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 2, name: '灰港', aliases: [], parentId: 1, description: '海边的港',
          document: undefined, system: '', geography: '', culture: '',
          flagUrl: '', headerUrl: '', tags: [], order: 1, createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      worldEntries: [
        {
          id: 1, title: '元素与生命树', category: '', parentId: null, order: 0, isConcept: true,
          content: '', document: doc('元素自树而生。'),
          relations: [], references: [], tags: [3], createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 2, title: '长明灯', category: '', parentId: 1, order: 1, isConcept: false,
          content: '', document: doc('灯不曾熄。'),
          relations: [{ targetId: 1, name: '元素与生命树', relation: '属于', arrow: 'forward' }],
          references: [], tags: [], createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      tags: [
        { id: 1, name: '火', category: '', color: '#C68D44' },
        { id: 2, name: '北方', category: '', color: '#6E6A63' },
        { id: 3, name: '传说', category: '', color: '#B36651' },
      ],
      periods: [{ id: 1, name: '第一纪', startTime: '元年', endTime: '三百年', color: 'bg-line' }],
      meta: [{ id: 1, worldName: '余烬', tagline: '灰烬之上', coverUrl: `data:image/png;base64,${PNG2}`, updatedAt: T }],
    },
  }
}

emit('01-s-json.ocbak', sLegacy())
expect('01-s-json', ['L1'], ['carrier', 'read', 'relations'], {
  expect: {
    source: { format: 'legacy', version: 1, app: 'OC Studio' },
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 1 },
    relations: {
      edges: 6,
      byKind: { membership: 2, character: 1, 'event-character': 2, 'event-country': 1 },
      unresolved: 0,
    },
    assets: { embedded: 2, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 1 },
    unknownFields: { preserved: 0 },
    ignored: [],
    errors: [],
  },
  notes: 'S legacy 无国家↔国家关系（nation）与笔记命名边以外的边；6 条边是它当前能表达的上限。worlds 由 data.meta 映射为 1 条。',
})

function eLegacy() {
  return {
    version: 2,
    exportedAt: ISO,
    meta: {
      app: 'OC editor',
      format: 'oc-editor-backup',
      offline: true,
      includes: ['worlds', 'characters', 'events', 'countries', 'worldEntries', 'tags', 'maps'],
    },
    data: {
      worlds: [{ id: 1, name: '余烬', description: '灰烬之上的世界', order: 0, createdAt: T, updatedAt: T, deleted: false }],
      characters: [
        {
          id: 1, worldId: 1, name: '林', aliases: ['Lin'], entityKind: 'character',
          customFields: [{ id: 'f1', label: '口头禅', value: '灯要亮着' }],
          folderId: null, hiddenFields: [],
          race: '人类', element: '火', occupation: '守灯人', nationalityLegacy: '', countryId: 1,
          height: '168', birthday: '—', gender: '', personality: '寡言',
          avatarUrl: 'media/lin.png', headerUrl: '', bio: '林的一行简介', lifeStory: '',
          document: doc('林的正文。'),
          relationships: [], relatedCharacters: [{ characterId: 2, name: '阿什', relation: '挚友' }],
          relatedNations: [], relatedEvents: [], gallery: [], avatars: [], tags: [1, 3],
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 2, worldId: 1, name: '阿什', aliases: [], entityKind: 'pet',
          customFields: [], folderId: null, hiddenFields: [],
          race: '人类', element: '风', occupation: '渔人', nationalityLegacy: '', countryId: 1,
          height: '175', birthday: '—',
          avatarUrl: 'media/ash.png', headerUrl: '', bio: '', lifeStory: '',
          relationships: [], relatedCharacters: [], relatedNations: [], relatedEvents: [],
          gallery: [], avatars: [], tags: [2], createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 3, worldId: 1, name: '帷', aliases: [], entityKind: 'character',
          customFields: [], folderId: null, hiddenFields: [],
          race: '未知', element: '暗', occupation: '无', nationalityLegacy: '', countryId: 2,
          height: '—', birthday: '—',
          avatarUrl: '', headerUrl: '', bio: '', lifeStory: '',
          relationships: [{ targetId: 1, targetType: 'character', relation: '追随' }],
          relatedCharacters: [], relatedNations: [], relatedEvents: [],
          gallery: [], avatars: [], tags: [], createdAt: T, updatedAt: T,
          deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      events: [
        {
          id: 1, worldId: 1, title: '王朝覆灭', time: '第一纪 末', endTime: '第一纪 末', location: '余烬王都',
          summary: '一夜之间', content: '', document: doc('那一夜，灯灭了。'),
          characters: [1, 2], countries: [1], headerUrl: '', parentEventId: null,
          relations: [], tags: [1], images: [], isMajor: true,
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      countries: [
        {
          id: 1, worldId: 1, name: '余烬王朝', parentId: null, description: '旧王朝',
          system: '', geography: '', culture: '', flagUrl: '', headerUrl: '',
          characters: [1, 2], events: [1], relatedNations: [], tags: [1],
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 2, worldId: 1, name: '灰港', parentId: 1, description: '海边的港',
          system: '', geography: '', culture: '', flagUrl: '', headerUrl: '',
          characters: [3], events: [], relatedNations: [1], tags: [],
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      worldEntries: [
        {
          id: 1, worldId: 1, title: '元素与生命树', content: '', document: doc('元素自树而生。'),
          category: '', parentId: null, order: 0, isConcept: true, references: [], tags: [3],
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
        {
          id: 2, worldId: 1, title: '长明灯', content: '', document: doc('灯不曾熄。'),
          category: '', parentId: 1, order: 1, isConcept: false, references: [], tags: [],
          createdAt: T, updatedAt: T, deleted: false, _syncStatus: 'synced', _lastModified: T,
        },
      ],
      tags: [
        { id: 1, name: '火', category: '', color: '#C68D44' },
        { id: 2, name: '北方', category: '', color: '#6E6A63' },
        { id: 3, name: '传说', category: '', color: '#B36651' },
      ],
      maps: [
        {
          id: 1, worldId: 1, name: '余烬大陆', seed: 77001,
          params: { kind: 'world', terrainPreset: 'earth', width: 2048, height: 1024, landCoverage: 0.42 },
          createdAt: T, updatedAt: T, deleted: false,
          imageBlob: {},
          annotations: [],
        },
      ],
    },
  }
}

emit('02-e-json.ocbak', eLegacy())
expect('02-e-json', ['L1'], ['carrier', 'read', 'relations', 'legacy-extras'], {
  expect: {
    source: { format: 'legacy', version: 2, app: 'OC editor' },
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 0 },
    relations: {
      edges: 7,
      byKind: { membership: 2, character: 1, 'event-character': 2, 'event-country': 1, nation: 1 },
      unresolved: 0,
    },
    assets: { embedded: 0, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 2 },
    unknownFields: { preserved: 0 },
    ignored: [{ path: 'data.maps', count: 1, reason: '地图模型不同，需进 ext' }],
    errors: [],
  },
  notes: 'data.maps 必须进 ext 并在报告里计数；imageBlob 是 Blob 的 JSON 残骸（{}），不得当作素材。periods 缺失是 E 的导出范围问题。',
})

const eZip = eLegacy()
emit(
  '03-e-zip.ocbak',
  zip([
    ['oc-data.json', JSON.stringify(eZip, null, 2)],
    [
      'manifest.json',
      JSON.stringify(
        { format: 'oc-editor-backup', version: 2, createdAt: ISO, counts: { characters: 3, events: 1, countries: 2, worldEntries: 2, tags: 3, maps: 1 } },
        null,
        2,
      ),
    ],
    ['README.txt', 'OC editor 本地备份\n==================\n\n图片二进制仍保存在本地数据目录，不包含在本备份中。\n'],
  ]),
)
expect('03-e-zip', ['L1'], ['carrier', 'read'], {
  expect: {
    source: { format: 'legacy', version: 2, app: 'OC editor', carrier: 'zip' },
    read: { worlds: 1, countries: 2, characters: 3, events: 1, worldEntries: 2, tags: 3, periods: 0 },
    relations: { edges: 7, byKind: { membership: 2, character: 1, 'event-character': 2, 'event-country': 1, nation: 1 }, unresolved: 0 },
    assets: { embedded: 0, notCarried: 0, unresolved: 0, rejected: 0, localRefs: 2 },
    unknownFields: { preserved: 0 },
    ignored: [{ path: 'data.maps', count: 1, reason: '地图模型不同，需进 ext' }],
    errors: [],
  },
  notes: 'ZIP 内没有 ocbak.json，须回落到 oc-data.json；manifest.json / README.txt 不得作为判据。',
})

// ── 期望的规范化形态（L2 往返比对用）────────────────────────────────

const canon = (obj) => {
  if (Array.isArray(obj)) return obj.map(canon)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const key of Object.keys(obj).sort()) {
      if (key === '_syncStatus' || key === '_lastModified' || key === 'createdAt' || key === 'updatedAt') continue
      const value = obj[key]
      if (value === null || value === undefined) continue
      out[key] = canon(value)
    }
    return out
  }
  return obj
}

const sortByKey = (rows) => [...rows].sort((a, b) => String(a.key).localeCompare(String(b.key)))
const sortEdges = (rows) => [...rows].sort((a, b) => String(a.key).localeCompare(String(b.key)))

function canonicalForm(envelope) {
  const data = {}
  for (const [section, rows] of Object.entries(envelope.data)) data[section] = sortByKey(rows)
  return canon({
    format: envelope.format,
    protocol: envelope.protocol,
    data,
    relations: sortEdges(envelope.relations),
    assets: [...envelope.assets].sort((a, b) => String(a.key).localeCompare(String(b.key))),
  })
}

function writeRaw(name, text) {
  const buf = Buffer.from(text, 'utf8')
  writeFileSync(join(OUT, name), buf)
  written.push({ name, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
}

const envelope04 = canonicalEnvelope({ relations: edges.slice(0, 5), ext: {} })
const envelope06 = canonicalEnvelope()
writeRaw('expected/canon-04-canonical.json', `${JSON.stringify(canonicalForm(envelope04), null, 2)}\n`)
writeRaw('expected/canon-06-relations.json', `${JSON.stringify(canonicalForm(envelope06), null, 2)}\n`)
writeFileSync(join(EXPECTED, 'README.md'), [
  '# expected/',
  '',
  'L2 / L3 的往返比对基准：**规范化之后**的结构，不是字节。',
  '',
  '规范化规则（`tools/build-fixtures.mjs` 的 `canonicalForm`）：',
  '1. 丢弃簿记字段：`_syncStatus` / `_lastModified` / `createdAt` / `updatedAt`',
  '2. 丢弃 `null` 与 `undefined`',
  '3. 对象键按字典序排序，数组内对象按键排序（`data.*` 按 `key`，`relations` 按 `key`，`assets` 按 `key`）',
  '4. 保留 `format` / `protocol` / `data` / `relations` / `assets`，**丢弃** `producer` / `createdAt` / `includes` / `ext`',
  '',
  '比对方式：`canonical(实现导出) === canonical(expected)`。不一致时按路径报差异，不要只报「不相等」。',
  '',
].join('\n'), 'utf8')

written.push({ name: 'expected/README.md' })

// ── index.json：清单 + sha256 ──────────────────────────────────────

const LEVELS = {
  '01-s-json': ['L1'],
  '02-e-json': ['L1'],
  '03-e-zip': ['L1'],
  '04-canonical': ['L1', 'L2'],
  '05-assets': ['L1'],
  '06-relations': ['L1', 'L2'],
  '07-unknown-fields': ['L1', 'L2'],
  '08-subgraph': ['L1', 'L3'],
  '09a-truncated': ['L1'],
  '09b-missing-section': ['L1'],
  '09c-deep': ['L1'],
  '09d-zip-slip': ['L1'],
  '09e-mime-mismatch': ['L1'],
  '09f-unknown-major': ['L1'],
  '09g-duplicate-key': ['L1'],
}

const index = {
  protocol: '1.0',
  generatedAt: ISO,
  note: '夹具由 tools/build-fixtures.mjs 生成，不要手改。sha256 用于两边核对「跑的是不是同一份语料」。',
  fixtures: Object.entries(LEVELS).map(([id, levels]) => {
    const entry = written.find((w) => w.name === `${id}.expect.json`)
    const main = written.find((w) => w.name.startsWith(`${id}.`) && !w.name.endsWith('.expect.json'))
    return {
      id,
      file: main?.name ?? null,
      expect: `${id}.expect.json`,
      levels,
      sha256: main?.sha256 ?? null,
      expectSha256: entry?.sha256 ?? null,
    }
  }),
  canonical: [
    { id: '04-canonical', file: 'expected/canon-04-canonical.json' },
    { id: '06-relations', file: 'expected/canon-06-relations.json' },
  ],
}

writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')

// ── 汇总 ───────────────────────────────────────────────────────────

console.log(`已生成 ${written.length} 个文件 → ${OUT}`)
for (const item of written) console.log(`  ${item.name.padEnd(34)} ${String(item.bytes ?? '').padStart(6)} B  ${item.sha256 ?? ''}`)
