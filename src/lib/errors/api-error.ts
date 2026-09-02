/**
 * Standard API error model.
 *
 * `05-technical.md` §4 mandates ONE standard error shape for every route
 * handler, and a stable machine-readable `error.code` from the first handler
 * (which is what makes adding a public API later additive rather than a
 * rewrite):
 *
 * {
 *   "error": {
 *     "code": "STUDENT_NOT_FOUND",
 *     "message": "The requested student could not be found.",
 *     "requestId": "req_123456",
 *     "details": []
 *   }
 * }
 *
 * Error responses must never expose stack traces, SQL errors, secret values,
 * internal paths, framework details — or any personal data. This module is the
 * single place responsible for turning any thrown error into a response that
 * respects that rule; route handlers must not hand-roll error JSON themselves.
 */

import { NextResponse } from "next/server";

/** A single validation/detail entry attached to an error response. */
export interface ApiErrorDetail {
  field?: string;
  issue: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: ApiErrorDetail[];
  };
}

/**
 * Stable, machine-readable error codes used across the API.
 *
 * Keep this list additive: removing or renaming a code is a breaking change
 * for every caller that switches on it.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const DEFAULT_STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Thrown by application/business-logic code and caught by Route Handlers
 * (or a shared handler wrapper) to produce a standardized error response.
 *
 * `message` must always be safe to show to an API caller - do not put
 * internal diagnostic detail — and no personal data — here. Use server-side
 * logging (`@/lib/logging`) for anything that must not leave the server.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: { status?: number; details?: ApiErrorDetail[] },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options?.status ?? DEFAULT_STATUS_BY_CODE[code];
    this.details = options?.details ?? [];
  }
}

/**
 * Builds the standard error body for a given code/message/requestId.
 * Pure function - does not know about HTTP status codes or transport.
 */
export function buildErrorBody(
  code: ApiErrorCode | string,
  message: string,
  requestId: string,
  details: ApiErrorDetail[] = [],
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      requestId,
      details,
    },
  };
}

/**
 * Converts any error (ApiError, or an unexpected/unknown error) into a
 * NextResponse using the standard error shape.
 *
 * Unknown errors are deliberately flattened to a generic INTERNAL_ERROR
 * with a safe, static message - the original error (stack trace, SQL
 * message, etc.) must be logged server-side via `@/lib/logging` instead of
 * being included in the response.
 */
export function toErrorResponse(
  error: unknown,
  requestId: string,
): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    return NextResponse.json(
      buildErrorBody(error.code, error.message, requestId, error.details),
      { status: error.status, headers: { "x-request-id": requestId } },
    );
  }

  // Never leak the internal error's message, stack, or type to the caller.
  return NextResponse.json(
    buildErrorBody(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again or contact support.",
      requestId,
    ),
    { status: 500, headers: { "x-request-id": requestId } },
  );
}
