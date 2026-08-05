// ============================================================================
// OWNER  : Gauransh
// PURPOSE: Custom application error.
// ============================================================================

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    message: string,
    statusCode = 400,
    code = "BAD_REQUEST"
  ) {
    super(message);

    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}