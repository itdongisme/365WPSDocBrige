export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 基本访问控制
    if (env.ACCESS_PASSWORD && !await verifyAccess(request, env)) {
      return handleAuthPage();
    }
    
    // 路由处理
    if (url.pathname === '/') {
      return handleHomePage(request, env);
    }
    
    if (url.pathname === '/api/files') {
      return handleFilesList(request, env);
    }
    
    if (url.pathname === '/api/folder') {
      return handleFolderContent(request, env);
    }
    
    if (url.pathname.startsWith('/download/')) {
      return handleFileDownload(request, env);
    }
    
    if (url.pathname === '/auth') {
      return handleAuth(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

// 访问验证
async function verifyAccess(request, env) {
  const url = new URL(request.url);
  
  // 检查 URL 参数中的密码
  if (url.searchParams.get('password') === env.ACCESS_PASSWORD) {
    return true;
  }
  
  // 检查 Cookie 中的认证状态
  const cookies = request.headers.get('Cookie') || '';
  const authCookie = cookies.split(';').find(c => c.trim().startsWith('auth='));
  if (authCookie) {
    const token = authCookie.split('=')[1];
    return token === btoa(env.ACCESS_PASSWORD);
  }
  
  return false;
}

// 认证页面
function handleAuthPage() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>访问认证</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .auth-container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
        h2 { text-align: center; margin-bottom: 30px; color: #333; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; color: #555; font-weight: 500; }
        input[type="password"] { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; }
        .btn { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
        .btn:hover { background: #0056b3; }
        .error { color: #dc3545; margin-top: 10px; text-align: center; }
    </style>
</head>
<body>
    <div class="auth-container">
        <h2>🔐 访问认证</h2>
        <form id="authForm">
            <div class="form-group">
                <label for="password">请输入访问密码：</label>
                <input type="password" id="password" required>
            </div>
            <button type="submit" class="btn">验证</button>
            <div id="error" class="error"></div>
        </form>
    </div>
    
    <script>
        document.getElementById('authForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const password = document.getElementById('password').value;
            
            fetch('/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    document.cookie = 'auth=' + btoa(password) + '; path=/; max-age=86400';
                    location.reload();
                } else {
                    document.getElementById('error').textContent = '密码错误';
                }
            })
            .catch(() => {
                document.getElementById('error').textContent = '验证失败，请重试';
            });
        });
    </script>
</body>
</html>`;
  
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 处理认证请求
async function handleAuth(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  try {
    const { password } = await request.json();
    const success = password === env.ACCESS_PASSWORD;
    
    return new Response(JSON.stringify({ success }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取文件夹内容
async function handleFolderContent(request, env) {
  const url = new URL(request.url);
  const folderId = url.searchParams.get('folderId');
  const groupId = env.WPS_GROUP_ID;
  const corpId = env.WPS_CORP_ID;
  
  if (!folderId) {
    return new Response(JSON.stringify({ error: '缺少文件夹ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  if (!groupId || !corpId) {
    return new Response(JSON.stringify({ error: '缺少必要的环境变量 WPS_GROUP_ID 或 WPS_CORP_ID' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const apiUrl = `https://365.kdocs.cn/3rd/drive/api/v5/groups/${groupId}/files?parentid=${folderId}&include=acl,pic_thumbnail&with_link=true&review_pic_thumbnail=true&with_sharefolder_type=true&offset=0&count=20&orderby=mtime&order=desc`;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Cookie': env.WPS_COOKIES,
    'Referer': `https://365.kdocs.cn/ent/${corpId}/${groupId}/${folderId}`,
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
  };
  
  try {
    const response = await fetch(apiUrl, { headers });
    const data = await response.json();
    
    if (data.result !== 'ok') {
      throw new Error('API call failed');
    }
    
    // 只返回必要的文件信息，移除敏感数据
    const sanitizedFiles = data.files.map(file => ({
      id: file.id,
      fname: file.fname,
      fsize: file.fsize,
      ftype: file.ftype,
      mtime: file.mtime,
      link_url: file.link_url
    }));
    
    return new Response(JSON.stringify({ 
      files: sanitizedFiles,
      folderId: folderId,
      result: 'ok'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 获取文件列表
async function handleFilesList(request, env) {
  const groupId = env.WPS_GROUP_ID;
  const corpId = env.WPS_CORP_ID;
  
  if (!groupId || !corpId) {
    return new Response(JSON.stringify({ error: '缺少必要的环境变量 WPS_GROUP_ID 或 WPS_CORP_ID' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const apiUrl = `https://365.kdocs.cn/3rd/drive/api/v5/groups/${groupId}/files?parentid=0&include=acl,pic_thumbnail&with_link=true&review_pic_thumbnail=true&with_sharefolder_type=true&offset=0&count=20&orderby=mtime&order=desc`;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Cookie': env.WPS_COOKIES,
    'Referer': `https://365.kdocs.cn/ent/${corpId}/${groupId}`,
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
  };
  
  try {
    const response = await fetch(apiUrl, { headers });
    const data = await response.json();
    
    if (data.result !== 'ok') {
      throw new Error('API call failed');
    }
    
    // 只返回必要的文件信息，移除敏感数据
    const sanitizedFiles = data.files.map(file => ({
      id: file.id,
      fname: file.fname,
      fsize: file.fsize,
      ftype: file.ftype,
      mtime: file.mtime,
      link_url: file.link_url
    }));
    
    return new Response(JSON.stringify({ 
      files: sanitizedFiles,
      result: 'ok'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 文件下载代理
async function handleFileDownload(request, env) {
  const url = new URL(request.url);
  const fileId = url.pathname.split('/download/')[1];
  
  if (!fileId) {
    return new Response('Invalid file ID', { status: 400 });
  }
  
  const groupId = env.WPS_GROUP_ID;
  const corpId = env.WPS_CORP_ID;
  
  if (!groupId || !corpId) {
    return new Response(JSON.stringify({ error: '缺少必要的环境变量 WPS_GROUP_ID 或 WPS_CORP_ID' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    // 第一步：获取下载链接
    const downloadApiUrl = `https://365.kdocs.cn/3rd/drive/api/v5/groups/${groupId}/files/${fileId}/download?isblocks=false&support_checksums=md5,sha1,sha224,sha256,sha384,sha512`;
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Cookie': env.WPS_COOKIES,
      'Referer': `https://365.kdocs.cn/ent/${corpId}/${groupId}`,
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };
    
    const downloadResponse = await fetch(downloadApiUrl, { headers });
    const downloadData = await downloadResponse.json();
    
    if (downloadData.result !== 'ok' || !downloadData.url) {
      throw new Error('获取下载链接失败');
    }
    
    // 第二步：代理文件下载
    const fileResponse = await fetch(downloadData.url);
    
    if (!fileResponse.ok) {
      throw new Error('文件下载失败');
    }
    
    return new Response(fileResponse.body, {
      headers: {
        'Content-Type': fileResponse.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Disposition': fileResponse.headers.get('Content-Disposition') || 'attachment',
        'Content-Length': fileResponse.headers.get('Content-Length') || '',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 主页面
async function handleHomePage(request, env) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文档下载中心</title>
    <style>
        :root {
            /* WPS云文档风格配色 */
            --bg-primary: #f5f7fa;
            --bg-secondary: #ffffff;
            --bg-card: #ffffff;
            --bg-hover: #f8f9fa;
            --bg-selected: #e3f2fd;
            --text-primary: #1a1a1a;
            --text-secondary: #5a5a5a;
            --text-tertiary: #999999;
            --text-link: #2b6de7;
            --accent: #2b6de7;
            --accent-hover: #1a4bb5;
            --accent-light: #e8f0fe;
            --border: #e8eaed;
            --border-focus: #2b6de7;
            --shadow-sm: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
            --shadow-md: 0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15);
            --shadow-lg: 0 2px 6px 2px rgba(60,64,67,0.15), 0 1px 2px 0 rgba(60,64,67,0.3);
            --search-bg: #ffffff;
            --input-border: #dadce0;
            --input-focus: #2b6de7;
            --success: #34a853;
            --warning: #fbbc04;
            --error: #ea4335;
        }

        [data-theme="dark"] {
            --bg-primary: #1a1a1a;
            --bg-secondary: #2d2d2d;
            --bg-card: #2d2d2d;
            --bg-hover: #3a3a3a;
            --bg-selected: #1e3a5f;
            --text-primary: #ffffff;
            --text-secondary: #b3b3b3;
            --text-tertiary: #808080;
            --text-link: #8ab4f8;
            --accent: #8ab4f8;
            --accent-hover: #b8d3f1;
            --accent-light: #1e3a5f;
            --border: #404040;
            --border-focus: #8ab4f8;
            --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15);
            --shadow-md: 0 1px 3px 0 rgba(0,0,0,0.3), 0 4px 8px 3px rgba(0,0,0,0.15);
            --shadow-lg: 0 2px 6px 2px rgba(0,0,0,0.15), 0 1px 2px 0 rgba(0,0,0,0.3);
            --search-bg: #2d2d2d;
            --input-border: #505050;
            --input-focus: #8ab4f8;
            --success: #4caf50;
            --warning: #fbbc04;
            --error: #f44336;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            transition: all 0.2s ease;
            min-height: 100vh;
            line-height: 1.5;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 24px 20px;
        }

        .header {
            text-align: center;
            margin-bottom: 24px;
            position: relative;
        }
        
        .breadcrumb {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 6px;
            padding: 0 4px;
        }
        
        .breadcrumb-item {
            color: var(--text-secondary);
            text-decoration: none;
            padding: 8px 12px;
            border-radius: 8px;
            background: var(--bg-card);
            box-shadow: 
                4px 4px 8px var(--shadow-dark),
                -4px -4px 8px var(--shadow-light);
            transition: all 0.3s ease;
            font-size: 14px;
        }
        
        .breadcrumb-item:hover {
            background: var(--accent);
            color: white;
            transform: translateY(-2px);
            box-shadow: 
                6px 6px 12px var(--shadow-dark),
                -6px -6px 12px var(--shadow-light);
        }
        
        .breadcrumb-separator {
            color: var(--text-tertiary);
            margin: 0 5px;
        }

        .header h1 {
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-primary);
            letter-spacing: -0.5px;
        }

        .header p {
            color: var(--text-secondary);
            font-size: 0.95rem;
            font-weight: 400;
        }

        .theme-toggle {
            position: absolute;
            top: 0;
            right: 0;
            width: 40px;
            height: 40px;
            border: 1px solid var(--border);
            border-radius: 20px;
            background: var(--bg-card);
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
            color: var(--text-secondary);
        }

        .theme-toggle:hover {
            background: var(--bg-hover);
            border-color: var(--border-focus);
            color: var(--text-primary);
        }

        .theme-toggle:active {
            transform: scale(0.95);
        }

        .search-container {
            margin-bottom: 16px;
            display: flex;
            justify-content: center;
        }

        .search-box {
            position: relative;
            width: 100%;
            max-width: 600px;
        }

        .search-input {
            width: 100%;
            padding: 12px 16px 12px 44px;
            font-size: 14px;
            border: 1px solid var(--input-border);
            border-radius: 8px;
            background: var(--search-bg);
            color: var(--text-primary);
            transition: all 0.2s ease;
            outline: none;
        }

        .search-input:focus {
            border-color: var(--input-focus);
            box-shadow: 0 0 0 3px var(--accent-light);
        }

        .search-input::placeholder {
            color: var(--text-tertiary);
        }

        .search-icon {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-tertiary);
            font-size: 16px;
            pointer-events: none;
        }

        .clear-search {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--text-tertiary);
            cursor: pointer;
            font-size: 16px;
            padding: 4px;
            border-radius: 12px;
            transition: all 0.2s ease;
            opacity: 0;
            visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .clear-search.visible {
            opacity: 1;
            visibility: visible;
        }

        .clear-search:hover {
            color: var(--text-secondary);
            background: var(--bg-hover);
        }

        .loading {
            text-align: center;
            margin: 50px 0;
            color: var(--text-secondary);
            font-size: 18px;
        }

        .loading::after {
            content: '...';
            animation: dots 1.5s steps(4, end) infinite;
        }

        @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60% { content: '...'; }
            80%, 100% { content: ''; }
        }

        .file-list {
            background: var(--bg-card);
            border-radius: 8px;
            border: 1px solid var(--border);
            overflow: hidden;
        }

        .file-item {
            display: flex;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
            transition: all 0.2s ease;
            cursor: pointer;
        }

        .file-item:last-child {
            border-bottom: none;
        }

        .file-item:hover {
            background: var(--bg-hover);
        }

        .file-item:active {
            background: var(--bg-selected);
        }

        .file-icon {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            margin-right: 16px;
            flex-shrink: 0;
            background: var(--accent-light);
            color: var(--accent);
        }

        .file-icon.folder {
            background: var(--warning);
            color: white;
        }

        .file-icon.pdf {
            background: var(--error);
            color: white;
        }

        .file-content {
            flex: 1;
            min-width: 0;
        }

        .file-name {
            font-weight: 500;
            color: var(--text-primary);
            margin-bottom: 4px;
            font-size: 14px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .file-meta {
            display: flex;
            align-items: center;
            gap: 16px;
            font-size: 12px;
            color: var(--text-tertiary);
        }

        .file-meta-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .file-actions {
            display: flex;
            gap: 8px;
            margin-left: 16px;
            flex-shrink: 0;
        }

        .btn {
            padding: 8px 16px;
            border: 1px solid var(--border);
            border-radius: 6px;
            cursor: pointer;
            text-decoration: none;
            text-align: center;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
            background: var(--bg-card);
            color: var(--text-primary);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .btn:hover {
            background: var(--bg-hover);
            border-color: var(--input-focus);
        }

        .btn:active {
            transform: scale(0.98);
        }

        .btn-primary {
            background: var(--accent);
            color: white;
            border-color: var(--accent);
            box-shadow: 0 2px 4px rgba(43, 109, 231, 0.3);
        }

        .btn-primary:hover {
            background: var(--accent-hover);
            border-color: var(--accent-hover);
            box-shadow: 0 4px 8px rgba(43, 109, 231, 0.4);
            transform: translateY(-1px);
        }

        .btn-secondary {
            background: var(--bg-card);
            color: var(--text-secondary);
            border-color: var(--border);
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .btn-secondary:hover {
            background: var(--bg-hover);
            color: var(--text-primary);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
            transform: translateY(-1px);
        }

        .error {
            background: var(--bg-card);
            color: var(--error);
            padding: 16px 20px;
            border-radius: 8px;
            border: 1px solid var(--border);
            margin: 16px 0;
            text-align: center;
            font-size: 14px;
        }

        .no-results {
            text-align: center;
            color: var(--text-secondary);
            font-size: 14px;
            margin: 40px 0;
            padding: 40px 20px;
        }

        .load-more {
            text-align: center;
            margin: 20px 0;
        }

        .load-more-btn {
            padding: 10px 24px;
            background: var(--accent);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
        }

        .load-more-btn:hover {
            background: var(--accent-hover);
            transform: translateY(-1px);
        }

        .load-more-btn:disabled {
            background: var(--text-tertiary);
            cursor: not-allowed;
            transform: none;
        }

        .loading-more {
            text-align: center;
            margin: 20px 0;
            color: var(--text-secondary);
            font-size: 14px;
        }

        .stats {
            text-align: center;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
            color: var(--text-secondary);
            font-size: 13px;
        }

        @media (max-width: 768px) {
            .container {
                padding: 16px 12px;
            }
            
            .header h1 {
                font-size: 1.5rem;
            }
            
            .header p {
                font-size: 0.85rem;
            }
            
            .theme-toggle {
                position: relative;
                margin: 16px auto 0;
            }
            
            .search-container {
                margin-bottom: 16px;
            }
            
            .search-box {
                max-width: 100%;
            }
            
            .file-item {
                padding: 12px 16px;
            }
            
            .file-icon {
                width: 32px;
                height: 32px;
                font-size: 16px;
                margin-right: 12px;
            }
            
            .file-name {
                font-size: 13px;
            }
            
            .file-meta {
                flex-wrap: wrap;
                gap: 8px;
                font-size: 11px;
            }
            
            .file-actions {
                flex-direction: column;
                gap: 4px;
                margin-left: 8px;
            }
            
            .btn {
                padding: 6px 12px;
                font-size: 11px;
            }
            
            .breadcrumb {
                flex-wrap: wrap;
                gap: 4px;
                margin-bottom: 12px;
            }
            
            .breadcrumb-item {
                font-size: 12px;
                padding: 6px 10px;
            }
            
            .breadcrumb-separator {
                margin: 0 2px;
            }
        }
        
        @media (max-width: 480px) {
            .file-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
            
            .file-actions {
                margin-left: 0;
                margin-top: 8px;
                flex-direction: row;
                width: 100%;
                justify-content: flex-end;
            }
            
            .file-meta {
                width: 100%;
                justify-content: space-between;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📚 文档中心</h1>
            <p>轻松访问和下载您的文档</p>
            <button class="theme-toggle" id="themeToggle">🌙</button>
        </div>

        <div class="search-container">
            <div class="search-box">
                <div class="search-icon">🔍</div>
                <input type="text" class="search-input" id="searchInput" placeholder="搜索文档名称...">
                <button class="clear-search" id="clearSearch">✕</button>
            </div>
        </div>
        
        <div id="breadcrumb" class="breadcrumb" style="display: none;">
            <a href="#" class="breadcrumb-item" data-folder-id="">🏠 根目录</a>
        </div>

        <div id="loading" class="loading">加载中</div>
        <div id="error" class="error" style="display: none;"></div>
        <div id="fileList" class="file-list" style="display: none;"></div>
        <div id="noResults" class="no-results" style="display: none;">
            <p>😔 没有找到匹配的文档</p>
            <p>请尝试不同的搜索关键词</p>
        </div>
        <div id="loadingMore" class="loading-more" style="display: none;">加载更多...</div>
        <div id="loadMore" class="load-more" style="display: none;">
            <button class="load-more-btn" id="loadMoreBtn">加载更多</button>
        </div>
        <div id="stats" class="stats" style="display: none;"></div>
    </div>

    <script>
        let allFiles = [];
        let filteredFiles = [];
        let currentFolderId = '';
        let folderHistory = [];
        let folderCache = new Map(); // 缓存文件夹内容
        const CACHE_EXPIRY_TIME = 30 * 60 * 1000; // 30分钟过期时间
        const PAGE_SIZE = 20; // 每页显示的文件数量
        let currentPage = 0;
        let isLoadingMore = false;
        let hasMoreFiles = true;

        // 主题切换
        const themeToggle = document.getElementById('themeToggle');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const currentTheme = localStorage.getItem('theme') || (prefersDark ? 'dark' : 'light');
        
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';

        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        });

        // 搜索功能
        const searchInput = document.getElementById('searchInput');
        const clearSearch = document.getElementById('clearSearch');
        const breadcrumb = document.getElementById('breadcrumb');
        
        searchInput.addEventListener('input', handleSearch);
        clearSearch.addEventListener('click', () => {
            searchInput.value = '';
            handleSearch();
            searchInput.focus();
        });
        
        // 面包屑导航
        breadcrumb.addEventListener('click', (e) => {
            if (e.target.classList.contains('breadcrumb-item')) {
                e.preventDefault();
                const folderId = e.target.getAttribute('data-folder-id');
                navigateToFolder(folderId);
            }
        });

        function handleSearch() {
            const query = searchInput.value.trim();
            clearSearch.classList.toggle('visible', query.length > 0);
            
            if (query === '') {
                filteredFiles = [...allFiles];
            } else {
                // 先在当前文件夹中搜索
                filteredFiles = allFiles.filter(file => 
                    file.fname.toLowerCase().includes(query.toLowerCase())
                );
                
                // 如果当前文件夹中没有找到，搜索所有缓存的文件夹
                if (filteredFiles.length === 0 && folderCache.size > 0) {
                    filteredFiles = [];
                    for (let [folderId, cacheData] of folderCache) {
                        // 检查缓存是否过期
                        if (Date.now() - cacheData.timestamp < CACHE_EXPIRY_TIME) {
                            const matches = cacheData.files.filter(file => 
                                file.fname.toLowerCase().includes(query.toLowerCase())
                            );
                            filteredFiles.push(...matches);
                        }
                    }
                }
            }
            
            // 重置分页状态
            currentPage = 0;
            hasMoreFiles = true;
            displayFiles(filteredFiles, true);
            updateStats(filteredFiles.length, allFiles.length, query);
        }

        function updateStats(showing, total, query) {
            const statsEl = document.getElementById('stats');
            const noResultsEl = document.getElementById('noResults');
            
            if (query && showing === 0) {
                statsEl.style.display = 'none';
                noResultsEl.style.display = 'block';
            } else {
                noResultsEl.style.display = 'none';
                if (query) {
                    // 如果有搜索关键词，显示是否搜索了缓存的文件夹
                    const activeCacheCount = Array.from(folderCache.values()).filter(
                        cacheData => Date.now() - cacheData.timestamp < CACHE_EXPIRY_TIME
                    ).length;
                    const cacheInfo = activeCacheCount > 1 ? ' (已缓存 ' + activeCacheCount + ' 个文件夹)' : '';
                    statsEl.textContent = \`找到 \${showing} 个文档（共 \${total} 个）\${cacheInfo}\`;
                } else {
                    statsEl.textContent = \`共 \${total} 个文档\`;
                }
                statsEl.style.display = 'block';
            }
        }

        async function loadFiles() {
            try {
                // 检查缓存
                if (folderCache.has('')) {
                    const cacheData = folderCache.get('');
                    if (Date.now() - cacheData.timestamp < CACHE_EXPIRY_TIME) {
                        allFiles = cacheData.files;
                        filteredFiles = [...allFiles];
                        currentFolderId = '';
                        folderHistory = [];
                        currentPage = 0;
                        hasMoreFiles = true;
                        updateBreadcrumb();
                        displayFiles(filteredFiles, true);
                        updateStats(filteredFiles.length, allFiles.length, '');
                        document.getElementById('loading').style.display = 'none';
                        return;
                    } else {
                        // 缓存过期，删除
                        folderCache.delete('');
                    }
                }
                
                const response = await fetch('/api/files');
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }
                
                allFiles = data.files;
                filteredFiles = [...allFiles];
                currentFolderId = '';
                folderHistory = [];
                currentPage = 0;
                hasMoreFiles = true;
                
                // 缓存根目录
                folderCache.set('', {
                    files: allFiles,
                    timestamp: Date.now()
                });
                
                updateBreadcrumb();
                displayFiles(filteredFiles, true);
                updateStats(filteredFiles.length, allFiles.length, '');
                
            } catch (error) {
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').textContent = '加载失败: ' + error.message;
            } finally {
                document.getElementById('loading').style.display = 'none';
            }
        }
        
        async function navigateToFolder(folderId) {
            try {
                document.getElementById('loading').style.display = 'block';
                
                if (folderId === '') {
                    // 返回根目录
                    if (folderCache.has('')) {
                        const cacheData = folderCache.get('');
                        if (Date.now() - cacheData.timestamp < CACHE_EXPIRY_TIME) {
                            allFiles = cacheData.files;
                            currentFolderId = '';
                            folderHistory = [];
                        } else {
                            // 缓存过期，删除
                            folderCache.delete('');
                            const response = await fetch('/api/files');
                            const data = await response.json();
                            
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            
                            allFiles = data.files;
                            currentFolderId = '';
                            folderHistory = [];
                            
                            // 缓存根目录
                            folderCache.set('', {
                                files: allFiles,
                                timestamp: Date.now()
                            });
                        }
                    } else {
                        const response = await fetch('/api/files');
                        const data = await response.json();
                        
                        if (data.error) {
                            throw new Error(data.error);
                        }
                        
                        allFiles = data.files;
                        currentFolderId = '';
                        folderHistory = [];
                        
                        // 缓存根目录
                        folderCache.set('', {
                            files: allFiles,
                            timestamp: Date.now()
                        });
                    }
                } else {
                    // 检查缓存
                    if (folderCache.has(folderId)) {
                        const cacheData = folderCache.get(folderId);
                        if (Date.now() - cacheData.timestamp < CACHE_EXPIRY_TIME) {
                            allFiles = cacheData.files;
                            currentFolderId = folderId;
                        } else {
                            // 缓存过期，删除
                            folderCache.delete(folderId);
                            // 进入文件夹
                            const response = await fetch('/api/folder?folderId=' + folderId);
                            const data = await response.json();
                            
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            
                            allFiles = data.files;
                            currentFolderId = folderId;
                            
                            // 缓存文件夹内容
                            folderCache.set(folderId, {
                                files: allFiles,
                                timestamp: Date.now()
                            });
                        }
                    } else {
                        // 进入文件夹
                        const response = await fetch('/api/folder?folderId=' + folderId);
                        const data = await response.json();
                        
                        if (data.error) {
                            throw new Error(data.error);
                        }
                        
                        allFiles = data.files;
                        currentFolderId = folderId;
                        
                        // 缓存文件夹内容
                        folderCache.set(folderId, {
                            files: allFiles,
                            timestamp: Date.now()
                        });
                    }
                    
                    // 更新历史记录
                    const existingIndex = folderHistory.findIndex(item => item.id === folderId);
                    if (existingIndex >= 0) {
                        folderHistory = folderHistory.slice(0, existingIndex + 1);
                    } else {
                        folderHistory.push({ id: folderId, name: getCurrentFolderName() });
                    }
                }
                
                filteredFiles = [...allFiles];
                currentPage = 0;
                hasMoreFiles = true;
                updateBreadcrumb();
                displayFiles(filteredFiles, true);
                updateStats(filteredFiles.length, allFiles.length, '');
                
            } catch (error) {
                document.getElementById('error').style.display = 'block';
                document.getElementById('error').textContent = '加载失败: ' + error.message;
            } finally {
                document.getElementById('loading').style.display = 'none';
            }
        }
        
        function getCurrentFolderName() {
            const folder = allFiles.find(f => f.id === currentFolderId && f.ftype === 'folder');
            return folder ? folder.fname : '文件夹';
        }
        
        function updateBreadcrumb() {
            if (currentFolderId === '') {
                breadcrumb.style.display = 'none';
            } else {
                breadcrumb.style.display = 'flex';
                breadcrumb.innerHTML = \`
                    <a href="#" class="breadcrumb-item" data-folder-id="">🏠 根目录</a>
                    \${folderHistory.map(item => \`
                        <span class="breadcrumb-separator">›</span>
                        <a href="#" class="breadcrumb-item" data-folder-id="\${item.id}">\${item.name}</a>
                    \`).join('')}
                \`;
            }
        }
        
        function displayFiles(files, reset = false) {
            const list = document.getElementById('fileList');
            const noResults = document.getElementById('noResults');
            const loadMoreBtn = document.getElementById('loadMore');
            const loadingMore = document.getElementById('loadingMore');
            
            if (files.length === 0) {
                list.style.display = 'none';
                loadMoreBtn.style.display = 'none';
                return;
            }
            
            list.style.display = 'block';
            noResults.style.display = 'none';
            
            const startIndex = reset ? 0 : currentPage * PAGE_SIZE;
            const endIndex = Math.min(startIndex + PAGE_SIZE, files.length);
            const filesToShow = files.slice(startIndex, endIndex);
            
            if (reset) {
                list.innerHTML = '';
                currentPage = 0;
            }
            
            // 更新是否有更多文件的状态
            hasMoreFiles = endIndex < files.length;
            
            list.innerHTML += filesToShow.map(file => {
                const isFolder = file.ftype === 'folder';
                const size = formatFileSize(file.fsize);
                const date = new Date(file.mtime * 1000).toLocaleDateString('zh-CN');
                const fileExt = file.fname.split('.').pop().toLowerCase();
                
                let iconClass = '';
                let icon = '📄';
                
                if (isFolder) {
                    iconClass = 'folder';
                    icon = '📁';
                } else if (fileExt === 'pdf') {
                    iconClass = 'pdf';
                    icon = '📕';
                } else if (['doc', 'docx'].includes(fileExt)) {
                    icon = '📘';
                } else if (['xls', 'xlsx'].includes(fileExt)) {
                    icon = '📗';
                } else if (['ppt', 'pptx'].includes(fileExt)) {
                    icon = '📙';
                } else if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
                    icon = '🖼️';
                } else if (['mp4', 'avi', 'mkv'].includes(fileExt)) {
                    icon = '🎬';
                } else if (['mp3', 'wav'].includes(fileExt)) {
                    icon = '🎵';
                } else if (['zip', 'rar', '7z'].includes(fileExt)) {
                    icon = '📦';
                } else if (['js', 'py', 'java', 'cpp', 'html', 'css'].includes(fileExt)) {
                    icon = '💻';
                }
                
                return \`
                    <div class="file-item">
                        <div class="file-icon \${iconClass}">\${icon}</div>
                        <div class="file-content">
                            <div class="file-name">\${file.fname}</div>
                            <div class="file-meta">
                                <div class="file-meta-item">
                                    <span>📅</span>
                                    <span>\${date}</span>
                                </div>
                                \${!isFolder ? \`
                                    <div class="file-meta-item">
                                        <span>📏</span>
                                        <span>\${size}</span>
                                    </div>
                                \` : ''}
                                <div class="file-meta-item">
                                    <span>📁</span>
                                    <span>\${isFolder ? '文件夹' : fileExt.toUpperCase() || '文件'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="file-actions">
                            \${isFolder ? \`
                                <button class="btn btn-primary" onclick="navigateToFolder('\${file.id}')">
                                    <span>📂</span>
                                    <span>打开</span>
                                </button>
                            \` : \`
                                <a href="/download/\${file.id}" class="btn btn-primary" target="_blank">
                                    <span>📥</span>
                                    <span>下载</span>
                                </a>
                                <a href="\${file.link_url}" class="btn btn-secondary" target="_blank">
                                    <span>👁️</span>
                                    <span>预览</span>
                                </a>
                            \`}
                        </div>
                    </div>
                \`;
            }).join('');
            
            // 更新加载更多按钮状态
            if (hasMoreFiles) {
                loadMoreBtn.style.display = 'block';
                document.getElementById('loadMoreBtn').disabled = false;
            } else {
                loadMoreBtn.style.display = 'none';
            }
            
            currentPage++;
        }
        
        function formatFileSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }
        
        // 加载更多按钮事件
        document.getElementById('loadMoreBtn').addEventListener('click', loadMoreFiles);
        
        // 滚动自动加载
        window.addEventListener('scroll', () => {
            if (isLoadingMore || !hasMoreFiles) return;
            
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight;
            const clientHeight = document.documentElement.clientHeight;
            
            // 当滚动到距离底部200px时自动加载
            if (scrollTop + clientHeight >= scrollHeight - 200) {
                loadMoreFiles();
            }
        });
        
        function loadMoreFiles() {
            if (isLoadingMore || !hasMoreFiles) return;
            
            isLoadingMore = true;
            document.getElementById('loadingMore').style.display = 'block';
            document.getElementById('loadMoreBtn').disabled = true;
            
            // 模拟加载延迟，让用户看到加载状态
            setTimeout(() => {
                displayFiles(filteredFiles, false);
                isLoadingMore = false;
                document.getElementById('loadingMore').style.display = 'none';
            }, 300);
        }
        
        loadFiles();
    </script>
</body>
</html>`;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}