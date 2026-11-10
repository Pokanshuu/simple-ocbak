# simple-ocbak

`.ocbak` 交换协议的**规范 + 语料库 + 校验工具**。目标只有一个：让不同的软件能互相读写同一份设定集备份，且**丢东西丢得看得见**。

不依赖任何框架、不依赖网络、不需要安装依赖：`node` 二十四以上即可。

---

## 里面有什么

| 路径 | 内容 |
|---|---|
| `SPEC.md` | 协议正文。**实现方只需读第 I 部分**（九节）；第 II 部分是各实现的旧格式适配，不属于规范 |
| `schema/` | JSON Schema：信封、期望文件、一致性报告。只钉「不可协商」的部分，实体字段是开放的 |
| `fixtures/1.0/` | 一致性语料库：15 个夹具 + 各自的 `expect.json` + 2 份规范化基准 |
| `fixtures/1.0/index.json` | 语料清单：每个夹具验什么、属于哪级、sha256（用于确认两边跑的是同一份语料） |
| `tools/build-fixtures.mjs` | 生成夹具（**不要手改** `fixtures/` 下的产物） |
| `tools/check-corpus.mjs` | 语料库自检：它不测任何实现，只测「语料本身有没有写错」 |
| `errors.md` | 错误码表。报告里的错误必须用这张表里的码，不能用散文 |

---

## 三步接入

1. **读规范**：`SPEC.md` 第 I 部分。九节，二十分钟。
2. **写 runner**：读 `fixtures/1.0/index.json`，逐个夹具做检查，与自己产出的结果比对 `fixtures/1.0/<id>.expect.json`。
   runner 属于各实现自己的仓库 —— 它要跑在你的存储层上，不能共享。
3. **出报告**：按 `schema/conformance.schema.json` 生成 `CONFORMANCE.json` 贴回来。两份报告可以直接 diff。

语料库的 sha256 在 `index.json` 里。两边报告的 `suiteSha256` 不一致，说明跑的不是同一份语料，先对齐语料再谈别的。

---

## 语料库

| 夹具 | 验什么 | 等级 |
|---|---|---|
| `01-s-json` | OC Studio 的旧 `.ocbak`（`version: 1`，6 张表 + `meta` + `periods`）能被识别并读入 | L1 |
| `02-e-json` | OC editor 的旧 `.ocbak`（`version: 2`，含 `worlds` / `maps` / `imageBlob` 残骸）能被识别；`maps` 必须进 `ext` 并计数 | L1 |
| `03-e-zip` | ZIP 里没有 `ocbak.json` 时回落到 `oc-data.json`；`manifest.json` / `README.txt` 不得作为判据 | L1 |
| `04-canonical` | 协议原生形态的最小完整样本：信封 / key / 引用 / 正文 / 素材 | L1 · L2 |
| `05-assets` | 素材四种状态：内联能落地、只有路径要报「未携带」、悬空引用要报、裸本地路径要报 | L1 |
| `06-relations` | 关系全集：六种 `kind`、`color` / `arrow` / `directed` 往返不变 | L1 · L2 |
| `07-unknown-fields` | 5 个未登记键：L2 必须原样保留，L1 允许丢但必须报数 | L1 · L2 |
| `08-subgraph` | `scope: subgraph` 的闭包自洽：无关对象不出现，不出现悬空边 | L1 · L3 |
| `09a-truncated` | 截断的 JSON → `PARSE_ERROR` | L1 |
| `09b-missing-section` | 缺 `data.events` → `MISSING_SECTION` | L1 |
| `09c-deep` | 嵌套 106 层 → `DEPTH_EXCEEDED` | L1 |
| `09d-zip-slip` | ZIP 里含 `../evil.txt` → `ZIP_PATH_ESCAPE`（同包内的合法 `ocbak.json` 用于确认拒绝发生在路径检查） | L1 |
| `09e-mime-mismatch` | 声明 `image/png` 但魔数是 JPEG → 只拒该素材（`MIME_MISMATCH`），不拒整份文件 | L1 |
| `09f-unknown-major` | `protocol: 2.0` → `UNKNOWN_MAJOR` | L1 |
| `09g-duplicate-key` | 同类对象 `key` 重复 → `KEY_DUPLICATE` | L1 |

