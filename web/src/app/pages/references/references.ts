import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccessService } from '../../core/access.service';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { showBoth } from '../../core/nepali-date';

/** Watches a few public pages (PPMO, Nepal Rastra Bank) for changes — a reading aid for
 *  Bolpatra context, never an automatic change to any procurement rule. */
@Component({
  selector: 'app-references',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="bar">
      <div>
        <h1>External References</h1>
        <p class="sub">Public pages watched for changes — PPMO and Nepal Rastra Bank. This only tells you a page changed; nothing here changes any rule in ProcureNepal automatically.</p>
      </div>
      @if (canCheck()) { <button class="btn gold" (click)="check()" [disabled]="busy()">{{ busy() ? 'Checking…' : '🔄 Check now' }}</button> }
    </div>
    @if (error()) { <div class="msg error">{{ error() }}</div> }
    @if (!canCheck()) { <div class="msg info">Checking is scheduled manually by the Owner for now — automatic scheduling is on the "Next works" list.</div> }

    @for (r of refs(); track r.key) {
      <div class="panel">
        <h2>{{ r.label }}</h2>
        <p class="help"><a class="link" [href]="r.url" target="_blank" rel="noopener">{{ r.url }}</a></p>
        @if (r.error) {
          <div class="msg error">Could not read this page: {{ r.error }}</div>
        } @else if (!r.fetchedAt) {
          <div class="msg info">Not checked yet.</div>
        } @else {
          <p>Last checked: {{ both(r.fetchedAt) }} {{ r.changed ? '— ⚠️ changed since the last check' : '— no change since the last check' }}</p>
          @if (r.excerpt) { <div class="excerpt">{{ r.excerpt }}</div> }
        }
      </div>
    }
  `,
  styles: [UI_STYLES, `
    .excerpt { background: #f8f9fa; border-radius: 8px; padding: 12px; font-size: 12px; color: #4b5563; max-height: 160px; overflow: auto; white-space: pre-wrap; }
    .link { color: #0a1f3d; text-decoration: underline; }
  `],
})
export class ReferencesPage {
  private access = inject(AccessService);
  private data = inject(DataService);
  refs = signal<any[]>([]);
  busy = signal(false);
  error = signal('');
  canCheck = () => !!this.access.info()?.canManage;

  constructor() { this.load(); }

  async load() {
    try { this.refs.set(await this.data.listReferences()); } catch (e) { this.error.set(errorText(e)); }
  }
  async check() {
    this.busy.set(true);
    this.error.set('');
    try { this.refs.set(await this.data.checkReferences()); } catch (e) { this.error.set(errorText(e)); }
    this.busy.set(false);
  }
  both(d: any) { return showBoth(String(d)); }
}
