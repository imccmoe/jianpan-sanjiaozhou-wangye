# ZFQ 配装方案站

《三角洲行动》/《无畏契约》的社区配装方案库，跑在 Cloudflare Pages + D1 上。
支持按武器类型、游戏模式、作者、关键词筛选，复制方案分享码，社区投稿与后台审核。

> SJZ 三键音乐键盘网页端已拆分为独立仓库（`sjz-keyboard-web`），本仓库不再包含键盘相关代码。

## 功能

- **配装广场**：卡片式方案列表，侧栏多维筛选（游戏 / 模式 / 武器类型 / 热门作者），
  支持关键词搜索、按热度 / 最新 / 价值 / 造价 / 名称排序、分页加载
- **方案详情**：改装参数（操控、稳定、腰射、射程、开镜、后座）进度条展示，
  分享码一键复制，同类方案推荐，反馈统计
- **社区投稿**：匿名提交，进入待审队列，分享码去重与频率限制
- **审核台**：按状态筛选，通过 / 拒绝 / 下架 / 恢复，每次变更写入 `audit_logs`
- **主题**：白天 / 夜晚 / 跟随系统三档

## 快速开始

```powershell
npm install
npx wrangler d1 create wy-zfq-config-hub   # 把输出的 database_id 填进 wrangler.toml
npm run db:migrate:local                   # 建表
npm run db:seed                            # 生成种子 SQL 并导入本地 D1
npm run dev                                # 启动 Pages + D1，并自动准备 ADMIN_TOKEN
```

打开 `http://127.0.0.1:8788/hub/`。

`npm run dev` 会：

1. 把 workerd 的临时目录指向仓库内（`.wrangler-local/tmp`）。**这一步是必需的**：
   workerd 默认在 `os.tmpdir()` 下创建 `miniflare-email-store`，而 `%LOCALAPPDATA%\Temp`
   在受限环境里不可写，会直接启动失败并报 `kj/filesystem-disk-win32.c++: CreateDirectory: #5 拒绝访问`
2. 首次运行时生成 `.dev.vars`（已 gitignore）并写入随机 `ADMIN_TOKEN`，同时打印出来
3. 启动 `wrangler pages dev`

本地 D1 使用 wrangler 默认状态目录（仓库内的 `.wrangler/state`），
与 `db:migrate:local` / `db:seed` 完全一致。

## 审核台

地址 `/hub/#/admin`（首页也有入口卡片）。令牌在 `.dev.vars` 的 `ADMIN_TOKEN`：

```powershell
Select-String -Path .dev.vars -Pattern ADMIN_TOKEN
```

令牌只存在该标签页的 sessionStorage，刷新不用重输，关掉标签页即失效。
生产环境用 `npx wrangler pages secret put ADMIN_TOKEN` 设置。

状态流转规则：

| 动作 | 允许的起始状态 | 结果 |
| --- | --- | --- |
| `approve` | pending / rejected / hidden | active |
| `reject` | pending / active / hidden | rejected |
| `hide` | active / pending | hidden |
| `restore` | hidden / rejected | active |

非法流转返回 409，每次变更写入 `audit_logs`。

## 接口

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/meta` | 站点元信息、类型/游戏/模式分布、热门作者 |
| `GET /api/schemes` | 方案列表，支持 `game` `mode` `type` `q` `author` `minValue` `sort` `limit` `offset` |
| `GET /api/schemes/:id` | 方案详情；仅返回已发布方案 |
| `POST /api/schemes/submit` | 匿名投稿，进入 pending；同客户端每小时最多 8 条 |
| `POST /api/schemes/feedback` | 反馈 `good` / `inaccurate` / `weak` / `invalid`，24 小时内同类型去重 |
| `GET /api/admin/schemes` | 审核队列，需 `ADMIN_TOKEN` |
| `POST /api/admin/review` | 审核动作 `approve` / `reject` / `hide` / `restore` |

`sort` 取值：`hot`（默认）、`new`、`value`、`price`、`name`。`limit` 上限 60。
完整定义见 [docs/openapi.json](docs/openapi.json)（OpenAPI 3.1，可直接导入 Apifox / Postman）。

### 用 Apifox 调试

导入 `docs/openapi.json`，服务地址填 `http://127.0.0.1:8788`，管理接口配 Bearer 令牌。

