---
name: reviewer-response-letter
description: 审稿人回复意见（response letter / rebuttal letter）的 LaTeX 工作流。用于从作者 DOCX 回复稿迁移出点对点回复信，保持蓝色删除、红色新增的修订标记，按正文编号与排版复现公式，引用论文正式图片并独立编译，逐条核对审稿意见与答复。触发词包括 response letter、审稿意见回复、回复信、rebuttal、reviewer response。
license: MIT
compatibility: 需要 XeLaTeX；颜色审计脚本需要 python-docx；图片与公式核对需要可编译的论文源文件。
metadata:
  version: "1.0"
  skill-author: local
---

# Reviewer Response Letter

把作者写好的 Word 回复稿，整理成可独立编译、颜色语义正确、公式与图片和正文一致的 LaTeX response letter。

## 何时使用

- 从 `response letter english.docx` 或中文回复稿生成 LaTeX 回复信。
- 修订稿返修后需要更新回复信中的公式编号、图片或参考文献编号。
- 回复信出现颜色漏标、图片放错、公式排版与正文不一致、旧 DOCX 文字残留。
- 提交前检查 response letter 与 DOCX 是否逐条对应。

## 绝对规则（不得违反）

1. **颜色语义固定**：蓝色 `#215E99` = 从原稿删除的文字；红色 `#EE0000` = 修订或新增的文字。不得自创颜色含义。
2. **颜色必须内嵌在原回复中**：在作者原本展示“原文 / 修订文”的位置直接着色。禁止另建 `Revision markup`、`Change made` 等重复段落重复一遍内容。
3. **短删除用行内标记**：只删一个词或短语（如 ``However``）时用 `\textcolor{deletedblue}{...}`，不要用独立 `deletedblock`，否则句号会被挤到下一行。
4. **整段增删用环境**：整段新增用 `addedblock`，整段删除用 `deletedblock`；环境内文字自动着色。
5. **caption 一字不改**：图注必须与作者 DOCX 完全一致，禁止改写、补 “in the revised manuscript:”、禁止把 `Fig.8` 改成 `Fig.~8` 或把 `C1` 改成 `$C_1$`。原 DOCX 中为红色的图注继续标红。
6. **替换图片后删除旧 caption**：用 `\includegraphics` 插入论文图后，必须删除 DOCX 迁移残留的旧图注文字，避免双图注。
7. **图片用论文正式图**：不得从 DOCX 解包 `word/media/` 当图源。把论文目录中的原图复制到 `response letter/images/`，LaTeX 只引用 `images/...`，保证独立编译。
8. **图片与审稿意见对应**：每条意见用哪张图必须逐一核对（例如 Comment 3-3 用 Fig. 3，不能沿用 Fig. 2）。
9. **公式复现正文排版**：回复信引用正文公式时使用 `equation` / `equation*` 显示公式与 `\mathrm` 下标，禁止 `\(...\)` 行内公式加手写 `(16)`。
10. **公式编号以渲染后的正文 PDF 为准**：`\label{eq18}` 只是标签名，不等于显示编号；必须编译正文后核对 PDF 中的实际编号，再用 `\tag{n}` 标注。同一公式只展示一次。
11. **数字与单位同处数学环境**：写作 `\(C_{1}=0.81~\mathrm{nF}\)`，禁止 `\(C_1=0.81\)nF`。
12. **不改写作者答复内容**：只做排版与颜色迁移。不得新增实验、数据、结论或审稿人原文；缺失内容标记待作者确认。
13. **参考文献重编号要说明**：正文新增文献导致引用编号变化时，在相关回复中补一句说明，例如 “the reference numbers have changed because several references were added”。
14. **标题不缩进**：使用 KOMA-Script `parskip=half`，段间留白、不首行缩进；回复信不使用 `scrlttr2`（长文档易编译卡死）。
15. **版本命名跟随投稿历史**：`V1` = 初投稿，`V2` = 当前返修稿；回复信放 `V2/response letter/`，不得因草稿迭代出现 `V3`。

## 目录约定

```text
V2/response letter/
├── response letter english.docx   # 作者原稿，唯一内容来源
├── response letter中文.docx        # 中文对照，可选
├── response-letter.tex            # 正式 LaTeX
├── response-letter.pdf            # 编译产物
├── comment-response-mapping.md    # 意见/答复映射与差异记录
├── README.md                      # 人工复核入口
├── images/                        # 论文正式图副本（进版本库）
└── work/                          # 提取、转换、脚本、日志、预览（gitignore）
```

根目录只保留人工复核需要的文件；`.aux`、`.log`、`.out`、预览 PNG、Pandoc 中间文件全部放 `work/`。`.gitignore` 至少包含：

