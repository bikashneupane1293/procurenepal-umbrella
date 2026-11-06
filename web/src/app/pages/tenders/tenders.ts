import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { AuthService } from '../../core/auth.service';
import { DateField } from '../../shared/date-field';
import { showBoth } from '../../core/nepali-date';

interface KaRow { name: string; unit: string; quantity: number | null; }

// Criteria the user may override (blank = PPMO default from the rule set)
const CRITERIA_FIELDS: { key: string; label: string; help: string; kind: 'num' | 'bool' | 'sel'; options?: string[] }[] = [
  { key: 'turnoverMultiplier', label: 'Turnover multiplier', help: 'Default 1.5 × annualised estimate', kind: 'num' },
  { key: 'turnoverDivisor', label: 'Turnover average divisor', help: 'Default: years available (max 3)', kind: 'sel', options: ['AVAILABLE_YEARS', 'FIXED'] },
  { key: 'lookbackYears', label: 'Look-back (years)', help: 'Default 10', kind: 'num' },
  { key: 'similarContractPercent', label: 'Similar contract % of estimate', help: 'Default 40', kind: 'num' },
  { key: 'bidCapacityMultiplier', label: 'Bid capacity multiplier (M)', help: 'Default 5 — check the ELI/FIN form', kind: 'num' },
  { key: 'bidCapacityPercent', label: 'Required bid capacity % of estimate', help: 'Default 100 (IFBs say 80–100)', kind: 'num' },
  { key: 'maxRunningContracts', label: 'Running contract limit', help: 'Default 5 (bidder must hold fewer)', kind: 'num' },
  { key: 'jvMinEachPercent', label: 'JV: each partner % of turnover', help: 'Default 25', kind: 'num' },
  { key: 'jvMinLeadPercent', label: 'JV: one partner % of turnover', help: 'Default 40', kind: 'num' },
  { key: 'jvSimilarRule', label: 'JV: similar contract rule', help: 'Default ONE_PARTNER', kind: 'sel', options: ['ONE_PARTNER', 'EACH_AND_ONE'] },
  { key: 'jvKeyActivityRule', label: 'JV: key activity rule', help: 'Default COMBINED', kind: 'sel', options: ['COMBINED', 'ONE_PARTNER'] },
  { key: 'countUnverified', label: 'Count unchecked certificates', help: 'Default Yes (they are flagged)', kind: 'bool' },
  { key: 'applyJvShareToSimilar', label: 'Apply JV share to similar contract', help: 'Default No', kind: 'bool' },
];

