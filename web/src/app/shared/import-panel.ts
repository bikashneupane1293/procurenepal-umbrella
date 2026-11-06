import { Component, computed, input, output } from '@angular/core';
import type { SheetRow } from '../core/sheets';

/** Preview of rows read from an Excel file, with an Import button. The page does the saving. */
@Component({
  selector: 'app-import-panel',
  standalone: true,
  template: `
    <div class="panel">
      <h2>Import from Excel @if (fileName()) { <small class="help">— {{ fileName() }}</small> }</h2>
      @if (error()) { <div class="msg error">{{ error() }}</div> }
      @if (rows().length) {
        <div class="msg info">
          {{ count('ready') }} ready · {{ count('error') }} with problems
          @if (count('saved')) { · <strong>{{ count('saved') }} saved</strong> }
          @if (count('failed')) { · {{ count('failed') }} failed }
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Row</th>@for (h of headers(); track h) { <th>{{ h }}</th> }<th>Status</th></tr></thead>
            <tbody>
              @for (r of rows(); track r.rowNo) {
                <tr>
                  <td>{{ r.rowNo }}</td>
                  @for (c of r.label; track $index) { <td>{{ c }}</td> }
                  <td>
                    @switch (r.status) {
                      @case ('ready') { <span class="tag">Ready</span> }
                      @case ('saving') { <span class="tag gold">Saving…</span> }
                      @case ('saved') { <span class="tag green">Saved</span> }
                      @default { <span class="tag warn">{{ r.status === 'error' ? 'Fix in Excel' : 'Failed' }}</span> }
                    }
                    @if (r.message) { <div class="help err">{{ r.message }}</div> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <div class="actions">
        @if (count('ready') > 0 && !busy()) {
          <button class="btn" (click)="run.emit()">Import {{ count('ready') }} row{{ count('ready') === 1 ? '' : 's' }}</button>
        }
        @if (busy()) { <button class="btn" disabled>Importing… {{ count('saved') + count('failed') }} / {{ total() }}</button> }
        <button class="btn light" (click)="closed.emit()" [disabled]="busy()">Close</button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .panel { background: #fff; border: 1px solid #e1e3e6; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    h2 { margin: 0 0 12px; font-size: 18px; color: #0a1f3d; }
    .help { font-size: 11px; color: #9ca3af; }
    .help.err { color: #b91c1c; max-width: 420px; margin-top: 2px; }
    .msg { padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 14px; }
    .msg.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .msg.info { background: #fef5e0; color: #8a6508; border: 1px solid #f5d98a; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 10px; background: #e8eef6; color: #0a1f3d; white-space: nowrap; }
    td { padding: 8px 10px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
    .tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #e8eef6; color: #1e3a5f; }
    .tag.gold { background: #fef5e0; color: #8a6508; }
    .tag.green { background: #dcfce7; color: #15803d; }
    .tag.warn { background: #fef2f2; color: #b91c1c; }
    .actions { display: flex; gap: 10px; margin-top: 14px; }
    .btn { background: #0a1f3d; color: #fff; border: 0; padding: 10px 18px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 14px; }
    .btn.light { background: #e8eef6; color: #0a1f3d; }
    .btn:disabled { opacity: .6; cursor: wait; }
  `],
})
export class ImportPanel {
  rows = input<SheetRow[]>([]);
  headers = input<string[]>([]);
  fileName = input('');
  error = input('');
  busy = input(false);
  run = output<void>();
  closed = output<void>();
  total = computed(() => this.rows().filter((r) => r.status !== 'error').length);
  count(s: SheetRow['status']) { return this.rows().filter((r) => r.status === s).length; }
}
