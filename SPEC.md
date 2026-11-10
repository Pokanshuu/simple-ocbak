# `.ocbak` 交换协议 v1.0（草案）

> **状态**：中立的草案，供各实现方评审。第 I 部分冻结后即为 1.0；第 II 部分由各实现方独立维护。
> **一句话**：一个 `.ocbak` 是「一批带 `key` 的对象 + 一张关系表 + 一张素材表」，三种载体装同一件事。
> **评审者只需读第 I 部分**（九节）。第 II 部分是各实现方旧格式的适配说明，不属于规范。

---

# 目录

| 部分 | 内容 | 性质 |
|---|---|---|
| **0 术语** | 本文固定使用的几个词 | 约定 |
| **I 规范** | 模型 / 容器 / 信封 / 身份 / 对象 / 关系 / 素材 / 安全 / 等级 | **不可协商**，改动需升 major |
| **II 适配层** | 旧文件如何读取、新对象如何落地、字段键登记、私有结构存放 | **可按实现方独立修订**，不属于规范 |
| **III 附录** | 已知实现的实测差异、待定项、本文档的修订方式 | 记录 |

---

# 0. 术语与记法

| 词 | 含义 |
|---|---|
| **实现方** | 任何读写 `.ocbak` 的软件。本文不假定实现方的数量 |
| **读取方 / 写入方** | 同一次数据交换中的两个角色，可以是同一个实现 |
| **S / E** | 两个已知实现的代号，见下。规范文本不使用这两个代号，只有第 II 部分使用 |
| **载体（carrier）** | 承载同一份模型的物理形态：单文件 JSON、ZIP、文件夹 |
| **段（section）** | 对象容器，`data.<section>` 下的一类对象 |
| **对象（object）** | 段里的一条记录，必带 `key` 与名称键 |
| **引用（reference）** | `"<type>:<key>"` 形式的字符串，指向文件内或文件外的对象 |
| **素材（asset）** | 图片 / 视频二进制，与对象分开存放，靠 `"asset:<key>"` 互通 |
| **扩展命名空间** | `ext` 下按实现方分家的区域，装协议未定义的私有结构 |

**已知实现**（仅用于第 II 部分的适配说明）：

| 代号 | 产品 |
|---|---|
| **S** | OC Studio |
| **E** | OC editor |

---

# 第 I 部分 · 规范

## I.1 模型

三样东西，没有第四样：

```
objects    一批对象，每类一个段（characters / events / tags / …），每个对象有唯一的 key
relations  一张边表，对象之间的有向 / 无向边
assets     一张素材表，图片与视频的二进制
```

- 对象之间**只通过 `key` 引用**，不通过数字 id。
- 层级由对象的 `parent` 表达，不另存一份父子边。
- 标签是对象（`tags` 段），对象上的 `tags` 是 `tag:` 引用的数组。
- 正文是对象的一个字段（`document`），不是第四样东西。

**合法文件的判据**（一句话）：能解析出一个信封；每个对象带 `key`；所有引用都能在文件内解析到；素材要么在 `assets` 里，要么被显式标记为未携带。任一条不成立，即不是合法文件。

## I.2 容器

同一份模型，三种装法。读取方**必须支持 A 与 B**；C 可选。

### A 单文件 JSON

- UTF-8，**无 BOM**，顶层是 I.3 的信封。
- 素材以 `assets[].data`（base64 内联）携带。

### B ZIP

```
ocbak.json         ← 必备，根目录，即 I.3 的信封（对象可内联在 data 里）
assets/<key>.<ext> ← 可选，素材；信封对应项写 "path": "assets/xxx.webp"
```

- 读取方只认 `ocbak.json`。
- 允许附带 `manifest.json` / `README.txt`，**读取方不得依赖**其内容。
- 拒绝任何越出根目录的条目（见 I.8）。

### C 文件夹 / ZIP-of-md（可选，面向人类与文本工具）

为使协议可被普通文本编辑器与 Obsidian 一类工具直接阅读，允许对象以人可读形态存放：

```
ocbak.json                    ← 信封 + relations + assets 索引（对象段留空）
objects/characters/9f2c.md    ← frontmatter = 对象的键值，正文 = Markdown（document 的投影）
assets/<key>.<ext>
```

- frontmatter 的键与 JSON 对象的键**同名同义**；数组 / 对象用 YAML 表达。
- 正文与 `document` 的往返属实现细节；**无法无损表达时以 JSON 载体为准**。
- 支持 C 是加分项，不参与一致性等级的判定。

