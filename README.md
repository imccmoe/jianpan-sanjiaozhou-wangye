# ZFQ 站点 · 配装方案站 + SJZ 三键音乐键盘网页端

本仓库同时提供两个前端，共用一套 Cloudflare Pages 部署与 D1 数据库：

| 路径 | 内容 |
| --- | --- |
| `/` | 站点导航 |
| `/hub/` | 配装方案站（三角洲行动 / 无畏契约），浏览、筛选、复制分享码、社区投稿、审核台 |
| `/keyboard` | SJZ 三键音乐键盘网页端，对应 SJZ PyQt V1.15 |

Cloudflare Pages 会把 `<name>.html` 永久重定向到 `<name>`，所以站内链接统一使用无扩展名地址
（`/keyboard`、`/hub/`）。`public/keyboard.html` 仍然可以直接在 `python -m http.server` 下访问。

键盘网页包含音乐星球、键位设置、灯光设置、设备维护、关于五个页面。最新版曲库保存在 `public/data/music-catalog.json`；网页项目只保留当前 25 首曲目，不收录历史曲库备份。

## 本地运行

### 起步（推荐）

```powershell
npm install
npx wrangler d1 create wy-zfq-config-hub   # 把输出的 database_id 填进 wrangler.toml
npm run db:migrate:local                   # 建表
npm run db:seed                            # 生成种子 SQL 并导入本地 D1
npm run dev                                # 启动 Pages + D1，并自动准备 ADMIN_TOKEN
```

`npm run dev`（等价于 `npm run dev:local`）会做三件事：

1. **把 workerd 的临时目录指向仓库内**（`.wrangler-local/tmp`）。这一步是必需的：
   workerd 默认在 `os.tmpdir()` 下创建 `miniflare-email-store`，
   而 `%LOCALAPPDATA%\Temp` 在受限环境里不可写，会直接启动失败并报
   `kj/filesystem-disk-win32.c++: CreateDirectory: #5 拒绝访问`；
2. 首次运行时生成 `.dev.vars`（已 gitignore）并写入随机 `ADMIN_TOKEN`，同时打印出来；
3. 启动 `wrangler pages dev`，地址 `http://127.0.0.1:8788`，审核台在 `/hub/#/admin`。

本地 D1 默认持久化在 `.wrangler-local/persist`（脚本显式传 `--persist-to`，
数据库位置不随 wrangler 版本变化）。想改用 wrangler 默认的 `~/.wrangler` 状态目录：

```powershell
$env:SJZ_WRANGLER_STATE = "default"; npm run dev
```

> 裸跑 `npm run dev:plain`（`wrangler pages dev public`）在本机可能因为上述临时目录
> 权限问题启动失败。若确实需要原始命令，请自行设置可写的 `TMP`/`TEMP`。

### 其它方式

只跑静态前端（`/api/*` 会是 404，配装站不可用）：

```powershell
python -m http.server 8788 --directory public
# 注意：Python 的 http.server 不会把 /keyboard 映射到 keyboard.html，
# 请直接访问 http://localhost:8788/keyboard.html
```

## 测试

```powershell
npm test             # 单元测试与 API 契约测试（纯 Node，不需要网络与 wrangler）
npm run smoke        # 端到端冒烟：进程内起同构服务器，走真实 HTTP 请求
npm run verify:local # 对已运行的本地服务器做真实验收（含写入与审核流转）
npm run preview:hub  # 用真实数据把关键视图渲染成 .shots/preview-*.html，便于截图核对
```

`npm test` 覆盖：HID 报文协议、键位/灯光编解码、加密固件校验、D1 查询与筛选、
投稿限流、反馈去重、审核状态机、种子 SQL 生成。

`npm run smoke` 与 `npm run verify:local` 的区别：前者自带服务器与内存数据库，
验证代码逻辑；后者打真实运行时 + 真实 D1，会写入数据。

