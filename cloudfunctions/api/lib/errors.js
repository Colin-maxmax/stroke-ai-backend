'use strict';

class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const errors = {
  invalid: (message) => new ApiError('INVALID_INPUT', message, 400),
  unauthorized: (message = '请先登录') => new ApiError('UNAUTHORIZED', message, 401),
  forbidden: (message = '没有权限执行该操作') => new ApiError('FORBIDDEN', message, 403),
  notFound: (message = '记录不存在') => new ApiError('NOT_FOUND', message, 404),
  conflict: (message) => new ApiError('CONFLICT', message, 409),
  tooMany: (message = '尝试次数过多，请稍后再试') => new ApiError('RATE_LIMITED', message, 429),
  internal: (message = '服务暂时不可用') => new ApiError('INTERNAL_ERROR', message, 500),
};

module.exports = { ApiError, errors };
