import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CurrentUser, SessionGuard } from '../auth';
import type { AuthenticatedRequest } from '../auth/types';
import type { User } from '../user';
import { RideRequestsService } from './ride-requests.service';
import {
  CancelRideRequestDto,
  CreateRideRequestDto,
} from './dto/ride-requests.dto';
import { ListRideRequestsHistoryDto } from './dto/ride-requests.history.dto';
import { RideRequestsHistoryResponseSchema } from './dto/ride-requests.history.response';
import { RideRequestResponseSchema } from './dto/ride-requests.response';

@ApiTags('Ride Requests')
@Controller({ path: 'ride-requests', version: '1' })
@UseGuards(SessionGuard)
export class RideRequestsController {
  constructor(private readonly rideRequests: RideRequestsService) {}

  @Get('current')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(RideRequestResponseSchema.nullable())
  findCurrent(@CurrentUser() user: User) {
    return this.rideRequests.findCurrentForRider(user.id);
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(RideRequestsHistoryResponseSchema)
  findHistory(
    @CurrentUser() user: User,
    @Query() dto: ListRideRequestsHistoryDto,
  ) {
    return this.rideRequests.findHistoryForRider(user.id, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(RideRequestResponseSchema)
  findById(@CurrentUser() user: User, @Param('id') id: string) {
    return this.rideRequests.findByIdForRider(user.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(RideRequestResponseSchema)
  create(
    @CurrentUser() user: User,
    @Req() _request: AuthenticatedRequest,
    @Body() dto: CreateRideRequestDto,
  ) {
    return this.rideRequests.create({
      riderId: user.id,
      pickup: dto.pickup,
      destination: dto.destination,
      fareEstimateId: dto.fareEstimateId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(RideRequestResponseSchema)
  cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CancelRideRequestDto = {},
  ) {
    return this.rideRequests.cancel(user.id, id, dto);
  }
}