```powershell
# 先启动 npm run dev:local，再另开一个终端：
npm run verify:local -- http://127.0.0.1:8788 <ADMIN_TOKEN>
```

带令牌时会完整走一遍「投稿 → 待审不可见 → 审核通过 → 公开可见 → 反馈 → 下架 → 恢复」，
并在本地库里留下一条名为「本地验收方案 …」的记录，可用审核台下架或直接删库重来：

```powershell
Remove-Item -Recurse -Force .wrangler-local\persist
```

> `node --test` 会为每个测试文件派生一个子进程。若运行环境禁止 spawn（报 `EPERM`），
> 逐个文件直接跑即可，结果等价：`node tests/api.test.js`。
>
> `wrangler` 与无头浏览器都依赖命名管道/子进程 IPC。受限沙箱下可能报
> `spawn EPERM` 或 `platform_channel ... 拒绝访问`，用普通终端运行即可。

## 配装方案站

### 接口

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/meta` | 站点元信息、类型/游戏/模式分布、热门作者 |
| `GET /api/schemes` | 方案列表，支持 `game` `mode` `type` `q` `author` `minValue` `sort` `limit` `offset` |
| `GET /api/schemes/:id` | 方案详情（参数、反馈统计、同类推荐）；仅返回已发布方案 |
| `POST /api/schemes/submit` | 匿名投稿，进入 `pending` 待审；同客户端每小时最多 8 条 |
| `POST /api/schemes/feedback` | 反馈：`good` / `inaccurate` / `weak` / `invalid`；同类反馈 24 小时内去重 |
| `GET /api/admin/schemes` | 审核队列，需 `ADMIN_TOKEN` |
| `POST /api/admin/review` | 审核动作 `approve` / `reject` / `hide` / `restore`，每次写入 `audit_logs` |

`sort` 取值：`hot`（默认，按使用量）、`new`、`value`、`price`、`name`。`limit` 上限 60。

### 用 Apifox / Postman 调试

可以直接导入 [docs/openapi.json](docs/openapi.json)（OpenAPI 3.1）：

```powershell
npm run dev          # 先起服务，地址 http://127.0.0.1:8788
npm run openapi      # 校验定义与 functions/api 实现是否一致
```

导入后服务地址选 `http://127.0.0.1:8788`，管理接口在环境里配一个 Bearer 令牌（值见 `.dev.vars`）。

调试详情接口时注意 **`{id}` 是路径参数占位符**，不是要替换的文本：

| 写法 | 结果 |
| --- | --- |
| `GET /api/schemes/orzice-gun-1427` | ✅ 详情 |
| `GET /api/schemes/{id}` + 参数 `id=orzice-gun-1427` | ✅ 详情（Apifox 里推荐这种） |
| `GET /api/schemes/{orzice-gun-1427}` | ❌ 404，`{...}` 被当成字面量 |
| `GET /api/schemes/` （尾斜杠，或路径参数留空） | ⚠️ 200 但返回**全部列表** |
| `GET /api/schemes` | 列表接口，正常返回全部 |

### 管理令牌

审核台位于 `/hub/#/admin`，令牌只存在 `sessionStorage`，不会写进页面。

```powershell
npx wrangler pages secret put ADMIN_TOKEN      # 生产
# 本地开发也可以新建 .dev.vars（已被 .gitignore 忽略）：
# ADMIN_TOKEN=your-token
```

未配置 `ADMIN_TOKEN` 时，管理接口统一返回 503 并且关闭，不会退化成无鉴权访问。

### 数据来源

`public/data/schemes.json` 是抓取脚手架（`scripts/sync-orzice-gqm.mjs`）产出的规范化数据，
来源为社区公开分享码（`source=orzice-authorized`），共 1313 条。

`scripts/build-d1-seed.mjs` 把它转成 D1 可执行的 SQL，只保留可检索与可展示的字段，
丢弃体积很大的 `raw` 字段（否则单条记录会带上几十 KB 的原始 JSON）。

