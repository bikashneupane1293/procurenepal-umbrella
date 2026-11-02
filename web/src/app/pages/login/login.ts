import { Component, inject, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginPage {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  email = '';
  password = '';
  loading = false;
  errorMsg = '';
  successMsg = '';

  constructor() {
    if (this.auth.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }
  }

  // Pressing Enter inside the Email or Password box signs you in
  @HostListener('keydown.enter', ['$event'])
  onEnterKey(event: Event) {
    if (event.target instanceof HTMLInputElement && !this.loading) {
      event.preventDefault();
      this.onSubmit();
    }
  }

  onSubmit() {
    if (this.loading) return;
    this.loading = true;
    this.errorMsg = '';
    this.successMsg = '';
    this.cdr.detectChanges();

    this.api.login(this.email, this.password).subscribe({
      next: (res: any) => {
        this.auth.saveSession(res.access_token, res.user);
        this.loading = false;
        this.successMsg = `Welcome ${res.user.email}! Opening your dashboard...`;
        this.cdr.detectChanges();
        this.router.navigate(['/dashboard']);
      },
      error: (err: any) => {
        this.loading = false;
        this.errorMsg = err.error?.message || err.message || 'Invalid credentials';
        this.cdr.detectChanges();
      },
    });
  }
}
