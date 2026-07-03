# Hướng Dẫn Deploy Lên Hostinger

## Bước 1: Build Project

Mở terminal và chạy:

```bash
cd "/Users/thangvd/Documents/Vibe Code/FB Ads"
npm install
npm run build
```

Sau khi build xong, bạn sẽ có folder `dist/` chứa toàn bộ file tĩnh đã được compile.

---

## Bước 2: Upload Lên Hostinger

### Cách 1: Dùng File Manager (Dễ nhất)

1. Đăng nhập vào **Hostinger hPanel**: https://hpanel.hostinger.com
2. Vào **Files** → **File Manager**
3. Navigate đến folder `public_html` (hoặc folder domain của bạn)
4. **Xóa** tất cả file cũ trong `public_html` (nếu có)
5. Upload toàn bộ **nội dung** bên trong folder `dist/`:
   - Chọn **Upload Files**
   - Chọn tất cả file trong folder `dist/` (không upload folder `dist` mà upload nội dung bên trong)
   - Đợi upload hoàn tất

### Cách 2: Dùng FTP/SFTP (Nhanh hơn với nhiều file)

**Lấy thông tin FTP:**
1. Vào hPanel → **Files** → **FTP Accounts**
2. Lấy:
   - **Hostname**: ftp.yourdomain.com hoặc IP server
   - **Username**: username FTP
   - **Password**: mật khẩu FTP
   - **Port**: 21 (FTP) hoặc 22 (SFTP)

**Upload bằng FileZilla:**
```
1. Mở FileZilla
2. File → Site Manager → New Site
3. Host: ftp.yourdomain.com
4. Protocol: FTP hoặc SFTP
5. Port: 21 (FTP) / 22 (SFTP)
6. User: [username]
7. Password: [password]
8. Connect
9. Navigate đến public_html/
10. Kéo thả tất cả file trong dist/ vào public_html/
```

**Upload bằng Terminal (SCP):**
```bash
# Build trước
npm run build

# Upload lên server (thay thông tin của bạn)
scp -r dist/* username@yourdomain.com:/home/username/public_html/

# Hoặc dùng rsync (tốt hơn)
rsync -avz --delete dist/ username@yourdomain.com:/home/username/public_html/
```

---

## Bước 3: Cấu Hình .htaccess (Quan Trọng!)

Tạo file `.htaccess` trong `public_html` với nội dung:

```apache
# Enable rewrite engine
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # Force HTTPS (nếu có SSL)
  RewriteCond %{HTTPS} off
  RewriteRule ^(.*)$ https://%{HTTP_HOST%}/$1 [R=301,L]

  # Serve index.html for all routes (SPA routing)
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

# Cache static assets
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/jpg "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 month"
  ExpiresByType application/x-javascript "access plus 1 month"
</IfModule>

# Gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css
  AddOutputFilterByType DEFLATE application/javascript application/json
</IfModule>
```

**Lưu ý:** File này có thể upload qua File Manager (chọn "Show Hidden Files" trước)

---

## Bước 4: Kiểm Tra API Resolve Link Shopee

Bản build hiện tại tự copy endpoint PHP `api/resolve-url.php` vào `dist/`. Endpoint này dùng để resolve link rút gọn `s.shopee.vn`, sau đó app lấy `utm_content` để đổi tên Campaign / Ad Set / Ad.

Khi upload lên Hostinger, hãy upload **toàn bộ nội dung trong `dist/`**, bao gồm cả thư mục:

```text
dist/api/resolve-url.php
```

Nếu thiếu file này, app vẫn chạy nhưng các link rút gọn Shopee sẽ không tự đổi tên theo `utm_content`.

### Khi Dùng VPS/Cloud Hosting Riêng

**Nếu bạn có VPS/Cloud Hosting:**

1. **Tạo folder riêng cho backend:**
```bash
mkdir ~/adsflow-api
cd ~/adsflow-api
```

2. **Tạo `package.json`:**
```json
{
  "name": "adsflow-api",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5"
  }
}
```

