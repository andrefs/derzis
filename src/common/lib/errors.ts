export class WorkerError extends Error {
  errorType: string;

  constructor() {
    super();
    this.errorType = 'unknown_worker_error';
  }

  toString() { '[' + this.constructor.name.toString() + '] ' + this.errorType; }
};

export class NoCapacityError extends WorkerError {
  errorType = 'no_capacity';
  constructor() { super(); }
};

export class RobotsForbiddenError extends WorkerError {
  errorType = 'robots_forbidden';
  constructor() { super(); }
};

export class TimeoutError extends WorkerError {
  timeout: number;
  errorType = 'timeout';
  constructor(timeout: number) {
    super();
    this.timeout = timeout;
  }
};

export class ConnectionResetError extends WorkerError {
  errorType = 'connection_reset';
  constructor() { super(); }
};

export class TooManyRedirectsError extends WorkerError {
  lastUrl: string;
  errorType = 'too_many_redirects';
  constructor(lastUrl: string) {
    super();
    this.lastUrl = lastUrl;
  }
};

export class HttpError extends WorkerError {
  httpStatus: number;
  errorType = 'http';
  constructor(httpStatus: number) {
    super();
    this.httpStatus = httpStatus;
  }
};

export class DomainNotFoundError extends WorkerError {
  errorType = 'host_not_found';
  constructor() { super(); }
};

export class MimeTypeError extends WorkerError {
  mimeType: string;
  httpStatus?: number;
  errorType = 'unsupported_mime_type';

  constructor(mimeType: string, info: {httpStatus?: number} = {}) {
    super();
    this.mimeType = mimeType;
    if (info.httpStatus) {
      this.httpStatus = info.httpStatus;
    }
  };
};

export class ParsingError extends WorkerError {
  mimeType!: string;
  httpStatus!: number;
  errorMessage!: string;
  errorType = 'parsing';

  constructor(message: string,
              {httpStatus, mimeType}: {httpStatus: number, mimeType: string}) {
    super();
    this.errorMessage = message;
    if (httpStatus) {
      this.httpStatus = httpStatus;
    }
    if (mimeType) {
      this.mimeType = mimeType;
    }
  }
};
