const { readFile } = require('node:fs/promises');
const path = require('node:path');

const api = require('./api/index');
const root = __dirname;
const pages = new Set(['index', 'ship', 'rates', 'track', 'history', 'support', 'contact', 'login', 'register', 'admin', 'privacy', 'terms']);
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

module.exports = async (req, res) => {
  const url = new URL(req.url, 'https://swift-logistics.local');
  if (url.pathname.startsWith('/api/')) return api(req, res);

  const requested = url.pathname.replace(/^\//, '');
  const oldPage = requested.endsWith('.html') ? requested.slice(0, -5) : null;
  if (oldPage && pages.has(oldPage)) {
    res.statusCode = 308;
    res.setHeader('Location', oldPage === 'index' ? '/' : `/${oldPage}`);
    return res.end();
  }

  const relative = url.pathname === '/' ? 'index.html' : (!path.extname(requested) && pages.has(requested) ? `${requested}.html` : requested);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !types[path.extname(file)]) {
    res.statusCode = 404;
    return res.end('Not found.');
  }

  try {
    const content = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', types[path.extname(file)]);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(content);
  } catch {
    res.statusCode = 404;
    res.end('Not found.');
  }
};
