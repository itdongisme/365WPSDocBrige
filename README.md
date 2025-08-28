# WPS文档下载中心

一个基于Cloudflare Workers的WPS文档下载代理服务，提供简洁的文档浏览和下载功能。

## 功能特性

### 🚀 核心功能
- **文档浏览** - 浏览WPS云文档中的文件和文件夹
- **双下载模式** - 代理下载和直接下载两种方式
- **R2 缓存系统** - 自动缓存下载文件到 Cloudflare R2，提供快速访问
- **LRU 缓存管理** - 智能缓存淘汰策略，自动管理存储空间
- **搜索功能** - 支持文档名称实时搜索，可搜索多个已缓存文件夹
- **主题切换** - 支持亮色/暗色主题自动切换
- **文件夹导航** - 支持文件夹浏览和面包屑导航

### 📥 下载方式
1. **代理下载** (`/download/{fileId}`)
   - 通过Cloudflare代理下载文件
   - 无需认证，适合网络不稳定的环境
   - 服务器代理获取文件后返回给用户
   - **支持 R2 缓存**：文件自动缓存到 R2，后续访问直接从缓存提供

2. **直接下载** (`/direct-download/{fileId}?auth=password`)
   - 302重定向到WPS真实下载链接
   - 需要认证密码，下载速度更快
   - 绕过代理，直接从WPS服务器下载
   - 使用`Referrer-Policy: no-referrer`避免防盗链限制

### 💾 缓存系统
- **自动缓存** - 通过代理下载的文件自动存储到 R2
- **LRU 淘汰** - 基于最近最少使用算法管理缓存空间
- **容量限制** - 缓存容量上限 9GB，接近限制时自动清理旧文件
- **缓存命中** - 已缓存文件直接从 R2 提供，响应更快

### 🔐 安全特性
- **直接下载认证** - 独立的直接下载密码保护
- **会话管理** - 认证密码自动缓存，关闭浏览器后清除
- **密码管理** - 可手动清除保存的直接下载密码

### 🎨 用户界面
- **响应式设计** - 支持桌面端和移动端
- **自定义弹窗** - 美观的密码输入和提示框，支持键盘操作
- **文件图标** - 不同类型文件显示对应图标
- **加载状态** - 智能加载提示和分页加载
- **缓存机制** - 文件夹内容缓存30分钟，提升浏览体验

## 部署指南

### 1. 环境准备
- Cloudflare账户
- Wrangler CLI工具

### 2. 配置环境变量

编辑 `wrangler.toml` 文件：

```toml
name = "wps-docs-downloader"
main = "worker.js"
compatibility_date = "2025-08-19"

[vars]
# WPS相关配置
WPS_GROUP_ID = "your_group_id"
WPS_CORP_ID = "your_corp_id" 
WPS_COOKIES = "your_wps_cookies_string"

# 直接下载密码
DIRECT_DOWNLOAD_PASSWORD = "your_direct_download_password"

# R2 存储桶配置（用于缓存文件）
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "wps-docs-cache"

# KV 命名空间配置（用于存储文件元数据和 LRU 链表）
[[kv_namespaces]]
binding = "CACHE_KV"
id = "your-kv-namespace-id"
preview_id = "your-preview-kv-namespace-id"
```

### 3. 创建 R2 存储桶和 KV 命名空间

#### 创建 R2 存储桶：
```bash
# 创建 R2 存储桶
wrangler r2 bucket create wps-docs-cache
```

#### 创建 KV 命名空间：
```bash
# 创建 KV 命名空间
wrangler kv:namespace create "CACHE_KV"
# 创建预览环境的 KV 命名空间
wrangler kv:namespace create "CACHE_KV" --preview
```

将输出的 ID 填入 `wrangler.toml` 的相应位置。

### 4. 获取WPS配置信息

#### 获取GROUP_ID和CORP_ID：
1. 登录WPS云文档
2. 进入企业空间，查看URL：`https://365.kdocs.cn/ent/{CORP_ID}/{GROUP_ID}`
3. 从URL中提取对应的ID

#### 获取Cookies：
1. 在浏览器中登录WPS云文档
2. 打开开发者工具 → Network
3. 刷新页面，找到任意API请求
4. 复制完整的Cookie字符串

### 5. 部署到Cloudflare Workers

```bash
# 安装依赖
npm install -g wrangler

# 登录Cloudflare
wrangler auth

# 部署服务
wrangler deploy
```

## API接口

### 获取文件列表
```
GET /api/files
```

### 获取文件夹内容  
```
GET /api/folder?folderId={folderId}
```

