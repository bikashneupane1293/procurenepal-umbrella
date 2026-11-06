import { Component, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { FoundActivity, Suggestions } from '../core/pdf-parse';
import { showBoth } from '../core/nepali-date';

const loadPdf = () => Promise.all([import('../core/pdf-reader'), import('../core/pdf-parse')]);

export interface PdfApply { fields: Record<string, any>; activities: FoundActivity[]; fileName: string; }

const LABELS: Record<string, string> = {
  ifbNumber: 'IFB / Bid No.', projectTitle: 'Project title', procuringEntity: 'Procuring entity', projectType: 'Project type',
  boqAmount: 'Cost estimate', contractPeriodMonths: 'Contract period (months)', deadlineDate: 'Bid deadline',
  publicationDate: 'Publication date', reqTurnover: 'Required turnover', reqBidCapacity: 'Required bid capacity',
  reqSimilarValue: 'Similar contract value', reqSimilarCount: 'Number of similar contracts',
  certificateId: 'Certificate / Contract No.', projectName: 'Project name', employerName: 'Employer',
  contractAmount: 'Contract amount', finalAmount: 'Final amount', priceAdjustment: 'Price adjustment',
  startDate: 'Start date', completionDate: 'Completion date', fiscalYear: 'Fiscal year', jvShare: 'JV share %',
  completionStatus: 'Completion status',
};
const MONEY = new Set(['boqAmount', 'reqTurnover', 'reqBidCapacity', 'reqSimilarValue', 'contractAmount', 'finalAmount', 'priceAdjustment']);
const DATES = new Set(['deadlineDate', 'publicationDate', 'startDate', 'completionDate']);

/**
 * "Read PDF" button + review panel. Reads a tender notice or certificate PDF in the browser,
 * shows what was found (with the line it came from), and fills the form with the ticked values.
 */
@Component({
  selector: 'app-pdf-fill',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="pdf-bar">
      <button type="button" class="btn light" (click)="file.click()" [disabled]="busy()">{{ busy() ? 'Reading PDF…' : '📄 Read from PDF' }}</button>
      <span class="help">{{ kind() === 'tender' ? 'Choose the IFB / bid notice PDF' : 'Choose the experience / completion certificate PDF' }} — the form fills itself, you check and save. The PDF stays on your computer.</span>
      <input #file type="file" accept="application/pdf,.pdf" hidden (change)="onFile($event)" />
    </div>
    @if (error()) { <div class="msg error">{{ error() }}</div> }
    @if (found(); as f) {
      <div class="review">
        <strong>Found in {{ fileName() }}</strong> — tick what to use, then click <em>Fill the form</em>.
        <div class="table-wrap">
          <table>
            <thead><tr><th></th><th>Field</th><th>Value found</th><th>From this line in the PDF</th></tr></thead>
            <tbody>
              @for (k of keys(); track k) {
                <tr>
                  <td><input type="checkbox" [checked]="picked[k]" (change)="picked[k] = !picked[k]" /></td>
                  <td>{{ label(k) }}</td>
                  <td><strong>{{ show(k, f.fields[k].value) }}</strong></td>
                  <td class="src">{{ f.fields[k].line }}</td>
                </tr>
              }
              @for (a of f.activities; track $index; let i = $index) {
                <tr>
                  <td><input type="checkbox" [checked]="pickedAct[i]" (change)="pickedAct[i] = !pickedAct[i]" /></td>
                  <td>Key activity</td>
                  <td><strong>{{ a.name }} — {{ a.quantity | number: '1.0-2' }} {{ a.unit }}</strong></td>
                  <td class="src">{{ a.line }}</td>
                </tr>
              }
              @if (!keys().length && !f.activities.length) {
                <tr><td colspan="4" class="empty">Nothing recognised. Type the values from the PDF.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="actions">
          <button type="button" class="btn gold" (click)="apply()">✔ Fill the form</button>
          <button type="button" class="btn light" (click)="found.set(null)">Cancel</button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; margin-bottom: 14px; }
    .pdf-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .btn { border: 0; padding: 9px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }
    .btn.light { background: #e8eef6; color: #0a1f3d; }
    .btn.gold { background: #d4a017; color: #0a1f3d; }
    .btn:disabled { opacity: .6; cursor: wait; }
    .help { font-size: 11px; color: #9ca3af; }
    .msg.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 8px; margin-top: 10px; font-size: 13px; }
    .review { margin-top: 12px; border: 1px solid #f5d98a; background: #fffbeb; border-radius: 10px; padding: 12px 14px; font-size: 13px; }
    .table-wrap { overflow-x: auto; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; }
    th { text-align: left; padding: 6px 8px; background: #e8eef6; color: #0a1f3d; }
    td { padding: 6px 8px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
    td.src { color: #6b7280; font-size: 12px; max-width: 420px; }
    .empty { text-align: center; color: #9ca3af; padding: 16px; }
    .actions { display: flex; gap: 8px; margin-top: 10px; }
  `],
})
export class PdfFill {
  kind = input<'tender' | 'certificate'>('tender');
  filled = output<PdfApply>();

  busy = signal(false);
  error = signal('');
  found = signal<{ fields: Suggestions; activities: FoundActivity[] } | null>(null);
  fileName = signal('');
  keys = signal<string[]>([]);
  picked: Record<string, boolean> = {};
  pickedAct: boolean[] = [];

  label(k: string) { return LABELS[k] ?? k; }
  show(k: string, v: any) {
    if (MONEY.has(k)) return 'Rs ' + Number(v).toLocaleString('en-IN');
    if (DATES.has(k)) return showBoth(v);
    return String(v);
  }

  async onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.error.set('');
    this.found.set(null);
    if (file.size > 25 * 1024 * 1024) { this.error.set('This PDF is larger than 25 MB.'); return; }
    this.busy.set(true);
    try {
      const [{ readPdfText }, parse] = await loadPdf();
      const pdf = await readPdfText(file);
      if (pdf.scanned) {
        this.error.set('This PDF looks like a scanned image (no text inside), so it cannot be read yet. Please type the values. (Reading scanned PDFs is planned.)');
      } else {
        const res = this.kind() === 'tender' ? parse.parseTenderText(pdf.text) : parse.parseCertificateText(pdf.text);
        this.fileName.set(file.name);
        this.keys.set(Object.keys(res.fields));
        this.picked = Object.fromEntries(Object.keys(res.fields).map((k) => [k, true]));
        this.pickedAct = res.activities.map(() => true);
        this.found.set(res);
      }
    } catch (err: any) {
      this.error.set('Could not read this PDF' + (err?.name === 'PasswordException' ? ' — it is password protected.' : '. Is it a valid PDF file?'));
    }
    this.busy.set(false);
  }

  apply() {
    const f = this.found();
    if (!f) return;
    const fields: Record<string, any> = {};
    for (const k of this.keys()) if (this.picked[k]) fields[k] = f.fields[k].value;
    this.filled.emit({ fields, activities: f.activities.filter((_, i) => this.pickedAct[i]), fileName: this.fileName() });
    this.found.set(null);
  }
}
