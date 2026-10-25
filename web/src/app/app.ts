import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private api = inject(ApiService);
  private cdr = inject(ChangeDetectorRef);

  email = 'admin@griha.com';
  password = 'Password123!';
  loading = false;
  errorMsg = '';
  successMsg = '';

  onSubmit() {
    console.log('Submit clicked');
    this.loading = true;
    this.errorMsg = '';
    this.successMsg = '';
    this.cdr.detectChanges(); // Force UI to show "Signing in..."

    this.api.login(this.email, this.password).subscribe({
      next: (res: any) => {
        console.log('Login success:', res);
        this.loading = false;
        this.successMsg = `Welcome ${res.user.email}! Role: ${res.user.role}`;
        localStorage.setItem('token', res.access_token);
        localStorage.setItem('user', JSON.stringify(res.user));
        this.cdr.detectChanges(); // Force UI to show success message
      },
      error: (err: any) => {
        console.error('Login error:', err);
        this.loading = false;
        this.errorMsg = err.error?.message || err.message || 'Invalid credentials';
        this.cdr.detectChanges(); // Force UI to show error
      },
    });
  }
}
