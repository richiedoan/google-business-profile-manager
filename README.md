# Google Business Profile Manager

Ứng dụng quản lý Google Business Profile (GBP) cho người vận hành nhiều địa điểm hoặc nhiều tài khoản Google: xem hồ sơ, theo dõi hiệu suất, quản lý nội dung và thử nghiệm cập nhật hàng loạt qua dữ liệu mock.

Project gồm web Next.js, API NestJS theo mô hình Backend for Frontend (BFF), PostgreSQL và bộ contracts dùng chung trong npm workspace. **Đọc dữ liệu Google và quản lý nội dung đã được triển khai; sửa thông tin hồ sơ địa điểm Google chưa được hỗ trợ.** Xem bảng phạm vi bên dưới trước khi sử dụng.

## 1. Bài toán

Khi quản lý nhiều chi nhánh, người vận hành cần biết địa điểm nào đang mở, thông tin liên hệ có đầy đủ không, chi nhánh nào có lượt xem hoặc tương tác, và review nào cần phản hồi. Khi các hồ sơ thuộc nhiều tài khoản Google, việc chuyển tài khoản và kiểm tra từng địa điểm làm quy trình này khó theo dõi.

Hệ thống cần giải quyết các nhu cầu:

- Tập trung nhiều kết nối Google trong một workspace, chọn đúng tài khoản doanh nghiệp và địa điểm.
- Xem danh sách lớn qua tìm kiếm, lọc và tải từng trang; mở chi tiết mà vẫn giữ đúng ngữ cảnh kết nối.
- Xem hiệu suất từng địa điểm và tổng hợp theo tài khoản, phân biệt số liệu thiếu với số liệu bằng 0.
- Quản lý ảnh, bài đăng và phản hồi review theo quyền của người dùng.
- Kiểm tra quyền tại server và giữ Google token ngoài trình duyệt.
- Có môi trường thử nghiệm không cần thay đổi hồ sơ công khai trên Google.

## 2. Các hướng giải quyết

Các phương án dưới đây là những hướng có thể cân nhắc cho bài toán, không phải danh sách sản phẩm đã benchmark.

| Hướng                                            | Phù hợp khi                                                                         | Đánh đổi                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Thao tác trực tiếp trong Google Business Profile | Nhu cầu thao tác chủ yếu trên từng hồ sơ và quy trình có sẵn đáp ứng được công việc | Quy trình kiểm tra, tổng hợp và phối hợp phụ thuộc vào giao diện Google          |
| Spreadsheet và script gọi API                    | Cần báo cáo hoặc tác vụ nội bộ với phạm vi hẹp                                      | Phải tự quản lý OAuth, quyền truy cập, lỗi từng bản ghi và giao diện vận hành    |
| Nền tảng quản lý bên thứ ba                      | Muốn dùng ngay một quy trình có sẵn                                                 | Cần đánh giá chi phí, quyền truy cập dữ liệu và mức độ phù hợp của từng sản phẩm |
| Tự xây web + BFF + Google API, như project này   | Cần chủ động quy trình, phân quyền và cách trình bày dữ liệu                        | Tự chịu trách nhiệm triển khai, vận hành, bảo mật và thay đổi API từ Google      |

## 3. Vì sao project chọn web + BFF + provider

Kiến trúc hiện tại tách giao diện vận hành khỏi tích hợp Google. Các lý do phù hợp với thiết kế trong code:

