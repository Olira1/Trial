import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { User } from '../user';
import {
  BugReportScreenshotUploadUrlDto,
  CreateBugReportDto,
  CreateFeedbackDto,
  CreateSupportContactDto,
  UpdateSupportContactDto,
} from './dto/support.dto';
import {
  SupportBugReportResponseSchema,
  SupportContactListResponseSchema,
  SupportContactResponseSchema,
  SupportFeedbackResponseSchema,
  SupportMessageResponseSchema,
  SupportUploadUrlResponseSchema,
} from './dto/support.response';
import { SupportService } from './support.service';

@ApiTags('Support')
@Controller({ path: 'support', version: '1' })
@UseGuards(SessionGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('bug-reports/screenshots/upload-url')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportUploadUrlResponseSchema)
  getBugReportScreenshotUploadUrl(
    @CurrentUser() user: User,
    @Body() dto: BugReportScreenshotUploadUrlDto,
  ) {
    return this.support.getBugReportScreenshotUploadUrl(user.id, dto);
  }

  @Post('bug-reports')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(SupportBugReportResponseSchema)
  createBugReport(@CurrentUser() user: User, @Body() dto: CreateBugReportDto) {
    return this.support.createBugReport(user.id, dto);
  }

  @Post('feedback')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(SupportFeedbackResponseSchema)
  createFeedback(@CurrentUser() user: User, @Body() dto: CreateFeedbackDto) {
    return this.support.createFeedback(user.id, dto);
  }

  @Get('emergency-contacts')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportContactListResponseSchema)
  listEmergencyContacts(@CurrentUser() user: User) {
    return this.support.listContacts(user.id, 'emergency');
  }

  @Post('emergency-contacts')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(SupportContactResponseSchema)
  createEmergencyContact(
    @CurrentUser() user: User,
    @Body() dto: CreateSupportContactDto,
  ) {
    return this.support.createContact(user.id, 'emergency', dto);
  }

  @Patch('emergency-contacts/:id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportContactResponseSchema)
  updateEmergencyContact(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateSupportContactDto,
  ) {
    return this.support.updateContact(user.id, 'emergency', id, dto);
  }

  @Delete('emergency-contacts/:id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportMessageResponseSchema)
  deleteEmergencyContact(@CurrentUser() user: User, @Param('id') id: string) {
    return this.support.deleteContact(user.id, 'emergency', id);
  }

  @Get('trusted-contacts')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportContactListResponseSchema)
  listTrustedContacts(@CurrentUser() user: User) {
    return this.support.listContacts(user.id, 'trusted');
  }

  @Post('trusted-contacts')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(SupportContactResponseSchema)
  createTrustedContact(
    @CurrentUser() user: User,
    @Body() dto: CreateSupportContactDto,
  ) {
    return this.support.createContact(user.id, 'trusted', dto);
  }

  @Patch('trusted-contacts/:id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportContactResponseSchema)
  updateTrustedContact(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateSupportContactDto,
  ) {
    return this.support.updateContact(user.id, 'trusted', id, dto);
  }

  @Delete('trusted-contacts/:id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SupportMessageResponseSchema)
  deleteTrustedContact(@CurrentUser() user: User, @Param('id') id: string) {
    return this.support.deleteContact(user.id, 'trusted', id);
  }
}
