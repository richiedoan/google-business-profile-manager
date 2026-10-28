import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@gbp/contracts";
@Controller("health")
export class HealthController {
  @Get()
  health(): HealthResponse {
    return { status: "ok" };
  }
}
