

class WorkerError extends Error {
  constructor(){
    super();
    this.errorType = 'unknown_worker_error';
  }

  toString(){
   '['+this.constructor.name.toString()+'] ' + this.errorType;
  }
};

class NoCapacityError extends WorkerError {
  constructor(){
    super();
    this.errorType = 'no_capacity';
  }
};

class RobotsForbiddenError extends WorkerError {
  constructor(info){
    super();
    this.errorType = 'robots_forbidden';
  }
};

class TimeoutError extends WorkerError {
  constructor(timeout){
    super();
    this.timeout = timeout;
    this.errorType = 'timeout';
  }
};

class ConnectionResetError extends WorkerError {
  constructor(timeout){
    super();
    this.errorType = 'connection_reset';
  }
};

class TooManyRedirectsError extends WorkerError {
  constructor(lastUrl){
    super();
    this.lastUrl = lastUrl;
    this.errorType = 'too_many_redirects';
  }
};

class HttpError extends WorkerError {
  constructor(httpStatus, info){
    super();
    this.errorType = 'http';
    this.httpStatus = httpStatus;
  }
};

class HostNotFoundError extends WorkerError {
  constructor(info){
    super();
    this.errorType = 'host_not_found';
  }
};

class MimeTypeError extends WorkerError {
  constructor(mimeType, info){
    super();
    this.errorType = 'unsupported_mime_type';
    this.mimeType = mimeType;
    if(info && info.httpStatus){ this.httpStatus = info.httpStatus; }
  };
};

class ParsingError extends WorkerError {
  constructor(message, info){
    super();
    this.errorType = 'parsing';
    this.errorMessage = message;
    if(info && info.httpStatus){ this.httpStatus = info.httpStatus; }
    if(info && info.mimeType){ this.mimeType = info.mimeType; }
  }
};

module.exports = {
  WorkerError,
  TimeoutError,
  ConnectionResetError,
  NoCapacityError,
  RobotsForbiddenError,
  HttpError,
  MimeTypeError,
  ParsingError,
  HostNotFoundError
};

