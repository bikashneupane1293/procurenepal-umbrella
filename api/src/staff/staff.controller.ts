// Staff joining & leaving organizations (Task 12). All routes need a signed-in user; Owner-only
// actions are checked in StaffService. © Cuidado Technology Pvt. Ltd.
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StaffService } from './staff.service';
import { ApproveRequestDto, InviteStaffDto, JoinOrgDto } from './dto/staff.dto';

@Controller('staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  /** This organization's Org ID and sign-up link (any member can see it, to pass on). */
  @Get('org')
  org(@CurrentUser() u: any) {
    return this.staff.orgInfo(u.tenantId);
  }

  /** New Org ID — e.g. if the old one was shared too widely. The old one stops working. */
  @Post('org/regenerate')
  @HttpCode(200)
  regenerate(@CurrentUser() u: any) {
    return this.staff.regenerateOrgCode(u.tenantId, u.role);
  }

  /** The signed-in person: personal ID, organization, pending invitations and requests. */
  @Get('me')
  me(@CurrentUser() u: any) {
    return this.staff.me(u.userId);
  }

  /** Owner adds a person by email or personal ID. */
  @Post('invites')
  invite(@CurrentUser() u: any, @Body() dto: InviteStaffDto) {
    return this.staff.invite(u.tenantId, u, dto);
  }

  @Get('invites')
  list(@CurrentUser() u: any) {
    return this.staff.listForTenant(u.tenantId, u.role);
  }

  /** Owner cancels an invitation or declines a join request. */
  @Delete('invites/:id')
  cancel(@CurrentUser() u: any, @Param('id') id: string) {
    return this.staff.cancel(u.tenantId, u.role, id);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() u: any, @Param('id') id: string, @Body() dto: ApproveRequestDto) {
    return this.staff.approve(u.tenantId, u, id, dto);
  }

  /** The invited person accepts / declines. */
  @Post('invites/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() u: any, @Param('id') id: string) {
    return this.staff.acceptInvite(u.userId, id);
  }

  @Post('invites/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() u: any, @Param('id') id: string) {
    return this.staff.declineInvite(u.userId, id);
  }

  /** A signed-in person asks to join an organization by its Org ID. */
  @Post('join')
  @HttpCode(200)
  join(@CurrentUser() u: any, @Body() dto: JoinOrgDto) {
    return this.staff.requestToJoin(u.userId, dto.orgCode);
  }

  /** Owner removes a person — they move to their own free workspace and keep their login. */
  @Post('remove/:userId')
  @HttpCode(200)
  remove(@CurrentUser() u: any, @Param('userId') userId: string) {
    return this.staff.removeFromCompany(u.tenantId, u, userId);
  }
}
