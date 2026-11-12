import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { AuthService } from '../../core/auth.service';
import { UI_STYLES } from '../../core/ui-styles';
import { DateField } from '../../shared/date-field';
import { ImportPanel } from '../../shared/import-panel';
import { adToBs, showBoth } from '../../core/nepali-date';
import type { SheetRow } from '../../core/sheets';
import { PROJECT_STATUS_LABEL } from './projects';

const loadSheets = () => import('../../core/project-sheets');
const DATE_KEYS = ['contractSignDate', 'startDate', 'intendedCompletionDate', 'revisedCompletionDate', 'actualCompletionDate'];
const NUM_KEYS = ['contractAmount', 'contractPeriodMonths', 'defectLiabilityMonths', 'advancePct', 'retentionPct'];
const TEXT_KEYS = ['code', 'name', 'client', 'location', 'contractNo', 'projectType', 'projectManager', 'clientEngineer', 'notes'];
const G_TYPE: Record<string, string> = { BID_SECURITY: 'Bid security', PERFORMANCE: 'Performance', ADVANCE_PAYMENT: 'Advance payment', RETENTION: 'Retention money', CUSTOMS: 'Customs', OTHER: 'Other' };

interface BoqRow { itemNo: string; description: string; unit: string; quantity: number | null; rate: number | null; section: string; isHeading: boolean; }

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, DateField, ImportPanel],
  template: `
    <p class="crumb"><a class="link" routerLink="/projects">← All projects</a></p>
    @if (error()) { <div class="msg error">{{ error() }}</div> }
    @if (p(); as p) {
      <div class="bar">
        <div>
          <h1>{{ p.code }} — {{ p.name }}</h1>
          <p class="sub">{{ p.company?.name }}@if (p.bidderType === 'JV') { (JV: @for (j of p.jvPartners; track j.companyId) { {{ j.name }} {{ j.share }}%{{ $last ? '' : ', ' }} }) }
            · {{ p.client || 'client not set' }}{{ p.location ? ' · ' + p.location : '' }}
            · <span class="st" [class]="'st ' + p.status">{{ statusLabel(p.status) }}</span>
            @if (p.source === 'BID') { <span class="tag gold">from bid</span> }</p>
          <p class="help">@if (p.tenderId) { <a class="link" [routerLink]="['/tenders', p.tenderId]">Tender {{ p.tender?.ifbNumber }} →</a> }
            @if (p.bidId) { · <a class="link" routerLink="/bids" [queryParams]="{ bid: p.bidId }">Bid record →</a> }</p>
        </div>
      </div>
      @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }
      @for (a of p.alerts; track $index) { <div class="msg warnm">⚠ {{ a.message }}</div> }

      <section class="cards">
        <div class="card"><div class="label">Contract amount</div><div class="value small">Rs {{ num(p.contractAmount) | number: '1.0-0' }}</div><div class="hint">excluding VAT</div></div>
        <div class="card"><div class="label">BOQ total</div><div class="value small">Rs {{ p.boqTotal | number: '1.0-0' }}</div>
          <div class="hint">{{ p.boqCount }} lines @if (p.boqCount && p.contractAmount) { · difference Rs {{ p.boqTotal - num(p.contractAmount) | number: '1.0-0' }} }</div></div>
        <div class="card"><div class="label">Completion</div><div class="value small">{{ due(p) ? bs(due(p)) : '—' }}</div>
          <div class="hint">@if (p.daysToCompletion != null && active(p.status)) { {{ p.daysToCompletion < 0 ? (-p.daysToCompletion + ' days overdue') : (p.daysToCompletion + ' days left') }} } @if (p.timeUsedPct != null) { · {{ p.timeUsedPct }}% of time used }</div></div>
        <div class="card"><div class="label">Open guarantees</div><div class="value">{{ p.openGuarantees }}</div><div class="hint">Rs {{ p.openGuaranteeAmount | number: '1.0-0' }}</div></div>
      </section>

      <nav class="tabs">
        <button [class.on]="tab() === 'info'" (click)="setTab('info')">Information</button>
        <button [class.on]="tab() === 'boq'" (click)="setTab('boq')">BOQ ({{ p.boqCount }})</button>
        <button [class.on]="tab() === 'guarantees'" (click)="setTab('guarantees')">Bank guarantees ({{ p.guarantees.length }})</button>
      </nav>

      <!-- INFORMATION -->
      @if (tab() === 'info') {
        <form class="panel" (ngSubmit)="save()">
          @if (formError()) { <div class="msg error">{{ formError() }}</div> }
          <h3>Contract</h3>
          <div class="grid">
            <div><label>Project code</label><input name="code" [(ngModel)]="f.code" /></div>
            <div class="wide"><label>Project name <span class="req">*</span></label><input name="name" [(ngModel)]="f.name" /></div>
            <div><label>Client / employer</label><input name="client" [(ngModel)]="f.client" /></div>
            <div><label>Location</label><input name="location" [(ngModel)]="f.location" /></div>
            <div><label>Contract No.</label><input name="contractNo" [(ngModel)]="f.contractNo" /></div>
            <div><label>Type</label><input name="projectType" [(ngModel)]="f.projectType" placeholder="ROAD, BUILDING …" /></div>
            <div><label>Contract amount (NPR)</label><input type="number" min="0" name="contractAmount" [(ngModel)]="f.contractAmount" />
              <div class="help tax">Taxable amount only (excluding VAT)</div></div>
            <div><label>Status</label>
              <select name="status" [(ngModel)]="f.status">@for (s of statuses; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }</select></div>
          </div>
          <h3>Time</h3>
          <div class="grid">
            <app-date-field label="Contract signing date" [(value)]="f.contractSignDate" />
            <app-date-field label="Start (commencement) date" [(value)]="f.startDate" />
            <div><label>Contract period (months)</label><input type="number" min="1" max="240" name="contractPeriodMonths" [(ngModel)]="f.contractPeriodMonths" />
              <div class="help">Changing start or months recalculates intended completion</div></div>
            <app-date-field label="Intended completion" [(value)]="f.intendedCompletionDate" />
            <app-date-field label="Revised completion (extension of time)" [(value)]="f.revisedCompletionDate" />
            <app-date-field label="Actual completion" [(value)]="f.actualCompletionDate" />
            <div><label>Defect liability period (months)</label><input type="number" min="0" max="120" name="defectLiabilityMonths" [(ngModel)]="f.defectLiabilityMonths" /></div>
          </div>
          <h3>Money and people</h3>
          <div class="grid">
            <div><label>Mobilisation advance %</label><input type="number" min="0" max="100" step="0.01" name="advancePct" [(ngModel)]="f.advancePct" /></div>
            <div><label>Retention %</label><input type="number" min="0" max="100" step="0.01" name="retentionPct" [(ngModel)]="f.retentionPct" /></div>
            <div><label>Project manager</label><input name="projectManager" [(ngModel)]="f.projectManager" /></div>
            <div><label>Client's engineer</label><input name="clientEngineer" [(ngModel)]="f.clientEngineer" /></div>
          </div>
          <p class="help">Advance %, retention % and defect liability come from your contract (Special / Particular Conditions) — ProcureNepal does not assume them.</p>
          <label>Notes</label>
          <textarea name="notes" [(ngModel)]="f.notes" rows="2"></textarea>
          @if (p.statusHistory?.length) {
            <div class="history">Status history: @for (h of p.statusHistory; track $index) { <span class="tag">{{ statusLabel(h.status) }} · {{ bs(h.at) }}</span> }</div>
          }
          <div class="actions">
            <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save project' }}</button>
            @if (canDelete) { <button class="btn danger" type="button" (click)="confirmDel.set(true)">Delete project</button> }
          </div>
          @if (confirmDel()) {
            <div class="msg error">Delete {{ p.code }}? Its BOQ is deleted too; bank guarantees stay (unlinked). This cannot be undone.
              <button type="button" class="btn danger small" (click)="remove()">Delete permanently</button>
              <button type="button" class="btn light small" (click)="confirmDel.set(false)">Cancel</button>
            </div>
          }
        </form>
      }

      <!-- BOQ -->
      @if (tab() === 'boq') {
        <div class="panel">
          <div class="bar tight">
            <h2>Bill of Quantities</h2>
            <div class="tools">
              <button class="btn light" (click)="boqTemplate()">📄 BOQ Template</button>
              <button class="btn light" (click)="boqInput.click()">⬆ Upload BOQ Excel</button>
              <input #boqInput type="file" accept=".xlsx,.xls" hidden (change)="onBoqFile($event)" />
              @if (boq().length) { <button class="btn light" (click)="exportBoq()">⬇ Export Excel</button> }
              @if (!editing()) { <button class="btn light" (click)="startEdit()">✏️ Edit lines</button> }
            </div>
          </div>
          <p class="help">Upload the template, or the BOQ sheet straight from the tender document — the header row (Item / Description / Unit / Quantity / Rate / Amount) is found automatically and Total rows are skipped. Amount = quantity × rate.</p>

          @if (impRows().length || impError()) {
            @if (impRows().length) {
              <div class="mode">
                <label class="inline"><input type="radio" name="mode" value="replace" [(ngModel)]="impMode" /> Replace the current BOQ</label>
                <label class="inline"><input type="radio" name="mode" value="append" [(ngModel)]="impMode" /> Add after the current lines</label>
                @if (impSheets().length) { <span class="help">Sheets read: {{ impSheets().join(', ') }}</span> }
              </div>
            }
            <app-import-panel [rows]="impRows()" [headers]="['Item', 'Description', 'Unit', 'Qty × Rate = Amount']" [fileName]="impFile()"
              [error]="impError()" [busy]="importing()" (run)="runBoqImport()" (closed)="impRows.set([]); impError.set('')" />
          }
          @if (boqMsg()) { <div class="msg ok">{{ boqMsg() }}</div> }
          @for (w of boqWarnings(); track $index) { <div class="msg warnm small">{{ w }}</div> }
          @if (boqError()) { <div class="msg error">{{ boqError() }}</div> }

          @if (editing()) {
            <div class="table-wrap"><table class="boq edit">
              <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th class="num">Quantity</th><th class="num">Rate</th><th class="num">Amount</th><th></th></tr></thead>
              <tbody>
                @for (r of rows; track $index; let i = $index) {
                  <tr [class.head]="!r.quantity && !r.rate">
                    <td><input [name]="'i' + i" [(ngModel)]="r.itemNo" class="sm" /></td>
                    <td><input [name]="'d' + i" [(ngModel)]="r.description" /></td>
                    <td><input [name]="'u' + i" [(ngModel)]="r.unit" class="sm" /></td>
                    <td><input type="number" min="0" step="0.001" [name]="'q' + i" [(ngModel)]="r.quantity" class="right" /></td>
                    <td><input type="number" min="0" step="0.01" [name]="'r' + i" [(ngModel)]="r.rate" class="right" /></td>
                    <td class="num">{{ amt(r) != null ? (amt(r) | number: '1.2-2') : '' }}</td>
                    <td><button class="btn danger small" type="button" (click)="rows.splice(i, 1)">🗑️</button></td>
                  </tr>
                }
              </tbody>
            </table></div>
            <div class="actions">
              <button class="btn light" type="button" (click)="addRow()">+ Add line</button>
              <button class="btn" type="button" (click)="saveRows()" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save BOQ' }}</button>
              <button class="btn light" type="button" (click)="editing.set(false)">Cancel</button>
              <span class="help">Total {{ editTotal() | number: '1.2-2' }} · leave quantity and rate empty for a heading</span>
            </div>
          } @else {
            <div class="table-wrap"><table class="boq">
              <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th class="num">Quantity</th><th class="num">Rate (NPR)</th><th class="num">Amount (NPR)</th></tr></thead>
              <tbody>
                @for (r of boq(); track r.id) {
                  <tr [class.head]="r.isHeading">
                    <td>{{ r.itemNo }}</td><td>{{ r.description }}</td><td>{{ r.unit }}</td>
                    <td class="num">{{ r.quantity != null ? (num(r.quantity) | number: '1.0-3') : '' }}</td>
                    <td class="num">{{ r.rate != null ? (num(r.rate) | number: '1.2-2') : '' }}</td>
                    <td class="num">{{ r.amount != null ? (num(r.amount) | number: '1.2-2') : '' }}</td>
                  </tr>
                } @empty { <tr><td colspan="6" class="empty">No BOQ yet. Click <strong>⬆ Upload BOQ Excel</strong> (or <strong>📄 BOQ Template</strong> first).</td></tr> }
              </tbody>
              @if (boq().length) {
                <tfoot>
                  <tr><td colspan="5"><strong>Total (excluding VAT)</strong></td><td class="num"><strong>{{ boqTotal() | number: '1.2-2' }}</strong></td></tr>
                  @if (p.contractAmount) { <tr><td colspan="5">Contract amount · difference</td><td class="num">{{ num(p.contractAmount) | number: '1.2-2' }} · {{ boqTotal() - num(p.contractAmount) | number: '1.2-2' }}</td></tr> }
                </tfoot>
              }
            </table></div>
          }
        </div>
      }

      <!-- GUARANTEES -->
      @if (tab() === 'guarantees') {
        <div class="panel">
          <div class="bar tight">
            <h2>Bank guarantees</h2>
            <a class="btn light" routerLink="/bank-guarantees" [queryParams]="{ project: p.id }">+ Add guarantee</a>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Type</th><th>Number / bank</th><th class="num">Amount (NPR)</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (g of p.guarantees; track g.id) {
                <tr>
                  <td>{{ gType(g.type) }}</td>
                  <td><strong>{{ g.guaranteeNo || '—' }}</strong><div class="help">{{ g.bankName }}</div></td>
                  <td class="num">{{ num(g.amount) | number: '1.0-0' }}</td>
                  <td>{{ g.expiryDate ? both(g.expiryDate) : '—' }}</td>
                  <td>{{ g.status.toLowerCase() }}</td>
                  <td><a class="btn light small" routerLink="/bank-guarantees" [queryParams]="{ id: g.id }">Open</a></td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No guarantees linked. Performance and advance-payment guarantees can be added here.</td></tr> }
            </tbody>
          </table></div>
        </div>
      }
    } @else if (!error()) { <div class="msg info">Loading project…</div> }
  `,
  styles: [UI_STYLES, `
    .crumb { margin: 0 0 8px; font-size: 13px; }
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .bar.tight { margin-bottom: 8px; align-items: center; }
    .bar.tight h2 { margin: 0; }
    .btn.small { padding: 6px 12px; }
    a.btn { text-decoration: none; display: inline-block; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 18px 0 10px; padding-top: 12px; border-top: 1px solid #eef0f2; }
    h3:first-of-type { border-top: 0; padding-top: 0; margin-top: 4px; }
    .wide { grid-column: span 2; }
    .help.tax { color: #b8860b; }
    textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 16px; }
    .card .label { color: #4b5563; font-size: 13px; }
    .card .value { font-size: 28px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .card .value.small { font-size: 18px; }
    .card .hint { font-size: 12px; color: #9ca3af; }
    .tabs { display: flex; gap: 4px; margin-bottom: 0; border-bottom: 2px solid #e1e3e6; }
    .tabs button { background: none; border: 0; padding: 10px 16px; font-weight: 600; color: #4b5563; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; font-size: 14px; }
    .tabs button.on { color: #0a1f3d; border-bottom-color: #d4a017; }
    .tabs + .panel { border-top-left-radius: 0; }
    .st { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; }
    .st.ONGOING, .st.MOBILIZING { background: #dcfce7; color: #15803d; }
    .st.SUSPENDED, .st.PLANNED { background: #fef5e0; color: #8a6508; }
    .st.TERMINATED { background: #fee2e2; color: #b91c1c; }
    .msg.warnm { background: #fef5e0; border: 1px solid #f5d98a; color: #6b4e06; }
    .msg.small { font-size: 12px; padding: 6px 10px; margin-bottom: 6px; }
    .history { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; margin-top: 12px; }
    .mode { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin: 4px 0 10px; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; margin: 0; font-weight: 600; }
    label.inline input { width: auto; }
    table.boq tr.head td { font-weight: 700; background: #f8fafc; }
    table.boq tfoot td { border-top: 2px solid #e1e3e6; }
    table.boq.edit td { padding: 4px; }
    table.boq.edit input { padding: 6px 8px; font-size: 13px; }
    table.boq.edit input.sm { width: 70px; }
    table.boq.edit input.right { text-align: right; width: 110px; }
    @media (max-width: 700px) { .wide { grid-column: auto; } }
  `],
})
export class ProjectDetailPage {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  canDelete = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'].includes(this.auth.getUser()?.role);
  statuses = Object.keys(PROJECT_STATUS_LABEL);
  id = this.route.snapshot.paramMap.get('id')!;

