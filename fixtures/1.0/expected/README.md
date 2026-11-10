# expected/

L2 / L3 的往返比对基准：**规范化之后**的结构，不是字节。

规范化规则（`tools/build-fixtures.mjs` 的 `canonicalForm`）：
1. 丢弃簿记字段：`_syncStatus` / `_lastModified` / `createdAt` / `updatedAt`
2. 丢弃 `null` 与 `undefined`
3. 对象键按字典序排序，数组内对象按键排序（`data.*` 按 `key`，`relations` 按 `key`，`assets` 按 `key`）
4. 保留 `format` / `protocol` / `data` / `relations` / `assets`，**丢弃** `producer` / `createdAt` / `includes` / `ext`

比对方式：`canonical(实现导出) === canonical(expected)`。不一致时按路径报差异，不要只报「不相等」。