- **BFF làm ranh giới truy cập:** NestJS xác thực session, kiểm tra role, chủ sở hữu kết nối và quyền trên account/location trước khi gọi provider. Trình duyệt chỉ gọi API của ứng dụng.
- **Tách đăng nhập khỏi cấp quyền Business:** đăng nhập Google tạo danh tính trong app; kết nối Business là luồng consent riêng. Một người dùng app có thể kết nối nhiều tài khoản Google mà không đổi session hay role.
- **Provider thay thế được:** mock và Google cùng đi qua `BusinessProfileProvider`, giúp kiểm tra luồng đọc, lỗi và quyền bằng fixture, trong khi phần gọi Google ở lại server.
- **Contracts thuộc ứng dụng:** TypeScript và Zod dùng chung giữa web/API, tránh để UI phụ thuộc trực tiếp vào Prisma model hoặc Google response.
- **Session bền vững trong PostgreSQL:** restart API không làm mất session; refresh token Business được mã hóa trước khi lưu.
- **Monorepo npm workspace:** web, API và contracts có thể thay đổi cùng nhau, với build và kiểm tra từ thư mục gốc.

Đánh đổi là phải vận hành cả web, API và database. Google vẫn quyết định quyền truy cập API, quota và việc xử lý nội dung. Kiến trúc này cũng chưa có hàng đợi cho tác vụ lớn.

## 4. Ưu điểm và phạm vi hiện tại

Ưu điểm chính là giữ được ngữ cảnh nhiều kết nối, tái sử dụng cùng hợp đồng dữ liệu, kiểm soát quyền ở server và có bộ mock để phát triển độc lập với Google. Danh sách dùng infinite scrolling và virtualization để giới hạn số hàng DOM; đây là cách tổ chức tải dữ liệu, chưa phải cam kết hiệu năng theo một benchmark production.

| Tính năng                                         | Mock                                         | Google                                            |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Tài khoản, danh sách và chi tiết địa điểm         | Có; 1.000–10.000 địa điểm giả lập            | Có; lấy theo kết nối của người dùng               |
| Tìm kiếm và lọc trạng thái                        | Theo tên/địa chỉ và trạng thái               | Theo title và trạng thái trước phân trang         |
| Sửa thông tin địa điểm                            | Có; cần MANAGER và bật chỉnh sửa             | Chưa hỗ trợ; trả `PERMISSION_DENIED`              |
| Cập nhật hàng loạt thông tin địa điểm             | Có; tối đa 100 ID được chọn rõ ràng mỗi lệnh | Chưa hỗ trợ                                       |
| Hiệu suất địa điểm và tổng quan tài khoản         | Báo cáo rỗng, không tạo số liệu giả          | Có; cần Business Profile Performance API          |
| Xem ảnh/video, bài đăng và review                 | Trả trạng thái không khả dụng                | Có; cần Google My Business v4 API                 |
| Thêm/xóa media, quản lý bài đăng, phản hồi review | Không hỗ trợ                                 | Có; cần MANAGER, bật chỉnh sửa và đủ quyền Google |
| Ngôn ngữ và giao diện                             | English / Tiếng Việt; sáng / tối / hệ thống  | Dùng chung giao diện                              |

### Giới hạn cần biết

- Mock mặc định chỉ cấp quyền `account-1`; `account-2` là fixture ngoài phạm vi để kiểm tra từ chối truy cập. Thay đổi mock chỉ nằm trong bộ nhớ, mất khi restart hoặc chuyển instance.
- PostgreSQL lưu danh tính, membership, session, giao dịch OAuth, kết nối Business và tùy chọn giao diện; chưa lưu bản sao account/location hay lịch sử đồng bộ.
- Bulk update trả kết quả từng ID, có thể thành công một phần; chưa có queue, lịch chạy, chọn tất cả theo bộ lọc hoặc xử lý nền bằng Redis/BullMQ.
- Tổng quan hiệu suất đánh dấu dữ liệu chưa đầy đủ khi đang tải hoặc có lỗi. Tổng impressions không phải số khách hàng duy nhất. Chưa có xuất CSV và so sánh kỳ trước.
- Tích hợp nội dung có code và kiểm thử bằng response giả lập. Theo ghi chú tích hợp hiện có, chưa thực hiện live create/delete/upload/reply; cần kiểm tra trên môi trường được cấp quyền trước khi đưa vào vận hành.

## 5. Các app vận hành như thế nào?

### Business flow

