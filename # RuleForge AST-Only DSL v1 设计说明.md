# RuleForge AST-Only DSL v1 设计说明

## 0. 背景&结论
本文仍使用“DSL”指代文本合规性判定规则的领域专用表达语言。与常见的“子句列表 + 逻辑表达式字符串”形式不同，本文在实现层面采用 **AST（抽象语法树）作为 DSL 的唯一规范表示**。因此，DSL 是语言层概念，AST 是该 DSL 的结构化表示、校验对象与执行载体；二者并不冲突。 

之所以采用 AST 作为 DSL 的唯一规范表示，而不再额外维护“clauses + expr”双形态，是因为 AST 更利于统一完成规则生成后的结构校验、递归执行、命中路径解释、复杂度统计和后续能力扩展。相较于字符串表达式，AST 可以减少解析歧义，降低无效引用与结构错误，更适合作为系统内部的标准执行对象。

本文研究目标“自然语言规则到 DSL 的生成、评价、优化与融合判定”保持不变；本次细化设计仅将 DSL 的内部实现形式进一步明确为 AST JSON，以增强可执行性、可校验性与可扩展性，不改变原有研究问题、系统边界与实验主线。

需要说明的是，虽然 AST 结构为未来扩展预留了能力，但当前版本仅实现最简布尔规则树，包括 `predicate / and / or / not` 四类节点，以及 `contains_any / regex / len_gt / len_lt / in_set / not_in_set / count_gt` 七类原子操作。词表引用、上下文关系、加权评分、模糊逻辑与受控自定义算子等能力仅作为后续兼容扩展方向，当前不纳入 MVP 范围。

## 1. 目标

RuleForge 的 DSL 采用 **AST-only** 设计。系统内规则的唯一规范表示是 JSON AST，不再同时维护 `clauses + expr` 双形态。

当前版本只实现**最简可执行布尔规则树**，但结构必须允许未来平滑扩展到：

* 词表引用
* 上下文关系
* 打分规则
* 模糊逻辑
* 受控自定义算子

当前实现先只支持最小子集，不提前实现未来能力，但结构要为未来预留位置。

---

## 2. 设计原则

### 2.1 单一规范表示

数据库、API、执行器、评测器、优化器统一使用 AST JSON。
不得将 `expr` 字符串作为正式执行输入。

### 2.2 执行优先

DSL 的价值在于可执行、可验证、可解释、可扩展。
所有字段设计优先服务执行器、验证器和解释器。

### 2.3 扩展优先

扩展能力通过两条路径实现：

* 新增 `node_type`
* 新增 `operator`

其中：

* 逻辑结构升级，优先新增 `node_type`
* 原子谓词升级，优先新增 `operator`

### 2.4 当前只实现最简布尔子集

v1 只实现：

* `and`
* `or`
* `not`
* `predicate`

以及以下 operator：

* `contains_any`
* `regex`
* `len_gt`
* `len_lt`
* `in_set`
* `not_in_set`
* `count_gt`

未来结构可以扩，但当前不要提前实现评分、模糊逻辑、自定义函数。

---

## 3. 顶层对象结构

```json
{
  "dsl_version": "1.0",
  "rule_id": "R_001",
  "name": "辱骂与威胁拦截",
  "root": {
    "node_type": "or",
    "id": "n_root",
    "children": [
      {
        "node_type": "predicate",
        "id": "c1",
        "field": "content",
        "operator": "contains_any",
        "value": ["傻X", "垃圾", "废物"]
      },
      {
        "node_type": "predicate",
        "id": "c2",
        "field": "content",
        "operator": "regex",
        "value": "(弄死你|杀了你|让你消失)"
      }
    ]
  },
  "action": {
    "type": "block",
    "severity": "high"
  },
  "semantics": {
    "mode": "boolean"
  },
  "meta": {
    "candidate_type": "strict",
    "source": "llm_generated"
  }
}
```

---

## 4. 顶层字段定义

### `dsl_version`

DSL 版本号。当前固定为 `"1.0"`。

### `rule_id`

规则唯一标识。

### `name`

规则名称。

### `root`

规则树根节点。必须是一个合法 AST 节点。

### `action`

规则命中后的动作定义。当前最简支持：

* `block`
* `review`
* `allow`

### `semantics`

语义模式。当前固定：

```json
{"mode": "boolean"}
```

未来可以扩展为：

* `weighted`
* `fuzzy`

但当前不实现。

### `meta`

附加信息，不参与执行语义。可用于：

* candidate_type
* owner
* tags
* source
* notes

---

## 5. AST 节点总定义

当前 AST 节点共有 4 类：