`{id}` 是**路径参数占位符**，不是要替换的文本：

| 写法 | 结果 |
| --- | --- |
| `GET /api/schemes/orzice-gun-1427` | ✅ 详情 |
| `GET /api/schemes/{id}` + 参数 `id=orzice-gun-1427` | ✅ 详情（推荐） |
| `GET /api/schemes/{orzice-gun-1427}` | ❌ 404，`{...}` 被当成字面量 |
| `GET /api/schemes/`（尾斜杠或参数留空） | ⚠️ 200 但返回**全部列表** |

## 测试

```powershell
npm test             # 单元测试与 API 契约测试（纯 Node，无需网络与 wrangler）
npm run smoke        # 端到端冒烟：进程内起同构服务器，走真实 HTTP 请求
npm run verify:local # 对已运行的本地服务做真实验收（含写入与审核流转）
npm run ui:check     # CDP 驱动真实浏览器：首屏、路由、登录、审核台
npm run ui:theme     # CDP 模拟系统亮/暗，验证主题跟随与切换
npm run openapi      # 校验 OpenAPI 定义与 functions/api 实现一致
npm run shots:theme  # 生成 .shots/hub-{light,dark}.png
```

`npm run verify:local` 会消耗投稿额度（每小时 8 条），脚本会先探测剩余额度，
额度不足时给出重置步骤而不是判为失败：

```powershell
# 先停掉 npm run dev，然后：
npm run dev -- --reset-db
npm run db:migrate:local; npm run db:seed
```

> `node --test` 会为每个测试文件派生一个子进程。若环境禁止 spawn（报 `EPERM`），
> 逐个文件直接跑即可：`node tests/api.test.js`。
>
> `wrangler` 与无头浏览器都依赖子进程 / 命名管道 IPC，受限沙箱下可能报
> `spawn EPERM` 或 `platform_channel ... 拒绝访问`，用普通终端运行即可。

## 数据

`public/data/schemes.json` 是抓取脚手架（`scripts/sync-orzice-gqm.mjs`）产出的规范化数据，
来源为社区公开分享码（`source=orzice-authorized`），共 1313 条。

`scripts/build-d1-seed.mjs` 把它转成 D1 可执行的 SQL，只保留可检索与可展示的字段，
丢弃体积很大的 `raw` 字段。种子输出到 `seeds/` 而**不是** `migrations/`：
`wrangler d1 migrations apply` 会执行 `migrations/` 下所有 `.sql`，
那样每次迁移都会重灌静态数据、把审核结果改回去。

```powershell
npm run db:build-seed        # 只生成 SQL（seeds/0002_seed_schemes.sql）
npm run db:seed              # 本地导入
npm run db:seed:remote       # 远程导入
```

抓取脚本位于仓库根目录与 `scripts/`，不参与 Pages 构建（构建输出目录是 `public/`）。
请遵守来源站点的使用条款与 robots 策略；抓取结果仅作个人整理用途。

## 部署

```powershell
npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

`wrangler.toml` 中的 `database_id` 需替换成你自己 D1 实例的 id。
`public/_routes.json` 把 Functions 限定在 `/api/*`，其余请求走静态资源。

`public/.well-known/appspecific/com.chrome.devtools.json` 是给 Chrome DevTools 的 JSON 存根：
没有它时该路径会落到 SPA 回退并返回 HTML，DevTools 解析会报错。

## 目录结构

```
functions/api/          Pages Functions
  _lib/http.js          响应封装、参数校验、令牌比较、客户端指纹
  _lib/db.js            D1 访问层、筛选/排序/分页、筛选面聚合、投稿规范化
  meta.js  schemes/  admin/
public/
  index.html            站点导航
  hub/                  配装站前端（hash 路由 + 事件委托，无构建步骤）
  data/schemes.json     规范化后的方案数据
migrations/             一次性结构变更
seeds/                  可再生的种子 SQL（gitignore）
docs/openapi.json       接口定义
scripts/                抓取、种子生成、验收与 UI 检查脚本
tests/                  纯 Node 测试
```

## 已知问题

- 方案图片来自官方 CDN（`playerhub.df.qq.com`，带 referrer 校验），
  本地有时会加载失败，页面已用占位图兜底