### 探测（按内容，不看扩展名）

| # | 判据 | 结论 |
|---|---|---|
| 1 | 前 4 字节为 `50 4B 03 04` | ZIP → 查找 `ocbak.json`；不存在则转 II.10 的 legacy 探测 |
| 2 | 可解析为 JSON 且 `format === "ocbak"` | 本协议 |
| 3 | 是目录且含 `ocbak.json` | 载体 C |
| 4 | 其它 | 交适配层（II.10）；适配层亦无法识别 → 拒收：「该文件不是备份」 |

## I.3 信封

```jsonc
{
  "format": "ocbak",
  "protocol": "1.0",
  "producer": { "app": "…", "version": "…" },
  "createdAt": "2026-11-10T05:00:00.000Z",
  "scope": { "kind": "library" },
  "includes": { "sections": ["characters", "events", "tags"], "assets": "embedded" },
  "data": { "characters": [], "events": [], "tags": [] },
  "relations": [],
  "assets": [],
  "ext": {}
}
```

| 键 | 必备 | 规则 |
|---|---|---|
| `format` | ✓ | 固定 `"ocbak"` |
| `protocol` | ✓ | `"<major>.<minor>"`，见 I.9 |
| `producer.app` / `.version` | ✓ | 人类可读的标识；**不得**用于判定语义（同一 app 名可对应多代格式） |
| `createdAt` | ✓ | ISO 8601 |
| `scope` | ✓ | 见下 |
| `includes` | | `{ sections: string[], assets: "embedded" \| "referenced" \| "none" }`；缺省按实际内容推断 |
| `data` | ✓ | 对象段容器：`data.<section>` = 对象数组，段名为小写复数 |
| `relations` | ✓ | 边表；无边时为 `[]`，**不得**缺省 |
| `assets` | ✓ | 素材表；无素材时为 `[]`，**不得**缺省 |
| `ext` | | 实现方私有内容，按命名空间分家，见 I.5.5 |

**信封中不放可推导的字段**（计数、平台、字节数等）。面向人类的摘要写入 ZIP 的 `manifest.json`，不进信封 —— 冗余字段只会成为不一致的来源。

### `scope`

```jsonc
{ "kind": "library" }
{ "kind": "subgraph", "root": ["character:9f2c…"], "depth": -1 }
```

- `subgraph` 表示局部导出：自 `root` 出发，沿 `relations` / `parent` / `tags` / 正文中的 `asset:` 求闭包；`depth: -1` 表示不限深度。
- 闭包必须**自洽**：被纳入的对象所引用的对象，要么同在文件内，要么在同一处被显式标为缺失。
- 读取方对 `subgraph` 的处理与 `library` 相同，仅在报告中说明「这是局部导出」。

## I.4 身份与引用

### I.4.1 `key`

- 每个对象**必带** `key: string`，在**同类对象内**唯一。
- 推荐形态为 32 位以上随机串（UUID 去连字符亦可）。允许字符集 `[A-Za-z0-9._-]`。
- **生成一次，永不变**：改名、改内容都不改 `key`。这是幂等与「改名不断链」的唯一前提。
- 引用写法：`"<type>:<key>"`，例如 `"character:9f2c4d1e8b7a…"`。
- 协议中**不出现数字 id**。旧文件含数字 id 的，由适配层在本文件内解析，不进入规范层。

### I.4.2 引用

| 位置 | 类型 | 说明 |
|---|---|---|
| `parent` | `string` | `"<type>:<key>"`；顶层对象不写 |
| `tags[]` | `string[]` | `"tag:<key>"` |
| `relations[].source` / `.target` | `string` | 边两端 |
| 任意字段中的素材 | `string` | `"asset:<key>"` |
| 实现方自定义的引用字段 | `string` 或 `string[]` | 同一写法，例如 `country: "country:<key>"` |

- **解析不到时**：保留原字符串（不清空、不改为 null），计入报告的 `unresolved`。
- `aliases` 与 `name`（`title`）**不是身份**，仅用于显示与人工核对；程序不得据名字建立引用。

### I.4.3 导入

- `key` 即身份：导入方建立 `(type, key) → 本地标识` 的映射，并把引用改写为自己的存储形态。
- **同一份文件导入两次，在 `skip` 策略下第二次 `added == 0`。**
- 合并身份**只依据 `key`**。`key` 相同视为同一对象；`name` 相同而 `key` 不同视为两个不同对象（是否合并由用户决定，协议不代为合并）。
- 整个导入在**一个事务**内完成，失败回滚。