* `and`
* `or`
* `not`
* `predicate`

统一字段：

```json
{
  "node_type": "...",
  "id": "..."
}
```

可选统一扩展字段：

```json
{
  "meta": {},
  "extensions": {}
}
```

说明：

* `meta` 仅用于展示、审计、生成来源记录
* `extensions` 为未来扩展保留
* 当前执行器忽略空 `meta`
* 当前校验器要求 `extensions` 为空或不存在；若出现非空 `extensions`，直接报“不支持扩展特性”

这样可避免“表面预留，实际上静默吃掉未知能力”

---

## 6. 四类节点定义

## 6.1 `and` 节点

```json
{
  "node_type": "and",
  "id": "n1",
  "children": [ ... ]
}
```

约束：

* `children` 长度必须 `>= 2`
* 每个 child 必须是合法 AST 节点

语义：

* 所有子节点为真，当前节点才为真

---

## 6.2 `or` 节点

```json
{
  "node_type": "or",
  "id": "n2",
  "children": [ ... ]
}
```

约束：

* `children` 长度必须 `>= 2`

语义：

* 任一子节点为真，当前节点即为真

---

## 6.3 `not` 节点

```json
{
  "node_type": "not",
  "id": "n3",
  "child": { ... }
}
```

约束：

* 必须且只能有一个 `child`

语义：

* 对子节点布尔结果取反

---

## 6.4 `predicate` 节点

```json
{
  "node_type": "predicate",
  "id": "c1",
  "field": "content",
  "operator": "contains_any",
  "value": ["傻X", "垃圾"]
}
```

当前字段：

### `field`

目标字段名，如：

* `content`
* `title`
* `title_len`
* `author_id`

必须在字段字典中存在。

### `operator`

操作符名，当前只允许最小集合。

### `value`

操作符参数。其结构由 operator 决定。

### `value_ref`

为未来词表引用预留。当前可出现在 schema 中，但 v1 不执行，建议直接禁用；若出现则校验失败，提示“v1 暂不支持 value_ref”。

---

## 7. v1 支持的 operator

## 7.1 `contains_any`

示例：

```json
{
  "node_type": "predicate",
  "id": "c1",
  "field": "content",
  "operator": "contains_any",
  "value": ["傻X", "垃圾", "废物"]
}
```

约束：

* `field` 对应值必须是字符串
* `value` 必须是非空字符串数组

语义：

* 只要字段文本包含数组中任一词项，即命中

证据输出：

* 命中的具体词项
* 命中片段位置（若可计算）

---

## 7.2 `regex`

```json
{
  "node_type": "predicate",
  "id": "c2",
  "field": "content",
  "operator": "regex",
  "value": "(杀了你|弄死你)"
}
```

约束：

* `value` 必须是合法正则字符串

语义：

* 正则匹配成功则命中

证据输出：

* 命中的文本片段
* match span

---

## 7.3 `len_gt`

```json
{
  "node_type": "predicate",
  "id": "c3",
  "field": "title",
  "operator": "len_gt",
  "value": 30
}
```

语义：

* `len(field_value) > value`

---

## 7.4 `len_lt`

```json
{
  "node_type": "predicate",
  "id": "c4",
  "field": "title",
  "operator": "len_lt",
  "value": 5
}
```

语义：

* `len(field_value) < value`

---

## 7.5 `in_set`

```json
{
  "node_type": "predicate",
  "id": "c5",
  "field": "author_id",
  "operator": "in_set",
  "value": ["u_1", "u_2"]
}
```

语义：

* 字段值属于给定集合则命中

---

## 7.6 `not_in_set`

```json
{
  "node_type": "predicate",
  "id": "c6",
  "field": "author_id",
  "operator": "not_in_set",
  "value": ["u_1", "u_2"]
}
```

语义：

* 字段值不属于给定集合则命中

---

## 7.7 `count_gt`

```json
{
  "node_type": "predicate",
  "id": "c7",
  "field": "content",
  "operator": "count_gt",
  "value": {
    "target": "!",
    "threshold": 3
  }
}
```

v1 明确定义：

* `count_gt` 只对**当前 field 的原始值**计数
* 不允许跨字段
* 不允许模糊作用域

字符串字段下：

* 统计 `target` 在文本中的出现次数
* 若次数 `> threshold`，则命中

当前不支持：

* token 级计数
* 正则计数
* 多 target 计数

这些留到未来版本。

---

## 8. 最简 AST 示例

## 8.1 单谓词规则

