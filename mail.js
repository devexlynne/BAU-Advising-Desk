/*
 * Outgoing mail: reset links, suggestions to IDEAS_TO, and messages advisors
 * send from the portal (see server.js).
 *
 * Config: MAIL_FROM (sender, e.g. "Online Advising System <advising@example.edu>")
 * plus one transport:
 *   SMTP_URL   smtp://user:pass@smtp.bau.edu.lb:587  (STARTTLS)
 *              smtps://user:pass@host:465            (TLS from the start)
 *   MAIL_API_URL + MAIL_API_KEY   JSON API: Resend, Postmark, or Brevo
 *              (https://api.brevo.com/v3/smtp/email), for hosts that block
 *              outgoing SMTP.
 *
 * Without MAIL_FROM and a transport nothing is sent and the caller gets an error.
 *
 * An optional HTML version goes along with the plain text (clickable button
 * for activation and reset links); mail apps pick whichever they show.
 *
 * No deps, just net/tls/https.
 */
const net = require('net');
const tls = require('tls');
const https = require('https');
const { URL } = require('url');

const FROM = process.env.MAIL_FROM || '';
const SMTP_URL = process.env.SMTP_URL || '';
const MAIL_API_URL = process.env.MAIL_API_URL || '';
const MAIL_API_KEY = process.env.MAIL_API_KEY || '';

// a sender address is required: no default that would impersonate the university
const configured = () => !!(FROM && (SMTP_URL || (MAIL_API_URL && MAIL_API_KEY)));

// ---- minimal SMTP client --------------------------------------------------
function smtpSend(to, subject, text, replyTo, html) {
  return new Promise((resolve, reject) => {
    const u = new URL(SMTP_URL);
    const implicitTls = u.protocol === 'smtps:';
    const port = Number(u.port || (implicitTls ? 465 : 587));
    const host = u.hostname;
    const user = decodeURIComponent(u.username || '');
    const pass = decodeURIComponent(u.password || '');

    // The SMTP exchange as a list of steps: reply code we expect, then what we send.
    const plan = [{ expect: 220, send: 'EHLO advising-desk' }];
    if (!implicitTls) {
      plan.push({ expect: 250, send: 'STARTTLS' });
      plan.push({ expect: 220, upgrade: true, send: 'EHLO advising-desk' });
    }
    if (user) {
      plan.push({ expect: 250, send: 'AUTH LOGIN' });
      plan.push({ expect: 334, send: Buffer.from(user).toString('base64') });
      plan.push({ expect: 334, send: Buffer.from(pass).toString('base64') });
      plan.push({ expect: 235, send: 'MAIL FROM:<' + addressOf(FROM) + '>' });
    } else {
      plan.push({ expect: 250, send: 'MAIL FROM:<' + addressOf(FROM) + '>' });
    }
    plan.push({ expect: 250, send: 'RCPT TO:<' + to + '>' });
    plan.push({ expect: 250, send: 'DATA' });
    plan.push({ expect: 354, send: message(to, subject, text, replyTo, html) + '\r\n.' });
    plan.push({ expect: 250, send: 'QUIT' });
    plan.push({ expect: 221, done: true });

    let socket = implicitTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buffer = '', step = 0, settled = false;

    const timer = setTimeout(() => fail(new Error('the mail server did not answer')), 20000);
    function fail(e) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { socket.destroy(); } catch (x) {}
      reject(e);
    }
    function finish() {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { socket.end(); } catch (x) {}
      resolve(true);
    }
    const write = line => { try { socket.write(line + '\r\n'); } catch (e) { fail(e); } };

    function onReply(code, line) {
      const st = plan[step];
      if (!st) return;
      if (code !== st.expect) return fail(new Error('mail server said: ' + line));
      step++;
      if (st.done) return finish();
      if (st.upgrade) {
        // STARTTLS accepted: wrap the same socket in TLS and carry on
        const plain = socket;
        plain.removeAllListeners('data');
        socket = tls.connect({ socket: plain, servername: host }, () => write(st.send));
        socket.on('data', onData);
        socket.on('error', fail);
        return;
      }
      if (st.send !== undefined) write(st.send);
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (/^\d{3}-/.test(line)) continue;      // multi-line reply (250-...), wait for the last line
        if (!/^\d{3}/.test(line)) continue;
        onReply(Number(line.slice(0, 3)), line);
        if (settled) return;
      }
    }

    socket.on('data', onData);
    socket.on('error', fail);
  });
}

