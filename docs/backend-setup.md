# 云端后端部署说明（CloudBase）

本文覆盖：CloudBase 环境 → 数据库 → 云函数 → HTTP 域名/CORS → 管理员初始化 → 网站发布 → 小程序发布 → 验收。

相关代码：

- 云函数：`cloudfunctions/api/`（入口 `index.js`，评分 `lib/risk.js`）
- 网站配置：`js/config.js`、`js/api.js`
- 小程序配置：`D:\wechat_project\cva_prioject_check1\utils\config.js`、`utils/api.js`
- 管理员哈希脚本：`scripts/hash-password.cjs`

---

## 0. 准备清单

需要准备：

1. 腾讯云账号（已实名），并开通 CloudBase 云开发环境（建议广州地域）。
2. 已 ICP 备案的域名，以及一个 API 子域名，例如 `api.example.com`；DNS 可加 CNAME。
3. 小程序 AppID：`wxc765f99f5598f8fa`；从微信公众平台获取 AppSecret。
4. 一个强密码作为第一个管理员账号密码。

> 网站继续部署在 GitHub Pages；API 使用备案子域名，二者通过 HTTPS + CORS 通信。

---

## 1. 创建 CloudBase 环境与数据库

在腾讯云开发 CloudBase 控制台：

1. 创建环境（广州），记下环境 ID（下文称 `<ENV_ID>`）。
2. 数据库 → 新建集合：
   - `users`
   - `assessments`
   - `auth_throttle`
3. 三个集合的权限全部设置为 **“仅管理端可读写”**。前端和小程序都不直连数据库，只能走云函数。
4. 创建索引：

| 集合 | 索引字段 | 唯一 | 说明 |
|---|---|---|---|
| users | `username` | 是 | 网站账号唯一；小程序用户也会生成唯一 `username` |
| users | `openid` | 否 | **不要设唯一**：网站账号没有 openid，唯一索引会冲突 |
| assessments | `ownerId` + `createdAt`（降序） | 否 | 普通用户按人查询 |
| assessments | `createdAt`（降序） | 否 | 管理员按时间排序 |
| assessments | `ownerId` + `legacyKey` | 否 | 历史导入去重 |

> 小程序 openid 的唯一性由云函数里“先查后建”保证；并发首次登录的极端情况由 `_id`/索引报错兜底。

---

## 2. 配置云函数环境变量

云函数 `api` → 函数配置 → 环境变量：

| 变量 | 必填 | 示例/说明 |
|---|---|---|
| `JWT_SECRET` | 是 | 至少 16 位随机字符串；建议 `openssl rand -hex 32` |
| `WX_APPID` | 是 | `wxc765f99f5598f8fa` |
| `WX_SECRET` | 是 | 小程序 AppSecret，**只放这里，绝不进代码/仓库** |
| `ALLOWED_ORIGINS` | 是 | `https://colin-maxmax.github.io`；多个用逗号分隔 |
| `ALLOW_REGISTER` | 否 | 默认 `true`；设为 `false` 可关闭网站自助注册 |
| `TOKEN_TTL` | 否 | 默认 `7d` |
| `BCRYPT_ROUNDS` | 否 | 默认 `10` |
| `TCB_ENV` | 否 | 云函数内一般自动识别当前环境，可不填 |

AppSecret 获取：微信公众平台 → 开发管理 → 开发设置 → 开发者 ID → AppSecret。若忘记可重置（需管理员扫码），重置后同步更新此变量。

---

## 3. 部署云函数

本地：

```bash
cd cloudfunctions/api
npm install
npm test        # 7 组评分对照 + 6 组 API 集成测试，应全部通过
```

部署方式二选一：

- **CloudBase CLI**（推荐）：登录后执行 `tcb functions:deploy api --env <ENV_ID>`；
- **控制台**：把 `cloudfunctions/api`（含 `node_modules`，或用控制台的在线安装依赖）打包上传，运行环境选 **Node.js 18**，入口 `index.js`，超时建议 20 秒。

