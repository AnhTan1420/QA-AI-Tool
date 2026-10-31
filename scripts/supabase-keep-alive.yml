// Ping Supabase định kỳ để dự án free-tier không bị Supabase tự "pause"
// sau 7 ngày không có hoạt động nào. Chỉ cần 1 query nhẹ (SELECT ... LIMIT 1)
// là đủ được tính là "activity" — không ghi/xóa gì, không tốn quota đáng kể.
//
// Cần 2 biến môi trường (đặt làm GitHub Actions secrets):
//   SUPABASE_URL              — giống NEXT_PUBLIC_SUPABASE_URL trong .env.local
//   SUPABASE_SERVICE_ROLE_KEY — service role key (bỏ qua RLS, đảm bảo query
//                                luôn chạy được kể cả khi chưa đăng nhập)

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong env.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});

const { error, count } = await supabase
  .from("tests")
  .select("id", { count: "exact", head: true })
  .limit(1);

if (error) {
  console.error("Ping Supabase thất bại:", error.message);
  process.exit(1);
}

console.log(`Ping Supabase OK — bảng "tests" hiện có ${count ?? "?"} dòng. (${new Date().toISOString()})`);