@Component({
  selector: 'app-tenders',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, DateField],
  template: `
    <div class="bar">
      <div>
        <h1>Tenders</h1>
        <p class="sub">Tenders you are considering, with their qualification requirements</p>
      </div>
      @if (!showForm()) { <button class="btn gold" (click)="openNew()">+ Add Tender</button> }
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }

    @if (showForm()) {
      <form class="panel" (ngSubmit)="save()">
        <h2>{{ editId() ? 'Edit Tender' : 'New Tender' }}</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }

        <h3>1. Tender details</h3>
        <div class="grid">
          <div><label>IFB / Bid No. <span class="req">*</span></label>
            <input name="ifb" [(ngModel)]="f.ifbNumber" placeholder="e.g. DOR/NCB/W/2083-84/07" /></div>
          <div><label>Project Title <span class="req">*</span></label>
            <input name="title" [(ngModel)]="f.projectTitle" placeholder="e.g. Upgrading of Cuidado Feeder Road" /></div>
          <div><label>Procuring Entity</label>
            <input name="pe" [(ngModel)]="f.procuringEntity" placeholder="e.g. Department of Roads" /></div>
          <div><label>Project Type</label>
            <select name="ptype" [(ngModel)]="f.projectType">
              <option value="">— Select —</option>
              @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
            </select></div>
          <app-date-field label="Publication Date" [(value)]="f.publicationDate" />
          <app-date-field label="Bid Deadline" [required]="true" [(value)]="f.deadlineDate" />
          <div><label>Status</label>
            <select name="status" [(ngModel)]="f.status">
              @for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }
            </select></div>
        </div>

        <h3>2. Cost estimate</h3>
        <div class="grid">
          <div><label>Cost Estimate (NPR)</label>
            <input type="number" min="0" name="v" [(ngModel)]="f.boqAmount" placeholder="e.g. 900000000" />
            <div class="help tax">Enter taxable amount only (excluding VAT and contingencies)</div></div>
          <div><label>Contract Period (months)</label>
            <input type="number" min="1" name="t" [(ngModel)]="f.contractPeriodMonths" placeholder="e.g. 24" />
            <div class="help">Used to annualise the estimate (minimum 12)</div></div>
        </div>

        <h3>3. Qualification requirements (from the IFB / Section III)</h3>
        <div class="grid">
          <div><label>Average Annual Turnover required (NPR)</label>
            <input type="number" min="0" name="rt" [(ngModel)]="f.reqTurnover" [placeholder]="preview().turnover ? 'Calculated: ' + (preview().turnover | number: '1.0-0') : 'From the IFB'" />
            <div class="help tax">Enter taxable amount only (excluding VAT). Leave blank to calculate.</div></div>
          <div><label>Bid Capacity required (NPR)</label>
            <input type="number" min="0" name="rb" [(ngModel)]="f.reqBidCapacity" [placeholder]="preview().capacity ? 'Calculated: ' + (preview().capacity | number: '1.0-0') : 'From the IFB'" />
            <div class="help tax">Enter taxable amount only (excluding VAT). Leave blank to calculate.</div></div>
          <div><label>Similar Contract value (NPR)</label>
            <input type="number" min="0" name="rs" [(ngModel)]="f.reqSimilarValue" [placeholder]="preview().similar ? 'Calculated: ' + (preview().similar | number: '1.0-0') : 'From the IFB'" />
            <div class="help tax">Enter taxable amount only (excluding VAT). Leave blank to calculate.</div></div>
          <div><label>Number of similar contracts</label>
            <input type="number" min="1" max="10" name="rsc" [(ngModel)]="f.reqSimilarCount" placeholder="1" /></div>
          <div><label>Similar = these project types</label>
            <div class="checks">
              @for (t of types; track t) {
                <label class="inline"><input type="checkbox" [checked]="f.reqProjectTypes.includes(t)" (change)="toggleType(t)" /> {{ t }}</label>
              }
            </div>
            <div class="help">None ticked = same as the project type</div></div>
          <div><label>Similar contract description</label>
            <input name="sd" [(ngModel)]="f.similarDescription" placeholder="e.g. Road with asphalt concrete surface" /></div>
          <div><label class="inline"><input type="checkbox" name="cx" [(ngModel)]="f.isComplexWork" /> Complex works</label>
            <div class="help">Above Rs 10 crore, complex works use the interim JV rule: each partner needs a similar contract and one partner the full value.</div></div>
        </div>

        <h4>Key activities (minimum quantity in ONE fiscal year)</h4>
        <div class="table-wrap">
          <table class="acts">
            <thead><tr><th style="width:50%">Item Name</th><th style="width:20%">Unit</th><th class="num" style="width:22%">Quantity</th><th></th></tr></thead>
            <tbody>
              @for (row of kaRows; track $index; let i = $index) {
                <tr>
                  <td><input [name]="'kn' + i" [(ngModel)]="row.name" placeholder="e.g. Asphalt concrete" /></td>
                  <td><input [name]="'ku' + i" [(ngModel)]="row.unit" list="tUnits" placeholder="m³" /></td>
                  <td><input type="number" min="0" [name]="'kq' + i" [(ngModel)]="row.quantity" class="right" placeholder="0" /></td>
                  <td><button type="button" class="btn danger" (click)="removeKa(i)">🗑️</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <datalist id="tUnits">@for (u of units; track u) { <option [value]="u"></option> }</datalist>
        <button type="button" class="btn light" (click)="kaRows.push(emptyKa())">+ Add Row</button>
        <div class="help">Names are matched with the Key Activities table of each certificate (e.g. "Asphalt concrete" matches "Asphalt Concrete (AC)"); units must match (m³ = cum = cu.m).</div>

        <h3>
          <a class="link" (click)="showAdvanced.set(!showAdvanced())">{{ showAdvanced() ? '▾' : '▸' }} 4. Advanced — rule set and overrides</a>
        </h3>
        @if (showAdvanced()) {
          <div class="msg info">Leave a field blank to use the PPMO default. The bid document always takes priority — change a value only when the IFB says something different.</div>
          <div class="grid">
            <div><label>Rule set</label>
              <select name="rs2" [(ngModel)]="f.ruleSetId">
                <option value="">Automatic (by publication date)</option>
                <option value="PPMO-LEGACY">PPMO (before 2083 changes)</option>
                <option value="PPMO-2083-INTERIM">PPMO interim JV notice 2083/01/30</option>
                <option value="PPMO-2083-ACT">Second Amendment Act 2083</option>
              </select></div>
            <div><label>Award method</label>
              <select name="am" [(ngModel)]="f.awardMethod">
                <option value="">Default of the rule set</option>
                <option value="AVERAGE">Closest to average (PPA 2083)</option>
                <option value="LOWEST">Lowest evaluated (World Bank / ADB)</option>
              </select></div>
            @for (c of criteriaFields; track c.key) {
              <div><label>{{ c.label }}</label>
                @if (c.kind === 'num') {
                  <input type="number" min="0" [name]="'cr_' + c.key" [(ngModel)]="crit[c.key]" placeholder="default" />
                } @else if (c.kind === 'bool') {
                  <select [name]="'cr_' + c.key" [(ngModel)]="crit[c.key]">
                    <option value="">default</option><option value="true">Yes</option><option value="false">No</option>
                  </select>
                } @else {
                  <select [name]="'cr_' + c.key" [(ngModel)]="crit[c.key]">
                    <option value="">default</option>
                    @for (o of c.options; track o) { <option [value]="o">{{ o }}</option> }
                  </select>
                }
                <div class="help">{{ c.help }}</div>
              </div>
            }
          </div>
        }

        <h3>5. Notes</h3>
        <textarea name="notes" [(ngModel)]="f.notes" rows="2" placeholder="Anything to remember about this tender"></textarea>

        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : (editId() ? 'Save Changes' : 'Save Tender') }}</button>
          <button class="btn light" type="button" (click)="closeForm()">Cancel</button>
        </div>
      </form>
    }

    @if (confirmDel(); as t) {
      <div class="panel danger-panel">
        <h2>Delete tender "{{ t.ifbNumber }}"?</h2>
        <p>The tender and all its saved qualification results will be deleted. This cannot be undone.</p>
        <div class="actions">
          <button class="btn del" (click)="remove(t)">Delete permanently</button>
          <button class="btn light" (click)="confirmDel.set(null)">Cancel</button>
        </div>
      </div>
    }

    <div class="panel">
      @if (loading()) {
        <div class="msg info">Loading tenders… (the first load can take up to a minute while the server wakes up)</div>
      } @else if (loadError()) {
        <div class="msg error">{{ loadError() }} <a class="link" (click)="load()">Try again</a></div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead><tr><th>IFB No.</th><th>Project</th><th>Deadline</th><th class="num">Estimate (NPR)</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (t of tenders(); track t.id) {
                <tr>
                  <td><strong>{{ t.ifbNumber }}</strong></td>
                  <td>{{ t.projectTitle }}<div class="help">{{ t.procuringEntity || '' }} @if (t.projectType) { · {{ t.projectType }} }</div></td>
                  <td>{{ both(t.deadlineDate) }}</td>
                  <td class="num">{{ t.boqAmount != null ? (num(t.boqAmount) | number: '1.0-0') : '—' }}</td>
                  <td><span class="tag" [class.green]="t.status === 'won'" [class.gold]="t.status === 'active'">{{ t.status }}</span></td>
                  <td class="row-actions">
                    <a class="btn small" [routerLink]="['/tenders', t.id]">Check qualification →</a>
                    <button class="btn light small" (click)="openEdit(t)">Edit</button>
                    @if (canDelete) { <button class="btn danger" (click)="confirmDel.set(t)">Delete</button> }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="empty">No tenders yet. Click <strong>+ Add Tender</strong> and copy the requirements from the bid document.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES, `
    h3 { font-size: 14px; color: #b8860b; text-transform: uppercase; letter-spacing: .04em; margin: 22px 0 10px; padding-top: 14px; border-top: 1px solid #eef0f2; }
    form h3:first-of-type { border-top: 0; padding-top: 0; margin-top: 4px; }
    h4 { font-size: 13px; color: #1e3a5f; margin: 18px 0 8px; }
    .help.tax { color: #b8860b; }
    .checks { display: flex; flex-wrap: wrap; gap: 10px; }
    label.inline { display: inline-flex; gap: 6px; align-items: center; font-weight: 500; }
    label.inline input { width: auto; }
    table.acts td { padding: 6px; border-bottom: 0; }
    input.right { text-align: right; }
    textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    .row-actions { white-space: nowrap; }
    .row-actions .btn { margin-left: 6px; text-decoration: none; display: inline-block; }
    .btn.small { padding: 6px 12px; }
    .danger-panel { border: 2px solid #fecaca; background: #fffafa; }
    .danger-panel h2 { color: #b91c1c; }
    .btn.del { background: #dc2626; }
  `],
})
export class TendersPage {
  private data = inject(DataService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  canDelete = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'].includes(this.auth.getUser()?.role);
  types = ['ROAD', 'BUILDING', 'IRRIGATION', 'BRIDGE'];
  statuses = ['active', 'submitted', 'won', 'lost', 'cancelled', 'archived'];
  units = ['m³', 'm²', 'm', 'km', 'MT', 'kg', 'Nos', 'RM', 'L'];
  criteriaFields = CRITERIA_FIELDS;

  tenders = signal<any[]>([]);
  loading = signal(true);
  loadError = signal('');
  okMsg = signal('');
  showForm = signal(false);
  showAdvanced = signal(false);
  saving = signal(false);
  formError = signal('');
  editId = signal('');
  confirmDel = signal<any | null>(null);

  f = this.emptyForm();
  kaRows: KaRow[] = [this.emptyKa()];
  crit: Record<string, any> = {};

  // live preview of calculated requirements (plain method: the form is a plain object)
  preview() {
    const V = Number(this.f.boqAmount) || 0;
    const T = Math.max(12, Number(this.f.contractPeriodMonths) || 12);
    const tm = Number(this.crit['turnoverMultiplier']) || 1.5;
    const bp = Number(this.crit['bidCapacityPercent']) || 100;
    const sp = Number(this.crit['similarContractPercent']) || 40;
    return V > 0 ? { turnover: (tm * V * 12) / T, capacity: (bp / 100) * V, similar: (sp / 100) * V } : { turnover: 0, capacity: 0, similar: 0 };
  }

  constructor() {
    this.load();
  }

  emptyForm() {
    return {
      ifbNumber: '', projectTitle: '', procuringEntity: '', projectType: '',
      publicationDate: '', deadlineDate: '', status: 'active',
      boqAmount: null as number | null, contractPeriodMonths: null as number | null,
      reqTurnover: null as number | null, reqBidCapacity: null as number | null,
      reqSimilarValue: null as number | null, reqSimilarCount: null as number | null,
      reqProjectTypes: [] as string[], similarDescription: '', isComplexWork: false,
      ruleSetId: '', awardMethod: '', notes: '',
    };
  }
  emptyKa(): KaRow { return { name: '', unit: '', quantity: null }; }

  num(v: any) { return v == null ? 0 : Number(v); }
  both(d: any) { return showBoth(d); }

  load() {
    this.loading.set(true);
    this.loadError.set('');
    this.data.getTenders().subscribe({
      next: (list) => {
        this.tenders.set(list);
        this.loading.set(false);
        const edit = this.route.snapshot.queryParamMap.get('edit');
        if (edit) {
          const t = list.find((x) => x.id === edit);
          if (t) this.openEdit(t);
          this.router.navigate([], { queryParams: {} });
        }
      },
      error: (err) => { this.loadError.set(errorText(err)); this.loading.set(false); },
    });
  }

  openNew() {
    this.editId.set('');
    this.f = this.emptyForm();
    this.kaRows = [this.emptyKa()];
    this.crit = {};
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
  }

  openEdit(t: any) {
    this.editId.set(t.id);
    const d = (x: any) => (x ? String(x).slice(0, 10) : '');
    const n = (x: any) => (x == null ? null : Number(x));
    this.f = {
      ifbNumber: t.ifbNumber ?? '', projectTitle: t.projectTitle ?? '', procuringEntity: t.procuringEntity ?? '',
      projectType: t.projectType ?? '', publicationDate: d(t.publicationDate), deadlineDate: d(t.deadlineDate),
      status: t.status ?? 'active', boqAmount: n(t.boqAmount), contractPeriodMonths: n(t.contractPeriodMonths),
      reqTurnover: n(t.reqTurnover), reqBidCapacity: n(t.reqBidCapacity), reqSimilarValue: n(t.reqSimilarValue),
      reqSimilarCount: n(t.reqSimilarCount), reqProjectTypes: [...(t.reqProjectTypes ?? [])],
      similarDescription: t.similarDescription ?? '', isComplexWork: !!t.isComplexWork,
      ruleSetId: t.ruleSetId ?? '', awardMethod: t.awardMethod ?? '', notes: t.notes ?? '',
    };
    this.kaRows = (Array.isArray(t.keyActivityReqs) && t.keyActivityReqs.length ? t.keyActivityReqs : [this.emptyKa()])
      .map((a: any) => ({ name: a.name ?? '', unit: a.unit ?? '', quantity: a.quantity ?? null }));
    this.crit = {};
    for (const [k, v] of Object.entries(t.criteria ?? {})) this.crit[k] = typeof v === 'boolean' ? String(v) : v;
    this.showAdvanced.set(Object.keys(this.crit).length > 0 || !!t.ruleSetId || !!t.awardMethod);
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeForm() { this.showForm.set(false); this.editId.set(''); }

  toggleType(t: string) {
    const list = this.f.reqProjectTypes;
    this.f.reqProjectTypes = list.includes(t) ? list.filter((x) => x !== t) : [...list, t];
  }
  removeKa(i: number) {
    this.kaRows.splice(i, 1);
    if (!this.kaRows.length) this.kaRows.push(this.emptyKa());
  }

  private has(v: any) { return v !== null && v !== undefined && v !== ''; }

  /** Build the request body. For edits, blank fields are sent as null so they are cleared. */
  buildBody(isEdit: boolean): any | string {
    const f = this.f;
    if (!f.ifbNumber.trim()) return 'Please enter the IFB / bid number.';
    if (!f.projectTitle.trim()) return 'Please enter the project title.';
    if (!f.deadlineDate) return 'Please enter the bid deadline (BS or AD).';
    if (f.publicationDate && f.publicationDate > f.deadlineDate) return 'Publication date cannot be after the deadline.';

    const filled = this.kaRows.filter((r) => r.name.trim() || r.unit.trim() || this.has(r.quantity));
    for (const [i, r] of filled.entries()) {
      if (!r.name.trim() || !r.unit.trim() || !this.has(r.quantity) || Number(r.quantity) <= 0) {
        return `Key activity row ${i + 1}: fill Item Name, Unit and a Quantity above 0 (or delete the row).`;
      }
    }

    const body: any = {
      ifbNumber: f.ifbNumber.trim(),
      projectTitle: f.projectTitle.trim(),
      deadlineDate: f.deadlineDate,
      status: f.status,
      isComplexWork: !!f.isComplexWork,
      reqProjectTypes: f.reqProjectTypes,
      keyActivityReqs: filled.map((r) => ({ name: r.name.trim(), unit: r.unit.trim(), quantity: Number(r.quantity) })),
    };
    const text = { procuringEntity: f.procuringEntity, projectType: f.projectType, similarDescription: f.similarDescription, notes: f.notes, ruleSetId: f.ruleSetId, awardMethod: f.awardMethod };
    for (const [k, v] of Object.entries(text)) {
      if (String(v ?? '').trim()) body[k] = String(v).trim();
      else if (isEdit) body[k] = null;
    }
    if (f.publicationDate) body.publicationDate = f.publicationDate;
    else if (isEdit) body.publicationDate = null;
    const nums = { boqAmount: f.boqAmount, contractPeriodMonths: f.contractPeriodMonths, reqTurnover: f.reqTurnover, reqBidCapacity: f.reqBidCapacity, reqSimilarValue: f.reqSimilarValue, reqSimilarCount: f.reqSimilarCount };
    for (const [k, v] of Object.entries(nums)) {
      if (this.has(v)) {
        const n = Number(v);
        if (!isFinite(n) || n < 0) return `Please check the number in "${k}".`;
        body[k] = ['contractPeriodMonths', 'reqSimilarCount'].includes(k) ? Math.round(n) : n;
      } else if (isEdit) body[k] = null;
    }
    const criteria: any = {};
    for (const c of CRITERIA_FIELDS) {
      const v = this.crit[c.key];
      if (!this.has(v)) continue;
      if (c.kind === 'num') {
        const n = Number(v);
        if (!isFinite(n) || n < 0) return `Please check "${c.label}".`;
        criteria[c.key] = ['lookbackYears', 'maxRunningContracts'].includes(c.key) ? Math.round(n) : n;
      } else if (c.kind === 'bool') criteria[c.key] = v === true || v === 'true';
      else criteria[c.key] = v;
    }
    body.criteria = criteria;
    return body;
  }

  save() {
    const isEdit = !!this.editId();
    const body = this.buildBody(isEdit);
    if (typeof body === 'string') { this.formError.set(body); return; }
    this.saving.set(true);
    this.formError.set('');
    const req = isEdit ? this.data.updateTender(this.editId(), body) : this.data.createTender(body);
    req.subscribe({
      next: (t) => {
        this.saving.set(false);
        this.showForm.set(false);
        this.editId.set('');
        this.okMsg.set(isEdit ? `✅ Tender "${body.ifbNumber}" was updated.` : `✅ Tender "${body.ifbNumber}" was added. Click "Check qualification →" to see which companies qualify.`);
        this.load();
      },
      error: (err) => { this.saving.set(false); this.formError.set(errorText(err)); },
    });
  }

  remove(t: any) {
    this.data.deleteTender(t.id).subscribe({
      next: () => { this.confirmDel.set(null); this.okMsg.set(`🗑️ Tender "${t.ifbNumber}" was deleted.`); this.load(); },
      error: (err) => { this.confirmDel.set(null); this.loadError.set(errorText(err)); },
    });
  }
}
