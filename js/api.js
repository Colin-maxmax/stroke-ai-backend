// 云端 API 封装：所有账号与评估数据都通过 CloudBase 云函数读写
(function () {
  var CONFIG = window.STROKE_CONFIG || {};
  var TOKEN_KEY = 'stroke_token';
  var USER_KEY = 'currentUser';
  var TIMEOUT_MS = 15000;

  function ApiError(code, message, status) {
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.message = message || '请求失败';
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function getToken() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    } catch (err) {
      return '';
    }
  }

  function setToken(token) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }

  function setUser(user) {
    if (user) {
      sessionStorage.setItem(USER_KEY, JSON.stringify({
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        source: user.source,
        id: user.id,
        loginTime: new Date().toISOString()
      }));
    } else {
      sessionStorage.removeItem(USER_KEY);
    }
  }

  function isConfigured() {
    return !!CONFIG.API_BASE && CONFIG.API_BASE.indexOf('example.com') === -1;
  }

  async function request(action, payload, options) {
    if (!isConfigured()) {
      throw new ApiError(
        'NOT_CONFIGURED',
        '后端地址尚未配置，请先完成 CloudBase 部署并修改 js/config.js',
        0
      );
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, (options && options.timeout) || TIMEOUT_MS);
    var token = getToken();

    var response;
    try {
      response = await fetch(CONFIG.API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, token: token, payload: payload || {} }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new ApiError('TIMEOUT', '请求超时，请检查网络后重试', 0);
      }
      throw new ApiError('NETWORK', '无法连接服务器，请检查网络或后端地址', 0);
    }
    clearTimeout(timer);

    var data = null;
    try {
      data = await response.json();
    } catch (err) {
      throw new ApiError('BAD_RESPONSE', '服务器返回格式异常', response.status);
    }

    if (!response.ok || !data || data.ok !== true) {
      var error = (data && data.error) || {};
      var apiError = new ApiError(
        error.code || 'HTTP_' + response.status,
        error.message || '请求失败',
        response.status
      );

      // 登录状态下 token 失效：清理会话并通知页面回到登录
      if (token && (apiError.code === 'UNAUTHORIZED' || apiError.code === 'TOKEN_EXPIRED')) {
        clearSession();
        try {
          window.dispatchEvent(new CustomEvent('stroke:unauthorized', { detail: apiError }));
        } catch (ignored) {
          // ignore
        }
      }
      throw apiError;
    }

    return data.data;
  }

  window.StrokeApiError = ApiError;
  window.StrokeAPI = {
    request: request,
    isConfigured: isConfigured,
    getToken: getToken,
    setToken: setToken,
    clearSession: clearSession,
    getUser: getUser,
    setUser: setUser,
    register: function (input) { return request('register', input); },
    login: function (input) { return request('login', input); },
    wxLogin: function (input) { return request('wxLogin', input); },
    me: function () { return request('me'); },
    createAssessment: function (input) { return request('createAssessment', input); },
    listAssessments: function (input) { return request('listAssessments', input || {}); },
    deleteAssessment: function (input) { return request('deleteAssessment', input); },
    clearAssessments: function (input) { return request('clearAssessments', input || {}); },
    importAssessments: function (input) { return request('importAssessments', input); }
  };
})();
