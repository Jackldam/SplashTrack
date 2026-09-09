/**
 * Readiness endpoint.
 *
 * Confirms whether the application is ready to accept traffic — its
 * dependencies are reachable. An orchestrator uses this, rather than
 * `/api/health`, to decide whether to route traffic to an instance.
 *
 * The database check is a real one. The template shipped this route with a
 * `TODO: add DB connectivity check once Prisma client exists` and never came
 * back to it, so a readiness probe reported "ready" for an instance that could
 * not reach its database at all. `SELECT 1` is the cheap, honest check.
 *
 * On failure the response says "not ready" and NOTHING else: the underlying
 * error, the SQL, and above all the connection string never reach the caller. A
 * readiness probe is reachable by anyone who can reach the app.
 *
 * PHASE 1: the boot state machine, including the FAILED state, is separate work
 * (`06-delivery.md` §5). This route answers "can I serve traffic right now",
 * not "what state did this instance boot into".
 */

import { NextRequest, NextResponse } from "next/server";

import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/api/request-id";
import { prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

interface ReadinessCheck {
  name: string;
  status: "ok" | "error";
}

async function checkDatabase(): Promise<ReadinessCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { name: "database", status: "ok" };
  } catch (error) {
    // Logged server-side with the error; returned to the caller without it.
    logger.error(
      { event: "ready.database_unreachable", err: error },
      "readiness check failed: the database is unreachable",
    );
    return { name: "database", status: "error" };
  }
}

export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers);

  const checks: ReadinessCheck[] = [
    { name: "process", status: "ok" },
    await checkDatabase(),
  ];

  const isReady = checks.every((check) => check.status === "ok");

  return NextResponse.json(
    {
      status: isReady ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: isReady ? 200 : 503,
      headers: { [REQUEST_ID_HEADER]: requestId },
    },
  );
}