## I.5 对象

### I.5.1 必备键

| 段（`data.<section>`） | `key` | 名称键 | 备注 |
|---|---|---|---|
| `characters` | ✓ | `name` | |
| `events` | ✓ | `title` | |
| `countries` | ✓ | `name` | |
| `worldEntries` | ✓ | `title` | 笔记 / 词条 / 分类条目 / 小说章节 / 地图笔记均属此类 |
| `tags` | ✓ | `name` | |
| `periods` | ✓ | `name` | |
| `worlds` | ✓ | `name` | 多世界观场景才需要 |
| `maps` | ✓ | `name` | 地图作为独立对象时才需要 |

段名**开放**：实现方可增加自有段（如 `petSkills`）。读取方不认识的段：整段存入 `ext["<自己的命名空间>"]`，并在报告中计数。

### I.5.2 开放字段

**对象是开放对象。** 除 `key` 与名称键外，协议不规定字段名：

- 已知字段的含义登记于 §II.14（**仅为登记，不作校验**）。
- 未登记的字段**不构成非法**。读取方必须原样保留，再次导出时原样写回。
- 实现方若确实无处保存未知字段，**必须**在报告中报告「N 个未知字段未保留」—— 这是 L1 与 L2 的分界线（I.9）。

这一条是协议的核心取舍：**以「保留未知」换取「协议不必跟随实现增删字段」**。字段表总会落后于实现，保留规则不会。

### I.5.3 通用可选键

`aliases: string[]` · `tags: string[]` · `parent: string` · `createdAt` / `updatedAt: number`（毫秒时间戳） · `document: object`（正文，见 I.5.4） · `content: string`（legacy 正文兜底）

`deleted: true` 的对象**不进入备份**（备份表达当前视图，不是回收站）。若需携带回收站，另立 `data.trash` 段，1.0 不做。

### I.5.4 正文

- 权威形态 `document` = ProseMirror / Tiptap JSON（`{ "type": "doc", "content": [...] }`）。
- `content` 为字符串（HTML 或纯文本），**仅在 `document` 缺省时读取**。
- **不认识的节点整棵保留**，不得降级为纯文本，不得丢弃。无法渲染时显示占位。
- 节点闭集（建议所有实现支持）：`doc` `paragraph` `text` `heading` `bulletList` `orderedList` `listItem` `blockquote` `codeBlock` `horizontalRule` `hardBreak` `bold` `italic` `underline` `strike` `code` `link` `table` `tableRow` `tableCell` `tableHeader` `taskList` `taskItem` `details`。
- 已被两个已知实现共有的扩展节点（**读到必须保留**）：`imageBlock{src,width}` · `wikiLink{id,label}` · `mention{id,label}` · `small`。
- 正文中的素材同样写作 `asset:<key>`；正文中的内链目标同样写作 `<type>:<key>`。

### I.5.5 `ext`

```jsonc
"ext": {
  "oc-editor": { … },
  "ocstudio":  { … }
}
```

- 键名为实现方的稳定短名。**写入方不得删改其它命名空间的内容**；读取方拿到自己的命名空间时应原样吃回。
- `ext` 用于承载「协议未定义、但某一实现需要」的结构（多世界观列表、地图表、私有坐标等）。
- **不得**把主段已有的内容复制一份进 `ext`；**不得**将 `ext` 用作第二套模型。
- 读取方不认识其它命名空间时，原样透传，不解析。

## I.6 关系

### I.6.1 只有一张表

```jsonc
"relations": [
  {
    "key": "character:9f2c…|membership|country:12ab…",   // 可选；缺省按 source|kind|target 推导
    "source": "character:9f2c…",
    "target": "country:12ab…",
    "kind": "membership",
    "label": "属于",
    "directed": false,
    "color": null,          // 实现方的线色标识；无法识别即视为 null
    "arrow": "none",        // none | forward | reverse | both
    "world": null,          // 多世界观下的归属，可缺省
    "createdAt": 0,
    "updatedAt": 0
  }
]
```

- **边的身份**：有 `key` 用 `key`；否则按 `source|kind|target` 推导（无向边先对两端排序再拼接）。
- `kind` 闭集：`character` · `membership` · `event-character` · `event-country` · `event-event` · `nation` · `custom`。无法识别的 kind **保留原值**，按 `custom` 显示。
- `label` 缺省时由读取方按 `kind` 给出默认文案。

