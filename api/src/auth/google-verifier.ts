// Verifies a Google Identity Services ID token (the "credential" from the Sign in with Google
// button) using Google's tokeninfo endpoint — no extra package. Needs GOOGLE_CLIENT_ID on the API
// (the same OAuth Web client ID the web app shows the button for). Separate class so tests can
// swap it for a fake. © Cuidado Technology Pvt. Ltd.
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';

export interface GoogleIdentity { sub: string; email: string; emailVerified: boolean; name: string }

@Injectable()
export class GoogleVerifier {
  clientId(): string | null {
    return process.env.GOOGLE_CLIENT_ID || null;
  }

  async verify(credential: string): Promise<GoogleIdentity> {
    const id = this.clientId();
    if (!id) throw new BadRequestException("Google sign-in isn't set up on this server yet");
    let t: any;
    try {
      const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(String(res.status));
      t = await res.json();
    } catch {
      throw new UnauthorizedException('Google sign-in could not be verified — please try again');
    }
    if (t.aud !== id) throw new UnauthorizedException('This Google sign-in was not issued for ProcureNepal');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) throw new UnauthorizedException('Unexpected Google token issuer');
    if (!t.exp || Number(t.exp) * 1000 < Date.now()) throw new UnauthorizedException('Google sign-in expired — please try again');
    if (!t.sub || !t.email) throw new UnauthorizedException('Google did not return an email address');
    return { sub: String(t.sub), email: String(t.email).toLowerCase(), emailVerified: t.email_verified === true || t.email_verified === 'true', name: String(t.name || t.email) };
  }
}