const addressOf = from => {
  const m = /<([^>]+)>/.exec(from);
  return m ? m[1] : from;
};

// dot-stuffing: a line starting with "." would otherwise end DATA early
// (including the very first line), and bare CR or LF become CRLF
const stuff = s => ('\n' + s).replace(/\r\n|\r|\n/g, '\r\n').replace(/\r\n\./g, '\r\n..').slice(2);

function message(to, subject, text, replyTo, html) {
  const head = [
    'From: ' + FROM,
    'To: <' + to + '>',
    // replies go to the advisor who sent it, not no-reply
    ...(replyTo ? ['Reply-To: <' + replyTo + '>'] : []),
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Date: ' + new Date().toUTCString()
  ];
  if (!html) return head.concat(['Content-Type: text/plain; charset=utf-8', '', stuff(text)]).join('\r\n');
  // plain text and HTML in one message; the mail app shows the HTML one
  const b = 'adv-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  return head.concat([
    'Content-Type: multipart/alternative; boundary="' + b + '"', '',
    '--' + b, 'Content-Type: text/plain; charset=utf-8', '', stuff(text), '',
    '--' + b, 'Content-Type: text/html; charset=utf-8', '', stuff(html), '',
    '--' + b + '--'
  ]).join('\r\n');
}

// ---- or a JSON mail API -----------------------------------------------------
// Fields are sent twice (Resend lowercase, Postmark PascalCase) so one body
// works for either.
function apiSend(to, subject, text, replyTo, html) {
  return new Promise((resolve, reject) => {
    const u = new URL(MAIL_API_URL);
    // Brevo (free, works with one verified sender address and no domain setup)
    const brevo = /(^|\.)(brevo|sendinblue)\.com$/.test(u.hostname);
    const fromName = (/^\s*"?([^"<]*?)"?\s*</.exec(FROM) || [])[1] || 'Online Advising System';
    const body = brevo ? JSON.stringify({
      sender: { name: fromName, email: addressOf(FROM) },
      to: [{ email: to }],
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      subject, textContent: text, ...(html ? { htmlContent: html } : {})
    }) : JSON.stringify({
      from: FROM, From: FROM,
      to: [to], To: to,
      ...(replyTo ? { reply_to: replyTo, ReplyTo: replyTo } : {}),
      subject, Subject: subject,
      text, TextBody: text, ...(html ? { html, HtmlBody: html } : {})
    });
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(brevo ? { 'api-key': MAIL_API_KEY, accept: 'application/json' }
          : { 'authorization': 'Bearer ' + MAIL_API_KEY, 'x-postmark-server-token': MAIL_API_KEY })
      }
    }, res => {
      let out = '';
      res.on('data', c => { out += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error('mail service said ' + res.statusCode + ': ' + out.slice(0, 200)));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('the mail service timed out')));
    req.end(body);
  });
}

// one line, no control characters: stops header injection and SMTP command smuggling
const oneLine = s => String(s == null ? '' : s).replace(/[\r\n\t\0]+/g, ' ').trim();
async function send(to, subject, text, replyTo, html) {
  if (!configured()) throw new Error('no mail is set up on this server');
  to = oneLine(to); subject = oneLine(subject).slice(0, 300); replyTo = replyTo ? oneLine(replyTo) : replyTo;
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(to)) throw new Error('bad recipient address');
  if (replyTo && !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(replyTo)) replyTo = undefined;
  text = String(text == null ? '' : text);
  html = html ? String(html) : '';
  if (SMTP_URL) return await smtpSend(to, subject, text, replyTo, html);
  return await apiSend(to, subject, text, replyTo, html);
}

module.exports = { send, configured };
