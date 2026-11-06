import { Component, computed, input, model, signal, effect, untracked } from '@angular/core';
import { adToBs, bsToAd } from '../core/nepali-date';

/**
 * Date field with BS and AD side by side. The value is always AD 'YYYY-MM-DD'
 * (what the server stores). Typing a BS date fills the AD date and vice versa.
 * Usage: <app-date-field label="Start Date" [(value)]="form.startDate" />
 */
@Component({
  selector: 'app-date-field',
  standalone: true,
  template: `
    <label>{{ label() }} @if (required()) { <span class="req">*</span> }</label>
    <div class="pair">
      <input class="bs" [value]="bsText()" (input)="onBs($any($event.target).value)"
             placeholder="BS e.g. 2083/07/20" [attr.aria-label]="label() + ' (BS)'" />
      <input class="ad" type="date" [value]="value() || ''" (input)="onAd($any($event.target).value)"
             [attr.aria-label]="label() + ' (AD)'" />
    </div>
    <div class="help" [class.bad]="bsInvalid()">
      {{ bsInvalid() ? 'Not a valid BS date — use YYYY/MM/DD, e.g. 2083/07/20' : 'Left: Bikram Sambat (BS) · Right: AD — fill either one' }}
    </div>
  `,
  styles: [`
    :host { display: block; }
    label { display: block; font-size: 13px; font-weight: 600; color: #1e3a5f; margin-bottom: 6px; }
    .req { color: #dc2626; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    input { width: 100%; box-sizing: border-box; padding: 10px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; background: #fff; color: #1f2937; }
    input:focus { outline: 2px solid #d4a017; border-color: #d4a017; }
    .help { font-size: 11px; color: #9ca3af; margin-top: 4px; }
    .help.bad { color: #b91c1c; }
  `],
})
export class DateField {
  label = input('Date');
  required = input(false);
  value = model<string>('');

  private typedBs = signal<string | null>(null);
  bsInvalid = signal(false);
  bsText = computed(() => this.typedBs() ?? adToBs(this.value()));

  constructor() {
    // When the value is changed from outside (e.g. editing a record), drop the typed text
    effect(() => {
      const v = this.value();
      untracked(() => {
        const typed = this.typedBs();
        if (typed !== null && (bsToAd(typed) === v || (this.bsInvalid() && !v))) return; // user is typing
        if (typed !== null && !typed.trim() && !v) return;
        this.typedBs.set(null);
        this.bsInvalid.set(false);
      });
    });
  }

  onBs(text: string) {
    this.typedBs.set(text);
    if (!text.trim()) {
      this.bsInvalid.set(false);
      this.value.set('');
      return;
    }
    const ad = bsToAd(text);
    this.bsInvalid.set(!ad && text.trim().length >= 8);
    if (ad) {
      this.value.set(ad);
    }
  }

  onAd(ad: string) {
    this.bsInvalid.set(false);
    this.typedBs.set(null);
    this.value.set(ad);
  }
}
