import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

/**
 * Sign-in handed over from the home page (procurenepal.com) — the person typed email and
 * password there, the home page signed in, and sends the session here in the URL *fragment*
 * (#t=…&u=…). A fragment is never sent to any server; it is removed from the address bar
 * and history straight away. Anything missing or broken → the normal sign-in page.
 */
@Component({
  selector: 'app-handoff',
  standalone: true,
  template: `<p style="font-family: sans-serif; text-align: center; margin-top: 30vh; color: #6b7280">Opening ProcureNepal…</p>`,
})
export class HandoffPage {
  constructor() {
    const auth = inject(AuthService);
    const router = inject(Router);
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    history.replaceState(null, '', '/handoff'); // drop the token from the address bar and history
    const token = p.get('t');
    let user: any = null;
    try { user = JSON.parse(p.get('u') ?? 'null'); } catch { /* broken link */ }
    const looksLikeJwt = !!token && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
    if (looksLikeJwt && user?.email) {
      auth.saveSession(token!, user);
      router.navigateByUrl('/dashboard', { replaceUrl: true });
    } else {
      router.navigateByUrl('/login', { replaceUrl: true });
    }
  }
}
