import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { User } from '../user';
import { CreateFareEstimateDto } from './dto/fare-estimates.dto';
import { FareEstimateResponseSchema } from './dto/fare-estimates.response';
import { FareEstimatesService } from './fare-estimates.service';

@ApiTags('Fare Estimates')
@Controller({ path: 'fare-estimates', version: '1' })
@UseGuards(SessionGuard)
export class FareEstimatesController {
  constructor(private readonly fareEstimates: FareEstimatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(FareEstimateResponseSchema)
  create(@CurrentUser() user: User, @Body() dto: CreateFareEstimateDto) {
    return this.fareEstimates.create(user.id, dto);
  }
}
