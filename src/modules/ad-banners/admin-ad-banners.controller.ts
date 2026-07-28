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
import { AdminSessionGuard, Roles, RolesGuard } from '../auth';
import { AdBannersService } from './ad-banners.service';
import {
  AdBannerUploadUrlDto,
  CreateAdBannerDto,
  SetAdBannerStatusDto,
} from './dto/ad-banner.dto';
import {
  AdBannerMessageResponseSchema,
  AdBannerListResponseSchema,
  AdBannerResponseSchema,
  AdBannerUploadUrlResponseSchema,
} from './dto/ad-banner.response';

@ApiTags('Admin Ad Banners')
@Controller({ path: 'admin/ad-banners', version: '1' })
@UseGuards(AdminSessionGuard, RolesGuard)
export class AdminAdBannersController {
  constructor(private readonly adBanners: AdBannersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdBannerListResponseSchema)
  listBanners() {
    return this.adBanners.listBannersForAdmin();
  }

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdBannerUploadUrlResponseSchema)
  getUploadUrl(@Body() dto: AdBannerUploadUrlDto) {
    return this.adBanners.getUploadUrl(dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin')
  @ZodSerializerDto(AdBannerResponseSchema)
  createBanner(@Body() dto: CreateAdBannerDto) {
    return this.adBanners.createBanner(dto);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdBannerResponseSchema)
  setBannerStatus(@Param('id') id: string, @Body() dto: SetAdBannerStatusDto) {
    return this.adBanners.setBannerStatus(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ZodSerializerDto(AdBannerMessageResponseSchema)
  deleteBanner(@Param('id') id: string) {
    return this.adBanners.deleteBanner(id);
  }
}
