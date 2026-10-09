const path = require('node:path');
const { readFile, realpath, stat } = require('node:fs/promises');

// This manifest is the public boundary, not the extension or containing directory.
// Add new public pages/assets deliberately; internal files must never be included.
const pages = [
  'index', 'ship', 'rates', 'track', 'history', 'support', 'contact',
  'login', 'register', 'forgot-password', 'reset-password', 'profile',
  'admin', 'privacy', 'terms',
];
const files = new Map([
  ...pages.map(name => [`${name}.html`, 'text/html; charset=utf-8']),
  ['css/style.css', 'text/css; charset=utf-8'],
  ['css/carrier.css', 'text/css; charset=utf-8'],
  ['css/operations.css', 'text/css; charset=utf-8'],
  ['js/app.js', 'text/javascript; charset=utf-8'],
  ['js/workspace.js', 'text/javascript; charset=utf-8'],
  ['assets/swift-logistics-van.png', 'image/png'],
]);
const routes = new Map(pages.map(name => [`/${name}`, `${name}.html`]));
routes.set('/', 'index.html');
const redirects = new Map(pages.map(name => [`/${name}.html`, name === 'index' ? '/' : `/${name}`]));

// Validate the original request target BEFORE WHATWG URL parsing can remove dot
// segments or convert backslashes. Decode once and reject ambiguous encodings.
function requestPath(target) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return null;
  if (/[\x00-\x20\x7f#\\]/.test(target)) return null;
  const rawPath = target.split('?')[0];
  // Encoded separators cannot create new path components after routing.
  if (/%(?:2f|5c)/i.test(rawPath)) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (/[\x00-\x20\x7f%\\:?#]/.test(decoded)) return null;
  if (decoded.includes('//') || decoded.split('/').some(part => part === '.' || part === '..')) return null;
  return decoded;
}

function contained(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function notFound(res, headers = {}) {
  res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end('Not found.');
}

async function servePublic(req, res, root, headers = {}) {
  const pathname = requestPath(req.url);
  if (pathname === null || !['GET', 'HEAD'].includes(req.method)) return notFound(res, headers);
  const redirect = redirects.get(pathname);
  if (redirect) {
    res.writeHead(308, { ...headers, Location: redirect });
    return res.end();
  }
  const relative = routes.get(pathname) || pathname.slice(1);
  const type = files.get(relative);
  if (!type) return notFound(res, headers);
  try {
    const approvedRoot = await realpath(root);
    const expected = path.resolve(approvedRoot, relative);
    if (!contained(approvedRoot, expected)) return notFound(res, headers);
    const actual = await realpath(expected);
    // Containment alone would allow a public symlink to a private file inside
    // the project. Require the exact approved physical file as well.
    if (!contained(approvedRoot, actual) || path.relative(expected, actual) !== '') return notFound(res, headers);
    if (!(await stat(actual)).isFile()) return notFound(res, headers);
    const content = await readFile(actual);
    res.writeHead(200, { ...headers, 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    // Do not return filesystem paths or exception details to the client.
    notFound(res, headers);
  }
}

module.exports = { requestPath, servePublic, notFound };
