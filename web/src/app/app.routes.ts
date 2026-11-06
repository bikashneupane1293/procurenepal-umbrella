import { Routes } from '@angular/router';
import { LoginPage } from './pages/login/login';
import { ShellLayout } from './layout/shell';
import { DashboardPage } from './pages/dashboard/dashboard';
import { CompaniesPage } from './pages/companies/companies';
import { CertificatesPage } from './pages/certificates/certificates';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  {
    path: '',
    component: ShellLayout,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardPage },
      { path: 'companies', component: CompaniesPage },
      { path: 'certificates', component: CertificatesPage },
      // Tender + qualification screens load on demand (smaller first download)
      { path: 'tenders', loadComponent: () => import('./pages/tenders/tenders').then((m) => m.TendersPage) },
      { path: 'tenders/:id', loadComponent: () => import('./pages/tenders/tender-detail').then((m) => m.TenderDetailPage) },
      { path: 'qualification', loadComponent: () => import('./pages/qualification/qualification').then((m) => m.QualificationPage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
