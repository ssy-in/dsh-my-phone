# 投稿到 awesome-dsh-plugin（插件商店）

**状态（2026-11-01）：已收录。** PR #11054 已合并，
条目已在 main 里：`data/plugins/ssy-in__dsh-my-phone.yml`。
之后又误开过一个重复的 PR #11214，维护者（@fkysly）以「与 #11054 重复」关闭 ——
结论：**不要重复提交同一个文件**，要改描述就基于最新 main 提一个「修改已有条目」的 PR。

目标仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
规则原文：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
查于 2026-10-31。

## 一句话流程

Fork 那个仓库 → 在 fork 里新建 **一个** 文件 `data/plugins/ssy-in__dsh-my-phone.yml`（内容＝同目录这份 yml）→ 提 PR。
两个 README 是脚本从 `data/plugins/*.yml` 生成的，**不要手改**，PR 合并后会自动重生成。

## 逐条对照（contributing.md 的要求）

| 要求 | 我们的情况 |
|---|---|
| `package.json` 里要有 `dsh.bundle` manifest（只有 `dsh.client` 不算，这是最常见的被拒原因） | ✅ `"dsh": { "bundle": { "patch": "./cordis.yml" } }` |
| 仓库要有真实可用代码（占位/纯 README 不收） | ✅ |
| 仓库创建满 **1 天**（CI 自动查） | ⬜ 建于 `2026-10-30T17:21Z` → 要等到 **2026-11-01 01:21 北京时间** |
| 加 `dsh-plugin` topic | ⬜ 2026-10-31 09:49 查 API 仍是空的，没保存成功 |
| 描述只讲功能、不带营销词 | ✅ |
| 描述必须属实（会被逐条核对代码） | ✅ 局域网/隧道二维码配对、实时消息列表、授权提醒、桌面悬浮球，都真做了 |
| 分类贴合实际做的事 | ✅ `remote` |
| 一个文件一份投稿、不碰别人条目 | ✅ |
| （推荐）发布到 npm，安装可跳过 build 授权 | ⬜ 没发 npm，非必需 |

## 网页开 PR 的步骤

1. https://github.com/awesome-dsh-plugin/awesome-dsh-plugin → 右上 **Fork** → Create fork（fork 到 `ssy-in`）。
2. 在你 fork 的仓库里进 `data/plugins/` → **Add file ▾ → Create new file**。
3. 文件名：`ssy-in__dsh-my-phone.yml`（**两个下划线**，owner__repo）。
4. 粘贴同目录 `ssy-in__dsh-my-phone.yml` 的内容。
5. 底部 **Commit changes** → 选 *Create a new branch for this commit* → 分支名 `add-dsh-my-phone` → **Propose changes**。
6. 自动跳到开 PR 页：标题 `Add ssy-in/dsh-my-phone`，正文写一两句（插件做什么 + `dsh.bundle` 已在 `package.json` 里）→ **Create pull request**。
7. 等 CI（几分钟）跑绿；维护者会实际读仓库再合并，有问题会以 PR comment 指出要改什么。

注意：**PR 里只应有这一个新文件**，不要动 `README.md` / `README.zh.md` 或别人的条目。

## 已确认的技术细节

- `icon` 可选，用 GitHub 托管的位图：`https://raw.githubusercontent.com/ssy-in/dsh-my-phone/main/icon-256.png`（仓库根目录已提交）。不写就回退到作者头像。
- 描述里含 `: `（半角冒号+空格）必须加引号；这份英文描述没有半角冒号，中文用的全角冒号，都不用加。
- 分类可选值里最贴的是 `remote`。
