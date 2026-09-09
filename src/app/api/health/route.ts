/**
 * Liveness endpoint.
 *
 * Confirms only that the application process is up and able to handle a
 * request. It deliberately does NOT check downstream dependencies — that is
 * `/api/ready`'s job. A liveness probe stays cheap and fast so an orchestrator
 * can use it to decide whether to restart the process.
 *
 * `05-technical.md` §4 is explicit that this and `/api/ready` are OPERATIONAL
 * endpoints, not a product API. There is no public API surface in v1.
 *
 * It must not expose implementation detail: no stack traces, no internal
 * hostnames, no dependency versions.
 */

import { NextRequest, NextResponse } from "next/server";

import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/api/request-id";

export function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers);

  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}