```mermaid
flowchart TD
  A[Đăng nhập app bằng Google hoặc local dev] --> B[Session ứng dụng trong PostgreSQL]
  B --> C{Provider}
  C -->|Mock| D[Chọn account-1]
  C -->|Google| E[Thêm hoặc chọn kết nối Google Business]
  E --> F[Chọn Business account]
  D --> G[Danh sách địa điểm]
  F --> G
  G --> H[Overview hiệu suất tài khoản]
  G --> I[Chi tiết địa điểm]
  I --> J[Thông tin, Performance, Media, Posts, Reviews]
  J --> K[Thao tác được hỗ trợ theo role và provider]
```

1. Người dùng đăng nhập tại `/login`; app tạo session và chuyển đến `/app`. Đăng nhập chưa tự cấp quyền Business.
2. Trong Google mode, chọn **Thêm tài khoản Google** để cấp quyền Business, sau đó chọn kết nối và Business account. Khi refresh grant không còn hợp lệ, app yêu cầu kết nối lại.
3. Mở `/app/accounts/:id/locations` để tìm kiếm, lọc, tải thêm địa điểm hoặc chuyển sang Overview. Overview tổng hợp toàn account, độc lập với bộ lọc bảng.
4. Mở `/app/locations/:id` để xem chi tiết, hiệu suất và các tab nội dung. `connectionId` đi cùng điều hướng và cache để giữ đúng kết nối.
5. `VIEWER` được đọc; `MANAGER` có thêm `location:write`. Thao tác ghi vẫn phải qua CSRF, Origin, quyền trên tài nguyên, cờ bật chỉnh sửa và khả năng của provider.
6. Với mock, MANAGER có thể chọn tối đa 100 địa điểm, xem trước cập nhật và xác nhận. Kết quả hiển thị thành công/thất bại từng địa điểm, cho phép thử lại các ID thất bại.

### Kiến trúc và tech stack

```mermaid
flowchart LR
  U[Trình duyệt] --> W[apps/web: Next.js]
  U -->|Session cookie; CSRF cho thao tác ghi| A[apps/api: NestJS BFF]
  W -. Kiểm tra health qua API_URL trên Vercel .-> A
  A --> DB[(PostgreSQL / Prisma)]
  A --> P[BusinessProfileProvider]
  P --> M[Mock trong bộ nhớ]
  P --> G[Google APIs]
  C[packages/contracts: TypeScript + Zod] -.-> W
  C -.-> A
```

