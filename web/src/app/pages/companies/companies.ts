import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';

@Component({
  selector: 'app-companies',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="bar">
      <div>
        <h1>Companies</h1>
        <p class="sub">Your construction companies (the firms that bid on tenders)</p>
      </div>
      @if (!showForm()) {
        <button class="btn gold" (click)="openForm()">+ Add Company</button>
      }
    </div>

    @if (okMsg()) { <div class="msg ok">{{ okMsg() }}</div> }

    @if (showForm()) {
      <form class="panel" (ngSubmit)="save()">
        <h2>New Company</h2>
        @if (formError()) { <div class="msg error">{{ formError() }}</div> }
        <div class="grid">
          <div>
            <label>Company Name <span class="req">*</span></label>
            <input name="name" [(ngModel)]="form.name" placeholder="e.g. Cuidado Construction Pvt. Ltd." required />
          </div>
          <div>
            <label>PAN / VAT No.</label>
            <input name="panVat" [(ngModel)]="form.panVat" placeholder="e.g. 601234567" />
          </div>
          <div>
            <label>License Class</label>
            <select name="licenseClass" [(ngModel)]="form.licenseClass">
              <option value="">— Select —</option>
              <option value="A">Class A</option>
              <option value="B">Class B</option>
              <option value="C">Class C</option>
              <option value="D">Class D</option>
            </select>
          </div>
          <div>
            <label>License Expiry Date</label>
            <input type="date" name="licenseExpiry" [(ngModel)]="form.licenseExpiry" />
            <div class="help">Date in AD (English calendar)</div>
          </div>
          <div>
            <label>Address</label>
            <input name="address" [(ngModel)]="form.address" placeholder="e.g. Baneshwor, Kathmandu" />
          </div>
        </div>
        <div class="actions">
          <button class="btn" type="submit" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Save Company' }}</button>
          <button class="btn light" type="button" (click)="showForm.set(false)">Cancel</button>
        </div>
      </form>
    }

    <div class="panel">
      @if (loading()) {
        <div class="msg info">Loading companies… (the first load can take up to a minute while the server wakes up)</div>
      } @else if (loadError()) {
        <div class="msg error">{{ loadError() }} <a class="link" (click)="load()">Try again</a></div>
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Company Name</th><th>PAN / VAT</th><th>License</th><th>License Expiry</th><th>Address</th><th></th></tr>
            </thead>
            <tbody>
              @for (c of companies(); track c.id) {
                <tr>
                  <td><strong>{{ c.name }}</strong></td>
                  <td>{{ c.panVat || '—' }}</td>
                  <td>@if (c.licenseClass) { <span class="tag gold">Class {{ c.licenseClass }}</span> } @else { — }</td>
                  <td>{{ c.licenseExpiry ? (c.licenseExpiry | date: 'dd MMM yyyy') : '—' }}</td>
                  <td>{{ c.address || '—' }}</td>
                  <td><a class="link" routerLink="/certificates" [queryParams]="{ company: c.id }">Certificates →</a></td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="empty">No companies yet. Click <strong>+ Add Company</strong> to add your first one.</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [UI_STYLES],
})
export class CompaniesPage {
  private data = inject(DataService);

  companies = signal<any[]>([]);
  loading = signal(true);
  loadError = signal('');
  showForm = signal(false);
  saving = signal(false);
  formError = signal('');
  okMsg = signal('');

  form = this.emptyForm();

  constructor() {
    this.load();
  }

  emptyForm() {
    return { name: '', panVat: '', licenseClass: '', licenseExpiry: '', address: '' };
  }

  load() {
    this.loading.set(true);
    this.loadError.set('');
    this.data.getCompanies().subscribe({
      next: (list) => { this.companies.set(list); this.loading.set(false); },
      error: (err) => { this.loadError.set(errorText(err)); this.loading.set(false); },
    });
  }

  openForm() {
    this.form = this.emptyForm();
    this.formError.set('');
    this.okMsg.set('');
    this.showForm.set(true);
  }

  // "Cuidado Construction Pvt. Ltd." -> "cuidado-construction-pvt-ltd"
  private makeSlug(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
  }

  save() {
    const f = this.form;
    if (!f.name.trim()) { this.formError.set('Please enter the company name.'); return; }

    // Only send fields that have a value (the backend rejects empty extras)
    const body: any = { name: f.name.trim(), slug: this.makeSlug(f.name) };
    if (f.panVat.trim()) body.panVat = f.panVat.trim();
    if (f.licenseClass) body.licenseClass = f.licenseClass;
    if (f.licenseExpiry) body.licenseExpiry = f.licenseExpiry;
    if (f.address.trim()) body.address = f.address.trim();

    this.saving.set(true);
    this.formError.set('');
    this.data.createCompany(body).subscribe({
      next: () => {
        this.saving.set(false);
        this.showForm.set(false);
        this.okMsg.set(`✅ "${body.name}" was added.`);
        this.load();
      },
      error: (err) => { this.saving.set(false); this.formError.set(errorText(err)); },
    });
  }
}
