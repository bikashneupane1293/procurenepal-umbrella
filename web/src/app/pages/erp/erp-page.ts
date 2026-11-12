import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { DateField } from '../../shared/date-field';
import { ImportPanel } from '../../shared/import-panel';
import { adToBs } from '../../core/nepali-date';
import type { SheetRow } from '../../core/sheets';

const loadSheets = () => import('../../core/erp-sheets');
type Opt = { id: string; label: string; extra?: any };
const pretty = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');

/**
 * One page for every ERP register, document and calculated report.
 * The API sends the definition (fields, lines, statuses, actions) and this page draws it,
 * so all menus behave the same way: list, form, Excel template / import / export.
 */
@Component({
  selector: 'app-erp-page',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DateField, ImportPanel],
  template: `
    @if (error()) { <div class="msg error">{{ error() }}</div> }
    @if (menu(); as m) {
      <div class="bar">
        <div><h1>{{ m.title }}</h1><p class="sub">{{ m.about }}</p></div>
        @if (tab()?.kind === 'entity') {
          <div class="tools">
            @if (rows().length) { <button class="btn light" (click)="exportExcel()">⬇ Export Excel</button> }
            <button class="btn light" (click)="template()">📄 Excel Template</button>
            <button class="btn light" (click)="fileInput.click()">⬆ Import Excel</button>
            <input #fileInput type="file" accept=".xlsx,.xls" hidden (change)="onFile($event)" />
            @if (!showForm()) { <button class="btn gold" (click)="openNew()">+ New {{ def().one }}</button> }
          </div>
        }
      </div>
      @if (m.tabs.length > 1) {
        <nav class="tabs">@for (t of m.tabs; track $index; let i = $index) { <button [class.on]="tabIx() === i" (click)="setTab(i)">{{ t.title }}</button> }</nav>
      }
      @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }

      <!-- ============ REGISTER / DOCUMENT ============ -->
      @if (tab()?.kind === 'entity') {
        @if (def().help) { <p class="help top">{{ def().help }}</p> }
        @if (impRows().length || impError()) {
          <app-import-panel [rows]="impRows()" [headers]="impHeaders()" [fileName]="impFile()" [error]="impError()" [busy]="importing()"
            (run)="runImport()" (closed)="impRows.set([]); impError.set('')" />
        }
        @if (showForm()) {
          <form class="panel edit" (ngSubmit)="save()">
            <div class="bar tight">
              <h2>{{ cur() ? (cur().number || ('Edit ' + def().one)) : ('New ' + def().one) }}
                @if (cur()?.status) { <span class="st" [class]="'st ' + cur().status">{{ nice(cur().status) }}</span> }</h2>
              <button type="button" class="btn light small" (click)="close()">Close</button>
            </div>
            @if (cur()?.alert) { <div class="msg warnm">⚠ {{ cur().alert }}</div> }
            @if (formError()) { <div class="msg error">{{ formError() }}</div> }
            <div class="grid">
              @for (f of def().fields; track f.k) {
                @if (f.calc) {
                  @if (cur() && cur().data[f.k] != null) { <div><label>{{ f.label }}</label><div class="ro">{{ show(f, cur()) }}</div></div> }
                } @else if (f.type === 'date') {
                  <app-date-field [label]="f.label" [required]="!!f.req" [(value)]="form[f.k]" />
                } @else {
                  <div [class.wide]="f.type === 'textarea' || f.type === 'multiref'">
                    <label>{{ f.label }} @if (f.req) { <span class="req">*</span> }</label>
                    @switch (f.type) {
                      @case ('select') { <select [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k">
                        <option value="">—</option>@for (o of f.options; track o) { <option [value]="o">{{ nice(o) }}</option> }</select> }
                      @case ('ref') { <select [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k" (ngModelChange)="onRef(f)">
                        <option value="">— Select —</option>@for (o of opts(f.ref); track o.id) { <option [value]="o.id">{{ o.label }}</option> }</select>
                        @if (!opts(f.ref).length) { <div class="help">Nothing in this list yet.</div> } }
                      @case ('multiref') { <div class="multi" [attr.data-k]="f.k">
                        @for (o of opts(f.ref); track o.id) { <label class="inline"><input type="checkbox" [checked]="has(f.k, o.id)" (change)="toggle(f.k, o.id)" /> {{ o.label }}</label> }
                        @if (!opts(f.ref).length) { <span class="help">Nothing in this list yet.</span> }</div> }
                      @case ('bool') { <label class="inline"><input type="checkbox" [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k" /> Yes</label> }
                      @case ('textarea') { <textarea rows="2" [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k"></textarea> }
                      @case ('number') { <input type="number" min="0" step="any" [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k" /> }
                      @case ('money') { <input type="number" min="0" step="any" [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k" /> }
                      @default { <input [type]="f.type === 'email' ? 'email' : 'text'" [(ngModel)]="form[f.k]" [ngModelOptions]="{ standalone: true }" [attr.data-k]="f.k" /> }
                    }
                    @if (f.help) { <div class="help">{{ f.help }}</div> }
                  </div>
                }
              }
              @if (def().statuses) {
                <div><label>Status</label>
                  <select [(ngModel)]="form.__status" [ngModelOptions]="{ standalone: true }" data-k="status">@for (s of def().statuses; track s) { <option [value]="s">{{ nice(s) }}</option> }</select></div>
              }
            </div>

            @if (def().lines; as ld) {
              <h3>{{ ld.title }}</h3>
              <div class="table-wrap"><table class="lines">
                <thead><tr>@for (c of ld.cols; track c.k) { <th [class.num]="isNum(c)">{{ c.label }}</th> }<th></th></tr></thead>
                <tbody>
                  @for (l of lines; track $index; let i = $index) {
                    <tr>
                      @for (c of ld.cols; track c.k) {
                        <td [class.num]="isNum(c)">
                          @if (c.calc) { {{ calc(c, l) }} }
                          @else if (c.type === 'ref') { <select [(ngModel)]="l[c.k]" [ngModelOptions]="{ standalone: true }" (ngModelChange)="onLineRef(c, l)">
                            <option value="">— Select —</option>@for (o of opts(c.ref); track o.id) { <option [value]="o.id">{{ o.label }}</option> }</select> }
                          @else if (c.type === 'select') { <select [(ngModel)]="l[c.k]" [ngModelOptions]="{ standalone: true }"><option value="">—</option>@for (o of c.options; track o) { <option [value]="o">{{ nice(o) }}</option> }</select> }
                          @else if (isNum(c)) { <input type="number" min="0" step="any" class="right" [(ngModel)]="l[c.k]" [ngModelOptions]="{ standalone: true }" /> }
                          @else if (c.type === 'date') { <input type="date" [(ngModel)]="l[c.k]" [ngModelOptions]="{ standalone: true }" /> }
                          @else { <input [(ngModel)]="l[c.k]" [ngModelOptions]="{ standalone: true }" /> }
                        </td>
                      }
                      <td><button type="button" class="btn danger small" (click)="lines.splice(i, 1)">🗑️</button></td>
                    </tr>
                  }
                </tbody>
              </table></div>
              <div class="actions"><button type="button" class="btn light small" (click)="addLine()">+ Add line</button>
                @if (lineTotal() != null) { <span class="help">Total Rs {{ lineTotal() | number: '1.2-2' }} (excluding VAT)</span> }
                @if (needsProject() && !form.project) { <span class="help">Choose the project first — the item list comes from its BOQ.</span> }</div>
            }

            <div class="actions">
              <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save' }}</button>
              @for (a of actions(); track a.key) { <button type="button" class="btn light" (click)="act(a.key, { id: cur().id })" [disabled]="saving()">{{ a.label }}</button> }
              @if (cur() && menu().canDelete) { <button class="btn danger" type="button" (click)="confirmDel.set(true)">Delete</button> }
            </div>
            @if (confirmDel()) {
              <div class="msg error">Delete this {{ def().one }}? This cannot be undone.
                <button type="button" class="btn danger small" (click)="remove()">Delete permanently</button>
                <button type="button" class="btn light small" (click)="confirmDel.set(false)">Cancel</button></div>
            }
          </form>
        }

        <div class="panel">
          <div class="filters">
            @if (def().statuses) {
              <select [ngModel]="fStatus()" (ngModelChange)="fStatus.set($event)" [ngModelOptions]="{ standalone: true }" data-k="fstatus">
                <option value="">All statuses</option>@for (s of def().statuses; track s) { <option [value]="s">{{ nice(s) }}</option> }</select>
            }
            <input placeholder="Search" [ngModel]="fText()" (ngModelChange)="fText.set($event)" [ngModelOptions]="{ standalone: true }" />
            <span class="help">{{ filtered().length }} of {{ rows().length }}</span>
          </div>
          @if (loading()) { <div class="msg info">Loading…</div> }
          @else {
            <div class="table-wrap"><table>
              <thead><tr>
                @if (def().series) { <th>Number</th> }
                @for (f of listCols(); track f.k) { <th [class.num]="isNum(f)">{{ f.label }}</th> }
                @if (hasTotal()) { <th class="num">Total (NPR)</th> }
                @if (def().statuses) { <th>Status</th> }<th></th>
              </tr></thead>
              <tbody>
                @for (r of filtered(); track r.id) {
                  <tr [class.sel]="cur()?.id === r.id">
                    @if (def().series) { <td><strong>{{ r.number }}</strong></td> }
                    @for (f of listCols(); track f.k; let first = $first) {
                      <td [class.num]="isNum(f)">{{ show(f, r) }}@if (first && r.alert) { <div class="al">⚠ {{ r.alert }}</div> }</td>
                    }
                    @if (hasTotal()) { <td class="num">{{ r.total != null ? (r.total | number: '1.0-2') : '' }}</td> }
                    @if (def().statuses) { <td><span class="st" [class]="'st ' + r.status">{{ nice(r.status) }}</span></td> }
                    <td><button class="btn light small" (click)="open(r.id)">Open</button></td>
                  </tr>
                } @empty { <tr><td [attr.colspan]="listCols().length + 4" class="empty">Nothing here yet. Click <strong>+ New {{ def().one }}</strong> or import the Excel template.</td></tr> }
              </tbody>
            </table></div>
          }
        </div>
      }

      <!-- ============ CALCULATED REPORT ============ -->
      @if (tab()?.kind === 'report') {
        <div class="panel">
          <div class="filters">
            @for (p of tab().params ?? []; track p.k) {
              <label class="inline">{{ p.label }} @if (p.req) { <span class="req">*</span> }
                @if (p.ref) { <select [(ngModel)]="rp[p.k]" [ngModelOptions]="{ standalone: true }" (ngModelChange)="runReport()" [attr.data-k]="p.k">
                  <option value="">{{ p.req ? '— Select —' : 'All' }}</option>@for (o of opts(p.ref); track o.id) { <option [value]="o.id">{{ o.label }}</option> }</select> }
                @else { <input type="date" [(ngModel)]="rp[p.k]" [ngModelOptions]="{ standalone: true }" (ngModelChange)="runReport()" [attr.data-k]="p.k" /> }
              </label>
            }
            <button class="btn light" (click)="runReport()">↻ Refresh</button>
            @if (report()) { <button class="btn light" (click)="reportExcel()">⬇ Export Excel</button><button class="btn light" (click)="print()">🖨 Print</button> }
          </div>
          @if (repMsg()) { <div class="msg info">{{ repMsg() }}</div> }
        </div>
        @if (report(); as r) {
          @if (r.note) { <p class="help top">{{ r.note }}</p> }
          @if (r.cards?.length) {
            <section class="cards">@for (c of r.cards; track c.label) {
              <div class="card"><div class="label">{{ c.label }}</div><div class="value" [class]="'value ' + (c.tone ?? '')">{{ c.value }}</div><div class="hint">{{ c.hint }}</div></div> }</section>
          }
          @if (r.actions?.length) {
            <div class="actions rep">@for (a of r.actions; track a.label) { <button class="btn" (click)="act(a.action, a.body)" [disabled]="saving()">{{ a.label }}</button> }</div>
          }
          @if (chart(); as ch) {
            <div class="panel"><svg class="chart" [attr.viewBox]="'0 0 ' + ch.w + ' ' + ch.h" role="img" aria-label="Planned and actual progress">
              @for (g of ch.grid; track g.y) { <line [attr.x1]="ch.l" [attr.x2]="ch.w - 10" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" /><text [attr.x]="ch.l - 6" [attr.y]="g.y + 4" class="ax" text-anchor="end">{{ g.v }}</text> }
              @for (x of ch.xs; track x.t) { <text [attr.x]="x.x" [attr.y]="ch.h - 6" class="ax" text-anchor="middle">{{ x.t }}</text> }
              @for (s of ch.series; track s.name; let i = $index) { <polyline [attr.points]="s.points" [class]="'ln ln' + i" /> @for (d of s.dots; track $index) { <circle [attr.cx]="d.x" [attr.cy]="d.y" r="3" [class]="'dt dt' + i" /> } }
            </svg>
            <div class="help">@for (s of ch.series; track s.name; let i = $index) { <span [class]="'key key' + i"></span> {{ s.name }} &nbsp; } ({{ ch.unit }})</div></div>
          }
          @for (t of r.tables; track $index) {
            <div class="panel"><h2>{{ t.title }}</h2>
              @if (t.note) { <p class="help">{{ t.note }}</p> }
              <div class="table-wrap"><table>
                <thead><tr>@for (c of t.columns; track c.k) { <th [class.num]="c.num">{{ c.label }}</th> }@if (rowActions(t)) { <th></th> }</tr></thead>
                <tbody>
                  @for (row of t.rows; track $index) { <tr [class.tot]="row.__total || row._total" [class.goodrow]="row._tone === 'good'" [class.badrow]="row._tone === 'bad' || row._tone === 'warn'">@for (c of t.columns; track c.k) { <td [class.num]="c.num">{{ cellText(row[c.k], c.num) }}</td> }
                    @if (rowActions(t)) { <td>@if (row._action) { <button class="btn small" (click)="act(row._action.action, row._action.body)" [disabled]="saving()">{{ row._action.label }}</button> }</td> }</tr> }
                  @empty { <tr><td [attr.colspan]="t.columns.length" class="empty">Nothing to show yet.</td></tr> }
                </tbody>
              </table></div>
            </div>
          }
        }
      }

      <!-- ============ CSV EXPORT ============ -->
      @if (tab()?.kind === 'csv') {
        <div class="panel">
          <p class="help">Choose a list and download it as CSV (opens in Excel, Tally import tools, accounting software) or as an Excel file.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>List</th><th></th></tr></thead>
            <tbody>@for (d of datasets(); track d.key) {
              <tr><td>{{ d.title }}</td><td><button class="btn light small" (click)="csv(d, 'csv')">⬇ CSV</button> <button class="btn light small" (click)="csv(d, 'xlsx')">⬇ Excel</button></td></tr> }</tbody>
          </table></div>
        </div>
      }
    } @else if (!error()) { <div class="msg info">Loading…</div> }
  `,
  styles: [UI_STYLES, `
    .tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .bar.tight { margin-bottom: 6px; align-items: center; }
    .bar.tight h2 { margin: 0; display: flex; gap: 8px; align-items: center; }
    .btn.small { padding: 6px 12px; }
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 20px 0 10px; padding-top: 12px; border-top: 1px solid #eef0f2; }
    .wide { grid-column: span 2; }
    .help.top { margin: 0 0 12px; }
    .ro { padding: 10px 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 14px; }
    textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    .multi { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; max-height: 150px; overflow: auto; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; margin: 0; font-weight: 600; }
    label.inline input[type=checkbox] { width: auto; }
    .tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 14px; border-bottom: 2px solid #e1e3e6; }
    .tabs button { background: none; border: 0; padding: 10px 16px; font-weight: 600; color: #4b5563; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; font-size: 14px; }
    .tabs button.on { color: #0a1f3d; border-bottom-color: #d4a017; }
    .filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
    .filters select, .filters input { width: auto; min-width: 170px; }
    table.lines td { padding: 4px; }
    table.lines input, table.lines select { padding: 6px 8px; font-size: 13px; min-width: 90px; }
    table.lines input.right { text-align: right; width: 110px; }
    .st { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; white-space: nowrap; }
    .st.ACTIVE, .st.POSTED, .st.APPROVED, .st.RECEIVED, .st.PAID, .st.ACHIEVED, .st.DONE, .st.SETTLED, .st.AWARDED, .st.ISSUED { background: #dcfce7; color: #15803d; }
    .st.DRAFT, .st.SUBMITTED, .st.SENT, .st.PARTIAL, .st.PLANNED, .st.PENDING, .st.OPEN { background: #fef5e0; color: #8a6508; }
    .st.REJECTED, .st.CANCELLED, .st.OVERDUE, .st.LEFT, .st.SOLD, .st.CLOSED { background: #f3f4f6; color: #6b7280; }
    .al { font-size: 12px; color: #8a6508; margin-top: 2px; }
    .msg.warnm { background: #fef5e0; border: 1px solid #f5d98a; color: #6b4e06; }
    tr.sel td { background: #fffbeb; }
    tr.tot td { font-weight: 700; border-top: 2px solid #e1e3e6; }
    tr.goodrow td { background: #f0fdf4; }
    tr.badrow td { background: #fff7ed; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .card { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 16px; }
    .card .label { color: #4b5563; font-size: 13px; }
    .card .value { font-size: 20px; font-weight: 800; color: #0a1f3d; margin: 6px 0; }
    .card .value.warn { color: #b8860b; } .card .value.bad { color: #b91c1c; } .card .value.good { color: #15803d; }
    .card .hint { font-size: 12px; color: #9ca3af; }
    .actions.rep { margin: 0 0 16px; }
    svg.chart { width: 100%; max-height: 320px; }
    .grid { stroke: #eef0f2; } .ax { font-size: 10px; fill: #6b7280; }
    .ln { fill: none; stroke-width: 2.5; } .ln0 { stroke: #1e3a5f; } .ln1 { stroke: #d4a017; } .ln2 { stroke: #15803d; }
    .dt0 { fill: #1e3a5f; } .dt1 { fill: #d4a017; } .dt2 { fill: #15803d; }
    .key { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: middle; }
    .key0 { background: #1e3a5f; } .key1 { background: #d4a017; } .key2 { background: #15803d; }
    @media (max-width: 700px) { .wide { grid-column: auto; } }
    @media print { .tools, .filters, .tabs, .actions { display: none !important; } }
  `],
})
export class ErpPage {
  private data = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  menu = signal<any | null>(null);
  tabIx = signal(0);
  tab = computed(() => this.menu()?.tabs[this.tabIx()] ?? null);
  def = computed(() => this.tab()?.def ?? { fields: [], one: 'record', title: '' });
  rows = signal<any[]>([]);
  loading = signal(false);
  error = signal('');
  okMsg = signal('');
  formError = signal('');
  saving = signal(false);
  showForm = signal(false);
  cur = signal<any | null>(null);
  confirmDel = signal(false);
  fStatus = signal('');
  fText = signal('');
  form: any = {};
  lines: any[] = [];
  private optCache = signal<Record<string, Opt[]>>({});
  private menuId = '';

