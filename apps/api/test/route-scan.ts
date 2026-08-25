/* Static scan of Nest controllers: which HTTP routes exist, and which one permission
 * code (if any) gates each of them. Deliberately source-level rather than runtime:
 * the invariant we protect is "no route ships without a reviewed decision", and that
 * has to hold even for routes whose module fails to boot in a test environment.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ScannedRoute {
  /** `GET /cemetery/grave-plots` — stable id used by the allowlist. */
  id: string;
  method: string;
  path: string;
  file: string;
  /** Code inside @RequirePermission on the handler, or null when the route is ungated. */
  permission: string | null;
  /** Handler carries @Public() — an explicit decision that no token is needed. */
  isPublic: boolean;
  /** Controller registers PermissionGuard via @UseGuards. */
  hasPermissionGuard: boolean;
}

const HTTP_VERB = /^@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)")?/;
const REQUIRE_PERMISSION = /^@RequirePermission\(\s*'([^']*)'/;
const CONTROLLER_PATH = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?/;
const HANDLER_SIGNATURE =
  /^(?:public\s+|private\s+|protected\s+)?(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/;

export function findControllerFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findControllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

export function scanController(file: string, source: string): ScannedRoute[] {
  const basePath = normalise(CONTROLLER_PATH.exec(source)?.[1] ?? '');
  const hasPermissionGuard = /@UseGuards\([^)]*PermissionGuard/s.test(source);

  const routes: ScannedRoute[] = [];
  let pending: string[] = [];
  // A decorator may wrap across lines (`@MaskUnless(` then its rules then `)`); keep
  // swallowing lines until its parentheses balance. Without this the run of decorators
  // looks like it ended at the first continuation line, and the route silently loses
  // the permission that sits above it.
  let openParens = 0;

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (openParens > 0) {
      openParens += countParens(line);
      continue;
    }
    if (line.startsWith('@')) {
      pending.push(line);
      openParens = Math.max(0, countParens(line));
      continue;
    }
    if (line.length === 0 || line.startsWith('//') || line.startsWith('*')) {
      continue;
    }
    if (HANDLER_SIGNATURE.test(line)) {
      const verb = firstMatch(pending, HTTP_VERB);
      if (verb !== undefined) {
        const method = (verb[1] ?? '').toUpperCase();
        const routePath = normalise(verb[2] ?? '');
        const permission = firstMatch(pending, REQUIRE_PERMISSION)?.[1] ?? null;
        routes.push({
          id: `${method} ${joinPath(basePath, routePath)}`,
          method,
          path: joinPath(basePath, routePath),
          file,
          permission,
          isPublic: pending.some((d) => d.startsWith('@Public(')),
          hasPermissionGuard,
        });
      }
      pending = [];
      continue;
    }
    // Any other statement ends the decorator run (e.g. a field or a closing brace).
    pending = [];
  }
  return routes;
}

export function scanRoutes(srcRoot: string): ScannedRoute[] {
  return findControllerFiles(srcRoot).flatMap((file) =>
    scanController(toPosix(file), readFileSync(file, 'utf8')),
  );
}

function countParens(line: string): number {
  let net = 0;
  for (const ch of line) {
    if (ch === '(') net += 1;
    if (ch === ')') net -= 1;
  }
  return net;
}

function firstMatch(lines: string[], re: RegExp): RegExpExecArray | undefined {
  for (const line of lines) {
    const m = re.exec(line);
    if (m !== null) {
      return m;
    }
  }
  return undefined;
}

function toPosix(path: string): string {
  return path.split(String.fromCharCode(92)).join('/');
}

function normalise(segment: string): string {
  return segment.replace(/^\/+|\/+$/g, '');
}

function joinPath(base: string, route: string): string {
  return `/${[base, route].filter((s) => s.length > 0).join('/')}`;
}
