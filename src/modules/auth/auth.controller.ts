import { Body, Controller, Get, HttpCode, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AllowPending, AuthUser, CurrentUser, Public } from '../../common/auth';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateMeDto } from './auth.dto';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
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