```json
{
  "dsl_version": "1.0",
  "rule_id": "R_001",
  "name": "辱骂词拦截",
  "root": {
    "node_type": "predicate",
    "id": "c1",
    "field": "content",
    "operator": "contains_any",
    "value": ["傻X", "垃圾", "废物"]
  },
  "action": {
    "type": "block",
    "severity": "high"
  },
  "semantics": {
    "mode": "boolean"
  }
}
```

## 8.2 组合规则

```json
{
  "dsl_version": "1.0",
  "rule_id": "R_002",
  "name": "威胁或显式辱骂",
  "root": {
    "node_type": "or",
    "id": "n_root",
    "children": [
      {
        "node_type": "predicate",
        "id": "c1",
        "field": "content",
        "operator": "contains_any",
        "value": ["傻X", "垃圾", "废物"]
      },
      {
        "node_type": "predicate",
        "id": "c2",
        "field": "content",
        "operator": "regex",
        "value": "(弄死你|杀了你|让你消失)"
      }
    ]
  },
  "action": {
    "type": "block",
    "severity": "high"
  },
  "semantics": {
    "mode": "boolean"
  }
}
```

## 8.3 含 NOT 的规则

```json
{
  "dsl_version": "1.0",
  "rule_id": "R_003",
  "name": "含辱骂词且不在白名单用户中",
  "root": {
    "node_type": "and",
    "id": "n_root",
    "children": [
      {
        "node_type": "predicate",
        "id": "c1",
        "field": "content",
        "operator": "contains_any",
        "value": ["傻X", "垃圾"]
      },
      {
        "node_type": "not",
        "id": "n_not_1",
        "child": {
          "node_type": "predicate",
          "id": "c2",
          "field": "author_id",
          "operator": "in_set",
          "value": ["trusted_u1", "trusted_u2"]
        }
      }
    ]
  },
  "action": {
    "type": "review",
    "severity": "medium"
  },
  "semantics": {
    "mode": "boolean"
  }
}
```

---

## 9. 校验规则

v1 校验分三层。

## 9.1 L1：JSON 可解析

要求：

* JSON 合法
* 必须有 `dsl_version` / `rule_id` / `root` / `action` / `semantics`

## 9.2 L2：Schema 合法

要求：

* `dsl_version = "1.0"`
* `semantics.mode = "boolean"`
* `root` 为合法节点
* 节点字段符合 node schema
* operator 在白名单中
* field 在字段字典中
* value 类型符合 operator 约束

## 9.3 L3：可执行合法

要求：

* 所有 operator 均有 executor 实现
* 所有 field 类型与 operator 匹配
* 正则可编译
* `and/or/not` 递归结构合法
* 节点树可成功编译为可执行函数

---

## 10. 执行输出标准

执行器不能只输出 true/false，必须输出 trace。

单条规则对单样本的输出格式建议为：

```json
{
  "rule_id": "R_002",
  "sample_id": "S_1001",
  "final_hit": true,
  "action": {
    "type": "block",
    "severity": "high"
  },
  "trace": {
    "node_id": "n_root",
    "node_type": "or",
    "result": true,
    "children": [
      {
        "node_id": "c1",
        "node_type": "predicate",
        "result": false,
        "evidence": null
      },
      {
        "node_id": "c2",
        "node_type": "predicate",
        "result": true,
        "evidence": {
          "matched_text": "弄死你",
          "span": [5, 8]
        }
      }
    ]
  }
}
```

要求：

* 每个节点都有 `result`
* predicate 节点尽量返回 `evidence`
* group 节点保留子节点结果
* 最终 trace 足够支持样本级解释

---

## 11. 当前开发实现范围

当前先只实现以下内容。

### 必须实现

* AST JSON Schema
* 四类节点
* 七个 operator
* 三级校验
* AST 执行器
* trace 输出
* 复杂度统计：节点数、树深度、predicate 数量

### 不实现但要预留

* `value_ref`
* scoring
* fuzzy
* custom operators
* context-aware nodes

### 明确不做

* 双形态存储
* expr 字符串解析器
* 任意脚本执行
* 用户自定义代码注入

---

## 12. 扩展机制

未来扩展分三层。

## 12.1 第一层：新增 operator

适合原子谓词升级，例如：

* `near`
* `same_sentence`
* `not_negated`
* `contains_all`
* `starts_with`
* `ends_with`

这类扩展不改 AST 主结构，只新增 operator registry 项。

---

## 12.2 第二层：新增 node_type

适合逻辑结构升级，例如：

* `threshold`
* `weighted_sum`
* `fuzzy_and`
* `fuzzy_or`

例如未来可扩展：

