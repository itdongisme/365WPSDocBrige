# WPS 云文档下载服务

基于 Cloudflare Worker 的 WPS 云文档外部下载服务，提供简洁的文档列表和下载功能。

## 功能特性

- 📄 文档列表展示（文件名、大小、更新时间、创建者）
- 🔗 直接下载功能（通过 WPS API 获取真实下载链接）
- 👁️ 在线预览支持（跳转到 WPS 分享页面）
- 🔐 可选密码访问保护
- 📱 响应式设计，支持移动端访问

## 部署步骤

### 1. 安装 Wrangler CLI
```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare
```bash
wrangler login
```

### 3. 设置环境变量

#### 必需变量：

**WPS Cookie 认证信息：**
```bash
wrangler secret put WPS_COOKIES
```
输入完整的 WPS Cookie 字符串（从浏览器开发者工具中获取）

**WPS 群组 ID：**
```bash
wrangler secret put WPS_GROUP_ID
```
输入：`2506900875`（你的群组 ID）

**WPS 企业 ID：**
```bash
wrangler secret put WPS_CORP_ID  
```
输入：`655590863`（你的企业 ID）

#### 可选变量（访问密码保护）：
```bash
wrangler secret put ACCESS_PASSWORD
```
设置访问密码，不设置则不启用密码保护

### 4. 部署
```bash
wrangler deploy
```

## API 接口

- `GET /` - 主页面，显示文档列表
- `GET /api/files` - 获取文件列表 JSON
- `GET /download/{fileId}` - 下载指定文件
- `POST /auth` - 密码验证接口

## 安全特性

- Cookie 认证：使用 WPS 原始认证信息
- 访问控制：可选密码保护
- CORS 支持：安全的跨域访问
- 错误处理：友好的错误提示

## 技术架构

- **前端**：纯 HTML + CSS + JavaScript
- **后端**：Cloudflare Worker
- **认证**：WPS Cookie 转发
- **下载**：两步式下载（API → 实际文件 URL）

## 使用说明

1. 访问部署后的域名
2. 如设置了密码保护，先输入访问密码
3. 浏览文档列表
4. 点击"下载文件"直接下载，或"在线预览"在 WPS 中查看

## 注意事项

- WPS Cookie 有有效期限制，需定期更新
- 文件下载链接有时效性（通常几小时）
- 建议在 Cloudflare 中设置适当的缓存策略
- 大文件下载可能受到 Worker 限制影响