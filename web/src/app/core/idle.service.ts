import { Injectable, NgZone, inject } from '@angular/core';
import { AuthService } from './auth.service';

/** Signs the person out after 30 minutes without using the app (Task 15). Activity in any tab
 *  of the app counts (shared through localStorage), so a second open tab doesn't log you out. */
export const IDLE_MINUTES = 30;
const KEY = 'pn.lastActive';

@Injectable({ providedIn: 'root' })
export class IdleService {
  private auth = inject(AuthService);
  private zone = inject(NgZone);
  private timer: any = null;
  private lastWrite = 0;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.touch(true);
    const onActivity = () => this.touch();
    this.zone.runOutsideAngular(() => {
      for (const ev of ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'visibilitychange']) {
        window.addEventListener(ev, onActivity, { passive: true });
      }
      this.timer = setInterval(() => this.check(), 30_000);
    });
  }

  private touch(force = false) {
    const now = Date.now();
    if (!force && now - this.lastWrite < 15_000) return; // no need to write on every mouse move
    this.lastWrite = now;
    try { localStorage.setItem(KEY, String(now)); } catch { /* storage blocked */ }
  }

  private last(): number {
    try { return Number(localStorage.getItem(KEY)) || this.lastWrite; } catch { return this.lastWrite; }
  }

  check(now = Date.now()) {
    if (!this.auth.isLoggedIn()) return;
    if (now - this.last() >= IDLE_MINUTES * 60_000) {
      this.zone.run(() => this.auth.logout(false, 'idle'));
    }
  }
}
