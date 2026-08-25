import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FilesService } from './files.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { PermissionsService } from '../authorization/permissions.service';
import type { PermissionGrant } from '../authorization/policy.types';

const OWNER = 'user-owner';
const OTHER = 'user-other';

function fileRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'file-1',
    storageKey: 'file-1/cccd.pdf',
    originalName: 'cccd.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    sensitivity: 'restricted',
    scanStatus: 'clean',
    status: 'uploaded',
    uploadedBy: OWNER,
    ...over,
  };
}

function build(opts: { file?: unknown; grants?: PermissionGrant[]; env?: Record<string, string> }) {
  const findUnique = vi.fn().mockResolvedValue(opts.file ?? null);
  const update = vi.fn().mockImplementation((args: unknown) => Promise.resolve(args));
  const record = vi.fn().mockResolvedValue(undefined);
  const getGrants = vi.fn().mockResolvedValue(opts.grants ?? []);
  const env: Record<string, string> = { APP_ENV: 'development', ...(opts.env ?? {}) };

  const svc = new FilesService(
    { fileObject: { findUnique, update, create: vi.fn() } } as unknown as PrismaService,
    { get: (key: string) => env[key] } as never,
    { record } as unknown as AuditService,
    { getGrants } as unknown as PermissionsService,
  );
  return { svc, findUnique, update, record, getGrants };
}

describe('FilesService — sensitive files are gated, not merely authenticated', () => {
  it('refuses a restricted file to a caller without the permission, and audits the refusal', async () => {
    const { svc, record } = build({ file: fileRow(), grants: [] });
    await expect(svc.getDownloadUrl('file-1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FILE.DOWNLOAD_DENIED',
        result: 'DENIED',
        actorId: OTHER,
      }),
    );
  });

  it('refuses restricted METADATA too — storageKey would otherwise leak', async () => {
    const { svc } = build({ file: fileRow(), grants: [] });
    await expect(svc.getMeta('file-1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a restricted file to a caller whose wildcard grant covers the code', async () => {
    const { svc } = build({
      file: fileRow(),
      grants: [{ permission: '*.*.*', scope: 'GROUP' }],
    });
    await expect(svc.getMeta('file-1', OTHER)).resolves.toMatchObject({ id: 'file-1' });
  });

  it('leaves normal files readable by any authenticated caller', async () => {
    const { svc } = build({ file: fileRow({ sensitivity: 'normal' }), grants: [] });
    await expect(svc.getMeta('file-1', OTHER)).resolves.toMatchObject({ sensitivity: 'normal' });
  });

  it('still 404s an unknown file before any permission talk', async () => {
    const { svc } = build({ file: null });
    await expect(svc.getMeta('nope', OTHER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps refusing a file that has not been scanned clean', async () => {
    const { svc } = build({
      file: fileRow({ sensitivity: 'normal', scanStatus: 'pending' }),
    });
    await expect(svc.getDownloadUrl('file-1', OTHER)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('FilesService.confirmUpload — only the uploader closes their own upload', () => {
  it('refuses a confirm from someone who did not upload the file', async () => {
    const { svc, update, record } = build({ file: fileRow({ status: 'pending_upload' }) });
    await expect(svc.confirmUpload('file-1', {}, OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FILE.CONFIRM_DENIED', result: 'DENIED' }),
    );
  });

  it('refuses an unauthenticated confirm', async () => {
    const { svc, update } = build({ file: fileRow({ status: 'pending_upload' }) });
    await expect(svc.confirmUpload('file-1', {}, null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts the uploader', async () => {
    const { svc, update } = build({ file: fileRow({ status: 'pending_upload' }) });
    await svc.confirmUpload('file-1', { sizeBytes: 42 }, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'uploaded' }) }),
    );
  });
});

describe('FilesService — an env flag must not be what decides security', () => {
  it('outside development, an unscanned file stays pending even with scanning switched off', async () => {
    const { svc, update } = build({
      file: fileRow({ status: 'pending_upload' }),
      env: { APP_ENV: 'production', VIRUS_SCAN_ENABLED: 'false' },
    });
    await svc.confirmUpload('file-1', {}, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'pending' }) }),
    );
  });

  it('in development the bypass still works, so the local upload flow is not broken', async () => {
    const { svc, update } = build({
      file: fileRow({ status: 'pending_upload' }),
      env: { APP_ENV: 'development', VIRUS_SCAN_ENABLED: 'false' },
    });
    await svc.confirmUpload('file-1', {}, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'clean' }) }),
    );
  });

  it('with scanning enabled the file waits for a real scanner in every environment', async () => {
    const { svc, update } = build({
      file: fileRow({ status: 'pending_upload' }),
      env: { APP_ENV: 'development', VIRUS_SCAN_ENABLED: 'true' },
    });
    await svc.confirmUpload('file-1', {}, OWNER);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'pending' }) }),
    );
  });
});