  p = signal<any | null>(null);
  boq = signal<any[]>([]);
  tab = signal<'info' | 'boq' | 'guarantees'>((this.route.snapshot.queryParamMap.get('tab') as any) || 'info');
  error = signal('');
  okMsg = signal('');
  formError = signal('');
  saving = signal(false);
  confirmDel = signal(false);
  editing = signal(false);
  boqMsg = signal('');
  boqError = signal('');
  boqWarnings = signal<string[]>([]);
  f: any = {};
  rows: BoqRow[] = [];

  boqTotal = computed(() => this.boq().filter((r) => !r.isHeading).reduce((t, r) => t + this.num(r.amount), 0));

  constructor() {
    if (this.route.snapshot.queryParamMap.get('created')) this.okMsg.set('✅ Project created from the won bid — contract data and bank guarantees were copied. Upload the BOQ next.');
    this.load();
  }

  statusLabel(s: string) { return PROJECT_STATUS_LABEL[s] ?? s; }
  gType(t: string) { return G_TYPE[t] ?? t; }
  active(s: string) { return ['PLANNED', 'MOBILIZING', 'ONGOING', 'SUSPENDED'].includes(s); }
  num(v: any) { return v == null || v === '' ? 0 : Number(v); }
  bs(d: any) { return d ? adToBs(String(d).slice(0, 10)) : ''; }
  both(d: any) { return showBoth(d); }
  due(p: any) { return p.actualCompletionDate ?? p.revisedCompletionDate ?? p.intendedCompletionDate; }
  amt(r: BoqRow): number | null {
    if (r.quantity === null || r.quantity === undefined || (r.quantity as any) === '' || r.rate === null || r.rate === undefined || (r.rate as any) === '') return null;
    return Math.round(Math.round(Number(r.quantity) * 1000) * Math.round(Number(r.rate) * 100) / 1000) / 100;
  }
  editTotal() { return this.rows.reduce((t, r) => t + (this.amt(r) ?? 0), 0); }
  setTab(t: 'info' | 'boq' | 'guarantees') {
    this.tab.set(t);
    this.router.navigate([], { queryParams: { tab: t }, replaceUrl: true });
  }

