// Every error from the backend has the same shape (API contract, section 1):
// { error: { code, message, details } }
export class ApiError extends Error {
  constructor(code, message, details = [], status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
    this.status = status;
  }
}
