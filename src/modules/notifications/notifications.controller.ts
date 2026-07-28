import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { User } from '../user';
import {
  ListNotificationsDto,
  RegisterDeviceTokenDto,
} from './dto/notifications.dto';
import {
  DeviceTokenResponseSchema,
  NotificationListResponseSchema,
  NotificationMessageResponseSchema,
  NotificationResponseSchema,
} from './dto/notifications.response';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller({ path: 'notifications', version: '1' })
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(NotificationListResponseSchema)
  listNotifications(
    @CurrentUser() user: User,
    @Query() dto: ListNotificationsDto,
  ) {
    return this.notifications.listNotifications(user.id, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(NotificationResponseSchema)
  getNotification(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.getNotification(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(NotificationMessageResponseSchema)
  deleteNotification(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notifications.deleteNotification(user.id, id);
  }

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DeviceTokenResponseSchema)
  registerDeviceToken(
    @CurrentUser() user: User,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notifications.registerDeviceToken(user.id, dto);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DeviceTokenResponseSchema)
  sendTestNotification(@CurrentUser() user: User) {
    return this.notifications.sendTestNotification(user.id);
  }
}
