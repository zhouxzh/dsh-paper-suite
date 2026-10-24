# dsh-paper-suite

[![test](https://github.com/zhouxzh/dsh-paper-suite/actions/workflows/test.yml/badge.svg)](https://github.com/zhouxzh/dsh-paper-suite/actions/workflows/test.yml)

论文套件：**一个 Host 插件 + 两个 skill**。插件负责必须被执行的动作（生成骨架、核对引用、编译、拉取证据），skill 负责必须被记住的判断规则（证据边界、中文 LaTeX 约定）。

## 组成

### 工具（`lib/`）

| 工具 | 作用 |
|---|---|
| `paper_scaffold` | 生成中文 LaTeX 论文骨架，已存在文件一律跳过，手写正文不会被覆盖 |
| `paper_audit` | 离线审计：引用 ↔ `.bib` 双向核对、重复键、缺字段、花括号、占位符、claim map locator、作者 TODO、PDF 新鲜度 |
| `paper_build` | latexmk 编译，返回结构化诊断：引擎、页数、错误、未定义引用、缺字形、overfull box |
| `paper_sync_evidence` | 从远程代码仓只拉 `.csv/.json/.md/.yaml/.bib` 到 `evidence/`，逐个记 SHA-256；二进制产物拒收 |
| `paper_kit` | 骨架 + 三处仓库登记 + 审计 +（可选）编译，一次跑完 |

### Skill（`skills/`）

| Skill | 作用 |
|---|---|
| `paper-evidence` | 数字必须绑定证据文件与协议；协议不混池；negative 必须保留；claim 状态如何判定 |
| `paper-latex-cn` | 中文稿的目录、前言、章节、表格约定与编译排错顺序 |

skill 是纯文件，复制进技能根即可被 `dsh-skill-filesystem` 扫描到。**新增 skill 后需要新开 DSH 会话**，当前会话不会热更新。

## 安装

```bash
# 1. 插件（工具）
npm pack
dsh plugin --profile desktop add file:C:/path/to/dsh-paper-suite-0.1.0.tgz

# 2. skills（纯文件）
node scripts/install-skill.mjs            # 默认装到 ~/.dsh/skills
node scripts/install-skill.mjs --check    # 校验是否已装且为最新
```

重启 DSH 桌面端后工具生效。

## 边界

- **离线**：不判断 DOI 是否真实存在，也不判断结论是否正确。`paper_audit` 只证明内部证据链自洽。
- **不覆盖**：`paper_scaffold` 与仓库登记对已存在内容保持沉默。
- **登记默认 dry-run**：`README.md`、`AGENTS.md`、`docs/code_repository_split.md` 只在 `applyRegistries=true` 时落盘。
- **证据边界**：`paper_sync_evidence` 的扩展名白名单是硬约束。

## 网页面板

安装后 DSH 侧边栏会出现 **论文审计** 面板（`paper-suite`）。它读取 Host 的
`GET /paper-suite/report.json`，不做任何写操作。

面板回答三个问题：

| 维度 | 检查内容 |
|---|---|
| **完整性** | 章节是否齐全且已撰写、claims 是否登记、每条 claim 是否有证据、PDF 是否存在且新于源文件 |
| **结果一致性** | `\ref` 是否有对应 `\label`、`\includegraphics` 文件是否存在、每个 table 是否有 caption、摘要/结论里的数字能否在结果或 `evidence/` 中找到 |
| **逻辑** | 引言是否有明确贡献、讨论是否写明局限、结论是否重申适用范围、claims 是否仍有 pending |

**判定强度**：文件缺失、悬空引用、claim 无证据、PDF 过期属于 `error`（论文判 fail）；章节偏短、表格缺 caption、数字找不到属于 `warn`；"讨论有没有局限"这类启发式判断只报 `info`，不会把论文判失败。

面板扫描的根目录来自插件配置 `repoRoot`，默认为 DSH 进程工作目录：

```yaml
- id: dsh-paper-suite
  name: dsh-paper-suite
  config:
    repoRoot: D:/Github/nonstationary-mamba
```

每篇论文是根目录下**含 `main.tex` 的子目录**。单文件论文（所有 section 写在一个 `main.tex`）同样支持：此时按 `\section{}` 标题判断完整性，不要求使用 `sections/` 拆分布局。

对应工具是 `paper_review`：传 `workspace` 审单篇，传 `root` 审整批。

## 安全与权限边界

这个插件会调用外部程序并写文件，公开使用前应知道它的边界：

- **`paper_scaffold` / `paper_kit`** 会在你传入的绝对 `root` 下创建目录与文件；它们不会覆盖已存在的文件，但会创建新路径。
- **`paper_sync_evidence`** 通过 `scp` 拉取文件。`host` 必须匹配 `[A-Za-z0-9][A-Za-z0-9._-]*`，远程路径必须以 `/` 或 `~/` 开头；这两条校验会阻止 `host` 被当成 `scp` 选项（例如 `-oProxyCommand=...`）。`scp` 以 `BatchMode=yes` 运行，不会交互式索要密码。
- **`paper_build`** 会在指定工作区执行 `latexmk`。TeX 能读文件、能通过 `\write18` 执行命令，因此**不要对来源不可信的 `.tex` 运行编译**。
- **`paper_audit`** 只读：读 `.tex` / `.bib` / manifest 并报告问题，不修改稿件。
- **仓库登记**（`README.md`、`AGENTS.md`、`docs/code_repository_split.md`）默认 dry-run，只有 `applyRegistries=true` 才落盘。

## 测试

```bash
npm test
```

CI 在 Node 18 / 20 / 22 上跑同一套测试，并额外执行 `npm pack --dry-run` 校验发布文件清单。

三组测试，全部离线：

1. `test/smoke.mjs` — 脚手架幂等、正文不被覆盖、引用双向核对、日志解析、登记行插入、二进制拒收。
2. `test/host.mjs` — 用桩模块启动 `apply()`，确认 5 个工具都能注册、render 正常、失败路径退回文本。
3. `test/skills.mjs` — 每个 skill 的 frontmatter 合法、name 与目录一致、description 足以路由，安装后可 round-trip 校验。

## 目录

```text
dsh-paper-suite/
├── lib/            # 工具实现
├── skills/         # paper-evidence, paper-latex-cn
├── scripts/        # install-skill.mjs
├── test/           # smoke / host / skills
├── cordis.patch.yml
└── SOURCE.md       # 上游归属与再分发条件
```
