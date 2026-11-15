# Thiết kế Dự án: Vũ Trụ Ký Ức (`cocnai`)

**Ngày:** 2026-11-15  
**Trạng thái:** Đang chờ duyệt (Draft for Review)

---

## 1. Mục đích & Ý nghĩa (Intent & Why)

**Vũ trụ ký ức (`cocnai`)** là một không gian web 3D cá nhân dành riêng cho hai người (**Cóc** và **Nai**) để lưu giữ và ngắm nhìn những kỷ vật chung theo năm tháng.

- **Thuần thị giác & xúc giác:** Vì cả hai đều đã hiểu rõ câu chuyện đằng sau mỗi món đồ, trang web loại bỏ hoàn toàn chữ viết, nhãn dán hay khung kể chuyện (pop-up). Trải nghiệm tập trung 100% vào cảm giác ngắm nhìn các kỷ vật 3D trôi nổi bồng bềnh giữa bầu trời đêm/vũ trụ sâu thẳm và chạm tay tương tác trực tiếp.
- **Hiện diện của Cóc và Nai:** Hai nhân vật đại diện là **Froakie (Cóc)** và **Deerling (Nai)** dưới dạng model 3D có xương và hoạt ảnh sống động sẽ cùng bơi lượn, quấn quýt quanh các kỷ vật trong không gian này.

---

## 2. Mục tiêu, Phi mục tiêu & Điều cần tránh (Goals, Non-Goals, Anti-Goals)

### Mục tiêu (Goals)
1. **Không gian vũ trụ không trọng lực:** Dựng bầu trời đêm sâu thẳm với các tầng bụi sao lấp lánh, tinh vân dịu mắt và hệ thống ánh sáng đa hướng tôn khối và màu sắc của các model 3D.
2. **Tương tác vật lý chân thực trên điện thoại (2 trạng thái):**
   - **Trạng thái Trôi nổi (Toàn cảnh):** Các kỷ vật trôi nhẹ nhàng và va chạm đàn hồi với nhau. Người xem vuốt khoảng không để xoay góc nhìn; chạm kéo hoặc gạt trực tiếp lên kỷ vật để đẩy nó trôi theo quán tính không trọng lực.
   - **Trạng thái Ngắm chi tiết (360° Focus):** Chạm vào một kỷ vật sẽ đưa món đồ đó lướt lại gần giữa màn hình. Người xem dùng 1 ngón tay xoay 360 độ mọi hướng, 2 ngón tay để phóng to/thu nhỏ, và chạm ra ngoài khoảng không để thả kỷ vật trôi trở lại vũ trụ.
3. **Hai nhân vật đồng hành Froakie & Deerling sống động:** Sử dụng model `.glb` có sẵn bộ xương và hoạt ảnh (đứng thở, di chuyển/bơi, nhảy vui mừng), tự động di chuyển theo quỹ đạo mượt mà gần nhau giữa các kỷ vật và phản ứng khi được chạm vào.
4. **Quy trình thêm kỷ vật & tối ưu dung lượng tự động:** Người dùng chỉ cần thả file `.glb` xuất từ **Modly (Trellis.2 GGUF)** vào thư mục trên máy tính và chạy 1 lệnh duy nhất để tự động nén dung lượng (giảm 80–90%) và cập nhật danh sách hiển thị.
5. **Tối ưu cho di động & triển khai trên Vercel:** Chạy mượt, tải nhanh trên trình duyệt điện thoại (iOS Safari / Android Chrome) và tự động triển khai qua Vercel.

### Phi mục tiêu trong giai đoạn 1 (Non-Goals)
- Chưa xây dựng giao diện tải file (Upload UI) trực tiếp trên web hoặc hệ thống cơ sở dữ liệu đám mây (sẽ phát triển ở giai đoạn 2).
- Không có hệ thống tài khoản, đăng nhập nhiều người dùng hay bình luận/chia sẻ mạng xã hội.
- Không hiển thị văn bản, ngày tháng hay ghi chú đính kèm từng kỷ vật.

### Điều tuyệt đối tránh (Anti-Goals)
- **Giao diện rối mắt:** Không đặt các nút bấm 2D, thanh công cụ hay chữ nghĩa che khuất tầm nhìn vũ trụ.
- **Xung đột thao tác cảm ứng:** Không để việc muốn xoay ngắm kỷ vật lại vô tình hất văng kỷ vật đi mất, hoặc muốn xoay camera lại bấm nhầm vào kỷ vật.
- **Tràn bộ nhớ điện thoại (Crash tab):** Không tải thô hàng chục file `.glb` nặng hàng chục MB từ Trellis.2 cùng lúc khiến trình duyệt di động bị văng.
- **Model bị tối đen:** Không để nền vũ trụ tối làm mất chi tiết hoặc sai lệch màu sắc của các kỷ vật.

