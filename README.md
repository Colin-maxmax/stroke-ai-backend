# 脑卒中预测高危风险平台

网站（GitHub Pages）+ 微信小程序共用一套 CloudBase 后端：账号跨设备登录、评估记录云端同步、管理员查看全部、小程序提交后网站约 5 秒内出现。

## 目录

```
index.html                 网站主页面（原 v4.1 功能保留）
js/config.js               API 地址与轮询间隔
js/api.js                  云端请求封装、token、登录失效处理
css/style.css              网站样式
cloudfunctions/api/        CloudBase 云函数（账号、评估 CRUD、导入、评分）
  lib/risk.js              服务端唯一评分口径（18 项加权）
  tests/                   评分对照测试 + API 集成测试
scripts/hash-password.cjs  生成管理员 bcrypt 哈希
docs/backend-setup.md      从零部署 CloudBase、域名、CORS、小程序
docs/api.md                接口契约与示例
```

小程序代码在 **`D:\wechat_project\cva_prioject_check1`**（原生微信小程序，AppID `wxc765f99f5598f8fa`）。

## 已实现

- 网站用户名/密码注册登录，账号存 CloudBase，密码 bcrypt 哈希
- 小程序静默微信登录（openid），无需登录页
- 管理员看全部记录，普通用户只看自己的
- 网站 5 秒增量轮询（页面隐藏暂停，60 秒全量校准）
- 小程序与网站用同一套服务端评分，结果一致
- 小程序补齐学历、收入、心脏病类型、高尿酸、贫血、心理疾病 6 个字段
- 网站与小程序旧的本机历史数据一次性迁移（去重）
- 删除、清空、导出、详情、打印、AI 上下文适配云端缓存
- 来源/提交者徽标；服务端字段渲染转义

## 本地验证

```bash
cd cloudfunctions/api
npm install
npm test
```

测试内容：

- `risk.test.js`：用 `index.html` 里旧算法逐项对照，含 300 组随机样例；
- `api.test.js`：内存数据库模拟注册、登录锁定、权限隔离、幂等、迁移、清空、token 失效。

## 部署

按 [`docs/backend-setup.md`](docs/backend-setup.md) 执行，顺序：

1. CloudBase 环境、集合、索引、权限
2. 云函数环境变量与部署
3. HTTP 访问服务 + 备案域名 + CORS
4. 管理员账号初始化
5. 网站 `js/config.js` 填 API 地址并 push（GitHub Pages 自动发布）
6. 小程序 `utils/config.js` 填 API 地址 + 配置 request 合法域名

接口细节见 [`docs/api.md`](docs/api.md)。

## 已知未处理

- AI 助手线上 `Model not exist`（历史遗留，与本次账号/同步无关）
- “交流区”仍为本机 localStorage
- 列表超过 500 条后的分页与全量统计
- 页面上“随机森林准确率 98.07%”等模型文案与实际加权评分口径不一致（建议后续统一口径）