### I.6.2 只有这一种形态

- **协议中不存在「对象上的关系投影」**。`countryId`、`relatedCharacters`、事件上的 `relations`、事件上的 `characters`、`relatedNations` 等均为某个实现的内部存法，导出时须摊平为 I.6.1 的边表。
- 反向地，读取方由边表重建自己的投影，属其内部实现，不进入规范。
- 层级（父子）**不是边**，由对象的 `parent` 表达（I.5.3）。需要把父子画成边的读取方自行派生。

## I.7 素材

```jsonc
"assets": [
  { "key": "03f1…", "mime": "image/webp", "sha256": "…",
    "data": "UklGR…",            // 载体 A：base64（不含 data: 前缀）
    "path": "assets/03f1.webp",  // 载体 B：包内相对路径
    "width": 1200, "height": 800 }
]
```

| 规则 | 内容 |
|---|---|
| 引用 | `"asset:<key>"`。`"data:…"` 视为等价（兼容旧备份）。裸路径 = **本地引用**（不随文件走） |
| 二选一 | `data` 与 `path` 不同时写；同时存在时以 `data` 为准 |
| mime 白名单 | `image/png` `image/jpeg` `image/webp` `image/gif` `image/avif` `image/svg+xml` `video/mp4` `video/webm` |
| 上限 | 单素材 ≤ 20 MB · 总量 ≤ 2 GB · 条数 ≤ 50000 |
| 去重 | 相同 `sha256` 只存一份，多个字段共享同一 `key` |
| 未携带 | `includes.assets !== "embedded"` 或解析不到 → 保留原字符串 + 报告「N 个素材未携带」 |
| SVG | 允许，但**不得**执行其中脚本：渲染前剥离 `<script>` 与事件属性 |

## I.8 安全（外部输入）

备份是应用中最主要的一类未校验外部输入。读取方必须：

| 项 | 要求 |
|---|---|
| 大小 | 单文件 ≤ 2 GB；先校验字节长度再解析 |
| 深度 | JSON 嵌套 ≤ 64；超出拒收 |
| 条数 | 单段 ≤ 200000 |
| ZIP | 拒绝 `../`、绝对路径、盘符、符号链接；条目 ≤ 100000；解压总量按压缩比 100 倍设上限 |
| base64 | 按 mime 校验魔数；不匹配时只拒该素材，不拒整份文件 |
| 网络 | 导入过程**不得**发起任何网络请求；远程 URL 一律清空并计数 |
| 执行 | 未知字段一律作数据对待，不得 eval、不得拼装 DOM、不得作为模板渲染 |
| 路径 | 素材落盘路径由读取方**重新分配**，绝不采用文件中的路径 |

## I.9 版本、演进、一致性等级

### 版本

| 变更 | 动作 |
|---|---|
| 增加段 / 增加可选字段 / 增加 kind 取值 | minor +1；旧实现读到会忽略或上报 |
| 修改字段语义 / 变动必填 / 变类型 / 删除字段 | major +1 |
| 旧文件格式 | **始终由适配层处理**（第 II 部分），不通过升 major 解决 |

读取规则：接受**同一 major** 的任何 minor；minor 高于自身时仍尝试读取，并在报告中注明「文件由更新版本生成」；major 不同 → 拒收（或降级读取，降级必须报告）。

### 一致性等级

| 等级 | 要求 |
|---|---|
| **L1 读** | 支持载体 A + B；支持三种来源（本协议 / 两个已知实现的 legacy）；未知段与未知字段**可丢弃，但必须报告数量** |
| **L2 写** | 写出完整信封（含 `scope` / `includes` / `relations` / `assets`）；**未知字段原样保留**；往返后各段条数、关系边数、素材数不变 |
| **L3 身份** | `key` 稳定（生成一次永不变）；重复导入幂等；支持 `subgraph` 导出 |

### 验收夹具

语料库随规范一起分发（见 §III.18），`fixtures/1.0/` 下每个夹具配一份 `<id>.expect.json`：

