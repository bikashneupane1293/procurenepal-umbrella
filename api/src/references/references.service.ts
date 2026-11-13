import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Watches a few public pages (PPMO, Nepal Rastra Bank) for changes — for Bolpatra
 * context, never for procurement rules. This only tells you a page changed; a
 * person still reads it and decides what, if anything, to do. © Cuidado Technology Pvt. Ltd.
 */
export interface RefSource { key: string; label: string; url: string; }

export const REFERENCE_SOURCES: RefSource[] = [
  { key: 'ppmo', label: 'PPMO — Public Procurement Monitoring Office', url: 'https://ppmo.gov.np/' },
  { key: 'nrb_home', label: 'Nepal Rastra Bank', url: 'https://www.nrb.org.np/' },
  { key: 'nrb_macro', label: 'NRB — Current Macroeconomic Situation', url: 'https://www.nrb.org.np/category/current-macroeconomic-situation/?department=red' },
];

function stripHtml(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = noScript.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

@Injectable()
export class ReferencesService {
  constructor(private prisma: PrismaService) {}

  async checkOne(key: string) {
    const src = REFERENCE_SOURCES.find((s) => s.key === key);
    if (!src) return null;
    let excerpt = '', hash = '', error: string | null = null;
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(15000) });
      const html = await res.text();
      const text = stripHtml(html);
      excerpt = text.slice(0, 1500);
      hash = createHash('sha256').update(text).digest('hex');
    } catch (e: any) {
      error = e?.message ?? 'Could not reach the page';
    }
    const prev = await this.prisma.externalRef.findUnique({ where: { key } });
    const changed = !error && !!prev?.contentHash && prev.contentHash !== hash;
    const row = await this.prisma.externalRef.upsert({
      where: { key },
      create: { key, label: src.label, url: src.url, excerpt, contentHash: hash || null, changed: false, error, fetchedAt: new Date() },
      update: error
        ? { error, fetchedAt: new Date() }
        : { label: src.label, url: src.url, excerpt, contentHash: hash, changed, error: null, fetchedAt: new Date() },
    });
    return row;
  }

  async checkAll() {
    const out = [];
    for (const s of REFERENCE_SOURCES) out.push(await this.checkOne(s.key));
    return out;
  }

  async list() {
    const rows = await this.prisma.externalRef.findMany();
    // always return all three sources, even before the first check
    return REFERENCE_SOURCES.map((s) => rows.find((r) => r.key === s.key) ?? { key: s.key, label: s.label, url: s.url, fetchedAt: null, changed: false, excerpt: null, error: null });
  }
}
