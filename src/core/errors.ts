export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    const env: ErrorEnvelope = { error: { code: this.code, message: this.message } };
    if (this.details !== undefined) env.error.details = this.details;
    return env;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'conflict', message);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'unauthorized', message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'forbidden', message);
  }
}
export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(400, 'bad_request', message);
  }
}
export class InvalidStateError extends AppError {
  constructor(message = 'Invalid state') {
    super(409, 'invalid_state', message);
  }
}
export class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, 'internal_server_error', message);
  }
}
export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Validation failed') {
    super(422, 'validation_error', message, details);
  }
}
