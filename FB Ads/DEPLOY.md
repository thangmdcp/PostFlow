# Hướng Dẫn Deploy AdsFlow Studio

## Tổng Quan
AdsFlow Studio là ứng dụng web tĩnh (static web app) được build bằng Vite. Bạn có nhiều tùy chọn để deploy:

---

## 1. Deploy Lên Vercel (Khuyên Dùng - Miễn Phí)

### Bước 1: Chuẩn bị
```bash
npm install
```

### Bước 2: Build project
```bash
npm run build
```

### Bước 3: Deploy
**Cách A: Dùng Vercel CLI**
```bash
# Cài Vercel CLI
npm install -g vercel

# Deploy
vercel

# Deploy production
vercel --prod
```

**Cách B: Dùng Vercel Website**
1. Truy cập https://vercel.com
2. Đăng nhập bằng GitHub/GitLab/Bitbucket
3. Click "Add New Project"
4. Import repository này
5. Vercel sẽ tự động detect Vite và deploy

### Lưu Ý Với Vercel
- Các API endpoint trong `vite.config.js` cần chuyển thành Serverless Functions
- Tạo folder `api/` và chuyển logic sang đó

---

## 2. Deploy Lên Netlify (Miễn Phí)

### Bước 1: Build
```bash
npm run build
```

### Bước 2: Deploy
**Cách A: Netlify CLI**
```bash
# Cài Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy

# Deploy production
netlify deploy --prod
```

**Cách B: Netlify Website**
1. Truy cập https://netlify.com
2. Drag & drop folder `dist/` vào Netlify
3. Hoặc kết nối với Git repository

### Cấu Hình Netlify
Tạo file `netlify.toml`:
```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

---

## 3. Deploy Lên GitHub Pages (Miễn Phí)

### Bước 1: Cập nhật `vite.config.js`
Thêm `base` config:
```javascript
export default defineConfig({
  base: '/FB Ads/', // Tên repository của bạn
  plugins: [resolveUrlPlugin()],
});
```

### Bước 2: Cài package deploy
```bash
npm install -D gh-pages
```

### Bước 3: Thêm script vào `package.json`
```json
{
  "scripts": {
    "deploy": "npm run build && gh-pages -d dist"
  }
}
```

### Bước 4: Deploy
```bash
npm run deploy
```

**Lưu ý**: GitHub Pages không hỗ trợ API endpoints, chỉ phù hợp nếu bỏ phần API.

---

## 4. Deploy Lên VPS/Server Riêng

### Option A: Static Hosting với Nginx

```bash
# Build project
npm run build

# Copy dist/ lên server
scp -r dist/* user@server:/var/www/adsflow/

# Cấu hình Nginx
# /etc/nginx/sites-available/adsflow
server {
    listen 80;
    server_name adsflow.yourdomain.com;
    root /var/www/adsflow;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Option B: Chạy với Node.js + PM2

```bash
# Trên server, cài dependencies
npm install

# Cài PM2
npm install -g pm2

# Chạy dev server (production mode)
pm2 start "npm run preview -- --port 3000 --host 0.0.0.0" --name adsflow

# Lưu PM2 config
pm2 save
pm2 startup
```

---

## 5. Deploy Lên Cloudflare Pages (Miễn Phí)

### Cách 1: Qua Website
1. Truy cập https://pages.cloudflare.com
2. Kết nối Git repository
3. Build command: `npm run build`
4. Output directory: `dist`

### Cách 2: Qua Wrangler CLI
```bash
npm install -g wrangler

# Deploy
npm run build
wrangler pages publish dist --project-name=adsflow
```

---

## 6. Docker Deploy

### Tạo `Dockerfile`:
```dockerfile
FROM node:18-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Build và chạy:
```bash
docker build -t adsflow .
docker run -p 8080:80 adsflow
```

---

## Lưu Ý Quan Trọng

### 1. API Endpoints
App này có 2 API endpoints trong `vite.config.js`:
- `/api/resolve-url` - Resolve Shopee affiliate links
- `/api/meta/long-lived-token` - Đổi long-lived token

**Giải pháp khi deploy:**
- **Vercel/Netlify**: Chuyển sang Serverless Functions
- **GitHub Pages**: Bỏ tính năng này hoặc dùng external API
- **VPS**: Giữ nguyên, chạy Node server

### 2. Environment Variables
Không cần env vars vì app dùng client-side Meta API với User Access Token.

### 3. CORS
Nếu gặp lỗi CORS khi gọi Meta API, đảm bảo domain của bạn được whitelist trong Meta App Settings.

### 4. HTTPS
Meta API yêu cầu HTTPS cho production. Các platform như Vercel/Netlify tự động cung cấp SSL.

---

## Quick Start (Khuyến Nghị)

**Cách nhanh nhất để deploy ngay:**

```bash
# 1. Build
npm run build

# 2. Deploy lên Vercel (cài vercel CLI trước)
npm install -g vercel
vercel --prod
```

Hoặc đơn giản drag & drop folder `dist/` lên Netlify Drop.

---

## Checklist Trước Khi Deploy

- [ ] Test build locally: `npm run build && npm run preview`
- [ ] Kiểm tra Meta App settings (domain whitelist)
- [ ] Chuẩn bị SSL certificate (nếu dùng VPS)
- [ ] Backup dữ liệu quan trọng
- [ ] Test trên nhiều trình duyệt
- [ ] Cấu hình analytics (nếu cần)

---

## Hỗ Trợ

Nếu gặp vấn đề:
1. Kiểm tra console log trình duyệt
2. Xem Network tab để debug API calls
3. Kiểm tra Meta Graph API Explorer
4. Review deployment logs

---

**Khuyến nghị cuối cùng**: Dùng **Vercel** hoặc **Netlify** vì miễn phí, dễ setup, tự động SSL, và có CDN global.
