import { SupportFeedbackResponseSchema } from './support.response';

describe('support response DTOs', () => {
  it('accepts feedback responses without optional text feedback', () => {
    const createdAt = new Date();

    expect(
      SupportFeedbackResponseSchema.parse({
        id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        userId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
        rating: 4,
        topic: 'app_experience',
        wouldRecommend: true,
        title: null,
        feedback: null,
        createdAt,
      }),
    ).toEqual({
      id: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
      userId: '019b2bd6-e678-7a6f-9054-456d6d6d2168',
      rating: 4,
      topic: 'app_experience',
      wouldRecommend: true,
      title: null,
      feedback: null,
      createdAt,
    });
  });
});
