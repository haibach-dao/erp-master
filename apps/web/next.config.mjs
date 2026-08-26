/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* Tắt huy hiệu tròn chữ "N" nổi ở góc màn hình.
   *
   * Nó là Next.js Dev Tools — do chính Next chèn vào qua `<nextjs-portal>` (shadow DOM,
   * `aria-label="Open Next.js Dev Tools"`), KHÔNG phải phần tử của hệ. Nó chỉ có ở
   * `next dev`, bản `next build` vốn đã không có. Tắt đi không mất gì về chức năng —
   * chỉ mất bảng chẩn đoán của Next, thứ ta đọc qua log terminal tiện hơn.
   */
  devIndicators: false,
  /* Hai `next dev` cùng lúc trên một thư mục sẽ đè output của nhau trong `.next`
   * — triệu chứng là CSS/chunk của server này bị server kia ghi lại, trông như
   * thay đổi không ăn. Đặt `NEXT_DIST_DIR` để chạy song song một cách an toàn.
   *
   * KÈM THEO: Next viết lại `next-env.d.ts` để trỏ vào distDir đang dùng. Chạy
   * xong với biến này thì nhớ `git restore apps/web/next-env.d.ts apps/web/tsconfig.json`,
   * đừng commit đường dẫn thư mục tạm vào repo. */
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