| Thành phần           | Vai trò                                                                     | Công nghệ chính                                                                     |
| -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/web`           | Đăng nhập, chọn kết nối/account, bảng địa điểm, editor và báo cáo           | Next.js 16, React 19, TypeScript, TanStack Query, TanStack Virtual, React Hook Form |
| `apps/api`           | BFF, session/OAuth, phân quyền, validation, gọi provider và chuẩn hóa lỗi   | NestJS 11, TypeScript, Google Auth Library, Prisma 6, PostgreSQL adapter            |
| `packages/contracts` | Kiểu dữ liệu và schema cho identity, location, bulk, content và performance | TypeScript, Zod 4                                                                   |
| PostgreSQL           | Dữ liệu danh tính và kết nối bền vững                                       | PostgreSQL 17 trong Docker Compose local                                            |
| Công cụ              | Workspace, lint, format và kiểm thử                                         | npm workspaces, ESLint, Prettier, Node test runner qua `tsx`                        |
| Deploy               | Hai service API/web và route chung domain                                   | Vercel Services, cấu hình tại `vercel.json`                                         |

Google token nằm ở server; refresh token Business được mã hóa AES-256-GCM. Trình duyệt dùng opaque session cookie `HttpOnly`, `SameSite=Lax`; database lưu hash session. Khi deploy HTTPS, cookie có `Secure`. Kiểm tra tại UI phục vụ trải nghiệm, quyền truy cập được kiểm tra lại ở API.

## 6. Setup

### Chạy local với mock, không cần Google credentials

Yêu cầu Node.js **22.12+**, npm và Docker Compose. Thực hiện tại thư mục gốc repo.

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Repo chưa có `.env.example` ở thư mục gốc. Tạo file `.env` cho Docker Compose với các giá trị local do bạn chọn, ví dụ:

```dotenv
POSTGRES_USER=gbp_local
POSTGRES_PASSWORD=change_this_local_password
POSTGRES_DB=gbp_local
```

Trong `apps/api/.env`, đặt `DATABASE_URL` khớp các giá trị vừa chọn. URL-encode ký tự đặc biệt trong username/password nếu có.

```dotenv
DATABASE_URL=postgresql://gbp_local:change_this_local_password@localhost:5432/gbp_local
WEB_ORIGIN=http://localhost:3000
BUSINESS_PROFILE_PROVIDER=mock
LOCAL_DEV_LOGIN_ENABLED=true
LOCATION_UPDATES_DISABLED=true
```

Trong `apps/web/.env.local`, đặt:

```dotenv
NEXT_PUBLIC_BFF_ORIGIN=http://localhost:3001
LOCAL_DEV_LOGIN_ENABLED=true
LOCATION_UPDATES_DISABLED=true
```

Hai file example hiện đặt cờ chỉnh sửa khác nhau; cấu hình trên đặt rõ cả hai app ở chế độ tắt chỉnh sửa. Local login chỉ dành cho development, mặc định tắt và không thể bật trong production.

```bash
docker compose up -d --wait
npm exec -w @gbp/api -- prisma migrate deploy
npm run db:generate
npm run build -w @gbp/contracts
npm run dev
```

Dùng `prisma migrate deploy` để áp dụng migration đã commit. Khi chủ động thay đổi schema trong development, dùng `npm run db:migrate` để tạo/apply migration.

Mở <http://localhost:3000/login>, chọn **Sign in locally** rồi vào `/app`. API cần kết nối được PostgreSQL khi khởi động. Kiểm tra API:

```bash
curl http://localhost:3001/health
```

Kết quả mong đợi: `{ "status": "ok" }`. Đây là liveness, không phải truy vấn database readiness cho mỗi request. Chưa đăng nhập thì `/api/me` trả 401; `/app` chuyển về `/login`.

Dừng PostgreSQL bằng `docker compose down`; named volume vẫn giữ dữ liệu. Các file `.env` thật được ignore, chỉ commit cấu hình mẫu.

### Thử chỉnh sửa với mock

Local login tạo fixture `local.viewer@example.test` với role `VIEWER`. Mở `npm exec -w @gbp/api -- prisma studio`, tìm Membership của user này và đổi role sang `MANAGER`, rồi tải lại app.

Đặt `LOCATION_UPDATES_DISABLED=false` trong **cả hai** file môi trường API/web và restart cả hai app để bật editor. Khi biến không được đặt, chỉnh sửa bị tắt; cờ cũng áp dụng cho thao tác ghi nội dung Google. Đổi lại `true` để tắt. Role MANAGER và cờ này không mở khóa việc sửa thông tin địa điểm Google chưa được triển khai.

Có thể đặt `MOCK_LOCATION_COUNT=10000` trong API để thử danh sách lớn. Xem [read flows và bulk selection](docs/read-flows.md) để kiểm tra lựa chọn xuyên trang và lỗi từng ID.

### Đăng nhập Google và kết nối dữ liệu thật

Hai luồng OAuth có callback riêng, dù có thể dùng chung OAuth client:

| Mục đích                | Biến chỉ đặt tại API                                                                | Callback local                                        |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Đăng nhập app (OIDC)    | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | `http://localhost:3001/auth/google/callback`          |
| Kết nối Google Business | `GBP_GOOGLE_CLIENT_ID`, `GBP_GOOGLE_CLIENT_SECRET`, `GBP_GOOGLE_REDIRECT_URI`       | `http://localhost:3001/auth/google-business/callback` |

