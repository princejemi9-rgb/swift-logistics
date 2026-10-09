const { requestPath, servePublic, notFound } = require('./public-files');
const api = require('./api/index');

module.exports = async (req, res) => {
  const pathname = requestPath(req.url);
  if (pathname === null) return notFound(res);
  if (pathname.startsWith('/api/')) {
    // Implementation file URLs are not API endpoints. The API itself remains
    // responsible for its normal routes; it is never a static-file provider.
    if (/\.js$/i.test(pathname)) return notFound(res);
    return api(req, res);
  }
  return servePublic(req, res, __dirname);
};
