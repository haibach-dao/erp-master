import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { appendAuditEvent, type AppendAuditInput, type AuditWriteClient } from '@erp/audit';
import { PrismaService } from '../../prisma/prisma.service';

/* Alias giữ nguyên tên cũ để không phải sửa ~40 chỗ gọi. Kiểu thật nằm ở `@erp/audit`
 * vì worker ghi vào CÙNG chuỗi hash — hai bên phải dùng một định nghĩa, không phải hai
 * bản trông giống nhau. */
export type RecordAuditInput = AppendAuditInput;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /* Ghi thêm một sự kiện, móc hash vào sự kiện trước trong cùng phân đoạn (công ty, ngày
   * UTC). Trường nhạy cảm được mask TRƯỚC KHI lưu.
   *
   * Bọc trong `$transaction` để đọc-hash-ghi là nguyên tử: hai sự kiện chen nhau giữa
   * bước đọc hash trước và bước ghi sẽ cho hai bản ghi cùng trỏ về một `previousEventHash`,
   * và chuỗi rẽ đôi.
   */
  async record(input: RecordAuditInput) {
    return this.prisma.$transaction((tx) =>
      appendAuditEvent(tx as unknown as AuditWriteClient, ulid(), input),
    );
  }
}