  listCols = computed(() => this.def().fields.filter((f: any) => f.list));
  hasTotal = computed(() => this.rows().some((r) => r.total != null));
  filtered = computed(() => {
    const q = this.fText().trim().toLowerCase();
    return this.rows().filter((r) => (!this.fStatus() || r.status === this.fStatus())
      && (!q || `${r.number ?? ''} ${Object.values(r.data ?? {}).join(' ')} ${Object.values(r.labels ?? {}).join(' ')}`.toLowerCase().includes(q)));
  });
  actions = computed(() => (this.cur() ? (this.def().actions ?? []).filter((a: any) => !a.when || a.when.includes(this.cur().status)) : []));

  constructor() {
    this.route.paramMap.subscribe((p) => this.loadMenu(p.get('menuId')!));
  }

  // ---------- helpers ----------
  nice(s: string) { return pretty(s ?? ''); }
  isNum(f: any) { return f.type === 'number' || f.type === 'money'; }
  bs(d: any) { return d ? adToBs(String(d).slice(0, 10)) : ''; }
  show(f: any, r: any) {
    const v = r.data?.[f.k];
    if (f.type === 'ref' || f.type === 'multiref') return r.labels?.[f.k] ?? '';
    if (v === null || v === undefined || v === '') return '';
    if (f.type === 'date') return this.bs(v);
    if (f.type === 'money') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (f.type === 'bool') return v ? 'Yes' : 'No';
    if (f.type === 'select') return pretty(String(v));
    return v;
  }
  cellText(v: any, isNum?: boolean) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (!isNum && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return this.bs(v) + ' BS';
    return v;
  }
  private key(ref: string) { return ref === 'boq' ? 'boq:' + (this.form.project ?? '') : ref; }
  opts(ref: string): Opt[] { return this.optCache()[this.key(ref)] ?? []; }
  private async loadOpts(ref: string, projectId?: string): Promise<Opt[]> {
    const k = ref === 'boq' ? 'boq:' + (projectId ?? '') : ref;
    if (this.optCache()[k]) return this.optCache()[k];
    let list: Opt[] = [];
    try { list = ref === 'boq' && !projectId ? [] : await firstValueFrom(this.data.erpOptions(ref, ref === 'boq' ? projectId : undefined)); } catch { list = []; }
    this.optCache.update((c) => ({ ...c, [k]: list }));
    return list;
  }
  private refsOf(t: any): string[] {
    if (t?.kind === 'report') return (t.params ?? []).filter((p: any) => p.ref).map((p: any) => p.ref);
    const d = t?.def;
    return d ? [...d.fields, ...(d.lines?.cols ?? [])].filter((f: any) => f.ref && f.ref !== 'boq').map((f: any) => f.ref) : [];
  }
  needsProject() { return (this.def().lines?.cols ?? []).some((c: any) => c.ref === 'boq'); }
  has(k: string, id: string) { return (this.form[k] ?? []).includes(id); }
  toggle(k: string, id: string) { const l: string[] = this.form[k] ?? []; this.form[k] = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]; }
  onRef(f: any) { if (f.k === 'project' && this.needsProject()) this.loadOpts('boq', this.form.project); }
  onLineRef(c: any, l: any) {
    const o = this.opts(c.ref).find((x) => x.id === l[c.k]);
    if (!o) return;
    const cols = this.def().lines.cols;
    if (cols.some((x: any) => x.k === 'rate' && !x.calc) && (l.rate === null || l.rate === undefined || l.rate === '')) l.rate = o.extra?.lastRate ?? o.extra?.rate ?? null;
  }
  calc(c: any, l: any) {
    if (c.k === 'unit') { const rc = this.def().lines.cols.find((x: any) => x.type === 'ref'); return this.opts(rc?.ref).find((o) => o.id === l[rc?.k])?.extra?.unit ?? l.unit ?? ''; }
    if (c.k === 'amount') { const a = this.amount(l); return a == null ? '' : a.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
    const v = l[c.k];
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v ?? '';
  }
  private amount(l: any): number | null {
    const q = l.qty, r = l.rate;
    if (q === null || q === undefined || q === '' || r === null || r === undefined || r === '') return null;
    return Math.round(Number(q) * Number(r) * 100) / 100;
  }
  lineTotal(): number | null {
    if (!this.def().lines?.cols.some((c: any) => c.k === 'amount')) return null;
    return this.lines.reduce((t, l) => t + (this.amount(l) ?? 0), 0);
  }

  // ---------- loading ----------
  async loadMenu(id: string) {
    this.menuId = id;
    this.menu.set(null);
    this.error.set('');
    this.okMsg.set('');
    this.close();
    this.report.set(null);
    try {
      const m = await firstValueFrom(this.data.erpMenu(id));
      if (this.menuId !== id) return;
      const q = this.route.snapshot.queryParamMap;
      const want = q.get('tab');
      const ix = want ? m.tabs.findIndex((t: any) => t.entity === want || t.report === want) : 0;
      this.menu.set(m);
      await this.setTab(Math.max(0, ix), false);
      if (q.get('id')) await this.open(q.get('id')!);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async setTab(i: number, clear = true) {
    this.tabIx.set(i);
    if (clear) this.okMsg.set('');
    this.close();
    this.fStatus.set('');
    this.fText.set('');
    this.impRows.set([]);
    this.impError.set('');
    this.report.set(null);
    this.repMsg.set('');
    this.rp = {};
    const t = this.tab();
    await Promise.all([...new Set(this.refsOf(t))].map((r) => this.loadOpts(r)));
    if (t?.kind === 'entity') await this.load();
    else if (t?.kind === 'report') await this.runReport();
    else if (t?.kind === 'csv') this.data.erpDatasets().subscribe({ next: (l) => this.datasets.set(l), error: (e) => this.error.set(errorText(e)) });
  }

  async load() {
    this.loading.set(true);
    try { this.rows.set(await firstValueFrom(this.data.erpList(this.tab().entity))); } catch (e) { this.error.set(errorText(e)); }
    this.loading.set(false);
  }

  // ---------- form ----------
  openNew() {
    const f: any = { __status: this.def().statuses?.[0] ?? '' };
    for (const x of this.def().fields) f[x.k] = x.def !== undefined ? x.def : x.type === 'multiref' ? [] : x.type === 'bool' ? false : x.type === 'date' && x.k === 'date' ? new Date().toISOString().slice(0, 10) : '';
    this.form = f;
    this.lines = [];
    if (this.def().lines) this.addLine();
    this.cur.set(null);
    this.formError.set('');
    this.okMsg.set('');
    this.confirmDel.set(false);
    this.showForm.set(true);
  }
  addLine() {
    const l: any = {};
    for (const c of this.def().lines.cols) if (!c.calc) l[c.k] = c.def !== undefined ? c.def : '';
    this.lines.push(l);
  }
  close() { this.showForm.set(false); this.cur.set(null); }

  async open(id: string) {
    this.formError.set('');
    try {
      const r = await firstValueFrom(this.data.erpGet(this.tab().entity, id));
      const f: any = { __status: r.status ?? '' };
      for (const x of this.def().fields) f[x.k] = r.data?.[x.k] ?? (x.type === 'multiref' ? [] : x.type === 'bool' ? false : '');
      this.form = f;
      if (this.needsProject()) await this.loadOpts('boq', f.project);
      this.lines = (r.lines ?? []).map((l: any) => ({ ...l }));
      this.cur.set(r);
      this.confirmDel.set(false);
      this.showForm.set(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  async save() {
    this.formError.set('');
    const d = this.def();
    const edit = !!this.cur();
    const data: any = {};
    for (const f of d.fields) {
      if (f.calc) continue;
      let v = this.form[f.k];
      if (f.type === 'multiref') v = v?.length ? v : null;
      else if (f.type === 'bool') v = !!v;
      else if (v === '' || v === undefined) v = null;
      if (v === null && f.req) { this.formError.set(`${f.label} is required.`); return; }
      if (v !== null || edit) data[f.k] = v;
    }
    const body: any = { data };
    if (d.statuses) body.status = this.form.__status;
    if (d.lines) {
      body.lines = this.lines.map((l) => Object.fromEntries(d.lines.cols.filter((c: any) => !c.calc && l[c.k] !== '' && l[c.k] !== null && l[c.k] !== undefined).map((c: any) => [c.k, l[c.k]])))
        .filter((l) => Object.keys(l).some((k) => d.lines.cols.find((c: any) => c.k === k)?.def === undefined));
    }
    this.saving.set(true);
    try {
      const r = edit ? await firstValueFrom(this.data.erpUpdate(this.tab().entity, this.cur().id, body)) : await firstValueFrom(this.data.erpCreate(this.tab().entity, body));
      this.okMsg.set(`✅ ${r.number ? r.number + ' saved' : 'Saved'}${r.status ? ' (' + pretty(r.status) + ')' : ''}.`);
      this.invalidate();
      await this.load();
      await this.open(r.id);
    } catch (e) {
      this.formError.set(errorText(e));
    }
    this.saving.set(false);
  }
  /** lists that this page's own records feed (e.g. products) are re-read after a change */
  private invalidate() {
    const e = this.tab()?.entity;
    if (e) this.optCache.update((c) => { const n = { ...c }; delete n[e]; return n; });
  }

  async remove() {
    this.confirmDel.set(false);
    try {
      await firstValueFrom(this.data.erpDelete(this.tab().entity, this.cur().id));
      this.close();
      this.okMsg.set('🗑️ Deleted.');
      this.invalidate();
      await this.load();
    } catch (e) {
      this.formError.set(errorText(e));
    }
  }

  /** the automatic steps: create RFQ / PO / GRN, email vendors, calculate payroll, award … */
  async act(name: string, body: any) {
    this.formError.set('');
    this.repMsg.set('');
    this.saving.set(true);
    try {
      const r = await firstValueFrom(this.data.erpAction(name, body));
      if (r.open) window.location.href = r.open;
      if (r.goto) {
        await this.router.navigate(['/m', r.goto.menu], { queryParams: { tab: r.goto.entity, id: r.goto.id } });
        if (r.goto.menu === this.menuId) await this.loadMenu(this.menuId);
        this.okMsg.set('✅ ' + r.message);
      } else {
        this.okMsg.set('✅ ' + r.message);
        if (this.tab()?.kind === 'entity') { await this.load(); if (this.cur()) await this.open(this.cur().id); } else await this.runReport(true);
      }
    } catch (e) {
      (this.tab()?.kind === 'entity' ? this.formError : this.repMsg).set(errorText(e));
    }
    this.saving.set(false);
  }

  // ---------- reports ----------
  report = signal<any | null>(null);
  repMsg = signal('');
  rp: Record<string, string> = {};
  async runReport(keepMsg = false) {
    const t = this.tab();
    if (!t || t.kind !== 'report') return;
    const missing = (t.params ?? []).find((p: any) => p.req && !this.rp[p.k]);
    if (missing) { this.report.set(null); this.repMsg.set(`Choose the ${missing.label.toLowerCase()} to see this page.`); return; }
    if (!keepMsg) this.repMsg.set('');
    try {
      this.report.set(await firstValueFrom(this.data.erpReport(t.report, this.rp)));
    } catch (e) {
      this.report.set(null);
      this.repMsg.set(errorText(e));
    }
  }
  chart = computed(() => {
    const c = this.report()?.chart;
    if (!c?.labels?.length) return null;
    const w = 760, h = 300, l = 44, top = 14, bottom = 28;
    const all = c.series.flatMap((s: any) => s.values).filter((v: any) => v !== null && v !== undefined);
    const max = Math.max(c.unit === '%' ? 100 : 1, ...all);
    const X = (i: number) => l + (c.labels.length === 1 ? 0 : (i * (w - l - 20)) / (c.labels.length - 1));
    const Y = (v: number) => top + (h - top - bottom) * (1 - v / max);
    const step = Math.max(1, Math.ceil(c.labels.length / 12));
    return {
      w, h, l, unit: c.unit ?? '',
      grid: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: Y(max * f), v: Math.round(max * f) })),
      xs: c.labels.map((t: string, i: number) => ({ t, x: X(i) })).filter((_: any, i: number) => i % step === 0),
      series: c.series.map((s: any) => {
        const dots = s.values.map((v: any, i: number) => (v === null || v === undefined ? null : { x: X(i), y: Y(v) })).filter(Boolean);
        return { name: s.name, dots, points: dots.map((d: any) => `${d.x},${d.y}`).join(' ') };
      }),
    };
  });
  rowActions(t: any) { return t.rows.some((r: any) => r._action); }
  async reportExcel() { const r = this.report(); (await loadSheets()).tablesToExcel(r.title, r.tables, r.cards ?? []); }
  print() { window.print(); }

  // ---------- CSV ----------
  datasets = signal<any[]>([]);
  async csv(d: any, kind: 'csv' | 'xlsx') {
    try {
      const r = await firstValueFrom(this.data.erpDataset(d.key));
      const s = await loadSheets();
      if (kind === 'csv') s.downloadCsv(r.title, r.columns, r.rows); else s.datasetToExcel(r.title, r.columns, r.rows);
      this.okMsg.set(`✅ ${r.title}: ${r.rows.length} row(s) downloaded.`);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  // ---------- Excel ----------
  impRows = signal<SheetRow[]>([]);
  impError = signal('');
  impFile = signal('');
  importing = signal(false);
  impHeaders = computed(() => [...this.listCols().slice(0, 4).map((f: any) => f.label), this.def().lines ? 'Lines' : '']);
  async exportExcel() { (await loadSheets()).erpExport(this.def(), this.filtered()); }
  async template() { (await loadSheets()).erpTemplate(this.def()); }
  async onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.okMsg.set('');
    this.impError.set('');
    this.impRows.set([]);
    this.impFile.set(file.name);
    try {
      const rows = await (await loadSheets()).erpRead(file, this.def(), (ref, pid) => this.loadOpts(ref, pid));
      this.impRows.set(rows);
      if (!rows.length) this.impError.set('No rows found on the "Data" sheet.');
    } catch (err: any) {
      this.impError.set(err?.message || 'Could not read this file. Please use the Excel Template.');
    }
  }
  async runImport() {
    this.importing.set(true);
    let saved = 0;
    for (const row of this.impRows().filter((r) => r.status === 'ready')) {
      this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saving' } : r)));
      try {
        await firstValueFrom(this.data.erpCreate(this.tab().entity, row.body));
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'saved', message: '' } : r)));
        saved++;
      } catch (err) {
        this.impRows.update((l) => l.map((r) => (r.rowNo === row.rowNo ? { ...r, status: 'failed', message: errorText(err) } : r)));
      }
    }
    this.importing.set(false);
    this.okMsg.set(`✅ Import finished: ${saved} added.`);
    this.invalidate();
    await this.load();
  }
}
