// WhatsApp messages through Meta's WhatsApp Cloud API (Task 16) — no extra package.
// Business-started messages must use a template approved in Meta's WhatsApp Manager:
//   name  procurenepal_daily_alerts (or WHATSAPP_TEMPLATE), language en (or WHATSAPP_LANG),
//   body  "ProcureNepal — {{1}} Open https://app.procurenepal.com/dashboard"
// Switched on by WHATSAPP_TOKEN + WHATSAPP_PHONE_ID. Until then nothing is sent; never throws.
import { Injectable, Logger } from '@nestjs/common';

/** "98XXXXXXXX" / "+977-98…" → "97798XXXXXXXX" (digits with country code), or null if not a phone number. */
export function normalizePhone(v: any): string | null {
  let d = String(v ?? '').replace(/[^\d]/g, '');
  if (/^9[78]\d{8}$/.test(d)) d = '977' + d; // Nepali mobile without country code
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** Template text parameters may not contain new lines, tabs or more than 4 spaces in a row. */
export const oneLine = (s: string, max = 900) => { const t = s.replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };

@Injectable()
export class WhatsAppService {
  private log = new Logger('WhatsApp');
  enabled() { return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID); }

  async sendAlerts(to: string, text: string): Promise<boolean> {
    if (!this.enabled()) { this.log.log(`(WhatsApp not configured) would send to ${to}: ${text.slice(0, 80)}…`); return false; }
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to, type: 'template',
          template: { name: process.env.WHATSAPP_TEMPLATE || 'procurenepal_daily_alerts', language: { code: process.env.WHATSAPP_LANG || 'en' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: oneLine(text) }] }] },
        }),
      });
      if (!r.ok) { this.log.warn(`WhatsApp to ${to} failed: ${r.status} ${(await r.text()).slice(0, 200)}`); return false; }
      return true;
    } catch (e: any) {
      this.log.warn(`WhatsApp to ${to} failed: ${e?.message}`);
      return false;
    }
  }
}