  async load() {
    try {
      const p = await firstValueFrom(this.data.getProject(this.id));
      this.p.set(p);
      const d = (v: any) => (v ? String(v).slice(0, 10) : '');
      this.f = { status: p.status };
      for (const k of DATE_KEYS) this.f[k] = d(p[k]);
      for (const k of NUM_KEYS) this.f[k] = p[k] == null ? null : Number(p[k]);
      for (const k of TEXT_KEYS) this.f[k] = p[k] ?? '';
      const b = await firstValueFrom(this.data.getBoq(this.id));
      this.boq.set(b.items);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async save() {
    this.formError.set('');
    if (!String(this.f.name ?? '').trim()) { this.formError.set('Project name is required.'); return; }
    const cur = this.p();
    const body: any = { status: this.f.status };
    for (const k of DATE_KEYS) {
      const v = this.f[k] || null;
      if (v !== (cur[k] ? String(cur[k]).slice(0, 10) : null)) body[k] = v;
    }
    // only changed dates are sent: if start or months change and intended completion was not touched, the server recalculates it
    for (const k of NUM_KEYS) {
      const v = this.f[k];
      if (v === null || v === '' || v === undefined) { body[k] = null; continue; }
      const n = Number(v);
      if (!isFinite(n) || n < 0) { this.formError.set('Please check the numbers.'); return; }
      body[k] = ['contractPeriodMonths', 'defectLiabilityMonths'].includes(k) ? Math.round(n) : n;
    }
    if (body.contractPeriodMonths === 0) body.contractPeriodMonths = null;
    for (const k of TEXT_KEYS) body[k] = String(this.f[k] ?? '').trim() || (k === 'code' || k === 'name' ? undefined : null);
    this.saving.set(true);
    try {
      await firstValueFrom(this.data.updateProject(this.id, body));
      this.okMsg.set('✅ Project saved.');
      await this.load();
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }

  async remove() {
    this.confirmDel.set(false);
    try {
      await firstValueFrom(this.data.deleteProject(this.id));
      this.router.navigate(['/projects']);
    } catch (e) {
      this.formError.set(errorText(e));
    }
  }

  // ---------- BOQ ----------
  startEdit() {
    this.rows = this.boq().map((r) => ({ itemNo: r.itemNo ?? '', description: r.description, unit: r.unit ?? '', quantity: r.quantity == null ? null : Number(r.quantity), rate: r.rate == null ? null : Number(r.rate), section: r.section ?? '', isHeading: r.isHeading }));
    if (!this.rows.length) this.addRow();
    this.boqMsg.set('');
    this.boqError.set('');
    this.editing.set(true);
  }
  addRow() { this.rows.push({ itemNo: '', description: '', unit: '', quantity: null, rate: null, section: '', isHeading: false }); }
  private toItem(r: BoqRow) {
    const q = r.quantity === null || (r.quantity as any) === '' ? null : Number(r.quantity);
    const rt = r.rate === null || (r.rate as any) === '' ? null : Number(r.rate);
    const it: any = { description: String(r.description).trim(), isHeading: q === null && rt === null };
    if (String(r.itemNo).trim()) it.itemNo = String(r.itemNo).trim();
    if (String(r.unit).trim()) it.unit = String(r.unit).trim();
    if (q !== null) it.quantity = q;
    if (rt !== null) it.rate = rt;
    if (String(r.section ?? '').trim()) it.section = String(r.section).trim();
    return it;
  }
  async saveRows() {
    this.boqError.set('');
    const rows = this.rows.filter((r) => String(r.description).trim() || r.quantity || r.rate);
    const bad = rows.findIndex((r) => !String(r.description).trim() || Number(r.quantity) < 0 || Number(r.rate) < 0);
    if (bad >= 0) { this.boqError.set(`Line ${bad + 1}: a description is needed and numbers cannot be negative.`); return; }
    this.saving.set(true);
    try {
      const r = await firstValueFrom(this.data.saveBoq(this.id, rows.map((x) => this.toItem(x)), 'replace'));
      this.boq.set(r.items);
      this.boqWarnings.set(r.warnings ?? []);
      this.boqMsg.set(`✅ BOQ saved: ${r.count} lines, total Rs ${Number(r.total).toLocaleString('en-IN')}.`);
      this.editing.set(false);
      this.p.set(await firstValueFrom(this.data.getProject(this.id)));
    } catch (e) {
      this.boqError.set(errorText(e));
    }
    this.saving.set(false);
  }

  impRows = signal<SheetRow[]>([]);
  impError = signal('');
  impFile = signal('');
  impSheets = signal<string[]>([]);
  importing = signal(false);
  impMode: 'replace' | 'append' = 'replace';
  async boqTemplate() { (await loadSheets()).boqTemplate(); }
  async exportBoq() { (await loadSheets()).exportBoq(this.p(), this.boq()); }
  async onBoqFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.boqMsg.set('');
    this.boqWarnings.set([]);
    this.impError.set('');
    this.impRows.set([]);
    this.impFile.set(file.name);
    this.impMode = 'replace';
    try {
      const r = await (await loadSheets()).readBoqFile(file);
      this.impRows.set(r.rows);
      this.impSheets.set(r.sheets);
      if (!r.rows.length) this.impError.set('The BOQ table was found but it has no lines.');
    } catch (err: any) {
      this.impError.set(err?.message || 'Could not read this file. Please use the BOQ Template.');
    }
  }
  async runBoqImport() {
    const ready = this.impRows().filter((r) => r.status === 'ready');
    this.importing.set(true);
    this.impRows.update((l) => l.map((r) => (r.status === 'ready' ? { ...r, status: 'saving' } : r)));
    try {
      const r = await firstValueFrom(this.data.saveBoq(this.id, ready.map((x) => x.body), this.impMode));
      this.impRows.update((l) => l.map((x) => (x.status === 'saving' ? { ...x, status: 'saved' } : x)));
      this.boq.set(r.items);
      this.boqWarnings.set(r.warnings ?? []);
      this.boqMsg.set(`✅ BOQ ${this.impMode === 'append' ? 'lines added' : 'uploaded'}: ${r.count} lines, total Rs ${Number(r.total).toLocaleString('en-IN')}.`);
      this.p.set(await firstValueFrom(this.data.getProject(this.id)));
    } catch (e) {
      const msg = errorText(e);
      this.impRows.update((l) => l.map((x) => (x.status === 'saving' ? { ...x, status: 'failed', message: msg } : x)));
    }
    this.importing.set(false);
  }
}
