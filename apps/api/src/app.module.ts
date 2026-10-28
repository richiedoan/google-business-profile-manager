import { AuthModule } from "./auth/auth.module";
import { BusinessProfileModule } from "./business-profile/business-profile.module";
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
@Module({
  imports: [BusinessProfileModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
