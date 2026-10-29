// 网站运行配置
// 部署 CloudBase 后，把 API_BASE 改成绑定到 HTTP 访问服务的自定义域名。
// 注意：必须是 HTTPS，地址末尾带 /api，例如：
//   https://api.yourdomain.com/api
// 本地调试时也可以在浏览器控制台执行：
//   localStorage.setItem('stroke_api_base', 'https://api.yourdomain.com/api')
(function () {
  var override = '';
  try {
    override = localStorage.getItem('stroke_api_base') || '';
  } catch (err) {
    override = '';
  }

  window.STROKE_CONFIG = {
    API_BASE: (override || 'https://significant-donkey-d5cfzd9b35604-1419360854.ap-shanghai.app.tcloudbase.com/api').replace(/\/+$/, ''),
    POLL_INTERVAL_MS: 5000,
    FULL_SYNC_INTERVAL_MS: 60000
  };
})();
