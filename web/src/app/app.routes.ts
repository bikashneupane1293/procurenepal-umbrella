import { Routes } from '@angular/router';
import { LoginPage } from './pages/login/login';
import { ShellLayout } from './layout/shell';
import { DashboardPage } from './pages/dashboard/dashboard';
import { CompaniesPage } from './pages/companies/companies';
import { authGuard } from './core/auth.guard';
import { moduleGuard } from './core/module.guard';

export const routes: Routes = [
  { path: 'login', component: LoginPage },
  {
    path: '',
    component: ShellLayout,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardPage },
      { path: 'companies', component: CompaniesPage },
      { path: 'users', loadComponent: () => import('./pages/users/users').then((m) => m.UsersPage) },
      { path: 'bolpatra', canActivate: [moduleGuard], loadComponent: () => import('./pages/bolpatra/bolpatra').then((m) => m.BolpatraPage) },
      { path: 'certificates', canActivate: [moduleGuard], loadComponent: () => import('./pages/certificates/certificates').then((m) => m.CertificatesPage) },
      // Tender + qualification screens load on demand (smaller first download)
      { path: 'tenders', canActivate: [moduleGuard], loadComponent: () => import('./pages/tenders/tenders').then((m) => m.TendersPage) },
      { path: 'tenders/:id', canActivate: [moduleGuard], loadComponent: () => import('./pages/tenders/tender-detail').then((m) => m.TenderDetailPage) },
      { path: 'qualification', canActivate: [moduleGuard], loadComponent: () => import('./pages/qualification/qualification').then((m) => m.QualificationPage) },
      { path: 'bids', canActivate: [moduleGuard], loadComponent: () => import('./pages/bids/bids').then((m) => m.BidsPage) },
      { path: 'reports', canActivate: [moduleGuard], loadComponent: () => import('./pages/reports/reports').then((m) => m.ReportsPage) },
      { path: 'banks', canActivate: [moduleGuard], loadComponent: () => import('./pages/banks/banks').then((m) => m.BanksPage) },
      { path: 'bank-guarantees', canActivate: [moduleGuard], loadComponent: () => import('./pages/bank-guarantees/bank-guarantees').then((m) => m.BankGuaranteesPage) },
      { path: 'projects', canActivate: [moduleGuard], loadComponent: () => import('./pages/projects/projects').then((m) => m.ProjectsPage) },
      { path: 'projects/:id', canActivate: [moduleGuard], loadComponent: () => import('./pages/projects/project-detail').then((m) => m.ProjectDetailPage) },
      { path: 'boq', canActivate: [moduleGuard], data: { boq: true }, loadComponent: () => import('./pages/projects/projects').then((m) => m.ProjectsPage) },
      { path: 'soon/:id', loadComponent: () => import('./pages/soon/soon').then((m) => m.SoonPage) },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
