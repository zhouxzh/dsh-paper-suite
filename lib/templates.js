/**
 * Scaffold templates for a Chinese LaTeX paper workspace.
 *
 * The preamble mirrors the four paper workspaces already in this repository
 * (scrartcl + ctex + biblatex APA + XeLaTeX) so a generated workspace compiles
 * on the same TeX Live installation without further tuning.
 *
 * @module dsh-paper-suite/templates
 */

const MAIN_TEX = (title, author) => `% !TeX program = xelatex
\\ifdefined\\pdfminorversion
  \\pdfminorversion=7
\\fi
\\documentclass[
    fontsize=10pt,
    paper=a4,
    pagesize,
    DIV=10,
    headings=normal,
    numbers=noenddot,
    captions=tableheading
]{scrartcl}

\\usepackage[UTF8,scheme=plain]{ctex}
\\usepackage{iftex}
\\ifPDFTeX
  \\usepackage{stix2}
\\fi
\\usepackage{microtype}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{array}
\\usepackage{authblk}
\\usepackage{booktabs}
\\usepackage{graphicx}
\\usepackage{float}
\\usepackage{tikz}
\\usepackage{hyperref}
\\usepackage{xcolor}
\\usepackage{csquotes}
\\usepackage{placeins}
\\usepackage[american]{babel}
\\addto\\captionsamerican{%
  \\renewcommand{\\figurename}{图}%
  \\renewcommand{\\tablename}{表}%
}
\\usepackage[style=apa,backend=biber,sortcites=true,sorting=nyt]{biblatex}
\\usepackage[automark]{scrlayer-scrpage}
\\usetikzlibrary{arrows.meta,positioning,calc,fit}
\\addbibresource{references.bib}

\\setlength{\\emergencystretch}{1em}
\\setlength{\\textfloatsep}{12pt plus 4pt minus 2pt}
\\setlength{\\floatsep}{10pt plus 2pt minus 2pt}
\\setlength{\\intextsep}{10pt plus 2pt minus 2pt}
\\setkomafont{disposition}{\\normalfont\\bfseries}
\\setkomafont{section}{\\normalfont\\bfseries\\large}
\\setkomafont{subsection}{\\normalfont\\bfseries\\normalsize}
\\setkomafont{caption}{\\normalfont\\small}
\\setkomafont{captionlabel}{\\normalfont\\bfseries\\small}
\\setlength{\\textfraction}{0.10}
\\renewcommand{\\Authfont}{\\small}
\\renewcommand{\\Affilfont}{\\footnotesize}

\\clearpairofpagestyles
\\ihead{\\small\\runningtitle}
\\cfoot{\\small\\pagemark}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    citecolor=blue,
    urlcolor=blue,
    pdftitle={${title}},
    pdfauthor={${author}}
}

\\newcommand{\\runningtitle}{${title}}
\\title{${title}}
\\author{${author}}
\\date{}

\\begin{document}

\\maketitle
\\thispagestyle{scrheadings}

\\input{sections/abstract}
\\input{sections/introduction}
\\input{sections/related_work}
\\input{sections/method}
\\input{sections/experimental_setup}
\\input{sections/results}
\\input{sections/discussion}
\\input{sections/conclusion}
\\input{sections/declarations}
\\printbibliography[title={参考文献}]
\\FloatBarrier
\\appendix
\\input{sections/appendix/notes}

\\end{document}
`;

const MAKEFILE = `TEX := main.tex
PDF := main.pdf
SECTION_TEX := $(wildcard sections/*.tex)
APPENDIX_TEX := $(wildcard sections/appendix/*.tex)

.PHONY: pdf clean watch help

pdf: $(PDF)

$(PDF): $(TEX) references.bib $(SECTION_TEX) $(APPENDIX_TEX)
\t@if command -v latexmk >/dev/null 2>&1; then \\
\t\tlatexmk -xelatex -interaction=nonstopmode -halt-on-error $(TEX); \\
\telif command -v xelatex >/dev/null 2>&1 && command -v biber >/dev/null 2>&1; then \\
\t\txelatex -interaction=nonstopmode -halt-on-error $(TEX); \\
\t\tbiber $(basename $(TEX)); \\
\t\txelatex -interaction=nonstopmode -halt-on-error $(TEX); \\
\t\txelatex -interaction=nonstopmode -halt-on-error $(TEX); \\
\telse \\
\t\techo "No suitable LaTeX toolchain found."; \\
\t\texit 127; \\
\tfi

watch:
\t@latexmk -xelatex -pvc -interaction=nonstopmode -halt-on-error $(TEX)

clean:
\t@if command -v latexmk >/dev/null 2>&1; then latexmk -c $(TEX); \\
\telse rm -f *.aux *.bbl *.bcf *.blg *.fdb_latexmk *.fls *.log *.out *.run.xml *.toc *.xdv; fi

help:
\t@echo "Targets:"
\t@echo "  make pdf   Build the manuscript"
\t@echo "  make watch Rebuild continuously"
\t@echo "  make clean Remove auxiliary LaTeX files"
`;

const README = (title, slug) => `# ${title}

本目录是论文 LaTeX 工作区，不是可执行代码仓库。

**状态：** 脚手架已生成，正文待作者撰写。作者、单位、基金、伦理、数据与代码可用性、AI 披露均未确认；投稿前见 [\`audit/author_verification_required.md\`](audit/author_verification_required.md)。

从本目录执行 \`make pdf\`。数字必须能回到 [\`evidence/\`](evidence/) 与 [\`audit/claim_evidence_map.md\`](audit/claim_evidence_map.md)。claims 见 [\`claims_register.md\`](claims_register.md)。

工作区标识：\`${slug}\`。
`;

