/**
 * `POST /api/admin/backup` — §3.1's "Create backup now" button, and §3.3's
 * download in one step: a native HTML form POST here, which the browser
 * treats as a file download because of `Content-Disposition`.
 *
 * TWO PERMISSION CHECKS, BOTH ENFORCED, NEITHER SKIPPED. `createBackup`
 * (`backup.run`) builds the archive; `requireBackupDownload` (`backup.download`)
 * is called before the bytes are ever put on the wire, exactly as §3.3 (D-042)
 * requires for the act of a backup LEAVING the server. A caller holding only
 * one of the two permissions gets a 403 before the other half runs.
 *
 * D-042's step-up re-authentication, rate limiting and single-use signed link
 * are NOT implemented here — flagged in `backup-service.ts`'s
 * `requireBackupDownload` doc comment and in the phase report. What IS real:
 * the permission gate and the high-severity audit event.
 */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import {
  createBackup,
  requireBackupDownload,
} from "@/modules/backup/application/backup-service";

export async function POST(request: NextRequest) {
  const session = await requireEnrolledSession();
  const principal = { personId: session.person.id };
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    const result = await createBackup({ principal, requestId });
    await requireBackupDownload({ principal, requestId });

    return new NextResponse(new Uint8Array(result.archive), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(result.archive.length),
      },
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json(
        { ok: false, permission: error.permission },
        { status: 403 },
      );
    }
    throw error;
  }
}
