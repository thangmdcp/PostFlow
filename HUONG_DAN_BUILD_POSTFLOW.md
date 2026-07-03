# Hướng dẫn build PostFlow từ đầu

## Trả lời câu hỏi quan trọng trước

### Có cần dùng v0 / Claude design trước không?

Không cần. shadcn/ui đã đủ đẹp cho app dashboard dạng này. Tập trung build logic trước, UI chỉnh sau rất nhanh. Chỉ dùng v0.dev nếu bạn cần landing page hoặc layout đặc biệt.

---

## Luồng tổng quan (đã cập nhật)

```
User paste list URL
  → app fetch từng bài qua RapidAPI (tuần tự)
  → bóc tách tất cả link trong caption từng bài
  → hiển thị bảng: link đối thủ | ô input "link của tôi"
  → user tự điền link aff của mình vào từng ô
  → app build finalCaption (thay link) + upload media Cloudinary
  → user lên lịch đăng
  → cron đăng lên FB Page đúng giờ
  → xoá Cloudinary, lưu link bài đã đăng
  → user chọn bài → set ads từ template camp
```

---

## Thứ tự build chuẩn

### Giai đoạn 0 — Setup (30 phút)

```bash
npx create-next-app@latest postflow --typescript --tailwind --app
cd postflow
npx shadcn-ui@latest init
npx prisma init
npm install next-auth @auth/prisma-adapter
npm install cloudinary swr axios
npm install @vercel/functions   # cho waitUntil background worker
```

Tạo `.env.local` với đủ các biến trong prompt.

---

### Giai đoạn 1 — Database (1 giờ)

Copy schema từ prompt vào `prisma/schema.prisma` rồi:

```bash
npx prisma db push
npx prisma studio   # kiểm tra 4 bảng: Batch, Post, ExtractedLink, FbConnection
```

Điểm mới so với schema cũ: có thêm bảng `ExtractedLink` để lưu từng link bóc ra theo post, và bảng `Batch` để gom nhóm nhiều post từ 1 lần paste.

---

### Giai đoạn 2 — Lib functions (2-3 giờ)

Viết và test từng file độc lập trước khi dùng trong API route.

#### `lib/rapidapi.ts`
Fetch caption + media từ 1 URL. Test với 1 link FB thật, log ra xem response có những field nào — đặc biệt là tên field chứa caption (có thể là `text`, `content`, `description` tuỳ API version).

```typescript
export async function fetchPostData(url: string) {
  const res = await fetch(
    "https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": process.env.RAPIDAPI_KEY!,
        "x-rapidapi-host": process.env.RAPIDAPI_HOST!,
      },
      body: JSON.stringify({ url }),
    }
  )
  if (!res.ok) throw new Error(`RapidAPI ${res.status}`)
  return res.json()
}
```

#### `lib/extractLinks.ts`
Bóc tách tất cả URL từ một đoạn text, trả về array theo thứ tự xuất hiện.

```typescript
export function extractLinks(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>\)]+/g
  const matches = text.match(urlRegex) ?? []
  // dedupe nhưng giữ thứ tự
  return [...new Set(matches)]
}
```

Test: paste caption thật của bài đối thủ vào, xem bóc ra đúng link chưa.

#### `lib/buildCaption.ts`
Nhận `rawCaption` + array `{ competitorUrl, myUrl }` → trả về `finalCaption`.

```typescript
export function buildCaption(
  rawCaption: string,
  links: { competitorUrl: string; myUrl: string }[]
): string {
  let result = rawCaption
  for (const { competitorUrl, myUrl } of links) {
    result = result.split(competitorUrl).join(myUrl)
  }
  return result
}
```

Dùng `split().join()` thay vì regex để tránh lỗi với ký tự đặc biệt trong URL.

#### `lib/cloudinary.ts`

```typescript
import { v2 as cloudinary } from "cloudinary"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export async function uploadFromUrl(mediaUrl: string) {
  const result = await cloudinary.uploader.upload(mediaUrl, {
    resource_type: "auto",
    folder: "postflow",
  })
  return { publicId: result.public_id, secureUrl: result.secure_url }
}

export async function deleteFile(publicId: string) {
  await cloudinary.uploader.destroy(publicId, { resource_type: "auto" })
}
```

**Lưu ý quan trọng**: Media URL từ RapidAPI là CDN link có TTL ngắn. Phải upload lên Cloudinary ngay sau khi fetch — không chờ đến lúc đăng bài.

#### `lib/facebook.ts`

```typescript
export async function publishToPage(
  pageId: string,
  accessToken: string,
  caption: string,
  mediaUrl?: string
) {
  const body: Record<string, string> = {
    message: caption,
    access_token: accessToken,
  }
  if (mediaUrl) body.link = mediaUrl

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  const json = await res.json()
  if (json.error) throw new Error(json.error.message)
  // json.id = "pageId_postId"
  return json
}
```

---

### Giai đoạn 3 — Facebook OAuth (2-3 giờ) ← làm sớm, dễ bị block

**Bước 1**: Tạo Facebook App tại developers.facebook.com → loại Business → thêm product Facebook Login + Marketing API.

**Bước 2**: Setup NextAuth với Facebook provider, scope đầy đủ:
```typescript
FacebookProvider({
  clientId: process.env.FACEBOOK_CLIENT_ID!,
  clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: "pages_manage_posts,pages_read_engagement,ads_management,ads_read"
    }
  }
})
```

**Bước 3**: Sau login, đổi short-lived token → long-lived token (60 ngày):
```
GET https://graph.facebook.com/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={app-id}
  &client_secret={app-secret}
  &fb_exchange_token={short-token}
```

