type ErrorType =
  | 'no_capacity'
  | 'already_being_done'
  | 'robots_forbidden'
  | 'request_timeout'
  | 'job_timeout'
  | 'connection_reset'
  | 'too_many_redirects'
  | 'http'
  | 'host_not_found'
  | 'unsupported_mime_type'
  | 'axios_error'
  | 'parsing'
  | 'unknown_worker_error';
export class WorkerError extends Error {
  errorType: ErrorType = 'unknown_worker_error';
  name = 'Unknown Worker Error';

  constructor() {
    super();
  }

  toString() { return '[' + this.constructor.name.toString() + '] ' + this.errorType; }
};

export class NoCapacityError extends WorkerError {
  errorType = 'no_capacity' as const;
  name = 'No Capacity Error';
  constructor() { super(); }
};

export class AlreadyBeingDone extends WorkerError {
  errorType = 'already_being_done' as const;
  name = 'Already Being Done' as const;
  constructor() { super(); }
};

export class RobotsForbiddenError extends WorkerError {
  errorType = 'robots_forbidden' as const;
  name = 'Robots Forbidden Error';
  constructor() { super(); }
};

export class RequestTimeoutError extends WorkerError {
  timeout: number;
  errorType = 'request_timeout' as const;
  name = 'Request Timeout Error';
  constructor(timeout: number) {
    super();
    this.timeout = timeout;
  }
};

export class JobTimeoutError extends WorkerError {
  errorType = 'job_timeout' as const;
  name = 'Job Timeout Error';

  constructor() { super(); }
};

export class ConnectionResetError extends WorkerError {
  errorType = 'connection_reset' as const;
  name = 'Connection Reset Error';
  constructor() { super(); }
};

export class TooManyRedirectsError extends WorkerError {
  lastUrl: string;
  errorType = 'too_many_redirects' as const;
  name = 'Too Many Redirect Error';

  constructor(lastUrl: string) {
    super();
    this.lastUrl = lastUrl;
  }
};

export class HttpError extends WorkerError {
  httpStatus: number;
  errorType = 'http' as const;
  name = 'HTTP Error';
  constructor(httpStatus: number) {
    super();
    this.httpStatus = httpStatus;
  }
};

export class DomainNotFoundError extends WorkerError {
  errorType = 'host_not_found' as const;
  name = 'Host Not Found Error';
  constructor() { super(); }
};

export class MimeTypeError extends WorkerError {
  mimeType: string;
  httpStatus?: number;
  errorType = 'unsupported_mime_type' as const;
  name = 'Unsupported Mime Type Error';

  constructor(mimeType: string, info: { httpStatus?: number } = {}) {
    super();
    this.mimeType = this.message = mimeType;
    if (info.httpStatus) {
      this.httpStatus = info.httpStatus;
    }
  };
};

export class AxiosError extends WorkerError {
  name = 'Axios Error';
  errorType = 'axios_error' as const;

  constructor(axiosError: any) {
    super();
    this.message = axiosError.message;
  }
};

export class ParsingError extends WorkerError {
  mimeType!: string;
  httpStatus!: number;
  errorType = 'parsing' as const;
  name = 'Parsing Error';

  constructor(message: string,
    { httpStatus, mimeType }: { httpStatus: number, mimeType: string }) {
    super();
    this.message = message;
    if (httpStatus) {
      this.httpStatus = httpStatus;
    }
    if (mimeType) {
      this.mimeType = mimeType;
    }
  }
};