云函数入口是 `exports.main`，同时支持 CloudBase 控制台直接调用（`event = { action, token, payload }`）。

---

## 4. 开通 HTTP 访问服务与自定义域名

1. HTTP 访问服务 → 新建路由：
   - 路径：`/api`
   - 方法：`POST`（如控制台支持，再加一个 `GET /api` 用于健康检查）
   - 目标：云函数 `api`
2. HTTP 访问服务 → 跨域设置：加入 `https://colin-maxmax.github.io`（本地调试再加 `http://localhost:8080` 等）。
3. 绑定自定义域名 `api.example.com`：
   - 按控制台提示添加 DNS CNAME；
   - 等待平台自动签发 HTTPS 证书；
   - 生产环境不要用 CloudBase 默认域名（有访问中间页/风控限制）。

最终 API 地址形如：`https://api.example.com/api`。

验证：

```bash
curl -s https://api.example.com/api          # GET，返回 {"ok":true,"data":{"status":"ok",...}}
curl -s -X POST https://api.example.com/api \
  -H "Content-Type: application/json" \
  -d '{"action":"health"}'
```

---

## 5. 初始化管理员账号

1. 先生成 bcrypt 哈希（在仓库根目录）：

```bash
ADMIN_PASSWORD='你的强密码' node scripts/hash-password.cjs admin
```

2. 复制输出的整段 JSON，在 CloudBase 数据库 `users` 集合中“添加记录”，逐字段粘贴（`passwordHash` 原样）。
3. 确认 `role` 为 `admin`、`username` 为 `admin`。
4. 用该账号登录网站，页面右上角应显示“（管理员）”。

> 不要开放任何公开的“创建管理员”接口；普通前台注册永远是 `role: user`。

---

## 6. 发布网站

1. 修改 `js/config.js`：

```js
API_BASE: 'https://api.example.com/api'
```

2. 本地预览（可选）：起一个静态服务器，打开页面，用管理员登录，确认能拉到列表。
3. 提交并推送到 GitHub `main` 分支，GitHub Pages 自动发布：

```bash
git add .
git commit -m "feat: sync accounts and assessments via CloudBase"
git push origin main
```

> 真正的 Git 仓库是 `D:\脑卒中相关资料\脑卒中预测平台4.1\backend`；`stroke-ai-backend-main` 只是下载副本，不要在那里提交。
> 临时本地调试也可以不提交配置：浏览器控制台执行 `localStorage.setItem('stroke_api_base', 'https://api.example.com/api')` 后刷新。

登录后网站会：

- 每 5 秒增量拉取一次（页面隐藏时暂停，每 60 秒全量校准）；
- 管理员看到全部账号记录，普通账号只看自己的；
- 首次登录若检测到旧版本 `localStorage['stroke_assessments_<用户名>']`，会询问是否导入云端（按 `legacyKey` 去重）。

---

## 7. 发布小程序

1. 修改 `D:\wechat_project\cva_prioject_check1\utils\config.js`：

```js
API_BASE: 'https://api.example.com/api'
```

2. 微信公众平台 → 开发管理 → 开发设置 → 服务器域名 → **request 合法域名**，添加：

```
https://api.example.com
```

   只填域名（协议 + 主机），不要带 `/api`、不要带端口；必须 HTTPS 且已备案。

3. 用微信开发者工具打开 `D:\wechat_project\cva_prioject_check1`（AppID `wxc765f99f5598f8fa`）：
   - 开发阶段可临时勾选“不校验合法域名、TLS 版本及 HTTPS 证书”；
   - 真机预览/体验版必须使用已配置的合法域名。
