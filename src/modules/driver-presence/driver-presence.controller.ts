import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { AuthenticatedRequest } from '../auth/types';
import type { User } from '../user';
import { DriverPresencePrivacyInterceptor } from './driver-presence-privacy.interceptor';
import { DriverPresenceService } from './driver-presence.service';
import { GoOnlineDto, ResumePresenceDto } from './dto/driver-presence.dto';
import {
  DriverPresenceCommandResponseSchema,
  DriverPresenceSnapshotResponseSchema,
} from './dto/driver-presence.response';

@ApiTags('Driver Presence')
@Controller({ path: 'drivers/presence', version: '1' })
@UseGuards(SessionGuard)
@UseInterceptors(DriverPresencePrivacyInterceptor)
export class DriverPresenceController {
  constructor(private readonly presence: DriverPresenceService) {}

  @Post('online')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DriverPresenceCommandResponseSchema)
  goOnline(
    @CurrentUser() user: User,
    @Req() request: AuthenticatedRequest,
    @Body() dto: GoOnlineDto,
  ) {
    return this.presence.goOnline({
      userId: user.id,
      sessionId: request.sessionId,
      initialLocation: dto.initialLocation,
      takeoverConfirmed: dto.takeoverConfirmed,
    });
  }

  @Post('offline')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DriverPresenceCommandResponseSchema)
  goOffline(@CurrentUser() user: User, @Req() request: AuthenticatedRequest) {
    return this.presence.goOffline({
      userId: user.id,
      sessionId: request.sessionId,
    });
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DriverPresenceCommandResponseSchema)
  resume(
    @CurrentUser() user: User,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ResumePresenceDto,
  ) {
    return this.presence.resume({
      userId: user.id,
      sessionId: request.sessionId,
      presenceSessionId: dto.presenceSessionId,
      currentLocation: dto.currentLocation,
    });
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DriverPresenceSnapshotResponseSchema)
  getSnapshot(@CurrentUser() user: User, @Req() request: AuthenticatedRequest) {
    return this.presence.getSnapshot({
      userId: user.id,
      sessionId: request.sessionId,
    });
  }
}
