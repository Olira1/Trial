import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { DispatchMetricsModule } from './modules/dispatch-candidate/dispatch-metrics.module';

describe('AppModule', () => {
  it('imports the dispatch metrics module so instrumentation is live', () => {
    const imports =
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
        | unknown[]
        | undefined) ?? [];

    expect(imports).toContain(DispatchMetricsModule);
  });
});
