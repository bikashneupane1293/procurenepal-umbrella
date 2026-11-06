import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { UI_STYLES } from '../../core/ui-styles';
import { itemById, moduleOfItem } from '../../core/modules';

/** Placeholder for menu items that are planned: what it will do and which data it will share. */
@Component({
  selector: 'app-soon',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (item(); as i) {
      <p class="crumb">{{ mod()?.icon }} {{ mod()?.label }}</p>
      <h1>{{ i.label }}</h1>
      <div class="panel">
        <span class="tag gold">Coming soon</span>
        <p class="about">{{ i.about }}</p>
        @if (links().length) {
          <h2>Will share data automatically with</h2>
          <ul class="links">
            @for (l of links(); track l.id) {
              <li>
                @if (l.route) { <a class="link" [routerLink]="l.route">{{ l.label }}</a> <span class="tag green">ready</span> }
                @else { <a class="link" [routerLink]="['/soon', l.id]">{{ l.label }}</a> <span class="tag">planned</span> }
                <span class="help"> · {{ l.module }}</span>
              </li>
            }
          </ul>
        }
        <p class="help">Each screen will have Excel template, import and export, and PDF upload where useful. The workspace Owner can switch this module on or off in <a class="link" routerLink="/users">Companies → User Setup System</a>.</p>
      </div>
    } @else {
      <h1>Page not found</h1>
      <p><a class="link" routerLink="/dashboard">← Dashboard</a></p>
    }
  `,
  styles: [UI_STYLES, `
    .crumb { margin: 0 0 4px; color: #b8860b; font-weight: 600; font-size: 13px; }
    .about { font-size: 15px; color: #374151; margin: 12px 0 18px; }
    .links { margin: 0 0 16px; padding-left: 18px; line-height: 1.9; }
  `],
})
export class SoonPage {
  private route = inject(ActivatedRoute);
  private id = toSignal(this.route.paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
  item = computed(() => itemById(this.id()));
  mod = computed(() => moduleOfItem(this.id()));
  links = computed(() =>
    (this.item()?.links ?? [])
      .map((id) => ({ id, it: itemById(id), m: moduleOfItem(id) }))
      .filter((x) => x.it)
      .map((x) => ({ id: x.id, label: x.it!.label, route: x.it!.route, module: x.m?.label ?? '' })),
  );
}