| 夹具 | 关注点 | 等级 |
|---|---|---|
| `01-s-json` | S 的 legacy `.ocbak`（v1）：可读，时期不丢 | L1 |
| `02-e-json` | E 的 legacy `.ocbak`（v2）：`worlds` / `maps` 有去处 | L1 |
| `03-e-zip` | ZIP 内只有 `oc-data.json` 时能识别 | L1 |
| `04-canonical` | 协议原生形态的最小完整样本 | L1 · L2 |
| `05-assets` | 内联 / 仅路径 / 悬空引用 / 裸本地路径 四种素材状态各自的报法 | L1 |
| `06-relations` | 关系全集：边数相等，`color` / `arrow` / `directed` 往返不变 | L1 · L2 |
| `07-unknown-fields` | 5 个未登记键：L2 往返后仍在；L1 允许丢弃但必须报数 | L1 · L2 |
| `08-subgraph` | 子图闭包自洽，无关对象不出现、无悬空边 | L1 · L3 |
| `09a`–`09g` | 畸形：截断 / 缺段 / 深度 / zip 越界 / mime 不符 / major 不同 / key 重复 | L1 |

判定一律对照 `expect.json` 里的**数字**，不看「没报错」。

---

# 第 II 部分 · 适配层

> 这一部分**不是规范**。它描述「各实现方当前的存法」与「第 I 部分的对象模型」之间的翻译。
> 可按实现方独立修订，修订不影响核心（见 III.17）。

## II.10 通用适配规则

### 读旧文件

按 I.2 的探测顺序，1–3 均不成立时，依次尝试：

| 线索 | 判定为 |
|---|---|
| `meta.format === "oc-editor-backup"` | E legacy（`version: 2`） |
| 有 `data.periods` 或 `data.meta`，且顶层无 `meta` | S legacy（`version: 1`） |
| 仅含 `data.characters` 等五张表 | 来源未知：按 S legacy 尽力读取，报告标注「来源未知」 |
| ZIP 内的 `oc-data.json` | E legacy |

**`version` 字段仅用于这一层探测，永不作为语义判据** —— 两个已知实现的 v2 含义不同（S 的 v1 = +periods +meta；E 的 v2 = +maps +worlds +meta）。

### 行 → 对象

- `type` 由段名反推（`characters` → `character`，去掉复数 s；`worldEntries` → `worldEntry`）。
- `key` 的取值顺序：
  1. 行内已有 `uid` → 直接采用（并建议此后写入自身存储，见 II.10.3）
  2. 无 `uid` → **确定性派生**：`sha1(type + "|" + name或title + "|" + createdAt)` 取前 32 位十六进制。
     代价需明确记录：**改名会产生新的 `key`**，等同于新对象。这是未存储 `uid` 的实现需要承担的代价。
- 数字 `id` **仅在本次解析内有效**：先建立 `(type, id) → key` 的临时映射，把行内所有数字引用改写为 `"<type>:<key>"`，随后丢弃 `id`。

### 写回旧格式

- 导出给旧版本时，`key` 写入 `uid` 字段。多一个键无害：旧版本会忽略它，但会原样再导出 —— 这正是需要的效果。

### II.10.3 建议各实现方采纳的一项

**在内部存储中增加一个 `uid` 字段，新建对象时生成一次。** 成本：一个字段 + 一处生成。收益：`key` 稳定、改名不断链、重复导入幂等、后续做同步具备基础。不采纳亦可运行（依赖确定性派生），代价是改名会断链。

## II.11 适配：S

### 导出

| 协议 | S 现状 | 处理 |
|---|---|---|
| `data.characters` | `db.characters` | 行 → 对象；`custom` 原样；`graphPosition` 原样（未登记字段） |
| `data.events` | `db.events` | 事件上的 `relations[]` → 摊平为 I.6.1 的边（kind `event-event`） |
| `data.countries` | `db.countries` | 无镜像名单（已移除），无需去重 |
| `data.worldEntries` | `db.worldEntries` | 含分类条目 / 小说 / **地图笔记** |
| `data.tags` | `db.tags` | 同形 |
| `data.periods` | `db.periods` | **必须导出**（E 当前不导出该段） |
| `data.worlds` | 无（单世界） | 写 0 条；世界名 / 简介 / 封面放入 `ext.ocstudio.project` 或 `project` |
| `data.maps` | 无（地图为笔记） | 不写；地图对象留在 `data.worldEntries`（`category: "地图"`） |
| `relations` | 内嵌数组 | 摊平，见 II.13 |
| `assets` | 图片已内联为 `data:` URI | 转为 `assets[]` + `asset:<key>` 引用 |

### 导入

