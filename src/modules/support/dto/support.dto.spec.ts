import {
  BugReportScreenshotUploadUrlDto,
  CreateBugReportDto,
  CreateFeedbackDto,
  CreateSupportContactDto,
  UpdateSupportContactDto,
} from './support.dto';

describe('support DTOs', () => {
  it('accepts a valid bug report with optional reproduction steps and screenshots', () => {
    expect(
      CreateBugReportDto.schema.parse({
        severity: 'critical',
        impact: 'cant_use_app',
        area: 'crash',
        details: 'The app crashes after confirming a booking.',
        stepsToReproduce: 'Open app, choose destination, confirm booking.',
        screenshotKeys: ['bug-reports/user/a.jpg', 'bug-reports/user/b.jpg'],
      }),
    ).toMatchObject({
      severity: 'critical',
      impact: 'cant_use_app',
      area: 'crash',
    });

    expect(
      CreateBugReportDto.schema.parse({
        severity: 'medium',
        impact: 'feature_broken',
        area: 'booking',
        details: 'Booking confirmation does not finish.',
      }),
    ).toEqual({
      severity: 'medium',
      impact: 'feature_broken',
      area: 'booking',
      details: 'Booking confirmation does not finish.',
    });

    expect(
      CreateBugReportDto.schema.parse({
        severity: 'medium',
        impact: 'feature_broken',
        area: 'booking',
        details: 'Booking confirmation does not finish.',
        stepsToReproduce: '   ',
      }),
    ).toEqual({
      severity: 'medium',
      impact: 'feature_broken',
      area: 'booking',
      details: 'Booking confirmation does not finish.',
      stepsToReproduce: undefined,
    });
  });

  it('rejects bug reports with unknown fields or too many screenshots', () => {
    expect(() =>
      CreateBugReportDto.schema.parse({
        severity: 'low',
        impact: 'minor_glitch',
        area: 'ui_layout',
        details: 'Button overlaps title.',
        extra: 'nope',
      }),
    ).toThrow();

    expect(() =>
      CreateBugReportDto.schema.parse({
        severity: 'low',
        impact: 'minor_glitch',
        area: 'ui_layout',
        details: 'Button overlaps title.',
        screenshotKeys: ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'],
      }),
    ).toThrow();
  });

  it('accepts a valid screenshot upload request', () => {
    expect(
      BugReportScreenshotUploadUrlDto.schema.parse({
        mimeType: 'image/jpeg',
        originalName: 'bug.jpg',
        sizeBytes: 1024,
      }),
    ).toEqual({
      mimeType: 'image/jpeg',
      originalName: 'bug.jpg',
      sizeBytes: 1024,
    });
  });

  it('validates feedback rating, topic, recommendation, and text', () => {
    expect(
      CreateFeedbackDto.schema.parse({
        rating: 5,
        topic: 'app_experience',
        wouldRecommend: true,
        title: 'Great app',
        feedback: 'The booking flow is clear.',
      }),
    ).toMatchObject({ rating: 5, wouldRecommend: true });

    expect(() =>
      CreateFeedbackDto.schema.parse({
        rating: 6,
        topic: 'app_experience',
        wouldRecommend: true,
        feedback: 'Too high.',
      }),
    ).toThrow();
  });

  it('validates support contact create and update payloads', () => {
    expect(
      CreateSupportContactDto.schema.parse({
        name: 'Emergency Contact',
        phone: '+251911111111',
      }),
    ).toEqual({ name: 'Emergency Contact', phone: '+251911111111' });

    expect(() =>
      CreateSupportContactDto.schema.parse({
        name: 'Emergency Contact',
        phone: '0911111111',
      }),
    ).toThrow(/phone/);

    expect(() => UpdateSupportContactDto.schema.parse({})).toThrow();
    expect(
      UpdateSupportContactDto.schema.parse({ phone: '+251922222222' }),
    ).toEqual({ phone: '+251922222222' });
  });
});