---

## 期望文件

每个夹具配一份 `<id>.expect.json`，结构见 `schema/expect.schema.json`。要点：

```jsonc
{
  "fixture": "06-relations",
  "protocol": "1.0",
  "levels": ["L1", "L2"],
  "checks": ["relations", "roundtrip"],
  "expect": {
    "read": { "characters": 3, "events": 1, "countries": 2 },
    "relations": { "edges": 7, "byKind": { "membership": 1, "character": 1 }, "unresolved": 0 },
    "assets": { "embedded": 2, "notCarried": 0, "unresolved": 0, "rejected": 0, "localRefs": 0 },
    "unknownFields": { "preserved": 0 },
    "ignored": [],
    "errors": []
  }
}
```

- **`reject`**：`true` 表示整份文件应被拒绝；`false` 表示只报错、照常导入（`09e` 就是这种）。
- **`ignored`**：读不懂但**必须报出来**的段 / 键。
- **`errors`**：只用 `errors.md` 里的码。
- 畸形夹具不带 `read` —— 它要验的不是条数。

L2 / L3 的往返比对看 `fixtures/1.0/expected/`：比的是**规范化之后**的结构，不是字节。规范化规则写在 `expected/README.md`。

---

## 等级怎么算

| 等级 | 判定 |
|---|---|
| **L1 读** | 10 个 L1 夹具全部 pass。未知字段可以丢，但报告里必须有数 |
| **L2 写** | L1 全过 + `04` / `06` / `07` 的写出往返与 `expected/` 一致 |
| **L3 身份** | L2 全过 + `key` 生成一次永不变 + 同文件导入两次 `added == 0` + `08` 子图可用 |

不适用项写 `not-applicable`（例如不做多世界观的实现，不必实现 `worlds` 的映射），但**不适用必须给理由**，不能拿它当通过。

---

## 改这份东西的流程

**加 / 改夹具**（任何人可做，不影响规范）：

```bash
# 1. 改 tools/build-fixtures.mjs（数据与期望都在里面）
node tools/build-fixtures.mjs      # 2. 重新生成
node tools/check-corpus.mjs        # 3. 必须全绿
```

`fixtures/` 下全是产物。手改会被下一次 build 覆盖，而且会让 sha256 对不上。

**改规范**：

- **第 I 部分**（信封 / key / 引用 / 关系 / 素材 / 安全）：需要各实现方共同确认。加可选字段与 `kind` 取值升 minor；改语义升 major。
- **第 II 部分**（适配层）：各实现方改自己那一段，不需要协商。

**语料库自检不通过就不提交。** 语料错了，所有实现方都会照着错的东西改。

---

## 语料库不验什么

| 验不了 | 怎么办 |
|---|---|
| 界面流程（选文件 / 合并策略 / 报告文案） | 人工清单，8 步，每步一张截图 |
| 导入后正文排版 | 抽查 2 篇：标题层级 / 图片块 / 内链可点 |
| 大库性能（1 万条 + 2 GB 素材） | 单独一份压力夹具，不进门禁 |
| 真实应用的导出文件 | `01` / `02` / `03` 就是两边的真实导出形态（已脱敏） |

---

## 已知实现

| 代号 | 产品 | 现状 |
|---|---|---|
| S | OC Studio | 未达 L1：出 JSON 单文件、图片内联；无 `format` / `key` / 关系表；导入只认 `version` 1 / 2 |
| E | OC editor | 未达 L1：出 JSON + ZIP；`periods` / `relations` / 图片不在导出范围内 |

两边当前**可以互读**，但都带未声明的信息损失。协议要解决的就是这件事。
