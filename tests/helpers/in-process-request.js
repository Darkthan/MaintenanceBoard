// Exercise the complete Express middleware stack without opening a TCP socket.
const { IncomingMessage, ServerResponse } = require('http');
const { Duplex } = require('stream');

module.exports = function request(app) {
  const build = (method, url) => {
    const headers = { host: 'localhost' }, fields = [], files = [];
    let body;
    const client = {
      set(key, value) { headers[key.toLowerCase()] = value; return client; },
      query(values) { url += (url.includes('?') ? '&' : '?') + new URLSearchParams(values); return client; },
      field(key, value) { fields.push([key, value]); return client; },
      attach(key, buffer, options) { files.push([key, buffer, options]); return client; },
      send(value) { body = value; return client; },
      then(resolve, reject) {
        return new Promise((done, fail) => {
          let payload = Buffer.alloc(0);
          if (fields.length || files.length) {
            const boundary = 'mb-test-boundary-123';
            headers['content-type'] = 'multipart/form-data; boundary=' + boundary;
            const chunks = [];
            for (const [key, value] of fields) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
            for (const [key, buffer, options] of files) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${options.filename}"\r\nContent-Type: ${options.contentType}\r\n\r\n`), buffer, Buffer.from('\r\n'));
            chunks.push(Buffer.from(`--${boundary}--\r\n`));
            payload = Buffer.concat(chunks);
          } else if (body !== undefined) {
            headers['content-type'] = 'application/json';
            payload = Buffer.from(JSON.stringify(body));
          }
          headers['content-length'] = String(payload.length);
          const socket = new Duplex({ read() {}, write(_chunk, _encoding, cb) { cb(); } });
          const req = new IncomingMessage(socket);
          Object.assign(req, { method, url, headers, complete: true, httpVersion: '1.1', httpVersionMajor: 1, httpVersionMinor: 1 });
          const res = new ServerResponse(req);
          res.assignSocket(socket);
          const chunks = [];
          const originalWrite = res.write.bind(res), originalEnd = res.end.bind(res);
          res.write = (chunk, ...args) => { if (chunk) chunks.push(Buffer.from(chunk)); return originalWrite(chunk, ...args); };
          res.end = (chunk, ...args) => { if (chunk) chunks.push(Buffer.from(chunk)); return originalEnd(chunk, ...args); };
          res.on('error', fail);
          res.on('finish', () => {
            const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
            let parsed = bytes;
            if (String(res.getHeader('content-type')).includes('application/json')) {
              try { parsed = JSON.parse(text); } catch (err) { fail(err); return; }
            }
            done({ status: res.statusCode, body: parsed, text, headers: res.getHeaders() });
            socket.destroy();
          });
          app.handle(req, res);
          req.push(payload);
          req.push(null);
        }).then(resolve, reject);
      }
    };
    return client;
  };
  return Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(method => [method, url => build(method.toUpperCase(), url)]));
};
