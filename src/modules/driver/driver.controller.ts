import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { User } from '../user';
import { DriverService } from './driver.service';
import {
  ReplaceDocumentDto,
  ReplaceDocumentParamsDto,
} from './dto/replace-document.dto';
import { RegisterDocumentDto } from './dto/register-document.dto';
import { RegisterVehicleDto } from './dto/register-vehicle.dto';
import { UploadUrlDto } from './dto/upload-url.dto';
import {
  DocumentResponseSchema,
  UploadUrlResponseSchema,
  VehicleResponseSchema,
  VehicleWithDocumentUrlsResponseSchema,
} from './dto/driver.response';

@ApiTags('Drivers')
@Controller({ path: 'drivers', version: '1' })
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  @Get('vehicle')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(VehicleWithDocumentUrlsResponseSchema)
  async getVehicle(@CurrentUser() user: User) {
    const v = await this.driver.getVehicle(user.id);
    if (!v) throw new NotFoundException('no vehicle registered');
    return v;
  }

  @Post('register/vehicle')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(VehicleResponseSchema)
  async registerVehicle(
    @CurrentUser() user: User,
    @Body() dto: RegisterVehicleDto,
  ) {
    return this.driver.registerVehicle(user.id, dto);
  }

  @Post('documents/upload-url')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(UploadUrlResponseSchema)
  async getDocumentUploadUrl(
    @CurrentUser() user: User,
    @Body() dto: UploadUrlDto,
  ): Promise<{ url: string; key: string }> {
    return this.driver.getDocumentUploadUrl(user.id, dto);
  }

  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(DocumentResponseSchema)
  async registerDocument(
    @CurrentUser() user: User,
    @Body() dto: RegisterDocumentDto,
  ) {
    return this.driver.registerDocument(user.id, dto);
  }

  @Put('documents/:documentType')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  @ZodSerializerDto(DocumentResponseSchema)
  async replaceDocument(
    @CurrentUser() user: User,
    @Param() params: ReplaceDocumentParamsDto,
    @Body() dto: ReplaceDocumentDto,
  ) {
    return this.driver.replaceDocument(user.id, {
      documentType: params.documentType,
      storageKey: dto.storageKey,
    });
  }
}
