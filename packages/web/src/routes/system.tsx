import { createFileRoute } from "@tanstack/react-router";
import { System } from "../pages.tsx";

export const Route = createFileRoute(
  // Stryker disable next-line all: The file-route key is type-only; the generated tree supplies the runtime path.
  "/system",
)({ component: System });
