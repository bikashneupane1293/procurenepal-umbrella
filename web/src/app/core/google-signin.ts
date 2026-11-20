// "Sign in with Google" button (Google Identity Services). The client ID comes from the API
// (GET /auth/config → googleClientId, set as GOOGLE_CLIENT_ID on the server), so turning Google
// sign-in on needs no rebuild. When it isn't set, no button is drawn. © Cuidado Technology Pvt. Ltd.
declare const google: any;

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if ((window as any).google?.accounts?.id) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Draws Google's button inside `el`; `onCredential` gets the ID token to send to POST /auth/google. */
export async function renderGoogleButton(el: HTMLElement, clientId: string, onCredential: (credential: string) => void, text: 'signin_with' | 'signup_with' | 'continue_with' = 'continue_with') {
  await loadScript();
  google.accounts.id.initialize({ client_id: clientId, callback: (r: any) => onCredential(r.credential), ux_mode: 'popup' });
  el.innerHTML = '';
  google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text, shape: 'pill', width: Math.min(360, el.clientWidth || 360) });
}
