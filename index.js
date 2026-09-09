const { readFile } = require('node:fs/promises');
const path = require('node:path');

const api = require('./api/index');

module.exports = async (req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);

  try {
    const page = await readFile(path.join(__dirname, 'index.html'));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page);
  } catch {
    res.statusCode = 500;
    res.end('Unable to load Swift Logistics.');
  }
};
