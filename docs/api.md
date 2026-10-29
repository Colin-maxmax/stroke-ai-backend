# API 接口说明

## 基本信息

- 地址：`https://api.<你的备案域名>/api`
- 方法：`POST`（`GET` 返回健康状态）
- 编码：`Content-Type: application/json`
- 认证：登录后把 token 放进请求体 `token` 字段（也支持 `Authorization: Bearer <token>`）
- 时间：服务端统一返回 ISO 字符串（如 `2026-10-28T09:30:13.939Z`）

请求：

```json
{
  "action": "listAssessments",
  "token": "<JWT>",
  "payload": {}
}
```

成功：

```json
{ "ok": true, "data": { } }
```

失败（HTTP 400/401/403/404/409/429/500）：

```json
{ "ok": false, "error": { "code": "INVALID_INPUT", "message": "..." } }
```

---

## action 列表

| action | 认证 | payload | 返回 |
|---|---|---|---|
| `health` | 否 | — | `{status, serverTime}` |
| `register` | 否 | `{username, password, displayName?}` | `{token, user}` |
| `login` | 否 | `{username, password}` | `{token, user}` |
| `wxLogin` | 否 | `{code}`（`wx.login` 得到） | `{token, user}` |
| `me` | 是 | — | `{user}` |
| `createAssessment` | 是 | `{data, clientRequestId?}` | 完整 assessment |
| `listAssessments` | 是 | `{since?, limit?}` | `{items, total, serverTime}` |
| `deleteAssessment` | 是 | `{id}` | `{id}` |
| `clearAssessments` | 是 | `{scope?, confirm?}` | `{removed}` |
| `importAssessments` | 是 | `{records[], source?}` | `{imported, skipped, failed, total}` |

权限：

- 管理员（`role: admin`）：`listAssessments` 返回全部记录，可删除任意记录，`clearAssessments` 可传 `scope: "all"` + `confirm: "CLEAR_ALL"`。
- 普通用户：只能看/删/清自己的记录。

---

## createAssessment 提交字段

风险分数/等级/概率**由服务端计算**，客户端不要传。`data` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `patientName` | string | 必填，1-50 字 |
| `age` | number | 必填，18-120 |
| `gender` | string | 必填，`男` / `女` |
| `everMarried` | string | `是` / `否`（可空） |
| `workType` | string | `私营` / `个体经营` / `政府工作` / `儿童` / `从未工作` |
| `residenceType` | string | `城市` / `农村` |
| `education` | string | `小学及以下` / `初中` / `高中/中专` / `大专及以上` |
| `monthlyIncome` | string | `<2000` / `2000-5000` / `5000-10000` / `>10000` |
| `hypertension` | boolean | 是否有高血压 |
| `heartDiseaseType` | string | `0` 无 / `1` 房颤或心梗 / `2` 其他心脏病 |
| `hyperuricemia` | boolean | 高尿酸血症 |
| `anemia` | boolean | 贫血 |
| `mentalIllness` | boolean | 心理疾病 |
| `systolicBP` | number | 必填，60-250 |
| `diastolicBP` | number | 必填，40-180 |
| `avgGlucoseLevel` | number | 必填，1.0-50.0 mmol/L |
| `height` | number/'' | 可选，100-250 cm |
| `weight` | number/'' | 可选，30-200 kg |
| `smokingStatus` | string | `从未吸烟` / `以前吸烟` / `目前吸烟` / `未知` |
| `exerciseFrequency` | string | `无运动` / `少量运动` / `适量运动` / `经常运动` |
| `drinkingStatus` | string | `从不饮酒` / `偶尔饮酒` / `经常饮酒` / `过量饮酒` |
| `strokeHistory` | boolean | 中风史 |
| `tiaHistory` | boolean | TIA 史 |
| `strokeFamilyHistory` | string | `0` 无 / `1` 一级亲属 / `2` 二级亲属 |
| `hyperlipidemia` | boolean | 高血脂 |
| `dietaryHabits` | string[] | `高盐` / `高油` / `高糖` / `蔬菜不足` / `水果不足` / `均衡` |
| `notes` | string | 可选，≤500 字 |

返回的 assessment 额外包含：`id`、`riskScore`、`riskLevel`、`probability`（字符串，如 `"62.3"`）、`riskFactors`、`modelInfo`、`date`、`createdAt`、`ownerId`、`ownerName`、`assessedBy`、`source`（`web` / `miniprogram`）。

`clientRequestId` 用于防重复提交：同一用户相同值只创建一次。

---

## 示例

### curl：登录

```bash
curl -s -X POST https://api.example.com/api \
  -H "Content-Type: application/json" \
  -d '{"action":"login","payload":{"username":"admin","password":"你的密码"}}'
```

### curl：创建评估

```bash
curl -s -X POST https://api.example.com/api \
  -H "Content-Type: application/json" \
  -d '{
    "action":"createAssessment",
    "token":"<登录返回的 token>",
    "payload":{"data":{
      "patientName":"张大爷","age":68,"gender":"男",
      "workType":"私营","residenceType":"城市",
      "hypertension":true,"heartDiseaseType":"0",
      "systolicBP":150,"diastolicBP":92,"avgGlucoseLevel":6.4,
      "height":170,"weight":70,"smokingStatus":"以前吸烟",
      "exerciseFrequency":"少量运动","drinkingStatus":"从不饮酒",
      "strokeHistory":false,"tiaHistory":false,
      "strokeFamilyHistory":"0","hyperlipidemia":true,"dietaryHabits":["高盐"]
    }}
  }'
```

### 小程序：wx.request 参考

小程序端已封装在 `utils/api.js`，核心请求如下：

```js
wx.request({
  url: 'https://api.example.com/api',
  method: 'POST',
  header: { 'Content-Type': 'application/json' },
  data: {
    action: 'createAssessment',
    token: wx.getStorageSync('stroke_token'),
    payload: { data, clientRequestId: Date.now() + '_' + Math.random() }
  },
  success(res) {
    if (res.statusCode === 200 && res.data.ok) {
      console.log(res.data.data); // 服务端生成的评估结果
    } else {
      wx.showToast({ title: res.data.error.message, icon: 'none' });
    }
  }
});
```

注意：

- 小程序后台必须把 `https://api.example.com` 加入 **request 合法域名**；
- 开发工具可临时跳过域名校验，体验版/正式版不行；
- AppSecret 只在云函数环境变量里，绝不能出现在小程序代码中。

---

## 错误码

| code | HTTP | 含义 |
|---|---|---|
| `INVALID_INPUT` | 400 | 参数不合法 |
| `UNAUTHORIZED` | 401 | 未登录/token 无效 |
| `TOKEN_EXPIRED` | 401 | 登录过期，需重新登录 |
| `FORBIDDEN` | 403 | 越权操作 |
| `NOT_FOUND` | 404 | 记录不存在/未知 action |
| `CONFLICT` | 409 | 账号已存在 |
| `RATE_LIMITED` | 429 | 登录尝试过多 |
| `PAYLOAD_TOO_LARGE` | 413 | 请求体过大（>2MB） |
| `INTERNAL_ERROR` | 500 | 服务端异常/环境变量缺失 |

## 列表增量同步

客户端第一次不带 `since` 全量拉取；之后带上一轮返回的 `serverTime`：

```json
{"action":"listAssessments","token":"...","payload":{"since":"2026-10-28T09:30:13.939Z","limit":500}}
```

服务端用 `createdAt >= since` 查询（游标取查询前时间），并返回 `serverTime`。客户端按 `id` 去重即可；每 60 秒做一次全量校准以处理其他设备删除。
