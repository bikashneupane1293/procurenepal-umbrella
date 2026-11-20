import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DataService, errorText } from '../../core/data.service';
import { UI_STYLES } from '../../core/ui-styles';
import { QualResult, verdictText } from '../../shared/qual-result';
import { showBoth } from '../../core/nepali-date';
import { STATUS_LABEL } from '../../core/bid-labels';
import { readPdfText } from '../../core/pdf-reader';
import { parseTenderText, findDocumentChecklist, checklistFromClause21, findKeyClauses, estimateExcludingVat, ChecklistItem, ClauseFind, Suggestions } from '../../core/pdf-parse';
import { tablesToExcel } from '../../core/erp-sheets';
import { extractRequirements, pdfReadNote, FoundRequirement, KIND_LABEL, RequirementKind } from '../../core/pdf-requirements';
// Phase 1B: experimental table reconstruction — additive only. Never imported by, or imported
// into, pdf-reader.ts/pdf-parse.ts; the flat extraction above is untouched and remains the
// default. This is called only when the local, disabled-by-default toggle below is turned on.
import { findAnchorTableInPdf, checklistFromDocumentTable, DocumentTableResult } from '../../core/pdf-table-reconstruct';

const loadReport = () => import('../../core/report');

interface JvRow { companyId: string; share: number | null; }

