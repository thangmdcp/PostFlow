# ✅ Build Hoàn Tất - Hướng Dẫn Upload Lên Hostinger

## 🎉 Project đã được build thành công!

Folder **`dist`** đã sẵn sàng để upload lên Hostinger.

---

## 📁 Đường Dẫn Folder Build

```
/Users/thangvd/Documents/Vibe Code/FB Ads/dist/
```

---

## 🚀 Các Bước Upload Lên Hostinger

### Cách 1: Upload Qua File Manager (Dễ Nhất)

1. **Đăng nhập Hostinger hPanel**: https://hpanel.hostinger.com

2. **Vào File Manager**:
   - Click **Files** → **File Manager**
   - Hoặc truy cập: https://hpanel.hostinger.com/hosting/[your-domain]/file-manager

3. **Vào thư mục public_html**:
   - Navigate đến folder `public_html` (hoặc folder của domain bạn)
   - Đây là thư mục gốc của website

4. **Xóa file cũ** (nếu có):
   - Select tất cả file cũ trong `public_html`
   - Click Delete

5. **Upload file từ dist**:
   - Click nút **Upload** ở góc trên
   - Chọn **tất cả file BÊN TRONG folder dist** (KHÔNG upload folder dist mà là nội dung bên trong)
   - Upload các file sau:
     ```
     ✅ index.html
     ✅ assets/ (folder chứa CSS, JS, images)
     ✅ export_20260612_1020.xlsx
     ✅ export_20260612_1448.xlsx
     ✅ Mo AdsFlow Studio.command (nếu cần)
     ✅ Mo Meta Ads App.command (nếu cần)
     ```

6. **Đợi upload hoàn tất** - Sẽ mất vài phút tùy tốc độ mạng

### Cách 2: Upload Qua FTP (Nhanh Hơn)

**Sử dụng FileZilla hoặc Cyberduck:**

1. **Lấy thông tin FTP từ Hostinger**:
   - Vào hPanel → **Files** → **FTP Accounts**
   - Lấy: Hostname, Username, Password

2. **Kết nối FTP**:
   ```
   Host: ftp.yourdomain.com (hoặc IP server)
   Username: [username từ Hostinger]
   Password: [password từ Hostinger]
   Port: 21 (FTP) hoặc 22 (SFTP)
   ```

3. **Upload**:
   - Bên trái: Navigate đến `/Users/thangvd/Documents/Vibe Code/FB Ads/dist/`
   - Bên phải: Navigate đến `/public_html/`
   - **Kéo thả tất cả file trong dist** sang bên phải
   - Chọn "Overwrite" nếu có file trùng

### Cách 3: Upload Qua Terminal (Cho Pro)

```bash
# Dùng SCP (thay username và yourdomain.com bằng thông tin của bạn)
scp -r "/Users/thangvd/Documents/Vibe Code/FB Ads/dist/"* username@yourdomain.com:/home/username/public_html/

# Hoặc dùng rsync (tốt hơn, chỉ upload file thay đổi)
rsync -avz --delete "/Users/thangvd/Documents/Vibe Code/FB Ads/dist/" username@yourdomain.com:/home/username/public_html/
```

---

## 🔧 Bước Quan Trọng: Tạo File .htaccess

**Sau khi upload xong**, tạo file `.htaccess` trong `public_html`:

### Qua File Manager:

1. Vào File Manager → public_html
2. Click **New File**
3. Tên file: `.htaccess`
4. Click vào file vừa tạo → **Edit**
5. Paste nội dung sau:

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
  ExpiresByType text/css "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 month"
</IfModule>

# Gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css
  AddOutputFilterByType DEFLATE application/javascript application/json
</IfModule>
```

6. **Save**

---

## 🔒 Kiểm Tra SSL (HTTPS)

1. Vào hPanel → **Security** → **SSL**
2. Đảm bảo SSL đã được kích hoạt cho domain
3. Nếu chưa có, install Let's Encrypt SSL (miễn phí)

---

## ✅ Kiểm Tra Website

1. Truy cập domain: `https://yourdomain.com`
2. Kiểm tra các tính năng:
   - ✅ Trang hiển thị đúng
   - ✅ Nhập User Access Token
   - ✅ Load danh sách Page
   - ✅ Xử lý bài đăng
   - ✅ Xuất file Excel

---

## ⚠️ Lưu Ý Quan Trọng

### 1. API Endpoints Không Hoạt Động
App có 2 API endpoints:
- `/api/resolve-url` (resolve Shopee links)
- `/api/meta/long-lived-token` (đổi long-lived token)

**Vấn đề**: Hostinger shared hosting không chạy Node.js backend

**Giải pháp**:
- **Tính năng vẫn hoạt động** nhưng 2 API này sẽ không work
- Bạn có thể:
  1. Bỏ qua (app vẫn chạy được phần lớn tính năng)
  2. Deploy API lên Vercel miễn phí (nếu cần)

### 2. Meta App Domain Whitelist
Thêm domain của bạn vào Meta App Settings:
1. Vào https://developers.facebook.com/apps
2. Chọn App → Settings → Basic
3. Thêm domain vào **App Domains**

### 3. Clear Cache
Nếu không thấy thay đổi sau khi upload:
- Clear cache trình duyệt (Ctrl + Shift + R)
- Hoặc mở Incognito mode

---

## 🔄 Cập Nhật Sau Này

Mỗi khi sửa code:

```bash
# Build lại
cd "/Users/thangvd/Documents/Vibe Code/FB Ads"
npm run build

# Upload lại nội dung dist/ lên public_html
```

---

## 🆘 Troubleshooting

**Lỗi 404 khi refresh trang:**
→ Kiểm tra file `.htaccess` đã tạo chưa

**Trang trắng, không hiển thị gì:**
→ Mở Console (F12) xem lỗi
→ Đảm bảo upload đúng file vào `public_html`

**Images không hiển thị:**
→ Đảm bảo folder `assets/` đã được upload

**Meta API lỗi CORS:**
→ Thêm domain vào Meta App Settings

---

## 📦 Nội Dung Folder dist (Tham Khảo)

```
dist/
├── index.html                          (15.91 KB)
├── assets/
│   ├── adsflow-logo-Dnpxpqd7.png      (57.85 KB)
│   ├── adsflow-thumbnail-CfVQGWtR.png (1.27 MB)
│   ├── export_20260612_1020-BDM-VaJS.xlsx (83.34 KB)
│   ├── export_20260612_1448-B8eKJHWZ.xlsx (62.02 KB)
│   ├── index-1OAkdl4p.css             (47.56 KB)
│   └── index-Dj9O87Mo.js              (537.19 KB)
```

**Tổng dung lượng**: ~2 MB

---

## ✨ Hoàn Tất!

Sau khi làm xong các bước trên, website của bạn đã live!

Truy cập: `https://yourdomain.com`

Chúc bạn thành công! 🚀
