# 错误码

报告里的错误必须用这张表里的码。散文（「文件好像坏了」）不可用于对账 —— 两个实现报同一件事时，长的必须一样。

代码用大写下划线。`scope` 说明错误作用于整份文件还是一个素材。

| 码 | scope | 触发条件 | 处置 | 报告字段 |
|---|---|---|---|---|
| `NOT_A_BACKUP` | 文件 | 按内容探测既不是本协议、也不是任何已知 legacy 形态 | 拒收 | — |
| `PARSE_ERROR` | 文件 | 不是合法 JSON；ZIP 中央目录损坏；`ocbak.json` 不是合法 JSON | 拒收 | `detail`（解析器消息，不要直接抛给用户） |
| `MISSING_SECTION` | 文件 | 信封缺 `data`、缺 `relations`、缺 `assets`，或 `includes.sections` 声明的段不存在 | 拒收 | `path` |
| `UNKNOWN_MAJOR` | 文件 | `protocol` 的 major 与本实现不同，且无法降级 | 拒收 | `protocol` |
| `DEPTH_EXCEEDED` | 文件 | JSON 嵌套深度 > 64 | 拒收 | `depth` |
| `SIZE_EXCEEDED` | 文件 | 文件 > 2 GB，或解压总量超过压缩比的 100 倍 | 拒收 | `limit` |
| `COUNT_EXCEEDED` | 文件 | 单段对象数 > 200000，或 ZIP 条目数 > 100000 | 拒收 | `section` / `count` |
| `KEY_MISSING` | 文件 | 对象缺 `key` | 拒收 | `section`、`index` |
| `KEY_DUPLICATE` | 文件 | 同类对象内 `key` 重复 | 拒收 | `type`、`key` |
| `ZIP_PATH_ESCAPE` | 文件 | ZIP 条目含 `../`、绝对路径、盘符、符号链接 | 拒收 | `entry` |
| `ZIP_UNREADABLE` | 文件 | ZIP 结构可读但没有 `ocbak.json`，且没有可回落的 legacy 文件名 | 拒收 | `entries`（前若干条） |
| `MIME_NOT_ALLOWED` | 素材 | mime 不在白名单 | 跳过该素材 | `key`、`mime` |
| `MIME_MISMATCH` | 素材 | 字节魔数与声明的 mime 不符 | 跳过该素材，**不拒文件** | `key`、`mime`、`magic` |
| `KEY_DANGLING` | 引用 | 引用解析不到目标 | 保留原字符串，计数 | `from`、`ref` |

## 警告（不是错误，但必须出现在报告里）

| 码 | 触发条件 | 报告字段 |
|---|---|---|
| `REF_UNRESOLVED` | 引用语法合法但目标不在文件内（可能被删、可能是局部导出） | `count`、`examples[]` |
| `ASSET_NOT_CARRIED` | 素材条目只有 `path` 没有 `data`，或 `includes.assets !== "embedded"` | `count` |
| `ASSET_LOCAL_REF` | 字段里是裸本地路径（不是 `asset:`、不是 `data:`） | `count` |
| `UNKNOWN_FIELD_DROPPED` | 实现无法保存未登记字段，丢弃了 N 个 | `count`、`examples[]` |
| `SECTION_IGNORED` | 不认识的段，整段进了 `ext` 或丢弃 | `path`、`count` |
| `NEWER_MINOR` | 文件 minor 高于本实现支持的 minor | `protocol` |
| `COUNT_MISMATCH` | 文件里若有计数摘要（如 ZIP 的 `manifest.json`）与实际条数不符 | `expected`、`actual` |

## 两条规矩

1. **拒收必须说清是「哪一项」**：`MISSING_SECTION` 要给 `path`，`ZIP_PATH_ESCAPE` 要给 `entry`。只说「文件不合法」等于没报。
2. **能跳过就不要拒收**：单个素材坏、单条引用断，都只跳过那一个并计数。只有整份文件无法建立解释时才拒收。
