/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /* Hai `next dev` cùng lúc trên một thư mục sẽ đè output của nhau trong `.next`
   * — triệu chứng là CSS/chunk của server này bị server kia ghi lại, trông như
   * thay đổi không ăn. Đặt `NEXT_DIST_DIR` để chạy song song một cách an toàn. */
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