---

## 3. Ràng buộc kỹ thuật (Constraints)

- **Thiết bị chính:** Điện thoại thông minh (màn hình dọc/ngang, thao tác cảm ứng 100%, giới hạn bộ nhớ WebGL nghiêm ngặt khoảng 300–500MB trên iOS Safari).
- **Nguồn mô hình kỷ vật:** File `.glb` tạo từ **Modly + Trellis.2 GGUF** trên máy tính cá nhân (đặc trưng là lưới mesh dày và texture gốc khá nặng).
- **Nền tảng lưu trữ (Hosting):** **Vercel** (gói tĩnh miễn phí, giới hạn dung lượng repo và băng thông hợp lý nên bắt buộc phải nén model trước khi đẩy lên).

---

## 4. Các phương án kỹ thuật & Lựa chọn (Approaches)

### Phương án 1 (Đã chọn): Vite + React + TypeScript + React Three Fiber (`R3F`) + Engine vật lý `Rapier` + `gltf-transform` CLI
- **Cấu trúc:** Dùng `@react-three/fiber` và `@react-three/drei` để dựng cảnh 3D, `@react-three/rapier` (WebAssembly) để xử lý vật lý không trọng lực, kèm script Node.js sử dụng `@gltf-transform/cli` để tự động nén model và cập nhật manifest.
- **Ưu điểm:** Quản lý cực kỳ mượt chuyển cảnh giữa *Trôi nổi toàn cảnh* và *Ngắm 360°*; hỗ trợ tốt hoạt ảnh xương (`useAnimations`) cho Froakie & Deerling; tự động co giãn chất lượng đồ họa trên điện thoại; kiến trúc React sẵn sàng để gắn thêm giao diện Upload trên web ở giai đoạn sau.
- **Đánh đổi:** Kích thước gói thư viện nền tảng lớn hơn JS thuần khoảng vài trăm KB (rất nhỏ so với dữ liệu 3D).

### Phương án 2: Three.js thuần + Cannon-es (Vanilla TS)
- **Ưu điểm:** Gói code JS ban đầu nhỏ nhất.
- **Đánh đổi:** Phải tự viết thủ công máy trạng thái chuyển tiếp camera, đồng bộ vật lý và hoạt ảnh nhân vật; khó mở rộng khi nâng cấp tính năng quản lý/upload trên web về sau.

### Phương án 3: Vật lý giả lập bằng công thức toán học (Không dùng Engine vật lý)
- **Ưu điểm:** Nhẹ CPU nhất.
- **Đánh đổi:** Va chạm hình cầu đơn giản không tạo được chuyển động xoay quán tính tự nhiên cho các kỷ vật có hình khối đa dạng từ Trellis.2.

---

## 5. Chi tiết thiết kế hệ thống (How It Works)

### 5.1. Những quyết định đã thống nhất cùng bạn (User Decisions)
- **Không gian cá nhân cho Cóc & Nai:** Không có chữ hay câu chuyện đi kèm kỷ vật.
- **Tương tác 2 trạng thái trên điện thoại:** Tách biệt rõ ràng giữa thao tác gạt/kéo vật lý trong không gian chung và thao tác xoay 360° khi đã chạm chọn một kỷ vật.
- **Nhân vật đồng hành:** Sử dụng model 3D của **Froakie** và **Deerling** có sẵn bộ xương và hoạt ảnh gốc từ game 3D, tự di chuyển sống động trong không gian và có phản ứng khi chạm vào.
- **Quy trình cập nhật giai đoạn 1:** Thêm model mới trực tiếp trên máy tính rồi đẩy lên Vercel.

### 5.2. Những thiết kế kỹ thuật do mình đề xuất & quyết định (Designer/Builder Calls)
*(Các mục dưới đây do mình chọn mức mặc định hợp lý để hệ thống vận hành trơn tru; bạn có thể yêu cầu chỉnh sửa bất kỳ điểm nào)*

1. **Quy trình nén & đồng bộ kỷ vật 1 lệnh (`npm run sync-models`):**
   - Thư mục `models-raw/` trên máy là nơi bạn thả các file `.glb` xuất trực tiếp từ Modly + Trellis.2.
   - Khi chạy `npm run sync-models`, script sẽ tự động:
     - Nén lưới (Meshopt / Simplify giữ nguyên hình dáng) và nén ảnh texture sang chuẩn WebP (độ phân giải tối ưu 1024×1024 cho mobile), giảm 80–90% dung lượng.
     - Xuất file đã tối ưu vào `public/models/keepsakes/`.
     - Tự động sinh file `src/data/keepsakes.json` chứa danh sách đường dẫn và kích thước chuẩn hóa, nên bạn **không bao giờ phải sửa code** khi thêm kỷ vật mới.