**Bước 4**: Lấy danh sách Pages + token riêng của từng Page:
```
GET https://graph.facebook.com/me/accounts?access_token={long-lived-user-token}
```
Lưu từng page vào bảng `FbConnection` với `accessToken` là **page token** (không phải user token).

Kiểm tra: login được, thấy danh sách pages trong `/settings/connections`.

---

### Giai đoạn 4 — API Routes (3-4 giờ)

Test từng route bằng Thunder Client hoặc Postman trước khi làm UI.

#### `POST /api/batches` — nhận list URL, tạo batch + chạy worker

```typescript
import { waitUntil } from "@vercel/functions"

export async function POST(req: Request) {
  const { urls } = await req.json()

  // 1. Dedupe + validate
  const validUrls = [...new Set(urls)].filter(u => u.startsWith("http"))

  // 2. Tạo batch + posts
  const batch = await prisma.batch.create({
    data: {
      posts: {
        create: validUrls.map(url => ({ sourceUrl: url, status: "fetching" }))
      }
    },
    include: { posts: true }
  })

  // 3. Trả về ngay cho UI
  // 4. Chạy worker trong background
  waitUntil(processBatch(batch.id, batch.posts))

  return Response.json({ batchId: batch.id, posts: batch.posts })
}

async function processBatch(batchId: string, posts: Post[]) {
  for (const post of posts) {
    try {
      const data = await fetchPostData(post.sourceUrl)
      const caption = data.text ?? data.content ?? ""
      const links = extractLinks(caption)

      await prisma.post.update({
        where: { id: post.id },
        data: {
          title: data.title,
          rawCaption: caption,
          status: "ready",
          extractedLinks: {
            create: links.map((url, i) => ({
              order: i + 1,
              competitorUrl: url,
            }))
          }
        }
      })
    } catch (err: any) {
      await prisma.post.update({
        where: { id: post.id },
        data: { status: "failed", errorMsg: err.message }
      })
    }

    // delay giữa các request để tránh rate limit
    await new Promise(r => setTimeout(r, 1500))
  }
}
```

#### `GET /api/batches/[id]` — trả về trạng thái batch cho polling

Trả về batch + tất cả posts + extractedLinks. Frontend dùng SWR poll route này mỗi 2s.

#### `PATCH /api/links/[id]` — user lưu link aff của mình

```typescript
// 1. Update ExtractedLink.myUrl
// 2. Kiểm tra nếu tất cả links của post đã có myUrl:
//    → gọi buildCaption() → update Post.finalCaption
//    → trigger upload media lên Cloudinary (background)
```

#### `PATCH /api/posts/[id]/schedule`

Kiểm tra `post.finalCaption` phải tồn tại trước khi cho schedule. Nếu chưa có → trả lỗi 400.

#### `GET /api/cron/publish`

Xác thực bằng header `Authorization: Bearer {CRON_SECRET}`. Query posts pending → publish → xoá Cloudinary → update status.

---

### Giai đoạn 5 — UI (4-6 giờ)

Build theo thứ tự này (mỗi màn hình dùng được luôn):

**1. `/settings/connections`** — login FB, hiển thị pages đã kết nối

**2. `/posts/new`** — màn hình chính, gồm 4 step:
- Step 1: Textarea paste URLs + nút Fetch
- Step 2: Bảng link extraction (cập nhật realtime qua SWR polling)
- Step 3: User điền "My aff link" → nút "Build post" → preview
- Step 4: Schedule panel → nút Schedule

**3. `/` — Dashboard**: bảng tất cả posts, filter theo status

**4. `/ads`**: tạo ads từ template

Các shadcn components dùng nhiều nhất: `Table`, `Input`, `Button`, `Badge`, `Dialog`, `DateTimePicker`, `Select`, `Skeleton` (loading state), `Toast`.

---

## Điểm khác biệt so với flow cũ — tóm tắt

| | Cũ | Mới |
|---|---|---|
| Input | 1 link | List nhiều link |
| Xử lý link aff | Auto replace theo rule | Bóc ra để user tự thay thủ công |
| DB | `AffRule` table | `ExtractedLink` table per post |
| Caption | Lưu cleaned text | Lưu cả `rawCaption` + `finalCaption` |
| UI flow | 1 trang đơn | 4 step có state rõ ràng |
| Batch | Không | Có `Batch` model để gom nhóm |

---

## Lưu ý thực tế

**RapidAPI response**: Tên field caption có thể khác nhau (`text`, `content`, `description`). Log response khi test lần đầu để biết chính xác. Viết helper normalize về 1 format chuẩn.

**Link extraction**: Một số link aff dạng rút gọn (bit.ly, shope.ee...) — bóc ra được nhưng user cần biết đó là link gì để thay đúng. Hiển thị domain thumbnail nhỏ bên cạnh link trong bảng sẽ giúp ích.

**Vercel `waitUntil`**: Chỉ hoạt động trên Vercel runtime. Nếu dev local hoặc dùng Railway thì dùng `setImmediate` hoặc một queue đơn giản hơn.

**FB page token hết hạn**: Long-lived token có hạn 60 ngày. Cần UI cảnh báo khi token sắp hết và flow re-connect lại.

**Marketing API**: Cần TKQC đã verify, không bị hạn chế. Build phần ads sau cùng — không block các phần khác.

---

## Checklist trước khi deploy

- [ ] Env variables đầy đủ trên Vercel
- [ ] Database migrated trên production
- [ ] FB App chuyển sang Live mode
- [ ] `vercel.json` có cron config
- [ ] Test batch 5 link thật end-to-end
- [ ] Test Cloudinary delete sau publish
- [ ] Test retry khi post failed
- [ ] FB long-lived token: xử lý refresh UI
