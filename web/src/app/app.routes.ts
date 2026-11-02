import { Routes } from '@angular/router';
import { LoginPage } from './pages/login/login';
import { DashboardPage } from './pages/dashboard/dashboard';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  { path: 'dashboard', component: DashboardPage, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
