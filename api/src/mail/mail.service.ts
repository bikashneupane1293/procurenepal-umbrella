// Outgoing email (Task 12). Uses Brevo's transactional email HTTP API (free tier: 300 emails/day)
// through Node's built-in fetch — no extra package. Configure on Render:
//   BREVO_API_KEY=xkeysib-...   MAIL_FROM_EMAIL=no-reply@procurenepal.com   MAIL_FROM_NAME=ProcureNepal
//   APP_URL=https://app.procurenepal.com
// Until BREVO_API_KEY and MAIL_FROM_EMAIL are set, nothing is sent: messages are logged and the
// screens keep showing the copyable link, exactly as before. Sending never throws — a failed email
// must never block creating a user or an organization. © Cuidado Technology Pvt. Ltd.
import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  toName?: string;
  subject: string;
  /** plain paragraphs; a line starting with "http" becomes a button */
  lines: string[];
}

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);

  enabled(): boolean {
    return !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL);
  }

  /** Absolute link into the web app, e.g. url('/join?org=PN-7K3Q9M'). */
  url(path: string): string {
    return (process.env.APP_URL || 'https://app.procurenepal.com').replace(/\/$/, '') + path;
  }

  /** true when the provider accepted the message; false when not configured or it failed. */
  async send(m: MailMessage): Promise<boolean> {
    if (!this.enabled()) {
      this.log.log(`[email not configured] would send "${m.subject}" to ${m.to}`);
      return false;
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY!, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: process.env.MAIL_FROM_EMAIL, name: process.env.MAIL_FROM_NAME || 'ProcureNepal' },
          to: [{ email: m.to, ...(m.toName ? { name: m.toName } : {}) }],
          subject: m.subject,
          textContent: m.lines.join('\n\n'),
          htmlContent: this.html(m),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.log.warn(`Email to ${m.to} rejected by Brevo: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.log.warn(`Email to ${m.to} failed: ${e?.message ?? e}`);
      return false;
    }
  }

  private html(m: MailMessage): string {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const body = m.lines
      .map((l) =>
        /^https?:\/\//.test(l)
          ? `<p style="margin:22px 0"><a href="${esc(l)}" style="background:#d4a017;color:#0a1f3d;padding:12px 22px;border-radius:8px;font-weight:700;text-decoration:none">Open ProcureNepal</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">${esc(l)}</p>`
          : `<p style="margin:0 0 12px">${esc(l)}</p>`,
      )
      .join('');
    return `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:560px;margin:auto"><div style="background:#0a1f3d;color:#fff;padding:14px 20px;font-weight:800;font-size:18px"><span style="color:#d4a017">Procure</span>Nepal</div><div style="padding:22px 20px;border:1px solid #e5e8ec;border-top:0">${body}<p style="font-size:12px;color:#9ca3af;margin-top:24px">© Cuidado Technology Pvt. Ltd.</p></div></div>`;
  }
}