- `data.worldEntries` 中 `category === "地图"`：仍按笔记落地（S 的地图即笔记）。
- `data.maps` 有内容：**不得丢弃**，整段存入 `ext.ocstudio.maps` + 报告「N 张地图暂未映射」。
- `data.worlds` 多于 1 条：只取用户选定的一条（或第一条），其余存入 `ext` + 报告。
- E 的对象缺 `graphPosition`：不补，交由布局算法处理。

### 已知缺口

- 无 `uid` → 走确定性派生（II.10）。
- 地图笔记与 E 的 `maps` 表语义不同（seed / params 各一套），互不映射，各自保留。

## II.12 适配：E

### E 当前未纳入导出的三项

以下三项是两个已知实现之一（E）当前未包含在导出范围中的内容。这与协议兼容性无关，属实现侧的导出范围问题：

| 缺什么 | 证据 | 结果 |
|---|---|---|
| `periods` | 导出函数仅列 6 张表；导入侧亦不识别 | S → E → S 一圈，时期全部丢失 |
| `relations` 表（E 自 v7 起的真源） | 同上 | 边仅靠对象上的投影存活，`kind` / `directed` / `color` / `arrow` 均丢失 |
| 图片二进制 | 其 ZIP 内 README 明示「图片二进制仍保存在本地数据目录」 | 跨机 / 跨软件搬库丢失图片 |

### 导出 / 导入映射

| 协议 | E 现状 | 处理 |
|---|---|---|
| `data.*` 的对象 | 每行带 `worldId` | `worldId` 映射到 `world` 或存入 `ext` |
| `data.worlds` | `worlds` 表 | 1 条时同时写 `project`；多条全部写出 |
| `data.maps` | `maps` 表（含 `imageBlob` / `paintBlob`） | **禁止**把 Blob 写入 JSON（会变成 `{}`）；二进制走 `assets`，字段写 `asset:<key>`；`seed` + `params` 已足以重建 |
| `entityKind` | `character` / `weapon` / `pet` | 原样保留（未登记字段）；S 以分类笔记表达同类语义，不强行互换 |
| `customFields[]` | `[{id,label,value}]` | 与 S 的 `custom: Record` **并存**，两者都保留（II.13.4） |
| `relationships[]` / `relatedNations[]` / `relatedEvents[]` | 数组投影 | 摊平为边 |
| `country.characters` / `country.events` | 镜像数组 | 真源在对象侧（`Character.countryId` / `Event.countries`）；对象侧存在时以其为准，仅在对象侧缺失时用于补全 |
| `graphPosition` | 无（不存储节点坐标） | 不补；S 的坐标存入 `ext.ocstudio`，不影响其它实现 |

### 图片

E 的图片位于 Tauri `appDataDir`，行内存储的是相对 `appData` 的路径。写入 `assets` 需要一条「读取本地字节 → base64」的链路（E 侧已有 `lib/local-media.ts` 的 `blobFromLocalPath`；S 侧对应 Rust 命令）。若无法实现，须在 `includes.assets` 写 `"referenced"` 并如实报告数量。

## II.13 投影 → 边（重建语义表）

旧文件没有 `relations` 表时，由投影重建。**该表仅属适配层** —— 它描述的是各实现的私有存法，不是协议。

| 投影 | source → target | kind | label 缺省 | directed |
|---|---|---|---|---|
| `Character.countryId` | character → country | `membership` | 属于 | false |
| `Character.relatedCharacters[]` | character → character | `character` | 相关 | false |
| `Character.relationships[]`（E） | 依 `targetType` | `custom` | 相关 | true |
| `Character.relatedNotes[]`（S） | character → worldEntry | `custom` | 相关 | true |
| `Character.relatedNations[]`（E） | country → country | `nation` | 关系 | false |
| `Character.relatedEvents[]`（E） | event → character | `event-character` | 参与 | true |
| `Event.characters[]` | event → character | `event-character` | 参与 | true |
| `Event.countries[]` | event → country | `event-country` | 发生于 | true |
| `Event.relations[]` | event → event | `event-event` | 相关 | true |
| `Country.relatedNations[]`（E） | country → country | `nation` | 关系 | false |
| `Country.characters[]`（E，兜底） | character → country | `membership` | 属于 | false |
| `WorldEntry.relations[]`（S） | worldEntry → worldEntry | `custom` | 关系 | true |
| `WorldEntry.references[]` | 依 `targetType` | `custom` | 引用 | true |

规则：

