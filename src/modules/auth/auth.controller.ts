import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import type { User } from '../user';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  AdminLoginStartDto,
  ChangePasswordDto,
  ConnectEmailStartDto,
  ConnectEmailVerifyDto,
  LoginStartDto,
  LoginVerifyDto,
  LoginVerifyPasswordDto,
  LogoutDto,
  PasswordResetStartDto,
  PasswordResetVerifyDto,
  ProfileImageUploadUrlDto,
  RefreshDto,
  ResendOtpDto,
  SignUpStartDto,
  SignUpVerifyDto,
  UpdateMeDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import {
  AdminLoginStartResponseSchema,
  AdminLoginVerifyResponseSchema,
  ConnectEmailStartResponseSchema,
  ConnectEmailVerifyResponseSchema,
  LoginStartResponseSchema,
  LoginVerifyResponseSchema,
  MeResponseSchema,
  MessageResponseSchema,
  OtpResendResponseSchema,
  PasswordResetStartResponseSchema,
  ProfileImageUploadUrlResponseSchema,
  RefreshResponseSchema,
  SignUpStartResponseSchema,
  SignUpVerifyResponseSchema,
} from './dto/auth.response';
import { AdminSessionGuard } from './guards/admin-session.guard';
import { SessionGuard } from './guards/session.guard';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up/start')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SignUpStartResponseSchema)
  async signUpStart(@Body() dto: SignUpStartDto) {
    return this.authService.signUpStart(dto);
  }

  @Post('sign-up/verify')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SignUpVerifyResponseSchema)
  signUpVerify(@Body() dto: SignUpVerifyDto) {
    return this.authService.signUpVerify(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(RefreshResponseSchema)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(MessageResponseSchema)
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto);
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(OtpResendResponseSchema)
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Post('connect/email/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(ConnectEmailStartResponseSchema)
  connectEmailStart(
    @CurrentUser() user: User,
    @Body() dto: ConnectEmailStartDto,
  ) {
    return this.authService.connectEmailStart(user.id, dto);
  }

  @Post('connect/email/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(ConnectEmailVerifyResponseSchema)
  connectEmailVerify(
    @CurrentUser() user: User,
    @Body() dto: ConnectEmailVerifyDto,
  ) {
    return this.authService.connectEmailVerify(user.id, dto);
  }

  @Post('/login/start')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(LoginStartResponseSchema)
  loginStart(@Body() dto: LoginStartDto) {
    return this.authService.loginStart(dto);
  }

  @Post('/login/verify')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(LoginVerifyResponseSchema)
  loginVerify(@Body() dto: LoginVerifyDto) {
    return this.authService.loginVerify(dto);
  }

  @Post('/login/verify/password')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(LoginVerifyResponseSchema)
  loginVerifyPassword(@Body() dto: LoginVerifyPasswordDto) {
    return this.authService.loginVerifyPassword(dto);
  }

  @Post('/admin/login/start')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(AdminLoginStartResponseSchema)
  adminLoginStart(@Body() dto: AdminLoginStartDto) {
    return this.authService.adminLoginStart(dto);
  }

  @Post('/admin/login/verify')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(AdminLoginVerifyResponseSchema)
  async adminLoginVerify(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { sessionToken, sessionExpiresIn } =
      await this.authService.adminLoginVerify(dto);
    res.cookie('ubel_admin_session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
      maxAge: sessionExpiresIn * 1000,
      path: '/',
    });
    return { message: 'logged in' };
  }

  @Post('/admin/logout')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(MessageResponseSchema)
  async adminLogout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.ubel_admin_session as string | undefined;
    await this.authService.adminLogout(token);
    res.clearCookie('ubel_admin_session', {
      httpOnly: true,
      secure: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
      path: '/',
    });
    return { message: 'logged out' };
  }

  @Post('password/reset/start')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(PasswordResetStartResponseSchema)
  passwordResetStart(@Body() dto: PasswordResetStartDto) {
    return this.authService.passwordResetStart(dto);
  }

  @Post('password/reset/verify')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(MessageResponseSchema)
  passwordResetVerify(@Body() dto: PasswordResetVerifyDto) {
    return this.authService.passwordResetVerify(dto);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminSessionGuard)
  @ZodSerializerDto(MessageResponseSchema)
  changePassword(
    @CurrentUser() currentUser: User,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(currentUser.id, dto);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ZodSerializerDto(MeResponseSchema)
  me(@CurrentUser() user: User) {
    return this.authService.getCurrentUser(user);
  }

  @Patch('me')
  @UseGuards(SessionGuard)
  @ZodSerializerDto(MeResponseSchema)
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateMeDto) {
    return this.authService.updateCurrentUser(user.id, dto);
  }

  @Post('me/image/upload-url')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(ProfileImageUploadUrlResponseSchema)
  getProfileImageUploadUrl(
    @CurrentUser() user: User,
    @Body() dto: ProfileImageUploadUrlDto,
  ) {
    return this.authService.getProfileImageUploadUrl(user.id, dto);
  }
}
