import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./configure-app";
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureApp(app);
  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}
void bootstrap().catch((error: unknown) => {
  console.error(
    "API startup failed:",
    error,
  );
  process.exitCode = 1;
});
