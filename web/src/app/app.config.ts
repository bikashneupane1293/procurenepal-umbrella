import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/jwt.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    // Every date shown with the | date pipe is in Nepal Time, whatever the viewer's computer clock zone.
    { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: '+0545' } },
  ],
};