@Component({
  selector: 'app-tender-detail',
  standalone: true,
  imports: [FormsModule, DecimalPipe, RouterLink, QualResult],
  template: `
    <div class="bar no-print">
      <div>
        <a class="link" routerLink="/tenders">← All tenders</a>
      </div>
      @if (tender()) {
        <div class="tools">
          <a class="btn light" [routerLink]="['/tenders']" [queryParams]="{ edit: tender().id }">Edit requirements</a>
          <button class="btn light" (click)="exportExcel()" [disabled]="!reportResults().length">⬇ Excel report</button>
          <button class="btn light" (click)="print()" [disabled]="!reportResults().length">🖨 Print</button>
        </div>
      }
    </div>

    @if (loadError()) { <div class="msg error">{{ loadError() }}</div> }
    @if (!tender() && !loadError()) { <div class="msg info">Loading tender… (the first load can take up to a minute while the server wakes up)</div> }

    @if (tender(); as t) {
      <h1>{{ t.ifbNumber }}</h1>
      <p class="sub">{{ t.projectTitle }}@if (t.procuringEntity) { · {{ t.procuringEntity }} }</p>

      <div class="panel">
        <h2>Requirements</h2>
        <div class="facts">
          <div><span>Deadline</span><strong>{{ both(t.deadlineDate) }}</strong></div>
          <div><span>Cost estimate</span><strong>{{ t.boqAmount != null ? 'Rs ' + (num(t.boqAmount) | number: '1.0-0') : '—' }}</strong></div>
          <div><span>Contract period</span><strong>{{ t.contractPeriodMonths ? t.contractPeriodMonths + ' months' : '—' }}</strong></div>
          <div><span>Turnover</span><strong>{{ t.reqTurnover != null ? 'Rs ' + (num(t.reqTurnover) | number: '1.0-0') : calc('turnover') }}</strong></div>
          <div><span>Bid capacity</span><strong>{{ t.reqBidCapacity != null ? 'Rs ' + (num(t.reqBidCapacity) | number: '1.0-0') : calc('capacity') }}</strong></div>
          <div><span>Similar contract</span><strong>{{ t.reqSimilarValue != null ? 'Rs ' + (num(t.reqSimilarValue) | number: '1.0-0') : calc('similar') }}{{ t.reqSimilarCount > 1 ? ' × ' + t.reqSimilarCount : '' }}</strong></div>
          <div><span>Type</span><strong>{{ t.projectType || '—' }}{{ t.isComplexWork ? ' · complex' : '' }}</strong></div>
        </div>
        @if (t.keyActivityReqs?.length) {
          <div class="kas">Key activities (one fiscal year):
            @for (k of t.keyActivityReqs; track $index) { <span class="tag">{{ k.name }} — {{ k.quantity | number: '1.0-2' }} {{ k.unit }}</span> }
          </div>
        }
        @if (!hasRequirements()) {
          <div class="msg info" style="margin-top:12px">This tender has no cost estimate or requirements yet, so only the licence and running contracts can be checked. <a class="link" [routerLink]="['/tenders']" [queryParams]="{ edit: t.id }">Add requirements →</a></div>
        }
      </div>

      @if (savedReqs().length) {
        <div class="panel no-print">
          <div class="bar tight">
            <h2>📋 Requirements read from the bidding document</h2>
            <div class="tools">
              <button class="btn light small" (click)="applySavedToTender()" [disabled]="reqBusy() || !confirmedCount()">Use confirmed values in the requirements above</button>
            </div>
          </div>
          <p class="help">{{ confirmedCount() }} of {{ savedReqs().length }} confirmed. Unconfirmed rows still need checking against the document — tick ✔ once you have.</p>
          @if (reqMsg()) { <div class="msg info">{{ reqMsg() }}</div> }
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Checked</th><th>Requirement</th><th>Read from</th><th></th></tr></thead>
            <tbody>
              @for (r of savedReqs(); track r.id) {
                <tr [class.bad]="r.needsVerification">
                  <td><input type="checkbox" [checked]="!r.needsVerification" (change)="confirmSaved(r, $any($event.target).checked)" [disabled]="reqBusy()" title="I checked this against the document" /></td>
                  <td><span class="tag">{{ kindLabel(r.kind) }}</span> {{ r.label }}
                    @if (r.confirmedAt) { <div class="muted">Confirmed {{ r.confirmedAt.slice(0, 10) }}</div> }</td>
                  <td class="muted src">{{ r.sourceText || '—' }}</td>
                  <td><button class="btn light small" (click)="deleteSaved(r)" [disabled]="reqBusy()">Remove</button></td>
                </tr>
              }
            </tbody>
          </table></div>
        </div>
      }

      <div class="panel no-print">
        <h2>📄 Bid Document Reader</h2>
        <p class="help">Upload the full bid document (PDF) to read the values it states and get a draft readiness checklist. This is a reading aid, not a compliance check — verify every row against the actual document before submission.</p>
        <input type="file" accept="application/pdf" (change)="onPdfChosen($event)" [disabled]="pdfBusy()" />
        @if (pdfBusy()) { <div class="msg info" style="margin-top:8px">{{ pdfProgress() || 'Reading the PDF…' }} Large documents can take a little while.</div> }
        @if (pdfNote()) { <div class="msg info" style="margin-top:8px">⚠️ {{ pdfNote() }}</div> }
        @if (pdfError()) { <div class="msg error" style="margin-top:8px">{{ pdfError() }}</div> }
        @if (pdfScanned()) { <div class="msg error" style="margin-top:8px">This looks like a scanned PDF (no selectable text), so nothing could be read automatically.</div> }

        @if (suggestions(); as sug) {
          <h3 style="margin-top:16px">Values found in the document</h3>
          <table class="tbl">
            <thead><tr><th>Field</th><th>Found value</th><th>Where (nearby text)</th></tr></thead>
            <tbody>
              @for (k of suggestionKeys(); track k) {
                <tr><td>{{ k }}</td><td>{{ sug[k].value }}</td><td class="muted">{{ sug[k].line }}</td></tr>
              }
            </tbody>
          </table>
          <p class="help">Compare these with the "Requirements" box above and use "Edit requirements" to correct anything.</p>
        }

        @if (reqFound(); as rf) {
          <h3 style="margin-top:16px">📋 Requirements found in this document</h3>
          @if (rf.length) {
            <p class="help">Read from the IFB, the Bid Data Sheet and Section III (qualification criteria). Untick anything wrong, correct the wording if needed, and tick <strong>Checked</strong> for rows you have verified against the document. Saving replaces the rows saved for this tender before.</p>
            <div class="table-wrap"><table class="tbl">
              <thead><tr><th>Save</th><th>Checked</th><th>Requirement</th><th>Confidence</th><th>Read from</th></tr></thead>
              <tbody>
                @for (r of rf; track $index) {
                  <tr [class.bad]="r.confidence < 0.6">
                    <td><input type="checkbox" [(ngModel)]="r.use" /></td>
                    <td><input type="checkbox" [(ngModel)]="r.confirmed" [disabled]="!r.use" /></td>
                    <td><span class="tag">{{ kindLabel(r.kind) }}</span>
                      <input class="lbl" [(ngModel)]="r.label" [disabled]="!r.use" />
                      @if (r.note) { <div class="muted">{{ r.note }}</div> }</td>
                    <td><span [class]="'conf ' + confTone(r.confidence)">{{ r.confidence * 100 | number: '1.0-0' }}%</span></td>
                    <td class="muted src">{{ r.sourceText }}</td>
                  </tr>
                }
              </tbody>
            </table></div>
            <div class="tools" style="margin-top:10px">
              <button class="btn gold" (click)="saveFound()" [disabled]="reqBusy() || !useCount()">{{ reqBusy() ? 'Saving…' : 'Save ' + useCount() + ' to this tender' }}</button>
            </div>
            @if (reqSaveMsg()) { <div class="msg info" style="margin-top:8px">{{ reqSaveMsg() }}</div> }
          } @else {
            <div class="msg info">No qualification requirements were recognised in this document. If it is the full bidding document, open "Show extracted text" below and check that Section III reads properly — then send us the PDF so the reader can learn its layout.</div>
          }
        }

        @if (estimateVat(); as ev) {
          @if (ev.note) { <div class="msg info" style="margin-top:10px">Estimate excluding VAT: <strong>{{ ev.value | number: '1.0-0' }}</strong>. {{ ev.note }}</div> }
        }

        @if (keyClauses(); as kc) {
          <h3 style="margin-top:16px">Clauses you asked to always check</h3>
          <table class="tbl">
            <thead><tr><th></th><th>Clause</th><th>Text found</th></tr></thead>
            <tbody>
              @for (c of kc; track c.ref) {
                <tr [class.bad]="!c.found"><td>{{ c.found ? '✅' : '⚠️' }}</td><td>{{ c.ref }}<div class="muted">{{ c.title }}</div></td><td class="muted">{{ c.found ? c.text : 'Not found — check manually' }}</td></tr>
              }
            </tbody>
          </table>
        }

        @if (checklist(); as cl) {
          <h3 style="margin-top:16px">Bid readiness checklist</h3>
          <p class="help">{{ clause21Note() }}</p>
          <table class="tbl">
            <thead><tr><th></th><th>Document / requirement</th><th>{{ checklistColumnTitle() }}</th></tr></thead>
            <tbody>
              @for (c of cl; track c.key) {
                <tr [class.bad]="!c.found"><td>{{ c.found ? '✅' : '⚠️' }}</td><td>{{ c.label }}</td><td class="muted">{{ c.found ? c.line : 'Not found — check manually' }}</td></tr>
              }
            </tbody>
          </table>
          <div class="tools" style="margin-top:10px">
            <button class="btn light" (click)="saveChecklist()" [disabled]="checklistSaved()">{{ checklistSaved() ? '✅ Saved to this tender' : 'Save checklist to this tender' }}</button>
            <button class="btn light" (click)="exportChecklist()">⬇ Excel checklist</button>
          </div>
        }

        @if (rawPdfText()) {
          <div style="margin-top:16px">
            <button class="btn light" (click)="showRawText.set(!showRawText())">{{ showRawText() ? 'Hide extracted text' : 'Show extracted text (to check what was read)' }}</button>
            @if (showRawText()) {
              <p class="help" style="margin-top:6px">This is exactly what was read from the PDF, before any field matching. If a value above looks wrong or missing, search for it here — if it's garbled or missing here too, that's a reading problem to report; if it reads fine here but wasn't picked up above, that's a matching-rule problem.</p>
              <textarea readonly rows="14" style="width:100%;font-family:monospace;font-size:12px;white-space:pre-wrap">{{ rawPdfText() }}</textarea>
            }
          </div>
        }

        <div class="exp-toggle">
          <label><input type="checkbox" [checked]="experimentalTableReader()" (change)="experimentalTableReader.set($any($event.target).checked)" /> 🧪 Enable experimental table reader</label>
          <span class="muted">Scans the PDF for tables like the ITB 21 document checklist and shows them separately. Off by default; does not change anything above.</span>
        </div>

        @if (experimentalTableReader() && hasPdfFile()) {
          <div class="panel exp-panel" style="margin-top:12px">
            <h3>🧪 Experimental: reconstructed table</h3>
            <p class="help">Reading aid only — not used for any qualification or eligibility decision. The readiness checklist above uses this table only when the document's Clause 21 has no item list of its own, and then says so (with page and read confidence). Compare it against "Show extracted text" above before relying on it.</p>
            <button class="btn light" (click)="tryExperimentalTableReader()" [disabled]="experimentalBusy()">{{ experimentalBusy() ? 'Scanning pages…' : (experimentalTried() ? 'Scan again' : 'Scan this PDF for a table') }}</button>

            @if (experimentalError()) { <div class="msg error" style="margin-top:8px">{{ experimentalError() }}</div> }

            @if (experimentalTried() && !experimentalBusy() && !experimentalError()) {
              @if (experimentalResult(); as er) {
                <div class="msg info" style="margin-top:10px">
                  Found on page {{ er.pageNumber }} — detected section: <em>{{ er.table.headerText || '(header text not captured)' }}</em> — confidence {{ (er.table.confidence * 100) | number: '1.0-0' }}%
                </div>
                @if (er.table.warnings.length) {
                  <div class="msg info" style="margin-top:6px">⚠️ {{ er.table.warnings.join('; ') }}</div>
                }
                <table class="tbl" style="margin-top:10px">
                  <thead><tr>
                    @for (col of er.table.columns; track col.index) { <th>{{ er.table.headers?.[col.index] || ('Column ' + (col.index + 1)) }}</th> }
                  </tr></thead>
                  <tbody>
                    @for (row of er.table.rows; track row.rowIndex) {
                      <tr [class.bad]="row.confidence < 0.7">
                        @for (c of row.cells; track c.columnIndex) { <td class="muted">{{ c.text || '—' }}</td> }
                      </tr>
                    }
                  </tbody>
                </table>
                <p class="help" style="margin-top:6px">Rows highlighted are below 0.7 confidence — a wrapped line landed close to a row boundary; verify those against "Show extracted text" above.</p>
              } @else {
                <div class="msg info" style="margin-top:10px">No table matching this pattern was found on any scanned page. The original extracted text above is unaffected — this experimental reader found nothing to add.</div>
              }
            }
          </div>
        }
      </div>

      <!-- Bid information (Task 1) -->
      <div class="panel no-print">
        <div class="bar tight">
          <h2>Bid information</h2>
          <a class="btn light small" routerLink="/bids" [queryParams]="{ tender: t.id }">+ Create bid record</a>
        </div>
        @if (tenderBids().length) {
          <div class="table-wrap"><table>
            <thead><tr><th>Bidder</th><th>Decision</th><th>Status</th><th class="num">Bid (NPR)</th><th>Checklist</th><th></th></tr></thead>
            <tbody>
              @for (b of tenderBids(); track b.id) {
                <tr>
                  <td>{{ b.company?.name }} @if (b.bidderType === 'JV') { <span class="tag gold">JV</span> }</td>
                  <td>{{ b.decision === 'NO_BID' ? 'No bid' : b.decision === 'BID' ? 'Bid' : 'Undecided' }}</td>
                  <td><span class="tag">{{ statusLabel(b.status) }}</span></td>
                  <td class="num">{{ b.bidAmount != null ? (num(b.bidAmount) | number: '1.0-0') : '—' }}</td>
                  <td>{{ (b.checklist ?? []).filter(isDone).length }}/{{ (b.checklist ?? []).length }}</td>
                  <td><a class="link" routerLink="/bids" [queryParams]="{ bid: b.id }">Open →</a></td>
                </tr>
              }
            </tbody>
          </table></div>
        } @else {
          <p class="help">No bid record yet. Create one to track the bid / no-bid decision, bid security, document checklist and the result.</p>
        }
      </div>

      <!-- 1. Company-wide bid decision -->
      <div class="panel no-print-break">
        <div class="bar tight">
          <h2>1. Which of my companies qualify?</h2>
          <button class="btn gold no-print" (click)="checkAll()" [disabled]="busy() === 'all'">{{ busy() === 'all' ? 'Checking…' : '✅ Check all companies' }}</button>
        </div>
        @if (allError()) { <div class="msg error">{{ allError() }}</div> }
        @if (all(); as a) {
          <div class="counts">
            <span class="tag green">{{ a.counts.INDIVIDUAL_ELIGIBLE }} eligible alone</span>
            <span class="tag gold">{{ a.counts.JV_REQUIRED }} need a JV</span>
            <span class="tag red">{{ a.counts.NOT_ELIGIBLE }} not eligible</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Result</th><th>Why</th><th class="num">Fails</th><th class="num">Warnings</th><th class="no-print"></th></tr></thead>
              <tbody>
                @for (r of a.results; track r.companyId) {
                  <tr [class.sel]="selected()?.companyId === r.companyId && !selected()?.partners">
                    <td><strong>{{ r.companyName }}</strong></td>
                    <td><span class="verdict" [class]="tone(r.result)">{{ label(r.result) }}</span></td>
                    <td class="why">{{ r.summary }}</td>
                    <td class="num">{{ fails(r) }}</td>
                    <td class="num">{{ r.warnings.length }}</td>
                    <td class="no-print row-actions">
                      <button class="btn light small" (click)="selected.set(r)">Details</button>
                      @if (r.result === 'JV_REQUIRED') { <button class="btn light small" (click)="findPartners(r.companyId)">Find JV partner</button> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (busy() !== 'all') {
          <p class="help">Checks every company in your workspace against this tender and saves the results.</p>
        }
      </div>

      @if (selected(); as s) {
        <div class="panel">
          <div class="bar tight">
            <h2>Details — {{ s.companyName ?? jvName(s) }}</h2>
            <button class="btn light small no-print" (click)="selected.set(null)">Close</button>
          </div>
          <app-qual-result [result]="s" />
        </div>
      }

      <!-- 2. JV builder -->
      <div class="panel no-print">
        <h2>2. Check a Joint Venture</h2>
        @if (jvError()) { <div class="msg error">{{ jvError() }}</div> }
        <div class="table-wrap">
          <table class="jv">
            <thead><tr><th>Lead</th><th>Partner company</th><th class="num">Share %</th><th></th></tr></thead>
            <tbody>
              @for (row of jvRows; track $index; let i = $index) {
                <tr>
                  <td><input type="radio" name="lead" [checked]="leadIndex === i" (change)="leadIndex = i" /></td>
                  <td><select [name]="'jvc' + i" [(ngModel)]="row.companyId">
                    <option value="">— Select company —</option>
                    @for (c of companies(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
                  </select></td>
                  <td><input type="number" min="1" max="99" [name]="'jvs' + i" [(ngModel)]="row.share" class="right" /></td>
                  <td>@if (jvRows.length > 2) { <button class="btn danger" (click)="removeJvRow(i)">🗑️</button> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="help">Shares must add up to 100% (now {{ shareTotal() }}%). PPMO default: up to 3 partners; each partner needs 25% of the turnover requirement and one partner 40%.</div>
        <div class="actions">
          @if (jvRows.length < 3) { <button class="btn light" (click)="jvRows.push({ companyId: '', share: null })">+ Add partner</button> }
          <button class="btn" (click)="checkJv()" [disabled]="busy() === 'jv'">{{ busy() === 'jv' ? 'Checking…' : '🤝 Check this JV' }}</button>
        </div>
      </div>

      @if (partners(); as p) {
        <div class="panel no-print">
          <div class="bar tight">
            <h2>Best JV partners for {{ p.companyName }}</h2>
            <button class="btn light small" (click)="partners.set(null)">Close</button>
          </div>
          <p class="help">{{ p.note }}</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Partner</th><th>Lead</th><th>Result</th><th class="num">Combined turnover</th><th>Why</th><th></th></tr></thead>
              <tbody>
                @for (s of p.suggestions; track s.partnerId) {
                  <tr>
                    <td><strong>{{ s.partnerName }}</strong></td>
                    <td>{{ s.lead }} (60%)</td>
                    <td><span class="verdict" [class]="tone(s.result)">{{ label(s.result) }}</span></td>
                    <td class="num">{{ s.combinedTurnover | number: '1.0-0' }}</td>
                    <td class="why">{{ s.summary }}</td>
                    <td><button class="btn light small" (click)="useSuggestion(p.companyId, s)">Use this JV</button></td>
                  </tr>
                } @empty { <tr><td colspan="6" class="empty">You need at least two companies in your workspace.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- 3. History -->
      <div class="panel">
        <div class="bar tight">
          <h2>3. Saved results (history)</h2>
          <button class="btn light small no-print" (click)="loadHistory()">↻ Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Result</th><th>Explanation</th><th>Rule set</th><th>Checked on</th><th class="no-print"></th></tr></thead>
            <tbody>
              @for (h of history(); track h.id) {
                <tr>
                  <td>{{ h.companyName }}</td>
                  <td><span class="verdict" [class]="tone(h.result)">{{ label(h.result) }}</span></td>
                  <td class="why">{{ h.explanation }}</td>
                  <td>{{ h.ruleSetId || '—' }}</td>
                  <td>{{ both(h.calculatedAt) }}</td>
                  <td class="no-print">@if (h.checks) { <button class="btn light small" (click)="showHistory(h)">Details</button> }</td>
                </tr>
              } @empty { <tr><td colspan="6" class="empty">No saved results yet — click "Check all companies".</td></tr> }
            </tbody>
          </table>
        </div>
      </div>

      <p class="print-only foot">ProcureNepal · © Cuidado Technology Pvt. Ltd. · This report is a guide calculated from the data entered and the default PPMO rules. The bid document always takes priority. Not legal advice.</p>
    }
  `,
  styles: [UI_STYLES, `
    input.lbl { width: 100%; margin-top: 4px; font-size: 13px; padding: 4px 6px; }
    td.src { font-size: 12px; max-width: 360px; }
    .conf { font-weight: 800; font-size: 12px; padding: 2px 6px; border-radius: 8px; }
    .conf.hi { background: #dcfce7; color: #15803d; }
    .conf.mid { background: #fef5e0; color: #8a6508; }
    .conf.lo { background: #fee2e2; color: #b91c1c; }
    .exp-toggle { margin-top: 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
    .exp-toggle label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
    .exp-panel { border: 1px dashed #c7a600; background: #fffdf5; }
    .tools { display: flex; gap: 8px; flex-wrap: wrap; }
    .tools .btn { text-decoration: none; }
    .bar.tight { margin-bottom: 8px; align-items: center; }
    .bar.tight h2 { margin: 0; }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .facts div { background: #f8f9fa; border-radius: 8px; padding: 10px 12px; }
    .facts span { display: block; font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .03em; }
    .facts strong { font-size: 14px; color: #0a1f3d; }
    .kas { margin-top: 12px; font-size: 13px; color: #374151; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .counts { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .tag.red { background: #fee2e2; color: #b91c1c; }
    .verdict { display: inline-block; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 10px; white-space: nowrap; }
    .verdict.good { background: #dcfce7; color: #15803d; }
    .verdict.mid { background: #fef5e0; color: #8a6508; }
    .verdict.bad { background: #fee2e2; color: #b91c1c; }
    .why { color: #374151; font-size: 13px; min-width: 240px; }
    tr.sel td { background: #fffbeb; }
    .row-actions { white-space: nowrap; }
    .row-actions .btn { margin-left: 6px; }
    .btn.small { padding: 6px 12px; }
    table.jv td { padding: 6px; border-bottom: 0; }
    table.jv input[type=radio] { width: auto; }
    input.right { text-align: right; }
    .print-only { display: none; }
    .foot { font-size: 11px; color: #6b7280; }
    @media print {
      .no-print { display: none !important; }
      .print-only { display: block; }
      .panel { break-inside: avoid; border-color: #ccc; }
    }
  `],
})
export class TenderDetailPage {
  private data = inject(DataService);
  private route = inject(ActivatedRoute);

