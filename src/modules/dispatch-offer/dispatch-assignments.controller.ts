import {
  Body,
  Controller,
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
import { CurrentUser, SessionGuard } from '../auth';
import type { User } from '../user';
import { DispatchAssignmentCancellationService } from './dispatch-assignment-cancellation.service';
import { DispatchAssignmentPickupService } from './dispatch-assignment-pickup.service';
import { DispatchOffersService } from './dispatch-offers.service';
import { ListDispatchAssignmentsHistoryDto } from './dto/dispatch-assignments.history.dto';
import { DispatchAssignmentsHistoryResponseSchema } from './dto/dispatch-assignments.history.response';
import { DispatchCancellationDto } from './dto/dispatch-cancellation.dto';
import { DispatchCancellationResponseSchema } from './dto/dispatch-cancellation.response';
import { DispatchAssignmentPickupResponseSchema } from './dto/dispatch-assignment-pickup.response';
import { DispatchAssignmentTripResponseSchema } from './dto/dispatch-assignment-trip.response';
import { ActiveDispatchAssignmentResponseSchema } from './dto/dispatch-assignments.response';
import { DispatchAssignmentTripService } from './dispatch-assignment-trip.service';

@ApiTags('Dispatch Assignments')
@Controller({ path: 'dispatch-assignments', version: '1' })
@UseGuards(SessionGuard)
export class DispatchAssignmentsController {
  constructor(
    private readonly pickup: DispatchAssignmentPickupService,
    private readonly cancellations: DispatchAssignmentCancellationService,
    private readonly offers: DispatchOffersService,
    private readonly trips: DispatchAssignmentTripService,
  ) {}

  @Get('active')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ActiveDispatchAssignmentResponseSchema.nullable())
  findActive(@CurrentUser() user: User) {
    return this.offers.findActiveAssignmentForDriver(user.id);
  }

  @Post(':id/arrive-at-pickup')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchAssignmentPickupResponseSchema)
  arriveAtPickup(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pickup.arriveAtPickup(user.id, id);
  }

  @Post(':id/cancel-rider-no-show')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchAssignmentPickupResponseSchema)
  cancelRiderNoShow(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pickup.cancelRiderNoShow(user.id, id);
  }

  @Post(':id/start-trip')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchAssignmentTripResponseSchema)
  startTrip(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.trips.startTrip(user.id, id);
  }

  @Post(':id/complete-trip')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchAssignmentTripResponseSchema)
  completeTrip(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.trips.completeTrip(user.id, id);
  }

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchAssignmentsHistoryResponseSchema)
  findHistory(
    @CurrentUser() user: User,
    @Query() dto: ListDispatchAssignmentsHistoryDto,
  ) {
    return this.offers.findHistoryForDriver(user.id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(DispatchCancellationResponseSchema)
  cancelAssignedRide(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DispatchCancellationDto = {},
  ) {
    return this.cancellations.cancelAssignedRide(user.id, id, dto);
  }
}
