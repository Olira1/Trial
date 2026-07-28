import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { User } from '../user';
import {
  CurrentDispatchOfferResponseSchema,
  DispatchOfferResponseSchema,
} from './dto/dispatch-offers.response';
import { DispatchOffersService } from './dispatch-offers.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { OfferRejectionService } from './offer-rejection.service';

@ApiTags('Dispatch Offers')
@Controller({ path: 'dispatch-offers', version: '1' })
@UseGuards(SessionGuard)
export class DispatchOffersController {
  constructor(
    private readonly offers: DispatchOffersService,
    private readonly acceptance: OfferAcceptanceService,
    private readonly rejection: OfferRejectionService,
  ) {}

  @Get('current')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(CurrentDispatchOfferResponseSchema.nullable())
  findCurrent(@CurrentUser() user: User) {
    return this.offers.findCurrentForDriver(user.id);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(CurrentDispatchOfferResponseSchema)
  findById(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.offers.findOfferByIdForDriver(user.id, id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchOfferResponseSchema)
  accept(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.acceptance.accept(user.id, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchOfferResponseSchema)
  reject(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.rejection.reject(user.id, id);
  }
}