const ABSTRACT = `\\begin{abstract}
\\noindent\\textbf{摘要}\\par\\smallskip
<待撰写：问题、方法、数据集、主结果、结论边界。不得写入尚未绑定到 evidence/ 的数字。>
\\end{abstract}

\\noindent\\textbf{关键词：} <关键词 1>；<关键词 2>；<关键词 3>
`;

const SECTION = (heading, body) => `\\section{${heading}}
\\label{sec:${body}}

<待撰写>
`;

const DECLARATIONS = `\\section*{数据、代码与声明}

正文数字须能追溯到 \`evidence/\` 中的紧凑表与其来源记录。原始数据、checkpoint、prediction array 不进入本论文仓库。

作者贡献、资金支持、利益冲突、数据许可、伦理声明与 AI 使用披露须由全体作者在投稿前逐项确认；本稿不代替作者作出这些声明。
`;

const CLAIMS = `# Claims Register

Status 由作者核对证据后更新；生成器不会自动把 claim 标成 supported。

| ID | Claim | Evidence | Status |
| --- | --- | --- | --- |
| C1 | <可证伪的主张> | \`evidence/<file>.csv\` | pending |

Negative、failed、interrupted 与 superseded 证据必须保留，不得删除。
`;

const CLAIM_MAP = `# Claim–Evidence Map

**Paper scope:** <本稿的估计对象与适用范围>。不得与其他协议或版本混池。

| Claim | Compact locator | Remote locator | Boundary |
| --- | --- | --- | --- |
| C1 | \`evidence/<file>.csv\` | \`<host>:<path>\` | <适用范围> |
`;

const AUTHOR_TODO = `# Author Verification Required Before Submission

Updated: <YYYY-MM-DD>

Status: unresolved. 本文件由脚手架生成，投稿前必须逐项确认。

- 确认作者名单、通讯作者、单位、邮箱与 ORCID。
- 复核目标期刊当前的投稿说明、AI 使用政策、数据与代码政策。
- 若目标期刊为英文，需另出英文稿；当前工作语言为中文。
- 确认 CRediT 贡献声明。
- 确认资金与项目号，或明确声明无资助。
- 确认利益冲突。
- 确认伦理审批、知情同意或豁免声明是否适用。
- 确认可公开的数据与代码范围；不得把原始数据、checkpoint、prediction array 复制进本论文仓库。
- 确认 AI 协助的范围与披露措辞。
- 逐条打开 \`evidence/\` 中的数字来源并签认。
- 保留 negative / failed / coverage-gate-failed 结果。
`;

const REFERENCES = `% 只登记真实存在、已核对元数据的条目。
% 生成器不联网、不编造条目；缺字段时请用 DOI 元数据手工补齐。

@article{example-key,
  author  = {Last, First},
  title   = {Example Title},
  journal = {Example Journal},
  year    = {2026},
  volume  = {1},
  pages   = {1--10},
  doi     = {10.0000/example}
}
`;

const PROVENANCE = (slug) => `{
  "architecture_id": "${slug}",
  "source_server": "<host>",
  "source_repository": "<absolute path on the code host>",
  "source_branch_at_sync": "<branch>",
  "historical_commit": "<commit sha at the time evidence was copied>",
  "paper_workspace": "${slug}/",
  "remote_access": "read-only inspection; compact tables copied, no checkpoints or prediction arrays",
  "do_not_copy": ["dataset/", "checkpoints", "prediction arrays"]
}
`;

const APPENDIX = `\\section{补充材料}
\\label{app:notes}

<待撰写。>
`;

/**
 * Build the full scaffold for one paper workspace.
 * @param {{title: string, slug: string, author?: string}} options
 * @returns {Record<string, string>} relative path → file content
 */
export function paperScaffold({ title, slug, author = '待作者确认' }) {
	return {
		'README.md': README(title, slug),
		'Makefile': MAKEFILE,
		'main.tex': MAIN_TEX(title, author),
		'references.bib': REFERENCES,
		'claims_register.md': CLAIMS,
		'audit/claim_evidence_map.md': CLAIM_MAP,
		'audit/author_verification_required.md': AUTHOR_TODO,
		'provenance/code-provenance.json': PROVENANCE(slug),
		'evidence/.gitkeep': '',
		'sections/abstract.tex': ABSTRACT,
		'sections/introduction.tex': SECTION('引言', 'intro'),
		'sections/related_work.tex': SECTION('相关研究', 'related'),
		'sections/method.tex': SECTION('方法', 'method'),
		'sections/experimental_setup.tex': SECTION('实验设计', 'setup'),
		'sections/results.tex': SECTION('结果', 'results'),
		'sections/discussion.tex': SECTION('讨论', 'discussion'),
		'sections/conclusion.tex': SECTION('结论', 'conclusion'),
		'sections/declarations.tex': DECLARATIONS,
		'sections/appendix/notes.tex': APPENDIX
	};
}

/** Files that carry author-written prose and therefore must never be overwritten. */
export const PROTECTED_FILES = [
	'main.tex',
	'references.bib',
	'claims_register.md',
	'audit/claim_evidence_map.md',
	'audit/author_verification_required.md'
];
