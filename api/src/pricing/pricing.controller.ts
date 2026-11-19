// Pricing & promotions endpoints (Task 10). `GET /pricing` is public (for the marketing site /
// a future sign-up page); everything under /admin/pricing is Super Admin only.
import { Body, Controller, ForbiddenException, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PricingService, PLAN_KEYS } from './pricing.service';

const platformOnly = (user: any) => {
  if (user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Pricing is managed by Super Admin only');
};

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Public price list: active plans only, no promotion list (codes stay private). */
  @Get('pricing')
  async publicPricing() {
    const { catalog, stored } = await this.pricing.getCatalog();
    return {
      currency: catalog.currency,
      configured: stored,
      plans: PLAN_KEYS.filter((k) => catalog.plans[k].active).map((k) => {
        const p = catalog.plans[k];
        return { plan: k, label: p.label, tagline: p.tagline, monthlyNPR: p.monthlyNPR, yearlyNPR: p.yearlyNPR, modules: p.modules };
      }),
    };
  }

  /** Public price check for one plan + period + optional code (e.g. a promo box on the website). */
  @Get('pricing/quote')
  quotePublic(@Query('plan') plan: string, @Query('period') period: string, @Query('code') code?: string) {
    return this.pricing.quote(plan, period ?? 'MONTHLY', code);
  }

  @Get('admin/pricing')
  @UseGuards(JwtAuthGuard)
  async adminGet(@CurrentUser() user: any) {
    platformOnly(user);
    const { catalog, stored, updatedAt } = await this.pricing.getCatalog();
    return { catalog, stored, updatedAt, usage: await this.pricing.promoUsage() };
  }

  @Put('admin/pricing')
  @UseGuards(JwtAuthGuard)
  async adminSave(@CurrentUser() user: any, @Body() body: any) {
    platformOnly(user);
    const catalog = await this.pricing.saveCatalog(body?.catalog ?? body, user?.email ?? null);
    return { catalog, stored: true, usage: await this.pricing.promoUsage() };
  }

  @Post('admin/pricing/quote')
  @UseGuards(JwtAuthGuard)
  adminQuote(@CurrentUser() user: any, @Body() body: any) {
    platformOnly(user);
    return this.pricing.quote(body?.plan, body?.period ?? 'MONTHLY', body?.code);
  }
}