  id = this.route.snapshot.paramMap.get('id') ?? '';
  tender = signal<any>(null);
  companies = signal<any[]>([]);
  loadError = signal('');
  busy = signal<'' | 'all' | 'jv' | 'partners'>('');
  all = signal<any>(null);
  allError = signal('');
  selected = signal<any>(null);
  partners = signal<any>(null);
  jvError = signal('');
  history = signal<any[]>([]);
  jvResults = signal<any[]>([]);
  tenderBids = signal<any[]>([]);
  statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }
  isDone = (c: any) => !!c.done;

  jvRows: JvRow[] = [{ companyId: '', share: 60 }, { companyId: '', share: 40 }];
  leadIndex = 0;

  // ---------- Requirements read from the bidding document (Task 13) ----------
  reqFound = signal<(FoundRequirement & { use: boolean; confirmed: boolean })[] | null>(null);
  savedReqs = signal<any[]>([]);
  reqBusy = signal(false);
  reqMsg = signal('');
  reqSaveMsg = signal('');
  pdfProgress = signal('');
  pdfNote = signal('');
  confirmedCount = computed(() => this.savedReqs().filter((r) => !r.needsVerification).length);
  useCount() { return (this.reqFound() ?? []).filter((r) => r.use).length; }
  kindLabel(k: string) { return KIND_LABEL[k as RequirementKind] ?? k; }
  confTone(c: number) { return c >= 0.8 ? 'hi' : c >= 0.6 ? 'mid' : 'lo'; }

  async loadSavedReqs() {
    try { this.savedReqs.set(await this.data.tenderRequirements(this.id)); } catch { /* module off or server asleep — the panel just stays hidden */ }
  }

  async saveFound() {
    const rows = (this.reqFound() ?? []).filter((r) => r.use)
      .map((r) => ({ kind: r.kind, label: r.label.trim() || KIND_LABEL[r.kind], data: r.data, sourceText: r.sourceText, confidence: r.confidence, confirmed: r.confirmed }));
    if (!rows.length) return;
    this.reqBusy.set(true); this.reqSaveMsg.set('');
    try {
      this.savedReqs.set(await this.data.saveTenderRequirements(this.id, rows));
      const unchecked = rows.filter((r) => !r.confirmed).length;
      this.reqSaveMsg.set(`✅ Saved ${rows.length} requirement${rows.length > 1 ? 's' : ''} to this tender` + (unchecked ? ` — ${unchecked} still marked "needs checking".` : '.'));
    } catch (e) { this.reqSaveMsg.set('Could not save: ' + errorText(e)); }
    this.reqBusy.set(false);
  }

  async confirmSaved(r: any, confirmed: boolean) {
    this.reqBusy.set(true); this.reqMsg.set('');
    try {
      const u = await this.data.updateTenderRequirement(this.id, r.id, { confirmed });
      this.savedReqs.update((l) => l.map((x) => (x.id === r.id ? u : x)));
    } catch (e) { this.reqMsg.set(errorText(e)); }
    this.reqBusy.set(false);
  }

  async deleteSaved(r: any) {
    this.reqBusy.set(true); this.reqMsg.set('');
    try {
      await this.data.deleteTenderRequirement(this.id, r.id);
      this.savedReqs.update((l) => l.filter((x) => x.id !== r.id));
    } catch (e) { this.reqMsg.set(errorText(e)); }
    this.reqBusy.set(false);
  }

  /** Copy the CONFIRMED rows into the tender's own requirement fields (used by the eligibility check). */
  async applySavedToTender() {
    const rows = this.savedReqs().filter((r) => !r.needsVerification);
    const one = (k: string) => rows.find((r) => r.kind === k)?.data;
    const patch: Record<string, any> = {};
    const set = (key: string, v: any) => { if (v != null && v !== '' && !Number.isNaN(v)) patch[key] = v; };
    set('reqTurnover', one('TURNOVER')?.amountNPR);
    set('reqBidCapacity', one('BID_CAPACITY')?.amountNPR);
    set('reqSimilarValue', one('SIMILAR_CONTRACT')?.amountNPR);
    set('reqSimilarCount', one('SIMILAR_CONTRACT')?.count);
    set('similarDescription', one('SIMILAR_CONTRACT')?.description);
    set('contractPeriodMonths', one('COMPLETION_PERIOD')?.months);
    set('bidSecurityAmount', one('BID_SECURITY')?.amountNPR);
    set('bidValidityDays', one('BID_VALIDITY')?.days);
    const acts = rows.filter((r) => r.kind === 'KEY_ACTIVITY' && r.data?.name && r.data?.quantity)
      .map((r) => ({ name: String(r.data.name), unit: String(r.data.unit || 'Nos'), quantity: Number(r.data.quantity) * (r.data.period === 'month' ? 12 : 1) }));
    if (acts.length) patch['keyActivityReqs'] = acts;
    if (!Object.keys(patch).length) { this.reqMsg.set('None of the confirmed rows map to the requirement fields (turnover, bid capacity, similar contract, key activities, period, bid security, validity).'); return; }
    this.reqBusy.set(true); this.reqMsg.set('');
    try {
      await firstValueFrom(this.data.updateTender(this.id, patch));
      this.tender.set(await firstValueFrom(this.data.getTender(this.id)));
      this.reqMsg.set(`✅ Updated ${Object.keys(patch).length} requirement field${Object.keys(patch).length > 1 ? 's' : ''} from the confirmed rows. Run the eligibility check again to use them.`);
    } catch (e) { this.reqMsg.set('Could not update the tender: ' + errorText(e)); }
    this.reqBusy.set(false);
  }

  // ---------- Bid Document Reader (Task 5) ----------
  pdfBusy = signal(false);
  pdfError = signal('');
  pdfScanned = signal(false);
  suggestions = signal<Suggestions | null>(null);
  rawPdfText = signal('');
  showRawText = signal(false);
  checklist = signal<ChecklistItem[] | null>(null);
  checklistFromClause21Used = signal(false);
  // Kept out of the template: an inline ternary with apostrophes + an em dash broke Angular's template expression parser (caught by a real `ng build`).
  /** Page / confidence of the required-documents table, when the checklist came from it. */
  checklistTablePage = signal<number | null>(null);
  checklistTableConfidence = signal(0);
  clause21Note = computed(() => {
    if (this.checklistFromClause21Used()) return "Read straight from this document's own ITB Clause 21 \u2014 Sealing and Marking of Bids.";
    const page = this.checklistTablePage();
    if (page) {
      return "Read from this document's own required-documents table (page " + page + ', read confidence ' +
        Math.round(this.checklistTableConfidence() * 100) + "%). Clause 21's text has no item list of its own in this document, so the table was used \u2014 verify every row against the document.";
    }
    return "This document's Clause 21 was not found, so this is a generic checklist \u2014 verify against the actual document.";
  });
  checklistColumnTitle = computed(() =>
    this.checklistFromClause21Used() ? 'Clause text' : this.checklistTablePage() ? 'Requirement / format' : 'Mentioned in the document?',
  );
  keyClauses = signal<ClauseFind[] | null>(null);
  estimateVat = signal<{ value: number | null; note: string } | null>(null);
  checklistSaved = signal(false);
  suggestionKeys = computed(() => Object.keys(this.suggestions() ?? {}));

  // ---------- Experimental table reconstruction (Phase 1B) ----------
  // Local, frontend-only feature toggle. Default disabled. No backend, no database, no
  // dependency on the (currently unimplemented) api/feature-flag stub — just a signal. Flipping
  // it off at any point leaves the reader behaving exactly as before; it gates ONLY the block
  // below, never anything in onPdfChosen's existing, previously-validated extraction path.
  experimentalTableReader = signal(false);
  private lastPdfFile: File | null = null;
  hasPdfFile = signal(false);
  experimentalBusy = signal(false);
  experimentalError = signal('');
  experimentalResult = signal<DocumentTableResult | null>(null);
  experimentalTried = signal(false);

  async onPdfChosen(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.pdfBusy.set(true); this.pdfError.set(''); this.pdfScanned.set(false);
    this.suggestions.set(null); this.checklist.set(null); this.checklistSaved.set(false);
    this.keyClauses.set(null); this.estimateVat.set(null); this.checklistFromClause21Used.set(false);
    this.checklistTablePage.set(null); this.checklistTableConfidence.set(0);
    this.rawPdfText.set(''); this.showRawText.set(false);
    this.reqFound.set(null); this.reqSaveMsg.set(''); this.pdfNote.set(''); this.pdfProgress.set('');
    this.lastPdfFile = file; this.hasPdfFile.set(true);
    this.experimentalResult.set(null); this.experimentalTried.set(false); this.experimentalError.set('');
    try {
      // the whole document: Section III (EQC) and the SCC are often past page 80
      const pdf = await readPdfText(file, 600, (p, n) => { if (p % 10 === 0 || p === n) this.pdfProgress.set(`Reading page ${p} of ${n}…`); });
      const { text, scanned } = pdf;
      this.rawPdfText.set(text);
      if (scanned) { this.pdfScanned.set(true); return; }
      this.pdfNote.set(pdfReadNote(pdf));
      this.reqFound.set(extractRequirements(text).map((r) => ({ ...r, use: true, confirmed: false })));
      const { fields } = parseTenderText(text);
      this.suggestions.set(fields);
      const own = checklistFromClause21(text);
      this.checklistFromClause21Used.set(!!own);
      // Many PPMO e-submission documents list the required documents as a TABLE inside ITB 21.1(b)
      // instead of (a)/(b) items, so the text parser above finds Clause 21 but no item list. Only
      // then, read that table with the coordinate-based engine; accepted only if it has a named
      // "Document" column and >= 80% confidence (see checklistFromDocumentTable). Otherwise fall
      // through to the generic keyword list exactly as before.
      let fromTable: ChecklistItem[] | null = null;
      if (!own) {
        try {
          const tr = await findAnchorTableInPdf(file, 80);
          fromTable = checklistFromDocumentTable(tr);
          if (fromTable && tr) {
            this.checklistTablePage.set(tr.pageNumber);
            this.checklistTableConfidence.set(tr.table.confidence);
            this.experimentalResult.set(tr);
            this.experimentalTried.set(true);
          }
        } catch {
          fromTable = null; // table reading is best-effort; the generic list below still works
        }
      }
      this.checklist.set(own ?? fromTable ?? findDocumentChecklist(text));
      this.keyClauses.set(findKeyClauses(text));
      if (fields['boqAmount']) this.estimateVat.set(estimateExcludingVat(fields['boqAmount'].value, fields['boqAmount'].line));
    } catch (e: any) {
      this.pdfError.set('Could not read this PDF: ' + (e?.message ?? 'unknown error'));
    } finally {
      this.pdfBusy.set(false);
      this.pdfProgress.set('');
      (ev.target as HTMLInputElement).value = '';
    }
  }

  /**
   * Opt-in only (the toggle + this explicit button click). Scans the same PDF, page by page, for
   * a genuine multi-column anchor table (not hardcoded to page 20 — whichever page actually has
   * one). Purely a reading aid: never writes to `checklist`, `suggestions`, or anything saved to
   * the tender — see the "Procurement safety" note in the template for why.
   */
  async tryExperimentalTableReader() {
    if (!this.lastPdfFile) return;
    this.experimentalBusy.set(true); this.experimentalError.set(''); this.experimentalTried.set(true);
    try {
      this.experimentalResult.set(await findAnchorTableInPdf(this.lastPdfFile, 80));
    } catch (e: any) {
      this.experimentalError.set('Could not run the experimental table reader: ' + (e?.message ?? 'unknown error'));
    } finally {
      this.experimentalBusy.set(false);
    }
  }

  async saveChecklist() {
    const cl = this.checklist();
    if (!cl) return;
    await firstValueFrom(this.data.updateTender(this.id, {
      readinessChecklist: { items: cl, checkedAt: new Date().toISOString() },
    }));
    this.checklistSaved.set(true);
  }

  exportChecklist() {
    const cl = this.checklist();
    if (!cl) return;
    tablesToExcel('Bid Readiness Checklist', [{
      title: 'Checklist',
      columns: [{ k: 'label', label: 'Document / requirement' }, { k: 'found', label: 'Mentioned in document' }, { k: 'line', label: 'Where' }],
      rows: cl.map((c) => ({ ...c, found: c.found ? 'Yes' : 'Check manually' })),
    }]);
  }

  reportResults = computed(() => [...(this.all()?.results ?? []), ...this.jvResults()]);

  constructor() {
    this.data.getTender(this.id).subscribe({
      next: (t) => this.tender.set(t),
      error: (err) => this.loadError.set(errorText(err)),
    });
    this.data.getCompanies().subscribe({ next: (l) => this.companies.set(l), error: () => {} });
    this.loadHistory();
    this.loadSavedReqs();
    this.data.getBids({ tenderId: this.id }).subscribe({ next: (l) => this.tenderBids.set(l), error: () => {} });
  }

  num(v: any) { return v == null ? 0 : Number(v); }

  /** Same default formulas as the engine (criteria overrides respected) — shown as "≈ Rs …" */
  calc(kind: 'turnover' | 'capacity' | 'similar'): string {
    const t = this.tender();
    const V = Number(t?.boqAmount) || 0;
    if (!V) return 'not set';
    const c = t.criteria ?? {};
    const T = Math.max(12, Number(t.contractPeriodMonths) || 12);
    const v = kind === 'turnover' ? ((c.turnoverMultiplier ?? 1.5) * V * 12) / T
      : kind === 'capacity' ? ((c.bidCapacityPercent ?? 100) / 100) * V
      : ((c.similarContractPercent ?? 40) / 100) * V;
    return '≈ Rs ' + Math.round(v).toLocaleString('en-US') + ' (calculated)';
  }
  both(d: any) { return showBoth(d); }
  label(v: string) { return verdictText(v); }
  tone(v: string) {
    return 'verdict ' + (v === 'INDIVIDUAL_ELIGIBLE' || v === 'JV_ELIGIBLE' ? 'good' : v === 'JV_REQUIRED' ? 'mid' : 'bad');
  }
  fails(r: any) { return (r.checks ?? []).filter((c: any) => c.status === 'FAIL').length; }
  jvName(r: any) { return (r.partners ?? []).map((p: any) => `${p.companyName} ${p.share}%`).join(' + '); }
  shareTotal() { return this.jvRows.reduce((s, r) => s + (Number(r.share) || 0), 0); }
  hasRequirements() {
    const t = this.tender();
    return !!(t && (t.boqAmount != null || t.reqTurnover != null || t.reqSimilarValue != null || t.reqBidCapacity != null || t.keyActivityReqs?.length || t.reqActivity));
  }

  loadHistory() {
    this.data.getQualifications(this.id).subscribe({ next: (l) => this.history.set(l), error: () => {} });
  }

  showHistory(h: any) {
    this.selected.set({
      companyId: h.companyId, companyName: h.companyName, result: h.result, summary: h.explanation,
      checks: h.checks ?? [], warnings: h.warnings ?? [], ruleSet: { name: h.ruleSetId, effectiveFrom: '' },
      evaluatedAt: h.calculatedAt, disclaimer: 'Saved result — run the check again to use the latest data.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async checkAll() {
    this.busy.set('all');
    this.allError.set('');
    try {
      const res = await firstValueFrom(this.data.evaluateAll(this.id));
      this.all.set(res);
      if (res.results?.length === 0) this.allError.set('You have no companies yet — add one under Companies.');
      this.loadHistory();
    } catch (err) {
      this.allError.set(errorText(err));
    }
    this.busy.set('');
  }

  async findPartners(companyId: string) {
    this.busy.set('partners');
    try {
      this.partners.set(await firstValueFrom(this.data.jvPartners(this.id, companyId)));
    } catch (err) {
      this.allError.set(errorText(err));
    }
    this.busy.set('');
  }

  useSuggestion(baseId: string, s: any) {
    const baseIsLead = s.lead !== s.partnerName;
    this.jvRows = baseIsLead
      ? [{ companyId: baseId, share: 60 }, { companyId: s.partnerId, share: 40 }]
      : [{ companyId: s.partnerId, share: 60 }, { companyId: baseId, share: 40 }];
    this.leadIndex = 0;
    this.checkJv();
  }

  removeJvRow(i: number) {
    this.jvRows.splice(i, 1);
    if (this.leadIndex >= this.jvRows.length) this.leadIndex = 0;
  }

  async checkJv() {
    this.jvError.set('');
    const rows = this.jvRows.filter((r) => r.companyId);
    if (rows.length < 2) { this.jvError.set('Choose at least two companies.'); return; }
    if (new Set(rows.map((r) => r.companyId)).size !== rows.length) { this.jvError.set('The same company is chosen twice.'); return; }
    if (rows.some((r) => !(Number(r.share) >= 1 && Number(r.share) <= 99))) { this.jvError.set('Each share must be between 1 and 99%.'); return; }
    if (Math.abs(this.shareTotal() - 100) > 0.01) { this.jvError.set(`Shares add up to ${this.shareTotal()}% — they must total 100%.`); return; }
    const lead = this.jvRows[this.leadIndex];
    this.busy.set('jv');
    try {
      const res = await firstValueFrom(this.data.evaluateJv(this.id, rows.map((r) => ({
        companyId: r.companyId, share: Number(r.share), isLead: r === lead,
      }))));
      this.jvResults.update((l) => [...l, res]);
      this.selected.set(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      this.jvError.set(errorText(err));
    }
    this.busy.set('');
  }

  async exportExcel() {
    const { downloadQualificationReport } = await loadReport();
    downloadQualificationReport(this.tender(), this.reportResults());
  }

  print() { window.print(); }
}
