import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { User } from '../user';
import { AdBannersService } from './ad-banners.service';
import { AdBannerListResponseSchema } from './dto/ad-banner.response';

@ApiTags('Ad Banners')
@Controller({ path: 'ad-banners', version: '1' })
@UseGuards(SessionGuard)
export class AdBannersController {
  constructor(private readonly adBanners: AdBannersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(AdBannerListResponseSchema)
  listActiveBanners(@CurrentUser() user: User) {
    return this.adBanners.listActiveBanners(user.roles);
  }
}
