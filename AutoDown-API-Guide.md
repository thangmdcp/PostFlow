# AutoDown API — Hướng dẫn tích hợp

Service tải video Facebook / TikTok, upload lên Cloudinary, không lưu file vĩnh viễn, không dùng cookie.

## 1. Thông tin kết nối

- **Base URL**: `https://autodown.vibevic.com`
- **Header xác thực** (bắt buộc cho mọi request `/api/*`):
  ```
  X-API-Key: fbdl-83f5757bc7a83f204d734115041e3ba8
  ```

## 2. Phạm vi hỗ trợ

- Nền tảng: Facebook, TikTok — chỉ video/reel **công khai**.
- Không hỗ trợ YouTube (YouTube chặn theo dải IP datacenter, không có cách vượt qua đáng tin cậy nếu không dùng cookie), không hỗ trợ Instagram, không hỗ trợ ảnh/album/carousel (các nền tảng này bắt buộc cookie đăng nhập mới lấy được, vi phạm nguyên tắc không-cookie của service).
- Service **không lưu job/state** — mỗi request tự chứa toàn bộ thông tin, không có jobId.

## 3. Endpoints

### `POST /api/extract` — lấy metadata (không tải file, không đụng Cloudinary)

```bash
curl -X POST https://autodown.vibevic.com/api/extract \
  -H "X-API-Key: fbdl-83f5757bc7a83f204d734115041e3ba8" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.facebook.com/reel/XXXXXXXXXX"}'
```

Response:
```json
{"success": true, "platform": "facebook", "type": "video", "caption": "...", "thumbnail": "...", "mediaCount": 1}
```

### `POST /api/download` — tải video + upload Cloudinary + xoá file tạm (1 lần gọi)

Cần cấu hình Cloudinary trên server AutoDown trước (mục "Cloudinary Configuration" trên giao diện). Request có thể mất vài giây tới vài chục giây — set timeout ≥ 60s phía gọi.

```bash
curl -X POST https://autodown.vibevic.com/api/download \
  -H "X-API-Key: fbdl-83f5757bc7a83f204d734115041e3ba8" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.facebook.com/reel/XXXXXXXXXX"}'
```

Response:
```json
{
  "success": true,
  "caption": "...",
  "type": "video",
  "media": [{"type": "video", "url": "https://res.cloudinary.com/.../temp/abc123/xxxx.mp4", "public_id": "temp/abc123/xxxx"}]
}
```

Dùng thẳng `media[0].url` làm `file_url` khi gọi Facebook Graph API để đăng video — không cần tự tải file về.

### `POST /api/cleanup` — xoá asset Cloudinary theo public_id

```bash
curl -X POST https://autodown.vibevic.com/api/cleanup \
  -H "X-API-Key: fbdl-83f5757bc7a83f204d734115041e3ba8" \
  -H "Content-Type: application/json" \
  -d '{"public_ids": ["temp/abc123/xxxx"]}'
```

Response:
```json
{"success": true, "deleted": {"temp/abc123/xxxx": "deleted"}}
```

## 4. Luồng tích hợp khuyến nghị (đăng bài lên Facebook Page)

### Đăng ngay

1. Dán link → gọi `/api/extract` → hiển thị caption + thumbnail cho user xác nhận.
2. User bấm "Đăng ngay" → gọi `/api/download` → nhận `url` + `public_id` (Cloudinary).
3. Gọi Facebook Graph API để đăng, dùng `file_url = <cloudinary_url>` + `description = <caption>`.
4. **Thành công** → gọi ngay `/api/cleanup` với `public_id`.
5. **Lỗi** → tự retry bằng đúng `url`/`public_id` đã có (không gọi lại `/api/download`). Hết số lần retry → gọi `/api/cleanup`, đánh dấu thất bại.

### Lên lịch

1. Dán link → gọi `/api/extract` → hiển thị caption/thumbnail. **Chưa gọi `/api/download`, chưa có gì trên Cloudinary.**
2. Lưu vào DB của Web B: `{url gốc, caption, thumbnail, scheduled_time, status: "scheduled"}`.
3. **Huỷ lịch trước giờ hẹn** → chỉ cần xoá record DB, không cần gọi `/api/cleanup` (chưa có asset nào tồn tại).
4. Đến đúng giờ hẹn, worker/cron chạy:
   - Gọi `/api/download` với url gốc đã lưu.
   - Gọi Facebook Graph API để đăng.
   - Thành công → `/api/cleanup`.
   - Lỗi khi đăng (đã có asset) → tự retry, hết lượt → `/api/cleanup`.
   - Lỗi khi tải (link gốc đã chết) → chưa có gì để dọn, đánh dấu lỗi cho user cập nhật lại link.

## 5. Lưu ý quan trọng

- **Idempotency**: đảm bảo worker lên lịch không chạy trùng 2 lần cho cùng 1 bài (khoá bằng trạng thái `processing` trong DB trước khi gọi `/api/download`).
- **Lưới an toàn chống rác Cloudinary**: nếu Web B crash giữa chừng (sau `/api/download`, trước khi kịp gọi `/api/cleanup`) thì asset có thể tồn đọng. Nên có thêm 1 cron riêng bên Web B dùng Cloudinary Admin API để xoá asset trong prefix `temp/` cũ hơn 2-3 ngày.
- Không có endpoint kiểm tra trạng thái Cloudinary từ phía `/api/download` — nếu chưa cấu hình Cloudinary, endpoint trả lỗi rõ ràng (400) thay vì chạy ngầm rồi lỗi giữa chừng.
- **Giữ bí mật `X-API-Key`** — không commit vào repo public, không gọi thẳng từ JavaScript chạy trên trình duyệt người dùng cuối.

---
*File này được tạo tự động từ AutoDown (https://autodown.vibevic.com) — tải lại nếu API key thay đổi.*