3. **Tạo `server.js`:**
```javascript
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const allowedHosts = new Set(['s.shopee.vn', 'shopee.vn', 'www.shopee.vn']);

app.get('/api/resolve-url', async (req, res) => {
  try {
    const target = new URL(req.query.url || '');
    if (!['http:', 'https:'].includes(target.protocol) || !allowedHosts.has(target.hostname)) {
      return res.status(400).json({ error: 'URL không được hỗ trợ.' });
    }
    const result = await fetch(target, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    res.json({ url: result.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/meta/long-lived-token', async (req, res) => {
  try {
    const { appId, appSecret, shortLivedToken } = req.body;
    if (!appId || !appSecret || !shortLivedToken) {
      return res.status(400).json({ error: 'Thiếu App ID, App Secret hoặc User Token.' });
    }

    const endpoint = new URL('https://graph.facebook.com/v25.0/oauth/access_token');
    endpoint.searchParams.set('grant_type', 'fb_exchange_token');
    endpoint.searchParams.set('client_id', String(appId).trim());
    endpoint.searchParams.set('client_secret', String(appSecret).trim());
    endpoint.searchParams.set('fb_exchange_token', String(shortLivedToken).trim());

    const metaResponse = await fetch(endpoint);
    const data = await metaResponse.json();
    
    if (!metaResponse.ok || data.error) {
      return res.status(metaResponse.status || 400).json({
        error: data.error?.message || 'Meta không đổi được Long-lived Token.',
      });
    }

    res.json({
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
```

4. **Cài dependencies và chạy:**
```bash
npm install
node server.js
```

5. **Chạy với PM2 (để tự động restart):**
```bash
npm install -g pm2
pm2 start server.js --name adsflow-api
pm2 save
pm2 startup
```

6. **Cấu hình reverse proxy trong Apache/Nginx** để `/api/*` trỏ đến port 3000

**Nếu bạn chỉ có Shared Hosting:**
- Hostinger shared hosting không chạy được Node.js backend
- **Giải pháp**: Bỏ 2 tính năng này hoặc dùng external API service (Vercel Serverless)

---

## Bước 5: Kiểm Tra

1. Truy cập domain của bạn: `https://yourdomain.com`
2. Kiểm tra:
   - ✅ App hiển thị đúng
   - ✅ Có thể nhập User Access Token
   - ✅ Tải được danh sách Page
   - ✅ Xử lý bài đăng
   - ✅ Xuất file Excel

---

## Giải Pháp Nhanh (Không Cần Backend)

Nếu bạn muốn deploy nhanh mà không setup backend:

1. **Tạm thời bỏ API endpoints** bằng cách comment code trong `app.js`
2. **Hoặc**: Deploy API lên Vercel miễn phí, frontend ở Hostinger

**Deploy API lên Vercel:**
```bash
# Tạo folder mới cho API
mkdir adsflow-api
cd adsflow-api

# Tạo file api/resolve-url.js và api/long-lived-token.js
# Upload lên Vercel
vercel
```

Sau đó update URL API trong code frontend trỏ đến Vercel.

---

## Checklist Deploy

- [ ] Build project: `npm run build`
- [ ] Upload nội dung `dist/` vào `public_html/`
- [ ] Tạo file `.htaccess`
- [ ] Kiểm tra HTTPS (SSL)
- [ ] Test Meta API connection
- [ ] Test tính năng xuất Excel
- [ ] Backup code cũ trước khi deploy

---

## Cập Nhật Sau Này

Mỗi khi sửa code:
```bash
npm run build
# Upload lại nội dung dist/ lên public_html/
```

**Tự động hóa bằng script:**
```bash
#!/bin/bash
npm run build
rsync -avz --delete dist/ username@yourdomain.com:/home/username/public_html/
echo "✅ Deploy hoàn tất!"
```

---

## Lưu Ý Quan Trọng

1. **SSL Certificate**: Đảm bảo domain có HTTPS (Hostinger cung cấp Let's Encrypt miễn phí)
2. **Meta App Domain**: Thêm domain của bạn vào Meta App Settings
3. **Backup**: Luôn backup code và database trước khi deploy
4. **Cache**: Clear cache trình duyệt nếu không thấy thay đổi

---

## Troubleshooting

**Lỗi 404 khi refresh trang:**
→ Kiểm tra file `.htaccess` đã được upload đúng chưa

**App không load:**
→ Kiểm tra Console log trong trình duyệt (F12)
→ Đảm bảo upload đúng thư mục public_html

**Meta API lỗi CORS:**
→ Thêm domain vào Meta App Settings → Basic → App Domains

**File upload bị giới hạn:**
→ Nén file thành .zip, upload rồi extract trên server

---

**Cần hỗ trợ thêm?** Cho mình biết loại hosting Hostinger bạn đang dùng (Shared/VPS/Cloud) để mình hướng dẫn chi tiết hơn!