- **对象侧优先**：同一事实存在两种存法时（如 `Character.countryId` 与 `Country.characters[]`），以对象侧为准，镜像仅用于补空。
- 同名同向的边合并为一条；`kind` 冲突时保留对象侧的那条。
- 无向边（`membership` / `character` / `nation`）两端排序后再生成 `key`，避免双向各存一条。

### II.13.4 两套自定义字段

| | S | E |
|---|---|---|
| 值 | `custom: Record<string,string>` | `customFields: [{id,label,value}]` |
| 定义 | 独立字段表（`.ocstudio/fields.json` + 基本信息组件） | 无独立定义，`label` 随行 |

- 同一对象**可以同时带两者**。
- 读取方：自身那套优先；另一套按 `label` 尝试对应到自己的字段名，无法对应的存入 `ext` + 报告。
- **不得**因形状不同而丢弃另一方的值。

## II.14 字段键登记（开放，非校验）

用途：让读取方了解某个键的大致含义。**未登记的键必须原样保留**（I.5.2）。

**通用**：`key` `aliases` `tags` `parent` `document` `content` `createdAt` `updatedAt` `deleted` `order` `uid`（legacy，等同 `key`）`_syncStatus` `_lastModified`（实现内部簿记，可丢）

**character**：`name` `avatarUrl` `headerUrl` `qAvatarUrl`(E) `accentColor`(E) `animationUrl` `animationType`(E) `race` `element` `occupation` `height` `birthday` `nationalityLegacy` `countryId` `faction`(S) `factionId`(S) `gender` `orientation` `age` `weight` `bloodType` `hairColor` `eyeColor` `birthplace` `residence` `personality` `hobbies` `skills` `affiliation` `weapon` `pet` `ability` `status`（以上为 E 的扩展）`bio` `lifeStory` `custom`(S) `customFields`(E) `hiddenFields`(E) `folder`(S) `folderId`(E) `relatedCharacters` `relationships`(E) `relatedNotes`(S) `relatedNations`(E) `relatedEvents`(E) `gallery` `avatars` `isMajor`(S) `entityKind`(E)

**event**：`title` `time` `endTime` `location` `summary` `characters` `countries` `parentEventId` `relations` `headerUrl` `images` `isMajor` `mapPosition`(S) `mapId`(S) `graphPosition`(S) `aliases`(S)

**country**：`name` `parentId` `description` `system` `geography` `culture` `flagUrl` `headerUrl` `accentColor`(E) `gallery`(S) `characters`(E) `events`(E) `relatedNations`(E) `relatedEvents`(E) `graphPosition`(S) `custom`(S) `aliases`(S)

**worldEntry**：`title` `category` `parentId` `content` `summary`(S) `time` `endTime` `location`(S) `cover` `avatar` `image` `gallery`(S) `template`(S) `relations`(S) `references` `novelAuthor` `novelSynopsis` `novelTargetWords` `novelNotes` `novelCover` `chapterOutline`(S) `mapImage` `mapWidth` `mapHeight` `mapSeed` `mapParams` `mapMode` `mapAnnotations`(S) `graphPosition` `mapPosition` `mapId` `order`(S) `isConcept` `custom`(S) `aliases`(S)

**tag**：`name` `category` `color`
**period**：`name` `startTime` `endTime` `color`
**world**：`name` `description` `accentColor` `order`
**map**（E）：`name` `seed` `params` `annotations` `thumbnail` `imageBlob` `paintBlob` `political` `acceptedAt` `isTemplate` `parentWorldId` `linkedEntities` `placement` `stats`

---

# 第 III 部分 · 附录

## III.15 两个已知实现的实测差异（2026-11-10，依据源码）

| 项 | S | E |
|---|---|---|
| 载体 | 单 JSON `.ocbak` | 单 JSON `.ocbak` + ZIP（`oc-data.json` + `manifest` + `README`） |
| 版本字段 | `version: 1`（+periods +meta） | `version: 2`（+maps +worlds +meta） |
| `periods` | 导出 / 导入均支持 | 导出、导入均不支持 |
| `relations` 真源 | 内嵌数组 | `relations` 表，但不在导出范围内 |
| 图片 | 内联 `data:` URI | 不携带（存 Tauri appData） |
| 地图 | 笔记 + `mapSeed` / `mapParams` | `maps` 表 + `imageBlob`（Blob） |
| 世界观 | 单世界（`meta` 单例） | `worlds` 表 + 每行 `worldId` |
| 自定义字段 | `custom: Record` + 独立字段表 | `customFields: [{id,label,value}]` |
| 节点坐标 | `graphPosition` | 不存储 |
| 导入合并 | 按名字，丢弃 id | 按名字（同世界内），丢弃 id；额外做 `stripRemoteUrls` |
| 编辑器 | Tiptap 3.22 | Tiptap 3.32，自定义节点同名同 attrs |
| 库名 | `OCStudioDB` | `OCStudioDB` |

