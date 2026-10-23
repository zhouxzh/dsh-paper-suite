# Sources and attribution

This suite ships its own skill text and its own tool code. It does **not** vendor
upstream skill files, so no third-party text is redistributed here. The upstream
projects below informed the structure and are the recommended companions.

| Project | License | Relationship |
| --- | --- | --- |
| [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | MIT | Upstream of the `scientific-writing` skill already installed on this machine. `paper-evidence` is written to complement it, not to replace or fork it. |
| [Yuan1z0825/nature-skills](https://github.com/Yuan1z0825/nature-skills) | Apache-2.0 | Upstream of `nature-polishing`. Polishing stays with that skill; this suite does not duplicate it. |
| `dsh-plugin-ascend310b-writing` | local | Reference implementation for "one plugin + bundled skills" packaging on this machine. Its README documents that skills are plain files scanned from a skill root. |

## If you later vendor an upstream skill

Bundling upstream files changes the licensing obligation. Then you must:

1. copy the upstream `LICENSE` into `LICENSES/<project>/LICENSE`;
2. record the exact upstream commit here;
3. keep the original `SKILL.md` frontmatter intact (name, license, metadata);
4. state in `README.md` that the skill is redistributed, not authored here.

Until that is done, keep upstream skills as separate installs and let this suite
ship only its own `paper-evidence` and `paper-latex-cn`.
