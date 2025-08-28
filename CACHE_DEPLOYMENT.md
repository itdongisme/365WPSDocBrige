# WPS 文档缓存系统部署指南

本指南说明如何部署带有 R2 + KV LRU 缓存系统的 WPS 文档下载服务。

## 系统架构

- **Cloudflare Worker**: 处理请求和缓存逻辑
- **R2 Object Storage**: 存储缓存的文件（最大 9GB）
- **KV Storage**: 存储 LRU 链表和文件元数据

## 部署步骤

### 1. 创建 R2 存储桶

```bash
# 创建生产环境存储桶
wrangler r2 bucket create wps-file-cache

# 创建开发环境存储桶（可选）
wrangler r2 bucket create wps-file-cache-dev
```

### 2. 创建 KV 命名空间

```bash
# 创建生产环境 KV 命名空间
wrangler kv:namespace create "CACHE_KV"

# 创建开发环境 KV 命名空间（可选）
wrangler kv:namespace create "CACHE_KV" --preview
```

### 3. 更新 wrangler.toml 配置

将命令输出的 KV 命名空间 ID 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "你的KV命名空间ID"
```

### 4. 配置环境变量

在 `wrangler.toml` 或 Cloudflare Dashboard 中设置：

```toml
[vars]
WPS_GROUP_ID = "你的WPS群组ID"
WPS_CORP_ID = "你的WPS企业ID"
WPS_COOKIES = "你的WPS认证Cookie"
ACCESS_PASSWORD = "访问密码（可选）"
DIRECT_DOWNLOAD_PASSWORD = "直接下载密码（可选）"
```

### 5. 部署 Worker

```bash
# 部署到生产环境
wrangler deploy

# 或部署到开发环境
wrangler deploy --env development
```

## API 接口

### 文件下载（带缓存）
- **URL**: `/download/{fileId}`
- **说明**: 自动检查缓存，缓存未命中时从 WPS 下载并缓存

### 缓存状态查询
- **URL**: `/api/cache/status`
- **说明**: 查看缓存使用情况和最近访问的文件
- **响应示例**:
```json
{
  "totalSize": 2147483648,
  "totalSizeFormatted": "2.00 GB",
  "maxSize": 9663676416,
  "maxSizeFormatted": "9.00 GB",
  "usagePercentage": "22.22",
  "fileCount": 15,
  "headFile": "file123",
  "tailFile": "file456",
  "recentFiles": [...]
}
```

### 缓存清理
- **URL**: `/api/cache/clear?action=all` - 清理所有缓存
- **URL**: `/api/cache/clear?action=old` - 清理超过7天的缓存

## 缓存机制

### LRU 算法
- 使用双向链表实现 LRU (Least Recently Used)
- 新下载的文件添加到链表头部
- 访问文件时移动到链表头部
- 空间不足时从链表尾部删除最久未使用的文件

### 存储限制
- 最大存储空间：9GB
- 超过限制时自动清理最久未使用的文件
- 支持手动清理指定时间范围的文件

### 数据结构

#### KV 存储的数据
- `lru:head`: LRU 链表头节点文件ID
- `lru:tail`: LRU 链表尾节点文件ID  
- `cache:size`: 当前缓存总大小（字节）
- `file:{fileId}`: LRU 节点数据（文件ID、大小、访问时间、前后指针）
- `meta:{fileId}`: 文件元数据（Content-Type、大小等）

#### R2 存储的数据
- 键为文件ID，值为实际文件内容
- 元数据包含内容类型、大小、缓存时间等

## 性能优化

1. **缓存命中优先**: 优先从缓存返回文件，减少对 WPS 服务器的请求
2. **异步更新**: LRU 位置更新异步进行，不阻塞文件响应
3. **智能清理**: 基于访问时间智能清理旧文件
4. **元数据分离**: 元数据存储在 KV 中，提高查询效率

## 监控和维护

1. **定期检查缓存状态**:
   ```bash
   curl "https://your-worker.your-subdomain.workers.dev/api/cache/status"
   ```

2. **清理旧缓存**:
   ```bash
   curl "https://your-worker.your-subdomain.workers.dev/api/cache/clear?action=old"
   ```

3. **监控日志**: 在 Cloudflare Dashboard 查看 Worker 日志

## 成本估算

- **R2 存储**: $0.015/GB/月（9GB = ~$0.135/月）
- **KV 存储**: 前 100,000 次读取免费，后续 $0.50/百万次
- **Worker 请求**: 前 100,000 次请求免费，后续 $0.50/百万次

总成本预估：约 $1-3/月（取决于使用量）

## 故障排除

### 缓存不工作
1. 检查 R2 和 KV 绑定是否正确
2. 确认环境变量配置正确
3. 查看 Worker 日志错误信息

### 存储空间不足
1. 检查缓存使用情况：`/api/cache/status`
2. 手动清理缓存：`/api/cache/clear?action=old`
3. 调整 `MAX_STORAGE_BYTES` 配置

### 性能问题
1. 监控缓存命中率
2. 检查 LRU 链表完整性
3. 考虑增加存储空间限制