4. 编译运行：小程序启动时静默 `wx.login` → 后端 `jscode2session` 换 openid → 创建/复用“微信用户”账号。
5. 首次成功登录后，会把旧版本 `wx.getStorageSync('assessments')` 里的记录自动上传一次（标记 `stroke_migrated_mp`，重复启动不会重复上传）。
6. 提交评估 → 云端创建 → 网站 5 秒内出现，来源显示“小程序”。

> 小程序没有登录页；患者无需注册。网站管理员能看到所有小程序提交；小程序用户只能看到自己的历史。

---

## 8. 历史数据处理

### 网站旧账号

旧版本的账号密码只存在各自浏览器的 localStorage，无法迁移成云端账号。处理方式：

1. 在网站上重新注册一个云端账号（尽量用原来的用户名）；
2. 登录后如果本机还有 `stroke_assessments_<用户名>`，页面会提示导入；
3. 如果换了用户名，旧的本机数据不会自动关联到新账号（需要手工处理）。

### 小程序旧记录

旧记录只有姓名/年龄/性别/日期和风险结果，没有血压血糖等原始字段。上传时：

- 有完整临床字段的记录 → 按统一算法重算；
- 只有结果的记录 → 保留原结果，避免重算后失真。

---

## 9. 验收清单

- [ ] `cloudfunctions/api` 下 `npm test` 全部通过。
- [ ] `curl`：注册、登录、创建、列表、删除、清空、导入均正常；错误密码 5 次后 429。
- [ ] 浏览器 A、B 登录同一账号：A 新建，B 5 秒内出现。
- [ ] 小程序提交 ≤6 秒网站出现，来源“小程序”。
- [ ] 普通账号只看自己；admin 看全部。
- [ ] 详情、打印、CSV 导出、清空、AI 上下文正常。
- [ ] token 过期回登录页；退出登录可用。
- [ ] 浏览器直连数据库集合被拒绝（权限为仅管理端）。
- [ ] 网站旧数据、小程序旧历史迁移成功且重复导入不重复。
- [ ] 患者姓名/备注含 HTML 时不执行脚本。

---

## 10. 安全与隐私

- 密码使用 bcrypt 哈希；登录失败 5 次锁定 10 分钟。
- JWT 密钥、微信 AppSecret 只放云函数环境变量；不提交仓库。
- CORS 白名单只放真实站点域名；不要改成 `*`。
- 数据库权限全部“仅管理端可读写”；前端只走云函数。
- 健康数据属于敏感个人信息：上线前补隐私政策/告知同意，说明收集目的、范围、保存期限和删除方式；小程序在微信公众平台配置“用户隐私保护指引”；管理员权限最小化；定期备份数据库。
- 轮询成本：5 秒一次 + 页面隐藏暂停；数据量大时可把 `POLL_INTERVAL_MS` 调到 10000-15000，或增加分页。

## 11. 常见问题

| 现象 | 排查 |
|---|---|
| 网站登录提示“后端地址尚未配置” | `js/config.js` 的 `API_BASE` 未改成真实域名 |
| 网站 `Failed to fetch` | CloudBase 跨域白名单未加 GitHub Pages 域名；或用了默认域名/中间页 |
| 小程序 `url not in domain list` | request 合法域名没配、带了路径/端口，或不是 HTTPS |
| 云函数 500 “服务未配置 JWT_SECRET” | 环境变量漏配 |
| 登录总提示账号或密码错误 | 确认管理员记录已插入、`passwordHash` 完整、`role` 正确 |
| 小程序登录失败 | `WX_APPID`/`WX_SECRET` 不对，或 AppSecret 已重置 |
| 首次请求慢 | 云函数冷启动，前端已做加载态，可忽略 |
| AI 助手报 `Model not exist` | 本次未处理（历史遗留问题），与账号/同步无关 |

## 12. 本次范围外

- AI 助手线上模型名故障；
- “交流区”云端化（仍为本机 localStorage）；
- 真正接入随机森林模型推理；
- 列表超过 500 条后的分页与全量统计。
