/* A stand-in for the BAU mail server: enough SMTP to accept one message,
   including STARTTLS, so the real client path is exercised. */
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const PORT = Number(process.argv[2] || 2525);
const TMP = process.env.SMTP_TEST_DIR || require('os').tmpdir();
const OUT = process.argv[3] || require('path').join(TMP, 'mail.txt');
const creds = { key: fs.readFileSync(require('path').join(TMP, 'key.pem')), cert: fs.readFileSync(require('path').join(TMP, 'cert.pem')) };

function talk(sock) {
  let inData = false, body = '', authStep = 0;
  sock.setEncoding('utf8');
  sock.on('error', () => {});
  sock.on('data', chunk => {
    if (inData) {
      body += chunk;
      if (/\r\n\.\r\n$/.test(body) || /\r\n\.\r\n/.test(body)) {
        inData = false;
        fs.writeFileSync(OUT, body);
        sock.write('250 2.0.0 Ok: queued\r\n');
      }
      return;
    }
    chunk.split(/\r\n/).filter(Boolean).forEach(line => {
      if (/^EHLO|^HELO/i.test(line)) sock.write('250-fake.bau.edu.lb\r\n250-STARTTLS\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n');
      else if (/^STARTTLS/i.test(line)) {
        sock.write('220 ready to start TLS\r\n');
        const plain = sock;
        plain.removeAllListeners('data');
        const secure = new tls.TLSSocket(plain, { isServer: true, key: creds.key, cert: creds.cert });
        secure.on('secure', () => {});
        talk(secure);
      }
      else if (/^AUTH LOGIN/i.test(line)) { authStep = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (/^MAIL FROM/i.test(line)) sock.write('250 OK\r\n');
      else if (/^RCPT TO/i.test(line)) sock.write('250 OK\r\n');
      else if (/^DATA/i.test(line)) { inData = true; sock.write('354 go ahead\r\n'); }
      else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
      else if (authStep === 1) { authStep = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }       // username seen
      else if (authStep === 2) { authStep = 3; sock.write('235 2.7.0 Authentication successful\r\n'); }
      else sock.write('500 what?\r\n');
    });
  });
}

net.createServer(sock => { sock.write('220 fake.bau.edu.lb ESMTP\r\n'); talk(sock); })
  .listen(PORT, () => console.log('fake smtp on ' + PORT));
