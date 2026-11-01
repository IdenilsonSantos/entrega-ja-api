import { Body, Controller, Get, HttpCode, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AllowPending, AuthUser, CurrentUser, Public } from '../../common/auth';
import { RateLimit } from '../../common/rate-limit';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, UpdateMeDto } from './auth.dto';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/register')
  @RateLimit({ name: 'register', limit: 10, windowSec: 3600, by: 'ip' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  /** Força bruta: poucas tentativas por conta, e um teto por IP para quem testa várias contas */
  @Public()
  @Post('auth/login')
  @HttpCode(200)
  @RateLimit({ name: 'login', limit: 10, windowSec: 900, by: 'email' }, { name: 'login', limit: 50, windowSec: 900, by: 'ip' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Sempre responde igual, exista a conta ou não, para não revelar quem tem cadastro */
  @Public()
  @Post('auth/forgot-password')
  @HttpCode(202)
  @RateLimit({ name: 'forgot', limit: 3, windowSec: 3600, by: 'email' }, { name: 'forgot', limit: 10, windowSec: 900, by: 'ip' })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  /** O site confere o link ao abrir, antes de pedir a senha nova */
  @Public()
  @Get('auth/reset-password/:token')
  @RateLimit({ name: 'reset', limit: 20, windowSec: 900, by: 'ip' })
  checkReset(@Param('token') token: string) {
    return this.auth.checkResetToken(token);
  }

  @Public()
  @Post('auth/reset-password')
  @HttpCode(200)
  @RateLimit({ name: 'reset', limit: 20, windowSec: 900, by: 'ip' })
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @AllowPending()
  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }

  @AllowPending()
  @Patch('me')
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) {
    return this.auth.update(u.id, dto);
  }

  @AllowPending()
  @Post('me/password')
  @HttpCode(200)
  password(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(u.id, dto);
  }

  @AllowPending()
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  avatar(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.auth.avatar(u.id, file);
  }
}