1. Tạo/cấu hình Google Cloud project, OAuth consent screen và web OAuth client; đăng ký chính xác callback. Để gọi GBP, project cần được cấp quyền API và bật các API tương ứng. Xem [điều kiện truy cập của Google](https://developers.google.com/my-business/content/prereqs) và [hướng dẫn OAuth](https://developers.google.com/my-business/content/implement-oauth).
2. Đặt bộ biến đăng nhập để bật nút Google sign-in. Nếu chưa cấu hình, endpoint đăng nhập Google trả 404; local login vẫn dùng được khi bật rõ ràng.
3. Để lấy dữ liệu thật, đặt `BUSINESS_PROFILE_PROVIDER=google`, bộ biến `GBP_GOOGLE_*` và `GBP_TOKEN_ENCRYPTION_KEY` tại API. Tạo khóa 32 byte dạng 64 ký tự hex bằng lệnh dưới đây.
4. Giữ khóa ổn định qua restart và các instance; thay khóa khiến các kết nối đã lưu cần được kết nối lại. Apply migrations và restart app sau khi thay cấu hình.
5. Đăng nhập app, chọn **Thêm tài khoản Google**, cấp quyền rồi chọn Business account. Không cần điền refresh token, user ID hay account ID thủ công.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Account Management và Business Information phục vụ account/location; Performance phục vụ báo cáo; Google My Business v4 phục vụ media/posts/reviews. Bật các API theo tính năng cần dùng. Chi tiết biến môi trường, reconnect, scope và giới hạn tích hợp nằm trong [Google provider setup](docs/google-provider.md).

Không đặt client secret, token hoặc khóa mã hóa vào `NEXT_PUBLIC_*`. Đăng nhập app thành công không đồng nghĩa project đã được cấp quyền truy cập các Business API.

### Deploy Vercel

Import repo thành **một Vercel project**, root là thư mục gốc repo. `vercel.json` build độc lập service `api` và `web`, bao gồm contracts; `/api/*` và `/auth/*` tới NestJS, các đường dẫn còn lại tới Next.js. Xem [Vercel Services](https://vercel.com/docs/services) cho mô hình triển khai.

- Cấp PostgreSQL truy cập được từ deployment; Docker Compose chỉ cung cấp database local.
- Đặt `DATABASE_URL`, `WEB_ORIGIN=https://<your-domain>` và các biến OAuth cần dùng. Callback production lần lượt là `https://<your-domain>/auth/google/callback` và `https://<your-domain>/auth/google-business/callback`.
- Với Google provider, đặt `BUSINESS_PROFILE_PROVIDER=google` và giữ `GBP_TOKEN_ENCRYPTION_KEY` trong secret management. Cấu hình preview riêng với origin/callback tương ứng.
- Để local login và các local lab tắt. Đặt cờ chỉnh sửa nhất quán ở cả hai service.
- Apply migration trên database deployment trước khi phục vụ traffic: `npm exec -w @gbp/api -- prisma migrate deploy`.
- Để `NEXT_PUBLIC_BFF_ORIGIN` unset trên Vercel. `API_URL` được binding của Vercel inject cho web; không tự đặt hoặc đưa vào biến public.

Kiểm tra `/health`, `/login` và `/api/me` sau deploy; `/api/me` trả 401 nếu chưa đăng nhập. `/health` trên Vercel là route Next.js kiểm tra NestJS qua `API_URL`. Mock edits không bền vững giữa các function instance.

Để thử routing Services từ thư mục gốc, chạy `npx vercel dev` hoặc `npx vercel dev -L` khi không dùng cloud authentication. Bỏ override `NEXT_PUBLIC_BFF_ORIGIN` local và đặt `WEB_ORIGIN` theo origin CLI in ra; Vercel inject `API_URL`.

### Lệnh phát triển và kiểm tra

| Lệnh                                      | Mục đích                                |
| ----------------------------------------- | --------------------------------------- |
| `npm run dev`                             | Chạy web và API                         |
| `npm run build`                           | Build contracts, API và web theo thứ tự |
| `npm run lint`                            | Kiểm tra lint                           |
| `npm run typecheck`                       | Kiểm tra type trong workspace           |
| `npm test`                                | Chạy test API và web bằng fixture       |
| `npm run format` / `npm run format:check` | Format / kiểm tra format                |
| `npm run db:generate`                     | Sinh Prisma client                      |
| `npm run db:migrate`                      | Tạo/apply migration trong development   |

Test mặc định không cần database thật hay gọi Google. Với PostgreSQL local/test đã migrate, có thể kiểm tra session bền vững:

```bash
RUN_SESSION_DB_TESTS=true NODE_ENV=test npm exec -w @gbp/api -- tsx --test test/session.database.test.ts
```

Test này tạo/tái sử dụng fixture VIEWER và xóa session test sau khi chạy. Các kiểm tra OAuth/database bổ sung được hướng dẫn trong tài liệu tích hợp.

### Các lỗi setup thường gặp

| Hiện tượng                                        | Kiểm tra                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API không khởi động                               | PostgreSQL đã healthy; `DATABASE_URL` khớp Compose; migration đã apply                             |
| Không thấy local login                            | `LOCAL_DEV_LOGIN_ENABLED=true` ở cả API/web; chạy bằng `npm run dev`; restart sau khi sửa env      |
| Không thấy editor hoặc ghi bị 403                 | Membership phải là MANAGER, cờ updates phải là `false` ở cả hai app; provider phải hỗ trợ thao tác |
| Google login được nhưng không có dữ liệu Business | Kết nối Business là luồng riêng; kiểm tra provider, consent và quyền API của Cloud project         |
| Media/posts/reviews bị 403                        | Kiểm tra Google My Business v4 API đã bật, quyền account/location và điều kiện của endpoint        |
| Google trả 429                                    | Đợi rồi thử lại; kiểm tra quota và nhịp đọc, đặc biệt khi tải overview nhiều địa điểm              |
| `/health` trên Vercel trả 503                     | Kiểm tra service API và binding `API_URL`                                                          |

## 7. Nguồn và tài liệu

### Trong repository

- [Kiến trúc và ranh giới các thành phần](docs/architecture.md).
- [Google login: OIDC, PKCE, state và nonce](docs/auth-flow.md).
- [Google provider: cấu hình, kết nối, performance và nội dung](docs/google-provider.md).
- [Luồng đọc, danh sách lớn và bulk update](docs/read-flows.md).
- [CSRF/CORS và kiểm tra thủ công](docs/csrf-cors.md).
- [Rendering security và XSS lab](docs/security-notes.md).
- Mã nguồn: [web](apps/web), [API](apps/api), [contracts](packages/contracts), [database schema](apps/api/prisma/schema.prisma), [cấu hình deploy](vercel.json).

Một số tài liệu kiến trúc/read flow vẫn còn đoạn mô tả giai đoạn bootstrap. Đối chiếu bảng phạm vi trong README, tài liệu Google provider và implementation khi đánh giá tính năng hiện tại.

### Tài liệu chính thức

- [Google Business Profile overview](https://developers.google.com/my-business/content/overview): nền tảng và mục đích của Business Profile APIs.
- [API access prerequisites](https://developers.google.com/my-business/content/prereqs): điều kiện truy cập và bật API.
- [OAuth với Business Profile](https://developers.google.com/my-business/content/implement-oauth): cấp quyền truy cập Business data.
- [API reference](https://developers.google.com/my-business/ref_overview): các API theo chức năng; tài liệu endpoint cụ thể được dẫn trong Google provider setup.
- [Business Profile Performance API](https://developers.google.com/my-business/reference/performance/rest): các endpoint daily metrics và monthly keyword impressions.
- [Vercel Services](https://vercel.com/docs/services): triển khai nhiều service trong một project.

## Phụ lục: kiểm tra session và local authorization lab

Hướng dẫn thủ công hiện có được giữ bên dưới để tái hiện các ca session và phân quyền. Lab cố ý sai chỉ dành cho máy local, mặc định tắt; không bật trên môi trường dùng chung.

<details>
<summary>Manual session checks và authorization comparison lab (English)</summary>

### Location authorization and local comparison lab

`VIEWER` receives `location:read`; `MANAGER` also receives `location:write`.
The UI reads these permissions from `/api/me`. Direct API requests still pass
session/CSRF checks, the NestJS permission guard, and service/resource policy.
The server-owned mock entitlement lookup grants `account-1`; `account-2` is
out of scope for both roles. `location-00001` belongs to account-1 and
`location-00002` belongs to account-2.

For local MANAGER testing, sign in locally first, run
`npm exec -w @gbp/api -- prisma studio`, find `local.viewer@example.test` in
User, and change its Membership role to MANAGER. Reload the app after saving.
Change it back to VIEWER for negative write tests.

**LOCAL LAB ONLY:** the intentionally broken comparison requires all of these
API environment settings and an API restart:

```dotenv
NODE_ENV=development
WEB_ORIGIN=http://localhost:3000
LOCAL_LAB_ONLY=true
LOCAL_LAB_BROKEN_AUTHORIZATION=true
```

It defaults off. Startup rejects production, nonlocal web origins, and missing
explicit opt-in. The lab is restricted to the current mock provider's accounts;
it bypasses location permission/account checks while retaining sessions, CSRF,
and writable-field validation. `/api/me` still reports the real user's
permissions, so a Viewer must use a direct request to demonstrate write bypass.

After signing in as Viewer, run this in the browser console at
`http://localhost:3000`:

```javascript
const api = "http://localhost:3001";
const detail = await fetch(`${api}/api/locations/location-00002`, {
  credentials: "include",
});
console.log("Cross-account read:", detail.status);
const { csrfToken } = await (
  await fetch(`${api}/api/csrf`, {
    credentials: "include",
  })
).json();
const write = await fetch(`${api}/api/locations/location-00002`, {
  method: "PATCH",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  body: JSON.stringify({ websiteUrl: "https://lab.example" }),
});
console.log("Viewer cross-account write:", write.status);
```

Both requests return 403 with the lab off and 200 with it on. Set
`LOCAL_LAB_BROKEN_AUTHORIZATION=false` and restart the API to restore enforcement.
Mock edits reset on API restart. Do not enable this lab on a shared environment.

### Session checks

Run `npm test` for deterministic HTTP and web tests. With migrated local PostgreSQL,
run the optional durable-store test:

```bash
RUN_SESSION_DB_TESTS=true NODE_ENV=test npm exec -w @gbp/api -- tsx --test test/session.database.test.ts
```

This test creates/reuses the local VIEWER user and removes its test session afterward.
It must run against a local/test database. No existing user is deleted.

In the browser, open `/app` without a session: expect a redirect to `/login`. Enable
local login as above, click Sign in locally, and expect `/app` to render. DevTools
should show a host-only HttpOnly, SameSite=Lax cookie for the BFF, and `/api/me`
should return only id, email, displayName, role, permissions. Restart the API and
refresh: the session persists because it is stored in PostgreSQL. Click Sign out:
its database session is deleted, the cookie is cleared, and `/app` requires login.

To exercise expiry locally, use `npm exec -w @gbp/api -- prisma studio` to set the
local fixture's session expiresAt to a past time, then reload `/app`. The UI should
show Session expired. A missing, malformed, unknown, or revoked cookie instead
returns UNAUTHENTICATED. HTTP clients must send `Origin: http://localhost:3000`
for POST /auth/dev-login and POST /api/logout; mismatched/missing origins get 403.
Never copy session cookie values into logs, tickets, or source files.

</details>
