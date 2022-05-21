

export class WorkerError extends Error {
  errorType: string;

  constructor(){
    super();
    this.errorType = 'unknown_worker_error';
  }

  toString(){
   '['+this.constructor.name.toString()+'] ' + this.errorType;
  }
};

export class NoCapacityError extends WorkerError {
  constructor(){
    super();
    this.errorType = 'no_capacity';
  }
};

export class RobotsForbiddenError extends WorkerError {
  constructor(){
    super();
    this.errorType = 'robots_forbidden';
  }
};

export class TimeoutError extends WorkerError {
  timeout: number;

  constructor(timeout: number){
    super();
    this.timeout = timeout;
    this.errorType = 'timeout';
  }
};

export class ConnectionResetError extends WorkerError {
  constructor(){
    super();
    this.errorType = 'connection_reset';
  }
};

export class TooManyRedirectsError extends WorkerError {
  lastUrl: string;

  constructor(lastUrl: string){
    super();
    this.lastUrl = lastUrl;
    this.errorType = 'too_many_redirects';
  }
};

export class HttpError extends WorkerError {
  httpStatus: number;

  constructor(httpStatus: number){
    super();
    this.errorType = 'http';
    this.httpStatus = httpStatus;
  }
};

export class DomainNotFoundError extends WorkerError {
  constructor(){
    super();
    this.errorType = 'host_not_found';
  }
};

export class MimeTypeError extends WorkerError {
  mimeType: string;
  httpStatus: number;

  constructor(mimeType: string, {httpStatus}){
    super();
    this.errorType = 'unsupported_mime_type';
    this.mimeType = mimeType;
    if(httpStatus){ this.httpStatus = httpStatus; }
  };
};

export class ParsingError extends WorkerError {
  mimeType: string;
  httpStatus: number;
  errorMessage: string;

  constructor(message: string, {httpStatus, mimeType}){
    super();
    this.errorType = 'parsing';
    this.errorMessage = message;
    if(httpStatus){ this.httpStatus = httpStatus; }
    if(mimeType){ this.mimeType = mimeType; }
  }
};