### 代理下载（无需认证）
```
GET /download/{fileId}
```

### 直接下载（需要认证）
```
GET /direct-download/{fileId}?auth={password}
```

### 用户认证
```
POST /auth
Content-Type: application/json

{
  "password": "direct_download_password"
}
```
注意：目前只有直接下载需要认证

### 缓存统计信息
```
GET /api/cache-stats
```

返回缓存系统的统计信息，包括总大小、文件数量、使用率等。

### 缓存文件列表
```
GET /api/cache-list?page=1&pageSize=20&sortBy=lastAccessed
```

获取缓存中的文件列表，支持分页和排序。

### 清理缓存
```
POST /api/cache-clear
Content-Type: application/json

# 清空所有缓存
{
  "clearAll": true
}

# 删除指定文件
{
  "fileId": "abc123"
}
```

## 使用说明

### 直接下载使用
1. 点击文件的下载按钮
2. 选择"直接下载"
3. 首次使用时输入直接下载密码
4. 密码会保存在本次会话中，关闭浏览器后清除
5. 如需重新输入密码，可点击"清除保存的密码"

### 搜索功能
- 在搜索框中输入关键词可实时搜索文档
- 支持中英文搜索
- 会搜索当前文件夹及已缓存的文件夹内容（最多缓存30分钟）

### 文件夹浏览
- 点击文件夹进入子目录
- 使用面包屑导航快速跳转到上级目录
- 文件夹内容自动缓存，提升浏览速度

## 技术架构

- **前端**: 原生JavaScript + CSS3，响应式设计
- **后端**: Cloudflare Workers (Edge Computing)
- **存储**: 无服务器架构，无需数据库
- **缓存**: 内存缓存文件夹内容，30分钟过期
- **认证**: 仅直接下载需要密码认证，会话级存储

## 下载流程

### 代理下载流程
```
用户请求 → WPS API获取链接 → Worker下载文件 → 返回给用户
```

### 直接下载流程
```
用户请求 → Worker验证密码 → WPS API获取链接 → 302重定向 → 用户直接从WPS下载
```

## 安全考虑

1. **Cookie安全**: WPS Cookies包含敏感信息，请妥善保管
2. **密码保护**: 建议设置复杂的直接下载密码
3. **HTTPS**: Cloudflare Workers默认提供HTTPS加密
4. **防盗链**: 使用`Referrer-Policy: no-referrer`绕过防盗链限制
5. **会话安全**: 直接下载密码仅在会话中缓存，关闭浏览器后清除

## 故障排除

### 1. 下载失败
- 检查WPS Cookies是否过期
- 验证GROUP_ID和CORP_ID是否正确
- 确认文件ID有效

### 2. 认证问题
- 验证DIRECT_DOWNLOAD_PASSWORD设置是否正确
- 清除浏览器缓存重试
- 检查直接下载密码是否正确输入

### 3. 跨域错误
代码已处理跨域问题，如遇到CORS错误：
- 直接下载不会有CORS问题（使用302重定向）
- 代理下载在服务端处理，避免跨域

### 4. 界面问题
- 清除浏览器缓存
- 检查JavaScript控制台错误
- 确认兼容性日期设置正确

## 开发说明

### 文件结构
```
├── worker.js          # 主要业务逻辑（包含HTML/CSS/JS）
├── wrangler.toml     # Cloudflare Workers配置
└── README.md         # 项目文档
```

### 主要功能模块
- **文件管理**: 文件列表获取和缓存
- **下载处理**: 代理下载和直接下载认证
- **前端界面**: 响应式UI和主题切换
- **搜索系统**: 实时搜索和缓存搜索
- **缓存系统**: R2存储和LRU缓存管理

### 特色技术点
1. **单文件架构** - HTML/CSS/JS全部内嵌在worker.js中
2. **无模板字符串** - 兼容旧版JavaScript引擎，使用字符串拼接
3. **自定义弹窗** - 替代原生alert/prompt，提供更好体验
4. **智能缓存** - 文件夹内容缓存减少API调用
5. **防盗链处理** - 巧妙使用Referrer-Policy绕过限制

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request来改进这个项目。

## 注意事项

⚠️ **重要提醒**:
- 本项目仅供学习和个人使用
- WPS下载链接中可能包含敏感的签名信息，请注意保护
- 请遵守相关服务的使用条款
- Cookie信息需定期更新以保持功能正常
- 建议在生产环境中设置适当的访问限制

---

**技术支持**: 如遇问题请检查Wrangler日志和浏览器控制台输出