```json
{
  "node_type": "threshold",
  "id": "n_score",
  "threshold": 0.8,
  "children": [
    {
      "node_type": "weighted_predicate",
      "id": "c1",
      "weight": 0.4,
      "field": "content",
      "operator": "contains_any",
      "value_ref": "lexicon:insult_core_v1"
    },
    {
      "node_type": "weighted_predicate",
      "id": "c2",
      "weight": 0.9,
      "field": "content",
      "operator": "regex",
      "value": "(杀了你|弄死你)"
    }
  ]
}
```

但 v1 不实现这类节点。

---

## 12.3 第三层：新增资源引用

适合把静态 value 升级成可治理资产：

* `value_ref = lexicon:*`
* `value_ref = entity_set:*`
* `value_ref = regex_bundle:*`

例如：

```json
{
  "node_type": "predicate",
  "id": "c1",
  "field": "content",
  "operator": "contains_any",
  "value_ref": "lexicon:insult_core_v1"
}
```

v1 先不执行，v2 再开。

---

## 13. 推荐的 Operator Registry 结构

虽然 v1 先只做最简实现，但代码上建议一开始就用注册表模式。

建议接口：

```ts
type OperatorSpec = {
  name: string
  supported_field_types: string[]
  validateValue: (value: unknown) => ValidationResult
  execute: (fieldValue: unknown, value: unknown, sample: Record<string, unknown>) => ExecResult
  explain: (execResult: ExecResult) => string
  complexity_cost: number
}
```

当前 7 个 operator 都注册进去。
未来加新 operator 时，不改 AST 基本结构，只加注册项和测试。

---

## 14. 推荐的 TypeScript 类型定义

```ts
type RuleDSL = {
  dsl_version: "1.0"
  rule_id: string
  name: string
  root: ExprNode
  action: {
    type: "block" | "review" | "allow"
    severity: "low" | "medium" | "high"
  }
  semantics: {
    mode: "boolean"
  }
  meta?: Record<string, unknown>
}

type ExprNode = AndNode | OrNode | NotNode | PredicateNode

type BaseNode = {
  id: string
  meta?: Record<string, unknown>
  extensions?: Record<string, unknown>
}

type AndNode = BaseNode & {
  node_type: "and"
  children: ExprNode[]
}

type OrNode = BaseNode & {
  node_type: "or"
  children: ExprNode[]
}

type NotNode = BaseNode & {
  node_type: "not"
  child: ExprNode
}

type PredicateNode = BaseNode & {
  node_type: "predicate"
  field: string
  operator:
    | "contains_any"
    | "regex"
    | "len_gt"
    | "len_lt"
    | "in_set"
    | "not_in_set"
    | "count_gt"
  value?: unknown
  value_ref?: string
}
```

注意：

* v1 中 `value_ref` 若出现，直接校验失败
* v1 中 `extensions` 若非空，直接校验失败

---

## 15. 开发约束

### 15.1 AST 是唯一正式输入

所有 API、DB、执行器都使用 AST。
不要在后端额外引入 `expr` 解析器。

### 15.2 Pretty Text 只做派生视图

如果前端需要显示：

* `(辱骂词) OR (威胁表达)`

由 AST 动态生成，不落库为正式 DSL。

### 15.3 未来扩展不破坏 v1

扩展方式优先通过：

* 新 operator
* 新 node_type
* 新 resource ref

不要修改现有 node 的基本含义。

### 15.4 非支持特性必须显式报错

不能静默忽略未知字段、未知 node_type、未知 operator。

---

## 16. 未来蓝图

## v1：最简布尔 AST

实现：

* predicate / and / or / not
* 七个 operator
* 布尔执行
* trace
* 复杂度统计

## v2：资产引用 AST

新增：

* `value_ref`
* 词表 / 集合 / regex bundle
* 资源版本绑定

## v3：上下文 AST

新增 operator：

* `near`
* `same_sentence`
* `not_negated`
* `ordered_near`

## v4：评分 AST

新增 node_type：

* `threshold`
* `weighted_sum`

## v5：软逻辑 AST

新增 node_type：

* `fuzzy_and`
* `fuzzy_or`
* `fuzzy_not`

## v6：受控扩展 AST

新增：

* 白名单 custom operator registry
* 每个 operator 自带验证、执行、解释模板、复杂度成本

---

## 17. 给开发 agent 的一句话实现要求

**请以 AST JSON 作为 RuleForge DSL 的唯一规范表示。当前只实现布尔 AST 最小子集，不实现评分、模糊逻辑、资源引用和自定义函数，但代码结构必须允许未来通过新增 node_type 和 operator 平滑扩展。**

---

如果你要，我下一条可以直接把这份内容继续收缩成两份更“工程化”的东西：
一份 `dsl-schema.json` 草案，一份 `api-contract.md` 草案。
