import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import { PermissionsService } from '../../modules/authorization/permissions.service';
import { permissionMatches } from '../../modules/authorization/policy-evaluator';
import {
  MASK_RULES_KEY,
  NEVER_SERIALIZE,
  REVEAL_FIELDS_KEY,
  type MaskRule,
} from './mask.decorator';
import { SENSITIVE_FIELDS } from './sensitive-fields';

const REDACTED = '***';

/* Applies field-level masking on the way out, for every response.
 *
 * Three jobs, in order of how little they trust the caller:
 *  1. Unconditional: strip the fields in NEVER_SERIALIZE from every response, whatever the
 *     route or role. Those are the raw material behind a masked value.
 *  2. Global sensitive-field registry (SENSITIVE_FIELDS): applies to EVERY response so a
 *     newly added `phone` column is masked without anyone remembering to say so. A route
 *     that legitimately returns one says `@RevealFields('phone')` — an opt-OUT that is
 *     visible in review, instead of an opt-IN that is forgotten.
 *  3. Per-route @MaskUnless rules, for fields that are only sensitive in one context
 *     (`totalAmount`, `agreedPrice`).
 *
 * Registered globally rather than per-controller on purpose. A "never serialize" list that
 * has to be remembered at each call site is a list that will be forgotten at one.
 */
@Injectable()
export class MaskingInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const routeRules =
      this.reflector.getAllAndOverride<MaskRule[] | undefined>(MASK_RULES_KEY, targets) ?? [];
    const revealed = new Set(
      this.reflector.getAllAndOverride<string[] | undefined>(REVEAL_FIELDS_KEY, targets) ?? [],
    );
    // Sổ toàn hệ trước, luật riêng của route sau. Route được MIỄN một trường khỏi sổ,
    // nhưng không được nới lỏng luật riêng nó tự khai.
    const rules = [...SENSITIVE_FIELDS.filter((r) => !revealed.has(r.field)), ...routeRules];
    const userId = context.switchToHttp().getRequest<Request>().user?.userId;

    return next.handle().pipe(mergeMap((body) => from(this.applyMasking(body, rules, userId))));
  }

  private async applyMasking(
    body: unknown,
    rules: MaskRule[],
    userId: string | undefined,
  ): Promise<unknown> {
    const active = await this.rulesToApply(rules, userId);
    return maskTree(body, active);
  }

  // A rule is dropped only when the caller demonstrably holds the code. No user, unknown
  // code, or no grant all mean the rule stays on — masking fails closed.
  private async rulesToApply(rules: MaskRule[], userId: string | undefined): Promise<MaskRule[]> {
    if (rules.length === 0) {
      return [];
    }
    if (userId === undefined) {
      return rules;
    }
    const grants = await this.permissions.getGrants(userId);
    const active: MaskRule[] = [];
    for (const rule of rules) {
      const meta = await this.permissions.getPermissionMeta(rule.permission);
      const holds =
        meta !== null &&
        grants.some((g) =>
          permissionMatches(g.permission, rule.permission, {
            wildcardExempt: meta.wildcardExempt,
          }),
        );
      if (!holds) {
        active.push(rule);
      }
    }
    return active;
  }
}

// Walks plain objects and arrays only. Dates, Prisma Decimals and other class instances
// are values, not containers, and are left alone unless their key is being masked.
function maskTree(node: unknown, rules: MaskRule[]): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => maskTree(item, rules));
  }
  if (!isPlainObject(node)) {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if ((NEVER_SERIALIZE as readonly string[]).includes(key)) {
      continue;
    }
    const rule = rules.find((r) => r.field === key);
    if (rule !== undefined) {
      out[key] = maskedValue(value, rule.strategy ?? 'redact');
      continue;
    }
    out[key] = maskTree(value, rules);
  }
  return out;
}

function maskedValue(value: unknown, strategy: MaskRule['strategy']): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (strategy === 'year') {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? REDACTED : String(date.getUTCFullYear());
  }
  return REDACTED;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
