import { Controller, Post, Body, Get, Param, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ActivateDto } from './dto/activate.dto';
import { GoogleLoginDto, JoinSignupDto } from './dto/google.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: any) {
    return this.authService.logout(user.userId);
  }

  // Task 12 — what the sign-in page needs (is Google sign-in set up? is email sending on?)
  @Get('config')
  config() {
    return this.authService.config();
  }

  // Task 12 — Sign in / sign up with Google (optionally joining an organization by its Org ID)
  @HttpCode(HttpStatus.OK)
  @Post('google')
  google(@Body() dto: GoogleLoginDto) {
    return this.authService.googleLogin(dto.credential, dto.orgCode);
  }

  // Task 12 — sign up with an Org ID + password (creates a join request for the Owner)
  @Post('join')
  join(@Body() dto: JoinSignupDto) {
    return this.authService.joinWithPassword(dto);
  }

  // Task 5 — invite-by-link activation (public: the user has no account yet to sign in with)
  @Get('activate/:token')
  async checkActivation(@Param('token') token: string) {
    return this.authService.validateActivation(token);
  }

  @HttpCode(HttpStatus.OK)
  @Post('activate')
  async activate(@Body() dto: ActivateDto) {
    return this.authService.activate(dto.token, dto.password);
  }
}