结论：两个已知实现当前**可以互读**，但都伴随未声明的信息损失（E 侧为 periods / relations / 图片；S 侧为 E 的 maps / worlds）。协议的目标不是「让文件能被读取」，而是**把信息损失变成协议内可见的事实**：要么保住，要么在报告中点名。

## III.16 待定（需各实现方共同确认）

1. **`uid` 是否在 L2 即强制？** 当前：L2 可选（走确定性派生），L3 强制。
2. **`maps` 段归属**：E 为独立表、S 为笔记对象。当前两者互不映射，各自存入 `ext`。是否需要约定一个统一形态？
3. **素材是否必须自带？** S 自带、E 不带。定「必须」→ E 需补「本地路径 → base64」；定「可选」→ 跨软件搬库必丢图，界面需明示。
4. **是否为 E 补齐 `periods` / `relations` / 图片**：三处改动都较小，建议一并提出。
5. **`wikiLink` 目标解析**：按 `name` 还是按文件名？建议协议只承诺 `key`，名字解析归实现细节。
6. **设置 / 主题 / 模板 / 字段表是否进入备份？** 建议 1.1 再议，另立 `data.config`。

## III.17 本文档的修订方式

- **第 I 部分**：修改字段语义 / 变动必填 / 删除内容 → 需共同确认；增加可选字段、增加 kind 取值 → 任一实现方可提出，升 minor。
- **第 II 部分**：**可由各实现方独立修订**。它只描述各自现状，修订方负责同步自己那一段。
- **第 III 部分**：修改数字前先核对源码，不做推测。
- **改第 I 部分必须同时加 / 改夹具**（§III.18），否则改动不可验证，视为未生效。

## III.18 一致性验证

「实现到哪一级」必须能被量出来，不能靠形容词。验证由五样东西组成，缺一样就只能人眼对，等于没验。

| 组成 | 位置 | 归属 |
|---|---|---|
| **夹具**（含畸形） | `fixtures/1.0/` | 随规范分发，全项目只有一份 |
| **结构化期望** | `fixtures/1.0/<id>.expect.json` | 同上，结构见 `schema/expect.schema.json` |
| **语料清单与指纹** | `fixtures/1.0/index.json` | 每个夹具的 sha256；两边报告的 `suiteSha256` 不一致即表示跑的不是同一份语料 |
| **runner** | 各实现自己的仓库 | 它要跑在各自的存储层上，不共享 |
| **一致性报告** | `CONFORMANCE.json` | 结构见 `schema/conformance.schema.json`；两份报告可直接 diff |

三条约定：

1. **错误码只认 `errors.md`**。两个实现对同一件事的报法必须逐字一致，否则报告没法对账。
2. **等级由检查项算出**，不是自评：L1 = 全部 L1 夹具 pass；L2 = L1 全过且往返结果与 `expected/` 的规范化形态一致；L3 = L2 全过且 `key` 稳定、重复导入幂等、子图可用。
3. **`not-applicable` 必须给理由**。不做多世界观的实现可以对 `worlds` 相关项报不适用，但理由要写出来，不能拿它充通过。

夹具是**生成**的，不是手写的：`node tools/build-fixtures.mjs` → `node tools/check-corpus.mjs`（后者只验语料自洽，不验任何实现）。改夹具改生成器，不要手改产物。

### 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-10 | 初稿：字段并集 + 双形态关系 |
| 2026-11-10 | 重构为三段式：规范（单一 `key` / 单一关系表 / 开放字段 / 三种载体 / `scope`）+ 适配层 + 附录。移除 `version` 语义、`counts`、对象侧关系投影、字段闭集 |
| 2026-11-10 | 全文改为中立表述；新增 §0 术语与记法；附录表述改为「已知实现的实测差异」 |
| 2026-11-10 | 新增 §III.18 一致性验证；验收夹具表对齐实际夹具 id（01–09）；明确「改规范须同改夹具」 |
