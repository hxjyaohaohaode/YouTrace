# 有迹 API 文档

Base URL: `/api`

## 认证

除标注为公开的接口外，所有接口需要在请求头中携带JWT Token:

```
Authorization: Bearer <token>
```

---

## 认证模块

### POST /api/auth/register

注册新用户。

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "用户名"
}
```

**响应:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "cm...", "email": "user@example.com", "name": "用户名" },
    "token": "eyJhbG..."
  }
}
```

### POST /api/auth/login

用户登录。

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应:** 同注册

### POST /api/auth/refresh

刷新Token。

**请求头:** `Authorization: Bearer <token>`

**响应:**
```json
{
  "success": true,
  "data": { "token": "eyJhbG..." }
}
```

### GET /api/auth/me

获取当前用户信息。

**响应:**
```json
{
  "success": true,
  "data": { "id": "cm...", "email": "user@example.com", "name": "用户名" }
}
```

---

## 日记模块

### GET /api/diaries

获取日记列表。

**查询参数:**
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| page | number | 1 | 页码 |
| pageSize | number | 10 | 每页数量 |

**响应:**
```json
{
  "success": true,
  "data": {
    "items": [{ "id": "cm...", "content": "...", "emotionScore": 75, "emotionTags": ["快乐"], "aiInsight": null, "createdAt": "2024-01-01T00:00:00.000Z" }],
    "total": 30,
    "page": 1,
    "pageSize": 10,
    "totalPages": 3
  }
}
```

### GET /api/diaries/:id

获取日记详情。

### POST /api/diaries

创建日记。

**请求体:**
```json
{
  "content": "今天心情很好",
  "emotionScore": 80,
  "emotionTags": ["快乐", "满足"]
}
```

### PUT /api/diaries/:id

更新日记。

### DELETE /api/diaries/:id

删除日记。

### POST /api/diaries/:id/analyze

AI情绪分析日记。

**响应:**
```json
{
  "success": true,
  "data": { "id": "cm...", "emotionScore": 75, "emotionTags": ["快乐", "平静"], "aiInsight": "你今天的心情看起来不错..." }
}
```

---

## 日程模块

### GET /api/events

获取日程列表。

**查询参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| start | string | 开始时间 (ISO) |
| end | string | 结束时间 (ISO) |

### POST /api/events

创建日程。

**请求体:**
```json
{
  "title": "团队会议",
  "description": "周例会",
  "startTime": "2024-01-15T10:00:00.000Z",
  "endTime": "2024-01-15T11:00:00.000Z",
  "isAllDay": false,
  "reminderMinutes": 15
}
```

**响应:** 包含 `hasConflict` 和 `conflicts` 字段

### PUT /api/events/:id

更新日程。

### DELETE /api/events/:id

删除日程。

---

## 目标模块

### GET /api/goals

获取目标列表。

### POST /api/goals

创建目标。

**请求体:**
```json
{
  "title": "学习英语",
  "description": "提升英语水平",
  "deadline": "2024-06-30"
}
```

### PUT /api/goals/:id

更新目标（可更新progress, status等）。

### DELETE /api/goals/:id

删除目标。

### POST /api/goals/:id/breakdown

AI智能拆解目标为里程碑。

**响应:**
```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "aiBreakdown": {
      "summary": "6步计划...",
      "milestones": [
        { "step": 1, "title": "基础词汇", "duration": "2周" }
      ],
      "tips": ["每天坚持30分钟"]
    }
  }
}
```

---

## 习惯模块

### GET /api/habits

获取习惯列表（含7天打卡记录和今日状态）。

**响应:**
```json
{
  "success": true,
  "data": [{
    "id": "cm...",
    "title": "每天阅读30分钟",
    "frequency": "DAILY",
    "targetDays": 30,
    "streakCurrent": 5,
    "streakLongest": 12,
    "todayCompleted": true,
    "recentLogs": [{ "date": "2024-01-15", "isCompleted": true }]
  }]
}
```

### POST /api/habits

创建习惯。

**请求体:**
```json
{
  "title": "每天阅读30分钟",
  "description": "阅读书籍",
  "frequency": "DAILY",
  "targetDays": 30,
  "goalId": "cm..."
}
```

### PUT /api/habits/:id

更新习惯。

### DELETE /api/habits/:id

删除习惯。

### POST /api/habits/:id/toggle

打卡/取消打卡。

**响应:**
```json
{
  "success": true,
  "data": { "streakCurrent": 6, "streakLongest": 12 }
}
```

---

## 通知模块

### GET /api/notifications

获取通知列表。

**查询参数:**
| 参数 | 类型 | 默认 |
|------|------|------|
| page | number | 1 |
| pageSize | number | 20 |

**响应:** 包含 `unreadCount` 字段

### PUT /api/notifications/:id/read

标记通知已读。

### PUT /api/notifications/read-all

全部标记已读。

### DELETE /api/notifications/:id

删除通知。

---

## 触发器模块

### GET /api/triggers

获取触发器列表（自动创建默认触发器）。

**响应:**
```json
{
  "success": true,
  "data": [
    { "id": "cm...", "type": "MORNING_BRIEF", "isActive": true, "config": { "hour": 7 } },
    { "id": "cm...", "type": "EVENING_REVIEW", "isActive": true, "config": { "hour": 21 } },
    { "id": "cm...", "type": "EMOTION_ALERT", "isActive": true, "config": { "days": 3, "threshold": 30 } },
    { "id": "cm...", "type": "GOAL_REMINDER", "isActive": true, "config": { "daysBefore": 3 } }
  ]
}
```

### PUT /api/triggers/:id

更新触发器（开关/配置）。

**请求体:**
```json
{ "isActive": false }
```

---

## Web Push模块

### GET /api/push/vapid-key

获取VAPID公钥（公开接口）。

**响应:**
```json
{ "success": true, "data": { "publicKey": "BD1ig..." } }
```

### POST /api/push/subscribe

订阅推送。

**请求体:**
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/...",
    "keys": { "p256dh": "...", "auth": "..." }
  }
}
```

### POST /api/push/unsubscribe

取消订阅。

**请求体:**
```json
{ "endpoint": "https://fcm.googleapis.com/..." }
```

---

## AI模块

### GET /api/ai/status

获取AI服务状态（公开接口）。

**响应:**
```json
{ "success": true, "data": { "provider": "deepseek", "available": true } }
```

### GET /api/ai/guide-questions

获取AI引导问题。

**响应:**
```json
{ "success": true, "data": ["今天有什么让你开心的事？", "你学到了什么新东西？"] }
```

---

## 健康检查

### GET /api/health

服务健康检查（公开接口）。

**响应:**
```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

---

## 错误响应格式

所有错误响应遵循统一格式:

```json
{
  "success": false,
  "message": "错误描述"
}
```

常见HTTP状态码:
- `400` - 请求参数错误
- `401` - 未认证
- `404` - 资源不存在
- `500` - 服务器内部错误
