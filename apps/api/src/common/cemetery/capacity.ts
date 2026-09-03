/**
 * SỐ CỐT của một phần mộ — một công thức, một chỗ.
 *
 * Công thức thì tầm thường: mộ có ghi đè riêng thì lấy ghi đè, không thì lấy mặc định của
 * loại mộ. Nó nằm ở đây không phải vì khó, mà vì tới 02/09/2026 nó đã bị chép tay ở SÁU
 * chỗ — thẻ mộ, danh sách lô mộ, hồ sơ an táng (hai chỗ), hồ sơ khách 360, và điều kiện
 * chặn đặt cốt. Sáu bản sao của một luật thì sáu chỗ sẽ có ngày lệch nhau.
 *
 * Điều làm nó không còn tầm thường: từ 02/09/2026 con số này là CƠ SỐ NHÂN của tiền in
 * lại thẻ (50.000đ × số cốt). Thêm bản sao thứ bảy cho việc tính tiền nghĩa là một ngày
 * nào đó màn hình hiện một con số và hoá đơn thu theo một con số khác — loại lệch mà
 * khách phát hiện trước hệ.
 *
 * CỐ Ý nhận một hình dạng hẹp nhất có thể (`capacityOverride` + `graveType.defaultCapacity`)
 * chứ không nhận cả `GravePlot`: như vậy chỗ gọi phải `include: { graveType: true }` mới
 * biên dịch được, và không ai lỡ gọi nó với một bản ghi thiếu loại mộ rồi nhận `undefined`
 * nhân ra `NaN` đồng.
 */
export interface HasCapacity {
  capacityOverride: number | null;
  graveType: { defaultCapacity: number };
}

export function effectiveCapacity(plot: HasCapacity): number {
  return plot.capacityOverride ?? plot.graveType.defaultCapacity;
}