2. **Chuẩn hóa kích thước & Vùng giới hạn không trọng lực (Invisible Gravity Well):**
   - Các model xuất từ Trellis.2 có thể to nhỏ khác nhau; hệ thống sẽ tự động căn tâm (center) và chuẩn hóa kích thước (normalize bounding box) về cùng một thang đo hài hòa khi đưa vào vũ trụ.
   - Môi trường vật lý đặt trọng lực bằng `0` (`gravity={[0, 0, 0]}`) với lực cản không gian nhẹ (`linearDamping = 0.5`, `angularDamping = 0.5`) để khi bạn gạt mạnh, kỷ vật bay vút đi rồi từ từ trôi chậm lại thay vì bay mất vĩnh viễn.
   - Một "vùng lực hút mềm" vô hình hình cầu sẽ nhẹ nhàng kéo các kỷ vật quay lại vùng trung tâm nếu chúng trôi quá xa khỏi tầm mắt.
3. **Phân biệt thao tác chạm (Touch Gesture Disambiguation):**
   - **Chạm nhanh (Tap < 200ms, ngón tay di chuyển < 10px) lên kỷ vật:** Chuyển sang **Trạng thái Ngắm 360°**. Kỷ vật lướt về phía trước camera, nền vũ trụ phía sau hơi dịu tối đi một chút để làm nổi bật món đồ; vuốt 1 ngón để xoay 360° tự do (không bị khóa trục dọc), chụm 2 ngón để phóng to/thu nhỏ; chạm vào khoảng không xung quanh để thả kỷ vật bay về vị trí cũ.
   - **Chạm giữ & vuốt (Drag/Flick) lên kỷ vật (ở trạng thái Toàn cảnh):** Kéo kỷ vật đi theo ngón tay và truyền lực quán tính + độ xoáy theo tốc độ vuốt khi nhả tay.
   - **Vuốt vào khoảng không trống (ở trạng thái Toàn cảnh):** Xoay góc nhìn camera quanh vũ trụ hoặc chụm 2 ngón để tiến/lùi camera.
4. **Hành vi & Hoạt ảnh của Froakie (Cóc) và Deerling (Nai):**
   - Đặt tại `public/models/companions/froakie.glb` và `deerling.glb` (đóng gói sẵn bộ xương + hoạt ảnh Idle, Move/Walk/Swim, Jump/Happy).
   - **Lớp hoạt ảnh kép (Skeletal + Procedural):** Kết hợp phát hoạt ảnh xương gốc (`THREE.AnimationMixer`) với chuyển động lượn 3D mượt mà (nghiêng mình theo góc cua, nhấp nhô nhẹ trong không trọng lực và để lại vệt hạt sáng mỏng). Ngay cả khi một file model thiếu clip hoạt ảnh nào đó, lớp chuyển động đàn hồi bổ trợ vẫn đảm bảo nhân vật luôn sống động.
   - **Quỹ đạo quấn quýt:** Hai nhân vật bay lượn tự do quanh cụm kỷ vật nhưng luôn có lực hút giữ khoảng cách gần nhau (không bao giờ lạc nhau quá xa).
   - **Tương tác khi chạm:** Khi người xem chạm vào Froakie hoặc Deerling, hai bé sẽ quay sang nhau, phát hoạt ảnh nhảy vui mừng kèm hiệu ứng bong bóng nước (Froakie) và hoa/lá sao (Deerling) tỏa ra xung quanh.
5. **Tải thông minh bảo vệ bộ nhớ điện thoại (Progressive Loading):**
   - Vũ trụ hiện ngay lập tức với bầu trời sao, Froakie & Deerling và các kỷ vật nạp tuần tự theo lô nhỏ kèm hiệu ứng hiện dần (fade/scale-in từ hạt sáng) để không làm đơ màn hình điện thoại lúc mới mở trang.

---

## 6. Phần để lại cho quá trình lập trình chi tiết (Left to the Builder)

- Tinh chỉnh thông số màu sắc shader của tinh vân (nebula), mật độ sao và cường độ đèn chiếu (ambient/directional/rim lights).
- Tinh chỉnh hệ số lực đàn hồi, khối lượng va chạm trong Rapier và vận tốc bay của Froakie & Deerling.
- Tạo sẵn 3–4 kỷ vật 3D mẫu nhẹ nhàng để không gian hoạt động hoàn chỉnh ngay từ lần chạy thử đầu tiên trước khi bạn bỏ thêm các file từ Modly vào.
