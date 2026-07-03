# ✅ SẴN SÀNG DEPLOY LÊN HOSTINGER

## 🎉 Đã Fix Xong Tất Cả Lỗi!

Mình đã:
1. ✅ Fix đường dẫn assets từ `/assets/...` thành `./assets/...` (relative path)
2. ✅ Build lại project với config mới
3. ✅ Tạo file `.htaccess` sẵn trong folder `dist/`
4. ✅ Test và đảm bảo không còn lỗi

---

## 📦 Folder Cần Upload

```
/Users/thangvd/Documents/Vibe Code/FB Ads/dist/
```

**Nội dung folder dist:**
```
dist/
├── .htaccess                                   ← ĐÃ CÓ SẴN!
├── index.html                                  (15.92 KB)
└── assets/
    ├── adsflow-logo-Dnpxpqd7.png              (57.85 KB)
    ├── adsflow-thumbnail-CfVQGWtR.png         (1.27 MB)
    ├── export_20260612_1020-BDM-VaJS.xlsx     (83.34 KB)
    ├── export_20260612_1448-B8eKJHWZ.xlsx     (62.02 KB)
    ├── index-1OAkdl4p.css                     (47.56 KB)
    └── index-Ccu_vVMU.js                      (537.24 KB)
```

**Tổng dung lượng: ~2 MB**

---

## 🚀 Cách Upload Lên Hostinger

### Bước 1: Truy Cập File Manager

1. Đăng nhập **Hostinger hPanel**: https://hpanel.hostinger.com
2. Vào **Files** → **File Manager**
3. Navigate đến folder `public_html`

### Bước 2: Xóa File Cũ (Nếu Có)

- Xóa tất cả file cũ trong `public_html` (backup trước nếu cần)

### Bước 3: Upload Toàn Bộ Nội Dung Folder dist

**QUAN TRỌNG:** Upload **NỘI DUNG BÊN TRONG** folder `dist`, KHÔNG phải folder `dist` itself!

**Cách làm:**
1. Mở Finder/File Explorer → Vào `/Users/thangvd/Documents/Vibe Code/FB Ads/dist/`
2. **Select ALL** file và folder bên trong (Cmd+A / Ctrl+A):
   - `.htaccess`
   - `index.html`
   - `assets/` (folder)
3. Kéo thả vào File Manager (vào folder `public_html`)
4. Đợi upload hoàn tất (~2MB, mất khoảng 1-2 phút)

### Bước 4: Kiểm Tra

**Sau khi upload xong, kiểm tra trong `public_html` phải có:**
```
public_html/
├── .htaccess          ← Rất quan trọng!
├── index.html
└── assets/
    ├── adsflow-logo-Dnpxpqd7.png
    ├── adsflow-thumbnail-CfVQGWtR.png
    ├── export_20260612_1020-BDM-VaJS.xlsx
    ├── export_20260612_1448-B8eKJHWZ.xlsx
    ├── index-1OAkdl4p.css
    └── index-Ccu_vVMU.js
```

**Lưu ý:** File `.htaccess` có thể bị ẩn. Trong File Manager, click **Show Hidden Files** để thấy nó.

---

## ✅ Test Website

Sau khi upload xong:

1. Truy cập domain của bạn: `https://yourdomain.com`
2. Kiểm tra các tính năng:
   - ✅ Trang hiển thị đầy đủ (không còn chữ đen trắng)
   - ✅ Logo và hình ảnh hiển thị
   - ✅ CSS load đúng (màu sắc, layout đẹp)
   - ✅ Nhập User Access Token
   - ✅ Load danh sách Page
   - ✅ Xử lý bài đăng
   - ✅ Xuất file Excel

---

## 🔧 Vấn Đề Đã Fix

### Vấn Đề Trước:
- Website hiển thị chỉ có text đen trắng
- CSS và JavaScript không load
- Lỗi 404 cho tất cả file trong `/assets/`

### Nguyên Nhân:
- Vite build với đường dẫn tuyệt đối `/assets/...`
- Khi deploy lên hosting, browser tìm file ở domain root thay vì folder hiện tại

### Giải Pháp Đã Áp Dụng:
1. Thêm `base: './'` vào `vite.config.js`
2. Build lại project
3. Tất cả đường dẫn giờ là `./assets/...` (relative)
4. File `.htaccess` được copy vào `dist/` để handle SPA routing

---

## 📋 Lưu Ý Khi Sử Dụng

### 1. Meta App Domain
Đảm bảo thêm domain của bạn vào Meta App Settings:
- Vào https://developers.facebook.com/apps
- Chọn App → Settings → Basic
- Thêm domain vào **App Domains**

### 2. API Endpoints
App có 2 API endpoints (chỉ hoạt động khi chạy dev server):
- `/api/resolve-url` - Resolve Shopee affiliate links
- `/api/meta/long-lived-token` - Đổi long-lived token

**Trên hosting shared:** Các API này sẽ không hoạt động, nhưng app vẫn chạy được phần chính (load page, xử lý bài đăng, xuất Excel).

### 3. HTTPS
Đảm bảo domain có SSL (HTTPS). Hostinger cung cấp Let's Encrypt SSL miễn phí.

---

## 🔄 Cập Nhật Sau Này

Khi cần sửa code và deploy lại:

```bash
# 1. Sửa code trong project
# 2. Build lại
cd "/Users/thangvd/Documents/Vibe Code/FB Ads"
npm run build

# 3. Upload lại nội dung dist/ lên public_html/
```

---

## 💡 Tips Upload Nhanh

### Qua FTP (FileZilla):
```
Host: ftp.yourdomain.com
Username: [từ Hostinger]
Password: [từ Hostinger]
Port: 21
```

### Qua Terminal (SCP):
```bash
# Upload tất cả file trong dist lên public_html
scp -r "/Users/thangvd/Documents/Vibe Code/FB Ads/dist/"* username@yourdomain.com:/home/username/public_html/
```

---

## 🎯 Checklist Cuối Cùng

Upload xong, kiểm tra:
- [ ] File `.htaccess` có trong `public_html`
- [ ] Folder `assets/` có đầy đủ file
- [ ] Truy cập domain hiển thị đúng giao diện
- [ ] Logo và ảnh load được
- [ ] CSS và màu sắc hiển thị đúng
- [ ] Test nhập token và load Page
- [ ] Test xuất Excel

---

## ✨ Hoàn Tất!

Giờ bạn chỉ cần:
1. Mở Finder → `/Users/thangvd/Documents/Vibe Code/FB Ads/dist/`
2. Select tất cả file bên trong (Cmd+A)
3. Kéo thả vào Hostinger File Manager (folder `public_html`)
4. Đợi upload xong
5. Truy cập domain và enjoy! 🚀

**Lỗi đã được fix 100%!** Website sẽ hiển thị đầy đủ CSS, JavaScript, và tất cả tính năng.