```gitignore
out/
*.aux
*.bbl
*.blg
*.fdb_latexmk
*.fls
*.log
*.out
*.synctex.gz
*.xdv
response letter/work/
response letter/*.aux
response letter/*.log
response letter/*.out
response letter/*preview*.png
```

## 工作流

### 1. 摸清源文件

- 读作者 DOCX、中文对照稿（如有）、投稿意见原文。
- 用 `scripts/audit_docx_colors.py` 导出全部带颜色段落的 JSON，确认蓝/红段落总数。
- 统计审稿人意见条数，与 LaTeX 的 comment 块数量对齐（示例：Editor 1 + R1 6 + R2 4 + R3 14 = 25 块）。

### 2. 搭 LaTeX 骨架

复制 `references/latex-template.tex` 的前言与首页信头，保留：

- KOMA-Script `scrartcl`、A4、11pt、`DIV=12`、`parskip=half`；
- `reviewercomment` 灰底环境与 `response` 蓝底环境；
- `deletedblue`、`addedred`、`addedblock`、`deletedblock`；
- 首页德式信头只出现一次，`\clearpage` 后进入点对点正文。

### 3. 迁移内容

- 按 Reviewer → Comment 顺序迁移意见原文与作者答复。
- 整段新增/删除包环境；词级删除用行内颜色。
- 图注照抄 DOCX；图片改成 `images/xxx` 引用；删掉旧文字。
- 公式改成显示环境、`\mathrm` 下标、正确编号。

### 4. 颜色全量核对

逐段比对 `audit_docx_colors.py` 的输出与 `response-letter.tex`：

- 每个蓝色段落都要在 LaTeX 中出现且标蓝；
- 每个红色段落都要标红；
- 没有 DOCX 颜色依据的内容保持黑色（解释性答复、版式说明）。

常见漏标位置：整段参数敏感性分析、温度边界分析、表格脚注、新增文献正文与参考文献条目、图注。逐页渲染抽检至少覆盖：

```powershell
pdftoppm -f 8 -l 8 -png -r 120 response-letter.pdf work\p8
pdftoppm -f 11 -l 12 -png -r 120 response-letter.pdf work\p11
pdftoppm -f 22 -l 22 -png -r 120 response-letter.pdf work\p22
pdftoppm -f 24 -l 27 -png -r 120 response-letter.pdf work\p24
```

### 5. 公式与编号核对

1. 编译正文 PDF：`pdflatex → bibtex → pdflatex → pdflatex`。
2. `pdftotext -layout` 搜索公式关键字，记录实际显示编号。
3. 用 `\tag{实际编号}` 写入回复信；无编号公式用 `equation*`。
4. 全文搜索 `\(` 中是否还有手写编号、`T_{UP}`、`C1=`、`nF` 出界等旧写法。

### 6. 独立编译与提交检查

```powershell
xelatex -interaction=nonstopmode -halt-on-error response-letter.tex
xelatex -interaction=nonstopmode -halt-on-error response-letter.tex
```

- 在 `response letter/` 目录内编译成功，不依赖论文根目录图片。
- 日志无 `^!`、`Undefined`、`Missing character`、图片缺失。
- 运行 `scripts/check_response_letter.py` 做静态检查。

## 常见故障与修法

| 现象 | 原因 | 修法 |
| --- | --- | --- |
| 句号单独占一行 | 词级删除被包成独立环境 | 改行内 `\textcolor{deletedblue}{...}` |
| 图注重复 | 插图表后旧 DOCX caption 未删 | 删除旧 caption，只留 LaTeX 图注 |
| 图注被改写 | 迁移时“顺手润色” | 逐字恢复 DOCX 原文 |
| 图片放错 | 复用相邻意见的图 | 按审稿意见逐条核对图号 |
| 公式编号错误 | 把 `\label{eq18}` 当显示编号 | 编译正文 PDF 查实际编号 |
| 公式不像正文 | 行内 `\(...\)` + 手写编号 | 改 `equation` + `\tag{n}` |
| 回复信一页彩色缺失 | 整段新增未包 `addedblock` | 对照颜色审计 JSON 逐段补齐 |
| 图片找不到 | 引用 `../FIG.png` | 复制到 `images/` 并改相对路径 |

## 提交前清单

- [ ] 25 个 comment/response 块与审稿意见一一对应
- [ ] 蓝色删除、红色新增与 DOCX 逐段一致
- [ ] 无重复 `Revision markup` 段落
- [ ] 图注逐字等于 DOCX 原文，且颜色正确
- [ ] 图片来自 `images/`，每张图与图号匹配
- [ ] 公式为显示环境、`\mathrm` 下标、编号与正文 PDF 一致
- [ ] 数字与单位同处数学环境
- [ ] 参考文献重编号有说明
- [ ] 独立 XeLaTeX 编译无错误
- [ ] `work/` 与构建产物未进入版本库
- [ ] 版本目录为 V1（初投）/ V2（返修）
