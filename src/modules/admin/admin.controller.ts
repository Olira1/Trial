import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminSessionGuard, CurrentUser, Roles, RolesGuard } from '../auth';
import { DispatchJobOperationsService } from '../dispatch-offer';
import { DriverService } from '../driver/driver.service';
import { NotificationsService } from '../notifications';
import { UserService, type User } from '../user';
import {
  ApproveDocumentDto,
  ApproveLicenseDto,
  ApproveVehicleDto,
  ListAdminDriversDto,
  ListAdminNotificationsDto,
  ListAdminRidersDto,
  RejectDocumentDto,
  RejectLicenseDto,
  RejectVehicleDto,
  RevokeDocumentDto,
  RevokeLicenseDto,
  RevokeVehicleDto,
  SendCategoryNotificationDto,
  SendUserNotificationDto,
  TriggerDispatchReconciliationDto,
} from './dto/admin.dto';
import {
  AdminDocumentReviewResponseSchema,
  AdminDispatchDriverInspectionResponseSchema,
  AdminDispatchJobOperationResponseSchema,
  AdminDispatchOfferInspectionResponseSchema,
  AdminDispatchQueueStatusListResponseSchema,
  AdminDispatchRequestInspectionResponseSchema,
  AdminDriverListResponseSchema,
  AdminLicenseReviewResponseSchema,
  AdminMessageResponseSchema,
  AdminNotificationHistoryListResponseSchema,
  AdminNotificationResponseSchema,
  AdminRiderListResponseSchema,
  AdminVehicleReviewResponseSchema,
} from './dto/admin.response';

@ApiTags('Admin')
@Controller({ path: 'admin', version: '1' })
@UseGuards(AdminSessionGuard, RolesGuard)
export class AdminController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly users: UserService,
    private readonly driver: DriverService,
    private readonly dispatchOperations: DispatchJobOperationsService,
  ) {}

  @Get('me')
  @Roles('admin')
  me(@CurrentUser() user: User) {
    return user;
  }

  @Get('users')
  @Roles('admin')
  listUsers() {
    return [];
  }

  @Get('drivers')
  @Roles('admin')
  @ZodSerializerDto(AdminDriverListResponseSchema)
  listDrivers(@Query() dto: ListAdminDriversDto) {
    return this.users.listDriversForAdmin(dto);
  }

  @Get('riders')
  @Roles('admin')
  @ZodSerializerDto(AdminRiderListResponseSchema)
  listRiders(@Query() dto: ListAdminRidersDto) {
    return this.users.listRidersForAdmin(dto);
  }

  @Get('notifications')
  @Roles('admin')
  @ZodSerializerDto(AdminNotificationHistoryListResponseSchema)
  listNotifications(@Query() dto: ListAdminNotificationsDto) {
    return this.notifications.listNotificationsForAdmin(dto);
  }

  @Get('dispatch/queues')
  @Roles('admin')
  @ZodSerializerDto(AdminDispatchQueueStatusListResponseSchema)
  listDispatchQueueStatuses() {
    return this.dispatchOperations.getAllQueueStatuses();
  }

  @Get('dispatch/requests/:id')
  @Roles('admin')
  @ZodSerializerDto(AdminDispatchRequestInspectionResponseSchema)
  async inspectDispatchRequest(@Param('id', new ParseUUIDPipe()) id: string) {
    const inspection = await this.dispatchOperations.inspectRequest(id);
    if (!inspection) {
      throw new NotFoundException('dispatch request not found');
    }
    return inspection;
  }

  @Get('dispatch/offers/:id')
  @Roles('admin')
  @ZodSerializerDto(AdminDispatchOfferInspectionResponseSchema)
  async inspectDispatchOffer(@Param('id', new ParseUUIDPipe()) id: string) {
    const inspection = await this.dispatchOperations.inspectOffer(id);
    if (!inspection) {
      throw new NotFoundException('dispatch offer not found');
    }
    return inspection;
  }

  @Get('dispatch/drivers/:id')
  @Roles('admin')
  @ZodSerializerDto(AdminDispatchDriverInspectionResponseSchema)
  inspectDispatchDriver(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.dispatchOperations.inspectDriver(id);
  }

  @Post('dispatch/reconciliation')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminDispatchJobOperationResponseSchema)
  triggerDispatchReconciliation(
    @CurrentUser() user: User,
    @Body() dto: TriggerDispatchReconciliationDto,
  ) {
    return this.dispatchOperations.enqueueReconciliation(user.id, dto.reason);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin')
  @ZodSerializerDto(AdminMessageResponseSchema)
  deleteUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.deleteUser(id);
  }

  @Post('users/:id/notifications')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminNotificationResponseSchema)
  sendUserNotification(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: SendUserNotificationDto,
  ) {
    return this.notifications.sendUserNotification(id, {
      ...dto,
      createdByUserId: user.id,
    });
  }

  @Post('notifications')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminNotificationResponseSchema)
  sendCategoryNotification(
    @CurrentUser() user: User,
    @Body() dto: SendCategoryNotificationDto,
  ) {
    return this.notifications.sendCategoryNotification({
      ...dto,
      createdByUserId: user.id,
    });
  }

  @Post('driver-documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminDocumentReviewResponseSchema)
  approveDocument(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveDocumentDto,
  ) {
    return this.driver.approveDocument(user.id, id, dto);
  }

  @Post('driver-documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminDocumentReviewResponseSchema)
  rejectDocument(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectDocumentDto,
  ) {
    return this.driver.rejectDocument(user.id, id, dto);
  }

  @Post('driver-documents/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminDocumentReviewResponseSchema)
  revokeDocument(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeDocumentDto,
  ) {
    return this.driver.revokeDocument(user.id, id, dto);
  }

  @Post('driver-vehicles/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminVehicleReviewResponseSchema)
  approveVehicle(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveVehicleDto,
  ) {
    return this.driver.approveVehicleDocuments(user.id, id, dto);
  }

  @Post('driver-vehicles/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminVehicleReviewResponseSchema)
  rejectVehicle(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectVehicleDto,
  ) {
    return this.driver.rejectVehicle(user.id, id, dto);
  }

  @Post('driver-vehicles/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminVehicleReviewResponseSchema)
  revokeVehicle(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeVehicleDto,
  ) {
    return this.driver.revokeVehicle(user.id, id, dto);
  }

  @Post('drivers/:id/license/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminLicenseReviewResponseSchema)
  approveLicense(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveLicenseDto,
  ) {
    return this.driver.approveLicense(user.id, id, dto);
  }

  @Post('drivers/:id/license/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminLicenseReviewResponseSchema)
  rejectLicense(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectLicenseDto,
  ) {
    return this.driver.rejectLicense(user.id, id, dto);
  }

  @Post('drivers/:id/license/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdminLicenseReviewResponseSchema)
  revokeLicense(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeLicenseDto,
  ) {
    return this.driver.revokeLicense(user.id, id, dto);
  }
}
