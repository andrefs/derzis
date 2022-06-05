export class WorkerError extends Error {
  errorType: string;
  name = 'Unknown Worker Error';

  constructor() {
    super();
    this.errorType = 'unknown_worker_error';
  }

  toString() { return '[' + this.constructor.name.toString() + '] ' + this.errorType; }
};

export class NoCapacityError extends WorkerError {
  errorType = 'no_capacity';
  name = 'No Capacity Error';
  constructor() { super(); }
};

export class RobotsForbiddenError extends WorkerError {
  errorType = 'robots_forbidden';
  name = 'Robots Forbidden Error';
  constructor() { super(); }
};

export class RequestTimeoutError extends WorkerError {
  timeout: number;
  errorType = 'request_timeout';
  name = 'Request Timeout Error';
  constructor(timeout: number) {
    super();
    this.timeout = timeout;
  }
};

export class JobTimeoutError extends WorkerError {
  errorType = 'job_timeout';
  name = 'Job Timeout Error';

  constructor() { super(); }
};

export class ConnectionResetError extends WorkerError {
  errorType = 'connection_reset';
  name = 'Connection Reset Error';
  constructor() { super(); }
};

export class TooManyRedirectsError extends WorkerError {
  lastUrl: string;
  errorType = 'too_many_redirects';
  name = 'Too Many Redirect Error';

  constructor(lastUrl: string) {
    super();
    this.lastUrl = lastUrl;
  }
};

export class HttpError extends WorkerError {
  httpStatus: number;
  errorType = 'http';
  name = 'HTTP Error';
  constructor(httpStatus: number) {
    super();
    this.httpStatus = httpStatus;
  }
};

export class DomainNotFoundError extends WorkerError {
  errorType = 'host_not_found';
  name = 'Host Not Found Error';
  constructor() { super(); }
};

export class MimeTypeError extends WorkerError {
  mimeType: string;
  httpStatus?: number;
  errorType = 'unsupported_mime_type';
  name = 'Unsupported Mime Type Error';

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
  name = 'Parsing Error';

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