```powershell
npm run db:build-seed        # 只生成 SQL（seeds/0002_seed_schemes.sql）
npm run db:seed              # 本地导入
npm run db:seed:remote       # 远程导入
```

种子故意放在 `seeds/` 而不是 `migrations/`：`wrangler d1 migrations apply` 会执行
`migrations/` 下所有 `.sql`，那样每次迁移都会重灌 1313 条静态数据，把审核结果改回去。
迁移目录只保留真正的一次性结构变更。

## 键盘网页端

WebHID 需要安全上下文和用户授权；部署时也必须使用 HTTPS。点击右上角“连接”，选择 SJZ 键盘。

顶部“刷新已授权设备”只显示浏览器此前授权的键盘；首次授权请点击“连接”。若板子只烧录了 BOOT，设备会以 `1A86:FE02` 出现，正常键盘连接需要 `1A86:FE01` 的 APP。此时进入“设备维护”，确认默认加密升级包已加载，点击“开始更新”，再按页面提示授权 BOOT 设备。若选择弹窗仍为空，先在 Windows 设备管理器确认 `1A86:FE02` 设备当前在线。

升级文件写入并通过 CRC32 校验后，网页会等待 APP 设备重新出现。如果浏览器尚未授权新的 `1A86:FE01` 设备，“设备维护”会显示“连接 APP 并完成”；点击后在浏览器弹窗中选择 APP，即可读取固件版本与配置。灯光和键位配置读取成功后可直接保存；音乐保存按钮需要先把歌曲放入对应的 K1～K3 键位。

### 功能

- 从当前曲库试听、搜索、拖放并写入 K1～K3；V2 曲包包含曲目编号，设备维护可显示已保存的歌曲。
- 读取、编辑、保存每颗键的键值、播放暂停或旋转陀螺角色，支持鼠标灵敏度、水平灵敏度和每圈速度。设备维护显示键盘中已经保存的角色。
- 读取、编辑、保存按下点亮、常亮、流水灯，以及三个按键的颜色。亮度固定 50%。
- 默认加载 PyQt 使用的 `.enc.hex` 加密 APP 升级包，也能手动选择新包；在浏览器本地解密验证后通过 USB 更新。切换到 BOOT 后如需新授权，页面会显示“连接 BOOT 并继续”。只有设备端 CRC32 校验通过且 APP 稳定重连，才报告升级完成。

升级网页内置的 AES 密钥仅用于与现有 PyQt 加密包兼容，属于文件格式门槛，不构成防逆向的强安全保护。

## 部署

```powershell
npm run db:migrate:remote
npm run db:seed:remote
npx wrangler pages deploy public
```

`wrangler.toml` 中的 `database_id` 需要替换成你自己 D1 实例的 id。
`public/_routes.json` 把 Functions 限定在 `/api/*`，其余请求全部走静态资源。

`public/.well-known/appspecific/com.chrome.devtools.json` 是给 Chrome DevTools 的一个 JSON 存根：
没有这个文件时，该路径会落到 SPA 回退并返回 HTML，DevTools 解析时会报错刷控制台。

## 抓取脚手架

`scripts/` 与根目录的 `orzice-*.js/html` 是配装数据的抓取工具，来源站点为 orzice.com，
它们不参与 Pages 构建（构建输出目录是 `public/`，根目录文件不会被打包）。

```powershell
node scripts/probe-orzice-gqm-api.mjs       # 探测接口
node scripts/sync-orzice-gqm.mjs            # 同步原始数据与 schemes.json
node scripts/rebuild-schemes-from-raw.mjs   # 从原始数据重建 schemes.json
node scripts/import-valorant-weapons.mjs    # 导入无畏契约武器数据
```

请遵守来源站点的使用条款与 robots 策略；抓取结果仅作个人整理用途。
