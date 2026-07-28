import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';

type ErrorBody = {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.toResponse(exception, request.url);
    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }
    response.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    path: string,
  ): { status: number; body: ErrorBody } {
    const timestamp = new Date().toISOString();

    if (exception instanceof ZodSerializationException) {
      const zodError = exception.getZodError() as ZodError;
      this.logger.error(
        'Response serialization failed: ' +
          zodError.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
      );
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'InternalServerError',
          message: 'Something went wrong',
          path,
          timestamp,
        },
      };
    }

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError;
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'ZodValidationException',
          message: zodError.issues.map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          ),
          path,
          timestamp,
        },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'ValidationError',
          message: exception.issues.map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          ),
          path,
          timestamp,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ??
            exception.message);
      return {
        status,
        body: {
          statusCode: status,
          error: exception.name,
          message,
          path,
          timestamp,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'InternalServerError',
        message: 'Something went wrong',
        path,
        timestamp,
      },
    };
  }
}
